/**
 * 验证页：最近 3 天粗筛出来的币，把「算法认的顶」画在图上。
 *
 * 用户 10/20：不看命中率，只看"算法给的顶对不对"。
 *   - 图上画：算法认的顶（水平虚线 + 标注）、掉下来的低点、现在这段的横盘区间
 *   - 每张卡下面有两个按钮：顶对了 / 顶错了
 *   - 结果存 localStorage，可导出，用来算"顶的准确率"
 *
 * Run: POOL_DIR=<dir> npx tsx .scratch/research-10-19/build-peak-check.ts
 */
import fs from 'node:fs';
import path from 'node:path';

const POOL_DIR = process.env.POOL_DIR!;
const OUT = process.env.OUT ?? 'tools/labeling/out/peak-check.html';
const DAYS = Number(process.env.DAYS ?? 3);
const MAX_PER_DAY = Number(process.env.MAX_PER_DAY ?? 12);

const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);
const cls = JSON.parse(fs.readFileSync('.scratch/research-10-19/market-class.json', 'utf8'));
const cryptoSet = new Set(cls.crypto);

const bars = new Map<string, any[]>();
for (const f of fs.readdirSync(POOL_DIR)) {
  if (!f.endsWith('.json')) continue;
  const inst = f.replace(/\.json$/, '');
  if (!cryptoSet.has(inst)) continue;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(POOL_DIR, f), 'utf8')) as number[][];
    if (Array.isArray(raw) && raw.length >= 200) {
      bars.set(inst, raw.map(([t, o, h, l, c]) => ({ t: Math.floor(t / 1000), o, h, l, c, d: dayOf(t) })));
    }
  } catch { /* skip */ }
}

function atrPct(arr: any[], E: number, n = 20) {
  let s = 0, k = 0;
  for (let i = Math.max(1, E - n + 1); i <= E; i++) {
    const tr = Math.max(arr[i].h - arr[i].l, Math.abs(arr[i].h - arr[i - 1].c), Math.abs(arr[i].l - arr[i - 1].c));
    s += tr / arr[i].c; k++;
  }
  return k ? s / k : 0.02;
}

/** 与 scan-market5 同一判据：顶 = 掉下来那段的起点。 */
function evaluate(arr: any[], E: number) {
  if (E < 60) return null;
  const atr = atrPct(arr, E) * arr[E].c;
  const price = arr[E].c;
  const from = Math.max(0, E - 90);
  let P = -Infinity, pAt = -1;
  for (let i = from; i <= E - 3; i++) if (arr[i].h > P) { P = arr[i].h; pAt = i; }
  if (pAt < 0) return null;
  let L = Infinity, lAt = pAt;
  for (let i = pAt + 1; i <= E; i++) if (arr[i].l < L) { L = arr[i].l; lAt = i; }
  if (!(L < Infinity) || !(P > L)) return null;
  const dropUnits = (P - L) / atr;
  if (dropUnits > 12 || dropUnits < 0.5) return null;
  const recall = (price - L) / (P - L);
  if (recall < 0.5 || price >= P) return null;
  const gap = (P - Math.max(price, arr[E].h)) / atr;
  if (gap > 1.5) return null;
  for (let len = 3; len <= 6; len++) {
    const s0 = E - len + 1;
    if (s0 <= lAt) break;
    const seg = arr.slice(s0, E + 1);
    const hi = Math.max(...seg.map((b) => b.h));
    const lo = Math.min(...seg.map((b) => b.l));
    const width = (hi - lo) / atr;
    if (width <= 2.5 && price >= lo) {
      return { len, P, L, pAt, lAt, gap, recall, width, dropUnits, s0 };
    }
  }
  return null;
}

// 最近几天，从后往前
const lastDate = [...bars.values()].map((a) => a[a.length - 1].d).sort().pop()!;
const allDates = [...new Set([...bars.values()].flatMap((a) => a.map((b) => b.d)))].sort();
const targetDates = allDates.filter((d) => d <= lastDate).slice(-DAYS);
console.log('目标日期：', targetDates.join(', '));

