import Database from 'better-sqlite3';
import type { BitgetOrder } from '../domain/bitget-order';
import type { BitgetHistoryPosition } from '../domain/bitget-position';

export type CachedBitgetPosition = {
  id: string;
  row: BitgetHistoryPosition;
  ctime: number;
  utime: number;
  fetchedAt: string;
};

/** An order row as cached, keeping the fetch time for staleness checks. */
export type CachedBitgetOrder = BitgetOrder & { fetchedAt: string };

type PositionRow = {
  id: string;
  raw_json: string;
  symbol: string;
  ctime: number;
  utime: number;
  fetched_at: string;
};

type OrderRow = {
  order_id: string;
  symbol: string;
  pos_side: string;
  side: string;
  qty: number;
  price: number;
  fee: number;
  profit: number;
  source: string;
  leverage: number | null;
  traded_at: number;
  placed_at: number | null;
  fetched_at: string;
};

/** SQLite cache of Bitget history-position rows, so re-opening the app or
 * re-syncing never needs a full re-fetch. Mirrors the store style of
 * `review-store.ts` (own Database handle, WAL, raw SQL). */
export class BitgetPositionStore {
  private readonly db: Database.Database;

  constructor(filename: string) {
    this.db = new Database(filename);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      create table if not exists bitget_positions (
        id text primary key,
        raw_json text not null,
        symbol text not null,
        ctime integer not null,
        utime integer not null,
        fetched_at text not null
      );
      create index if not exists idx_bitget_positions_utime on bitget_positions (utime);
      create index if not exists idx_bitget_positions_ctime on bitget_positions (ctime);

      /* Individual filled orders, stored raw: which closed cycle an order
         belongs to is derived at read time (src/domain/bitget-round-orders.ts),
         so improving that mapping never requires re-fetching. */
      create table if not exists bitget_orders (
        order_id text primary key,
        symbol text not null,
        pos_side text not null,
        side text not null,
        qty real not null,
        price real not null,
        fee real not null,
        profit real not null,
        source text not null,
        leverage integer,
        traded_at integer not null,
        placed_at integer,
        fetched_at text not null
      );
      create index if not exists idx_bitget_orders_symbol_time on bitget_orders (symbol, traded_at);
    `);
  }

  /** Idempotent bulk upsert; existing ids are refreshed, never duplicated. */
  upsertRows(rows: readonly CachedBitgetPosition[]): number {
    const insert = this.db.prepare(`
      insert into bitget_positions (id, raw_json, symbol, ctime, utime, fetched_at)
      values (@id, @rawJson, @symbol, @ctime, @utime, @fetchedAt)
      on conflict(id) do update set
        raw_json = excluded.raw_json,
        symbol = excluded.symbol,
        ctime = excluded.ctime,
        utime = excluded.utime,
        fetched_at = excluded.fetched_at
    `);
    const apply = this.db.transaction((items: readonly CachedBitgetPosition[]): number => {
      for (const item of items) {
        insert.run({
          id: item.id,
          rawJson: JSON.stringify(item.row),
          symbol: item.row.symbol,
          ctime: item.ctime,
          utime: item.utime,
          fetchedAt: item.fetchedAt,
        });
      }
      return items.length;
    });
    return apply(rows);
  }

  listAll(): CachedBitgetPosition[] {
    const rows = this.db.prepare('select * from bitget_positions order by ctime asc').all() as PositionRow[];
    return rows.map(toCached);
  }

  /** Newest closed-position time (ms), or null when nothing is cached. */
  maxUtime(): number | null {
    const row = this.db.prepare('select max(utime) as value from bitget_positions').get() as { value: number | null };
    return row.value ?? null;
  }

  deleteByTime(startMs: number, endMs: number): number {
    const result = this.db.prepare('delete from bitget_positions where ctime >= ? and ctime <= ?').run(startMs, endMs);
    return result.changes;
  }

  /** Idempotent bulk upsert of filled orders; an order's fields never change
   * after it fills, so re-syncing refreshes instead of duplicating. */
  upsertOrders(rows: readonly CachedBitgetOrder[]): number {
    const insert = this.db.prepare(`
      insert into bitget_orders (order_id, symbol, pos_side, side, qty, price, fee, profit, source, leverage, traded_at, placed_at, fetched_at)
      values (@orderId, @symbol, @posSide, @side, @qty, @price, @fee, @profit, @source, @leverage, @tradedAt, @placedAt, @fetchedAt)
      on conflict(order_id) do update set
        symbol = excluded.symbol,
        pos_side = excluded.pos_side,
        side = excluded.side,
        qty = excluded.qty,
        price = excluded.price,
        fee = excluded.fee,
        profit = excluded.profit,
        source = excluded.source,
        leverage = excluded.leverage,
        traded_at = excluded.traded_at,
        placed_at = excluded.placed_at,
        fetched_at = excluded.fetched_at
    `);
    const apply = this.db.transaction((items: readonly CachedBitgetOrder[]): number => {
      for (const item of items) {
        insert.run({
          orderId: item.orderId,
          symbol: item.symbol,
          posSide: item.posSide,
          side: item.side,
          qty: item.qty,
          price: item.price,
          fee: item.fee,
          profit: item.profit,
          source: item.source,
          leverage: item.leverage,
          tradedAt: item.tradedAt,
          placedAt: item.placedAt,
          fetchedAt: item.fetchedAt,
        });
      }
      return items.length;
    });
    return apply(rows);
  }

  /** Cached orders grouped by symbol, each group ascending by traded time —
   * the shape the round-matching pass expects. */
  listOrdersBySymbol(): Map<string, BitgetOrder[]> {
    const rows = this.db.prepare('select * from bitget_orders order by traded_at asc').all() as OrderRow[];
    const grouped = new Map<string, BitgetOrder[]>();
    for (const row of rows) {
      const list = grouped.get(row.symbol) ?? [];
      list.push(toOrder(row));
      grouped.set(row.symbol, list);
    }
    return grouped;
  }

  /** Drops cached orders inside a traded-time range, for wipe re-syncs. */
  deleteOrdersByTime(startMs: number, endMs: number): number {
    const result = this.db.prepare('delete from bitget_orders where traded_at >= ? and traded_at <= ?').run(startMs, endMs);
    return result.changes;
  }

  /** Newest traded order time (ms), or null when nothing is cached. */
  maxOrderTradedAt(): number | null {
    const row = this.db.prepare('select max(traded_at) as value from bitget_orders').get() as { value: number | null };
    return row.value ?? null;
  }

  close(): void {
    this.db.close();
  }
}

function toOrder(row: OrderRow): BitgetOrder {
  return {
    orderId: row.order_id,
    symbol: row.symbol,
    posSide: row.pos_side === 'short' ? 'short' : 'long',
    side: row.side === 'close' ? 'close' : 'open',
    qty: row.qty,
    price: row.price,
    fee: row.fee,
    profit: row.profit,
    source: row.source,
    leverage: row.leverage,
    tradedAt: row.traded_at,
    placedAt: row.placed_at,
  };
}

function toCached(row: PositionRow): CachedBitgetPosition {
  return {
    id: row.id,
    row: JSON.parse(row.raw_json) as BitgetHistoryPosition,
    ctime: row.ctime,
    utime: row.utime,
    fetchedAt: row.fetched_at,
  };
}
