/**
 * Throwaway prototype v1: the STRK-shaped pattern, stated as a TARGET.
 *
 * STRK 9/22 → 10/2 is NOT "the last few bars are quieter than the bars before
 * them" — measured as a box, its bar range beats the whole 90-bar baseline
 * (1.53×). It is:
 *
 *   a WIDE move, then a NARROWER box whose HEIGHT is a small fraction of that
 *   move's travel, sitting close under the move's high (蓄力贴着高点).
 *
 *   STRK: move 9/18-9/21 = 19.5pt travel; box 9/22-10/2 = 23.8% high → 0.41;
 *         box top 0.0451 vs move high 0.0509 → 11% below; box bottom 0.038 vs
 *         move low 0.0366 → the box holds the upper half of the move.
 *
 * So the detector takes a TARGET (coin + end date) and asks: could a scan at
 * bar E have reported "9/22 → now, box X" using only data up to E?
 *
 *   npx tsx .scratch\target-midpoint.ts
 */
import fs from 'node:fs';

type Bar = { t: number; o: number; h: number; l: number; c: number };

const SNAP = JSON.parse(fs.readFileSync('tools/labeling/out/candles.json', 'utf8')) as {
  candles: Record<string, number[][]>;
  history?: Record<string, number[][]>;
};
const LABELS = ['ACEUSDT', 'API3USDT', 'BGBUSDT', 'EULUSDT', 'GENIUSUSDT', 'KAVAUSDT', 'ONGUSDT', 'REUSDT', 'SIRENUSDT', 'TRBUSDT', 'UMAUSDT'];

const toBars = (raw: number[][]): Bar[] => raw.map(([t, o, h, l, c]) => ({ t, o, h, l, c })).sort((a, b) => a.t - b.t);
const median = (v: number[]): number => {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const barRange = (b: Bar): number => (b.h - b.l) / b.c;
const iso = (b: Bar): string => new Date(b.t).toISOString().slice(0, 10);

type Box = {
  start: string;
  end: string;
  bars: number;
  low: number;
  high: number;
  heightPct: number;
  /** Box height / preceding move travel. */
  squeeze: number;
  /** Box top relative to the move's high: 0 = at the high, 1 = at the move's low. */
  topBelowHigh: number;
  position: number;
};

/**
 * The candidate boxes a scan at bar E could report, using only bars <= E.
 *
 * @param minRun   shortest box (bars) the scan may call a 蓄力
 * @param maxRun   longest box horizon
 * @param maxSqueeze boxHeight / moveTravel must be <= this
 * @param maxTopBelow boxTop must sit within this fraction of the move's travel below the move high
 * @param minMove the preceding move must travel at least this much (fraction of price)
 */
function candidatesAt(
  bars: Bar[],
  E: number,
  opts: { minRun: number; maxRun: number; maxSqueeze: number; maxTopBelow: number; minMove: number },
): Box[] {
  const out: Box[] = [];
  const last = bars[E];
  for (let l = opts.minRun; l <= opts.maxRun && l <= E + 1; l += 1) {
    const start = E - l + 1;
    const box = bars.slice(start, E + 1);
    const boxLow = Math.min(...box.map((b) => b.l));
    const boxHigh = Math.max(...box.map((b) => b.h));
    const height = boxHigh - boxLow;
    if (height <= 0) continue;
    // Contained: the newest bar must be inside the box (no breakout yet).
    if (last.c < boxLow || last.c > boxHigh) continue;
    // The move being consolidated: the l bars immediately BEFORE the box, plus a
    // wider lookback — take whichever gives the larger travel (the 前戏).
    let bestMove: { travel: number; high: number; low: number } | null = null;
    for (const look of [l, 2 * l, 10, 20]) {
      const from = Math.max(0, start - look);
      const lead = bars.slice(from, start);
      if (lead.length < 3) continue;
      const hi = Math.max(...lead.map((b) => b.h));
      const lo = Math.min(...lead.map((b) => b.l));
      const travel = hi - lo;
      if (bestMove === null || travel > bestMove.travel) bestMove = { travel, high: hi, low: lo };
    }
    if (bestMove === null) continue;
    if (bestMove.travel < opts.minMove * last.c) continue;
    const squeeze = height / bestMove.travel;
    if (squeeze > opts.maxSqueeze) continue;
    const topBelowHigh = (bestMove.high - boxHigh) / bestMove.travel;
    if (topBelowHigh < 0) continue; // the box tops out ABOVE the move: not 蓄力 under it
    if (topBelowHigh > opts.maxTopBelow) continue;
    // Flatness: neither edge may trend harder than a quarter of the box's own height.
    const trending = Math.max(Math.abs(box[box.length - 1].h - box[0].h), Math.abs(box[box.length - 1].l - box[0].l));
    if (trending > 0.35 * height) continue;
    out.push({
      start: iso(box[0]),
      end: iso(box[box.length - 1]),
      bars: l,
      low: boxLow,
      high: boxHigh,
      heightPct: (height / last.c) * 100,
      squeeze,
      topBelowHigh,
      position: (last.c - boxLow) / height,
    });
  }
  return out;
}

const DEFAULT = { minRun: 5, maxRun: 30, maxSqueeze: 0.5, maxTopBelow: 0.35, minMove: 0.12 };

// ---------------------------------------------------------------- STRK target
const strk = toBars(SNAP.history?.STRKUSDT ?? SNAP.candles.STRKUSDT);
const strkBar = (date: string) => strk.findIndex((b) => iso(b) === date);
const strkE = strkBar('2026-10-02');
console.log('target: STRKUSDT box 2026-09-22 → 2026-10-02\n');
for (const params of [DEFAULT, { ...DEFAULT, minRun: 5, maxSqueeze: 0.6, maxTopBelow: 0.5 }]) {
  const boxes = candidatesAt(strk, strkE, params);
  const hit = boxes.find((b) => b.start === '2026-09-22' && b.end === '2026-10-02');
  console.log(`params squeeze<=${params.maxSqueeze} topBelow<=${params.maxTopBelow}: ${boxes.length} candidate(s) at 10/02`);
  for (const b of boxes.slice(0, 6)) {
    console.log(`  ${b.start} → ${b.end} n=${String(b.bars).padStart(2)} H=${b.heightPct.toFixed(1)}% squeeze=${b.squeeze.toFixed(2)} topBelow=${(b.topBelowHigh * 100).toFixed(0)}% pos=${b.position.toFixed(2)}`);
  }
  console.log(`  exact 9/22→10/02 reported: ${hit ? 'YES' : 'NO'}\n`);
}

// where else on STRK does it fire, relative to the move?
console.log('STRK candidates, scanned at every bar of September–October:');
for (let e = strkBar('2026-09-20'); e >= 0 && e < strk.length && e <= strkBar('2026-10-02'); e += 1) {
  const boxes = candidatesAt(strk, e, DEFAULT);
  if (boxes.length === 0) continue;
  const best = boxes.sort((a, b) => a.squeeze - b.squeeze)[0];
  console.log(`  scan@${iso(strk[e])}: ${boxes.length} box(es), best ${best.start}→${best.end} n=${best.bars} H=${best.heightPct.toFixed(1)}% squeeze=${best.squeeze.toFixed(2)}`);
}
