/**
 * Throwaway diagnostic: which band does `detectConvergence` pick per instrument,
 * and what would a percentile baseline / range-height gate say about it?
 *
 * Run (tsx is a dev dep):
 *   npx tsx .scratch/conv-diag.ts
 *
 * Reads ONLY tools/labeling/out/candles.json (no network).
 */
import fs from 'node:fs';
import path from 'node:path';

import { COARSE_TIMEFRAME, defaultStructureParams } from '../src/domain/coin-scan';

type SlimBar = [number, number, number, number, number];
type Snapshot = {
  anchor: number;
  candles: Record<string, SlimBar[]>;
  history?: Record<string, SlimBar[]>;
  volume: Record<string, { quoteVolume24h: number; volumeRank: number }>;
};

const file = path.resolve('tools/labeling/out/candles.json');
const snap = JSON.parse(fs.readFileSync(file, 'utf8')) as Snapshot;

type Bar = { t: number; o: number; h: number; l: number; c: number };

function bars(instrument: string, source: 'candles' | 'history'): Bar[] {
  const raw = (source === 'candles' ? snap.candles : snap.history)?.[instrument] ?? [];
  return raw
    .map((b) => ({ t: b[0], o: b[1], h: b[2], l: b[3], c: b[4] }))
    .sort((a, b) => a.t - b.t);
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function drift(prices: readonly number[], startIndex: number): number {
  const n = prices.length;
  if (n < 2) return 0;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (let i = 0; i < n; i += 1) {
    const x = startIndex + i;
    sx += x; sy += prices[i]; sxy += x * prices[i]; sxx += x * x;
  }
  const den = n * sxx - sx * sx;
  if (den === 0) return 0;
  const slope = (n * sxy - sx * sy) / den;
  const mean = sy / n;
  return mean === 0 ? 0 : (Math.abs(slope) * (n - 1)) / mean;
}

/** Mirror of src/domain/coin-scan.ts detectConvergence, plus diagnostics. */
function analyze(sorted: readonly Bar[], minRun: number, convergenceRatio: number, flatRatio: number) {
  if (sorted.length < minRun * 2) return null;
  if (sorted.some((c) => c.l <= 0)) return null;
  const vol = sorted.map((c) => (c.h - c.l) / c.l);
  const last = sorted.length - 1;
  const lastPrice = sorted[last].c;
  let best: any = null;
  for (let start = last - minRun + 1; start >= 0; start -= 1) {
    const runLen = last - start + 1;
    const preStart = start - runLen;
    if (preStart < 0) continue;
    const band = sorted.slice(start, last + 1);
    const runMed = median(vol.slice(start, last + 1));
    const flatTol = flatRatio * runMed;
    if (Math.max(drift(band.map((c) => c.l), start), drift(band.map((c) => c.h), start)) > flatTol) continue;
    const preMed = median(vol.slice(preStart, start));
    if (runMed >= convergenceRatio * preMed) continue;
    const confirmed = band.slice(0, band.length - 1);
    const rangeLow = Math.min(...confirmed.map((c) => c.l));
    const rangeHigh = Math.max(...confirmed.map((c) => c.h));
    const tol = 0.1 * (rangeHigh - rangeLow);
    if (lastPrice < rangeLow - tol || lastPrice > rangeHigh + tol) continue;
    const score = clamp01(1 - runMed / preMed);
    if (best === null || score > best.score) {
      // --- diagnostics on the chosen band ---
      const baseLen = Math.min(runLen, Math.floor((start + runLen) / 2)); // half of available pre-history, capped at runLen
      const baseMed = baseLen >= minRun ? median(vol.slice(start - baseLen, start)) : null;
      const alphaMed = median(vol.slice(0, last)); // whole-series median (percentile proxy)
      const rankPct = vol.slice(0, last + 1).filter((v) => v < runMed).length / (last + 1);
      const h1 = band.slice(0, Math.floor(band.length / 2));
      const h2 = band.slice(Math.floor(band.length / 2));
      const halfRange = (b: Bar[]) => Math.max(...b.map((c) => c.h)) - Math.min(...b.map((c) => c.l));
      const firstHalfRange = halfRange(h1);
      const secondHalfRange = halfRange(h2);
      const sl = Math.min(...band.map((c) => c.l));
      const sh = Math.max(...band.map((c) => c.h));
      const xbar = band.reduce((s, c) => s + (c.h + c.l) / 2, 0) / band.length;
      const resid = Math.sqrt(band.reduce((s, c) => s + (((c.h + c.l) / 2) - xbar) ** 2, 0) / band.length);
      const medianRange = median(band.map((c) => (c.h - c.l) / c.c));
      best = {
        score, runLen, runMed, preMed, rangeLow, rangeHigh, start,
        baseLen, baseMed,
        baseRatio: baseMed !== null && baseMed > 0 ? runMed / baseMed : null,
        alphaMed, alphaRatio: alphaMed > 0 ? runMed / alphaMed : null,
        rankPct,
        halfRatio: secondHalfRange > 0 ? firstHalfRange / secondHalfRange : null,
        residFrac: sh > sl ? resid / (sh - sl) : null,
        medianRange,
      };
    }
  }
  return best;
}

function analyzeHistory(sorted: readonly Bar[], win: number) {
  if (sorted.length < win + 1) return null;
  const lastPrice = sorted[sorted.length - 1].c;
  let best: any = null;
  for (let start = sorted.length - win; start < sorted.length; start += 1) {
    const band = sorted.slice(start);
    const n = band.length;
    const lows = band.map((c) => c.l);
    const highs = band.map((c) => c.h);
    const rangeLow = Math.min(...lows);
    const rangeHigh = Math.max(...highs);
    const volList = band.map((c) => (c.h - c.l) / c.l);
    const runMed = median(volList);
    const tol = 0.1 * (rangeHigh - rangeLow);
    if (lastPrice < rangeLow - tol || lastPrice > rangeHigh + tol) continue;
    const score = clamp01(1 - runMed / Math.max(...volList, 0.000001));
    const bandMedianRange = median(volList);
    if (best === null || bandMedianRange < best.bandMedianRange) {
      const clamp = Math.max(0, Math.min(100, (lastPrice - 0) / 1));
      best = {
        rangeLow, rangeHigh, n, score, bandMedianRange,
        width: (rangeHigh - rangeLow) / lastPrice,
        lastPrice,
        startOffset: start,
        _unused: clamp,
      };
    }
  }
  return best;
}

function histPos(sorted: readonly Bar[], win: number) {
  const seq = sorted.slice(Math.max(0, sorted.length - 90));
  const lo = Math.min(...seq.map((c) => c.l));
  const hi = Math.max(...seq.map((c) => c.h));
  return hi > lo ? (seq[seq.length - 1].c - lo) / (hi - lo) : 0.5;
}

const params = defaultStructureParams();
const rows: any[] = [];
const instruments = Object.keys(snap.candles).sort();
for (const inst of instruments) {
  const c = bars(inst, 'candles');
  const r = analyze(c, params.minRun!, params.convergenceRatio!, params.flatRatio!);
  const h = analyzeHistory(bars(inst, 'history'), 10);
  const hPos = histPos(bars(inst, 'history'), 23);
  rows.push({ inst, coarseLen: c.length, histLen: bars(inst, 'history').length, ...(r ?? { none: true }), hist: h, hPos });
}

function pct(values: number[], p: number) {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * s.length)))];
}

