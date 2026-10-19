/**
 * 检查器 v2 的结果页：34 个区间，每个画一条 90 根的窗口，
 * 把"扫描器认出来的那段两条边"画出来，你直接看对不对。
 *
 * 蓝边 = 上边界/下边界（拟合出来的两条线，不是最高/最低）
 * 橙区 = 你备注里说的那几天
 *
 * Run: POOL_DIR=<dir> OUT=<html> node <this>
 */
import fs from 'node:fs';
import path from 'node:path';

const POOL_DIR = process.env.POOL_DIR;
const OUT = process.env.OUT ?? 'tools/labeling/out/checker2.html';
const iso = (t) => new Date(t).toISOString().slice(0, 10);

const bars = new Map();
for (const f of fs.readdirSync(POOL_DIR)) {
  if (!f.endsWith('.json')) continue;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(POOL_DIR, f), 'utf8'));
    if (Array.isArray(raw) && raw.length >= 60) bars.set(f.replace(/\.json$/, ''), raw.map(([t, o, h, l, c]) => ({ t, o, h, l, c })));
  } catch { /* skip */ }
}

// re-run the same search the checker uses, but keep the fitted band so the page can draw it
const MIN_BARS = 3;
const MAX_BARS = 90;
const LOOKBACK = 20;
const RALLY = 0.2;
const MAX_BAND_VS_MOVE = 0.8;
const MIN_SWITCH = 2;

const fitLine = (vals) => {
  const n = vals.length;
  const mx = (n - 1) / 2;
  const my = vals.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (i - mx) * (vals[i] - my); den += (i - mx) ** 2; }
  const slope = den === 0 ? 0 : num / den;
  return { slope, intercept: my };
};
function bandShape(seg) {
  const n = seg.length;
  const up = fitLine(seg.map((b) => b.h));
  const lo = fitLine(seg.map((b) => b.l));
  const at = (line, i) => line.intercept + line.slope * (i - (n - 1) / 2);
  const widthAt = (i) => at(up, i) - at(lo, i);
  if (!(widthAt(0) > 0) || !(widthAt(n - 1) > 0)) return null;
  if (widthAt(n - 1) > widthAt(0) * 1.15) return null;
  let switches = 0, prev = 0, upT = 0, downT = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.max(1e-9, widthAt(i));
    const nearUp = (at(up, i) - seg[i].h) / w <= 0.25;
    const nearDown = (seg[i].l - at(lo, i)) / w <= 0.25;
    const side = nearUp && !nearDown ? 1 : nearDown && !nearUp ? -1 : 0;
    if (side === 1) upT++; if (side === -1) downT++;
    if (side !== 0 && side !== prev) { if (prev !== 0) switches++; prev = side; }
  }
  if (upT < 1 || downT < 1 || switches < MIN_SWITCH) return null;
  return { up, lo, widthStart: widthAt(0), widthEnd: widthAt(n - 1), switches, at };
}
const idxAtOrBefore = (arr, date) => {
  const t = Date.parse(`${date}T00:00:00Z`) + 86_399_999;
  let best = -1;
  for (let i = 0; i < arr.length; i++) if (arr[i].t <= t) best = i;
  return best;
};
function findBox(arr, E, targetFrom) {
  let best = null;
  for (let len = MIN_BARS; len <= MAX_BARS && len <= E + 1; len++) {
    const from = E - len + 1;
    const seg = arr.slice(from, E + 1);
    const shape = bandShape(seg);
    if (!shape) continue;
    const avgW = (shape.widthStart + shape.widthEnd) / 2;
    const lead = arr.slice(Math.max(0, from - LOOKBACK), from);
    if (lead.length < 5) continue;
    const ll = Math.min(...lead.map((b) => b.l));
    const lh = Math.max(...lead.map((b) => b.h));
    const rally = lh / ll - 1;
    if (rally < RALLY) continue;
    if ((lh - ll) > 0 && avgW > (lh - ll) * MAX_BAND_VS_MOVE) continue;
    const last = arr[E];
    if (last.c > shape.at(shape.up, len - 1) * 1.005 || last.c < shape.at(shape.lo, len - 1) * 0.995) continue;
    const cand = { from, to: E, len, rally, shape, avgW, covers: targetFrom !== null && from <= targetFrom };
    if (!best || cand.len < best.len && cand.covers || (!best.covers && cand.covers)) {
      if (!best) best = cand;
      else if (cand.covers && !best.covers) best = cand;
      else if (cand.covers === best.covers && cand.len < best.len) best = cand;
    }
  }
  return best;
}

