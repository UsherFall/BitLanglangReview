import type { Candlestick } from './candlestick';
import type { ChartDrawing } from './drawing';

/**
 * 「距你标的线」—— 选品模块用它替换掉原来的「扫收敛」。
 *
 * 为什么是这个（而不是自动认收敛）：
 *   上一轮 9 条「自动认收敛/横盘/结构」的方案全部失败
 *   （见 10-19-fakeout-retest-quality/research/HANDOFF.md §3.1），
 *   用户明确说「收敛这个前面的任务做过太多轮了，结论是算法就是实现不了我想要的效果」。
 *   所以：线永远由用户标，算法只做两件机械的事 —— 算距离、拿该币自己的波动当尺子。
 *
 * 尺子为什么不能写死百分比：
 *   BTC 的日内振幅中位约 2.4%，山寨币 5%~8%。同一个 1.5%，
 *   对 BTC 来说还很远，对山寨币已经很近。写死会把 BTC 误报。
 */

/** 距线的三档状态。 */
export type LevelAlertState = 'alert' | 'watch' | 'far';

/** 报警阈值：距线 ≤ 0.5 × 尺子。 */
export const LEVEL_ALERT_RATIO = 0.5;
/** 观察阈值：距线 ≤ 1.0 × 尺子。 */
export const LEVEL_WATCH_RATIO = 1;

/**
 * 一条线在某时刻的价格。
 * 水平线恒为 `price`；射线按两点插值到 `at`。
 *
 * 端点用 `{ time, price }`。产品的 `ChartDrawing.points` 用的就是 `time`，
 * 而研究阶段的标注文件用的是 `t` —— 两种都接受，免得换个来源就静默算出 NaN。
 */
export type LevelLine = {
  kind: 'horizontal' | 'ray';
  price: number;
  /** 射线的两个端点（毫秒时间戳）。水平线忽略。 */
  p1?: { time: number; price: number } | { t: number; price: number };
  p2?: { time: number; price: number } | { t: number; price: number };
};

/** 端点的时间戳：`time` 与 `t` 都认。 */
function pointTime(point: { time?: number; t?: number }): number {
  return point.time ?? point.t ?? Number.NaN;
}

/** 端点的价格。 */
function pointPrice(point: { price: number }): number {
  return point.price;
}

/** 把一条线换算成 `at` 时刻的价格。 */
export function levelPriceAt(line: LevelLine, at: number): number {
  if (line.kind === 'horizontal') return line.price;
  const p1 = line.p1;
  const p2 = line.p2;
  if (!p1 || !p2) return line.price;
  const t1 = pointTime(p1);
  const t2 = pointTime(p2);
  const v1 = pointPrice(p1);
  const v2 = pointPrice(p2);
  if (!Number.isFinite(t1) || !Number.isFinite(t2) || t2 === t1) return v2;
  return v2 + ((v2 - v1) / (t2 - t1)) * (at - t2);
}

/** 中位数。空数组返回 `fallback`。 */
export function median(values: readonly number[], fallback: number): number {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return fallback;
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * 该币该周期的「波动尺子」：日内振幅 `(high - low) / close` 的中位数，单位 %。
 *
 * `fromIndex` 之前的 K 线不参与计算 —— 用了射线时，尺子只取「射线起点之后」那段
 * （用户 10/20：「打到高点后，就是我那个射线起点之后波动的中位数」）。
 * 没有射线时取最近 60 根。
 */
export function volatilityScale(
  candles: readonly Candlestick[],
  fromIndex?: number,
  minSamples = 30,
): number {
  const fallback = Math.max(0, candles.length - 60);
  const from = fromIndex ?? fallback;
  const slice = candles.slice(Math.max(0, from));
  // 射线起点之后可能只剩十几根（线刚画不久），这么少的样本算出来的中位数不稳，
  // 会把尺子压小、把「还没接近」误报成「贴近」。样本不足时退回最近 60 根 ——
  // 宁可尺子来自更长的历史，也不能让它抖动。
  const source = slice.length < minSamples ? candles.slice(fallback) : slice;
  if (!source.length) return 0.02;
  return (
    median(
      source.map((candle) => ((candle.high - candle.low) / (candle.close || 1)) * 100),
      0.02,
    ) / 100
  );
}

/** 一次距线计算的结果。 */
export type LevelAlert = {
  /** 距线的百分比（正 = 现价在线上方，负 = 在下方）。 */
  distancePct: number;
  /** 该币该周期的尺子（百分比）。 */
  scalePct: number;
  /** `distancePct` 的绝对值 ÷ 尺子。 */
  ratio: number;
  state: LevelAlertState;
  /** 参与计算的那条线（离现价最近的那条）。 */
  line: LevelLine;
};

/**
 * 算「现价距这些线有多近」。
 *
 * @param candles 该币该周期的 K 线（升序）
 * @param lines   用户标的线
 * @param at      评估时刻（毫秒时间戳），通常是最后一根 K 线的时间
 * @param fromIndex 尺子从哪根 K 线开始算（射线起点之后）
 */
export function levelAlert(
  candles: readonly Candlestick[],
  lines: readonly LevelLine[],
  at: number,
  fromIndex?: number,
): LevelAlert | null {
  if (!candles.length || !lines.length) return null;
  const scalePct = volatilityScale(candles, fromIndex) * 100;
  if (!(scalePct > 0)) return null;

  let best: LevelAlert | null = null;
  for (const line of lines) {
    const price = levelPriceAt(line, at);
    if (!Number.isFinite(price) || price <= 0) continue;
    const distancePct = ((candles[candles.length - 1].close - price) / price) * 100;
    const ratio = Math.abs(distancePct) / scalePct;
    if (!best || ratio < best.ratio) {
      best = {
        distancePct,
        scalePct,
        ratio,
        state: ratio <= LEVEL_ALERT_RATIO ? 'alert' : ratio <= LEVEL_WATCH_RATIO ? 'watch' : 'far',
        line,
      };
    }
  }
  return best;
}

/**
 * 从 `drawing-store` 的记录里挑出该币该周期的线。
 *
 * 只取 `horizontal` 与 `ray`（`segment` 是历史遗留的画法，PRD 已定不再使用）。
 */
export function linesFromDrawings(
  drawings: readonly ChartDrawing[],
  instrument: string,
  timeframe: string,
): LevelLine[] {
  const lines: LevelLine[] = [];
  for (const drawing of drawings) {
    if (drawing.instrument !== instrument) continue;
    if (drawing.timeframe !== timeframe) continue;
    if (drawing.kind === 'horizontal' && drawing.points[0]) {
      lines.push({ kind: 'horizontal', price: drawing.points[0].price });
      continue;
    }
    if (drawing.kind === 'ray' && drawing.points[0] && drawing.points[1]) {
      lines.push({
        kind: 'ray',
        price: drawing.points[1].price,
        p1: drawing.points[0],
        p2: drawing.points[1],
      });
    }
  }
  return lines;
}

/**
 * 射线起点之后的第一根 K 线下标 —— 尺子从这里开始算。
 * 没有射线时返回 `undefined`（尺子用最近 60 根）。
 */
export function scaleStartIndex(
  candles: readonly Candlestick[],
  lines: readonly LevelLine[],
): number | undefined {
  const ray = lines.find((line) => line.kind === 'ray' && line.p1);
  if (!ray?.p1) return undefined;
  const start = pointTime(ray.p1);
  if (!Number.isFinite(start)) return undefined;
  const index = candles.findIndex((candle) => candle.timestamp >= start);
  return index >= 0 ? index : undefined;
}
