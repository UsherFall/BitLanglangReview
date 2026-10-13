import type { Candlestick } from './candlestick';
import {
  COARSE_SCREEN_PCT_NET,
  COARSE_SCREEN_PCT_RANGE,
  COARSE_SCREEN_WINDOW_DAYS,
  type MarketDataSource,
  type ScanScope,
} from './scan-scope';
import type { ReviewTimeframe } from './trade';

export const scanTimeframes: ReviewTimeframe[] = ['5m', '15m', '1H', '4H', '1D'];

/**
 * The timeframe the coarse screen runs on. 1D is the only level where "盘得够久
 * (23 天)、收住了(区间窄)、不在趋势中(净漂移小)" spans a meaningful calendar
 * stretch — 4H was measured to be the SAME structure at a finer sampling density
 * (16/16 sample points identical to within 0.0pp) with a worse constant
 * stability, so the screen stays on 1D. It is also the level whose candles the
 * scan fetches FIRST and alone (see `coin-scan-service.ts`): everything else is
 * requested only for the instruments this screen keeps.
 */
export const COARSE_TIMEFRAME: ReviewTimeframe = '1D';

/**
 * Per-timeframe offset for the SINGLE 结构强度阈值 knob (the UI keeps exactly one
 * input, default 0.6). A contraction on a larger level is a rarer, more
 * meaningful event than one on a 5m chart, so it is measured against a slightly
 * lower bar instead of adding a second knob or a level term to the score.
 *
 * Effective threshold = `max(0, minScore + offset)`: at the default 0.6 the small
 * timeframes demand 0.60, 4H demands 0.55 and 1D only 0.50. With `minScore = 0`
 * (the SERVICE default — the UI always sends a value) every timeframe degenerates
 * to 0, so an absent knob behaves exactly as it did before the offsets existed.
 *
 * Only the 5 scanned timeframes (`scanTimeframes`) carry an entry: `ReviewTimeframe`
 * also spans 1m/1W/1M, which the scan never measures — a lookup miss reads as an
 * offset of 0, the same treatment the small timeframes get.
 */
export const TIMEFRAME_SCORE_OFFSET: Readonly<Partial<Record<ReviewTimeframe, number>>> = {
  '5m': 0,
  '15m': 0,
  '1H': 0,
  '4H': -0.05,
  '1D': -0.10,
};

/**
 * Effective `minScore` for one timeframe: the single knob shifted by the
 * level's offset, floored at 0 so a low knob can never produce a negative
 * threshold (which would qualify even a neutral `score` of 0).
 */
export function timeframeMinScore(timeframe: ReviewTimeframe, minScore: number): number {
  return Math.max(0, minScore + (TIMEFRAME_SCORE_OFFSET[timeframe] ?? 0));
}

/**
 * Knobs of the 1D coarse screen (池内相对分位). All three are CALIBRATION
 * constants — the window `T` plus the two percentile caps — and none of them is
 * an absolute price threshold: the `rangePct` / `|netPct|` cuts are recomputed
 * from the CURRENT pool on every scan (`coarseScreen`). That is the whole point
 * of the percentile form: a frozen absolute `W`/`D` pair decays as the market
 * moves (measured pool-rate drift 31.2pp over 15 anchors), the pool-relative cut
 * does not (4.7pp).
 */
export type CoarseParams = {
  /** Window length in 1D bars — the calibrated `T`. Absent → `COARSE_SCREEN_WINDOW_DAYS`. */
  windowDays?: number;
  /** Pool percentile cap for `rangePct` — the calibrated `qR`. Absent → `COARSE_SCREEN_PCT_RANGE`. */
  pctRange?: number;
  /** Pool percentile cap for `|netPct|` — the calibrated `qN`. Absent → `COARSE_SCREEN_PCT_NET`. */
  pctNet?: number;
};

/** The calibrated coarse-screen parameters (465-pool calibration, 10/13). */
export const DEFAULT_COARSE_PARAMS: Required<CoarseParams> = {
  windowDays: COARSE_SCREEN_WINDOW_DAYS,
  pctRange: COARSE_SCREEN_PCT_RANGE,
  pctNet: COARSE_SCREEN_PCT_NET,
};

