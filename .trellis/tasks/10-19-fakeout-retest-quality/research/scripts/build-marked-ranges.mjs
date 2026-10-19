/**
 * Cards for the review the user ACTUALLY asked for: every date-range his own 备注
 * points at ("9-28到9-30那段横盘是好机会", "5-20到8-17 大三角", "8-31后那段横盘" …),
 * not today's ranking.
 *
 * one card per 区间. Each card draws:
 *   - 区间带（精确命中他说的那几根；开放区间用 5~20 根估）
 *   - 收敛框（区间内 5 根滑窗里最紧的那一框 = 他眼睛里那个"箱"）
 *   - 之后 5 个交易日：收盘突破框顶 → 突破 ✓ / 否则 ✗
 *   - retention 在该区间末（判据当时会给它打多少分）
 * 分组：你说"可以/好"的区间 vs 你说"现在做不了/一般"的（判据应该分开它们）。
 *
 * Run: POOL_DIR=<dir> OUT=<html> node <this>
 */
import fs from 'node:fs';
import path from 'node:path';

const POOL_DIR = process.env.POOL_DIR;
const OUT = process.env.OUT ?? '.scratch/research-10-19/marked-ranges.html';
const WINDOW = 60;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const daily = new Map();
for (const f of fs.readdirSync(POOL_DIR)) {
  if (!f.endsWith('.json')) continue;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(POOL_DIR, f), 'utf8'));
    if (Array.isArray(raw) && raw.length >= 100) daily.set(f.replace(/\.json$/, ''), raw.map(([t, o, h, l, c]) => ({ t, o, h, l, c })));
  } catch { /* skip */ }
}
console.log(`daily ${daily.size}`);

function retention(arr, E, look = WINDOW) {
  const from = Math.max(0, E - look + 1);
  const w = arr.slice(from, E + 1);
  if (w.length < 20) return null;
  let loIdx = 0;
  for (let i = 1; i < w.length; i++) if (w[i].c < w[loIdx].c) loIdx = i;
  const lo = w[loIdx].c;
  let hi = -Infinity, hiIdx = loIdx;
  for (let i = loIdx; i < w.length; i++) if (w[i].h > hi) { hi = w[i].h; hiIdx = i; }
  if (!(hi > lo)) return null;
  return { r: (arr[E].c - lo) / (hi - lo), lo, loIdx: from + loIdx, hi, hiIdx };
}

const idxAtOrBefore = (arr, date) => {
  const t = Date.parse(`${date}T00:00:00Z`) + 86_399_999;
  let best = -1;
  for (let i = 0; i < arr.length; i++) if (arr[i].t <= t) best = i;
  return best;
};

/**
 * The range the user pointed at, as UTC day indices (nearest bar at-or-before each end).
 * `open` ranges ("8-31后") get `estBars` bars from the start; the card says so.
 */
function rangeIdx(arr, start, end, estBars = 10) {
  const s = idxAtOrBefore(arr, start);
  if (s < 0) return null;
  if (end) {
    const e = idxAtOrBefore(arr, end);
    if (e < s) return null;
    return { from: s, to: e, open: false };
  }
  return { from: s, to: Math.min(arr.length - 1, s + estBars), open: true };
}

/** tightest 5-bar box inside the range → what the eye calls "那段横盘". */
function tightBox(arr, r) {
  let best = null;
  if (r.to - r.from + 1 < 5) return null; // a 2-3 bar range has no 5-bar box: the card says "无框"
  for (let e = r.from + 4; e <= r.to; e++) {
    const w = arr.slice(e - 4, e + 1);
    const hi = Math.max(...w.map((b) => b.h));
    const lo = Math.min(...w.map((b) => b.l));
    if (!(hi > 0)) continue;
    const width = (hi - lo) / hi;
    if (best === null || width < best.width) best = { from: e - 4, to: e, hi, lo, width };
  }
  // the box must actually END where the range ends, else the "breakout" tests a
  // later box the user never pointed at.
  return best;
}

/** Did a close take out the box's top within `nb` sessions after it ended? */
function breakoutAfter(arr, boxIdx, hi, nb = 5) {
  const fwd = arr.slice(boxIdx + 1, boxIdx + 1 + nb);
  if (!fwd.length) return { ok: false, bars: 0, reason: 'no-forward' };
  const i = fwd.findIndex((b) => b.c > hi);
  // A failed breakout is only meaningful once the whole forward window exists:
  // if the range sits at the END of the series, the verdict is "未知", not "✗".
  if (i < 0 && fwd.length < nb) return { ok: false, bars: fwd.length, reason: 'too-recent' };
  return i < 0 ? { ok: false, bars: fwd.length, reason: 'none' } : { ok: true, bars: i + 1, reason: 'breakout' };
}

