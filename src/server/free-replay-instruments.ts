import type { Candlestick, CandleSourceId } from '../domain/candlestick';
import type { ReviewTimeframe } from '../domain/trade';

type InstrumentService = {
  listTradableUsdtSymbols(): Promise<string[]>;
  listSwapInstruments?: () => Promise<string[]>;
};

/**
 * The instrument list the Other Coin Panel offers, named in the vocabulary of
 * whichever source that panel will read from.
 *
 * The two venues do not share symbol names — Binance writes `BTCUSDT`, OKX
 * `BTC-USDT-SWAP` — and the candle route is strict about which it accepts: the
 * candidate chain matches `*-USDT-SWAP` and silently returns an empty window for
 * a Binance symbol, so a mismatched pair shows an empty panel rather than an
 * error. Serving the list per source keeps the panel's choices loadable.
 *
 * Binance's `exchangeInfo` is a ~1.1MB fetch already cached for 6h by the scan
 * and heat paths, so listing Binance symbols costs no extra request.
 */
export async function freeReplayInstrumentPayload(
  instrumentService: InstrumentService,
  source: CandleSourceId = 'binance',
): Promise<{ instruments: string[] }> {
  if (source === 'okx') {
    if (!instrumentService.listSwapInstruments) return { instruments: [] };
    return { instruments: await instrumentService.listSwapInstruments() };
  }
  return { instruments: await instrumentService.listTradableUsdtSymbols() };
}
