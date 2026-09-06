import type { BitgetHistoryPosition } from '../domain/bitget-position';
import type { BitgetClient } from './bitget-client';
import type { BitgetPositionStore, CachedBitgetPosition } from './bitget-position-store';
import { makeBitgetTradeId } from './bitget-import';

/** The slice of BitgetClient the sync service depends on (testable with fakes). */
export type HistoryPositionsReader = Pick<BitgetClient, 'fetchHistoryPositionsPage'>;

const MAX_PAGE_LIMIT = 100;
/** Smallest window slice: below this we trust the page even when it is full,
 * so a pathological window cannot recurse forever. */
const MIN_SLICE_MS = 60_000;

export type BitgetSyncInput = {
  fromMs: number;
  toMs?: number;
  /** When true, cached rows inside the range are removed before re-fetching. */
  wipe?: boolean;
};

export type BitgetSyncResult = {
  fetchedRows: number;
  uniqueRows: number;
  fromMs: number;
  toMs: number;
};

/**
 * Pulls closed position history for a time range and caches it idempotently.
 *
 * Bitget caps each history-position request to a 3-month range and 100 rows.
 * A full page may mean "truncated", so the service re-requests smaller time
 * slices until every slice returns fewer than the page limit; rows are then
 * deduped by content key and upserted in one batch.
 */
export class BitgetSyncService {
  constructor(
    private readonly client: HistoryPositionsReader,
    private readonly store: BitgetPositionStore,
  ) {}

  async sync(input: BitgetSyncInput): Promise<BitgetSyncResult> {
    const toMs = Math.min(input.toMs ?? Date.now(), Date.now());
    const fromMs = Math.min(input.fromMs, toMs);
    if (input.wipe) this.store.deleteByTime(fromMs, toMs);

    const rows = await this.collectRange(fromMs, toMs, MAX_PAGE_LIMIT);
    const byId = new Map<string, CachedBitgetPosition>();
    const fetchedAt = new Date().toISOString();
    for (const row of rows) {
      byId.set(makeBitgetTradeId(row), toCached(row, fetchedAt));
    }
    this.store.upsertRows([...byId.values()]);
    return { fetchedRows: rows.length, uniqueRows: byId.size, fromMs, toMs };
  }

  private async collectRange(startMs: number, endMs: number, limit: number): Promise<BitgetHistoryPosition[]> {
    const rows = await this.client.fetchHistoryPositionsPage({ startTime: startMs, endTime: endMs, limit });
    if (rows.length < limit || endMs - startMs <= MIN_SLICE_MS) return rows;
    const mid = startMs + Math.floor((endMs - startMs) / 2);
    const earlier = await this.collectRange(startMs, mid, limit);
    const later = await this.collectRange(mid + 1, endMs, limit);
    return [...earlier, ...later];
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
