import { createHmac } from 'node:crypto';
import type { BitgetOrder } from '../domain/bitget-order';
import type { BitgetHistoryPosition } from '../domain/bitget-position';
import { defaultBitgetFetchJson } from './http';

/** Injectable Bitget GET helper; the default routes through the shared proxy
 * with a 12s timeout and keeps non-OK response bodies for readable errors. */
export type BitgetFetchJson = (url: string, headers: Record<string, string>) => Promise<unknown>;

const BITGET_BASE_URL = 'https://api.bitget.com';
const HISTORY_POSITION_PATH = '/api/v2/mix/position/history-position';
const ORDER_HISTORY_PATH = '/api/v2/mix/order/orders-history';
const PUBLIC_TIME_PATH = '/api/v2/public/time';
const PRODUCT_TYPE = 'USDT-FUTURES';
const MAX_PAGE_LIMIT = 100;
const CLOCK_SYNC_TTL_MS = 10 * 60 * 1000;

/** Bitget rejects any orders-history window wider than this (measured
 * `code=00001 "startTime and endTime interval cannot be greater than 7 days"`),
 * far tighter than the 90 days history-position allows. */
export const ORDER_HISTORY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

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

export type OrderHistoryPageRequest = {
  startTime: number;
  endTime: number;
  limit?: number;
  /** Cursor: return orders older than this order id (the page's last id). */
  idLessThan?: string;
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

  /**
   * Fetches one page of filled orders. Windows are capped at 7 days by the
   * exchange, and a busy week exceeds the 100-row page limit (measured 144
   * orders in 7 days), so callers must page with `idLessThan` until a short
   * page comes back.
   */
  async fetchOrdersPage(input: OrderHistoryPageRequest): Promise<BitgetOrder[]> {
    const limit = Math.min(input.limit ?? MAX_PAGE_LIMIT, MAX_PAGE_LIMIT);
    const params: Record<string, string | number> = {
      productType: PRODUCT_TYPE,
      startTime: input.startTime,
      endTime: input.endTime,
      limit,
    };
    if (input.idLessThan) params.idLessThan = input.idLessThan;
    const payload = await this.get(`${ORDER_HISTORY_PATH}?${buildQuery(params)}`);
    return extractList(payload.data, 'entrustedList')
      .map(normalizeOrderRow)
      .filter((row): row is BitgetOrder => row !== null);
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

function extractList(data: unknown, key = 'list'): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    const value = (data as Record<string, unknown>)[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

/**
 * Normalizes one orders-history row. Only filled orders with a usable average
 * price are kept: cancelled orders carry an empty `priceAvg` (measured 19 of
 * 144 rows in a week), and a point cannot be plotted without a fill price.
 */
function normalizeOrderRow(raw: unknown): BitgetOrder | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (stringValue(row.status) !== 'filled') return null;

  const orderId = stringValue(row.orderId);
  const symbol = stringValue(row.symbol);
  const side = row.tradeSide === 'open' ? 'open' : row.tradeSide === 'close' ? 'close' : null;
  const posSide = row.posSide === 'long' || row.posSide === 'short' ? row.posSide : null;
  const qty = numberValue(row.baseVolume);
  const price = numberValue(row.priceAvg);
  const tradedAt = numberValue(row.uTime);
  if (!orderId || !symbol || !side || !posSide) return null;
  if (qty === null || qty <= 0 || price === null || price <= 0 || tradedAt === null) return null;

  return {
    orderId,
    symbol,
    posSide,
    side,
    qty,
    price,
    fee: numberValue(row.fee) ?? 0,
    profit: numberValue(row.totalProfits) ?? 0,
    source: stringValue(row.orderSource),
    leverage: numberValue(row.leverage),
    tradedAt,
    placedAt: numberValue(row.cTime),
  };
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
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
