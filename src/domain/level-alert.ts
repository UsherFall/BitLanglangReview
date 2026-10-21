import type { Candlestick } from './candlestick';
import type { ChartDrawing } from './drawing';

/**
 * 「距线」—— 现价离你标的线还有多远。选品模块用它替换掉原来的「扫收敛」，
 * 10/21 起同时供两个视图用：「主升浪候选」(shrink) 的行内读数 + 「标线监控」(watch)
 * 的整行内容。
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
 * 端点用 `{ ms, price }`，**`ms` 永远是毫秒**（与 `Candlestick.timestamp` 同单位）。
 *
 * 为什么端点类型里只留 `ms`（10/21）：产品的 `ChartDrawing.points[].time` 是
 * **秒**（lightweight-charts 的 `coordinateToTime` 返回秒），而研究阶段的标注
 * 文件用 `t`、值是**毫秒**。原来两种形状都直接塞进 `p1`/`p2`，于是
 * `levelPriceAt` 把秒和毫秒相减 —— 插值出的射线价差了 1000 倍，距线恒为
 * -100%、状态永远是「不接近」；`scaleStartIndex` 的 `findIndex` 也恒为 0，
 * 尺子退化成「全序列中位数」。
 *
 * 转换只发生在一个地方（`linesFromDrawings`），端点类型则把单位**固定**下来：
 * 新的混用会在编译期就挡住，而不是在距线数值上静默地错。
 */
export type LevelPoint = {
  /** 端点时刻（毫秒时间戳）。 */
  ms: number;
  price: number;
};

export type LevelLine = {
  kind: 'horizontal' | 'ray';
  price: number;
  /** 射线的两个端点（毫秒）。水平线忽略。 */
  p1?: LevelPoint;
  p2?: LevelPoint;
  /**
   * 这条线画在哪个价格坐标系里（画线那张图的收盘价 + 时刻）。
   *
   * 跨交易所测量时用它换算（见 `levelScaleFactor`）。缺省 = 旧数据，按因子 1
   * 处理（即不换算）。
   */
  refPrice?: number;
  refTime?: number;
};

/**
 * 端点时间 → 毫秒。
 *
 * 产品的 `ChartDrawing.points[].time` 是**秒**，研究标注的 `t` 是**毫秒**。
 * 判别用**字段名**而不是数值大小：数值判别会在 1970 年附近的合法值上翻车。
 */