/**
 * The two pool-relative measures the coarse screen judges, both over the last
 * `windowDays` 1D bars. They mirror the user's three words:
 * 盘得够久 = the window is long enough at all, 收住了 = a narrow `rangePct`,
 * 不在趋势中 = a small `|netPct|`. Both are FRACTIONS (0.459 = 45.9%), not
 * percents, matching the rest of the module's relative measures.
 */
export type CoarseMeasures = {
  /** `(max high − min low) / lastClose` over the window — 振幅口径(含影线). */
  rangePct: number;
  /** `|close_last − close_first| / close_first` over the window — 净漂移(方向无关). */
  netPct: number;
};

/**
 * The coarse screen's pool-relative cuts for ONE scan. `poolSize` is the number
 * of instruments the cuts were computed from — an instrument without a full
 * window is not measurable and is not part of the base (see `coarseStructure`).
 */
export type CoarseScreen = {
  /**
   * Ascending pool value at rank `floor(pctRange × poolSize)`. Indicative only:
   * the decision itself is rank-based (`rank ≤ floor(q × N)`, ties taking the
   * most conservative rank — the calibration's `pctRanks`), so at a tie that
   * straddles the cut a value equal to the threshold can still be rejected.
   * `-Infinity` when the cut is 0 (too small a pool), i.e. nothing passes.
   */
  rangePctThreshold: number;
  /** Same, for `|netPct|`. */
  netPctThreshold: number;
  /** Instruments with a full window — the percentile base `N`. */
  poolSize: number;
  /** The rank cut `floor(pctRange × N)`: a rank at or below it passes that gate. */
  rangePctRank: number;
  /** The rank cut `floor(pctNet × N)`. */
  netPctRank: number;
};

/** One scan's coarse screen: the cuts, plus the per-input verdict aligned to the input order. */
export type CoarseScreening = {
  screen: CoarseScreen;
  /** `passes[i]` decides whether `measures[i]` cleared BOTH gates; `null` never passes. */
  passes: boolean[];
};

/**
 * Measures one instrument's 1D window: `rangePct` and `|netPct|` over the newest
 * `windowDays` bars. Pure — no pool, no thresholds, no absolute judgement.
 *
 * Returns `null` when the window cannot be measured AT ALL: fewer than
 * `windowDays` bars (a 次新币 whose whole history is shorter than `T`), a
 * non-positive price, or a non-finite result. Such an instrument has no place in
 * the percentile BASE and can never pass the screen — the calibration treats it
 * the same way (`T > available bars` ⇒ excluded, which is the right direction
 * for a coin that has not been listed long enough to be 盘得够久).
 */
export function coarseStructure(candles: readonly Candlestick[], params: CoarseParams = {}): CoarseMeasures | null {
  const windowDays = params.windowDays ?? DEFAULT_COARSE_PARAMS.windowDays;
  const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);
  if (windowDays < 1 || sorted.length < windowDays) return null;
  const window = sorted.slice(sorted.length - windowDays);
  const firstClose = window[0].close;
  const lastClose = window[window.length - 1].close;
  if (!(firstClose > 0) || !(lastClose > 0)) return null;
  let high = -Infinity;
  let low = Infinity;
  for (const candle of window) {
    if (!(candle.low > 0)) return null;
    if (candle.high > high) high = candle.high;
    if (candle.low < low) low = candle.low;
  }
  const rangePct = (high - low) / lastClose;
  const netPct = Math.abs(lastClose - firstClose) / firstClose;
  if (!Number.isFinite(rangePct) || !Number.isFinite(netPct)) return null;
  return { rangePct, netPct };
}

/**
 * The 1D coarse screen: keep the instruments whose `rangePct` AND `|netPct|`
 * both sit in the CURRENT pool's lowest `qR` / `qN` fraction. The thresholds are
 * derived from `measures` on every call, which is what makes the pass rate
 * structurally stable instead of decaying with the market (see `CoarseParams`).
 *
 * The ranking is the calibration's: ascending in-pool rank 1..N, and a tie group
 * takes its MAXIMUM rank ("并列取最保守的秩"), so a pass needs `rank ≤ floor(q·N)`.
 * Only one half of the user's judgement lives here — the screen is deliberately
 * WIDE (≈44% of the 465 pool at the calibration point) and the precision is left
 * to the small-timeframe stage; it exists to shrink the candidate set without
 * dropping a label, not to be a good filter on its own.
 */
