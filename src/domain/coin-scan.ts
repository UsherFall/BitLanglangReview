import type { Candlestick } from './candlestick';
import type { LevelAlert } from './level-alert';
import {
  COARSE_POS_RANGE_FLOOR,
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
 * Knobs of the 1D coarse screen (池内相对分位). `windowDays` / `pctRange` /
 * `pctNet` are CALIBRATION constants — the window `T` plus the two percentile
 * caps — and none of them is an absolute price threshold: the `rangePct` /
 * `|netPct|` cuts are recomputed from the CURRENT pool on every scan
 * (`coarseScreen`). That is the whole point of the percentile form: a frozen
 * absolute `W`/`D` pair decays as the market moves (measured pool-rate drift
 * 31.2pp over 15 anchors), the pool-relative cut does not (4.7pp).
 *
 * `posRangeFloor` is the one ABSOLUTE gate in the same pass condition: it is NOT
 * derived from the pool, so it cannot decay and cannot be gamed by the pool's
 * composition — it only says "not hugging the absolute bottom".
 */
export type CoarseParams = {
  /** Window length in 1D bars — the calibrated `T`. Absent → `COARSE_SCREEN_WINDOW_DAYS`. */
  windowDays?: number;
  /** Pool percentile cap for `rangePct` — the calibrated `qR`. Absent → `COARSE_SCREEN_PCT_RANGE`. */
  pctRange?: number;
  /** Pool percentile cap for `|netPct|` — the calibrated `qN`. Absent → `COARSE_SCREEN_PCT_NET`. */
  pctNet?: number;
  /**
   * Absolute floor for `posRange` (not a percentile). Absent → `COARSE_POS_RANGE_FLOOR`.
   * A value `<= 0` makes the gate vacuous, which is how a caller reads the screen
   * as it behaved before the patch.
   */
  posRangeFloor?: number;
};

/** The calibrated coarse-screen parameters (465-pool calibration, 10/13). */
export const DEFAULT_COARSE_PARAMS: Required<CoarseParams> = {
  windowDays: COARSE_SCREEN_WINDOW_DAYS,
  pctRange: COARSE_SCREEN_PCT_RANGE,
  pctNet: COARSE_SCREEN_PCT_NET,
  posRangeFloor: COARSE_POS_RANGE_FLOOR,
};

/**
 * The three measures the coarse screen judges. `rangePct` / `netPct` cover the
 * last `windowDays` 1D bars and mirror the user's three words: 盘得够久 = the
 * window is long enough at all, 收住了 = a narrow `rangePct`, 不在趋势中 = a
 * small `|netPct|`. `posRange` covers the WHOLE available series instead — it is
 * about where the coin sits inside everything it has printed, not inside the
 * 23-day box. All three are FRACTIONS (0.459 = 45.9%), not percents, matching the
 * rest of the module's relative measures.
 */
export type CoarseMeasures = {
  /** `(max high − min low) / lastClose` over the window — 振幅口径(含影线). */
  rangePct: number;
  /** `|close_last − close_first| / close_first` over the window — 净漂移(方向无关). */
  netPct: number;
  /**
   * `(lastClose − series min low) / (series max high − series min low)` over ALL
   * provided 1D bars — 位置(0 = 趴在序列绝对底部, 1 = 序列最高). `0.5` for a
   * zero-height series (see `coarseStructure`).
   */
  posRange: number;
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
 * Measures one instrument's 1D series: `rangePct` / `|netPct|` over the newest
 * `windowDays` bars, plus `posRange` over ALL provided bars. Pure — no pool, no
 * thresholds, no absolute judgement.
 *
 * The two windows are deliberately different: the box measures describe the
 * 23-day 盤整, while `posRange` asks where the coin sits inside everything it has
 * printed (≤ 90 bars, see `market-data.md`) — "趴在绝对底部" is a statement about
 * the whole visible history, and evaluating it on the 23-day window would call
 * every quiet box "mid-range" by construction.
 *
 * A zero-height series (`maxHigh === minLow`, every bar printing the same
 * `[low, high]`) has no vertical extent, so "position inside it" is undefined:
 * `posRange` reads as **0.5** — a PASSING value on purpose, because the flattest
 * possible box is not a bottom-hugger (returning 0 would silently exclude it
 * through the floor).
 *
 * Returns `null` when the window cannot be measured AT ALL: fewer than
 * `windowDays` bars (a 次新币 whose whole history is shorter than `T`), a
 * non-positive price ANYWHERE in the series (it would poison `posRange`), or a
 * non-finite result. Such an instrument has no place in the percentile BASE and
 * can never pass the screen — the calibration treats it the same way
 * (`T > available bars` ⇒ excluded, which is the right direction for a coin that
 * has not been listed long enough to be 盘得够久).
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
  // Position: the WHOLE provided series, not the window (see the doc comment).
  // The positivity guard therefore covers the bars OLDER than the window too —
  // a non-positive price there would poison `posRange`.
  let seriesHigh = -Infinity;
  let seriesLow = Infinity;
  for (const candle of sorted) {
    if (!(candle.low > 0)) return null;
    if (candle.high > seriesHigh) seriesHigh = candle.high;
    if (candle.low < seriesLow) seriesLow = candle.low;
  }
  const rangePct = (high - low) / lastClose;
  const netPct = Math.abs(lastClose - firstClose) / firstClose;
  const posRange = seriesHigh > seriesLow ? (lastClose - seriesLow) / (seriesHigh - seriesLow) : 0.5;
  if (!Number.isFinite(rangePct) || !Number.isFinite(netPct) || !Number.isFinite(posRange)) return null;
  return { rangePct, netPct, posRange };
}

/**
 * The 1D coarse screen. Keep the instruments that clear all THREE gates:
 *
 * 1. `rangePct` and 2. `|netPct|` sit in the CURRENT pool's lowest `qR` / `qN`
 *    fraction. Those two cuts are derived from `measures` on every call, which is
 *    what makes the pass rate structurally stable instead of decaying with the
 *    market (see `CoarseParams`).
 * 3. `posRange >= posRangeFloor` — an ABSOLUTE, pool-independent rail that only
 *    drops instruments still sitting on their series' absolute bottom (10/13;
 *    see `COARSE_POS_RANGE_FLOOR`). It is a precision patch, not a screen.
 *
 * The ranking is the calibration's: ascending in-pool rank 1..N, and a tie group
 * takes its MAXIMUM rank ("并列取最保守的秩"), so a pass needs `rank ≤ floor(q·N)`.
 * Only one half of the user's judgement lives here — the screen is deliberately
 * WIDE (≈44% of the 465 pool at the calibration point, ≈43% with the position
 * floor) and the precision is left to the small-timeframe stage; it exists to
 * shrink the candidate set without dropping a label, not to be a good filter on
 * its own.
 */
export function coarseScreen(
  measures: readonly (CoarseMeasures | null)[],
  params: CoarseParams = {},
): CoarseScreening {
  const pctRange = params.pctRange ?? DEFAULT_COARSE_PARAMS.pctRange;
  const pctNet = params.pctNet ?? DEFAULT_COARSE_PARAMS.pctNet;
  const posRangeFloor = params.posRangeFloor ?? DEFAULT_COARSE_PARAMS.posRangeFloor;
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
    passes.push(
      rangeRanks[presentIndex] <= rangePctRank &&
        netRanks[presentIndex] <= netPctRank &&
        measure.posRange >= posRangeFloor,
    );
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
 * Minimal scan parameters (extreme UI panel: no swing/touch/slope knobs).
 * 10/20: the 结构强度阈值 knob was removed with the convergence detector — the
 * 距线 alert has no strength threshold; it reports a distance and a state.
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
  /** Position inside the WHOLE 1D series (0 = absolute bottom); see `CoarseMeasures.posRange`. */
  posRange: number;
  /** The cuts RECOMPUTED from this scan's own pool — identical on every row of one scan. */
  rangePctThreshold: number;
  netPctThreshold: number;
};

/**
 * One scanned coin. A row exists when the coin passed the 1D coarse screen
 * (池内分位, see `coarseScreen`) — that is the row criterion since 10/13.
 *
 * 10/20: the per-timeframe CONVERGENCE columns were replaced by 距线 (distance to
 * the user's own drawn levels). The automatic convergence detector was deleted —
 * nine attempts at it had all failed and the user ruled that "收敛算法实现不了"
 * (see 10-19-fakeout-retest-quality/research/HANDOFF.md §3.1). The user draws the
 * lines; the scan only measures how far the price is from them.
 */
export type ScanRow = {
  instrument: string;
  lastPrice: number;
  change24h: number;
  quoteVolume24h: number;
  /**
   * 距线, per timeframe (scanTimeframes order).
   * `null` for a timeframe with no drawn line (or no candles to measure against).
   * 10/21 起该读数同时出现在「主升浪候选」(shrink) 的行内和「标线监控」(watch)
   * 的行里 —— 两边共用同一条测量代码路径。
   */
  levelAlerts: Record<ReviewTimeframe, LevelAlert | null>;
  /**
   * The timeframes whose price is within half a scale of a drawn line — the
   * 「该看了」 column. Ascending `scanTimeframes` order.
   */
  alertTimeframes: ReviewTimeframe[];
  /**
   * The scan-board hand-drawn lines behind this row (10/26): how many, and on
   * which timeframes. This is the 距线 column's provenance — the 「已画」 badge
   * reads it, so it is filled from the drawn-line set itself, INDEPENDENT of
   * measurement success: a marked row whose alerts are all `null` (closed
   * market) still reports its lines, which is what tells "drawn but currently
   * unmeasurable" apart from "never marked".
   */
  drawnLineCount: number;
  drawnTimeframes: ReviewTimeframe[];
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
  /** = `scanned.length`（本次扫描放行的行数）。与收敛无关，10/20 后语义未变。 */
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
   * Instruments DROPPED because fetching their candles failed (timeout, network
   * error, or an exchange business error). A single failed fetch is isolated to
   * its own instrument instead of failing the whole scan: stage 1 (1D) failures
   * lose the coarse measure like a short history, and a stage-2 failure drops
   * the row outright. Present only when at least one instrument failed.
   *
   * A third, separate channel from the two above: `warnings` reports rate-limit
   * backoffs, `skippedInstruments` reports closed markets, and this reports
   * data-fetch failures. Never folded together — each leads to a different
   * user reaction (wait / re-scan later / look at the instrument).
   */
  failedInstruments?: string[];
  /**
   * True when the ticker snapshot carried no instrument classes at all, so
   * session gating was effectively OFF for this scan. Present only when that
   * happened — it is the one failure mode that silently lets closed-market
   * contracts back into the results.
   */
  metadataUnavailable?: boolean;
  /**
   * Why a drawn level could not be carried into the scan source's price basis
   * (10/21). A level is drawn on ONE venue's chart and measured on ANOTHER's
   * candles, so the two price bases have to be reconciled (see
   * `levelScaleFactor`). When that fails the level is still measured, but
   * unscaled — which is why the reason is reported instead of swallowed.
   * Present only when at least one level degraded.
   */
  levelScaleNotes?: string[];
};

/**
 * 标线监控 (`method=watch`) 的参数。刻意最小：监控的行集合是「你画了线的币」，
 * 不是候选池 —— 没有品种、成交额下限或数量上限可配。10/21 与「主升浪候选」
 * (shrink) 一起成为选品的两步：粗筛扫候选(shrink) → 你标线 → 持续跟进(watch)。
 */
export type LevelWatchParams = {
  method: 'watch';
  /** 回显用 —— 路由解析并校验它，与 shrink 扫描同一套规则。 */
  source?: MarketDataSource;
  /** 监控锚点 (epoch ms)：缺省 → 现在（K 线刷新）；给定 → 回放该时刻的距线状态。 */
  anchor?: number;
};

/**
 * `method=watch` 的响应：每个被用户画了线的币一行 —— 行入选标准与 shrink 扫描
 * 相反。shrink 的行是「1D 粗筛存活的币」（距线是行内读数），watch 的行是
 * 「drawing-store 里有线的币」（canonical 匹配、跨周期并集），**不经过粗筛**：
 * 画了线但已不满足盘整口径的币照样出现 —— 监控对象不随行情口径漂移丢失。
 *
 * 距线数值与 shrink 扫描共用同一条代码路径（`coin-scan-service.ts` 的
 * `measureLevelAlert`），所以同一时刻两边必然一致。
 */
export type LevelWatchResponse = {
  /** 画了线且当前行情源解析得到的币，按「离线最近」排序（与 shrink 同一键）。 */
  scanned: ScanRow[];
  params: LevelWatchParams;
  scannedAt: string;
  /** 限频退避（Binance 429），与 shrink 同义。 */
  warnings?: string[];
  /** 取数失败的币 —— 与 shrink 的 stage-2 同规则：该行删除而非半测量。 */
  failedInstruments?: string[];
  /** 线无法换算到本行情源价位的退化说明（10/21，与 shrink 同义）。 */
  levelScaleNotes?: string[];
  /**
   * 画了线但当前行情源解析不到的币（canonical 名在 ticker 列表里没有对应）。
   * 与 failedInstruments 是两个通道：一个叫你「换源看」，一个叫你「看这只币」。
   */
  missingInstruments?: string[];
};

