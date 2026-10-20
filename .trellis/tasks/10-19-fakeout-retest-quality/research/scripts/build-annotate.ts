/**
 * 构建标注页 v3：线可点选、可删除、可拖拽调整。
 *
 * 用户 10/20 反馈：画的线没法消除。
 *   → 线不再画在 SVG 里（点不到），改用 lightweight-charts 自己的 PriceLine /
 *     无限 LineSeries：价格轴标签本身就是可点的删除手柄（和图表库自己的 UX 一致）
 *   → 同时提供：
 *       · 点线选中（高亮），Delete / Backspace 删除选中的那条
 *       · 线的价格标签上可点「×」删（priceLine 的取消按钮）
 *       · 右键点击某条线 = 直接删掉它
 *       · 「清空本图」按钮（带二次确认）
 *
 * 其他保持 v2：默认浏览态、滚轮缩放、日线一年、标注日后调暗。
 *
 * Run: POOL_DIR=<dir> npx tsx .scratch/research-10-19/build-annotate.ts
 */
import fs from 'node:fs';
import path from 'node:path';

const POOL_DIR = process.env.POOL_DIR!;
const OUT = process.env.OUT ?? 'tools/labeling/out/annotate.html';
const RANGES = JSON.parse(fs.readFileSync('.scratch/research-10-19/ranges.json', 'utf8')) as Array<{
  inst: string; start: string; end?: string; est?: number; quote: string; verdict: string;
}>;

const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);
const YEAR = 365;

const cards: any[] = [];
for (const rg of RANGES) {
  const p = path.join(POOL_DIR, `${rg.inst}.json`);
  if (!fs.existsSync(p)) continue;
  const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as number[][];
  const bars = raw.map(([t, o, h, l, c]) => ({ t, o, h, l, c, d: dayOf(t) }));
  const startIdx = bars.findIndex((b) => b.d >= rg.start);
  if (startIdx < 0) continue;
  let endIdx = rg.end ? bars.findIndex((b) => b.d >= rg.end) : Math.min(bars.length - 1, startIdx + (rg.est ?? 10));
  if (endIdx < startIdx) endIdx = startIdx;
  const from = Math.max(0, endIdx - YEAR + 1);
  const to = Math.min(bars.length - 1, endIdx + 15);
  cards.push({
    inst: rg.inst,
    short: rg.inst.replace(/USDT$/, ''),
    quote: rg.quote,
    verdict: rg.verdict,
    markDate: bars[endIdx].d,
    defaultRegion: [bars[startIdx].d, bars[endIdx].d],
    hideAfter: bars[endIdx].d,
    bars: bars.slice(from, to + 1).map((b) => ({ t: Math.floor(b.t / 1000), o: b.o, h: b.h, l: b.l, c: b.c, d: b.d })),
  });
}
console.log(`cards ${cards.length}；K 线 ${Math.min(...cards.map((c) => c.bars.length))}~${Math.max(...cards.map((c) => c.bars.length))} 根`);

