/**
 * 把用户口头指出的"三角高点"买到图上，核对：
 *   OP  三角高点：8-22、9-06、9-14
 *   ZEC 三角高点：5-20、7-15、8-09
 * 顺便把这些日子前后各 2 根的 OHLC 打出来，看看那几根到底长什么样。
 *
 * Run: POOL_DIR=<dir> OUT=<html> node <this>
 */
import fs from 'node:fs';
import path from 'node:path';

const POOL_DIR = process.env.POOL_DIR;
const OUT = process.env.OUT ?? 'tools/labeling/out/triangle-points.html';
const iso = (t) => new Date(t).toISOString().slice(0, 10);

const WATCH = [
  { inst: 'OPUSDT', span: ['2026-07-20', '2026-10-10'], highs: ['2026-08-22', '2026-09-06', '2026-09-14'], label: 'OP 三角 · 高点 8-22 / 9-06 / 9-14' },
  { inst: 'ZECUSDT', span: ['2026-04-20', '2026-09-20'], highs: ['2026-05-20', '2026-07-15', '2026-08-09'], label: 'ZEC 三角 · 高点 5-20 / 7-15 / 8-09' },
];

const cards = [];
for (const w of WATCH) {
  const p = path.join(POOL_DIR, `${w.inst}.json`);
  if (!fs.existsSync(p)) continue;
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  const bars = raw.map(([t, o, h, l, c]) => ({ t, o, h, l, c }));
  const from = bars.find((b) => iso(b.t) >= w.span[0]);
  const to = [...bars].reverse().find((b) => iso(b.t) <= w.span[1]);
  const slice = bars.slice(bars.indexOf(from), bars.indexOf(to) + 1);
  const points = w.highs.map((d) => {
    const k = slice.findIndex((b) => iso(b.t) === d);
    const near = k < 0 ? [] : slice.slice(Math.max(0, k - 2), k + 3).map((b) => ({
      d: iso(b.t), o: b.o, h: b.h, l: b.l, c: b.c, isHit: iso(b.t) === d,
    }));
    return { date: d, idx: k, bar: k >= 0 ? { h: slice[k].h, l: slice[k].l, c: slice[k].c } : null, near };
  });
  console.log(`\n=== ${w.label} ===`);
  for (const pt of points) {
    if (!pt.bar) { console.log(`  ${pt.date}: 没有这根 K 线（不在数据范围里）`); continue; }
    console.log(`  ${pt.date}  high=${pt.bar.h}  low=${pt.bar.l}  close=${pt.bar.c}`);
    for (const b of pt.near) console.log(`     ${b.isHit ? '→' : ' '} ${b.d}  H ${b.h}  L ${b.l}  C ${b.c}`);
  }
  // 这两三个高点是不是在收口？
  const hs = points.filter((p) => p.bar).map((p) => ({ d: p.date, h: p.bar.h }));
  if (hs.length >= 2) {
    for (let i = 1; i < hs.length; i++) {
      const drop = (hs[i].h / hs[i - 1].h - 1) * 100;
      const days = Math.round((Date.parse(hs[i].d) - Date.parse(hs[i - 1].d)) / 86_400_000);
      console.log(`  高点 ${hs[i - 1].d} → ${hs[i].d}：${drop.toFixed(2)}%（${days} 天，${(drop / days).toFixed(3)}%/天）`);
    }
  }
  cards.push({
    inst: w.inst.replace(/USDT$/, ''), label: w.label,
    bars: slice.map((b) => ({ d: iso(b.t), o: b.o, h: b.h, l: b.l, c: b.c })),
    points: points.filter((p) => p.idx >= 0).map((p) => ({ idx: p.idx, date: p.date, h: p.bar.h })),
  });
}

const html = `<!doctype html><html><head><meta charset="utf-8"><title>三角高点核对</title><style>
body{margin:0;background:#0d1117;color:#c9d1d9;font:13px/1.45 "Microsoft YaHei",system-ui,sans-serif}
h1{font-size:15px;padding:12px 20px 4px;margin:0}
.sub{padding:0 20px 12px;color:#8b949e;font-size:12px;border-bottom:1px solid #21262d}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:10px 12px;margin:14px}
.card b{color:#e6edf3}
svg{width:100%;height:320px;display:block}
</style></head><body>
<h1>你指出的三角高点（黄圈 = 你说的那几根的高点；黄线 = 顺着这几个点连起来）</h1>
<div class="sub">这条黄线就是"上边"。看它是不是正好贴着那三个高点往下走。</div>
${cards.map((c, i) => `<div class="card"><b>${c.label}</b><svg id="s${i}" viewBox="0 0 900 320"></svg></div>`).join('\n')}
<script>
var C = ${JSON.stringify(cards)};
C.forEach(function(c, ci){
  var svg = document.getElementById('s'+ci), bs = c.bars, W = 900, H = 320, pl = 8, pr = 70, pt = 14, pb = 22;
  var n = bs.length;
  var lo = Math.min.apply(null, bs.map(function(b){return b.l}));
  var hi = Math.max.apply(null, bs.map(function(b){return b.h}));
  var x = function(i){ return pl + (W-pl-pr)*(i/Math.max(1,n-1)); };
  var y = function(v){ return pt + (H-pt-pb)*(1-(v-lo)/Math.max(1e-9, hi-lo)); };
  var bw = Math.max(1.2, (W-pl-pr)/n*0.6);
  var o = [];
  for (var g=0; g<=4; g++){ var v = lo + (hi-lo)*g/4;
    o.push('<line x1="'+pl+'" x2="'+(W-pr)+'" y1="'+y(v)+'" y2="'+y(v)+'" stroke="#1f2630"/>');
    o.push('<text x="'+(W-pr+4)+'" y="'+(y(v)+3)+'" fill="#6e7681" font-size="10">'+v.toPrecision(4)+'</text>'); }
  bs.forEach(function(b, i){
    var up = b.c >= b.o, col = up ? '#3fb950' : '#f85149';
    o.push('<line x1="'+x(i)+'" x2="'+x(i)+'" y1="'+y(b.h)+'" y2="'+y(b.l)+'" stroke="'+col+'"/>');
    var t = y(Math.max(b.o,b.c)), bt = y(Math.min(b.o,b.c));
    o.push('<rect x="'+(x(i)-bw/2)+'" y="'+t+'" width="'+bw+'" height="'+Math.max(1,bt-t)+'" fill="'+col+'"/>');
  });
  if (c.points.length > 1) {
    var pts = c.points.map(function(p){ return x(p.idx)+','+y(p.h); }).join(' ');
    o.push('<polyline points="'+pts+'" fill="none" stroke="#f0b429" stroke-width="1.6" stroke-dasharray="5 3"/>');
  }
  c.points.forEach(function(p){
    o.push('<circle cx="'+x(p.idx)+'" cy="'+y(p.h)+'" r="4" fill="none" stroke="#f0b429" stroke-width="1.5"/>');
    o.push('<text x="'+x(p.idx)+'" y="'+(y(p.h)-8)+'" fill="#f0b429" font-size="10" text-anchor="middle">'+p.date.slice(5)+' '+p.h+'</text>');
  });
  o.push('<text x="'+pl+'" y="'+(H-4)+'" fill="#8b949e" font-size="10">'+bs[0].d+'</text>');
  o.push('<text x="'+(W-pr)+'" y="'+(H-4)+'" fill="#8b949e" font-size="10" text-anchor="end">'+bs[n-1].d+'</text>');
  svg.innerHTML = o.join('');
});
</script></body></html>`;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html, 'utf8');
console.log(`\nwrote ${OUT}`);