// ------------------------------------------------------------------ the marked ranges, read from the notes
// start / end are the dates the user wrote; `est` = bars for an OPEN range; `verdict` is the
// user's own verdict about THAT range (not about the instrument's label):
//   good = "好机会 / 可以看 / 能扫出来"      weak = "一般 / 可以看但不够好"
const RANGES = [
  // ---- 你说好的
  { inst: 'WALUSDT', start: '2026-09-29', est: 12, quote: '9月29往后的收敛好', verdict: 'good' },
  { inst: 'WALUSDT', start: '2026-10-10', end: '2026-10-12', quote: '10-10到10-12这些收敛都很好', verdict: 'good' },
  { inst: 'FLUIDUSDT', start: '2026-09-28', end: '2026-09-30', quote: '9-28到9-30那几根收敛（这个也好）', verdict: 'good' },
  { inst: 'INITUSDT', start: '2026-09-06', end: '2026-09-08', quote: '9-6到9-8那段收敛是我想要的', verdict: 'good' },
  { inst: 'INITUSDT', start: '2026-09-17', end: '2026-09-19', quote: '9-17到9-19那段也是我想要的', verdict: 'good' },
  { inst: 'BATUSDT', start: '2026-09-28', end: '2026-09-30', quote: '9-28到9-30那段横盘是好机会', verdict: 'good' },
  { inst: 'BEAMUSDT', start: '2026-09-28', end: '2026-10-02', quote: '9-28到10-2是好机会', verdict: 'good' },
  { inst: 'AXLUSDT', start: '2026-10-03', end: '2026-10-05', quote: '10-3到10-5那段收敛还是要扫出来', verdict: 'weak' },
  { inst: 'VELODROMEUSDT', start: '2026-08-28', end: '2026-09-01', quote: '8-28到9-1那段是可以的', verdict: 'good' },
  { inst: 'XMRUSDT', start: '2026-08-09', end: '2026-08-13', quote: '8-9到8-13很好', verdict: 'good' },
  { inst: 'XMRUSDT', start: '2026-08-16', end: '2026-08-20', quote: '8-16到8-20都很好', verdict: 'good' },
  { inst: 'OPGUSDT', start: '2026-10-02', end: '2026-10-07', quote: '10-2到10-7那段好', verdict: 'good' },
  { inst: 'TIAUSDT', start: '2026-10-03', end: '2026-10-05', quote: '10-3到10-5好', verdict: 'good' },
  { inst: 'OPUSDT', start: '2026-10-10', end: '2026-10-12', quote: '最近的几根收敛10-10到10-12', verdict: 'good' },
  { inst: 'OPUSDT', start: '2026-08-21', end: '2026-09-16', quote: '前面那段大三角收敛8-21到9-16', verdict: 'good' },
  { inst: 'STRKUSDT', start: '2026-09-25', end: '2026-10-01', quote: '9-25到10-1的收敛很好', verdict: 'good' },
  { inst: 'ZECUSDT', start: '2026-05-20', end: '2026-08-17', quote: '前面的大三角收敛很好5-20到8-17', verdict: 'good' },
  { inst: 'ZECUSDT', start: '2026-08-26', end: '2026-09-01', quote: '突破后的8-26到9-1也还可以', verdict: 'good' },
  { inst: 'AZTECUSDT', start: '2026-09-18', est: 12, quote: '更好的机会是9-18后面那段突破前横盘', verdict: 'good' },
  { inst: 'BERAUSDT', start: '2026-08-31', est: 12, quote: '8-31后那段横盘要扫出来的', verdict: 'good' },
  { inst: 'NEARUSDT', start: '2026-08-25', est: 10, quote: '8-25后面那段收敛很好', verdict: 'good' },
  { inst: 'NIGHTUSDT', start: '2026-08-19', est: 10, quote: '8-19后面那段收敛好', verdict: 'good' },
  { inst: 'SIGNUSDT', start: '2026-09-10', est: 12, quote: '9-10后面那段横盘收敛好', verdict: 'good' },
  { inst: 'FLUXUSDT', start: '2026-09-29', est: 10, quote: '9-29后面那段横盘好', verdict: 'good' },
  { inst: 'AEROUSDT', start: '2026-09-09', est: 10, quote: '9-9后那段横盘可以看', verdict: 'good' },
  { inst: 'LINEAUSDT', start: '2026-08-23', est: 10, quote: '8-23后面那段横盘可以看', verdict: 'good' },
  { inst: 'PYTHUSDT', start: '2026-09-04', est: 10, quote: '9-4后面那段横盘是要关注的', verdict: 'good' },
  { inst: 'BTWUSDT', start: '2026-09-03', est: 10, quote: '只有9-03后面那些收敛可以看', verdict: 'good' },
  { inst: 'STXUSDT', start: '2026-08-31', est: 12, quote: '会去关注8-31后的那段高位横盘', verdict: 'good' },
  { inst: 'INJUSDT', start: '2026-04-18', est: 12, quote: '4-18后面那段横盘算是好机会', verdict: 'good' },
  { inst: 'QUSDT', start: '2026-06-23', est: 10, quote: '6月23往后那段收敛可以看下', verdict: 'good' },
  { inst: 'QUSDT', start: '2026-07-13', est: 10, quote: '7月13往后的收敛可以看下', verdict: 'good' },
  { inst: 'BTCUSDT', start: '2026-08-17', est: 8, quote: '8-17弹起来后小级别有收敛', verdict: 'good' },
  { inst: 'BTCUSDT', start: '2026-09-18', end: '2026-09-19', quote: '9-18到9-19小级别也有收敛也是好机会', verdict: 'good' },
];

