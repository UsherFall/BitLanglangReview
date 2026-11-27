import { mergeCandles, timeframeMs, type Candlestick, type ChartCandleSource } from '../domain/candlestick';
import { reviewTimeframes, type ReviewTimeframe } from '../domain/trade';
import { fetchCandles } from './candle-fetch';
import { isTimeframeBoundary, type CandleGrid } from './chart-time';
import { processRevealedCandle, type PaperTradingSession } from './free-replay-paper-trading';

export type ExecutionCandleLoader = (params: URLSearchParams) => Promise<Candlestick[]>;

export type PartialExecutionInput = {
  previousProgressTime: number;
  nextProgressTime: number;
  timeframe: ReviewTimeframe;
  grid: CandleGrid;
};

export type LoadPartialExecutionInput = PartialExecutionInput & {
  instrument: string;
  source: ChartCandleSource;
};

/** Only these existing orders can change Paper state during a reveal. */
export function hasAutomaticOrders(session: PaperTradingSession): boolean {
  return session.active && Boolean(
    session.pendingEntry
    || session.pendingExit
    || session.position?.legs.some((leg) => leg.stopPrice !== undefined),
  );
}

/** A coarse candle that opens before the previous progress contains old OHLC. */
export function needsPartialExecution(candle: Candlestick, previousProgressTime: number): boolean {
  return Number.isFinite(previousProgressTime) && candle.timestamp < previousProgressTime * 1000;
}

/**
 * Use the coarsest child grid that aligns BOTH ends of the new time segment.
 * A natural month cannot be tiled by weekly bars, so 1W is excluded for 1M.
 */
export function partialExecutionTimeframe(input: PartialExecutionInput): ReviewTimeframe {
  const fromMs = input.previousProgressTime * 1000;
  const toMs = input.nextProgressTime * 1000;
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
    throw new Error('细周期成交区间无效');
  }
  const candidates = reviewTimeframes
    .filter((item) => timeframeMs(item) < timeframeMs(input.timeframe))
    .filter((item) => input.timeframe !== '1M' || item !== '1W')
    .reverse();
  const match = candidates.find((item) => (
    isTimeframeBoundary(fromMs, item, input.grid)
    && isTimeframeBoundary(toMs, item, input.grid)
    && (toMs - fromMs) % timeframeMs(item) === 0
  ));
  if (!match) throw new Error('无法选择对齐的细周期成交数据');
  return match;
}

/**
 * Loads only the newly advanced portion of a transitional coarse candle.
 * No caller may fall back to the coarse OHLC when this function rejects.
 */
export async function loadPartialExecutionCandles(
  input: LoadPartialExecutionInput,
  loader: ExecutionCandleLoader = fetchCandles,
): Promise<Candlestick[]> {
  const childTimeframe = partialExecutionTimeframe(input);
  const fromMs = input.previousProgressTime * 1000;
  const toMs = input.nextProgressTime * 1000;
  const step = timeframeMs(childTimeframe);
  const expectedCount = (toMs - fromMs) / step;
  let candles: Candlestick[] = [];
  let mode: 'initial' | 'later' = 'initial';
  let anchor = fromMs;

  // The theoretical bar count is a runaway bound, not an arbitrary data cap.
  // A healthy initial+later walk finishes much sooner; no-forward-progress
  // below stops a malformed response immediately.
  const maxPages = expectedCount + 2;
  for (let page = 0; page < maxPages; page += 1) {
    const params = new URLSearchParams({
      instrument: input.instrument,
      source: input.source,
      timeframe: childTimeframe,
      mode,
      anchor: String(anchor),
      entryTime: new Date(anchor).toISOString(),
    });
    const loaded = await loader(params);
    candles = mergeCandles([...candles, ...loaded]);

    const exact = exactExecutionSegment(candles, fromMs, toMs, childTimeframe);
    if (exact) return exact;

    const relevant = candles.filter((candle) => candle.timestamp >= fromMs && candle.timestamp < toMs);
    const latest = relevant.at(-1)?.timestamp;
    if (latest === undefined || (mode === 'later' && latest <= anchor)) {
      throw incompleteExecutionData(childTimeframe, fromMs, toMs);
    }
    mode = 'later';
    anchor = latest;
  }
  throw incompleteExecutionData(childTimeframe, fromMs, toMs);
}

/** Runs the existing order state machine in child-candle close-time order. */
export function processExecutionCandles(session: PaperTradingSession, candles: Candlestick[]): PaperTradingSession {
  if (!candles.length) return session;
  const timeframe = candles[0]!.timeframe;
  const step = timeframeMs(timeframe);
  let previousTimestamp: number | null = null;
  let next = session;
  for (const candle of candles) {
    if (candle.timeframe !== timeframe) throw new Error('执行细K线周期不一致');
    if (previousTimestamp !== null && candle.timestamp !== previousTimestamp + step) {
      throw new Error('执行细K线时间不连续');
    }
    next = processRevealedCandle(next, candle, (candle.timestamp + step) / 1000);
    previousTimestamp = candle.timestamp;
  }
  return next;
}

function exactExecutionSegment(
  candles: Candlestick[],
  fromMs: number,
  toMs: number,
  timeframe: ReviewTimeframe,
): Candlestick[] | null {
  const step = timeframeMs(timeframe);
  const byTimestamp = new Map(candles.map((candle) => [candle.timestamp, candle]));
  const exact: Candlestick[] = [];
  for (let timestamp = fromMs; timestamp < toMs; timestamp += step) {
    const candle = byTimestamp.get(timestamp);
    if (!candle || candle.timeframe !== timeframe) return null;
    exact.push(candle);
  }
  return exact;
}

function incompleteExecutionData(timeframe: ReviewTimeframe, fromMs: number, toMs: number): Error {
  return new Error(`细周期成交数据不完整（${timeframe} ${new Date(fromMs).toISOString()} → ${new Date(toMs).toISOString()}）`);
}
