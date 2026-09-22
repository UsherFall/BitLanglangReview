import type { BitgetOrder } from '../domain/bitget-order';
import type { BitgetHistoryPosition } from '../domain/bitget-position';
import type { BitgetClient } from './bitget-client';
import { ORDER_HISTORY_WINDOW_MS } from './bitget-client';
import type { BitgetPositionStore, CachedBitgetOrder, CachedBitgetPosition } from './bitget-position-store';
import { makeBitgetTradeId } from './bitget-import';

/** The slice of BitgetClient the sync service depends on (testable with fakes). */
export type BitgetSyncReader = Pick<BitgetClient, 'fetchHistoryPositionsPage' | 'fetchOrdersPage'>;

const MAX_PAGE_LIMIT = 100;
/** Smallest window slice: below this we trust the page even when it is full,
 * so a pathological window cannot recurse forever. */
const MIN_SLICE_MS = 60_000;
/** Gap between order requests. The exchange tolerated 20 back-to-back calls at
 * 80ms with zero errors (measured), so this is deliberately conservative. */
const ORDER_PAGE_DELAY_MS = 150;
/** Safety cap on cursor pages per window; a week has never exceeded 2. */
const MAX_ORDER_PAGES = 20;

export type BitgetSyncInput = {
  fromMs: number;
  toMs?: number;
  /** When true, cached rows inside the range are removed before re-fetching. */
  wipe?: boolean;
};

export type BitgetSyncResult = {
  fetchedRows: number;
  uniqueRows: number;
  /** Filled orders cached in this run (the chart's per-action points). */
  ordersFetched: number;
  /** Order-fetch failure message; positions still sync when this is set. */
  ordersError: string | null;
  fromMs: number;
  toMs: number;
};

export type BitgetSyncOptions = {
  /** Overridable for tests; production uses ORDER_PAGE_DELAY_MS. */
  orderPageDelayMs?: number;
};

/**
 * Pulls closed position history plus the individual orders behind it, caching
 * both idempotently.
 *
 * Two different exchange limits apply, so the two passes slice independently:
 * - history-position: 90 days per window, 100 rows, re-requesting narrower
 *   slices while a page comes back full;
 * - orders-history: 7 days per window, 100 rows, paged with `idLessThan`
 *   while a page comes back full (a busy week exceeds 100 orders).
 *
 * Orders are stored raw — deciding which order belongs to which closed cycle
 * happens at read time, so that mapping can improve without re-fetching.
 */
export class BitgetSyncService {
  private readonly orderPageDelayMs: number;

  constructor(
    private readonly client: BitgetSyncReader,
    private readonly store: BitgetPositionStore,
    options: BitgetSyncOptions = {},
  ) {
    this.orderPageDelayMs = options.orderPageDelayMs ?? ORDER_PAGE_DELAY_MS;
  }

  async sync(input: BitgetSyncInput): Promise<BitgetSyncResult> {
    const toMs = Math.min(input.toMs ?? Date.now(), Date.now());
    const fromMs = Math.min(input.fromMs, toMs);
    if (input.wipe) {
      this.store.deleteByTime(fromMs, toMs);
      this.store.deleteOrdersByTime(fromMs, toMs);
    }

    const rows = await this.collectRange(fromMs, toMs, MAX_PAGE_LIMIT);
    const byId = new Map<string, CachedBitgetPosition>();
    const fetchedAt = new Date().toISOString();
    for (const row of rows) {
      byId.set(makeBitgetTradeId(row), toCached(row, fetchedAt));
    }
    this.store.upsertRows([...byId.values()]);

    // Orders are supplementary: a failure here must not lose the positions.
    let ordersFetched = 0;
    let ordersError: string | null = null;
    try {
      ordersFetched = await this.collectOrders(fromMs, toMs);
    } catch (error) {
      ordersError = error instanceof Error ? error.message : String(error);
    }

    return { fetchedRows: rows.length, uniqueRows: byId.size, ordersFetched, ordersError, fromMs, toMs };
  }

  private async collectRange(startMs: number, endMs: number, limit: number): Promise<BitgetHistoryPosition[]> {
    const rows = await this.client.fetchHistoryPositionsPage({ startTime: startMs, endTime: endMs, limit });
    if (rows.length < limit || endMs - startMs <= MIN_SLICE_MS) return rows;
    const mid = startMs + Math.floor((endMs - startMs) / 2);
    const earlier = await this.collectRange(startMs, mid, limit);
    const later = await this.collectRange(mid + 1, endMs, limit);
    return [...earlier, ...later];
  }

  /** Caches every filled order in range; returns how many unique orders landed. */
  private async collectOrders(fromMs: number, toMs: number): Promise<number> {
    const fetchedAt = new Date().toISOString();
    const byId = new Map<string, CachedBitgetOrder>();

    for (let start = fromMs; start < toMs; start += ORDER_HISTORY_WINDOW_MS) {
      const end = Math.min(start + ORDER_HISTORY_WINDOW_MS, toMs);
      let cursor: string | undefined;
      for (let page = 0; page < MAX_ORDER_PAGES; page += 1) {
        const rows: BitgetOrder[] = await this.client.fetchOrdersPage({
          startTime: start,
          endTime: end,
          limit: MAX_PAGE_LIMIT,
          idLessThan: cursor,
        });
        for (const row of rows) byId.set(row.orderId, { ...row, fetchedAt });
        if (rows.length < MAX_PAGE_LIMIT) break;
        cursor = rows[rows.length - 1].orderId;
        await this.sleep();
      }
      await this.sleep();
    }

    this.store.upsertOrders([...byId.values()]);
    return byId.size;
  }

  private sleep(): Promise<void> {
    if (this.orderPageDelayMs <= 0) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, this.orderPageDelayMs));
  }
}

function toCached(row: BitgetHistoryPosition, fetchedAt: string): CachedBitgetPosition {
  return {
    id: makeBitgetTradeId(row),
    row,
    ctime: Number(row.ctime),
    utime: Number(row.utime),
    fetchedAt,
  };
}
