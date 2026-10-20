/**
 * 用户 10/20："我想要的还是在底部拉升然后盘整的币，看了下这些都拉的好高"
 *
 * 实测（diag-height.mjs / sweep-gain.mjs）：
 *   你标的 36 段：涨幅中位 43%，72% 落在 15%~80%
 *   今日原来的 82 个候选：涨幅中位 108% → 这就是"拉的好高"
 * 而且只看"涨幅小"不够（覆盖 12/36）；叠上"价格已经回到这波涨幅的一半以上"
 * 才能同时做到：命中数少（17 个）、覆盖高一档（25/36）、与随机分开（2.7x）。
 *
 * 输出 out/bottom-list.html / bottom-list.md
 * Run: node .trellis/tasks/10-20-anomaly-level-tracker/research/build-bottom-list.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = '.trellis/tasks/10-20-anomaly-level-tracker/research';
const OUT = path.join(DIR, 'out');
const dayOf = (t) => new Date(Number(t)).toISOString().slice(0, 10);

const RALLY_MIN = 0.1;
const LOOKBACK = 90;
const G_MIN = Number(process.env.G_MIN ?? 0.2);
const G_MAX = Number(process.env.G_MAX ?? 0.8);
const FB_MIN = Number(process.env.FB_MIN ?? 0.5);
const NO_BREAK = process.env.KEEP_BREAKOUTS !== '1';

const bars = new Map();
for (const f of fs.readdirSync(path.join(DIR, 'pool'))) {
  if (!f.endsWith('.json')) continue;
  const raw = JSON.parse(fs.readFileSync(path.join(DIR, 'pool', f), 'utf8'));
  if (raw.length >= 150) bars.set(f.replace(/\.json$/, ''), raw.map(([t, o, h, l, c]) => ({ t: Number(t), o, h, l, c, d: dayOf(t) })));
}
const todayDay = [...bars.values()].map((a) => a[a.length - 1].d).sort().at(-1);

function shape(arr, E) {
  if (E < LOOKBACK + 5) return null;
  const from = E - LOOKBACK;
  let best = null;
  let lo = from;
  let loC = arr[from].c;
  for (let i = from; i <= E; i++) {
    if (arr[i].c < loC) { loC = arr[i].c; lo = i; }
    const g = (arr[i].h - loC) / loC;
    if (g >= RALLY_MIN && i - lo + 1 >= 3 && (!best || g > best.gain)) best = { sAt: lo, pAt: i, gain: g };
  }
  if (!best) return null;
  const { sAt, pAt } = best;
  const base = arr[Math.max(0, sAt - 1)].c;
  const peak = arr.slice(sAt, pAt + 1).reduce((m, b) => Math.max(m, b.h), -Infinity);
  const now = arr[E].c;
  const after = arr.slice(pAt, E + 1);
  return {
    s0: arr[sAt].d,
    p: arr[pAt].d,
    e: arr[E].d,
    gain: (peak - base) / base,
    fromBase: (now - base) / (peak - base || 1),
    fromPeak: (peak - now) / peak,
    holdDays: E - pAt,
    peak,
    base,
    price: now,
    brokeOut: Math.max(...after.map((b) => b.h)) > peak * 1.0001,
    todayPct: arr[E - 1] ? ((now - arr[E - 1].c) / arr[E - 1].c) * 100 : 0,
    sAt,
    pAt,
    E,
  };
}

const rows = [];
for (const [inst, arr] of bars) {
  const E = arr.findIndex((x) => x.d === todayDay);
  if (E < 0) continue;
  const s = shape(arr, E);
  if (!s) continue;
  if (s.gain < G_MIN || s.gain >= G_MAX) continue;
  if (s.fromBase < FB_MIN) continue;
  if (NO_BREAK && s.brokeOut) continue;
  rows.push({ inst: inst.replace(/USDT$/, ''), ...s });
}
// 越靠近顶越先看（和之前定的一致）
rows.sort((a, b) => a.fromPeak - b.fromPeak);

const fmt = (x, d = 1) => (x * 100).toFixed(d);
console.log(`口径：涨幅 ${(G_MIN * 100) | 0}%~${(G_MAX * 100) | 0}% · 价格回到这波涨幅 ${(FB_MIN * 100) | 0}% 以上${NO_BREAK ? ' · 不报突破' : ''}`);
console.log(`${todayDay}：${rows.length} 个\n`);
console.log(`${'币'.padEnd(9)}${'拉升起点'.padStart(12)}${'顶'.padStart(12)}${'涨幅'.padStart(7)}${'回到几成'.padStart(9)}${'离顶'.padStart(7)}${'顶后'.padStart(5)}${'当日'.padStart(8)}`);
for (const r of rows) {
  console.log(
    `${r.inst.padEnd(9)}${r.s0.padStart(12)}${r.p.padStart(12)}${(fmt(r.gain, 0) + '%').padStart(7)}${(fmt(r.fromBase, 0) + '%').padStart(9)}${(fmt(r.fromPeak) + '%').padStart(7)}${String(r.holdDays).padStart(5)}${((r.todayPct >= 0 ? '+' : '') + r.todayPct.toFixed(2) + '%').padStart(8)}`,
  );
}

// ----------------------------- 页面
function chart(arr, r) {
  const view0 = Math.max(0, r.sAt - 90);
  const view = arr.slice(view0, r.E + 1);
  const lo = Math.min(...view.map((b) => b.l));
  const hi = Math.max(...view.map((b) => b.h));
  const W = 560;
  const H = 130;
  const span = Math.max(1, view.length - 1);
  const x = (i) => (i / span) * W;
  const y = (v) => H - ((v - lo) / (hi - lo || 1)) * H * 0.9 - H * 0.05;
  const sIdx = r.sAt - view0;
  const pIdx = r.pAt - view0;
  const wicks = view
    .map((b, i) => `<line x1="${x(i).toFixed(1)}" y1="${y(b.h).toFixed(1)}" x2="${x(i).toFixed(1)}" y2="${y(b.l).toFixed(1)}" stroke="${b.c >= b.o ? '#3ddc84' : '#ff5c6c'}" stroke-width="0.9" opacity="0.8"/>`)
    .join('');
  return `<svg viewBox="0 0 ${W} ${H + 4}" preserveAspectRatio="none" class="spark">
    <rect x="${x(sIdx).toFixed(1)}" y="0" width="${Math.max(0, x(pIdx) - x(sIdx)).toFixed(1)}" height="${H}" fill="#ffd96616"/>
    ${wicks}
    <line x1="0" y1="${y(r.peak).toFixed(1)}" x2="${W}" y2="${y(r.peak).toFixed(1)}" stroke="#e8a33d" stroke-dasharray="4 3" stroke-width="1"/>
    <line x1="${x(pIdx).toFixed(1)}" y1="0" x2="${x(pIdx).toFixed(1)}" y2="${H}" stroke="#e8a33d" stroke-width="0.6" opacity="0.45"/>
    <circle cx="${x(view.length - 1).toFixed(1)}" cy="${y(r.price).toFixed(1)}" r="2.4" fill="#fff"/>
  </svg>`;
}

const html = `<!doctype html>
<meta charset="utf-8">
<title>底部拉升 · ${todayDay}</title>
<style>
  body{background:#14171c;color:#d7dae0;font:13px/1.5 -apple-system,"Segoe UI",system-ui,sans-serif;margin:0;padding:24px}
  h1{font-size:18px;margin:0 0 6px}
  .note{color:#8b939e;margin-bottom:16px;font-size:12px;line-height:1.8}
  .kpi{display:flex;gap:26px;margin:14px 0 18px;flex-wrap:wrap}
  .kpi div{background:#1b1f26;border:1px solid #2a2f38;border-radius:8px;padding:8px 14px;font-size:12px;color:#8b939e}
  .kpi b{display:block;font-size:20px;color:#fff;margin-top:2px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(580px,1fr));gap:14px}
  .card{background:#1b1f26;border:1px solid #2a2f38;border-radius:8px;padding:10px 12px}
  .hd{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px}
  .inst{font-weight:600;font-size:14px;color:#fff}
  .meta{color:#8b939e;font-size:11px}
  .num{font-variant-numeric:tabular-nums}
  .up{color:#3ddc84}.dn{color:#ff5c6c}
  .spark{width:100%;height:130px;display:block}
  .legend{display:flex;gap:18px;margin:8px 0 14px;font-size:12px;color:#aeb6c2;flex-wrap:wrap}
  .sw{display:inline-block;width:12px;height:12px;vertical-align:-1px;margin-right:5px}
</style>
<h1>底部拉升 + 还算在低位 · ${todayDay}</h1>
<div class="note">
  你说"这些都拉的好高"——我量了一下：你亲手标过的 36 段，涨幅中位 <b>43%</b>；原来那 82 个候选，涨幅中位 <b>108%</b>。<br>
  现在的口径：<b>涨幅 ${(G_MIN * 100) | 0}%~${(G_MAX * 100) | 0}%</b>（这波没被拉飞）＋ <b>价格已回到这波涨幅的 ${(FB_MIN * 100) | 0}% 以上</b>（不是刚启动、也不是还在腰下）${NO_BREAK ? '＋ <b>顶后没创过新高</b>' : ''}。
</div>
<div class="kpi">
  <div>今日命中<b>${rows.length}</b></div>
  <div>覆盖你标的段<b>25 / 36</b></div>
  <div>和随机日的区分度<b>2.7×</b></div>
  <div>原来那版区分度<b>1.0×</b>（等于没区分）</div>
</div>
<div class="legend">
  <span><span class="sw" style="background:#ffd96626;border:1px solid #e8a33d"></span>拉升区间</span>
  <span><span class="sw" style="background:#e8a33d"></span>这波最高点</span>
  <span><span class="sw" style="background:#fff"></span>现在</span>
</div>
<div class="grid">
${rows.map((r) => {
  const arr = bars.get(`${r.inst}USDT`);
  if (!arr) return '';
  return `<div class="card">
    <div class="hd"><span class="inst">${r.inst}</span>
      <span class="meta">拉升 ${r.s0.slice(5)} → ${r.p.slice(5)}　顶后 ${r.holdDays} 天</span></div>
    ${chart(arr, r)}
    <div class="hd"><span class="num meta">现价 ${r.price}</span>
      <span class="num">涨幅 <b>${(r.gain * 100) | 0}%</b>　回到 <b>${(r.fromBase * 100) | 0}%</b>　离顶 <b>${(r.fromPeak * 100).toFixed(1)}%</b>　当日 <b class="${r.todayPct >= 0 ? 'up' : 'dn'}">${r.todayPct >= 0 ? '+' : ''}${r.todayPct.toFixed(2)}%</b></span></div>
  </div>`;
}).join('\n')}
</div>`;
fs.writeFileSync(path.join(OUT, 'bottom-list.html'), html);
console.log(`\n写出 out/bottom-list.html（${rows.length} 张）`);
fs.writeFileSync(path.join(OUT, 'bottom-list.json'), JSON.stringify(rows.map((r) => ({ inst: r.inst, s0: r.s0, p: r.p, gain: +(r.gain * 100).toFixed(1), fromBase: +(r.fromBase * 100).toFixed(0), fromPeak: +(r.fromPeak * 100).toFixed(1), holdDays: r.holdDays, todayPct: +r.todayPct.toFixed(2) })), null, 1));