const detected = rows.filter((r) => !r.none);
const none = rows.filter((r) => r.none);
console.log(`instruments with cutoff candles: ${instruments.length}`);
console.log(`detectConvergence fired: ${detected.length}, silent: ${none.length}`);
console.log(`mean runLen: ${(detected.reduce((s, r) => s + r.runLen, 0) / detected.length).toFixed(1)}`);
const runLens = detected.map((r) => r.runLen);
console.log(`runLen p10/p50/p90: ${pct(runLens, 0.1)}/${pct(runLens, 0.5)}/${pct(runLens, 0.9)}`);
const preMed = detected.map((r) => r.preMed);
console.log(`preMed (median vol) p10/p50/p90: ${pct(preMed, 0.1).toFixed(4)}/${pct(preMed, 0.5).toFixed(4)}/${pct(preMed, 0.9).toFixed(4)}`);
const scores = detected.map((r) => r.score);
console.log(`score p10/p50/p90: ${pct(scores, 0.1).toFixed(3)}/${pct(scores, 0.5).toFixed(3)}/${pct(scores, 0.9).toFixed(3)}`);
const baseRatios = detected.map((r) => r.baseRatio).filter((v: any) => v !== null) as number[];
console.log(`baseRatio (shorter baseline) p10/p50/p90: ${pct(baseRatios, 0.1).toFixed(3)}/${pct(baseRatios, 0.5).toFixed(3)}/${pct(baseRatios, 0.9).toFixed(3)}  (n=${baseRatios.length})`);
const alphaRatios = detected.map((r) => r.alphaRatio) as number[];
console.log(`alphaRatio (whole-series med) p10/p50/p90: ${pct(alphaRatios, 0.1).toFixed(3)}/${pct(alphaRatios, 0.5).toFixed(3)}/${pct(alphaRatios, 0.9).toFixed(3)}`);
const rankPcts = detected.map((r) => r.rankPct) as number[];
console.log(`rankPct p10/p50/p90: ${(pct(rankPcts, 0.1) * 100).toFixed(0)}%/${(pct(rankPcts, 0.5) * 100).toFixed(0)}%/${(pct(rankPcts, 0.9) * 100).toFixed(0)}%`);
const halfs = detected.map((r) => r.halfRatio).filter((v: any) => v !== null) as number[];
console.log(`halfRatio (first/second half range) p10/p50/p90: ${pct(halfs, 0.1).toFixed(2)}/${pct(halfs, 0.5).toFixed(2)}/${pct(halfs, 0.9).toFixed(2)}`);
const resid = detected.map((r) => r.residFrac).filter((v: any) => v !== null) as number[];
console.log(`residFrac p10/p50/p90: ${pct(resid, 0.1).toFixed(2)}/${pct(resid, 0.5).toFixed(2)}/${pct(resid, 0.9).toFixed(2)}`);

