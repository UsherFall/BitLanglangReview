/**
 * 标注页 v4：修 bug + 多区间。
 *
 * Bug 1（最严重）：同一只币的多张卡片共用一条"好区间"（state[inst] 全局唯一），
 *   于是 WAL/INIT/XMR/OP/ZEC 的两张卡互相覆盖。
 *   → 改成 每张卡片独立存档（键 = inst + '|' + markDate）
 * Bug 2：只能框一段。
 *   → 改成 可框多段（ZEC 5-20~8-17 与 8-26~9-01 各一段），每段独立画线、独立结论
 * Bug 3：预填区间与手画的区间无法区分。
 *   → 导出时带 source: 'prefilled' | 'edited'
 * Bug 4：线不知道属于哪一段。
 *   → 线挂在"当前选中的段"上
 *
 * 数据兼容：读取 v3 的 localStorage（key 'annotate-34-v3'）时，
 *   每张卡片按 markDate 导入原有的 region / lines / verdict，作为这一段的初值。
 *   **再也不会丢已经标过的 18 个**（已另存 research/labels/annotations-2026-10-20-batch1.json）。
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
    markDate: bars[endIdx].d,
    defaultRegion: [bars[startIdx].d, bars[endIdx].d],
    hideAfter: bars[endIdx].d,
    bars: bars.slice(from, to + 1).map((b) => ({ t: Math.floor(b.t / 1000), o: b.o, h: b.h, l: b.l, c: b.c, d: b.d })),
  });
}
console.log(`cards ${cards.length}`);

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
main{display:grid;grid-template-columns:1fr 360px;height:calc(100vh - 56px)}
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
.seg{border:1px solid #30363d;border-radius:6px;padding:6px 8px;margin-bottom:6px;cursor:pointer}
.seg.sel{border-color:#f59e0b;background:#f59e0b12}
.seg b{font-size:12px;color:#e6edf3}
.seg .meta{font-size:11px;color:#8b949e;margin-top:2px}
.seg .lines{font-size:10.5px;color:#6e7681;margin-top:3px}
.seg .lines span{display:inline-block;background:#21262d;border:1px solid #30363d;border-radius:3px;padding:0 5px;margin:1px 3px 0 0}
.seg .lines span.sel{border-color:#facc15;color:#facc15}
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
        <button id="t-rg">3 · 新增一段好区间（拖选）</button>
      </div>
    </div>
    <div class="row">
      <label>这张图上的好区间（每段独立画线、独立结论）</label>
      <div id="segments"></div>
      <div class="opts" style="margin-top:6px">
        <button id="del-seg" class="danger">删除选中的段</button>
        <button id="clear-lines" class="danger">清空本图所有线</button>
      </div>
    </div>
    <div class="row">
      <label>选中段：当时会不会做</label>
      <div class="opts" id="verdict">
        <button data-v="good">会做</button>
        <button data-v="structure">结构不行</button>
        <button data-v="chart">股性不行</button>
        <button data-v="missed">错过了</button>
      </div>
    </div>
    <div id="hint">
      默认<b>浏览</b>：滚轮缩放、拖动平移。<br>
      画线先点按钮（或 <kbd>1</kbd><kbd>2</kbd>）；按 <kbd>3</kbd> 拖选一段新增区间。<br>
      画的线挂在<b>当前选中的段</b>上；删线：选段里的线标签 → <kbd>Delete</kbd>。<br>
      <kbd>Esc</kbd> 取消工具　<kbd>←</kbd><kbd>→</kbd> 翻页
    </div>
    <div id="list"></div>
  </aside>
</main>
<script src="lightweight-charts.js"></script>
<script>
var CARDS = ${data};
var KEY = 'annotate-34-v4';
var state = JSON.parse(localStorage.getItem(KEY) || '{}');

/** 一次性导入 v3 的数据（每张卡片按 markDate 取出 region/lines/verdict，作为"段"的初值）。
    这样旧的 18 个标注不会因为改结构就丢。 */