const cards: any[] = [];
for (const date of targetDates) {
  const found: any[] = [];
  for (const [inst, arr] of bars) {
    const E = arr.findIndex((b) => b.d === date);
    if (E < 60) continue;
    const r = evaluate(arr, E);
    if (r) found.push({ inst, E, ...r });
  }
  found.sort((a, b) => a.gap - b.gap);
  for (const f of found.slice(0, MAX_PER_DAY)) {
    const arr = bars.get(f.inst)!;
    const from = Math.max(0, f.pAt - 40);
    const slice = arr.slice(from, Math.min(arr.length - 1, f.E + 3));
    cards.push({
      inst: f.inst.replace(/USDT$/, ''),
      date,
      peak: f.P,
      peakDate: arr[f.pAt].d,
      low: f.L,
      lowDate: arr[f.lAt].d,
      gap: +f.gap.toFixed(2),
      recall: +(f.recall * 100).toFixed(0),
      width: +f.width.toFixed(1),
      segFrom: arr[f.s0].d,
      bars: slice.map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, d: b.d })),
      markIdx: f.E - from,
      peakIdx: f.pAt - from,
      segFromIdx: f.s0 - from,
    });
  }
}
console.log(`生成 ${cards.length} 张卡（${targetDates.length} 天）`);

const html = `<!doctype html><html><head><meta charset="utf-8"><title>算法的顶对不对</title><style>
body{margin:0;background:#0d1117;color:#c9d1d9;font:13px/1.5 "Microsoft YaHei",system-ui,sans-serif}
header{position:sticky;top:0;z-index:10;background:#161b22;border-bottom:1px solid #30363d;padding:10px 16px;display:flex;gap:12px;align-items:center}
header b{color:#e6edf3}
.bar{flex:1;height:6px;background:#21262d;border-radius:3px;overflow:hidden}
.bar>i{display:block;height:100%;background:#3fb950;width:0}
button{background:#21262d;color:#c9d1d9;border:1px solid #30363d;border-radius:6px;padding:5px 12px;cursor:pointer;font-size:12px}
button:hover{border-color:#58a6ff}
button.ok.on{background:#238636;border-color:#2ea043;color:#fff}
button.bad.on{background:#8b2c2c;border-color:#c0392b;color:#fff}
.grid{padding:14px;display:grid;grid-template-columns:repeat(auto-fit,minmax(560px,1fr));gap:14px}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:10px 12px}
.card.ok{border-color:#2ea043}
.card.bad{border-color:#c0392b}
.card header{position:static;background:none;border:0;padding:0;display:flex;justify-content:space-between;font-size:12px;color:#8b949e;margin-bottom:4px}
.card header b{color:#e6edf3;font-size:13px}
.meta{font-size:11px;color:#8b949e;margin-bottom:6px}
.btns{display:flex;gap:8px;margin-top:6px}
svg{width:100%;height:190px;display:block}
</style></head><body>
<header>
  <b>算法认的顶对不对</b>
  <span id="cnt" style="font-size:12px;color:#8b949e"></span>
  <div class="bar"><i id="prog"></i></div>
  <button id="export" style="background:#238636;border-color:#2ea043;color:#fff">导出</button>
</header>
<div style="padding:8px 16px;color:#8b949e;font-size:12px;border-bottom:1px solid #21262d">
黄虚线 = 算法认的顶 · 蓝色阴影 = 掉下来那段 · 橙框 = 现在横住的几根 ·
底部虚线 = 掉下来的低点 · 灰柱 = 之后的数据（你没到那天，只作参考）
</div>
<div class="grid">${cards.map((c, i) => `
  <section class="card" id="c${i}">
    <header><b>${c.inst} · ${c.date}</b><span>离顶 ${c.gap} 波动 · 已涨回 ${c.recall}% · 横盘 ${c.width} 波动</span></header>
    <div class="meta">顶在 ${c.peakDate}（${c.peak}）· 掉到 ${c.lowDate} 的低点（${c.low}）</div>
    <svg class="chart" data-i="${i}"></svg>
    <div class="btns">
      <button class="ok" data-i="${i}" data-v="ok">顶对了 ✓</button>
      <button class="bad" data-i="${i}" data-v="bad">顶错了 ✗</button>
    </div>
  </section>`).join('\n')}
</div>
<script>
var CARDS = ${JSON.stringify(cards)};
var KEY = 'peak-check-v1';
var state = JSON.parse(localStorage.getItem(KEY) || '{}');
document.querySelectorAll('svg.chart').forEach(function(svg){
  var i = +svg.getAttribute('data-i'), c = CARDS[i];
  var W = 600, H = 190, pl = 6, pr = 62, pt = 8, pb = 16;
  var bs = c.bars, n = bs.length;
  var lo = Math.min.apply(null, bs.map(function(b){return b.l}));
  var hi = Math.max.apply(null, bs.map(function(b){return b.h}));
  var x = function(k){ return pl + (W-pl-pr) * (k / Math.max(1, n-1)); };
  var y = function(v){ return pt + (H-pt-pb) * (1 - (v-lo)/Math.max(1e-9, hi-lo)); };
  var bw = Math.max(1.2, (W-pl-pr)/n*0.6);
  var o = [];
  // 掉下来那段（顶 → 低点）
  o.push('<rect x="'+x(c.peakIdx)+'" y="'+pt+'" width="'+(x(c.lAt||c.peakIdx)-x(c.peakIdx))+'" height="'+(H-pt-pb)+'" fill="rgba(88,166,255,.10)"/>');
  // 现在横住那几根
  o.push('<rect x="'+x(c.segFromIdx)+'" y="'+pt+'" width="'+(x(c.markIdx)-x(c.segFromIdx))+'" height="'+(H-pt-pb)+'" fill="rgba(245,158,11,.16)" stroke="#f59e0b" stroke-opacity=".6"/>');
  // K 线
  bs.forEach(function(b, k){
    var after = k > c.markIdx;
    var up = b.c >= b.o;
    var col = after ? '#3a4048' : (up ? '#3fb950' : '#f85149');
    o.push('<line x1="'+x(k)+'" x2="'+x(k)+'" y1="'+y(b.h)+'" y2="'+y(b.l)+'" stroke="'+col+'"/>');
    var t = y(Math.max(b.o,b.c)), bb = y(Math.min(b.o,b.c));
    o.push('<rect x="'+(x(k)-bw/2)+'" y="'+t+'" width="'+bw+'" height="'+Math.max(1,bb-t)+'" fill="'+col+'"/>');
  });
  // 顶线
  o.push('<line x1="0" x2="'+(W-pr)+'" y1="'+y(c.peak)+'" y2="'+y(c.peak)+'" stroke="#facc15" stroke-width="1.6" stroke-dasharray="5 3"/>');
  o.push('<text x="'+(W-pr+4)+'" y="'+(y(c.peak)+3)+'" fill="#facc15" font-size="10">顶 '+c.peak+'</text>');
  // 低点
  o.push('<line x1="'+x(c.peakIdx)+'" x2="'+(W-pr)+'" y1="'+y(c.low)+'" y2="'+y(c.low)+'" stroke="#8b949e" stroke-dasharray="2 3"/>');
  o.push('<text x="'+(W-pr+4)+'" y="'+(y(c.low)+3)+'" fill="#8b949e" font-size="10">低 '+c.low+'</text>');
  // 日期
  o.push('<text x="'+pl+'" y="'+(H-3)+'" fill="#6e7681" font-size="9">'+bs[0].d+'</text>');
  o.push('<text x="'+(W-pr)+'" y="'+(H-3)+'" fill="#6e7681" font-size="9" text-anchor="end">'+bs[n-1].d+'</text>');
  svg.innerHTML = o.join('');
});
function render(){
  var done = Object.keys(state).length;
  document.getElementById('cnt').textContent = done + ' / ' + CARDS.length;
  document.getElementById('prog').style.width = (done / CARDS.length * 100) + '%';
  document.querySelectorAll('.card').forEach(function(el, i){ el.classList.remove('ok','bad'); });
  document.querySelectorAll('button[data-v]').forEach(function(b){
    var i = +b.getAttribute('data-i'), v = b.getAttribute('data-v');
    b.classList.remove('on');
    if (state[CARDS[i].inst + '@' + CARDS[i].date] === v) {
      b.classList.add('on');
      document.getElementById('c'+i).classList.add(v);
    }
  });
}
document.querySelectorAll('button[data-v]').forEach(function(b){
  b.onclick = function(){
    var i = +b.getAttribute('data-i');
    state[CARDS[i].inst + '@' + CARDS[i].date] = b.getAttribute('data-v');
    localStorage.setItem(KEY, JSON.stringify(state));
    render();
  };
});
document.getElementById('export').onclick = function(){
  var out = CARDS.map(function(c){ return { inst:c.inst, date:c.date, peak:c.peak, peakDate:c.peakDate, verdict: state[c.inst+'@'+c.date] || null }; });
  var blob = new Blob([JSON.stringify(out, null, 2)], {type:'application/json'});
  var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download='peak-check.json'; a.click();
};
render();
</script></body></html>`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html, 'utf8');
console.log(`wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
