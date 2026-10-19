/**
 * 把几只币的日线原样摊开（不画任何"框"），只标 YOU 说的那几根在什么位置。
 * 用户嫌上一版名词太多，这一版只有两根线：你圈的日子（橙）和收盘价。
 *
 * Run: POOL_DIR=<dir> OUT=<html> node <this>
 */
import fs from 'node:fs';
import path from 'node:path';

const POOL_DIR = process.env.POOL_DIR;
const OUT = process.env.OUT ?? '.scratch/research-10-19/raw-look.html';
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

const WATCH = [
  { inst: 'OPUSDT', start: '2026-08-10', end: '2026-10-18', mark: ['2026-08-21', '2026-10-12'], notes: ['大三角 8-21→9-16', '10-10→10-12'] },
  { inst: 'ZECUSDT', start: '2026-05-01', end: '2026-10-18', mark: ['2026-05-20', '2026-09-01'], notes: ['大三角 5-20→8-17', '8-26→9-1'] },
  { inst: 'AZTECUSDT', start: '2026-08-20', end: '2026-10-18', mark: ['2026-09-18', '2026-10-18'], notes: ['9-18 后'] },
  { inst: 'BERAUSDT', start: '2026-08-10', end: '2026-10-18', mark: ['2026-08-31', '2026-09-20'], notes: ['8-31 后'] },
  { inst: 'NEARUSDT', start: '2026-07-10', end: '2026-10-18', mark: ['2026-08-25', '2026-09-08'], notes: ['8-25 后（底部盘整，你不看）'] },
  { inst: 'NIGHTUSDT', start: '2026-07-20', end: '2026-10-18', mark: ['2026-08-19', '2026-09-01'], notes: ['8-19 后'] },
];

const cards = [];
for (const w of WATCH) {
  const p = path.join(POOL_DIR, `${w.inst}.json`);
  if (!fs.existsSync(p)) continue;
  const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as number[][];
  const bars = raw.map(([t, o, h, l, c]) => ({ t, o, h, l, c }));
  const from = bars.find((b) => iso(b.t) >= w.start);
  const to = [...bars].reverse().find((b) => iso(b.t) <= w.end);
  if (!from || !to) continue;
  const slice = bars.slice(bars.indexOf(from), bars.indexOf(to) + 1);
  cards.push({
    inst: w.inst.replace(/USDT$/, ''),
    marks: w.mark.map((d, i) => ({ date: d, note: w.notes[i] })),
    bars: slice.map((b) => ({ d: iso(b.t), o: b.o, h: b.h, l: b.l, c: b.c })),
  });
}

const html = `<!doctype html><html><head><meta charset="utf-8"><title>日线原样</title><style>
body{margin:0;background:#0d1117;color:#c9d1d9;font:13px/1.45 "Microsoft YaHei",system-ui,sans-serif}
h1{font-size:15px;padding:12px 20px 4px;margin:0}
.sub{padding:0 20px 12px;color:#8b949e;font-size:12px;border-bottom:1px solid #21262d}
.grid{padding:14px;display:grid;gap:16px}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:10px 12px}
.card b{color:#e6edf3;font-size:13px}
.marks{font-size:11px;color:#f59e0b;margin-left:8px}
</style></head><body>
<h1>日线原样（没有任何框，只有你圈的那几天标了橙色竖线）</h1>
<div class="sub">竖线 = 你备注里说到的那个日期；阴影 = 你说的那段之后</div>
<div class="grid">${cards.map((c, i) => `<section class="card"><b>${c.inst}</b><span class="marks">${c.marks.map((m) => `${m.date} ${m.note}`).join(' ｜ ')}</span><svg id="s${i}" viewBox="0 0 900 300" width="100%" height="300"></svg></section>`).join('\n')}</div>
<script>
var CARDS = ${JSON.stringify(cards)};
CARDS.forEach(function(c, ci){
  var svg = document.getElementById('s'+ci);
  var bars = c.bars, W = 900, Hh = 300, padL = 8, padR = 70, padT = 14, padB = 22;
  var n = bars.length;
  var lo = Math.min.apply(null, bars.map(function(b){return b.l}));
  var hi = Math.max.apply(null, bars.map(function(b){return b.h}));
  var x = function(i){ return padL + (W - padL - padR) * (i / Math.max(1, n - 1)); };
  var y = function(v){ return padT + (Hh - padT - padB) * (1 - (v - lo) / (hi - lo)); };
  var bw = Math.max(1.2, (W - padL - padR) / n * 0.6);
  var out = [];
  // grid
  for (var g = 0; g <= 4; g++) {
    var v = lo + (hi - lo) * g / 4;
    out.push('<line x1="'+padL+'" x2="'+(W-padR)+'" y1="'+y(v).toFixed(1)+'" y2="'+y(v).toFixed(1)+'" stroke="#1f2630"/>');
    out.push('<text x="'+(W-padR+4)+'" y="'+(y(v)+3).toFixed(1)+'" fill="#6e7681" font-size="10">'+v.toPrecision(4)+'</text>');
  }
  bars.forEach(function(b, i){
    var up = b.c >= b.o, col = up ? '#3fb950' : '#f85149';
    out.push('<line x1="'+x(i).toFixed(1)+'" x2="'+x(i).toFixed(1)+'" y1="'+y(b.h).toFixed(1)+'" y2="'+y(b.l).toFixed(1)+'" stroke="'+col+'"/>');
    var top = y(Math.max(b.o,b.c)), bot = y(Math.min(b.o,b.c));
    out.push('<rect x="'+(x(i)-bw/2).toFixed(1)+'" y="'+top.toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+Math.max(1,bot-top).toFixed(1)+'" fill="'+col+'"/>');
  });
  c.marks.forEach(function(m){
    var k = bars.findIndex(function(b){ return b.d === m.date; });
    if (k < 0) return;
    out.push('<line x1="'+x(k).toFixed(1)+'" x2="'+x(k).toFixed(1)+'" y1="'+padT+'" y2="'+(Hh-padB)+'" stroke="#f59e0b" stroke-dasharray="4 3"/>');
    out.push('<text x="'+(x(k)+3).toFixed(1)+'" y="'+(padT+11)+'" fill="#f59e0b" font-size="10">'+m.date.slice(5)+'</text>');
  });
  out.push('<text x="'+padL+'" y="'+(Hh-4)+'" fill="#8b949e" font-size="10">'+bars[0].d+'</text>');
  out.push('<text x="'+(W-padR)+'" y="'+(Hh-4)+'" fill="#8b949e" font-size="10" text-anchor="end">'+bars[n-1].d+'</text>');
  svg.innerHTML = out.join('');
});
</script></body></html>`;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html, 'utf8');
console.log(`wrote ${OUT}, cards ${cards.length}`);