const RANGES = JSON.parse(fs.readFileSync('.scratch/research-10-19/ranges.json', 'utf8'));
const cards = [];
for (const rg of RANGES) {
  const arr = bars.get(rg.inst);
  if (!arr) continue;
  const s = idxAtOrBefore(arr, rg.start);
  const e = rg.end ? Math.max(s, idxAtOrBefore(arr, rg.end)) : Math.min(arr.length - 1, s + (rg.est ?? 10));
  let best = null;
  for (let E = Math.max(MAX_BARS, s); E <= e; E++) {
    const box = findBox(arr, E, s);
    if (!box) continue;
    const ov = Math.max(0, Math.min(box.to, e) - Math.max(box.from, s) + 1) / (e - s + 1);
    if (!best || ov > best.ov) best = { ...box, ov, on: E };
  }
  const from = Math.max(0, (best ? best.from : s) - 45);
  const to = Math.min(arr.length - 1, (best ? best.to : e) + 10);
  const slice = arr.slice(from, to + 1);
  const upper = best ? slice.map((b, i) => best.shape.at(best.shape.up, Math.min(best.len - 1, Math.max(0, from + i - best.from)))) : null;
  const lower = best ? slice.map((b, i) => best.shape.at(best.shape.lo, Math.min(best.len - 1, Math.max(0, from + i - best.from)))) : null;
  cards.push({
    inst: rg.inst.replace(/USDT$/, ''),
    quote: rg.quote,
    verdict: rg.verdict,
    userFrom: iso(arr[s].t),
    userTo: iso(arr[e].t),
    open: !rg.end,
    userIdx: [s - from, e - from],
    boxIdx: best ? [best.from - from, best.to - from] : null,
    len: best ? best.len : 0,
    ov: best ? best.ov : 0,
    upper, lower,
    bars: slice.map((b) => ({ d: iso(b.t), o: b.o, h: b.h, l: b.l, c: b.c })),
  });
}

const cells = cards.map((c, i) => {
  const ok = c.ov >= 0.5;
  return `<section class="card ${ok ? 'hit' : 'miss'}">
    <header><b>${c.inst} · ${c.userFrom}${c.open ? ' 起' : '→' + c.userTo}</b>
      <span>${c.verdict === 'weak' ? '你说：一般' : '你说：可以'} · ${ok ? `扫到 ${c.len} 根（覆盖 ${(c.ov * 100).toFixed(0)}%）` : '没扫到'}</span></header>
    <div class="q">${c.quote}</div>
    <svg id="c${i}" viewBox="0 0 620 170"></svg>
  </section>`;
}).join('\n');