(function migrateV3(){
  if (Object.keys(state).length) return;
  var old = null;
  try { old = JSON.parse(localStorage.getItem('annotate-34-v3') || 'null'); } catch (e) {}
  if (!old) return;
  CARDS.forEach(function(c){
    var rec = old[c.inst];
    if (!rec) return;
    // v3 里一张卡只有一条 region，用它对 c.markDate 匹配；对上就搬过来
    if (rec.region && rec.region[0]) {
      state[c.inst + '|' + c.markDate] = {
        segments: [ { region: rec.region.slice(), source: 'edited', verdict: rec.verdict || null, lines: (rec.lines || []).slice() } ],
      };
    }
  });
  if (Object.keys(state).length) {
    localStorage.setItem(KEY, JSON.stringify(state));
    console.log('migrated from v3:', Object.keys(state).length);
  }
})();

var idx = 0, tool = null, draft = null, regionDrag = null, segSel = 0, lineSel = -1;
var chart, series, candles = [], overlay = document.getElementById('overlay');
var drawn = [];

function el(id){ return document.getElementById(id); }
function cur(){ return CARDS[idx]; }
function key(){ return cur().inst + '|' + cur().markDate; }
function st(){
  var c = cur();
  if (!state[key()]) state[key()] = { segments: [ { region: c.defaultRegion.slice(), source: 'prefilled', verdict: null, lines: [] } ] };
  return state[key()];
}
function seg(){ var s = st(); return s.segments[segSel]; }
function save(){ localStorage.setItem(KEY, JSON.stringify(state)); renderList(); }

function setTool(t){
  tool = t; draft = null; regionDrag = null;
  overlay.classList.toggle('active', !!t);
  el('mode').textContent = t === 'h' ? '画压力位' : t === 'r' ? '画突破方向' : t === 'rg' ? '框选新一段' : '浏览';
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
  var s = seg();
  if (!s) return;
  s.lines.forEach(function(L, i){
    var sel = i === lineSel && tool === null;
    var color = sel ? '#facc15' : '#58a6ff';
    if (L.kind === 'h') {
      var pl = series.createPriceLine({ price:L.price, color:color, lineWidth:2, lineStyle:0, axisLabelVisible:true, title: (sel?'✓ ':'')+'压力位 '+(i+1) });
      drawn.push({ kind:'h', line:pl });
    } else {
      var lineSeries = chart.addSeries(LightweightCharts.LineSeries, { color:color, lineWidth:2, priceLineVisible:false, lastValueVisible:false });
      lineSeries.setData(rayPoints(L));
      drawn.push({ kind:'r', line:lineSeries });
    }
  });
}
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
  segSel = Math.min(segSel, Math.max(0, st().segments.length - 1));
  lineSel = -1;
  renderDrawn(); drawOverlay(); setTool(null); renderList();
}

function xOfDay(d){ var i = candles.findIndex(function(b){ return b.d >= d; }); return i < 0 ? null : chart.timeScale().logicalToCoordinate(i); }

function drawOverlay(){
  if (!chart || !series) return;
  var s = st(), w = overlay.clientWidth, h = overlay.clientHeight;
  overlay.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
  var out = [];
  s.segments.forEach(function(g, i){
    if (!g.region) return;
    var xa = xOfDay(g.region[0]), xb = xOfDay(g.region[1]);
    if (xa == null || xb == null) return;
    var sel = i === segSel;
    out.push('<rect x="'+Math.min(xa,xb)+'" y="0" width="'+Math.max(4,Math.abs(xb-xa))+'" height="'+h+'" fill="rgba(245,158,11,'+(sel?0.18:0.09)+')" stroke="#f59e0b" stroke-opacity="'+(sel?0.8:0.35)+'"/>');
    out.push('<text x="'+(Math.min(xa,xb)+4)+'" y="'+(sel?22:36)+'" fill="#f59e0b" font-size="10">段 '+(i+1)+' '+(sel?'✓':'')+'</text>');
  });
  if (draft && draft.temp) out.push('<line x1="'+draft.temp.x1+'" y1="'+draft.temp.y1+'" x2="'+draft.temp.x2+'" y2="'+draft.temp.y2+'" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="4 3"/>');
  if (regionDrag) out.push('<rect x="'+Math.min(regionDrag.a,regionDrag.b)+'" y="0" width="'+Math.abs(regionDrag.b-regionDrag.a)+'" height="'+h+'" fill="rgba(245,158,11,.22)"/>');
  overlay.innerHTML = out.join('');
}

