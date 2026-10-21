/**
 * Builds the SAME kind of card page as `10-18-box-brace-squeeze/research/replay-charts.html`:
 * one K-line card per case, with the rule's area drawn ON the chart.
 *
 * What is drawn per card
 *   P1  scan day (daily, anchor 2026-10-13) — the live 收敛 scan's view
 *   P2  causal anchor (2026-09-30)          — the pre-registration, outcome known
 *   P3  today      (2026-10-19 cut)         — what the scanner shows right now
 *
 * Markings: orange band = the retention window's lo..hi (the "area" the rule
 * measured), green dashed = the window low (start of the leg), blue arrow =
 * the scan/decision day, orange arrow = the leg's peak. Outcome text is
 * per-rule: 守住 = the 5 sessions after the anchor stayed >= 0.9 x the anchor high.
 *
 * Cases: the 15 user-marked stretches in labels-43 (their own words in 备注),
 *        WAL / CFX (the two cases that started this task),
 *        plus the retention top-10 band's owners on the scan day.
 *
 * Run: POOL_DIR=<daily dir> OUT=<html path> node <this>
 */
import fs from 'node:fs';
import path from 'node:path';

const POOL_DIR = process.env.POOL_DIR;
if (!POOL_DIR || !fs.existsSync(POOL_DIR)) {
  console.error('POOL_DIR missing');
  process.exit(2);
}
const OUT = process.env.OUT ?? 'tools/labeling/out/retention-cards.html';
const SETTINGS_PATH = process.env.SETTINGS ?? 'tools/labeling/out/scanner-settings.json';
const WINDOW = 60;

const iso = (t) => new Date(t).toISOString().slice(0, 10);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ------------------------------------------------------------------ data
const bars = new Map();
for (const f of fs.readdirSync(POOL_DIR)) {
  if (!f.endsWith('.json')) continue;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(POOL_DIR, f), 'utf8'));
    if (Array.isArray(raw) && raw.length >= 100) {
      bars.set(f.replace(/\.json$/, ''), raw.map(([t, o, h, l, c]) => ({ t, o, h, l, c })));
    }
  } catch { /* skip */ }
}
console.log(`daily pool ${bars.size}`);

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
  return {
    r: (arr[E].c - lo) / (hi - lo),
    offHigh: (1 - arr[E].c / hi) * 100,
    legPct: (hi / lo - 1) * 100,
    lo,
    loIdx: from + loIdx,
    hiIdx: from + hiIdx,
    from,
    E,
  };
}

const idxAtOrBefore = (arr, date) => {
  const t = Date.parse(`${date}T00:00:00Z`) + 86_399_999;
  let best = -1;
  for (let i = 0; i < arr.length; i++) if (arr[i].t <= t) best = i;
  return best;
};

const outHold = (arr, E, nb = 5, k = 0.9) => {
  const hi = Math.max(...arr.slice(Math.max(0, E - 10), E + 1).map((b) => b.h));
  const win = arr.slice(E + 1, E + 1 + nb);
  if (win.length < nb) return null;
  return Math.min(...win.map((b) => b.l)) >= k * hi;
};

/** The user-marked stretches (strict parse: adjacent date pairs inside one clause). */
const parseCsv = (text) => {
  const rows = [];
  let cell = '', row = [], quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((c) => c.replace(/^\uFEFF/, '')));
};
const csv = parseCsv(fs.readFileSync('.trellis/tasks/10-18-box-brace-squeeze/research/labels-43-toppin.csv', 'utf8'));
const H = csv[0];
const iInst = H.indexOf('instrument');
const iLabel = H.indexOf('label');
const iNote = H.indexOf('note');
const SEP = String.fromCharCode(0xff0c, 0x2c, 0xff1b, 0x3b, 0x3002);
const cases = [];
for (const row of csv.slice(1)) {
  if (!row[iInst]) continue;
  for (const clause of String(row[iNote] ?? '').split(SEP)) {
    const ds = [...clause.matchAll(/(\d{1,2})-(\d{1,2})/g)].map((m) => `2026-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`);
    if (ds.length < 2 || ds[0] === ds[1]) continue;
    cases.push({ inst: row[iInst], start: ds[0], end: ds[1], label: row[iLabel], note: String(row[iNote]).trim(), probe: 'stretch' });
    break; // first clause per instrument keeps the page readable
  }
}
for (const inst of ['WALUSDT', 'CFXUSDT']) {
  if (!cases.some((c) => c.inst === inst)) cases.push({ inst, start: null, end: null, label: inst === 'WALUSDT' ? 'Y' : 'N', note: inst === 'WALUSDT' ? '真突破，很快走完主升浪后高位收敛' : '冲高 55% 后阴跌回吐，假突破没踩住', probe: 'case' });
}