export function coarseScreen(
  measures: readonly (CoarseMeasures | null)[],
  params: CoarseParams = {},
): CoarseScreening {
  const pctRange = params.pctRange ?? DEFAULT_COARSE_PARAMS.pctRange;
  const pctNet = params.pctNet ?? DEFAULT_COARSE_PARAMS.pctNet;
  const present = measures.filter((measure): measure is CoarseMeasures => measure !== null);
  const poolSize = present.length;
  const rangeRanks = ascendingRanks(present.map((measure) => measure.rangePct));
  const netRanks = ascendingRanks(present.map((measure) => measure.netPct));
  const rangePctRank = Math.floor(pctRange * poolSize);
  const netPctRank = Math.floor(pctNet * poolSize);
  const passes: boolean[] = [];
  let presentIndex = 0;
  for (const measure of measures) {
    if (measure === null) {
      passes.push(false);
      continue;
    }
    passes.push(rangeRanks[presentIndex] <= rangePctRank && netRanks[presentIndex] <= netPctRank);
    presentIndex += 1;
  }
  return {
    screen: {
      rangePctThreshold: rankCutValue(present.map((measure) => measure.rangePct), rangePctRank),
      netPctThreshold: rankCutValue(present.map((measure) => measure.netPct), netPctRank),
      poolSize,
      rangePctRank,
      netPctRank,
    },
    passes,
  };
}

/**
 * Ascending in-pool ranks, 1-based, with a tie group sharing its MAXIMUM rank —
 * the most conservative reading, and the one the percentile calibration used
 * (`research/data/coarse-pct-*.csv`).
 */
function ascendingRanks(values: readonly number[]): number[] {
  const order = values.map((_, index) => index).sort((a, b) => values[a] - values[b]);
  const ranks = new Array<number>(values.length).fill(0);
  let start = 0;
  while (start < order.length) {
    let end = start;
    while (end + 1 < order.length && values[order[end + 1]] === values[order[start]]) end += 1;
    for (let index = start; index <= end; index += 1) ranks[order[index]] = end + 1;
    start = end + 1;
  }
  return ranks;
}

/** The ascending value at 1-based `rank`; `-Infinity` when the rank cut is 0. */
function rankCutValue(values: readonly number[], rank: number): number {
  if (rank < 1 || values.length === 0) return -Infinity;
  return [...values].sort((a, b) => a - b)[Math.min(rank, values.length) - 1];
}

/**
 * The only convergence structure kind: a volatility convergence (波动率越来越小).
 * The fractal triangle module (swing detection / backscan / classifyStructure)
 * was removed — the scan judges a coin purely by whether its recent band is
 * meaningfully quieter than the same-length stretch before it.
 */
export type ConvergenceStructure = 'convergence';

/**
 * One timeframe's convergence verdict. `structure === null` means that timeframe
 * has no convergence at all; the other fields are then meaningless and the
 * service fills them with neutral zeros.
 */
export type StructureResult = {
  /** Structure type; null = this timeframe has no convergence. */
  structure: ConvergenceStructure | null;
  /**
   * Position inside the band's CONFIRMED range, 0..1:
   * `(lastPrice - rangeLow) / (rangeHigh - rangeLow)`, where the range comes from
   * the band's first `runLen - CONVERGENCE_CONFIRMED_TAIL` bars (the same range
   * the containment gate tests against). Clamped, so a price that left the range
   * by less than the tolerance reads as 0 or 1.
   */
  position: number;
  /**
   * Shrink depth: `clamp01(1 - runMed/preMed)`, i.e. how much quieter the band is
   * than the same-length stretch before it. Larger = stronger. Sort key. This is
   * the ONLY scored quantity — duration is deliberately unscored, so `minScore`
   * reads directly as "the band's median amplitude must be at most
   * `(1 - minScore)` of the preceding stretch's" (e.g. 0.6 → at most 40%).
   */
  score: number;
  /** Touch count — always 0 now (no swing touches); kept for the row contract. */
  touchCount: number;
  /** True when the band passed all three gates: flatness, volatility shrink, containment. */
  qualified: boolean;
};

