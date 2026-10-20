/**
 * 给标注页搭桥：把今天候选的「拉升区间」做成标注卡，写进 annotate.html 的 CARDS。
 *
 * 只在 CARDS 那一行做替换，其余 HTML/JS 原样保留。
 * 蜡烛数据给到最新一天；hideAfter = 这份数据的最新一天（不会把后面变灰）。
 *
 * 输出 out/annotate-today.html —— 用浏览器打开，缩放开到最大看细节，画水平线标压力位，
 * 导出后把 json 放到 research/draw/labels.json，再跑 build-page.mjs 就会显示「距线 %」。
 *
 * Run: node .trellis/tasks/10-20-anomaly-level-tracker/research/build-annotate.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = '.trellis/tasks/10-20-anomaly-level-tracker/research';
const OUT = path.join(DIR, 'out');
const TEMPLATE = '.trellis/tasks/10-19-fakeout-retest-quality/research/annotate.html';
// 用户 10/20 确认：日期按北京时间看。
// Bitget 1D 是 UTC 0 点开盘 = 北京 8:00 开盘，即"北京日期当天的 K 线"。
// 所以要 +8h 再取日期，不能直接 toISOString().slice(0,10)（那样会早一天）。
const dayOf = (t) => new Date(Number(t) + 8 * 3600 * 1000).toISOString().slice(0, 10);

const list = JSON.parse(fs.readFileSync(path.join(OUT, 'bottom-list.json'), 'utf8'));
const SHOW = Number(process.env.SHOW ?? 200);

const cards = [];
for (const r of list.slice(0, SHOW)) {
  const f = path.join(DIR, 'pool', `${r.inst}USDT.json`);
  if (!fs.existsSync(f)) continue;
  const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
  const bars = raw.map(([t, o, h, l, c]) => ({ t: Number(t), o, h, l, c, d: dayOf(t) }));
  const lastDay = bars[bars.length - 1].d;
  cards.push({
    inst: `${r.inst}USDT`,
    short: r.inst,
    quote: `拉升 ${r.s0.slice(5)}→${r.p.slice(5)} 涨${r.gain}% · 回到${r.fromBase}% · 离顶${r.fromPeak}% · 顶后${r.holdDays}天`,
    markDate: lastDay,
    // 用户 10/20：去掉默认段，全部自己画
    defaultRegion: null,
    hideAfter: lastDay,
    bars,
  });
}

const html = fs.readFileSync(TEMPLATE, 'utf8');
const anchor = 'var CARDS = ';
const i = html.indexOf(anchor);
if (i < 0) throw new Error('模板里找不到 var CARDS');
const start = i + anchor.length;
const end = html.indexOf('}];', start) + 2;
let out = html.slice(0, start) + JSON.stringify(cards) + html.slice(end);

// 修补：模板没给时间轴设 tickMarkFormatter，日线会显示成 "58224年"（把秒当毫秒）。
// 这里换成 MM-DD，和价格轴标签的日期口径一致。
const axisBefore = "timeScale:{ borderColor:'#30363d', timeVisible:false, rightOffset:8, barSpacing:6 },";
const axisAfter =
  "timeScale:{ borderColor:'#30363d', timeVisible:false, rightOffset:8, barSpacing:6, tickMarkFormatter:function(t){ var n=Number(t); var ms=(n<1e12?n*1000:n)+8*3600*1000; return new Date(ms).toISOString().slice(5,10); } },";
if (!out.includes(axisBefore)) throw new Error('模板时间轴格式变了，请更新 build-annotate.mjs 里的补丁');
out = out.replace(axisBefore, axisAfter);

/**
 * 修补：模板的初始视野是写死的「最近 120 根」，用户 10/20 反馈"缩放比例不对，要尽可能看多点 k 线"。
 *
 * 三层原因：
 *   1. 视野写死 markIdx-120
 *   2. barSpacing 写死 6px —— 一屏只塞得下十几个格子
 *   3. 只调视野不调间距时，库会反推间距把远处截掉（实测视野给 200 根，结果只显示 5 根）
 *
 * 现在按容器像素宽反推 barSpacing：spacing = 容器宽度 / 要显示的根数，
 * 再把视野设为「全部历史」。一屏能看到多少根 = 容器有多宽，能塞多少塞多少。
 * 用户滚轮缩放后，间距按新视野重算，永远填满容器。
 */
