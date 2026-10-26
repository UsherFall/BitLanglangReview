/**
 * Box method v2: the STRK shape stated as a comparison of HALVES.
 *
 * v1 compared the box's edges, which punishes a box that sits high inside the
 * move (STRK 9/22-10/2 drifts 0.55H between its first and last bar yet never
 * leaves a 24% band). v2 keeps the squeezed-height * moveTravel gate and
 * replaces edge-trendlessness with "the second half is no more energetic than
 * the first", which is what "narrowing / settling" actually means here.
 *
 *   npx tsx .scratch\box-replay2.ts
 */
import fs from 'node:fs';

type Bar = { t: number; o: number; h: number; l: number; c: number };

const SNAP = JSON.parse(fs.readFileSync('tools/labeling/out/candles.json', 'utf8')) as {
  candles: Record<string, number[][]>;
  history?: Record<string, number[][]>;
  volume: Record<string, { quoteVolume24h: number; volumeRank: number }>;
};
const LABELS = ['ACEUSDT', 'API3USDT', 'BGBUSDT', 'EULUSDT', 'GENIUSUSDT', 'KAVAUSDT', 'ONGUSDT', 'REUSDT', 'SIRENUSDT', 'TRBUSDT', 'UMAUSDT'];
const toBars = (raw: number[][]): Bar[] => raw.map(([t, o, h, l, c]) => ({ t, o, h, l, c })).sort((a, b) => a.t - b.t);
const iso = (b: Bar): string => new Date(b.t).toISOString().slice(0, 10);
const meanRange = (b: Bar[]): number => b.reduce((s, x) => s + (x.h - x.l) / x.c, 0) / Math.max(1, b.length);

type Params = { minRun: number; maxRun: number; maxSqueeze: number; maxTopBelow: number; minMove: number; maxHalfGrowth: number };
const BASE: Params = { minRun: 5, maxRun: 15, maxSqueeze: 0.6, maxTopBelow: 0.5, minMove: 0.12, maxHalfGrowth: 1.0 };

type Box = {
  instrument: string;
  scannedOn: string;
  start: string;
  end: string;
  bars: number;
  low: number;
  high: number;
  heightPct: number;
  squeeze: number;
  topBelow: number;
  halfGrowth: number;
  position: number;
  volumeRank: number;
};

function scanAt(instrument: string, bars: Bar[], e: number, p: Params, volumeRank: number): Box | null {
  const last = bars[e];
  let best: Box | null = null;
  for (let l = p.minRun; l <= p.maxRun && l <= e + 1; l += 1) {
    const start = e - l + 1;
    const box = bars.slice(start, e + 1);
    const low = Math.min(...box.map((b) => b.l));
    const high = Math.max(...box.map((b) => b.h));
    const height = high - low;
    if (height <= 0) continue;
    if (last.c < low || last.c > high) continue;
    let travel = 0;
    let moveHigh = -Infinity;
    for (const look of [l, 2 * l, 10, 20]) {
      const lead = bars.slice(Math.max(0, start - look), start);
      if (lead.length < 3) continue;
      const hi = Math.max(...lead.map((b) => b.h));
      const t = hi - Math.min(...lead.map((b) => b.l));
      if (t > travel) travel = t;
      moveHigh = Math.max(moveHigh, hi);
    }
    if (travel < p.minMove * last.c) continue;
    const squeeze = height / travel;
    if (squeeze > p.maxSqueeze) continue;
    const topBelow = (moveHigh - high) / travel;
    if (topBelow < 0 || topBelow > p.maxTopBelow) continue;
    const half = Math.floor(box.length / 2);
    const first = meanRange(box.slice(0, half));
    const second = meanRange(box.slice(box.length - half));
    const halfGrowth = first > 0 ? second / first : Infinity;
    if (halfGrowth > p.maxHalfGrowth) continue;
    const candidate: Box = {
      instrument,
      scannedOn: iso(last),
      start: iso(box[0]),
      end: iso(box[box.length - 1]),
      bars: l,
      low,
      high,
      heightPct: (height / last.c) * 100,
      squeeze,
      topBelow,
      halfGrowth,
      position: (last.c - low) / height,
      volumeRank,
    };
    // Longest box wins; ties by tightest squeeze.
    if (best === null || candidate.bars > best.bars || (candidate.bars === best.bars && squeeze < best.squeeze)) best = candidate;
  }
  return best;
}

const instruments = Object.keys(SNAP.candles).sort();
const report = (name: string, p: Params) => {
  const all: Box[] = [];
  for (const inst of instruments) {
    const raw = SNAP.history?.[inst] ?? SNAP.candles[inst];
    if (!raw) continue;
    const bars = toBars(raw).slice(-120);
    if (bars.length < 60) continue;
    const rank = SNAP.volume[inst]?.volumeRank ?? 9999;
    for (let e = Math.max(20, bars.length - 90); e < bars.length; e += 1) {
      const box = scanAt(inst, bars, e, p, rank);
      if (box) all.push(box);
    }
  }
  console.log(`\n=== ${name} (maxHalfGrowth=${p.maxHalfGrowth}) ===`);
  console.log(`signals: ${all.length} instrument-days over 90 days x ${instruments.length}`);
  const hit = new Set(all.map((b) => b.instrument).filter((i) => LABELS.includes(i)));
  console.log(`labeled positives: ${hit.size}/${LABELS.length}${hit.size < LABELS.length ? ' missing ' + LABELS.filter((l) => !hit.has(l)).join(',') : ''}`);
  const strk = all.filter((b) => b.instrument === 'STRKUSDT' && b.scannedOn === '2026-10-02');
  console.log(`STRK on 10/02: ${strk.length ? strk.map((b) => `${b.start}→${b.end} n=${b.bars} sq=${b.squeeze.toFixed(2)} top=${(b.topBelow * 100).toFixed(0)}% hg=${b.halfGrowth.toFixed(2)}`).join('; ') : 'none'}`);
  // one signal per instrument per day; measure the weekly cadence a user would see
  const perDay = new Map<string, number>();
  for (const b of all) perDay.set(b.scannedOn, (perDay.get(b.scannedOn) ?? 0) + 1);
  const counts = [...perDay.values()];
  console.log(`signals/day: min ${Math.min(...counts)}, median ${counts.sort((a, b) => a - b)[Math.floor(counts.length / 2)]}, max ${Math.max(...counts)}`);
  const latest = all.filter((b) => b.scannedOn === '2026-10-13');
  console.log(`visible on 10/13: ${latest.length} instruments`);
  for (const b of latest.slice(0, 8)) {
    console.log(`  ${b.instrument.padEnd(13)} ${b.start}→${b.end} n=${String(b.bars).padStart(2)} H=${b.heightPct.toFixed(1)}% sq=${b.squeeze.toFixed(2)} top=${(b.topBelow * 100).toFixed(0)}% hg=${b.halfGrowth.toFixed(2)} pos=${b.position.toFixed(2)} #${b.volumeRank}`);
  }
};

report('BASE', BASE);
report('STRICT', { ...BASE, maxHalfGrowth: 0.8, maxSqueeze: 0.55 });
report('WIDE-RUN', { ...BASE, maxRun: 25 });