/**
 * Calibration knobs for `detectConvergence`, kept internal (not exposed in the
 * UI). No coin-own "typical volatility" baseline and no absolute thresholds —
 * every measure is relative to the same-length segment before the band.
 */
export type StructureParams = {
  /**
   * Minimum band length (in K bars). A band needs enough bars to be a real
   * 蓄力 phase, not a 2-bar blip. Absent → `DEFAULT_CONVERGENCE_MIN_RUN`.
   */
  minRun?: number;
  /**
   * Volatility-shrink gate: a band qualifies as a convergence only when its own
   * median per-bar volatility is < this × the median volatility of the SAME-LENGTH
   * segment immediately before it — the price is meaningfully quieter than it was.
   * Internal spikes are absorbed by the median. Absent → `DEFAULT_CONVERGENCE_RATIO`.
   */
  convergenceRatio?: number;
  /**
   * Flatness tolerance for the band, scaled by the band's own median bar
   * volatility (runMed): an edge (low or high regression) counts as flat when its
   * total drift is <= this × runMed. A rising/falling trend (whose relative
   * amplitude naturally shrinks as price rises) is NOT a 安静带 and must be
   * rejected; scaling by the band's own noise keeps the tolerance relative, not
   * absolute. Absent → `DEFAULT_CONVERGENCE_FLAT_RATIO`.
   */
  flatRatio?: number;
};

/**
 * Minimal scan parameters (extreme UI panel: no swing/touch/slope knobs). The
 * structure thresholds live in `StructureParams` (file-top defaults, calibrated
 * on real data); only the output-strength knob is exposed.
 */
export type ShrinkScanParams = {
  method: 'shrink';
  /**
   * Sub-module of 选品 to scan: `crypto` (crypto + indices + commodities, always
   * open) or `equity` (US + Korean equities, session-gated). Absent → `crypto`,
   * which keeps every pre-09/16 caller unchanged.
   */
  scope?: ScanScope;
  /**
   * Market-data source the scan ran against. ECHOED ONLY — the route resolves
   * and validates it (`isMarketDataSource`, absent/illegal → the server's
   * default source) and picks the matching ticker/candle/gate trio; the service
   * itself is source-agnostic. It rides along in `params` so the UI can label a
   * result with the venue it came from (and so results from different sources
   * are not silently compared).
   */
  source?: MarketDataSource;
  /**
   * Pool CAP (上限保护). Absent = the whole open pool of the scope — the default
   * since 10/13, because the approved labels reach 24h-volume rank #319 and a
   * top-N gate hid them entirely (see `scan-scope.ts`). A number still caps the
   * pool, which is what the panel's 扫描数量 box sends when it is filled in.
   */
  topN?: number;
  minQuoteVolume24h: number;
  /** Scan anchor (epoch ms): bars whose close time <= anchor are treated as completed. Absent → now. */
  anchor?: number;
  /**
   * 结构强度阈值主旋钮;调高 = 宁少勿滥. A timeframe counts as converged only when
   * its `score` (the shrink depth) is >= its own effective threshold
   * (`timeframeMinScore`, i.e. this knob plus `TIMEFRAME_SCORE_OFFSET`). Because
   * duration is unscored, the threshold is a direct statement about amplitude:
   * 0.6 = the band's median per-bar amplitude is at most 40% of the preceding
   * stretch's (50% on 1D, whose offset is -0.10).
   */
  minScore?: number;
};

/**
 * One row's share of the coarse screen. Row inclusion IS this screen, so `pass`
 * is always true on a row that reached the response — it is echoed (together
 * with the measures and this scan's cuts) so a row can be read on its own and so
 * the panel can show WHY it is in the list.
 */
export type CoarseRow = {
  pass: boolean;
  rangePct: number;
  netPct: number;
  /** The cuts RECOMPUTED from this scan's own pool — identical on every row of one scan. */
  rangePctThreshold: number;
  netPctThreshold: number;
};

/**
 * One scanned coin. A row exists when the coin passed the 1D coarse screen
 * (池内分位, see `coarseScreen`) — that is the row criterion since 10/13; the
 * per-timeframe convergence columns are reported for the survivors but no longer
 * decide inclusion (a coarse-passing coin with no convergence anywhere still
 * appears, with `convergedTimeframes` empty).
 */
