import Database from 'better-sqlite3';
import type { BitgetHistoryPosition } from '../domain/bitget-position';

export type CachedBitgetPosition = {
  id: string;
  row: BitgetHistoryPosition;
  ctime: number;
  utime: number;
  fetchedAt: string;
};

type PositionRow = {
  id: string;
  raw_json: string;
  symbol: string;
  ctime: number;
  utime: number;
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

  close(): void {
    this.db.close();
  }
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
