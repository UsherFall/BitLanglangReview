/**
 * 扫描器 vs 你会关注的区间 —— 画到 K 线上。
 *
 * 橙框 = 你备注里点名的区间（你说的那些横盘）。
 * 蓝框 = **现有扫描器（detectConvergence，src/domain/coin-scan.ts 原样运行）**在你那个时间段里
 *        每天扫出来、并且与该区间有重叠的那条带（band），按"重叠最多"挑一条代表。
 * 没有蓝框 = 那几天扫描器什么都没扫出来。
 *
 * 关键：扫描器的"区域"不是一块价格箱体，而是**贴着最新一根 K 线往回的一段带**
 * （bandLen 根，位置到 series 末端为止），所以它天然只画在右边缘。
 *
 * Run: POOL_DIR=<dir> OUT=<html> npx tsx <this>
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_CONVERGENCE_MIN_RUN,
  defaultStructureParams,
  detectConvergence,
} from '../../src/domain/coin-scan';
import type { Candlestick } from '../../src/domain/candlestick';

const POOL_DIR = process.env.POOL_DIR!;
const OUT = process.env.OUT ?? '.scratch/research-10-19/scanner-vs-marked.html';
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const bars = new Map<string, Candlestick[]>();
for (const f of fs.readdirSync(POOL_DIR)) {
  if (!f.endsWith('.json')) continue;
  const inst = f.replace(/\.json$/, '');
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(POOL_DIR, f), 'utf8')) as number[][];
    if (Array.isArray(raw) && raw.length >= 100) {
      bars.set(inst, raw.map(([t, o, h, l, c]) => ({ instrument: inst, timeframe: '1D', timestamp: t, open: o, high: h, low: l, close: c, volume: 0 })));
    }
  } catch { /* skip */ }
}
const params = defaultStructureParams();

/** The band the shipped scanner would mark with the series ending at E (100-bar window). */
function bandAt(all: Candlestick[], E: number): { from: number; to: number; low: number; high: number; score: number } | null {
  if (detectConvergence(all.slice(Math.max(0, E - 99), E + 1), params) === null) return null;
  // recover the winning band's geometry with the same constants
  const from = Math.max(0, E - 99);
  const slice = all.slice(from, E + 1);
  const vol = slice.map((c) => (c.high - c.low) / c.low);
  const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]! : 0);
  const edgeDrift = (ys: number[]) => {
    const n = ys.length;
    if (n < 2) return 0;
    const mx = (n - 1) / 2;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) { num += (i - mx) * (ys[i]! - my); den += (i - mx) ** 2; }
    return den === 0 ? 0 : Math.abs(num / den);
  };
  const last = slice.length - 1;
  const lastPrice = slice[last]!.close;
  const SHORT_RUN = 30;
  const eff = (L: number) => (L >= SHORT_RUN ? params.convergenceRatio! : params.shortTightRatio! + ((params.convergenceRatio! - params.shortTightRatio!) * (L - DEFAULT_CONVERGENCE_MIN_RUN)) / (SHORT_RUN - DEFAULT_CONVERGENCE_MIN_RUN));
  let best: { score: number; runLen: number; low: number; high: number; start: number } | null = null;
  for (let start = last - DEFAULT_CONVERGENCE_MIN_RUN + 1; start >= 0; start--) {
    const runLen = last - start + 1;
    const preStart = start - runLen;
    if (preStart < 0) continue;
    const band = slice.slice(start, last + 1);
    const runMed = median(vol.slice(start, last + 1));
    if (Math.max(edgeDrift(band.map((c) => c.low)), edgeDrift(band.map((c) => c.high))) > params.flatRatio! * runMed) continue;
    const preMed = median(vol.slice(preStart, start));
    if (runMed >= eff(runLen) * preMed) continue;
    const confirmed = band.slice(0, -1);
    const low = Math.min(...confirmed.map((c) => c.low));
    const high = Math.max(...confirmed.map((c) => c.high));
    const tol = 0.1 * (high - low);
    if (lastPrice < low - tol || lastPrice > high + tol) continue;
    const score = Math.max(0, Math.min(1, 1 - runMed / preMed));
    if (!best || score > best.score) best = { score, runLen, low, high, start };
  }
  return best ? { from: from + best.start, to: E, low: best.low, high: best.high, score: best.score } : null;
}

