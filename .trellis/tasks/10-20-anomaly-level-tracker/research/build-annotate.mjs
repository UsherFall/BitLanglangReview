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

const list = JSON.parse(fs.readFileSync(path.join(OUT, 'rally-list.json'), 'utf8'));
const AS_OF = list[0]?.asOf ?? '';
const SHOW = Number(process.env.SHOW ?? 82);

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
    quote: `拉升 ${r.s0.slice(5)}→${r.p.slice(5)} 涨${r.gain}% · 离顶${r.fromPeak}% · 顶后${r.holdDays}天`,
    markDate: AS_OF,
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

const target = path.join(OUT, 'annotate-today.html');
fs.writeFileSync(target, out);
console.log(`写出 ${target}（${cards.length} 张卡，${(out.length / 1024 / 1024).toFixed(2)} MB）`);