const spacingBefore = "timeScale:{ borderColor:'#30363d', timeVisible:false, rightOffset:8, barSpacing:6, tickMarkFormatter:";
const spacingAfter = "timeScale:{ borderColor:'#30363d', timeVisible:false, rightOffset:2, tickMarkFormatter:";
if (!out.includes(spacingBefore)) throw new Error('模板 barSpacing 写法变了，请更新 build-annotate.mjs 里的补丁');
out = out.replace(spacingBefore, spacingAfter);

const viewBefore = "chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, markIdx - 120), to: markIdx + 12 });";
const viewAfter = `
  // 按容器宽度把"全部历史"铺满：spacing 由宽度反推，库就不会再替你砍掉远处的 K 线
  function fitAll(){
    var w = el('chart').clientWidth || 900;
    var n = Math.min(candles.length, 400);
    var spacing = Math.max(1.2, w / n);
    chart.applyOptions({ timeScale:{ barSpacing: spacing, rightOffset: 1 } });
    chart.timeScale().setVisibleLogicalRange({ from: candles.length - n, to: candles.length + 1 });
  }
  fitAll();
  window.addEventListener('resize', function(){ clearTimeout(window.__fitT); window.__fitT = setTimeout(fitAll, 120); });`;
if (!out.includes(viewBefore)) throw new Error('模板初始视野代码变了，请更新 build-annotate.mjs 里的补丁');
out = out.replace(viewBefore, viewAfter);

/**
 * 加备注（用户 10/20 要求"给我个备注功能吧，我把意见都写上"）。
 *
 * 设计：
 *   - 备注挂在「卡片」上（inst|markDate），不挂在段上 —— 因为意见常常是说这币/这张图整体的事
 *   - 输入即存（本地 localStorage，刷新不丢），随「导出标注」一起出现在 json 里
 *   - 每张卡一个 textarea，回车换行不触发翻页
 */
const noteHtml =
  '<div class="row"><label>备注 · 这个币 / 这张图的想法（自动保存，会随导出一起出去）</label>' +
  '<textarea id="note" placeholder="例如：这种才是想要的 / 拉太急不行 / 这里量没跟上 / 后面该看哪里……" ' +
  'style="width:100%;height:84px;resize:vertical;background:#0d1117;color:#c9d1d9;border:1px solid #30363d;' +
  'border-radius:6px;padding:7px 9px;font:12px/1.6 inherit;box-sizing:border-box"></textarea>' +
  '<div style="font-size:10.5px;color:#6e7681;margin-top:3px" id="note-state"></div></div>';

const asideAnchor = '    <div id="hint">';
if (!out.includes(asideAnchor)) throw new Error('模板侧栏结构变了，请更新 build-annotate.mjs 里的备注补丁');
out = out.replace(asideAnchor, noteHtml + '\n' + asideAnchor);

// st() 里补上 note 字段（新建卡片时）
const stBefore =
  "  if (!state[key()]) state[key()] = { segments: [ { region: c.defaultRegion.slice(), source: 'prefilled', verdict: null, lines: [] } ] };";
const stAfter =
  "  if (!state[key()]) state[key()] = c.defaultRegion ? { segments: [ { region: c.defaultRegion.slice(), source: 'prefilled', verdict: null, lines: [] } ], note: '' } : { segments: [], note: '' };\n" +
  '  if (typeof state[key()].note !== \'string\') state[key()].note = \'\';';
if (!out.includes(stBefore)) throw new Error('模板 st() 结构变了，请更新 build-annotate.mjs 里的备注补丁');
out = out.replace(stBefore, stAfter);