export type ScanRow = {
  instrument: string;
  lastPrice: number;
  change24h: number;
  quoteVolume24h: number;
  /** Per-timeframe structure verdicts, keyed by ReviewTimeframe (scanTimeframes order). */
  structures: Record<ReviewTimeframe, StructureResult>;
  /**
   * Timeframes whose structure is qualified AND whose `score` reaches that
   * level's effective threshold (`timeframeMinScore`); the 收敛结构 column.
   * Ascending `scanTimeframes` order, so the strongest level is the last entry.
   * EMPTY when a coarse-passing coin converges nowhere.
   */
  convergedTimeframes: ReviewTimeframe[];
  /** = `convergedTimeframes.length` (0 for a coarse-passing coin that converges nowhere). */
  qualifiedCount: number;
  /**
   * Strongest score across the converged timeframes, or 0 when there are none
   * (only the converged entries can carry a score).
   */
  bestScore: number;
  /** Always true (scanned rows only include coins that passed the coarse screen). */
  qualified: boolean;
  /**
   * The 1D coarse screen's verdict and measures. Always set by the service;
   * optional so a pre-10/13 payload still type-checks.
   */
  coarse?: CoarseRow;
};

/** Response-level echo of the coarse screen: what ran, on how big a pool, with which cuts. */
export type CoarseSummary = {
  /** The window `T` (1D bars) the measures were taken over. */
  windowDays: number;
  pctRange: number;
  pctNet: number;
  /** Instruments that HAD a full window (the percentile base `N`; short histories excluded). */
  poolSize: number;
  /** The cuts derived from that pool for this scan — never constants. */
  rangePctThreshold: number;
  netPctThreshold: number;
  /** The candidate pool the screen ran on (= the open pool, capped by `topN` when given). */
  candidates: number;
};

export type ScanResponse = {
  scanned: ScanRow[];
  qualifiedCount: number;
  params: ShrinkScanParams;
  scannedAt: string;
  /** The 1D coarse screen's parameters, base and cuts (see `CoarseSummary`). */
  coarse?: CoarseSummary;
  /**
   * Rate-limit warnings raised DURING this scan (Binance HTTP 429 backoffs).
   * The scan still succeeded, but the pipeline had to pause for the IP's weight
   * window to cool down. Present only when at least one backoff occurred.
   */
  warnings?: string[];
  /**
   * Instruments excluded because their underlying market was closed at the scan
   * anchor (filtered after the 24h-volume gate, so a closed market never costs a
   * candle request). Present only when at least one was skipped. Classes outside
   * the scan pool (see `scan-pool.ts`) are NOT listed: they are a pool
   * definition, not a per-scan omission.
   */
  skippedInstruments?: string[];
  /**
   * True when the ticker snapshot carried no instrument classes at all, so
   * session gating was effectively OFF for this scan. Present only when that
   * happened — it is the one failure mode that silently lets closed-market
   * contracts back into the results.
   */
  metadataUnavailable?: boolean;
};

/** Minimum band length (in K bars) for a volatility convergence. */
export const DEFAULT_CONVERGENCE_MIN_RUN = 5;
/**
 * Volatility-shrink gate: a band qualifies as a convergence only when its own
 * median per-bar volatility is < this × the median volatility of the SAME-LENGTH
 * segment immediately before it — "波动率越来越小". 0.9 admits mild but real
 * shrinks (e.g. a band at 84% of its preceding stretch); the score then ranks
 * the shrink depth honestly. A band at ~1.0× (no shrink) is rejected.
 */
export const DEFAULT_CONVERGENCE_RATIO = 0.9;
/**
 * Flatness tolerance for a convergence band, scaled by the band's own median
 * bar volatility: an edge counts as flat when its total drift is <= this × runMed.
 * 2.0 = the band's low/high edges may drift at most two typical bars across its
 * span before it reads as a trend rather than a quiet flat band.
 */