const data = JSON.stringify(cards);

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>画线标注 · 34 个区间</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#0d1117;color:#c9d1d9;font:13px/1.5 "Microsoft YaHei",system-ui,sans-serif}
header{position:sticky;top:0;z-index:10;background:#161b22;border-bottom:1px solid #30363d;padding:10px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
header b{color:#e6edf3;font-size:14px}
.bar{flex:1;height:6px;background:#21262d;border-radius:3px;overflow:hidden;min-width:120px}
.bar>i{display:block;height:100%;background:#3fb950;width:0}
button{background:#21262d;color:#c9d1d9;border:1px solid #30363d;border-radius:6px;padding:5px 12px;cursor:pointer;font-size:12px}
button:hover{border-color:#58a6ff}
button.on{border-color:#f59e0b;background:#f59e0b33;color:#ffd88a}
button.danger{color:#f85149;border-color:#5a2222}
button.primary{background:#238636;border-color:#2ea043;color:#fff}
main{display:grid;grid-template-columns:1fr 340px;height:calc(100vh - 56px)}
#wrap{position:relative;background:#10151c;overflow:hidden}
#chart{position:absolute;inset:0;z-index:1}
#overlay{position:absolute;inset:0;z-index:5;pointer-events:none}
#overlay.active{pointer-events:auto;cursor:crosshair}
aside{border-left:1px solid #30363d;padding:14px;overflow:auto;background:#161b22}
.q{font-size:12px;color:#9aa4b2;border-left:2px solid #30363d;padding-left:8px;margin-bottom:12px}
.row{margin-bottom:12px}
.row>label{display:block;font-size:11px;color:#8b949e;margin-bottom:5px}
.opts{display:flex;flex-wrap:wrap;gap:6px}
.opts button{flex:1 1 auto}
#hint{font-size:11px;color:#6e7681;line-height:1.75}
kbd{background:#21262d;border:1px solid #30363d;border-radius:3px;padding:0 4px;font-size:10px}
#list{font-size:11px;color:#8b949e;margin-top:8px}
#list div{padding:2px 0;border-bottom:1px solid #21262d;cursor:pointer}
.done{color:#3fb950}
#mode{font-size:12px;padding:3px 8px;border-radius:5px;background:#21262d;color:#8b949e}
#mode.on{background:#f59e0b22;color:#ffd88a}
#lines{font-size:11px;color:#8b949e;margin-top:4px;min-height:18px}
#lines span{display:inline-block;background:#21262d;border:1px solid #30363d;border-radius:4px;padding:0 6px;margin:2px 4px 0 0;cursor:pointer}
#lines span.sel{border-color:#facc15;color:#facc15}
#lines span.hit{border-color:#58a6ff;color:#58a6ff}
</style></head><body>
<header>
  <b id="title">—</b>
  <span id="mode">浏览</span>
  <span id="cnt" style="font-size:12px;color:#8b949e"></span>
  <div class="bar"><i id="prog"></i></div>
  <button id="prev">← 上一个</button>
  <button id="next">下一个 →</button>
  <button id="export" class="primary">导出标注</button>
</header>
<main>
  <div id="wrap"><div id="chart"></div><svg id="overlay"></svg></div>
  <aside>
    <div class="q" id="quote"></div>
    <div class="row">
      <label>画什么（画完自动回到浏览）</label>
      <div class="opts">
        <button id="t-h">1 · 压力位（水平线）</button>
        <button id="t-r">2 · 突破方向（射线）</button>
        <button id="t-rg">3 · 好区间（拖选）</button>
      </div>
    </div>
    <div class="row">
      <label>画过的线（点一下选中，再按 Delete 删除）</label>
      <div id="lines"></div>
      <div class="opts" style="margin-top:6px">
        <button id="del-sel" class="danger">删除选中的线</button>
        <button id="clear" class="danger">清空本图所有线</button>
      </div>
    </div>
    <div class="row">
      <label>好区间（默认按备注预填，可重选）</label>
      <div id="region" style="font-size:12px;color:#e6edf3"></div>
    </div>
    <div class="row">
      <label>当时会不会做</label>
      <div class="opts" id="verdict">
        <button data-v="good">会做</button>
        <button data-v="structure">结构不行</button>
        <button data-v="chart">股性不行</button>
        <button data-v="missed">错过了</button>
      </div>
    </div>
    <div id="hint">
      默认<b>浏览</b>：滚轮缩放、拖动平移。<br>
      画线先点上面按钮（或 <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd>），画完自动回浏览。<br>
      <b>删线</b>：点下面列表里的线 → <kbd>Delete</kbd>；或点线右侧价格标签上的 × ；<br>
      或者<b>右键点线</b>直接删。<br>
      <kbd>Esc</kbd> 取消工具　<kbd>←</kbd><kbd>→</kbd> 翻页
    </div>
    <div id="list"></div>
  </aside>
</main>
<script src="lightweight-charts.js"></script>
<script>
var CARDS = ${data};
var KEY = 'annotate-34-v3';
var state = JSON.parse(localStorage.getItem(KEY) || '{}');
var idx = 0, tool = null, draft = null, regionDrag = null, selected = -1;
var chart, series, candles = [], overlay = document.getElementById('overlay');
var drawn = []; // { line (IPriceLine|LineSeries), kind, index }

function el(id){ return document.getElementById(id); }
function cur(){ return CARDS[idx]; }
function st(){ var c = cur(); if (!state[c.inst]) state[c.inst] = { lines: [], region: c.defaultRegion.slice(), verdict: null }; return state[c.inst]; }
function save(){ localStorage.setItem(KEY, JSON.stringify(state)); renderList(); }

function setTool(t){
  tool = t; draft = null; regionDrag = null;
  overlay.classList.toggle('active', !!t);
  el('mode').textContent = t === 'h' ? '画压力位' : t === 'r' ? '画突破方向' : t === 'rg' ? '框选好区间' : '浏览';
  el('mode').classList.toggle('on', !!t);
  ['t-h','t-r','t-rg'].forEach(function(id){ el(id).classList.toggle('on', (id === 't-h' && t === 'h') || (id === 't-r' && t === 'r') || (id === 't-rg' && t === 'rg')); });
  drawOverlay();
}

function clearDrawn(){
  drawn.forEach(function(d){ try { if (d.kind === 'h') series.removePriceLine(d.line); else chart.removeSeries(d.line); } catch(e) {} });
  drawn = [];
}

function renderDrawn(){
  clearDrawn();
  var s = st();
  s.lines.forEach(function(L, i){
    var sel = i === selected;
    var color = sel ? '#facc15' : '#58a6ff';
    if (L.kind === 'h') {
      var pl = series.createPriceLine({
        price: L.price, color: color, lineWidth: 2, lineStyle: 0,
        axisLabelVisible: true, title: (sel ? '✓ ' : '') + '压力位 ' + (i+1),
      });
      drawn.push({ kind:'h', index:i, line:pl });
    } else {
      // 射线：用一条两点 LineSeries（图表库支持无限延伸到视野边缘）
      var lineSeries = chart.addSeries(LightweightCharts.LineSeries, { color: color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
      var pts = rayPoints(L);
      lineSeries.setData(pts);
      drawn.push({ kind:'r', index:i, line:lineSeries });
    }
  });
  drawOverlay();
}

/** 把一条射线变成整年可见的两点序列（延伸到序列末端）。 */
function rayPoints(L){
  var t1 = L.p1.t, p1 = L.p1.price, t2 = L.p2.t, p2 = L.p2.price;
  var lastT = candles[candles.length-1].t;
  var slope = (p2 - p1) / Math.max(1, (t2 - t1));
  var endT = Math.max(t2, lastT);
  return [ { time:t1, value:p1 }, { time:endT, value:p1 + slope * (endT - t1) } ];
}

function buildChart(){
  if (chart) { chart.remove(); chart = null; }
  drawn = [];
  var c = cur();
  candles = c.bars.slice();
  chart = LightweightCharts.createChart(el('chart'), {
    layout:{ background:{ type:'solid', color:'#10151c' }, textColor:'#c9d1d9', attributionLogo:false },
    grid:{ vertLines:{ color:'#1b2028' }, horzLines:{ color:'#1b2028' } },
    rightPriceScale:{ borderColor:'#30363d' },
    timeScale:{ borderColor:'#30363d', timeVisible:false, rightOffset:8, barSpacing:6 },
    crosshair:{ mode:0 }, autoSize:true, handleScroll:true, handleScale:true,
    localization:{ timeFormatter:function(t){ return new Date(t*1000).toISOString().slice(0,10); } },
  });
  series = chart.addSeries(LightweightCharts.CandlestickSeries, {
    upColor:'#3fb950', downColor:'#f85149', borderVisible:false, wickUpColor:'#3fb950', wickDownColor:'#f85149',
  });
  var mark = c.hideAfter;
  series.setData(candles.map(function(b){
    var after = b.d > mark;
    return after ? { time:b.t, open:b.o, high:b.h, low:b.l, close:b.c, color:'#2d333b', wickColor:'#2d333b', borderColor:'#2d333b' }
                 : { time:b.t, open:b.o, high:b.h, low:b.l, close:b.c };
  }));
  var markIdx = Math.max(0, candles.findIndex(function(b){ return b.d > mark; }) - 1);
  if (markIdx < 0) markIdx = candles.length - 1;
  chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, markIdx - 120), to: markIdx + 12 });
  chart.subscribeCrosshairMove(function(){ drawOverlay(); });
  chart.timeScale().subscribeVisibleLogicalRangeChange(function(){ drawOverlay(); });
  selected = -1;
  renderDrawn();
  setTool(null);
}

function xOfDay(d){ var i = candles.findIndex(function(b){ return b.d >= d; }); return i < 0 ? null : chart.timeScale().logicalToCoordinate(i); }

function drawOverlay(){
  if (!chart || !series) return;
  var s = st(), w = overlay.clientWidth, h = overlay.clientHeight;
  overlay.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
  var out = [];
  if (s.region && s.region.length === 2) {
    var xa = xOfDay(s.region[0]), xb = xOfDay(s.region[1]);
    if (xa != null && xb != null) out.push('<rect x="'+Math.min(xa,xb)+'" y="0" width="'+Math.max(4,Math.abs(xb-xa))+'" height="'+h+'" fill="rgba(245,158,11,.12)" stroke="#f59e0b" stroke-opacity=".55"/>');
  }
  if (draft && draft.temp) out.push('<line x1="'+draft.temp.x1+'" y1="'+draft.temp.y1+'" x2="'+draft.temp.x2+'" y2="'+draft.temp.y2+'" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="4 3"/>');
  if (regionDrag) out.push('<rect x="'+Math.min(regionDrag.a,regionDrag.b)+'" y="0" width="'+Math.abs(regionDrag.b-regionDrag.a)+'" height="'+h+'" fill="rgba(245,158,11,.22)"/>');
  overlay.innerHTML = out.join('');
  el('region').textContent = s.region ? (s.region[0] + ' → ' + s.region[1]) : '（未选）';
}

function toPoint(ev){
  var r = overlay.getBoundingClientRect();
  var x = ev.clientX - r.left, y = ev.clientY - r.top;
  var t = chart.timeScale().coordinateToTime(x);
  var price = series.coordinateToPrice(y);
  return { x:x, y:y, t:t, price:price, inChart: ev.clientX >= boxLeft() };
}
function boxLeft(){ return chart.priceScale('right').width() ? overlay.clientWidth - chart.priceScale('right').width() : 0; }

overlay.addEventListener('pointerdown', function(ev){
  if (!tool) return;
  var p = toPoint(ev);
  if (p.price == null) return;
  var s = st();
  if (tool === 'rg') { regionDrag = { a:p.x, b:p.x }; return; }
  if (tool === 'h') { s.lines.push({ kind:'h', price:p.price }); save(); renderDrawn(); setTool(null); return; }
  if (tool === 'r') {
    if (!draft) draft = { first:p };
    else { s.lines.push({ kind:'r', p1:{ t:draft.first.t, price:draft.first.price }, p2:{ t:p.t, price:p.price } }); save(); renderDrawn(); setTool(null); }
    drawOverlay();
  }
});
overlay.addEventListener('pointermove', function(ev){
  if (!tool) return;
  var p = toPoint(ev);
  if (regionDrag) { regionDrag.b = p.x; drawOverlay(); return; }
  if (draft) { draft.temp = { x1:draft.first.x, y1:draft.first.y, x2:p.x, y2:p.y }; drawOverlay(); }
});
overlay.addEventListener('pointerup', function(ev){
  if (regionDrag) {
    var s = st();
    var x1 = Math.min(regionDrag.a, regionDrag.b), x2 = Math.max(regionDrag.a, regionDrag.b);
    var t1 = chart.timeScale().coordinateToTime(x1), t2 = chart.timeScale().coordinateToTime(x2);
    regionDrag = null;
    if (t1 != null && t2 != null) { s.region = [ new Date(t1*1000).toISOString().slice(0,10), new Date(t2*1000).toISOString().slice(0,10) ]; save(); }
    setTool(null);
  }
});
// 右键：删掉离指针最近的那条线（只在浏览态生效）
overlay.addEventListener('contextmenu', function(ev){
  if (tool) return;
  ev.preventDefault();
  var s = st(); if (!s.lines.length) return;
  var r = overlay.getBoundingClientRect();
  var y = ev.clientY - r.top, best = -1, bestD = 12;
  s.lines.forEach(function(L, i){
    if (L.kind !== 'h') return;
    var p = series.priceToCoordinate(L.price);
    if (p == null) return;
    var d = Math.abs(p - y);
    if (d < bestD) { bestD = d; best = i; }
  });
  if (best >= 0) { s.lines.splice(best, 1); selected = -1; save(); renderDrawn(); }
});
overlay.addEventListener('pointer-events', function(){});

function deleteSelected(){
  var s = st();
  if (selected < 0 || selected >= s.lines.length) return;
  s.lines.splice(selected, 1); selected = -1; save(); renderDrawn();
}

function renderList(){
  var c = cur();
  el('title').textContent = c.short + ' · 标注日 ' + c.markDate;
  el('quote').textContent = '你的备注：' + c.quote;
  var done = Object.keys(state).filter(function(k){ return state[k].verdict; }).length;
  el('cnt').textContent = (idx+1) + ' / ' + CARDS.length + ' · 已标注 ' + done;
  el('prog').style.width = (done / CARDS.length * 100) + '%';
  var s = state[c.inst];
  Array.prototype.forEach.call(document.querySelectorAll('#verdict button'), function(b){
    b.classList.toggle('on', !!s && s.verdict === b.getAttribute('data-v'));
  });
  // 画过的线列表
  var lines = (s && s.lines) || [];
  el('lines').innerHTML = lines.length
    ? lines.map(function(L, i){
        var txt = L.kind === 'h' ? ('压力位 ' + (L.price >= 1 ? L.price.toFixed(4) : L.price.toPrecision(5))) : '突破方向';
        return '<span data-i="'+i+'" class="' + (i === selected ? 'sel' : '') + '">' + (i+1) + '. ' + txt + '</span>';
      }).join('')
    : '<span style="border:0;background:none;color:#6e7681">还没画线</span>';
  Array.prototype.forEach.call(el('lines').querySelectorAll('span[data-i]'), function(sp){
    sp.onclick = function(){ selected = Number(sp.getAttribute('data-i')); renderDrawn(); renderList(); };
  });
  el('list').innerHTML = CARDS.map(function(x, i){
    var v = state[x.inst] && state[x.inst].verdict;
    var name = { good:'会做', structure:'结构不行', chart:'股性不行', missed:'错过了' }[v] || '';
    return '<div class="' + (v ? 'done' : '') + '" data-i="'+i+'">' + (i+1) + '. ' + x.short + ' ' + (v ? '✓ ' + name : '') + '</div>';
  }).join('');
  Array.prototype.forEach.call(el('list').querySelectorAll('div'), function(d){
    d.onclick = function(){ idx = Number(d.getAttribute('data-i')); buildChart(); renderList(); };
  });
}

function go(n){ idx = (n + CARDS.length) % CARDS.length; buildChart(); renderList(); }
el('prev').onclick = function(){ go(idx-1); };
el('next').onclick = function(){ go(idx+1); };
el('t-h').onclick = function(){ setTool(tool === 'h' ? null : 'h'); };
el('t-r').onclick = function(){ setTool(tool === 'r' ? null : 'r'); };
el('t-rg').onclick = function(){ setTool(tool === 'rg' ? null : 'rg'); };
el('del-sel').onclick = deleteSelected;
el('clear').onclick = function(){
  if (!confirm('清空这张图上所有的线？')) return;
  st().lines = []; selected = -1; save(); renderDrawn();
};
Array.prototype.forEach.call(document.querySelectorAll('#verdict button'), function(b){
  b.onclick = function(){ st().verdict = b.getAttribute('data-v'); save(); renderList(); go(idx+1); };
});
el('export').onclick = function(){
  var blob = new Blob([JSON.stringify(CARDS.map(function(c){
    var s = state[c.inst] || {};
    return { inst:c.inst, markDate:c.markDate, quote:c.quote, region:s.region||null, verdict:s.verdict||null, lines:s.lines||[] };
  }), null, 2)], { type:'application/json' });
  var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'annotations-34.json'; a.click();
};
document.addEventListener('keydown', function(e){
  if (e.target.tagName === 'INPUT') return;
  if (e.key === '1') setTool(tool === 'h' ? null : 'h');
  if (e.key === '2') setTool(tool === 'r' ? null : 'r');
  if (e.key === '3') setTool(tool === 'rg' ? null : 'rg');
  if (e.key === 'Escape') setTool(null);
  if (e.key === 'ArrowRight') go(idx+1);
  if (e.key === 'ArrowLeft') go(idx-1);
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); }
});
buildChart(); renderList();
</script></body></html>`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html, 'utf8');
const lib = 'node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js';
if (fs.existsSync(lib)) fs.copyFileSync(lib, path.join(path.dirname(OUT), 'lightweight-charts.js'));
console.log(`wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