const idxAtOrBefore = (arr: Candlestick[], date: string) => {
  const t = Date.parse(`${date}T00:00:00Z`) + 86_399_999;
  let best = -1;
  for (let i = 0; i < arr.length; i++) if (arr[i]!.timestamp <= t) best = i;
  return best;
};

type Range = { inst: string; start: string; end?: string; est?: number; quote: string; verdict: 'good' | 'weak' };
const RANGES: Range[] = JSON.parse(fs.readFileSync(process.env.RANGES ?? '.scratch/research-10-19/ranges.json', 'utf8'));

type Card = {
  inst: string; quote: string; verdict: string;
  userFrom: string; userTo: string; open: boolean;
  bands: Array<{ from: string; to: string; low: number; high: number; score: number; overlap: number; idxFrom: number; idxTo: number }>;
  rep: { from: number; to: number; low: number; high: number; score: number; overlap: number; fromDate: string; toDate: string } | null;
  days: number; hitDays: number;
  slice: Array<{ t: number; o: number; h: number; l: number; c: number }>;
  sliceFrom: string; sliceTo: string;
  userIdxFrom: number; userIdxTo: number;
};

const cards: Card[] = [];
for (const rg of RANGES) {
  const arr = bars.get(rg.inst);
  if (!arr) continue;
  const s = idxAtOrBefore(arr, rg.start);
  if (s < 0) continue;
  const e = rg.end ? Math.max(s, idxAtOrBefore(arr, rg.end)) : Math.min(arr.length - 1, s + (rg.est ?? 10));
  const bands: Card['bands'] = [];
  let days = 0;
  for (let E = Math.max(100, s); E <= e; E++) {
    days++;
    const b = bandAt(arr, E);
    if (!b) continue;
    const ovFrom = Math.max(b.from, s);
    const ovTo = Math.min(b.to, e);
    const overlap = Math.max(0, ovTo - ovFrom + 1) / (b.to - b.from + 1);
    if (overlap <= 0) continue;
    bands.push({ from: iso(arr[b.from]!.timestamp), to: iso(arr[b.to]!.timestamp), low: b.low, high: b.high, score: b.score, overlap, idxFrom: b.from, idxTo: b.to });
  }
  bands.sort((a, b) => b.overlap - a.overlap || b.score - a.score);
  const rep = bands[0] ?? null;
  const from = Math.max(0, Math.min(s, rep ? rep.idxFrom : s) - 45);
  const to = Math.min(arr.length - 1, Math.max(e, rep ? rep.idxTo : e) + 15);
  cards.push({
    inst: rg.inst, quote: rg.quote, verdict: rg.verdict,
    userFrom: iso(arr[s]!.timestamp), userTo: iso(arr[e]!.timestamp), open: !rg.end,
    bands, rep: rep ? { from: rep.idxFrom, to: rep.idxTo, low: rep.low, high: rep.high, score: rep.score, overlap: rep.overlap, fromDate: rep.from, toDate: rep.to } : null,
    days, hitDays: bands.length,
    slice: arr.slice(from, to + 1).map((b) => ({ t: b.timestamp, o: b.open, h: b.high, l: b.low, c: b.close })),
    sliceFrom: iso(arr[from]!.timestamp), sliceTo: iso(arr[to]!.timestamp),
    userIdxFrom: s, userIdxTo: e,
  });
}
// the slice is expressed from `from`; keep per-card indices relative to the slice
for (const c of cards) {
  const first = bars.get(c.inst)!.find((b) => iso(b.timestamp) === c.sliceFrom)!;
  const fromIdx = bars.get(c.inst)!.indexOf(first);
  c.userIdxFrom -= fromIdx;
  c.userIdxTo -= fromIdx;
  if (c.rep) { c.rep.from -= fromIdx; c.rep.to -= fromIdx; }
}