export const DEFAULT_CONVERGENCE_FLAT_RATIO = 2.0;
/**
 * Bars at the tail of a band that are EXCLUDED from the band's "confirmed
 * range" — the range the containment gate tests the newest bar against.
 *
 * This is a structural rule, not a calibration knob: a range built from bars
 * that include the bar being tested is vacuously satisfied, because a real
 * candle's close always lies inside its own `[low, high]`. Leaving the tail out
 * is what lets the gate detect that the newest bar has actually left the range
 * the band was built at. `1` = test the newest bar against the range formed by
 * the `runLen - 1` bars before it.
 */
export const CONVERGENCE_CONFIRMED_TAIL = 1;

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** Median of an array; 0 for an empty array. Robust to spikes. */
function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Total drift of a price series across a segment: the absolute slope of the OLS
 * regression (x = bar index) times the segment span, normalized by the mean
 * price. Relative (not absolute), so one tolerance works across coins and
 * timeframes. Used by the band's flatness gate.
 */
function edgeDrift(prices: readonly number[], startIndex: number): number {
  const n = prices.length;
  if (n < 2) return 0;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i += 1) {
    const x = startIndex + i;
    sumX += x;
    sumY += prices[i];
    sumXY += x * prices[i];
    sumXX += x * x;
  }
  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) return 0;
  const slope = (n * sumXY - sumX * sumY) / denominator;
  const meanPrice = sumY / n;
  if (meanPrice === 0) return 0;
  return (Math.abs(slope) * (n - 1)) / meanPrice;
}

/**
 * Volatility convergence (波动率越来越小) detection. Walks the RAW BARS looking for
 * a recent band whose bar-to-bar volatility is meaningfully below the same-length
 * segment immediately before it. Every measure is RELATIVE — there is no
 * coin-own "typical volatility" baseline and no absolute threshold, because each
 * coin's volatility differs (BTC ~0.15% per 5m bar vs a small cap ~5%).
 *
 * Sliding scan over every possible band start (the band always ends at the last
 * bar); a band must pass:
 * - **Volatility shrink**: the band's median per-bar volatility `runMed` is
 *   `< convergenceRatio × preMed`, where `preMed` is the median volatility of the
 *   SAME-LENGTH segment immediately before the band — the price is meaningfully
 *   quieter than it was. Internal spikes are absorbed by the median.
 * - **Flatness** (see `flatRatio`): both the band's low and high edges must be
 *   roughly horizontal. A trend shrinks its own relative amplitude as price
 *   climbs, which would otherwise fake a "volatility shrink". This gate is
 *   independent of containment: it asks whether the band is SLOPED.
 * - **Containment**: the newest bar's close must still be inside the range the
 *   band was CONFIRMED at — that range is built from the band's first
 *   `runLen - CONVERGENCE_CONFIRMED_TAIL` bars, deliberately EXCLUDING the newest
 *   bar, so an actual breakout (up or down) moves the price outside it and
 *   rejects the band: a price that has left the range is no longer 蓄力. This
 *   cannot be tested against the full band's `[min low, max high]`, because the
 *   newest bar is always a member of that range and the check would be vacuously
 *   true. Together with flatness it separates "the band is sloped" from "the
 *   price left the band".
 *
 * The best band is scored by its **shrink depth alone**: `score = relativeCalm`
 * (`1 - runMed/preMed`). Duration deliberately does NOT enter the score. A
 * length bonus was removed on 09/20: it was `clamp01(runLen / lengthScale)`,
 * which saturates at `lengthScale`, so it could never rank two long bands
 * against each other — its only observable effect was to push SHORT bands down,
 * i.e. to penalise exactly the early-stage convergences the scan is meant to
 * surface. `minRun` is therefore load-bearing now: the best band tends to be
 * short, which is accepted (user decision — what a convergence is worth is
 * decided by WHERE it happens, not how long it lasted).
 *
 * Known consequence: a crash-then-pause band (a big dump followed by a calm
 * stretch) IS detected as a strong shrink, because its band is far quieter than
 * the dump that preceded it. Whether that deserves exclusion is a calibration
 * decision left open (see task notes) — the real-scan output marks these for the
 * user to judge.
 */