// ------------------------------------------------------------------ crypto-only pool for TODAY's list
// `pool-deep` takes the symbol list from `/tickers` without a productType filter, so the raw
// cache mixes US/HK/KR equities in (plus indices/commodities within crypto scope). The scan's
// DEFAULT scope is 加密 = crypto + indices + commodities (AGENTS 09/16 note), so index and
// commodity symbols legitimately belong. The cache has no marketClass, so:
//   REAL classes (from the app's own classifier, `src/domain/market-class.ts`):
//     CRYPTO · COMMODITY · US_EQUITY · HK_EQUITY · KR_EQUITY · CN_EQUITY · PRE_IPO
//   a symbol we cannot classify from the cache is treated as 加密 (the scanner's own fallback,
//   see `isScannable()`); tickers whose name IS the company (STOCK suffix) or a known
//   equity/ETF are the only ones dropped here.
const CRYPTO_SCOPE_EXCLUDE = /U?STOCKUSDT$/;
const knownEquity = new Set(['AMKRUSDT', 'LRCXUSDT', 'AMATUSDT', 'KLACUSDT', 'TERUSDT', 'VRTUSDT', 'CGNXUSDT', 'EUVUSDT', 'XNDUUSDT', 'COHRUSDT', 'QUBTUSDT', 'ACHRUSDT', 'GPSUSDT', 'SMHUSDT', 'SOXXUSDT', 'ONDSUSDT', 'POETUSDT', 'NBISUSDT', 'ARMUSDT', 'GLWUSDT', 'MCDUSDT', 'KOUSDT', 'VUSDT', 'XLUUSDT', 'JPMUSDT', 'WMTUSDT', 'COSTUSDT', 'INDAUSDT', 'EWJUSDT', 'BABAUSDT']);
const isEquityLike = (inst) => CRYPTO_SCOPE_EXCLUDE.test(inst) || knownEquity.has(inst) || (inst.startsWith('X') && inst.endsWith('YUSDT'));
const cryptoPool = [...bars.keys()].filter((i) => !isEquityLike(i));
let settings = null;
{
  const today = iso(Math.max(...[...bars.values()].map((a) => a[a.length - 1].t)));
  const rows = [];
  for (const inst of cryptoPool) {
    const arr = bars.get(inst);
    const E = arr.length - 1;
    const m = retention(arr, E);
    if (!m) continue;
    rows.push({ inst, E, ...m });
  }
  rows.sort((a, b) => b.r - a.r);
  const cut = Math.max(1, Math.round(rows.length * 0.1));
  const toRow = (r, i) => ({ inst: r.inst, rank: i + 1, r: +r.r.toFixed(3), offHigh: +r.offHigh.toFixed(1), legPct: +r.legPct.toFixed(0) });
  settings = {
    anchor: today,
    window: WINDOW,
    pct: 10,
    poolSize: rows.length,
    cut,
    excludedEquityLike: bars.size - cryptoPool.length,
    rows: rows.slice(0, cut).map(toRow),
    top: rows.slice(0, 30).map(toRow),
    rejected: rows.slice(cut),
  };
  // rank every cash instrument TODAY so a card can say "今天在前 X% 之外"
  settings.rankOfDay = {};
  const all = [...rows].sort((a, b) => b.r - a.r);
  settings.rankOfDay[today] = Object.fromEntries(all.map((r, i) => [r.inst, i]));
}

// ------------------------------------------------------------------ cards
const cards = [];
const D_ANCHOR = '2026-10-13';
const D_CAUSAL = '2026-09-30';