const hit = cards.filter((c) => c.hitDays > 0).length;
const full = cards.filter((c) => c.rep && c.rep.overlap >= 0.5).length;
console.log(`cards ${cards.length}; 扫描器在你的区间里出过带 ${hit}; 带的过半落在你的区间里 ${full}`);

const cardHtml = (c: Card) => {
  const rep = c.rep;
  const status = rep
    ? (rep.overlap >= 0.5 ? `<i class="ok">扫到了 ✓（带 ${rep.fromDate}→${rep.toDate}，${(rep.overlap * 100).toFixed(0)}% 落在你说的区间里）</i>`
      : `<i class="partial">部分沾到（${(rep.overlap * 100).toFixed(0)}%）</i>`)
    : '<i class="bad">没扫到 ✗</i>';
  return `<section class="card" data-c='${esc(JSON.stringify({ slice: c.slice, uf: c.userIdxFrom, ut: c.userIdxTo, rep: c.rep }))}'>
    <header>
      <b>${esc(c.inst.replace(/USDT$/, ''))} · ${esc(c.userFrom)}${c.open ? ' 起（开放，按 ' + (c.userIdxTo - c.userIdxFrom + 1) + ' 根）' : ' → ' + esc(c.userTo)}</b>
      <span>${c.verdict === 'weak' ? '<i class="weak">你说：一般</i>' : '<i class="good">你说：可以</i>'} ${status}</span>
    </header>
    <div class="note">「${esc(c.quote)}」</div>
    <svg viewBox="0 0 620 190" class="chart"></svg>
    <div class="legend">橙框＝你说的时间段 · 蓝框＝<b>扫描器</b>当天扫出的收敛带（到最新 K 线为止，不是价格箱体）· 蓝框顶/底＝它量到的区间高低</div>
  </section>`;
};

