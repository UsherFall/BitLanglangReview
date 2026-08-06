import { defaultFetchJson, type FetchJson } from './http';
import type { Ticker, TickerSource } from './market-data';

export type OkxTicker = {
  instrument: string;
  quoteVolume24h: number;
  lastPrice: number;
  change24h: number;
};

type OkxTickersResponse = {
  data?: Array<{
    instId?: string;
    last?: string;
    open24h?: string;
    volCcy24h?: string;
  }>;
};

/**
 * Fetches every OKX USDT-settled SWAP ticker once and ranks them by 24h
 * quote volume in USDT descending. Shared by the coin scan and the alert
 * monitor so both read the same live price snapshot.
 *
 * `volCcy24h` is the 24h volume in base coin units (e.g. XLM coins), so the
 * 24h quote-volume in USDT is `volCcy24h * last`.
 */
export async function fetchOkxTickers(fetchJson: FetchJson = defaultFetchJson): Promise<OkxTicker[]> {
  const response = (await fetchJson('https://www.okx.com/api/v5/market/tickers?instType=SWAP')) as OkxTickersResponse;
  return (response.data ?? [])
    .filter((item) => item.instId?.endsWith('-USDT-SWAP'))
    .map((item) => {
      const lastPrice = Number(item.last);
      return {
        instrument: item.instId as string,
        quoteVolume24h: Number(item.volCcy24h) * lastPrice,
        lastPrice,
        change24h: change24hPercent(item.last, item.open24h),
      };
    })
    .filter((ticker) => Number.isFinite(ticker.quoteVolume24h) && Number.isFinite(ticker.lastPrice))
    .sort((a, b) => b.quoteVolume24h - a.quoteVolume24h);
}

function change24hPercent(last: string | undefined, open24h: string | undefined): number {
  const lastValue = Number(last);
  const openValue = Number(open24h);
  if (!Number.isFinite(lastValue) || !Number.isFinite(openValue) || openValue === 0) return 0;
  return ((lastValue - openValue) / openValue) * 100;
}

/**
 * OKX implementation of `TickerSource`, delegating to `fetchOkxTickers` so the
 * native fetch logic (USDT-SWAP filter, `volCcy24h * last` quote-volume) stays
 * in one place. FreeReplay/trade-review paths keep using the OKX candles
 * regardless of the coin-scan data source; this class is the OKX option for the
 * switchable scan/alert data source.
 */
export class OkxTickerSource implements TickerSource {
  constructor(private readonly fetchJson: FetchJson = defaultFetchJson) {}

  async listTickers(): Promise<Ticker[]> {
    return fetchOkxTickers(this.fetchJson);
  }
}