export function detectConvergence(candles: readonly Candlestick[], params: StructureParams): StructureResult | null {
  const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);
  const minRun = params.minRun ?? DEFAULT_CONVERGENCE_MIN_RUN;
  if (sorted.length < minRun * 2) return null; // need room for a band + its preceding stretch
  if (sorted.some((candle) => candle.low <= 0)) return null;

  const vol = sorted.map((candle) => (candle.high - candle.low) / candle.low);
  const convergenceRatio = params.convergenceRatio ?? DEFAULT_CONVERGENCE_RATIO;
  const flatRatio = params.flatRatio ?? DEFAULT_CONVERGENCE_FLAT_RATIO;
  const last = sorted.length - 1;
  const lastPrice = sorted[last].close;

  let best: { score: number; runLen: number; rangeLow: number; rangeHigh: number } | null = null;
  for (let start = last - minRun + 1; start >= 0; start -= 1) {
    const runLen = last - start + 1;
    const preStart = start - runLen;
    if (preStart < 0) continue; // not enough preceding bars for this band length
    const band = sorted.slice(start, last + 1);
    const runMed = median(vol.slice(start, last + 1));
    // ---- flatness: the band is a quiet horizontal band, not a trend. A rising
    // trend's relative amplitude shrinks as price climbs, which would otherwise
    // fake a "volatility shrink"; the tolerance is scaled by the band's own
    // noise (runMed) so it stays relative, never absolute. ----
    const flatTol = flatRatio * runMed;
    if (Math.max(edgeDrift(band.map((c) => c.low), start), edgeDrift(band.map((c) => c.high), start)) > flatTol) continue;
    const preMed = median(vol.slice(preStart, start));
    // ---- volatility shrink: band quieter than the same-length stretch before ----
    if (runMed >= convergenceRatio * preMed) continue;
    // ---- containment: the newest bar must still sit inside the range the band
    // was CONFIRMED at. That range comes from the band's first `runLen -
    // CONVERGENCE_CONFIRMED_TAIL` bars — i.e. WITHOUT the newest bar, which is
    // the bar being tested. Including it would make this gate vacuous (a real
    // candle's close always lies inside its own [low, high]), and the whole
    // breakout protection would silently fall through to the flatness gate.
    // The 10% tolerance is relative to the confirmed range's own height, so it
    // scales with the band instead of imposing an absolute distance. Both the
    // gate and `position` read this single range.
    // ----
    const confirmed = band.slice(0, band.length - CONVERGENCE_CONFIRMED_TAIL);
    const rangeLow = Math.min(...confirmed.map((c) => c.low));
    const rangeHigh = Math.max(...confirmed.map((c) => c.high));
    const tolerance = 0.1 * (rangeHigh - rangeLow);
    if (lastPrice < rangeLow - tolerance || lastPrice > rangeHigh + tolerance) continue;
    // ---- score: the shrink depth, and nothing else. Duration is deliberately
    // NOT scored (see the doc comment): it cannot rank long bands against each
    // other anyway, and scoring it only penalises short/early bands. ----
    const relativeCalm = clamp01(1 - runMed / preMed);
    const score = relativeCalm;
    if (best === null || score > best.score) {
      best = { score, runLen, rangeLow, rangeHigh };
    }
  }
  if (best === null) return null;
  const rangeHeight = best.rangeHigh - best.rangeLow;
  const position = clamp01(rangeHeight > 0 ? (lastPrice - best.rangeLow) / rangeHeight : 0.5);
  return { structure: 'convergence', position, score: best.score, touchCount: 0, qualified: true };
}

/**
 * Combination entry point. With the triangle module removed this simply forwards
 * to `detectConvergence`; the name is kept so the service and callers have one
 * stable probe API.
 */
export function probeStructure(candles: readonly Candlestick[], params: StructureParams): StructureResult | null {
  return detectConvergence(candles, params);
}

/**
 * Builds a `StructureParams` from the file-top default constants, so callers (the
 * service, tests) don't repeat the calibration values.
 */
export function defaultStructureParams(overrides?: Partial<StructureParams>): StructureParams {
  return {
    minRun: DEFAULT_CONVERGENCE_MIN_RUN,
    convergenceRatio: DEFAULT_CONVERGENCE_RATIO,
    flatRatio: DEFAULT_CONVERGENCE_FLAT_RATIO,
    ...overrides,
  };
}
