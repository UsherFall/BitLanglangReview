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
const dayOf = (t) => new Date(Number(t)).toISOString().slice(0, 10);

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
    // 默认框出"整段拉升 + 顶之后的整理"，用户在这个范围里标压力位
    defaultRegion: [r.s0, lastDay],
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
  "timeScale:{ borderColor:'#30363d', timeVisible:false, rightOffset:8, barSpacing:6, tickMarkFormatter:function(t){ var n=Number(t); return new Date((n<1e12?n*1000:n)).toISOString().slice(5,10); } },";
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

const target = path.join(OUT, 'annotate-today.html');
fs.writeFileSync(target, out);
console.log(`写出 ${target}（${cards.length} 张卡，${(out.length / 1024 / 1024).toFixed(2)} MB）`);