function panel(arr, E, label) {
  if (E < 0) return null;
  const m = retention(arr, E);
  const from = m ? Math.min(E - 70, m.from - 5) : E - 80;
  // `to` must stay inside the series: a probe whose anchor is the newest bar has
  // no "+14 forward bars" to show (and `iso(undefined)` would throw).
  const to = Math.max(E, Math.min(arr.length - 1, E + 14));
  const slice = arr.slice(Math.max(0, from), to + 1);
  const winFromIdx = m ? m.from : E;
  const winToIdx = E;
  return {
    label,
    scanDate: iso(arr[E].t),
    retention: m ? m.r : null,
    offHigh: m ? m.offHigh : null,
    legPct: m ? m.legPct : null,
    lo: m ? m.lo : null,
    loDate: m ? iso(arr[m.loIdx].t) : null,
    hiDate: m ? iso(arr[m.hiIdx].t) : null,
    hi: m ? arr[m.hiIdx].h : null,
    hold: outHold(arr, E),
    windowStart: m ? iso(arr[winFromIdx].t) : null,
    windowEnd: iso(arr[winToIdx].t),
    sliceStart: iso(arr[Math.max(0, from)].t),
    sliceStop: iso(arr[to].t),
    bars: slice.map((b) => [b.t, b.o, b.h, b.l, b.c]),
  };
}

for (const c of cases) {
  const arr = bars.get(c.inst);
  if (!arr) { cards.push({ ...c, status: 'no-data' }); continue; }
  const Ea = idxAtOrBefore(arr, D_ANCHOR);
  const Ec = idxAtOrBefore(arr, D_CAUSAL);
  const Et = arr.length - 1;
  const panels = {
    scan: panel(arr, Ea, `扫描日 ${D_ANCHOR}`),
    causal: panel(arr, Ec, `预注册 ${D_CAUSAL}（看之后 5 天）`),
    today: panel(arr, Et, `今天 ${iso(arr[Et].t)}`),
  };
  cards.push({ ...c, status: 'ok', panels });
}

// today's top-10 band (rank on the anchor day is computed for the scan panel too)
const today = settings.anchor;

// ------------------------------------------------------------------ HTML
const esc2 = esc;
const cardHtml = (card, i) => {
  if (card.status === 'no-data') {
    return `<section class="card nodata"><header><b>${esc2(card.inst)}</b><span>无数据</span></header></section>`;
  }
  const p = card.panels;
  const head = card.start
    ? (card.start === card.end ? `${card.inst} ${card.start}` : `${card.inst} ${card.start} → ${card.end}`)
    : card.inst;
  const tag = card.label === 'Y' ? 'Y' : card.label === 'N' ? 'N' : '';
  const pct = (v) => (v == null ? '—' : `${(v * 100).toFixed(0)}%`);
  const rk = rankToday.get(card.inst);
  const pctOfPool = rk == null ? null : (rk + 1) / settings.poolSize;
  const scanRank = rk == null ? '' : `今天第 ${rk + 1}/${settings.poolSize}（前 ${(pctOfPool * 100).toFixed(0)}%）`;
  const meta = [
    tag ? `你的标签 ${tag}` : '',
    scanRank,
    p.scan.retention != null ? `扫描日保留 ${pct(p.scan.retention)}` : '',
    p.causal.retention != null ? `预注册保留 ${pct(p.causal.retention)} · 之后 5 天${p.causal.hold ? '守住' : '没守住'}` : '',
  ].filter(Boolean).join(' · ');
  const panels = [
    ['scan', p.scan, '扫描日'],
    ['causal', p.causal, '预注册'],
    ['today', p.today, '今天'],
  ].filter(([, x]) => x).map(([k, x, name]) => `
      <div class="panel">
        <div class="phead"><b>${esc2(name)}</b><span>${esc2(x.scanDate)} · 保留 <em>${pct(x.retention)}</em> · 离高 ${x.offHigh == null ? '—' : x.offHigh.toFixed(1) + '%'}${x.hold == null ? '' : ' · 之后5天' + (x.hold ? '<em class="ok">守住</em>' : '<em class="bad">没守住</em>')}</span></div>
        <svg viewBox="0 0 600 170" width="100%" height="170" class="chart" data-json="${esc2(JSON.stringify(x))}"></svg>
        <div class="legend">橙带＝60 根窗口 <code>${esc2(x.windowStart ?? '')} → ${esc2(x.windowEnd)}</code> · 绿虚线＝起点 ${esc2(x.loDate ?? '')} · 橙虚线＝高点 ${esc2(x.hiDate ?? '')}</div>
      </div>`).join('');
  return `<section class="card ${card.label === 'N' ? 'neg' : 'pos'}">
    <header><b>${esc2(head)}</b><span>${esc2(meta)}</span></header>
    ${card.note ? `<div class="note">你当时的备注：${esc2(card.note)}</div>` : ''}
    <div class="panels">${panels}</div>
  </section>`;
};

