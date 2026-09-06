import { createHmac } from 'node:crypto';
import type { BitgetHistoryPosition } from '../domain/bitget-position';
import { defaultBitgetFetchJson } from './http';

/** Injectable Bitget GET helper; the default routes through the shared proxy
 * with a 12s timeout and keeps non-OK response bodies for readable errors. */
export type BitgetFetchJson = (url: string, headers: Record<string, string>) => Promise<unknown>;

const BITGET_BASE_URL = 'https://api.bitget.com';
const HISTORY_POSITION_PATH = '/api/v2/mix/position/history-position';
const PUBLIC_TIME_PATH = '/api/v2/public/time';
const PRODUCT_TYPE = 'USDT-FUTURES';
const MAX_PAGE_LIMIT = 100;
const CLOCK_SYNC_TTL_MS = 10 * 60 * 1000;

export type BitgetClientConfig = {
  apiKey: string;
  secret: string;
  passphrase: string;
  baseUrl?: string;
  fetchJson?: BitgetFetchJson;
};

export type HistoryPositionsPageRequest = {
  startTime: number;
  endTime: number;
  limit?: number;
};

/** A Bitget private-API business error; `code` is the exchange code when known. */
export class BitgetApiError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = 'BitgetApiError';
  }
}

/** Minimal signed read-only client for one product type. Only GET requests. */
export class BitgetClient {
  private readonly apiKey: string;
  private readonly secret: string;
  private readonly passphrase: string;
  private readonly baseUrl: string;
  private readonly fetchJson: BitgetFetchJson;
  /** Local-vs-server clock skew; requests sign a server-corrected timestamp. */
  private offsetMs = 0;
  private offsetSyncedAt = 0;

  constructor(config: BitgetClientConfig) {
    this.apiKey = config.apiKey;
    this.secret = config.secret;
    this.passphrase = config.passphrase;
    this.baseUrl = config.baseUrl ?? BITGET_BASE_URL;
    this.fetchJson = config.fetchJson ?? defaultBitgetFetchJson;
  }

  /** Server time in ms, refreshed occasionally. */
  async serverTime(): Promise<number> {
    return this.fetchPublicTime();
  }

  /**
   * Fetches one page of closed position history. Bitget caps a single request
   * at 3 months of range and `limit` rows; the sync service slices time windows
   * and re-requests when a page is full so no closed cycle is missed.
   */
  async fetchHistoryPositionsPage(input: HistoryPositionsPageRequest): Promise<BitgetHistoryPosition[]> {
    const limit = Math.min(input.limit ?? MAX_PAGE_LIMIT, MAX_PAGE_LIMIT);
    const query = buildQuery({
      productType: PRODUCT_TYPE,
      startTime: input.startTime,
      endTime: input.endTime,
      limit,
    });
    const payload = await this.get(`${HISTORY_POSITION_PATH}?${query}`);
    const rows = extractList(payload.data);
    return rows
      .map(normalizeHistoryPositionRow)
      .filter((row): row is BitgetHistoryPosition => row !== null);
  }

  private async get(requestPath: string): Promise<{ code?: unknown; msg?: unknown; data?: unknown }> {
    const timestamp = await this.signedTimestamp();
    const signature = createHmac('sha256', this.secret)
      .update(`${timestamp}GET${requestPath}`)
      .digest('base64');
    const headers: Record<string, string> = {
      'ACCESS-KEY': this.apiKey,
      'ACCESS-SIGN': signature,
      'ACCESS-TIMESTAMP': timestamp,
      'ACCESS-PASSPHRASE': this.passphrase,
    };
    const payload = (await this.fetchJson(`${this.baseUrl}${requestPath}`, headers)) as {
      code?: unknown;
      msg?: unknown;
      data?: unknown;
    };
    if (!payload || typeof payload !== 'object') {
      throw new Error('Bitget 返回了无法解析的响应');
    }
    if (payload.code !== '00000') {
      const message = typeof payload.msg === 'string' && payload.msg ? payload.msg : `Bitget 业务错误 code=${String(payload.code)}`;
      throw new BitgetApiError(message, payload.code == null ? undefined : String(payload.code));
    }
    return payload;
  }

  /** Server-corrected epoch-ms string, re-synced when the cached skew is stale. */
  private async signedTimestamp(): Promise<string> {
    if (Date.now() - this.offsetSyncedAt > CLOCK_SYNC_TTL_MS) {
      await this.syncClock();
    }
    return String(Date.now() + this.offsetMs);
  }

  private async syncClock(): Promise<void> {
    const serverMs = await this.fetchPublicTime();
    this.offsetMs = serverMs - Date.now();
    this.offsetSyncedAt = Date.now();
  }

  private async fetchPublicTime(): Promise<number> {
    const payload = (await this.fetchJson(`${this.baseUrl}${PUBLIC_TIME_PATH}`, {})) as {
      code?: unknown;
      data?: { serverTime?: unknown };
    };
    const serverTime = Number(payload?.data?.serverTime);
    if (payload?.code !== '00000' || !Number.isFinite(serverTime)) {
      throw new Error('无法从 Bitget 获取服务器时间');
    }
    return serverTime;
  }
}

function buildQuery(params: Record<string, string | number>): string {
  return Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
}

function extractList(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object' && Array.isArray((data as { list?: unknown }).list)) {
    return (data as { list: unknown[] }).list;
  }
  return [];
}

function normalizeHistoryPositionRow(raw: unknown): BitgetHistoryPosition | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const symbol = stringValue(row.symbol);
  const holdSide = row.holdSide;
  if (!symbol || (holdSide !== 'long' && holdSide !== 'short')) return null;
  return {
    symbol,
    marginCoin: stringValue(row.marginCoin) || undefined,
    holdSide,
    marginMode: stringValue(row.marginMode) || undefined,
    openAvgPrice: stringValue(row.openAvgPrice),
    closeAvgPrice: stringValue(row.closeAvgPrice),
    openTotalPos: stringValue(row.openTotalPos),
    closeTotalPos: stringValue(row.closeTotalPos),
    pnl: stringValue(row.pnl),
    netProfit: stringValue(row.netProfit),
    totalFunding: stringValue(row.totalFunding),
    openFee: stringValue(row.openFee),
    closeFee: stringValue(row.closeFee),
    ctime: stringValue(row.ctime),
    utime: stringValue(row.utime),
  };
}

function stringValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}
