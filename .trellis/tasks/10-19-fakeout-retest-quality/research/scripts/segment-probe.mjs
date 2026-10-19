/**
 * Research probe: three ways of finding "the most recent move (行情)" before a
 * decision day, compared on the user's labelled good stretches + CFX / WAL.
 *
 *   A. z-score    : a "move bar" is one whose range (high-low)/close >= k x the
 *                   median range of the trailing 60 bars. The move = the run of
 *                   hot bars that ends closest to the decision day.
 *   B. efficiency : over the last 40 bars, find the sub-segment (>=3 bars) with
 *                   the highest movesize x square root of size, net move >= 10%.
 *   C. min-size   : the widest segment (>=3 bars, net travel >= 10%) inside the
 *                   last 40 bars, ending before the decision day.
 *
 * For each method we report the detected move and the band that follows it
 * (bars after the move up to the decision day). "band 0/1 bar(s)" = nothing left
 * to form a convergence.
 *
 * Data: .scratch/daily-<inst>.json (Bitget, fetched 2026-10-19).
 * Run:  node .scratch/segment-probe.mjs
 */
import fs from 'node:fs';

const iso = (t) => new Date(t).toISOString().slice(0, 10);
function barsOf(inst) {
  const raw = JSON.parse(fs.readFileSync(`.scratch/daily-${inst}.json`, 'utf8'));
  return raw.map(([t, o, h, l, c]) => ({ t, o: +o, h: +h, l: +l, c: +c }));
}

function moveZScore(bars, E, opts = {}) {
  const lookback = opts.lookback ?? 60;
  const k = opts.k ?? 2.0;
  const win = bars.slice(Math.max(0, E - lookback), E + 1);
  const rel = win.map((b) => (b.h - b.l) / b.c).sort((a, b) => a - b);
  const med = rel[Math.floor(rel.length / 2)];
  if (!(med > 0)) return null;
  const thr = k * med;
  // The most recent finished run of "hot" bars (a run that touches the decision
  // day is unfinished — a move still printing is not a move we can sit after).
  let end = -1;
  let start = -1;
  let i = E;
  if ((bars[i].h - bars[i].l) / bars[i].c >= thr) return { unfinished: true, label: 'z-score' };
  for (; i >= Math.max(0, E - lookback); i--) {
    const hot = (bars[i].h - bars[i].l) / bars[i].c >= thr;
    if (hot) {
      if (end < 0) end = i;
      start = i;
    } else if (end >= 0) break;
  }
  if (end < 0) return null;
  return { start, end, label: 'z-score' };
}

function moveEfficiency(bars, E, opts = {}) {
  const maxW = opts.maxW ?? 40;
  const minMove = opts.minMovePct ?? 0.10;
  let best = null;
  for (let s = Math.max(0, E - maxW); s <= E - 2; s++) {
    for (let e = s + 2; e <= E - 1; e++) {
      const seg = bars.slice(s, e + 1);
      const net = Math.abs(seg[seg.length - 1].c - seg[0].o);
      const travel = seg.reduce((a, b) => a + Math.abs(b.c - b.o), 0);
      if (!(travel > 0)) continue;
      const movePct = net / seg[0].o;
      if (movePct < minMove) continue;
      const score = (net / travel) * Math.sqrt(movePct);
      if (!best || score > best.score) best = { start: s, end: e, score, movePct };
    }
  }
  return best ? { ...best, label: 'efficiency' } : null;
}

function moveMinSize(bars, E, opts = {}) {
  const maxW = opts.maxW ?? 40;
  const minMove = opts.minMovePct ?? 0.10;
  const minBars = opts.minBars ?? 3;
  let best = null;
  for (let s = Math.max(0, E - maxW); s <= E - 2; s++) {
    for (let e = s + minBars - 1; e <= E - 1; e++) {
      const seg = bars.slice(s, e + 1);
      const hi = Math.max(...seg.map((b) => b.h));
      const lo = Math.min(...seg.map((b) => b.l));
      const travel = (hi - lo) / seg[0].o;
      if (travel < minMove) continue;
      if (!best || travel > best.travel) best = { start: s, end: e, travel };
    }
  }
  return best ? { ...best, label: 'min-size' } : null;
}

