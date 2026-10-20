/**
 * 生成一张可读的图：今日粗筛名单，每个币一张卡（日线 + 拉升区间底纹 + 离顶距离）。
 * 让你一眼看出"这一批值不值得标压力位"。
 *
 * 输出 out/list-<date>.html（用浏览器打开）
 *
 * Run: node .trellis/tasks/10-20-anomaly-level-tracker/research/build-page.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = '.trellis/tasks/10-20-anomaly-level-tracker/research';
const OUT = path.join(DIR, 'out');
const dayOf = (t) => new Date(Number(t)).toISOString().slice(0, 10);

const list = JSON.parse(fs.readFileSync(path.join(OUT, 'rally-list.json'), 'utf8'));
const AS_OF = list[0]?.asOf ?? dayOf(Date.now());
const SHOW = Number(process.env.SHOW ?? 60);

// 可选：读入用户画的压力位。
// 只认 draw/labels.json（用户在新页面上画的线）。上一轮的 labels.json 是 4~10 月
// 历史区间的线，拿来对比今天的价格没有意义（会几乎全部显示"已破线"）。
const userLines = new Map();
for (const p of [path.join(DIR, 'draw', 'labels.json')]) {
  if (!fs.existsSync(p)) continue;
  for (const g of JSON.parse(fs.readFileSync(p, 'utf8'))) {
    for (const l of g.lines ?? []) {
      if (l.kind !== 'h') continue;
      const key = g.inst.replace(/USDT$/, '');
      if (!userLines.has(key)) userLines.set(key, []);
      userLines.get(key).push(l.price);
    }
  }
}
const hasUserLines = userLines.size > 0;

const bars = new Map();
for (const f of fs.readdirSync(path.join(DIR, 'pool'))) {
  if (!f.endsWith('.json')) continue;
  const raw = JSON.parse(fs.readFileSync(path.join(DIR, 'pool', f), 'utf8'));
  bars.set(f.replace(/\.json$/, ''), raw.map(([t, o, h, l, c]) => ({ t: Number(t), o, h, l, c, d: dayOf(t) })));
}

function sparkline(arr, from, to, peak, color, userLines = []) {
  const seg = arr.slice(Math.max(0, from), to + 1);
  const lo = Math.min(...seg.map((b) => b.l));
  const hi = Math.max(...seg.map((b) => b.h), ...(userLines.length ? userLines : [-Infinity]));
  const W = 560;
  const H = 92;
  // 只画 [from-90, to]，让拉升区间落在图中间而不是贴左边缘
  const view0 = Math.max(0, from - 90);
  const view1 = to;
  const span = Math.max(1, view1 - view0);
  const x = (i) => ((i - view0) / span) * W;
  const y = (v) => H - ((v - lo) / (hi - lo || 1)) * H * 0.92 - H * 0.04;
  const pts = arr.slice(view0, view1 + 1).map((b, i) => `${x(view0 + i).toFixed(1)},${y(b.c).toFixed(1)}`).join(' ');
  const lineEls = userLines
    .map((l) => `<line x1="0" y1="${y(l).toFixed(1)}" x2="${W}" y2="${y(l).toFixed(1)}" stroke="#5aa9ff" stroke-width="1" opacity="0.9"/>`)
    .join('');
  return `<svg viewBox="0 0 ${W} ${H + 4}" preserveAspectRatio="none" class="spark">
    <rect x="${Math.max(0, x(from)).toFixed(1)}" y="0" width="${Math.max(0, x(to) - Math.max(0, x(from))).toFixed(1)}" height="${H}" fill="#ffd96622"/>
    ${lineEls}
    <line x1="0" y1="${y(peak).toFixed(1)}" x2="${W}" y2="${y(peak).toFixed(1)}" stroke="#e8a33d" stroke-dasharray="4 3" stroke-width="1"/>
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.4" stroke-linejoin="round"/>
    <text x="${Math.max(4, x(from) + 4).toFixed(1)}" y="11" fill="#8b939e" font-size="9">← 拉升前 90 根</text>
  </svg>`;
}

const html = `<!doctype html>
<meta charset="utf-8">
<title>粗筛名单 ${AS_OF}</title>
<style>
  body{background:#14171c;color:#d7dae0;font:13px/1.5 -apple-system,"Segoe UI",system-ui,sans-serif;margin:0;padding:24px}
  h1{font-size:18px;margin:0 0 4px}
  .note{color:#8b939e;margin-bottom:18px;font-size:12px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(580px,1fr));gap:14px}
  .card{background:#1b1f26;border:1px solid #2a2f38;border-radius:8px;padding:10px 12px}
  .hd{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px}
  .inst{font-weight:600;font-size:14px;color:#fff}
  .meta{color:#8b939e;font-size:11px}
  .num{font-variant-numeric:tabular-nums}
  .up{color:#3ddc84}.dn{color:#ff5c6c}
  .spark{width:100%;height:92px;display:block}
  .legend{display:flex;gap:16px;margin:10px 0 16px;font-size:12px;color:#aeb6c2}
  .sw{display:inline-block;width:12px;height:12px;vertical-align:-1px;margin-right:5px}
</style>
<h1>粗筛名单 · ${AS_OF}</h1>
<div class="note">
  口径：拉升 ≥30% 且 ≥4 天，顶后回吐 ≤60%。全池 443 个加密币 → 候选 ${list.length} 个（下面显示前 ${Math.min(SHOW, list.length)} 个，按离拉升顶最近排序）。<br>
  这张表<b>只回答"最近拉过没"</b>，不判断能不能做。下一步是你在图上标压力位。
</div>
<div class="legend">
  <span><span class="sw" style="background:#ffd96644;border:1px solid #e8a33d"></span>拉升区间</span>
  <span><span class="sw" style="background:#e8a33d"></span>拉升最高点</span>
  <span>离顶 = 现价低于这波最高点的幅度（负数 = 已创新高）</span>
</div>
<div class="grid">
${list.slice(0, SHOW).map((r) => {
  const arr = bars.get(`${r.inst}USDT`);
  if (!arr) return '';
  const E = arr.findIndex((b) => b.d === r.e);
  const s = arr.findIndex((b) => b.d === r.s0);
  const col = r.todayPct >= 0 ? '#3ddc84' : '#ff5c6c';
  // 第 3 步：距上方最近一条用户线
  const myLines = userLines.get(r.inst) ?? [];
  const price = Number(r.price);
  const above = myLines.filter((l) => l > price).sort((a, b) => a - b);
  const toLevel = above.length ? `${(((above[0] - price) / price) * 100).toFixed(2)}%` : myLines.length ? '已破线' : '—';
  return `<div class="card">
    <div class="hd"><span class="inst">${r.inst}</span>
      <span class="meta">拉升 ${r.s0} → ${r.p}　涨幅 <b>${r.gain}%</b>　顶后 ${r.holdDays} 天</span></div>
    ${sparkline(arr, s, E, r.peak, col, myLines)}
    <div class="hd"><span class="num meta">现价 ${r.price}　${myLines.length ? `${myLines.length} 条线` : '未标线'}</span>
      <span class="num">离顶 <b class="${r.fromPeak < 0 ? 'up' : ''}">${r.fromPeak}%</b>　当日 <b class="${r.todayPct >= 0 ? 'up' : 'dn'}">${r.todayPct >= 0 ? '+' : ''}${r.todayPct}%</b>　距线 <b>${toLevel}</b></span></div>
  </div>`;
}).join('\n')}
</div>`;
fs.writeFileSync(path.join(OUT, `list-${AS_OF}.html`), html);
console.log(`写出 out/list-${AS_OF}.html（${Math.min(SHOW, list.length)} 张卡）`);
