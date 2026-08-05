import { computeQuietMetrics, type ScanResponse, type ScanRow, type ShrinkScanParams } from '../domain/coin-scan';
import type { CandlestickService } from './candlestick-service';
import { defaultFetchJson, type FetchJson } from './http';
import { fetchOkxTickers } from './okx-tickers';

type CandleSource = Pick<CandlestickService, 'getCandlesticks'>;

export class CoinScanService {
  constructor(
    private readonly candleSource: CandleSource,
    private readonly fetchJson: FetchJson = defaultFetchJson,
  ) {}

  async scanShrink(params: ShrinkScanParams): Promise<ScanResponse> {
    const tickers = await fetchOkxTickers(this.fetchJson);
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
}
