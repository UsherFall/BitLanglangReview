import { defaultBinanceFetchJson, type FetchJson } from './http';
import type { MarketClass } from '../domain/market-class';

/**
 * Binance USDT-M instrument metadata from `fapi/v1/exchangeInfo`.
 * Binance marks TradFi perpetuals with `underlyingType` (EQUITY / HK_EQUITY /
 * KR_EQUITY / CN_EQUITY / COMMODITY / PREMARKET) but exposes no trading-session
 * calendar — so this source provides the CLASS, and `src/domain/market-session.ts`
 * decides when that class is open.
 *
 * The full exchangeInfo payload is ~1.1MB and ignores `?symbol=`, so it is
 * fetched whole and cached long (6h TTL + in-flight dedupe). Any failure or a
 * non-array response degrades to an EMPTY map: an absent class means "not a
 * TradFi contract" to every consumer, which is the pre-09/16 behaviour. That
 * degradation is visible rather than silent — the scan reports it
 * (`ScanResponse.metadataUnavailable`), because an outage would otherwise let
 * closed equity contracts back into the pool unnoticed.
 *
 * `symbolStatuses()` exposes the same fetch's `status` field, which is the only
 * way to tell a tradable contract from one Binance has delisted: a `SETTLING`
 * symbol stays in exchangeInfo and `fapi/v1/klines` still answers for it, but
 * with a frozen price and zero volume. Callers must treat an EMPTY status map as
 * "unknown" (metadata outage) rather than "every symbol is missing".
 *
 * `baseAsset` is deliberately NOT surfaced: the scan classifies instruments by
 * `underlyingType`, and nothing downstream needs the upstream ticker (the
 * Yahoo-alias design that needed it was dropped in 09/16).
 */
const EXCHANGE_INFO_URL = 'https://fapi.binance.com/fapi/v1/exchangeInfo';
const METADATA_TTL_MS = 6 * 60 * 60 * 1000;
/** The only `exchangeInfo.status` that means the contract can actually trade. */
const TRADING_STATUS = 'TRADING';

type BinanceSymbolMeta = { symbol?: string; underlyingType?: string; status?: string; quoteAsset?: string; contractType?: string };
type BinanceExchangeInfo = { symbols?: BinanceSymbolMeta[] };

/** Both views of one exchangeInfo fetch, so `load()` and `symbolStatuses()` share a request. */
type MetadataMaps = { classes: Map<string, MarketClass>; statuses: Map<string, string> };

/** Binance `underlyingType` -> domain `MarketClass`; unknown/missing -> null (unclassified). */
function mapUnderlyingType(underlyingType: string | undefined): MarketClass | null {
  switch (underlyingType) {
    case 'COIN':
    case 'INDEX':
      return 'CRYPTO';
    case 'EQUITY':
      return 'US_EQUITY';
    case 'HK_EQUITY':
      return 'HK_EQUITY';
    case 'KR_EQUITY':
      return 'KR_EQUITY';
    case 'CN_EQUITY':
      return 'CN_EQUITY';
    case 'COMMODITY':
      return 'COMMODITY';
    case 'PREMARKET':
      return 'PRE_IPO';
    default:
      return null;
  }
}

export class BinanceInstrumentMetadataSource {
  private cache: { at: number; maps: MetadataMaps } | null = null;
  private inflight: Promise<MetadataMaps> | null = null;
  /** Symbols quoted in USDT, from the same cached fetch. See `listTradableUsdtSymbols`. */
  private usdtQuoted = new Set<string>();

  constructor(private readonly fetchJson: FetchJson = defaultBinanceFetchJson) {}

  /** Symbol -> MarketClass map; empty map when metadata is unavailable. */
  async load(): Promise<Map<string, MarketClass>> {
    return (await this.loadMaps()).classes;
  }

  /**
   * Symbol -> `exchangeInfo.status` map; empty map when metadata is unavailable.
   * Symbols whose payload carries no `status` are omitted, so a missing entry
   * means "unknown status", not "not tradable".
   */
  async symbolStatuses(): Promise<Map<string, string>> {
    return (await this.loadMaps()).statuses;
  }

  /**
   * Symbols of every USDT-quoted contract that is currently `TRADING`,
   * sorted.
   *
   * `contractType` is deliberately NOT filtered: besides `PERPETUAL`, Binance
   * lists `TRADIFI_PERPETUAL` (e.g. `QNTXUSDT`) and face-value contracts such as
   * `1000SHIBUSDT`, and both are legitimately replayable — the review charts
   * whatever venue the instrument names. Only `quoteAsset` and `status` narrow
   * the list, so a delisted or non-USDT contract is excluded while every tradable
   * USDT contract stays reachable.
   *
   * Throws when the metadata is unreadable. An empty list here would read as
   * "no instrument is replayable" and silently strand the reviewer, so the
   * outage is surfaced instead — unlike `load()`/`symbolStatuses()`, whose empty
   * maps degrade to a documented "unknown" that other callers handle.
   */
  async listTradableUsdtSymbols(): Promise<string[]> {
    const maps = await this.loadMaps();
    if (maps.statuses.size === 0) throw new Error('币安合约信息不可用，暂时无法列出可复盘的交易对');
    return [...maps.statuses.entries()]
      .filter(([, status]) => status === TRADING_STATUS)
      .map(([symbol]) => symbol)
      .filter((symbol) => this.usdtQuoted.has(symbol))
      .sort();
  }

  private loadMaps(): Promise<MetadataMaps> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < METADATA_TTL_MS) return Promise.resolve(this.cache.maps);
    if (this.inflight) return this.inflight;
    this.inflight = this.fetchMaps()
      .then((maps) => {
        this.cache = { at: Date.now(), maps };
        return maps;
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  private async fetchMaps(): Promise<MetadataMaps> {
    let response: BinanceExchangeInfo;
    try {
      response = (await this.fetchJson(EXCHANGE_INFO_URL)) as BinanceExchangeInfo;
    } catch {
      // Metadata outage: degrade to "no class / unknown status" rather than breaking callers.
      return { classes: new Map(), statuses: new Map() };
    }
    const symbols = response?.symbols;
    if (!Array.isArray(symbols)) return { classes: new Map(), statuses: new Map() };
    const classes = new Map<string, MarketClass>();
    const statuses = new Map<string, string>();
    this.usdtQuoted = new Set();
    for (const symbolMeta of symbols) {
      if (typeof symbolMeta.symbol !== 'string') continue;
      const marketClass = mapUnderlyingType(symbolMeta.underlyingType);
      if (marketClass !== null) classes.set(symbolMeta.symbol, marketClass);
      if (typeof symbolMeta.status === 'string') statuses.set(symbolMeta.symbol, symbolMeta.status);
      if (symbolMeta.quoteAsset === 'USDT') this.usdtQuoted.add(symbolMeta.symbol);
    }
    return { classes, statuses };
  }
}

/** Shared singleton so scan/ticker paths reuse one 6h-cached metadata fetch. */
let sharedMetadataSource: BinanceInstrumentMetadataSource | null = null;
export function binanceInstrumentMetadata(): BinanceInstrumentMetadataSource {
  if (!sharedMetadataSource) sharedMetadataSource = new BinanceInstrumentMetadataSource();
  return sharedMetadataSource;
}
