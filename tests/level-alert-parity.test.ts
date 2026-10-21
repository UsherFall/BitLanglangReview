/**
 * AC4：用用户 2026-10-20 标注的 10 段，验证产品里的 `level-alert.ts`
 * 算出的「距线」与研究脚本 `alert.mjs` 一致。
 *
 * 一致性由两条独立路径算出同一个数来保证：
 *   A. 产品代码 src/domain/level-alert.ts
 *   B. 本文件里的复算（照 alert.mjs 的口径重写一遍）
 * 两者必须逐段相同。
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { levelAlert, scaleStartIndex, type LevelLine } from '../src/domain/level-alert';

const SRC = '.trellis/tasks/archive/2026-10/10-20-anomaly-level-tracker/research';
const dayOf = (t: number): string =>
  new Date(Number(t) + 8 * 3600 * 1000).toISOString().slice(0, 10);

/** One raw daily bar as stored in the research pool. */
type PoolBar = { t: number; o: number; h: number; l: number; c: number; d: string };

const bars = new Map<string, PoolBar[]>();
for (const f of fs.readdirSync(path.join(SRC, 'pool'))) {
  if (!f.endsWith('.json')) continue;
  const raw = JSON.parse(fs.readFileSync(path.join(SRC, 'pool', f), 'utf8')) as [number, number, number, number, number][];
  if (raw.length < 120) continue;
  bars.set(
    f.replace(/\.json$/, ''),
    raw.map(([t, o, h, l, c]) => ({ t: Number(t), o, h, l, c, d: dayOf(t) })),
  );
}

const labels = JSON.parse(fs.readFileSync(path.join(SRC, 'draw', 'labels.json'), 'utf8')) as {
  inst: string;
  segments?: {
    region: [string, string];
    verdict?: string;
    lines?: ({ kind: 'h'; price: number } | { kind: 'r'; p1: { t: number; price: number }; p2: { t: number; price: number } })[];
  }[];
}[];

const allDays = [...new Set([...bars.values()].flatMap((a) => a.map((b) => b.d)))].sort();
const lastDay = allDays.at(-1) ?? '';
const nowBJ = new Date(Date.now() + 8 * 3600 * 1000);
const judgeDay = nowBJ.getUTCHours() >= 8 ? allDays.filter((d) => d < lastDay).at(-1) : lastDay;

/**
 * 端点时间（毫秒）。10/21 起 `LevelLine` 的端点是 `{ ms, price }` —— 单位在
 * 类型上就确定了，产品口径（秒）与研究口径（毫秒）的换算只发生在
 * `linesFromDrawings` 里。
 */
const refTime = (point: { ms: number }): number => point.ms;

/**
 * alert.mjs 的口径，独立复算一遍。
 *
 * 形状与产品代码不同（这里是 `t/h/l/c`，产品是 `timestamp/high/low/close`），
 * 所以它确实是【另一条实现路径】，而不是同一个函数被调用两次。
 */
function referenceComputation(
  candles: readonly { timestamp: number; high: number; low: number; close: number }[],
  lines: LevelLine[],
  at: number,
) {
  const from = (() => {
    const ray = lines.find((l) => l.kind === 'ray' && l.p1);
    if (!ray?.p1) return Math.max(0, candles.length - 60);
    const start = refTime(ray.p1);
    const index = candles.findIndex((c) => c.timestamp >= start);
    return index >= 0 ? index : Math.max(0, candles.length - 60);
  })();
  const rngs = (() => {
    const fallback = Math.max(0, candles.length - 60);
    const slice = candles.slice(from);
    const source = slice.length < 30 ? candles.slice(fallback) : slice;
    return source.map((b) => ((b.high - b.low) / b.close) * 100).sort((x, y) => x - y);
  })();
  const scalePct = rngs[Math.floor(rngs.length / 2)];
  const price = candles[candles.length - 1].close;
  const dists = lines.map((line) => {
    if (line.kind === 'horizontal') {
      return { kind: line.kind, dist: ((price - line.price) / line.price) * 100 };
    }
    const p1 = line.p1!;
    const p2 = line.p2!;
    const t1 = refTime(p1);
    const t2 = refTime(p2);
    const p = t2 === t1
      ? p2.price
      : p2.price + ((p2.price - p1.price) / (t2 - t1)) * (at - t2);
    return { kind: line.kind, dist: ((price - p) / p) * 100 };
  });
  dists.sort((x, y) => Math.abs(x.dist) - Math.abs(y.dist));
  const nearest = dists[0];
  const ratio = Math.abs(nearest.dist) / scalePct;
  return {
    distancePct: nearest.dist,
    scalePct,
    ratio,
    state: ratio <= 0.5 ? 'alert' : ratio <= 1.0 ? 'watch' : 'far',
  };
}