function pointTimeMs(point: { time?: number; t?: number }): number {
  if (point.t !== undefined) return point.t;
  if (point.time !== undefined) return point.time * 1000;
  return Number.NaN;
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
  const t1 = p1.ms;
  const t2 = p2.ms;
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
 * @param candles 该币该周期的 K 线（升序，时间戳是毫秒）
 * @param lines   用户标的线（端点时间也是毫秒）
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
      lines.push({
        kind: 'horizontal',
        price: drawing.points[0].price,
        refPrice: drawing.refPrice,
        refTime: drawing.refTime,
      });
      continue;
    }
    if (drawing.kind === 'ray' && drawing.points[0] && drawing.points[1]) {
      const p1 = { ms: pointTimeMs(drawing.points[0]), price: drawing.points[0].price };
      const p2 = { ms: pointTimeMs(drawing.points[1]), price: drawing.points[1].price };
      // 端点时间不合法（缺字段 / NaN）的射线**整条丢弃**：半条线比没有线更
      // 危险 —— 插值会算出一个看似正常的价位，掩盖「这条线其实没画完」。
      if (!Number.isFinite(p1.ms) || !Number.isFinite(p2.ms)) continue;
      lines.push({
        kind: 'ray',
        price: p2.price,
        p1,
        p2,
        refPrice: drawing.refPrice,
        refTime: drawing.refTime,
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
  const start = ray.p1.ms;
  if (!Number.isFinite(start)) return undefined;
  const index = candles.findIndex((candle) => candle.timestamp >= start);
  return index >= 0 ? index : undefined;
}

/**
 * 比例因子：把一条线从「画线那个交易所的价位」换算到「扫描那个交易所的价位」。
 *
 * 背景（10/21）：线画在选品抽屉的图上（Binance），而扫描跑在 Bitget（或 OKX），
 * 同一个 base 的两个交易所价格有小差异。1% 的错位就足以把 «alert»（≤0.5×尺子）
 * 变成 «far»，所以线价必须先换算到扫描源的坐标系。
 *
 * 换算靠 `ChartDrawing` 上的 `refPrice` / `refTime`（画线那一刻该周期的收盘价
 * 与时刻）：因子 = 扫描源在同一时刻的收盘价 ÷ `refPrice`。
 *
 * 退化规则（**宁可不动，也不要算错**）：
 * - 没有 `refPrice`（10/21 之前画的线）→ 因子 1，即不换算（= 修复前的行为）；
 * - 扫描源在那一刻没有收盘价（缺 K 线 / 时间超界）→ 因子 1 + 一条 note；
 * - 因子超出 `[0.5, 2]` → **不可信**（多半是面值改名这类跨 scale 的坑，
 *   见 `instrument-symbol.ts` 的硬规则）→ 因子 1 + 一条 note。
 */
export type LevelScale = {
  /** 乘到线价上的因子。永远 > 0。 */
  factor: number;
  /** 退化原因；`undefined` 表示因子是可信的。 */
  note?: string;
};

/** 因子可信区间。超出即视为跨 scale 的错配。 */
const LEVEL_SCALE_MIN = 0.5;
const LEVEL_SCALE_MAX = 2;

/**
 * 计算比例因子。纯函数，IO 由调用方（server）负责。
 *
 * @param refPrice 画线那一刻该周期的收盘价（画线那个交易所）
 * @param refTime  画线那一刻的时刻（毫秒）
 * @param sourceClose 扫描源在 `refTime` 那一根的收盘价；找不到传 `undefined`
 */
export function levelScaleFactor(input: {
  refPrice?: number;
  refTime?: number;
  sourceClose?: number;
}): LevelScale {
  const { refPrice, refTime, sourceClose } = input;
  if (!Number.isFinite(refPrice) || !(refPrice! > 0)) return { factor: 1, note: '无线价基准，不换算' };
  if (!Number.isFinite(sourceClose) || !(sourceClose! > 0)) return { factor: 1, note: '扫描源无同时刻收盘价，不换算' };
  const factor = sourceClose! / refPrice!;
  if (!Number.isFinite(factor) || factor < LEVEL_SCALE_MIN || factor > LEVEL_SCALE_MAX) {
    return { factor: 1, note: `价位基准差异过大(${factor.toFixed(3)})，不换算` };
  }
  return { factor };
}

/**
 * 把一组线按比例因子换算到扫描源的坐标系。
 *
 * 只缩放**价**，不缩放时间 —— 射线的时间端点本来就是绝对时刻。
 */
export function scaleLines(lines: readonly LevelLine[], factor: number): LevelLine[] {
  if (!Number.isFinite(factor) || factor === 1) return [...lines];
  return lines.map((line) => {
    if (line.kind === 'horizontal') return { ...line, price: line.price * factor };
    if (!line.p1 || !line.p2) return line;
    return {
      ...line,
      price: line.price * factor,
      p1: { ...line.p1, price: line.p1.price * factor },
      p2: { ...line.p2, price: line.p2.price * factor },
    };
  });
}

/**
 * 把一组线换算到扫描源的坐标系，每条线用自己的基准（`refPrice` / `refTime`）。
 *
 * 一组线可能来自不同的图（不同时间、不同交易所），所以**逐条**算因子而不是
 * 全组一个因子 —— 基准不同，比例也不同。
 */
export function scaleLinesToSource(
  lines: readonly LevelLine[],
  sourceCloseAt: (refTime: number) => number | undefined,
): { lines: LevelLine[]; notes: string[] } {
  const notes: string[] = [];
  const scaled = lines.map((line) => {
    const { factor, note } = levelScaleFactor({
      refPrice: line.refPrice,
      refTime: line.refTime,
      sourceClose: line.refTime === undefined ? undefined : sourceCloseAt(line.refTime),
    });
    if (note) notes.push(note);
    return factor === 1 ? line : scaleLines([line], factor)[0];
  });
  return { lines: scaled, notes };
}