// ------------------------------------------------------------------ build the cards
const cards = [];
let missData = 0;
for (const rg of RANGES) {
  const arr = daily.get(rg.inst);
  if (!arr) { missData++; continue; }
  const r = rangeIdx(arr, rg.start, rg.end, rg.est ?? 10);
  if (!r) { missData++; continue; }
  const box = tightBox(arr, r);
  const brk = box ? breakoutAfter(arr, box.to, box.hi) : null;
  const m = retention(arr, box ? box.to : r.to);
  const from = Math.max(0, Math.min(r.from, box ? box.from : r.from) - 40);
  // the card must SHOW the forward window; near the end of the series it is clamped.
  const to = Math.min(arr.length - 1, Math.max(r.to, box ? box.to : r.to) + 12);
  cards.push({
    ...rg,
    open: r.open,
    rangeDates: [iso(arr[r.from].t), iso(arr[r.to].t)],
    nBars: r.to - r.from + 1,
    box: box ? { from: iso(arr[box.from].t), to: iso(arr[box.to].t), hi: box.hi, lo: box.lo, width: box.width } : null,
    breakout: brk,
    retention: m ? m.r : null,
    bars: arr.slice(from, to + 1).map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, idx: arr.indexOf(b) })),
    rangeIdx: { from: r.from, to: r.to, fromDate: iso(arr[r.from].t), toDate: iso(arr[r.to].t) },
    boxIdx: box ? { from: box.from, to: box.to } : null,
    breakoutIdx: brk && brk.ok && box ? box.to + brk.bars : null,
  });
}
console.log(`cards ${cards.length}, ranges without data ${missData}`);

const good = cards.filter((c) => c.verdict === 'good');
const weak = cards.filter((c) => c.verdict === 'weak');
const brkRate = (list) => {
  const settled = list.filter((c) => c.breakout && c.breakout.reason !== 'too-recent');
  const ok = settled.filter((c) => c.breakout.ok).length;
  return { ok, n: settled.length, pct: settled.length ? (ok / settled.length) * 100 : 0, unknown: list.length - settled.length };
};
const g = brkRate(good), w = brkRate(weak);
const retOf = (list) => {
  const vals = list.map((c) => c.retention).filter((v) => v != null).sort((a, b) => b - a);
  return vals.length ? { n: vals.length, mid: vals[Math.floor(vals.length / 2)], min: vals[vals.length - 1], max: vals[0] } : null;
};
const gr = retOf(good), wr = retOf(weak);

const cardHtml = (c) => `
  <section class="card ${c.verdict}" data-bars='${esc(JSON.stringify(c))}'>
    <header>
      <b>${esc(c.inst.replace(/USDT$/, ''))} · ${esc(c.rangeDates[0])}${c.open ? ' 起' : ' → ' + esc(c.rangeDates[1])}${c.open ? `（开放区间，按 ${c.nBars} 根看）` : ''}</b>
      <span>${c.verdict === 'good' ? '<i class="good">你说：可以</i>' : '<i class="weak">你说：一般</i>'}
      ${c.breakout
        ? (c.breakout.reason === 'too-recent'
          ? '<i class="unk">之后数据不足（区间太新）</i>'
          : c.breakout.ok
            ? `<i class="ok">之后第 ${c.breakout.bars} 天突破 ✓</i>`
            : '<i class="bad">之后 5 天没突破 ✗</i>')
        : '<i class="bad">之后无数据</i>'}
      ${c.retention != null ? `· 区间末位置 <em>${(c.retention * 100).toFixed(0)}%</em>` : ''}
      ${c.box ? `· 收敛框 ${(c.box.width * 100).toFixed(1)}%` : ''}</span>
    </header>
    <div class="note">「${esc(c.quote)}」</div>
    <svg viewBox="0 0 620 190" class="chart"></svg>
    <div class="legend">橙框＝你说的区间 · 蓝框＝区间内最紧的 5 根（判断"突破"用它）· 紫箭头＝突破那根 · 灰带＝判据的 60 根窗口</div>
  </section>`;