describe('level-alert 与研究脚本口径一致 (AC4)', () => {
  it('每一段标注的距线/尺子/倍数/状态都与独立复算相同', () => {
    let checked = 0;
    for (const c of labels) {
      const raw = bars.get(c.inst);
      if (!raw) continue;
      const candles = raw.map((b) => ({
        instrument: c.inst,
        timeframe: '1D' as const,
        timestamp: b.t,
        open: b.o,
        high: b.h,
        low: b.l,
        close: b.c,
        volume: 0,
      }));
      const E = candles.findIndex((x) => dayOf(x.timestamp) === judgeDay);
      if (E < 0) continue;
      const slice = candles.slice(0, E + 1);
      for (const s of c.segments ?? []) {
        const lines: LevelLine[] = [];
        for (const l of s.lines ?? []) {
          if (l.kind === 'h') lines.push({ kind: 'horizontal', price: l.price });
          else lines.push({ kind: 'ray', price: l.p2.price, p1: { ms: l.p1.t, price: l.p1.price }, p2: { ms: l.p2.t, price: l.p2.price } });
        }
        if (!lines.length) continue;
        const at = slice.at(-1)!.timestamp;
        const product = levelAlert(slice, lines, at, scaleStartIndex(slice, lines));
        const reference = referenceComputation(slice, lines, at);
        expect(product, `${c.inst} 应有结果`).not.toBeNull();
        expect(
          reference.scalePct,
          `${c.inst} 参考实现的尺子不该是 NaN`,
        ).toBeGreaterThan(0);
        expect(product!.distancePct).toBeCloseTo(reference.distancePct, 6);
        expect(product!.scalePct).toBeCloseTo(reference.scalePct, 6);
        expect(product!.ratio).toBeCloseTo(reference.ratio, 6);
        expect(product!.state).toBe(reference.state);
        checked++;
      }
    }
    // 10 段标注里 9 段有线（OPG 那段没画线）。
    expect(checked).toBeGreaterThanOrEqual(8);
  });

  it('BTC 落在「观察中」而不是「报警」（1.74% 距线 ÷ 2.38% 尺子 = 0.73×）', () => {
    const raw = bars.get('BTCUSDT');
    const candles = raw!.map((b) => ({
      instrument: 'BTCUSDT',
      timeframe: '1D' as const,
      timestamp: b.t,
      open: b.o,
      high: b.h,
      low: b.l,
      close: b.c,
      volume: 0,
    }));
    const E = candles.findIndex((x) => dayOf(x.timestamp) === judgeDay);
    const slice = candles.slice(0, E + 1);
    const label = labels.find((c) => c.inst === 'BTCUSDT');
    const ray = label!.segments![0].lines!.find((l) => l.kind === 'r')!;
    const lines: LevelLine[] = [{ kind: 'ray', price: ray.p2.price, p1: { ms: ray.p1.t, price: ray.p1.price }, p2: { ms: ray.p2.t, price: ray.p2.price } }];
    const alert = levelAlert(slice, lines, slice.at(-1)!.timestamp, scaleStartIndex(slice, lines));
    expect(alert!.state).toBe('watch');
  });
});