const html = `<!doctype html><html><head><meta charset="utf-8"><title>扫描器扫出的区域 vs 你会关注的时间段</title><style>
body{margin:0;background:#0d1117;color:#c9d1d9;font:13px/1.45 "Microsoft YaHei",system-ui,sans-serif}
h1{font-size:16px;padding:14px 20px 6px;margin:0}
.sub{padding:0 20px 12px;color:#8b949e;font-size:12px;line-height:1.7;border-bottom:1px solid #21262d}
.sub b{color:#c9d1d9}
.sum{display:flex;gap:18px;flex-wrap:wrap;padding:12px 20px;border-bottom:1px solid #21262d}
.sum div{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:8px 14px;min-width:200px}
.sum b{display:block;font-size:20px;color:#e6edf3}
.sum span{font-size:11px;color:#8b949e}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(620px,1fr));gap:14px;padding:14px}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:10px 12px}
.card header{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:11px;color:#8b949e}
.card header b{color:#e6edf3;font-size:13px}
.card i{font-style:normal;margin-left:6px}
i.good{color:#3fb950}i.weak{color:#f0b429}i.ok{color:#3fb950}i.bad{color:#f85149}i.partial{color:#d29922}
.note{font-size:11px;color:#9aa4b2;margin:4px 0;border-left:2px solid #30363d;padding-left:8px}
.legend{font-size:10.5px;color:#6e7681;margin-top:2px}
</style></head><body>
<h1>扫描器扫出的区域 vs 你会关注的时间段（${cards.length} 个区间）</h1>
<div class="sub">
<b>橙框</b>＝你备注里点名的时间段。 <b>蓝框</b>＝现有扫描器 <code>detectConvergence</code> 在你那段日子里每天扫出来的收敛带，取"和你区间重叠最多"的一条画出来。<br>
注意扫描器的"区域"是<b>一条贴着最新 K 线往回数的带</b>（5 根以上，右端永远停在当天）——它不是按价格框出来的图形，所以你看到的蓝框都贴在橙框的右边缘。
</div>
<div class="sum">
  <div><b>${hit}/${cards.length}</b><span>你点名的区间里，扫描器至少有一天扫出过重叠的带</span></div>
  <div><b>${full}/${cards.length}</b><span>其中带有一半以上落在你的区间里（算"真扫到"）</span></div>
</div>
<div class="grid">${cards.map(cardHtml).join('\n')}</div>
<script>
document.querySelectorAll('section.card').forEach(function(card){
  var c = JSON.parse(card.getAttribute('data-c'));
  var svg = card.querySelector('svg');
  var bars = c.slice, W = 620, Hh = 190, padL = 6, padR = 64, padT = 8, padB = 16;
  var n = bars.length; if (!n) return;
  var lo = Math.min.apply(null, bars.map(function(b){return b.l}));
  var hi = Math.max.apply(null, bars.map(function(b){return b.h}));
  if (!(hi > lo)) return;
  var x = function(i){ return padL + (W - padL - padR) * (i / Math.max(1, n - 1)); };
  var y = function(v){ return padT + (Hh - padT - padB) * (1 - (v - lo) / (hi - lo)); };
  var bw = Math.max(1.4, (W - padL - padR) / n * 0.62);
  var out = [];
  bars.forEach(function(b, i){
    var up = b.c >= b.o, col = up ? '#3fb950' : '#f85149';
    out.push('<line x1="'+x(i).toFixed(1)+'" x2="'+x(i).toFixed(1)+'" y1="'+y(b.h).toFixed(1)+'" y2="'+y(b.l).toFixed(1)+'" stroke="'+col+'" stroke-width="1"/>');
    var top = y(Math.max(b.o, b.c)), bot = y(Math.min(b.o, b.c));
    out.push('<rect x="'+(x(i)-bw/2).toFixed(1)+'" y="'+top.toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+Math.max(1, bot-top).toFixed(1)+'" fill="'+col+'"/>');
  });
  // user's range (orange)
  out.push('<rect x="'+(x(c.uf)-bw/2).toFixed(1)+'" y="'+padT+'" width="'+(x(c.ut)-x(c.uf)+bw).toFixed(1)+'" height="'+(Hh-padT-padB)+'" fill="rgba(245,158,11,.10)" stroke="#f59e0b"/>');
  // scanner band (blue) with its own high/low
  if (c.rep) {
    var x1 = x(c.rep.from), x2 = x(c.rep.to);
    out.push('<rect x="'+x1.toFixed(1)+'" y="'+y(c.rep.high).toFixed(1)+'" width="'+(x2-x1+bw).toFixed(1)+'" height="'+(y(c.rep.low)-y(c.rep.high)).toFixed(1)+'" fill="rgba(88,166,255,.12)" stroke="#58a6ff" stroke-width="1.4"/>');
    out.push('<text x="'+((x1+x2)/2).toFixed(1)+'" y="'+(y(c.rep.high)-3).toFixed(1)+'" fill="#58a6ff" font-size="9" text-anchor="middle">扫描带 '+c.rep.fromDate.slice(5)+'→'+c.rep.toDate.slice(5)+' · score '+c.rep.score.toFixed(2)+'</text>');
  }
  out.push('<text x="'+padL+'" y="'+(Hh-3)+'" fill="#8b949e" font-size="9">'+new Date(bars[0].t).toISOString().slice(0,10)+'</text>');
  out.push('<text x="'+(W-padR)+'" y="'+(Hh-3)+'" fill="#8b949e" font-size="9" text-anchor="end">'+new Date(bars[n-1].t).toISOString().slice(0,10)+'</text>');
  svg.innerHTML = out.join('');
});
</script></body></html>`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html, 'utf8');
console.log(`wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
