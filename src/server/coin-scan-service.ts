import { computeQuietMetrics, DEFAULT_BOX_WINDOW, type ScanResponse, type ScanRow, type ShrinkScanParams } from '../domain/coin-scan';
import { timeframeMs } from './candlestick-service';
import type { CandleSource, TickerSource } from './market-data';

export class CoinScanService {
  constructor(
    private readonly tickerSource: TickerSource,
    private readonly candleSource: CandleSource,
  ) {}

  async scanShrink(params: ShrinkScanParams): Promise<ScanResponse> {
    const tickers = await this.tickerSource.listTickers();
    const top = tickers
      .filter((ticker) => ticker.quoteVolume24h >= params.minQuoteVolume24h)
      .slice(0, params.topN);

    const scanned: ScanRow[] = [];
    const step = timeframeMs(params.timeframe);
    const anchor = Date.now();
    for (const ticker of top) {
      const candles = await this.candleSource.getCandlesticks({
        instrument: ticker.instrument,
        timeframe: params.timeframe,
        anchor,
        direction: 'earlier',
        // One extra bar for the still-forming candle, which is dropped below.
        // compression needs 2 * boxWindow completed bars (recent + prior) and the
        // latest-trend windows need 2 * trendWindow, which is covered because the
        // route enforces trendWindow <= boxWindow. The pull must satisfy both
        // `window + consecutive` and `2 * boxWindow`.
        limit: Math.max(params.window + params.consecutive, 2 * (params.boxWindow ?? DEFAULT_BOX_WINDOW)) + 1,
      });
      // Drop the still-forming bar by time (timestamp + step > now). The candle
      // cache may or may not contain the forming bar, so slicing the newest
      // element unconditionally wrongly dropped the newest COMPLETED bar.
      const completed = candles.filter((candle) => candle.timestamp + step <= anchor);
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