const vol = snap.volume;
const passCoarse = detected.filter((r) => r.coarseLen > 0);
const withHistory = detected.filter((r) => r.hist && r.histLen >= 30);
console.log(`\ndetected WITH history window of 10 bars (containment at window end): ${withHistory.length}`);
for (const r of withHistory.slice(0, 5)) {
  console.log(`  ${r.inst}: hist n=${r.hist.n} width=${(r.hist.width * 100).toFixed(1)}% hPos=${r.hPos.toFixed(2)}`);
}
const widths = withHistory.map((r) => r.hist.width);
if (widths.length) {
  console.log(`  width p10/p50/p90: ${(pct(widths, 0.1) * 100).toFixed(1)}%/${(pct(widths, 0.5) * 100).toFixed(1)}%/${(pct(widths, 0.9) * 100).toFixed(1)}%`);
}

console.log(`\nrankPct < 0.2 (band is in the quietest fifth of own history): ${rankPcts.filter((p) => p < 0.2).length}`);
console.log(`halfRatio < 0.6 (second half narrower than first): ${halfs.filter((v) => v < 0.6).length}`);
console.log(`residFrac > 0.6 (mushy, not a clean band): ${resid.filter((v) => v > 0.6).length}`);
console.log(`score >= 0.6 (panel default threshold): ${scores.filter((s) => s >= 0.6).length}`);