const html = `<!doctype html><html><head><meta charset="utf-8"><title>你备注里点名的区间 · 判据能不能扫出来</title><style>
body{margin:0;background:#0d1117;color:#c9d1d9;font:13px/1.45 "Microsoft YaHei",system-ui,sans-serif}
h1{font-size:16px;padding:14px 20px 6px;margin:0}
.sub{padding:0 20px 14px;color:#8b949e;font-size:12px;border-bottom:1px solid #21262d;line-height:1.7}
.sub code{background:#161b22;padding:1px 5px;border-radius:4px}
.sum{display:flex;gap:18px;flex-wrap:wrap;padding:12px 20px;border-bottom:1px solid #21262d}
.sum div{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:8px 14px;min-width:170px}
.sum b{display:block;font-size:20px;color:#e6edf3}
.sum span{font-size:11px;color:#8b949e}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(620px,1fr));gap:14px;padding:14px}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:10px 12px}
.card.weak{border-color:#7d5b22}
.card header{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:11px;color:#8b949e}
.card header b{color:#e6edf3;font-size:13px}
.card i{font-style:normal;margin-left:6px}
i.good{color:#3fb950}i.weak{color:#f0b429}i.ok{color:#3fb950}i.bad{color:#f85149}i.unk{color:#8b949e}
.card em{color:#58a6ff;font-style:normal}
.note{font-size:11px;color:#9aa4b2;margin:4px 0 4px;border-left:2px solid #30363d;padding-left:8px}
.legend{font-size:10.5px;color:#6e7681;margin-top:2px}
</style></head><body>
<h1>你备注里点名的 ${cards.length} 个区间 · 判据能扫出来吗</h1>
<div class="sub">
这是**你自己说的那些区间**（不是今天的排名）。每一张：橙框＝你说的时间段；蓝框＝区间里最紧的 5 根（"那段横盘"）；之后 5 个交易日收盘价突破蓝框顶 = <b>突破 ✓</b>。
判据看的是"区间末那一刻"的位置（retention）：<code>最近 60 根最低收盘 → 之后最高价</code>，现价保住了几成。
</div>
<div class="sum">
  <div><b>${g.ok}/${g.n}</b><span>你说"可以"的区间里，之后 5 天突破的（${g.pct.toFixed(0)}%）</span></div>
  <div><b>${w.ok}/${w.n}</b><span>你说"一般/不够好"的区间（${w.n ? w.pct.toFixed(0) : '—'}%）</span></div>
  <div><b>${gr ? (gr.mid * 100).toFixed(0) + '%' : '—'}</b><span>"可以"的区间末 retention 中位数（范围 ${gr ? (gr.min * 100).toFixed(0) + '~' + (gr.max * 100).toFixed(0) : '—'}%）</span></div>
  <div><b>${wr ? (wr.mid * 100).toFixed(0) + '%' : '—'}</b><span>"一般"的区间末 retention 中位数</span></div>
</div>
<div class="grid">${cards.map(cardHtml).join('\n')}</div>
<script>
document.querySelectorAll('section.card').forEach(function(card){
  var c = JSON.parse(card.getAttribute('data-bars'));
  var svg = card.querySelector('svg');
  var bars = c.bars, W = 620, Hh = 190, padL = 6, padR = 62, padT = 8, padB = 16;
  var n = bars.length; if (!n) return;
  var lo = Math.min.apply(null, bars.map(function(b){return b.l}));
  var hi = Math.max.apply(null, bars.map(function(b){return b.h}));
  if (!(hi > lo)) return;
  var x = function(i){ return padL + (W - padL - padR) * (i / Math.max(1, n - 1)); };
  var y = function(v){ return padT + (Hh - padT - padB) * (1 - (v - lo) / (hi - lo)); };
  var bw = Math.max(1.4, (W - padL - padR) / n * 0.62);
  var out = [];
  // 60-bar retention window at the box's end
  var end = c.boxIdx ? c.boxIdx.to : c.rangeIdx.to;
  var winFrom = Math.max(bars[0].idx, end - 59);
  var x1 = x(bars.findIndex(function(b){ return b.idx >= winFrom; }));
  out.push('<rect x="'+x1.toFixed(1)+'" y="'+padT+'" width="'+(x(n-1)-x1).toFixed(1)+'" height="'+(Hh-padT-padB)+'" fill="rgba(139,148,158,.07)"/>');
  // candles
  bars.forEach(function(b, i){
    var up = b.c >= b.o, col = up ? '#3fb950' : '#f85149';
    out.push('<line x1="'+x(i).toFixed(1)+'" x2="'+x(i).toFixed(1)+'" y1="'+y(b.h).toFixed(1)+'" y2="'+y(b.l).toFixed(1)+'" stroke="'+col+'" stroke-width="1"/>');
    var top = y(Math.max(b.o, b.c)), bot = y(Math.min(b.o, b.c));
    out.push('<rect x="'+(x(i)-bw/2).toFixed(1)+'" y="'+top.toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+Math.max(1, bot-top).toFixed(1)+'" fill="'+col+'"/>');
  });
  // the user's range
  var ri = bars.findIndex(function(b){ return b.idx === c.rangeIdx.from; });
  var rj = bars.findIndex(function(b){ return b.idx === c.rangeIdx.to; });
  if (ri >= 0 && rj >= 0) {
    out.push('<rect x="'+x(ri).toFixed(1)+'" y="'+padT+'" width="'+(x(rj)-x(ri)+bw).toFixed(1)+'" height="'+(Hh-padT-padB)+'" fill="rgba(245,158,11,.10)" stroke="#f59e0b" stroke-opacity=".5"/>');
  }
  // the tight box
  if (c.boxIdx) {
    var bi = bars.findIndex(function(b){ return b.idx === c.boxIdx.from; });
    var bj = bars.findIndex(function(b){ return b.idx === c.boxIdx.to; });
    if (bi >= 0 && bj >= 0) {
      out.push('<rect x="'+(x(bi)-bw/2).toFixed(1)+'" y="'+y(c.box.hi).toFixed(1)+'" width="'+(x(bj)-x(bi)+bw).toFixed(1)+'" height="'+(y(c.box.lo)-y(c.box.hi)).toFixed(1)+'" fill="none" stroke="#58a6ff" stroke-width="1.2" stroke-dasharray="3 2"/>');
    }
    // breakout marker
    if (c.breakoutIdx != null) {
      var k = bars.findIndex(function(b){ return b.idx === c.breakoutIdx; });
      if (k >= 0) {
        out.push('<line x1="'+x(k).toFixed(1)+'" x2="'+x(k).toFixed(1)+'" y1="'+y(c.box.hi).toFixed(1)+'" y2="'+y(bars[k].c).toFixed(1)+'" stroke="#a371f7" stroke-width="1.6"/>');
        out.push('<circle cx="'+x(k).toFixed(1)+'" cy="'+y(bars[k].c).toFixed(1)+'" r="3" fill="#a371f7"/>');
        out.push('<text x="'+x(k).toFixed(1)+'" y="'+(y(bars[k].c)-6).toFixed(1)+'" fill="#a371f7" font-size="9" text-anchor="middle">突破</text>');
      }
    }
  }
  out.push('<text x="'+padL+'" y="'+(Hh-3)+'" fill="#8b949e" font-size="9">'+new Date(bars[0].t).toISOString().slice(0,10)+'</text>');
  out.push('<text x="'+(W-padR)+'" y="'+(Hh-3)+'" fill="#8b949e" font-size="9" text-anchor="end">'+new Date(bars[n-1].t).toISOString().slice(0,10)+'</text>');
  svg.innerHTML = out.join('');
});
</script></body></html>`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html, 'utf8');
console.log(`wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
console.log(`  你说"可以"的区间：突破 ${g.ok}/${g.n} = ${g.pct.toFixed(0)}%；retention 中位 ${gr ? (gr.mid * 100).toFixed(0) : '—'}%（${gr ? (gr.min * 100).toFixed(0) : ''}~${gr ? (gr.max * 100).toFixed(0) : ''}）`);
console.log(`  "一般"的区间：${w.ok}/${w.n}（${w.n ? w.pct.toFixed(0) : '—'}%）；retention 中位 ${wr ? (wr.mid * 100).toFixed(0) : '—'}%`);