function toPoint(ev){
  var r = overlay.getBoundingClientRect();
  var x = ev.clientX - r.left, y = ev.clientY - r.top;
  var t = chart.timeScale().coordinateToTime(x);
  var price = series.coordinateToPrice(y);
  return { x:x, y:y, t:t, price:price };
}

overlay.addEventListener('pointerdown', function(ev){
  if (!tool) return;
  var p = toPoint(ev);
  if (p.price == null) return;
  var s = st();
  if (tool === 'rg') { regionDrag = { a:p.x, b:p.x }; return; }
  var seg = s.segments[segSel];
  if (tool === 'h') { seg.lines.push({ kind:'h', price:p.price }); seg.source = 'edited'; save(); renderDrawn(); setTool(null); return; }
  if (tool === 'r') {
    if (!draft) draft = { first:p };
    else { seg.lines.push({ kind:'r', p1:{ t:draft.first.t, price:draft.first.price }, p2:{ t:p.t, price:p.price } }); seg.source = 'edited'; save(); renderDrawn(); setTool(null); }
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
  if (!regionDrag) return;
  var s = st();
  var x1 = Math.min(regionDrag.a, regionDrag.b), x2 = Math.max(regionDrag.a, regionDrag.b);
  var t1 = chart.timeScale().coordinateToTime(x1), t2 = chart.timeScale().coordinateToTime(x2);
  regionDrag = null;
  if (t1 != null && t2 != null) {
    var r = [ new Date(t1*1000).toISOString().slice(0,10), new Date(t2*1000).toISOString().slice(0,10) ];
    // 新增一段（而不是覆盖）—— 这是 Bug 2 的修复
    s.segments.push({ region:r, source:'edited', verdict:null, lines:[] });
    segSel = s.segments.length - 1;
    lineSel = -1;
    save();
  }
  setTool(null); renderDrawn(); drawOverlay(); renderList();
});

function deleteSelectedLine(){
  var s = seg();
  if (!s || lineSel < 0 || lineSel >= s.lines.length) return;
  s.lines.splice(lineSel, 1); lineSel = -1; save(); renderDrawn(); renderList();
}

function renderList(){
  var c = cur();
  el('title').textContent = c.short + ' · 标注日 ' + c.markDate;
  el('quote').textContent = '你的备注：' + c.quote;
  var done = Object.keys(state).filter(function(k){ return (state[k].segments || []).some(function(g){ return g.verdict; }); }).length;
  el('cnt').textContent = (idx+1) + ' / ' + CARDS.length + ' · 已标注 ' + done;
  el('prog').style.width = (done / CARDS.length * 100) + '%';

  var s = st();
  el('segments').innerHTML = s.segments.map(function(g, i){
    var sel = i === segSel;
    var v = { good:'会做', structure:'结构不行', chart:'股性不行', missed:'错过了' }[g.verdict] || '未定';
    return '<div class="seg ' + (sel ? 'sel' : '') + '" data-i="'+i+'">'
      + '<b>段 ' + (i+1) + ' ' + (g.region ? g.region.join(' → ') : '') + '</b>'
      + '<div class="meta">结论：' + v + ' · ' + (g.source === 'prefilled' ? '（预填，未改）' : '已改') + '</div>'
      + (g.lines.length ? '<div class="lines">' + g.lines.map(function(L, j){
          var txt = L.kind === 'h' ? ('压力位 ' + (L.price >= 1 ? L.price.toFixed(4) : L.price.toPrecision(5))) : '突破方向';
          return '<span data-j="'+j+'" class="'+(sel && j===lineSel ? 'sel' : '')+'">'+(j+1)+'. '+txt+'</span>';
        }).join('') + '</div>' : '<div class="lines">（还没画线）</div>')
      + '</div>';
  }).join('');
  Array.prototype.forEach.call(el('segments').querySelectorAll('.seg'), function(d){
    d.onclick = function(){ segSel = Number(d.getAttribute('data-i')); lineSel = -1; renderDrawn(); drawOverlay(); renderList(); };
  });
  Array.prototype.forEach.call(el('segments').querySelectorAll('span[data-j]'), function(sp){
    sp.onclick = function(e){ e.stopPropagation(); lineSel = Number(sp.getAttribute('data-j')); renderDrawn(); renderList(); };
  });
  var sSeg = seg();
  Array.prototype.forEach.call(document.querySelectorAll('#verdict button'), function(b){
    b.classList.toggle('on', !!sSeg && sSeg.verdict === b.getAttribute('data-v'));
  });
  el('list').innerHTML = CARDS.map(function(x, i){
    var k = x.inst + '|' + x.markDate;
    var g = state[k] && state[k].segments || [];
    var v = g.some(function(x2){ return x2.verdict; });
    return '<div class="' + (v ? 'done' : '') + '" data-i="'+i+'">' + (i+1) + '. ' + x.short + ' ' + (v ? '✓ ' + g.length + ' 段' : '') + '</div>';
  }).join('');
  Array.prototype.forEach.call(el('list').querySelectorAll('div'), function(d){
    d.onclick = function(){ idx = Number(d.getAttribute('data-i')); segSel = 0; buildChart(); renderList(); };
  });
}

function go(n){ idx = (n + CARDS.length) % CARDS.length; segSel = 0; lineSel = -1; buildChart(); renderList(); }
el('prev').onclick = function(){ go(idx-1); };
el('next').onclick = function(){ go(idx+1); };
el('t-h').onclick = function(){ setTool(tool === 'h' ? null : 'h'); };
el('t-r').onclick = function(){ setTool(tool === 'r' ? null : 'r'); };
el('t-rg').onclick = function(){ setTool(tool === 'rg' ? null : 'rg'); };
el('del-seg').onclick = function(){
  var s = st();
  if (s.segments.length <= 1) { alert('至少保留一段'); return; }
  s.segments.splice(segSel, 1);
  segSel = Math.max(0, segSel - 1); lineSel = -1; save(); renderDrawn(); drawOverlay(); renderList();
};
el('clear-lines').onclick = function(){
  if (!confirm('清空这张图上所有段的线？')) return;
  st().segments.forEach(function(g){ g.lines = []; });
  lineSel = -1; save(); renderDrawn(); renderList();
};
Array.prototype.forEach.call(document.querySelectorAll('#verdict button'), function(b){
  b.onclick = function(){
    var g = seg(); if (!g) return;
    g.verdict = b.getAttribute('data-v'); g.source = 'edited'; save(); renderList();
  };
});
el('export').onclick = function(){
  var out = CARDS.map(function(c){
    var k = c.inst + '|' + c.markDate;
    var s = state[k] || { segments: [] };
    return { inst:c.inst, markDate:c.markDate, quote:c.quote, segments: s.segments.map(function(g){ return { region:g.region, source:g.source, verdict:g.verdict, lines:g.lines }; }) };
  });
  var blob = new Blob([JSON.stringify(out, null, 2)], { type:'application/json' });
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
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelectedLine(); }
});
buildChart(); renderList();
</script></body></html>`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html, 'utf8');
const lib = 'node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js';
if (fs.existsSync(lib)) fs.copyFileSync(lib, path.join(path.dirname(OUT), 'lightweight-charts.js'));
console.log(`wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