// 备注读写 + 随 buildChart 回填（buildChart 每张卡都会跑）
// 注意：'buildChart(); renderList();' 在模板里出现两次（renderList 里一次、文件末尾一次），
// 必须只改最后那处启动行，否则会把代码塞进 renderList 函数体中间。
const bindBefore = '  renderDrawn(); drawOverlay(); setTool(null); renderList();';
const bindAfter =
  "  renderDrawn(); drawOverlay(); setTool(null); renderList();\n  if (window.__syncNote) window.__syncNote();";
if (!out.includes(bindBefore)) throw new Error('模板 buildChart 结构变了，请更新 build-annotate.mjs 里的备注补丁');
out = out.replace(bindBefore, bindAfter);

const noteJs = `
window.__syncNote = function(){
  var ta = el('note'); if (!ta) return;
  var want = st().note || '';
  if (ta.value !== want) ta.value = want;
  el('note-state').textContent = want.trim() ? '已保存' : '';
};
window.__bindNote = function(){
  var ta = el('note'); if (!ta || ta.__bound) return;
  ta.__bound = true;
  ta.addEventListener('input', function(){
    st().note = ta.value;
    localStorage.setItem(KEY, JSON.stringify(state));
    el('note-state').textContent = ta.value.trim() ? '已保存 ' + new Date().toLocaleTimeString() : '';
  });
  ta.addEventListener('keydown', function(e){ e.stopPropagation(); });
};`;
const bootAnchor = 'buildChart(); renderList();';
const bootIdx = out.lastIndexOf(bootAnchor);
if (bootIdx < 0) throw new Error('模板启动行变了，请更新 build-annotate.mjs 里的备注补丁');
out = out.slice(0, bootIdx) + noteJs + '\nwindow.__bindNote();\n' + bootAnchor + out.slice(bootIdx + bootAnchor.length);

// 导出时带上备注
const exportBefore =
  "    return { inst:c.inst, markDate:c.markDate, quote:c.quote, segments: s.segments.map(function(g){ return { region:g.region, source:g.source, verdict:g.verdict, lines:g.lines }; }) };";
const exportAfter =
  "    return { inst:c.inst, markDate:c.markDate, quote:c.quote, note: s.note || '', segments: s.segments.map(function(g){ return { region:g.region, source:g.source, verdict:g.verdict, lines:g.lines }; }) };";
if (!out.includes(exportBefore)) throw new Error('模板导出结构变了，请更新 build-annotate.mjs 里的备注补丁');
out = out.replace(exportBefore, exportAfter);

/**
 * 修画段（用户 10/20：画完就飘到不知道哪里去了）。
 *
 * 原因：coordinateToTime 在留白处会返回"超出数据范围"的时间，
 * new Date(t*1000).toISOString() 直接抛 Invalid time value，
 * 于是段落没存下、只有 overlay 上那一下的高亮，看着就是"飘了"。
 * 修法：把拖选的两端都夹到真实 K 线范围内，取整根，绝不产生非法日期。
 */
