import { defaultBinanceFetchJson, type FetchJson } from './http';
import type { MarketClass } from '../domain/market-session';

/**
 * Binance USDT-M instrument-class metadata from `fapi/v1/exchangeInfo`.
 * Binance marks TradFi perpetuals with `underlyingType` (EQUITY / HK_EQUITY /
 * KR_EQUITY / CN_EQUITY / COMMODITY / PREMARKET) but exposes no trading-session
 * calendar — so this source provides the class, and `src/domain/market-session.ts`
 * decides whether that class is in session at scan time.
 *
 * The full exchangeInfo payload is ~1.1MB and ignores `?symbol=`, so it is
 * fetched whole and cached long (6h TTL + in-flight dedupe). Any failure or a
 * non-array response degrades to an EMPTY map: callers treat an absent class as
 * ungated, so a metadata outage never breaks or narrows a scan.
 */
const EXCHANGE_INFO_URL = 'https://fapi.binance.com/fapi/v1/exchangeInfo';
const METADATA_TTL_MS = 6 * 60 * 60 * 1000;

type BinanceSymbolMeta = { symbol?: string; underlyingType?: string };
type BinanceExchangeInfo = { symbols?: BinanceSymbolMeta[] };

/** Binance `underlyingType` -> domain `MarketClass`; unknown/missing -> null (ungated). */
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
  private cache: { at: number; map: Map<string, MarketClass> } | null = null;
  private inflight: Promise<Map<string, MarketClass>> | null = null;

  constructor(private readonly fetchJson: FetchJson = defaultBinanceFetchJson) {}

  /** Symbol -> MarketClass map; empty map when metadata is unavailable. */
  async load(): Promise<Map<string, MarketClass>> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < METADATA_TTL_MS) return this.cache.map;
    if (this.inflight) return this.inflight;
    this.inflight = this.fetchMap()
      .then((map) => {
        this.cache = { at: Date.now(), map };
        return map;
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  private async fetchMap(): Promise<Map<string, MarketClass>> {
    let response: BinanceExchangeInfo;
    try {
      response = (await this.fetchJson(EXCHANGE_INFO_URL)) as BinanceExchangeInfo;
    } catch {
      // Metadata outage: degrade to "no gating" rather than breaking the scan.
      return new Map();
    }
    const symbols = response?.symbols;
    if (!Array.isArray(symbols)) return new Map();
    const map = new Map<string, MarketClass>();
    for (const symbolMeta of symbols) {
      if (typeof symbolMeta.symbol !== 'string') continue;
      const marketClass = mapUnderlyingType(symbolMeta.underlyingType);
      if (marketClass !== null) map.set(symbolMeta.symbol, marketClass);
    }
    return map;
  }
}

/** Shared singleton so scan/ticker paths reuse one 6h-cached metadata fetch. */
let sharedMetadataSource: BinanceInstrumentMetadataSource | null = null;
export function binanceInstrumentMetadata(): BinanceInstrumentMetadataSource {
  if (!sharedMetadataSource) sharedMetadataSource = new BinanceInstrumentMetadataSource();
  return sharedMetadataSource;
}