const TARGETS = [
  { inst: 'CFXUSDT', date: '2026-10-18', expect: 'N — 回落没踩住，行情之后应当留不下像样的带' },
  { inst: 'WALUSDT', date: '2026-10-13', expect: 'Y — 主升浪之后高位收敛（带应从 10-13 之后起算，本例处于行情末尾）' },
  { inst: 'STRKUSDT', date: '2026-09-30', expect: '好区间末尾' },
  { inst: 'TIAUSDT', date: '2026-10-07', expect: '好区间末尾（用户后来说是假突破）' },
  { inst: 'BEAMUSDT', date: '2026-10-02', expect: '好区间末尾' },
  { inst: 'BATUSDT', date: '2026-10-02', expect: '好区间末尾' },
  { inst: 'AXLUSDT', date: '2026-10-07', expect: '好区间末尾' },
  { inst: 'XMRUSDT', date: '2026-08-20', expect: '好区间末尾' },
  { inst: 'XMRUSDT', date: '2026-08-13', expect: '好区间末尾' },
  { inst: 'OPGUSDT', date: '2026-10-06', expect: '好区间末尾' },
  { inst: 'OPUSDT', date: '2026-09-15', expect: '好区间末尾' },
  { inst: 'ZECUSDT', date: '2026-08-16', expect: '好区间末尾' },
  { inst: 'ZECUSDT', date: '2026-08-31', expect: '好区间末尾' },
];

function describe(bars, m) {
  if (!m) return 'no move';
  if (m.unfinished) return 'move still printing on decision day';
  const seg = bars.slice(m.start, m.end + 1);
  const hi = Math.max(...seg.map((b) => b.h));
  const lo = Math.min(...seg.map((b) => b.l));
  const up = seg[seg.length - 1].c >= seg[0].o;
  return `${iso(seg[0].t)}→${iso(seg[seg.length - 1].t)} ${seg.length}d ${up ? '↑' : '↓'}${(((hi - lo) / seg[0].o) * 100).toFixed(0)}%`;
}

function bandInfo(bars, m, E) {
  if (!m) return { ok: false, why: 'no move' };
  if (m.unfinished) return { ok: false, why: 'move unfinished' };
  const s = m.end + 1;
  const n = E - s + 1;
  if (n < 2) return { ok: false, why: `band ${n} bar(s)` };
  const b = bars.slice(s, E + 1);
  const hi = Math.max(...b.map((x) => x.h));
  const lo = Math.min(...b.map((x) => x.l));
  return { ok: true, n, pct: ((hi - lo) / b[0].o) * 100 };
}

const methods = [
  ['z-score', moveZScore],
  ['efficiency', moveEfficiency],
  ['min-size', moveMinSize],
];

for (const m of methods) {
  console.log(`\n===== ${m[0]} =====`);
  for (const t of TARGETS) {
    const bars = barsOf(t.inst);
    let E = bars.findIndex((b) => iso(b.t) >= t.date); if (t.inst === 'CFXUSDT' && E < 0) E = bars.length - 1; // fresh pull ends 10-17 (10-18 bar still open)
    if (E < 0) { console.log(`${t.inst}@${t.date}: no data`); continue; }
    const mv = m[1](bars, Math.min(E, bars.length - 1));
    const bd = bandInfo(bars, mv, Math.min(E, bars.length - 1));
    console.log(
      `${t.inst.replace('USDT', '').padEnd(6)}@${t.date.slice(5).padEnd(6)} move=${describe(bars, mv).padEnd(34)} band=${bd.ok ? `${bd.n}d ${bd.pct.toFixed(1)}%` : bd.why}   [${t.expect}]`,
    );
  }
}