const segPat = /var t1 = chart\.timeScale\(\)\.coordinateToTime\(x1\), t2 = chart\.timeScale\(\)\.coordinateToTime\(x2\);\s*\n\s*regionDrag = null;\s*\n\s*if \(t1 != null && t2 != null\) \{\s*\n\s*var r = \[ new Date\(t1\*1000\)\.toISOString\(\)\.slice\(0,10\), new Date\(t2\*1000\)\.toISOString\(\)\.slice\(0,10\) \];/;
if (!segPat.test(out)) throw new Error('模板画段代码变了，请更新 build-annotate.mjs 里的画段补丁');
out = out.replace(
  segPat,
  `var i1 = Math.round(chart.timeScale().coordinateToLogical(x1));
  var i2 = Math.round(chart.timeScale().coordinateToLogical(x2));
  regionDrag = null;
  i1 = Math.max(0, Math.min(candles.length - 1, i1));
  i2 = Math.max(0, Math.min(candles.length - 1, i2));
  if (i2 < i1) { var _s = i1; i1 = i2; i2 = _s; }
  if (true) {
    var r = [ candles[i1].d, candles[i2].d ];`,
);

const target = path.join(OUT, 'annotate-today.html');

// 空段的显示：别让它显示成空白的"段 N"
out = out.split("(g.region ? g.region.join(' → ') : '')").join("(g.region ? g.region.join(' → ') : '（未框区间）')");

/**
 * 用户 10/20：「我没标的币就是我觉得不好的币，但是因为页面没有区间的话就没法选不好原因」
 *
 * 改法：判定按钮不再要求"先有段"。
 * 没有段时点判定，自动建一个空段（region: null）承载结论，用户再画线/框段时挂上去。
 * 空段的卡也算"已表态"，导出时带 verdict，粗筛就能拿到负样本和原因。
 */
const verdictPat = /b\.onclick = function\(\)\{\s*\n\s*var g = seg\(\); if \(!g\) return;\s*\n\s*g\.verdict = b\.getAttribute\('data-v'\); g\.source = 'edited'; save\(\); renderList\(\);\s*\n\s*\};/;
if (!verdictPat.test(out)) throw new Error('模板判定按钮代码变了，请更新 build-annotate.mjs');
out = out.replace(
  verdictPat,
  `b.onclick = function(){
    var s = st();
    // 没段也能表个态：自动建一个空段放着结论
    if (!s.segments.length) { s.segments.push({ region: null, source: 'edited', verdict: null, lines: [] }); segSel = 0; }
    var g = s.segments[segSel] || s.segments[0]; if (!g) return;
    var v = b.getAttribute('data-v');
    g.verdict = (g.verdict === v) ? null : v;
    g.source = 'edited'; save(); renderList();
  };`,
);

/**
 * 加「复制到剪贴板」（用户 10/20：我标好了但没导出）。
 * 原始标注只存在浏览器本地，agent 读不到；多给一条不用管文件路径的出口。
 */
const copyBtn =
  '<button id="copy" style="margin-left:6px">复制 JSON</button>';out = out.replace(
  '<button id="export" class="primary">导出标注</button>',
  '<button id="export" class="primary">导出标注</button>' + copyBtn,
);
const copyJs = `
el('copy').onclick = function(){
  var out = CARDS.map(function(c){
    var k = c.inst + '|' + c.markDate;
    var s = state[k] || { segments: [], note: '' };
    return { inst:c.inst, markDate:c.markDate, quote:c.quote, note: s.note || '', segments: s.segments.map(function(g){ return { region:g.region, source:g.source, verdict:g.verdict, lines:g.lines }; }) };
  });
  var txt = JSON.stringify(out, null, 2);
  var done = function(ok){ el('copy').textContent = ok ? '已复制 ✓' : '复制失败，用导出'; setTimeout(function(){ el('copy').textContent = '复制 JSON'; }, 2200); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(function(){ done(true); }, function(){ done(false); });
  else {
    var ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select();
    try { done(document.execCommand('copy')); } catch(e) { done(false); }
    document.body.removeChild(ta);
  }
};`;
const bootAnchor2 = 'buildChart(); renderList();';
const bIdx = out.lastIndexOf(bootAnchor2);
out = out.slice(0, bIdx) + copyJs + '\n' + out.slice(bIdx);

// 模板里把线段时间转日期的地方也要 +8h，否则和轴上的北京日期差一天
const rayBefore = "new Date(t1*1000).toISOString().slice(0,10)";
const rayAfter = "new Date(t1*1000 + 8*3600*1000).toISOString().slice(0,10)";
out = out.split(rayBefore).join(rayAfter);
const rayBefore2 = "new Date(t2*1000).toISOString().slice(0,10)";
const rayAfter2 = "new Date(t2*1000 + 8*3600*1000).toISOString().slice(0,10)";
out = out.split(rayBefore2).join(rayAfter2);
fs.writeFileSync(target, out);
console.log(`写出 ${target}（${cards.length} 张卡，${(out.length / 1024 / 1024).toFixed(2)} MB）`);
