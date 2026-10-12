import { defaultBitgetMarketFetchJson, type FetchJson } from './http';
import { bitgetMarketClass } from '../domain/bitget-market-class';
import type { MarketClass } from '../domain/market-class';

/**
 * Bitget USDT-FUTURES instrument metadata from `/api/v2/mix/market/contracts`.
 * The endpoint's `isRwa` flag is the ONLY classification signal Bitget exposes
 * (`symbolType` is `perpetual` for every contract, `symbolStatus` always
 * `normal`), and it is a boolean — the crypto-vs-rest split itself lives in
 * `bitget-market-class.ts` as a user decision.
 *
 * The full payload (~800 contracts) is cached long (6h TTL + in-flight dedupe),
 * mirroring `BinanceInstrumentMetadataSource`. Any failure or a non-array
 * response degrades to an EMPTY map: an absent class means "not classified"
 * to every consumer (crypto-like, always open), which is the pre-classification
 * behaviour. That degradation is visible rather than silent — the ticker source
 * exposes `metadataAvailable()`, which the scan turns into
 * `ScanResponse.metadataUnavailable`, because an outage would otherwise let
 * RWA contracts (US stocks above the volume floor) flood the crypto scan
 * unnoticed.
 */
const CONTRACTS_URL = 'https://api.bitget.com/api/v2/mix/market/contracts?productType=USDT-FUTURES';
const METADATA_TTL_MS = 6 * 60 * 60 * 1000;

type BitgetContractMeta = { symbol?: string; isRwa?: string };
type BitgetContractsResponse = { code?: unknown; data?: BitgetContractMeta[] };

export class BitgetInstrumentMetadataSource {
  private cache: { at: number; classes: Map<string, MarketClass> } | null = null;
  private inflight: Promise<Map<string, MarketClass>> | null = null;

  constructor(private readonly fetchJson: FetchJson = defaultBitgetMarketFetchJson) {}

  /** Symbol -> MarketClass map; empty map when metadata is unavailable. */
  async load(): Promise<Map<string, MarketClass>> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < METADATA_TTL_MS) return this.cache.classes;
    if (this.inflight) return this.inflight;
    this.inflight = this.fetchClasses()
      .then((classes) => {
        this.cache = { at: Date.now(), classes };
        return classes;
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  private async fetchClasses(): Promise<Map<string, MarketClass>> {
    let response: BitgetContractsResponse;
    try {
      response = (await this.fetchJson(CONTRACTS_URL)) as BitgetContractsResponse;
    } catch {
      // Metadata outage: degrade to "unclassified" rather than breaking callers.
      return new Map();
    }
    const contracts = response?.data;
    if (!Array.isArray(contracts)) return new Map();
    const classes = new Map<string, MarketClass>();
    for (const contract of contracts) {
      if (typeof contract.symbol !== 'string') continue;
      const marketClass = bitgetMarketClass(contract.isRwa);
      if (marketClass !== undefined) classes.set(contract.symbol, marketClass);
    }
    return classes;
  }
}

/** Shared singleton so the scan/ticker paths reuse one 6h-cached metadata fetch. */
let sharedMetadataSource: BitgetInstrumentMetadataSource | null = null;
export function bitgetInstrumentMetadata(): BitgetInstrumentMetadataSource {
  if (!sharedMetadataSource) sharedMetadataSource = new BitgetInstrumentMetadataSource();
  return sharedMetadataSource;
}
