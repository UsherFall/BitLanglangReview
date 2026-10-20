/**
 * 构建标注页：34 个区间，每个只看"到那天为止"的 K 线，可以画箱体上沿 / 突破射线 / 框好区间。
 *
 * 数据口径（用户 10/20 确认）：
 *   日线分界 = 北京早上 8:00（= UTC 00:00，Bitget 的 1D 网格）
 *   图表时间轴用秒；K 线时间戳是 UTC 00:00Z，正好对应"北京 08:00 开盘"那天
 *
 * 产物：tools/labeling/out/annotate.html（单文件，双击打开即可标注）
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

/** 北京 08:00 分界的日期标签（与 UTC 日期相同）。 */
const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);

const cards: any[] = [];
for (const rg of RANGES) {
  const p = path.join(POOL_DIR, `${rg.inst}.json`);
  if (!fs.existsSync(p)) continue;
  const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as number[][];
  const bars = raw.map(([t, o, h, l, c]) => ({ t, o, h, l, c, d: dayOf(t) }));
  // 标注日 = 用户圈的最后一天（没有 end 就按 est 根往后数）
  const startIdx = bars.findIndex((b) => b.d >= rg.start);
  if (startIdx < 0) continue;
  let endIdx = rg.end ? bars.findIndex((b) => b.d >= rg.end) : Math.min(bars.length - 1, startIdx + (rg.est ?? 10));
  if (endIdx < startIdx) endIdx = startIdx;
  // 图上显示：标注日之前 100 根 + 标注日之后 15 根（后面 15 根"先遮住"，点开可看）
  const from = Math.max(0, endIdx - 100);
  const to = Math.min(bars.length - 1, endIdx + 15);
  cards.push({
    inst: rg.inst,
    short: rg.inst.replace(/USDT$/, ''),
    quote: rg.quote,
    verdict: rg.verdict,
    userStart: rg.start,
    userEnd: rg.end ?? bars[endIdx].d,
    markDate: bars[endIdx].d,
    // 默认圈出的"好区间"：用户说到的起止
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
header{position:sticky;top:0;z-index:10;background:#161b22;border-bottom:1px solid #30363d;padding:10px 16px;display:flex;gap:14px;align-items:center;flex-wrap:wrap}
header b{color:#e6edf3;font-size:14px}
.bar{flex:1;height:6px;background:#21262d;border-radius:3px;overflow:hidden;min-width:120px}
.bar>i{display:block;height:100%;background:#3fb950;width:0}
button{background:#21262d;color:#c9d1d9;border:1px solid #30363d;border-radius:6px;padding:5px 12px;cursor:pointer;font-size:12px}
button:hover{border-color:#58a6ff}
button.on{border-color:#58a6ff;background:#1f6feb33;color:#e6edf3}
button.primary{background:#238636;border-color:#2ea043;color:#fff}
main{display:grid;grid-template-columns:1fr 340px;gap:0;height:calc(100vh - 56px)}
#wrap{position:relative;background:#10151c}
/* 图表与画线层都必须绝对定位并铺满：canvas 是 chart 的子元素，
   若 #chart 仍在文档流里会盖住画线层，点击永远到不了 overlay。 */
#chart{position:absolute;inset:0;z-index:1}
#overlay{position:absolute;inset:0;z-index:5;cursor:crosshair;touch-action:none}
aside{border-left:1px solid #30363d;padding:14px;overflow:auto;background:#161b22}
.q{font-size:12px;color:#9aa4b2;border-left:2px solid #30363d;padding-left:8px;margin-bottom:14px}
.row{margin-bottom:14px}
.row label{display:block;font-size:11px;color:#8b949e;margin-bottom:5px}
.opts{display:flex;flex-wrap:wrap;gap:6px}
.opts button{flex:1 1 auto}
#hint{font-size:11px;color:#6e7681;line-height:1.7}
kbd{background:#21262d;border:1px solid #30363d;border-radius:3px;padding:0 4px;font-size:10px}
#list{font-size:11px;color:#8b949e;margin-top:10px}
#list div{padding:2px 0;border-bottom:1px solid #21262d}
.done{color:#3fb950}
</style></head><body>
<header>
  <b id="title">—</b>
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
      <label>工具（按 1 画压力位、2 画突破方向）</label>
      <div class="opts">
        <button id="t-h" class="on">1 · 水平线（压力位）</button>
        <button id="t-r">2 · 射线（突破方向）</button>
        <button id="t-x">取消本图所有线</button>
      </div>
    </div>
    <div class="row">
      <label>好区间（拖一下选中那几根，默认已按备注预填）</label>
      <div id="region" style="font-size:12px;color:#e6edf3"></div>
      <button id="t-rg" style="margin-top:6px;width:100%">3 · 重新框选好区间</button>
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
      <kbd>1</kbd> 水平线：点一下就落一条（拖到压力位）<br>
      <kbd>2</kbd> 射线：点两下（起点 → 方向）<br>
      <kbd>3</kbd> 框区间：左右拖选中几根<br>
      <kbd>Delete</kbd> 删除选中的线<br>
      右侧 15 根是"之后的走势"，默认遮住，点开关才显示<br>
      <button id="peek" style="margin-top:8px">显示之后 15 根</button>
    </div>
    <div id="list"></div>
  </aside>
</main>
<script src="lightweight-charts.js"></script>
<script>
var CARDS = ${data};
var KEY = 'annotate-34-v1';
var state = JSON.parse(localStorage.getItem(KEY) || '{}');
var idx = 0, tool = 'h', regionMode = false, peek = false;
var chart, series, candles = [], overlay = document.getElementById('overlay');
var draft = null, regionDrag = null;

function el(id){ return document.getElementById(id); }
function save(){ localStorage.setItem(KEY, JSON.stringify(state)); renderList(); }
function cur(){ return CARDS[idx]; }
function st(){ var c = cur(); if (!state[c.inst]) state[c.inst] = { lines: [], region: c.defaultRegion.slice(), verdict: null }; return state[c.inst]; }

function buildChart(){
  if (chart) { chart.remove(); chart = null; }
  var c = cur();
  candles = c.bars.filter(function(b){ return peek || b.d <= c.hideAfter; });
  chart = LightweightCharts.createChart(el('chart'), {
    layout:{ background:{ type:'solid', color:'#10151c' }, textColor:'#c9d1d9' },
    grid:{ vertLines:{ color:'#1b2028' }, horzLines:{ color:'#1b2028' } },
    rightPriceScale:{ borderColor:'#30363d' },
    timeScale:{ borderColor:'#30363d', timeVisible:false, rightOffset:6 },
    crosshair:{ mode:0 }, autoSize:true,
    localization:{ timeFormatter: function(t){ return new Date(t*1000).toISOString().slice(0,10); } },
  });
  series = chart.addSeries(LightweightCharts.CandlestickSeries, {
    upColor:'#3fb950', downColor:'#f85149', borderVisible:false, wickUpColor:'#3fb950', wickDownColor:'#f85149',
  });
  series.setData(candles.map(function(b){ return { time:b.t, open:b.o, high:b.h, low:b.l, close:b.c }; }));
  chart.timeScale().fitContent();
  chart.subscribeCrosshairMove(function(){ drawOverlay(); });
  chart.timeScale().subscribeVisibleLogicalRangeChange(function(){ drawOverlay(); });
  drawOverlay();
}

function px(t, price){
  var x = chart.timeScale().timeToCoordinate(t);
  var y = series.priceToCoordinate(price);
  if (x == null || y == null) return null;
  return { x:x, y:y };
}

function drawOverlay(){
  if (!chart || !series) return;
  var c = cur(), s = st(), w = overlay.clientWidth, h = overlay.clientHeight;
  overlay.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
  var out = [];
  // 好区间底色：用两根 K 线的"中点"取 x，避免 timeToCoordinate 落在两根之间返回 null
  if (s.region && s.region.length === 2) {
    var i1 = candles.findIndex(function(b){ return b.d >= s.region[0]; });
    var i2 = candles.findIndex(function(b){ return b.d >= s.region[1]; });
    if (i1 >= 0 && i2 >= 0) {
      var xa = chart.timeScale().logicalToCoordinate(i1);
      var xb = chart.timeScale().logicalToCoordinate(i2);
      if (xa != null && xb != null) {
        out.push('<rect x="'+Math.min(xa,xb)+'" y="0" width="'+Math.max(4, Math.abs(xb-xa))+'" height="'+h+'" fill="rgba(245,158,11,.12)" stroke="#f59e0b" stroke-opacity=".55"/>');
      }
    }
  }
  // 之后被遮住的部分：画一条分界
  if (!peek && candles.length) {
    var xl = chart.timeScale().logicalToCoordinate(candles.length - 1);
    if (xl != null) out.push('<text x="'+(xl-6)+'" y="14" fill="#6e7681" font-size="10" text-anchor="end">← 只显示到 '+c.hideAfter+'</text>');
  }
  // 画的线
  s.lines.forEach(function(L, i){
    var sel = (draft && draft.sel === i);
    var col = sel ? '#facc15' : '#58a6ff';
    if (L.kind === 'h') {
      var p = series.priceToCoordinate(L.price);
      if (p == null) return;
      out.push('<line x1="0" x2="'+w+'" y1="'+p+'" y2="'+p+'" stroke="'+col+'" stroke-width="2"/>');
      var label = L.price >= 1 ? L.price.toFixed(4) : L.price.toPrecision(5);
      out.push('<text x="6" y="'+(p-5)+'" fill="'+col+'" font-size="10">'+label+'</text>');
    } else {
      var a1 = px(L.p1.t, L.p1.price), a2 = px(L.p2.t, L.p2.price);
      if (!a1 || !a2) return;
      var dx = a2.x - a1.x, dy = a2.y - a1.y, len = Math.hypot(dx, dy) || 1;
      out.push('<line x1="'+a1.x+'" y1="'+a1.y+'" x2="'+(a1.x+dx/len*4000)+'" y2="'+(a1.y+dy/len*4000)+'" stroke="'+col+'" stroke-width="2"/>');
      out.push('<circle cx="'+a1.x+'" cy="'+a1.y+'" r="3" fill="'+col+'"/>');
    }
  });
  // 正在拖的
  if (draft && draft.temp) {
    out.push('<line x1="'+draft.temp.x1+'" y1="'+draft.temp.y1+'" x2="'+draft.temp.x2+'" y2="'+draft.temp.y2+'" stroke="#facc15" stroke-width="1.5" stroke-dasharray="4 3"/>');
  }
  if (regionDrag && regionDrag.a != null) {
    out.push('<rect x="'+Math.min(regionDrag.a, regionDrag.b)+'" y="0" width="'+Math.abs(regionDrag.b-regionDrag.a)+'" height="'+h+'" fill="rgba(245,158,11,.22)"/>');
  }
  overlay.innerHTML = out.join('');
  el('region').textContent = s.region ? (s.region[0] + ' → ' + s.region[1]) : '（未选）';
}

function toPoint(ev){
  var r = overlay.getBoundingClientRect();
  var x = ev.clientX - r.left, y = ev.clientY - r.top;
  var t = chart.timeScale().coordinateToTime(x);
  var price = series.coordinateToPrice(y);
  return { x:x, y:y, t:t, price:price };
}

overlay.addEventListener('pointerdown', function(ev){
  var p = toPoint(ev); if (p.price == null) return;
  var c = cur(), s = st();
  if (regionMode) { regionDrag = { a:p.x, b:p.x }; return; }
  if (tool === 'h') {
    s.lines.push({ kind:'h', price: p.price });
    save(); drawOverlay(); return;
  }
  if (tool === 'r') {
    if (!draft || !draft.first) { draft = { first: p }; }
    else {
      s.lines.push({ kind:'r', p1:{ t:draft.first.t, price:draft.first.price }, p2:{ t:p.t, price:p.price } });
      draft = null; save();
    }
    drawOverlay();
  }
});
overlay.addEventListener('pointermove', function(ev){
  var p = toPoint(ev);
  if (regionDrag) { regionDrag.b = p.x; drawOverlay(); return; }
  if (draft && draft.first) { draft.temp = { x1:draft.first.x, y1:draft.first.y, x2:p.x, y2:p.y }; drawOverlay(); }
});
overlay.addEventListener('pointerup', function(ev){
  if (regionDrag) {
    var c = cur(), s = st();
    var r = overlay.getBoundingClientRect();
    var x1 = Math.min(regionDrag.a, regionDrag.b) - r.left, x2 = Math.max(regionDrag.a, regionDrag.b) - r.left;
    var t1 = chart.timeScale().coordinateToTime(x1), t2 = chart.timeScale().coordinateToTime(x2);
    regionDrag = null;
    if (t1 != null && t2 != null) {
      s.region = [ new Date(t1*1000).toISOString().slice(0,10), new Date(t2*1000).toISOString().slice(0,10) ];
      regionMode = false; el('t-rg').classList.remove('on');
      save();
    }
    drawOverlay();
  }
});

function renderList(){
  var c = cur();
  el('title').textContent = c.short + ' · ' + c.markDate;
  el('quote').textContent = '你的备注：' + c.quote;
  var done = Object.keys(state).filter(function(k){ return state[k].verdict; }).length;
  el('cnt').textContent = (idx+1) + ' / ' + CARDS.length + ' · 已标注 ' + done;
  el('prog').style.width = (done / CARDS.length * 100) + '%';
  var s = state[c.inst];
  Array.prototype.forEach.call(document.querySelectorAll('#verdict button'), function(b){
    b.classList.toggle('on', !!s && s.verdict === b.getAttribute('data-v'));
  });
  var list = CARDS.map(function(x, i){
    var v = state[x.inst] && state[x.inst].verdict;
    var name = { good:'会做', structure:'结构不行', chart:'股性不行', missed:'错过了' }[v] || '';
    return '<div class="' + (v?'done':'') + '" style="cursor:pointer" data-i="'+i+'">' + (i+1) + '. ' + x.short + ' ' + (v?'✓ '+name:'') + '</div>';
  }).join('');
  el('list').innerHTML = list;
  Array.prototype.forEach.call(el('list').querySelectorAll('div'), function(d){
    d.onclick = function(){ idx = Number(d.getAttribute('data-i')); draft = null; buildChart(); renderList(); };
  });
}

function go(n){ idx = (n + CARDS.length) % CARDS.length; draft = null; buildChart(); renderList(); }
el('prev').onclick = function(){ go(idx-1); };
el('next').onclick = function(){ go(idx+1); };
el('t-h').onclick = function(){ tool='h'; regionMode=false; el('t-h').classList.add('on'); el('t-r').classList.remove('on'); el('t-rg').classList.remove('on'); };
el('t-r').onclick = function(){ tool='r'; regionMode=false; el('t-r').classList.add('on'); el('t-h').classList.remove('on'); el('t-rg').classList.remove('on'); };
el('t-rg').onclick = function(){ regionMode = !regionMode; el('t-rg').classList.toggle('on', regionMode); };
el('t-x').onclick = function(){ st().lines = []; save(); drawOverlay(); };
el('peek').onclick = function(){ peek = !peek; el('peek').textContent = peek ? '遮住之后 15 根' : '显示之后 15 根'; buildChart(); };
Array.prototype.forEach.call(document.querySelectorAll('#verdict button'), function(b){
  b.onclick = function(){ st().verdict = b.getAttribute('data-v'); save(); renderList(); go(idx+1); };
});
el('export').onclick = function(){
  var blob = new Blob([JSON.stringify(CARDS.map(function(c){
    var s = state[c.inst] || {};
    return { inst:c.inst, markDate:c.markDate, quote:c.quote, region:s.region||null, verdict:s.verdict||null, lines:s.lines||[] };
  }), null, 2)], { type:'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'annotations-34.json';
  a.click();
};
document.addEventListener('keydown', function(e){
  if (e.key === '1') el('t-h').click();
  if (e.key === '2') el('t-r').click();
  if (e.key === '3') el('t-rg').click();
  if (e.key === 'ArrowRight') go(idx+1);
  if (e.key === 'ArrowLeft') go(idx-1);
  if (e.key === 'Delete') { st().lines = st().lines.slice(0,-1); save(); drawOverlay(); }
});
buildChart(); renderList();
</script></body></html>`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html, 'utf8');
const lib = 'node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js';
if (fs.existsSync(lib)) fs.copyFileSync(lib, path.join(path.dirname(OUT), 'lightweight-charts.js'));
console.log(`wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