const html = `<!doctype html><html><head><meta charset="utf-8"><title>检查器 v2 · 扫到的段对不对</title><style>
body{margin:0;background:#0d1117;color:#c9d1d9;font:13px/1.45 "Microsoft YaHei",system-ui,sans-serif}
h1{font-size:15px;padding:12px 20px 4px;margin:0}
.sub{padding:0 20px 12px;color:#8b949e;font-size:12px;border-bottom:1px solid #21262d}
.grid{padding:14px;display:grid;grid-template-columns:repeat(auto-fit,minmax(560px,1fr));gap:14px}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:8px 10px}
.card.hit{border-color:#1f6f43}.card.miss{border-color:#7d2a2a;opacity:.85}
.card header{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;font-size:11px;color:#8b949e}
.card header b{color:#e6edf3;font-size:12.5px}
.q{font-size:10.5px;color:#9aa4b2;margin:2px 0 4px}
svg{width:100%;height:170px;display:block}
</style></head><body>
<h1>检查器 v2 · 认出来的段（蓝边 = 拟合的上/下边界，橙区 = 你说的那几天）</h1>
<div class="sub">34 个区间，${cards.filter((c) => c.ov >= 0.5).length} 个覆盖 ≥50%（旧扫描器 16 个）。看蓝边有没有包住橙区、有没有把一段上涨认成横盘。</div>
<div class="grid">${cells}</div>
<script>
var CARDS = ${JSON.stringify(cards)};
CARDS.forEach(function(c, i){
  var svg = document.getElementById('c'+i);
  var bs = c.bars, W = 620, H = 170, pl = 6, pr = 52, pt = 6, pb = 14;
  var n = bs.length;
  var lo = Math.min.apply(null, bs.map(function(b){return b.l}));
  var hi = Math.max.apply(null, bs.map(function(b){return b.h}));
  if (c.upper) { for (var i2=0;i2<c.upper.length;i2++){ hi = Math.max(hi, c.upper[i2]); lo = Math.min(lo, c.lower[i2]); } }
  var x = function(i){ return pl + (W-pl-pr) * (i / Math.max(1,n-1)); };
  var y = function(v){ return pt + (H-pt-pb) * (1 - (v-lo)/Math.max(1e-9, hi-lo)); };
  var bw = Math.max(1.2, (W-pl-pr)/n*0.6);
  var o = [];
  o.push('<rect x="'+x(c.userIdx[0])+'" y="'+pt+'" width="'+Math.max(2, x(c.userIdx[1])-x(c.userIdx[0]))+'" height="'+(H-pt-pb)+'" fill="rgba(245,158,11,.12)" stroke="#f59e0b" stroke-opacity=".6"/>');
  if (c.boxIdx) {
    for (var k=c.boxIdx[0]; k<=c.boxIdx[1]; k++) {
      o.push('<path d="M'+x(k)+' '+y(c.upper[k])+' L'+x(k+1)+' '+y(c.upper[k+1]).toFixed(1)+'" stroke="#58a6ff" fill="none" stroke-width="1.2"/>');
      o.push('<path d="M'+x(k)+' '+y(c.lower[k])+' L'+x(k+1)+' '+y(c.lower[k+1]).toFixed(1)+'" stroke="#58a6ff" fill="none" stroke-width="1.2"/>');
    }
  }
  bs.forEach(function(b, i){
    var up = b.c >= b.o, col = up ? '#3fb950' : '#f85149';
    o.push('<line x1="'+x(i)+'" x2="'+x(i)+'" y1="'+y(b.h).toFixed(1)+'" y2="'+y(b.l).toFixed(1)+'" stroke="'+col+'"/>');
    var t = y(Math.max(b.o,b.c)), bb = y(Math.min(b.o,b.c));
    o.push('<rect x="'+(x(i)-bw/2).toFixed(1)+'" y="'+t.toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+Math.max(1,bb-t).toFixed(1)+'" fill="'+col+'"/>');
  });
  o.push('<text x="'+pl+'" y="'+(H-2)+'" fill="#6e7681" font-size="9">'+bs[0].d+'</text>');
  o.push('<text x="'+(W-pr)+'" y="'+(H-2)+'" fill="#6e7681" font-size="9" text-anchor="end">'+bs[n-1].d+'</text>');
  svg.setAttribute('viewBox','0 0 620 170');
  svg.innerHTML = o.join('');
});
</script></body></html>`;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html, 'utf8');
console.log(`wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB), cards ${cards.length}`);
