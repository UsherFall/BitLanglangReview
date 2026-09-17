import type { Candlestick } from '../domain/candlestick';
import { resolveCandleChain } from '../domain/instrument-symbol';
import type { ReviewTimeframe } from '../domain/trade';
import type { CandleSource } from './market-data';

/**
 * Raised when a Binance candidate was skipped as untradable and the OKX fallback
 * has nothing either — i.e. no source carries this instrument. The message names
 * the instrument and the skip reason, because the chart status line renders it
 * verbatim: "no chart" without a why is exactly the failure mode this module
 * exists to remove.
 */
export class ReviewCandleUnavailableError extends Error {}

export type ReviewCandleRequest = {
  /** Binance source, used for the chain's `base+USDT` candidates. */
  binance: CandleSource;
  /** OKX source, the chain's last resort on the instrument's own name. */
  okx: CandleSource;
  /** OKX-style instrument of the reviewed trade (`RAY-USDT-SWAP`). */
  instrument: string;
  timeframe: ReviewTimeframe;
  entryTime: string;
  mode: string;
  anchor: number;
  /** `exchangeInfo` symbol -> status; an empty map means the metadata was unreadable. */
  binanceStatuses: () => Promise<ReadonlyMap<string, string>>;
};

/**
 * Fetches the candlesticks of a review trade through the ordered candidate chain
 * (`resolveCandleChain`): the Binance symbol candidates first, then OKX on the
 * instrument's own name.
 *
 * The chain only advances past a Binance candidate whose contract status is
 * KNOWN to be untradable, and it never requests such a candidate: Binance keeps
 * a settled symbol in `exchangeInfo` and answers `fapi/v1/klines` for it with a
 * frozen price and zero volume, so asking would chart a flat line instead of
 * failing. A tradable candidate's answer is final — including an empty window,
 * which just means there is nothing more to load in that range, so scrolling
 * past the present stays silent instead of switching venue.
 *
 * A Binance fetch failure propagates unchanged. Falling back on it would let an
 * OKX chart silently replace a rate-limited (429/418) Binance chart, and the two
 * venues do not share prices — the reviewer must see the limit, not a substitute.
 * The chain's OKX step is therefore reachable only through a known-untradable
 * status; when the status metadata is unreadable (empty map) every candidate is
 * attempted and behaviour matches the pre-chain implementation.
 *
 * Returns `[]` for an instrument that is not a `*-USDT-SWAP` symbol (the chain
 * is empty), preserving the route's "unmappable instrument" contract.
 */
export async function fetchReviewCandles(request: ReviewCandleRequest): Promise<Candlestick[]> {
  if (request.mode !== 'initial' && !Number.isFinite(request.anchor)) throw new Error('anchor is required');
  const chain = resolveCandleChain(request.instrument, await request.binanceStatuses());
  const unusable: string[] = [];
  for (const step of chain) {
    if (step.kind === 'binance') {
      if (!step.usable) {
        unusable.push(`${step.symbol}(${step.reason})`);
        continue;
      }
      return getCandlesForMode({ candleSource: request.binance, instrument: step.symbol, timeframe: request.timeframe, entryTime: request.entryTime, mode: request.mode, anchor: request.anchor });
    }
    // The OKX step is only reached after a Binance candidate was skipped, so an
    // empty answer here means neither exchange carries the instrument.
    const candles = await getCandlesForMode({ candleSource: request.okx, instrument: step.instrument, timeframe: request.timeframe, entryTime: request.entryTime, mode: request.mode, anchor: request.anchor });
    if (candles.length) return candles;
    throw new ReviewCandleUnavailableError(`无可用行情数据(${request.instrument}): 币安 ${unusable.join('、')}；OKX ${step.instrument} 无 K 线`);
  }
  return [];
}

/**
 * Resolves `mode` into candle requests for one source: `earlier`/`later` are a
 * single 150-bar window at the anchor, `initial` is the 150 bars before the
 * entry merged with the 150 after it. Shared with the OKX-only chart callers
 * (`source` absent or `okx`), which do not go through the candidate chain.
 */
export async function getCandlesForMode(input: {
  candleSource: CandleSource;
  instrument: string;
  timeframe: ReviewTimeframe;
  entryTime: string;
  mode: string;
  anchor: number;
}) {
  if (input.mode === 'earlier') {
    return input.candleSource.getCandlesticks({ instrument: input.instrument, timeframe: input.timeframe, anchor: input.anchor, direction: 'earlier', limit: 150 });
  }
  if (input.mode === 'later') {
    return input.candleSource.getCandlesticks({ instrument: input.instrument, timeframe: input.timeframe, anchor: input.anchor, direction: 'later', limit: 150 });
  }

  const entry = Date.parse(input.entryTime);
  const earlier = await input.candleSource.getCandlesticks({ instrument: input.instrument, timeframe: input.timeframe, anchor: entry, direction: 'earlier', limit: 150 });
  const later = await input.candleSource.getCandlesticks({ instrument: input.instrument, timeframe: input.timeframe, anchor: entry - 1, direction: 'later', limit: 150 });
  return mergeCandles([...earlier, ...later]);
}

function mergeCandles<T extends { timestamp: number }>(candles: T[]): T[] {
  return [...new Map(candles.map((candle) => [candle.timestamp, candle])).values()].sort((a, b) => a.timestamp - b.timestamp);
}
