/**
 * 日线口径（用户 10/20 确认）：**北京时间 0:00 分界**。
 *
 * 交易所原始时间戳 = UTC 16:00（= 北京次日 0:00），所以：
 *   标签 = new Date(t + 8h).toISOString().slice(0,10)   ← 北京日期
 * 之前所有脚本用的 UTC 日期比它早一天（450/450 根全错位）。
 */
export const DAY = 86_400_000;
export const SHIFT = 8 * 3_600_000;

/** 时间戳 → 北京日期标签 */
export const dayOf = (t) => new Date(t + SHIFT).toISOString().slice(0, 10);

/** 北京日期 → 该日 0:00 的时间戳 */
export const dayStart = (d) => Date.parse(`${d}T00:00:00+08:00`);

/** 在北京日期的升序 bars 里找 <= 该日的最后一根 */
export function idxAtOrBefore(bars, d) {
  const limit = dayStart(d) + DAY - 1;
  let best = -1;
  for (let i = 0; i < bars.length; i++) if (bars[i].t <= limit) best = i;
  return best;
}

/** 精确找某北京日期的下标 */
export function idxOf(bars, d) {
  for (let i = 0; i < bars.length; i++) if (dayOf(bars[i].t) === d) return i;
  return -1;
}

/** 加载一个币的日线，统一成 { t, o, h, l, c, d }（d = 北京日期） */
export function normalize(raw) {
  return raw.map(([t, o, h, l, c]) => ({ t, o, h, l, c, d: dayOf(t) }));
}
