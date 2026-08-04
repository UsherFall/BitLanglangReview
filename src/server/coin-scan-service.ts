import { computeQuietMetrics, type ScanResponse, type ScanRow, type ShrinkScanParams } from '../domain/coin-scan';
import type { CandlestickService } from './candlestick-service';

type FetchJson = (url: string) => Promise<unknown>;

type CandleSource = Pick<CandlestickService, 'getCandlesticks'>;

type Ticker = {
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

export class CoinScanService {
  constructor(
    private readonly candleSource: CandleSource,
    private readonly fetchJson: FetchJson = defaultFetchJson,
  ) {}

  async scanShrink(params: ShrinkScanParams): Promise<ScanResponse> {
    const tickers = await this.fetchTickers();
    const top = tickers
      .filter((ticker) => ticker.quoteVolume24h >= params.minQuoteVolume24h)
      .slice(0, params.topN);

    const scanned: ScanRow[] = [];
    for (const ticker of top) {
      const candles = await this.candleSource.getCandlesticks({
        instrument: ticker.instrument,
        timeframe: params.timeframe,
        anchor: Date.now(),
        direction: 'earlier',
        // One extra bar for the still-forming candle, which is dropped below.
        limit: params.window + params.consecutive + 1,
      });
      const completed = candles.slice(0, -1);
      const metrics = computeQuietMetrics(completed, params);
      if (!metrics) continue;
      scanned.push({
        instrument: ticker.instrument,
        lastPrice: ticker.lastPrice,
        change24h: ticker.change24h,
        quoteVolume24h: ticker.quoteVolume24h,
        ...metrics,
      });
    }

    scanned.sort((a, b) => a.intensity - b.intensity);
    const qualifiedCount = scanned.filter((row) => row.qualified).length;
    return { scanned, qualifiedCount, params, scannedAt: new Date().toISOString() };
  }

  private async fetchTickers(): Promise<Ticker[]> {
    const response = (await this.fetchJson('https://www.okx.com/api/v5/market/tickers?instType=SWAP')) as OkxTickersResponse;
    return (response.data ?? [])
      .filter((item) => item.instId?.endsWith('-USDT-SWAP'))
      .map((item) => {
        const lastPrice = Number(item.last);
        // volCcy24h is the 24h volume in base coin units (e.g. XLM coins), so
        // the 24h quote-volume in USDT is volCcy24h * last.
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
}

function change24hPercent(last: string | undefined, open24h: string | undefined): number {
  const lastValue = Number(last);
  const openValue = Number(open24h);
  if (!Number.isFinite(lastValue) || !Number.isFinite(openValue) || openValue === 0) return 0;
  return ((lastValue - openValue) / openValue) * 100;
}

async function defaultFetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  const response = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timeout));
  if (!response.ok) {
    throw new Error(`OKX request failed: ${response.status}`);
  }
  return response.json();
}