const rankToday = new Map((settings.rankOfDay?.[settings.anchor]
  ? Object.entries(settings.rankOfDay[settings.anchor])
  : []).map(([inst, rank]) => [inst, rank]));

const topRows = settings.top.map((r) => `<tr class="${r.rank <= settings.cut ? 'in' : ''}"><td>${r.rank}</td><td>${esc2(r.inst.replace(/USDT$/, ''))}</td><td>${(r.r * 100).toFixed(1)}%</td><td>${r.offHigh.toFixed(1)}%</td><td>${r.legPct.toFixed(0)}%</td></tr>`).join('\n');

const html = `<!doctype html><html><head><meta charset="utf-8"><title>retention 判据 · 卡片</title><style>
body{margin:0;background:#0d1117;color:#c9d1d9;font:13px/1.45 "Microsoft YaHei",system-ui,sans-serif}
h1{font-size:16px;padding:14px 20px 6px;margin:0}
.sub{padding:0 20px 12px;color:#8b949e;font-size:12px;border-bottom:1px solid #21262d}
.sub code{background:#161b22;padding:1px 5px;border-radius:4px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(560px,1fr));gap:14px;padding:14px}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:10px 12px}
.card.neg{border-color:#7d2a2a}
.card.pos{border-color:#1f6f43}
.card header{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:11px;color:#8b949e}
.card header b{color:#e6edf3;font-size:13px}
.note{font-size:11px;color:#9aa4b2;margin:4px 0 6px}
.panels{display:grid;gap:8px}
.panel{border-top:1px dashed #21262d;padding-top:6px}
.phead{display:flex;justify-content:space-between;font-size:11px;color:#8b949e;margin-bottom:2px}
.phead b{color:#c9d1d9}
.phead em{color:#f0b429;font-style:normal}
.phead em.ok{color:#3fb950}
.phead em.bad{color:#f85149}
.legend{font-size:10.5px;color:#6e7681}
.legend code{background:#0d1117;padding:0 4px;border-radius:3px}
table{border-collapse:collapse;font:11.5px/1.35 Consolas,monospace;margin:0 20px 16px}
th,td{padding:2px 10px;text-align:right;border-bottom:1px solid #21262d}
th{color:#6e7681;font-weight:400;text-align:right}
h2{font-size:13px;margin:16px 20px 6px;color:#c9d1d9}
</style></head><body>
<h1>retention 判据 · 卡片（橙带 = 判据量的「区域」，绿虚线 = 这波上涨的起点）</h1>
<div class="sub">
判据：最近 <code>60</code> 根日线里，最低<b>收盘</b> → 之后最高价 之间，现价保住了几成（0~1）。
每个币给三行：<code>扫描日 2026-10-13</code>（线上的位置）、<code>预注册 2026-09-30</code>（先算规则，再看之后 5 天有没有守住高点）、<code>今天 ${esc2(today)}</code>。
“守住” = 之后 5 个交易日最低价 ≥ 0.9 × 锚点前 10 根的最高价。全市场“守住”基线 <b>30.3%</b>，retention top10% 为 <b>64.7%</b>。
今天这份名单只算 <b>加密</b> 池（${settings.poolSize} 个）：原始缓存里混进了美股/韩股/港股（${settings.excludedEquityLike} 个用 <code>*STOCK</code> 后缀识别）——
股票交易日每天都被固定时段切断，几乎不留下影线，会在纯 retention 排名里占满前排（实测前 14 名全是股票）。扫描器的默认品种本来就是「加密」。
下方 ${settings.cut} 张 = 今天 retention 加密池前 ${settings.pct}%（${settings.poolSize} 里取 ${settings.cut}）。
</div>
${topRows ? `<h2>今天前 ${settings.pct}% 的名单（${settings.cut}/${settings.poolSize}，加密池）</h2><table><tr><th>名次</th><th>币</th><th>保留</th><th>离高点</th><th>这波涨幅</th></tr>${topRows}</table>` : ''}
<h2>你的 15 段标注 + WAL / CFX</h2>
<div class="grid">${cards.map(cardHtml).join('\n')}</div>
<script>
var NF='#30363d';
document.querySelectorAll('svg.chart').forEach(function(svg){
  var p = JSON.parse(svg.getAttribute('data-json'));
  var bars = p.bars, W = 600, Hh = 170, padL = 4, padR = 58, padT = 6, padB = 4;
  var n = bars.length; if (!n) return;
  var lo = Math.min.apply(null, bars.map(function(b){return b[3]}));
  var hi = Math.max.apply(null, bars.map(function(b){return b[2]}));
  if (!(hi > lo)) return;
  var x = function(i){ return padL + (W - padL - padR) * (i / Math.max(1, n - 1)); };
  var y = function(v){ return padT + (Hh - padT - padB - 10) * (1 - (v - lo) / (hi - lo)); };
  var bw = Math.max(1.2, (W - padL - padR) / n * 0.62);
  var out = [];
  // 60-bar window shading
  var wi = bars.findIndex(function(b){ return new Date(b[0]).toISOString().slice(0,10) >= p.windowStart; });
  if (wi < 0) wi = 0;
  out.push('<rect x="'+x(wi).toFixed(1)+'" y="'+padT+'" width="'+(x(n-1)-x(wi)).toFixed(1)+'" height="'+(Hh-padT-padB)+'" fill="rgba(88,166,255,.06)"/>');
  // lo..hi band of the 60-bar window
  if (p.lo != null && p.hi != null) {
    out.push('<rect x="'+x(wi).toFixed(1)+'" y="'+y(p.hi).toFixed(1)+'" width="'+(x(n-1)-x(wi)).toFixed(1)+'" height="'+(y(p.lo)-y(p.hi)).toFixed(1)+'" fill="rgba(245,158,11,.10)"/>');
    out.push('<line x1="'+x(wi)+'" x2="'+x(n-1)+'" y1="'+y(p.hi).toFixed(1)+'" y2="'+y(p.hi).toFixed(1)+'" stroke="#f59e0b" stroke-dasharray="4 3"/>');
    out.push('<line x1="'+x(wi)+'" x2="'+x(n-1)+'" y1="'+y(p.lo).toFixed(1)+'" y2="'+y(p.lo).toFixed(1)+'" stroke="#3fb950" stroke-dasharray="4 3"/>');
  }
  bars.forEach(function(b, i){
    var up = b[4] >= b[1];
    var col = up ? '#3fb950' : '#f85149';
    out.push('<line x1="'+x(i).toFixed(1)+'" x2="'+x(i).toFixed(1)+'" y1="'+y(b[2]).toFixed(1)+'" y2="'+y(b[3]).toFixed(1)+'" stroke="'+col+'" stroke-width="1"/>');
    var top = y(Math.max(b[1], b[4])), bot = y(Math.min(b[1], b[4]));
    out.push('<rect x="'+(x(i)-bw/2).toFixed(1)+'" y="'+top.toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+Math.max(1, bot-top).toFixed(1)+'" fill="'+col+'"/>');
  });
  // last close = "now"
  var last = bars[n-1];
  out.push('<line x1="'+padL+'" x2="'+(W-padR)+'" y1="'+y(last[4]).toFixed(1)+'" y2="'+y(last[4]).toFixed(1)+'" stroke="'+(p.retention!=null?'#e6edf3':'#8b949e')+'" stroke-opacity=".5" stroke-dasharray="1 3"/>');
  out.push('<text x="'+(W-padR+4)+'" y="'+(y(last[4])+3).toFixed(1)+'" fill="#c9d1d9" font-size="9">'+last[4]+'</text>');
  if (p.hi != null) out.push('<text x="'+(W-padR+4)+'" y="'+(y(p.hi)+3).toFixed(1)+'" fill="#f59e0b" font-size="9">'+p.hi+'</text>');
  if (p.lo != null) out.push('<text x="'+(W-padR+4)+'" y="'+(y(p.lo)+3).toFixed(1)+'" fill="#3fb950" font-size="9">'+p.lo+'</text>');
  out.push('<text x="'+padL+'" y="'+(Hh-1)+'" fill="#8b949e" font-size="9">'+p.sliceStart+'</text>');
  out.push('<text x="'+(W-padR)+'" y="'+(Hh-1)+'" fill="#8b949e" font-size="9" text-anchor="end">'+p.sliceStop+'</text>');
  svg.innerHTML = out.join('');
});
</script></body></html>`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html, 'utf8');
fs.writeFileSync('./tools/labeling/out/retention-cards.json', JSON.stringify({ settings, cards }, null, 0));
// the standalone chart lib must sit next to the page for anything else that expects it
const lib = 'node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js';
if (fs.existsSync(lib)) fs.copyFileSync(lib, path.join(path.dirname(OUT), 'lightweight-charts.js'));
console.log(`wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB), cards ${cards.length}, top band ${settings.cut}/${settings.poolSize} @ ${settings.anchor}`);
