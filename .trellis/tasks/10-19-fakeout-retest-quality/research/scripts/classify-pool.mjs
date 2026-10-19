/**
 * Classify the pooled symbols by what their daily bars LOOK like, so the
 * retention ranking can be read in the pool the scanner actually scans (加密).
 *
 * The daily cache has no marketClass. Equities (US/HK/KR/CN) print on sessions:
 * their daily bars have almost no wick (open≈low≈high≈close on quiet days) and
 * they go flat over weekends/holidays. Crypto wicks a lot and prints every day.
 *
 * Measure per instrument over its last 120 bars:
 *   wickRatio = mean((high-low) / close)      full daily range
 *   bodyRatio = mean(|close-open| / close)    how much of that range is body
 *   gapDays   = share of calendar days with no bar (crypto 1D ≈ 0)
 *
 * Run: POOL_DIR=<dir> node <this>
 */
import fs from 'node:fs';
import path from 'node:path';

const POOL_DIR = process.env.POOL_DIR;
const rows = [];
for (const f of fs.readdirSync(POOL_DIR)) {
  if (!f.endsWith('.json')) continue;
  let raw;
  try { raw = JSON.parse(fs.readFileSync(path.join(POOL_DIR, f), 'utf8')); } catch { continue; }
  if (!Array.isArray(raw) || raw.length < 60) continue;
  const bars = raw.slice(-120).map(([t, o, h, l, c]) => ({ t, o, h, l, c }));
  const wick = bars.reduce((a, b) => a + (b.h - b.l) / b.c, 0) / bars.length;
  const body = bars.reduce((a, b) => a + Math.abs(b.c - b.o) / b.c, 0) / bars.length;
  const spanDays = (bars[bars.length - 1].t - bars[0].t) / 86_400_000 + 1;
  const gap = 1 - bars.length / spanDays;
  rows.push({ inst: f.replace(/\.json$/, ''), wick, body, gap, n: bars.length });
}

const q = (arr, p) => arr.slice().sort((a, b) => a - b)[Math.floor((arr.length - 1) * p)];
const wicks = rows.map((r) => r.wick);
console.log(`instruments ${rows.length}; wickRatio median ${(q(wicks, 0.5) * 100).toFixed(2)}%, p10 ${(q(wicks, 0.1) * 100).toFixed(2)}%, p90 ${(q(wicks, 0.9) * 100).toFixed(2)}%`);

console.log('\nlowest 25 wickRatio (equity-like = session-flat bars):');
for (const r of rows.slice().sort((a, b) => a.wick - b.wick).slice(0, 25)) {
  console.log(`  ${r.inst.padEnd(16)} wick ${(r.wick * 100).toFixed(2)}%  body ${(r.body * 100).toFixed(2)}%  gap ${(r.gap * 100).toFixed(0)}%  n ${r.n}`);
}
console.log('\nhighest 10 wickRatio (crypto-like):');
for (const r of rows.slice().sort((a, b) => b.wick - a.wick).slice(0, 10)) {
  console.log(`  ${r.inst.padEnd(16)} wick ${(r.wick * 100).toFixed(2)}%  body ${(r.body * 100).toFixed(2)}%  gap ${(r.gap * 100).toFixed(0)}%  n ${r.n}`);
}

const knownCrypto = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'CFXUSDT', 'WALUSDT', 'TIAUSDT', 'STRKUSDT', 'ZECUSDT'];
const knownEquity = ['AMKRUSDT', 'LRCXUSDT', 'AMATUSDT', 'KLACUSDT', 'TERUSDT', 'VRTUSDT'];
const pick = (list) => rows.filter((r) => list.includes(r.inst));
console.log('\nreference points:');
for (const r of [...pick(knownCrypto), ...pick(knownEquity)]) {
  console.log(`  ${r.inst.padEnd(14)} wick ${(r.wick * 100).toFixed(2)}%  body ${(r.body * 100).toFixed(2)}%  gap ${(r.gap * 100).toFixed(0)}%`);
}
fs.writeFileSync('.scratch/research-10-19/pool-classes.json', JSON.stringify(rows, null, 0));
