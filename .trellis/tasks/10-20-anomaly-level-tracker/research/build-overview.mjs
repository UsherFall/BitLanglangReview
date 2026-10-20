/**
 * 第二种画法：不截断窗口，画"这只币自己最近 200 根"的全貌。
 * 验证用户说的"像已突破"是不是因为原来那版只画到顶后几天、把回踩截掉了。
 *
 * 输出 out/overview.html
 * Run: node .trellis/tasks/10-20-anomaly-level-tracker/research/build-overview.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = '.trellis/tasks/10-20-anomaly-level-tracker/research';
const OUT = path.join(DIR, 'out');
const dayOf = (t) => new Date(Number(t)).toISOString().slice(0, 10);

const list = JSON.parse(fs.readFileSync(path.join(OUT, 'rally-list.json'), 'utf8'));
const AS_OF = list[0]?.asOf ?? '';
const SHOW = Number(process.env.SHOW ?? 45);
const BARS = Number(process.env.BARS ?? 200);

const bars = new Map();
for (const f of fs.readdirSync(path.join(DIR, 'pool'))) {
  if (!f.endsWith('.json')) continue;
  const raw = JSON.parse(fs.readFileSync(path.join(DIR, 'pool', f), 'utf8'));
  bars.set(f.replace(/\.json$/, ''), raw.map(([t, o, h, l, c]) => ({ t: Number(t), o, h, l, c, d: dayOf(t) })));
}

function chart(arr, r) {
  const view = arr.slice(-BARS);
  const lo = Math.min(...view.map((b) => b.l));
  const hi = Math.max(...view.map((b) => b.h));
  const W = 560;
  const H = 130;
  const x = (i) => (i / Math.max(1, view.length - 1)) * W;
  const y = (v) => H - ((v - lo) / (hi - lo || 1)) * H * 0.9 - H * 0.05;
  const s = Math.max(0, view.findIndex((b) => b.d === r.s0));
  const p = Math.max(0, view.findIndex((b) => b.d === r.p));
  const E = view.length - 1;

  // 蜡烛（细线）：用 high-low 画影线，避免只看收盘价把回踩抹平
  const wicks = view
    .map((b, i) => `<line x1="${x(i).toFixed(1)}" y1="${y(b.h).toFixed(1)}" x2="${x(i).toFixed(1)}" y2="${y(b.l).toFixed(1)}" stroke="${b.c >= b.o ? '#3ddc84' : '#ff5c6c'}" stroke-width="0.9" opacity="0.75"/>`)
    .join('');
  return `<svg viewBox="0 0 ${W} ${H + 4}" preserveAspectRatio="none" class="spark">
    <rect x="${x(s).toFixed(1)}" y="0" width="${Math.max(0, x(p) - x(s)).toFixed(1)}" height="${H}" fill="#ffd96618"/>
    ${wicks}
    <line x1="0" y1="${y(r.peak).toFixed(1)}" x2="${W}" y2="${y(r.peak).toFixed(1)}" stroke="#e8a33d" stroke-dasharray="4 3" stroke-width="1"/>
    <line x1="${x(p).toFixed(1)}" y1="0" x2="${x(p).toFixed(1)}" y2="${H}" stroke="#e8a33d" stroke-width="0.6" opacity="0.5"/>
    <circle cx="${x(E).toFixed(1)}" cy="${y(Number(r.price)).toFixed(1)}" r="2.4" fill="#fff"/>
    <text x="3" y="10" fill="#8b939e" font-size="9">${view[0].d.slice(5)}</text>
    <text x="${W - 26}" y="10" fill="#8b939e" font-size="9">${AS_OF.slice(5)}</text>
  </svg>`;
}

const html = `<!doctype html>
<meta charset="utf-8">
<title>最近 200 根全貌 · ${AS_OF}</title>
<style>
  body{background:#14171c;color:#d7dae0;font:13px/1.5 -apple-system,"Segoe UI",system-ui,sans-serif;margin:0;padding:24px}
  h1{font-size:18px;margin:0 0 4px}
  .note{color:#8b939e;margin-bottom:18px;font-size:12px;line-height:1.7}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(580px,1fr));gap:14px}
  .card{background:#1b1f26;border:1px solid #2a2f38;border-radius:8px;padding:10px 12px}
  .hd{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px}
  .inst{font-weight:600;font-size:14px;color:#fff}
  .meta{color:#8b939e;font-size:11px}
  .num{font-variant-numeric:tabular-nums}
  .up{color:#3ddc84}.dn{color:#ff5c6c}
  .spark{width:100%;height:130px;display:block}
  .legend{display:flex;gap:18px;margin:10px 0 16px;font-size:12px;color:#aeb6c2;flex-wrap:wrap}
  .sw{display:inline-block;width:12px;height:12px;vertical-align:-1px;margin-right:5px}
</style>
<h1>最近 200 根全貌 · ${AS_OF}</h1>
<div class="note">
  这一版<b>不截窗口</b>：每张图都是该币最近 ${BARS} 根日线的完整走势（高低影线也画出来了），拉升区间只是淡黄色底纹。<br>
  目的是回答你上一条：<b>“这些是不是已经拉起来突破了”</b>。
</div>
<div class="legend">
  <span><span class="sw" style="background:#ffd96633;border:1px solid #e8a33d"></span>拉升区间</span>
  <span><span class="sw" style="background:#e8a33d"></span>这波最高点</span>
  <span><span class="sw" style="background:#fff"></span>现在</span>
</div>
<div class="grid">
${list.slice(0, SHOW).map((r) => {
  const arr = bars.get(`${r.inst}USDT`);
  if (!arr) return '';
  return `<div class="card">
    <div class="hd"><span class="inst">${r.inst}</span>
      <span class="meta">拉升 ${r.s0.slice(5)} → ${r.p.slice(5)}　涨幅 <b>${r.gain}%</b>　顶后 ${r.holdDays} 天</span></div>
    ${chart(arr, r)}
    <div class="hd"><span class="num meta">现价 ${r.price}</span>
      <span class="num">离顶 <b>${r.fromPeak}%</b>　当日 <b class="${r.todayPct >= 0 ? 'up' : 'dn'}">${r.todayPct >= 0 ? '+' : ''}${r.todayPct}%</b></span></div>
  </div>`;
}).join('\n')}
</div>`;
fs.writeFileSync(path.join(OUT, 'overview.html'), html);
console.log(`写出 out/overview.html（${Math.min(SHOW, list.length)} 张）`);
