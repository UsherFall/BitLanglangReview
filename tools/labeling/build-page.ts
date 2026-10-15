/**
 * Page half of the labeling workbench (see the task's `design.md`).
 *
 * Turns the frozen snapshot + candidate list into ONE self-contained HTML file:
 * `out/label.html` plus a copy of the chart library beside it. It needs no dev
 * server and no network — open it with `file://`, label with the keyboard, and
 * the export button writes `labels.csv`.
 *
 * Two deliberate choices (R2.4):
 *  - the detector's `score` and the bucket are HIDDEN by default (`S` reveals the
 *    score) and every label records whether it was revealed, so a blind label
 *    stays distinguishable from a primed one;
 *  - the on-screen order is a deterministic shuffle, so 152 coarse-passers do not
 *    run consecutively and the bucket sequence leaks nothing.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import {
  CANDIDATES_FILE,
  CANDLES_FILE,
  OUT_DIR,
  PAGE_FILE,
  ensureOutDir,
  mulberry32,
  readJson,
  type Candidate,
  type SlimBar,
  type Snapshot,
} from './shared';

const require = createRequire(import.meta.url);
const CHART_LIB = 'lightweight-charts.js';

/**
 * Bars are carried as `SlimBar` arrays all the way to the page and only turned
 * into the chart's object shape inside the browser. At ~35 B/bar that keeps a
 * year × ~230 candidates inside a few MB; the object form cost ~83 B/bar.
 */
type PageItem = Candidate & { bars: SlimBar[] };

/** Deterministic shuffle so on-screen order is mixed but reproducible. */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  const random = mulberry32(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function build(): void {
  const snapshot = readJson<Snapshot>(CANDLES_FILE);
  if (!snapshot) throw new Error(`no snapshot at ${CANDLES_FILE} — run: npm run label:sample`);
  const listing = readJson<{ candidates: Candidate[] }>(CANDIDATES_FILE);
  if (!listing) throw new Error(`no candidates at ${CANDIDATES_FILE} — run: npm run label:sample`);

  // The chart shows the long series when the snapshot has one; the detector-only
  // 90-bar series is the fallback for a snapshot taken before `--history`.
  const history = snapshot.history ?? {};
  const barsFor = (instrument: string) => history[instrument] ?? snapshot.candles[instrument];
  const missing = listing.candidates.filter((candidate) => !barsFor(candidate.instrument));
  if (missing.length > 0) {
    throw new Error(
      `candidates.json and candles.json disagree for ${missing.length} instrument(s): ` +
        `${missing.slice(0, 5).map((c) => c.instrument).join(', ')} — re-run: npm run label:sample`,
    );
  }

  const items: PageItem[] = shuffled(listing.candidates, snapshot.anchor).map((candidate) => ({
    ...candidate,
    bars: barsFor(candidate.instrument)!,
  }));

  ensureOutDir();
  // The dist subpath is not in the package's `exports` map, but `package.json`
  // is — resolve that and walk to the standalone build beside it.
  const libSource = `${path.dirname(require.resolve('lightweight-charts/package.json'))}/dist/lightweight-charts.standalone.production.js`;
  if (!fs.existsSync(libSource)) throw new Error(`chart library not found at ${libSource}`);
  fs.copyFileSync(libSource, `${OUT_DIR}${CHART_LIB}`);

  const data = JSON.stringify({ anchor: snapshot.anchor, timeframe: snapshot.timeframe, items });
  const html = TEMPLATE.replace('__DATA__', () => data)
    .replace('__SNAPSHOT__', () => new Date(snapshot.anchor).toISOString().slice(0, 10))
    .replace('__LIB__', () => CHART_LIB);

  fs.writeFileSync(PAGE_FILE, html, 'utf8');
  process.stdout.write(
    `\npage written: ${items.length} charts\n  -> ${PAGE_FILE}\n  -> ${OUT_DIR}${CHART_LIB}\n` +
      `open it in a browser (file:// works offline), label with Y / N / ?, export labels.csv\n\n`,
  );
}

// The inner script is plain ES5-ish JS with NO template literals of its own, so
// this outer template never collides with it. Keep it that way.
const TEMPLATE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>收敛标注 · 1D</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; height: 100vh; display: flex; flex-direction: column;
         background: #101318; color: #C9D1D9;
         font: 14px/1.5 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; }
  header { display: flex; align-items: baseline; gap: 16px; padding: 10px 16px;
           border-bottom: 1px solid #2D333B; flex: none; }
  header .sym { font-size: 20px; font-weight: 600; letter-spacing: .5px; }
  header .dim { color: #8B949E; }
  header .grow { flex: 1; }
  .bar { height: 4px; background: #222832; flex: none; }
  .bar > i { display: block; height: 100%; background: #16A34A; width: 0; }
  #chart { flex: 1; min-height: 0; }
  footer { flex: none; padding: 10px 16px; border-top: 1px solid #2D333B;
           display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  button { background: #21262D; color: #C9D1D9; border: 1px solid #30363D;
           border-radius: 6px; padding: 7px 14px; cursor: pointer; font-size: 14px; }
  button:hover { background: #30363D; }
  button.good { border-color: #16A34A; }
  button.bad { border-color: #DC2626; }
  button.dim { border-color: #6E7681; }
  select, input[type=text] { background: #0D1117; color: #C9D1D9; border: 1px solid #30363D;
           border-radius: 6px; padding: 6px 8px; font-size: 14px; }
  .hint { color: #6E7681; font-size: 12px; }
  .grow { flex: 1; }
  #score { color: #D29922; font-variant-numeric: tabular-nums; }
  #toast { position: fixed; right: 16px; bottom: 64px; background: #21262D;
           border: 1px solid #30363D; border-radius: 6px; padding: 8px 12px;
           opacity: 0; transition: opacity .2s; pointer-events: none; }
  kbd { background: #21262D; border: 1px solid #30363D; border-bottom-width: 2px;
        border-radius: 4px; padding: 1px 5px; font-family: inherit; font-size: 12px; }
</style>
</head>
<body>
<header>
  <span class="sym" id="sym">—</span>
  <span class="dim" id="meta"></span>
  <span class="grow"></span>
  <span id="score"></span>
  <span class="dim" id="progress"></span>
</header>
<div class="bar"><i id="bar"></i></div>
<div id="chart"></div>
<footer>
  <button class="good" id="y">好 <kbd>Y</kbd></button>
  <button class="bad" id="n">不好 <kbd>N</kbd></button>
  <button class="dim" id="q">拿不准 <kbd>?</kbd></button>
  <button id="prev">上一张 <kbd>←</kbd></button>
  <span class="grow"></span>
  <select id="reason" title="理由（可选），数字键 1-4 直选，0 清除">
    <option value="">（无理由）</option>
    <option value="前戏不足">前戏不足</option>
    <option value="收缩没到位">收缩没到位</option>
    <option value="还没顺势">还没顺势</option>
    <option value="就是好">就是好</option>
    <option value="其他">其他</option>
  </select>
  <input type="text" id="note" placeholder="补充（可选）" size="14" />
  <span class="hint">理由 <kbd>1</kbd>-<kbd>4</kbd>，<kbd>0</kbd> 清除</span>
  <button id="toggle">显示 score <kbd>S</kbd></button>
  <button id="export">导出 labels.csv</button>
  <button id="reset" title="清空本快照的本地进度">重置</button>
</footer>
<div id="toast"></div>
<script type="application/json" id="data">__DATA__</script>
<script src="__LIB__"></script>
<script>
(function () {
  var DATA = JSON.parse(document.getElementById('data').textContent);
  var ITEMS = DATA.items;
  var ANCHOR = DATA.anchor;
  var STORE_KEY = 'labeling:' + ANCHOR;
  var TF = DATA.timeframe;

  var chart = LightweightCharts.createChart(document.getElementById('chart'), {
    layout: { background: { type: 'solid', color: '#101318' }, textColor: '#C9D1D9' },
    grid: { vertLines: { color: '#1B2028' }, horzLines: { color: '#1B2028' } },
    rightPriceScale: { borderColor: '#2D333B' },
    timeScale: { borderColor: '#2D333B', timeVisible: false },
    crosshair: { mode: 1 },
    autoSize: true
  });
  var series = chart.addSeries(LightweightCharts.CandlestickSeries, {
    upColor: '#16A34A', downColor: '#DC2626', borderVisible: false,
    wickUpColor: '#16A34A', wickDownColor: '#DC2626'
  });

  var labels = load().labels;
  var index = load().index;
  var showScore = false;
  var reasonEl = document.getElementById('reason');
  var noteEl = document.getElementById('note');
  var toastEl = document.getElementById('toast');
  var toastTimer = null;

  function load() {
    try {
      var raw = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {};
      return {
        index: typeof raw.index === 'number' ? raw.index : 0,
        labels: raw.labels && typeof raw.labels === 'object' ? raw.labels : {}
      };
    } catch (e) { return { index: 0, labels: {} }; }
  }
  function save() { localStorage.setItem(STORE_KEY, JSON.stringify({ index: index, labels: labels })); }

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.style.opacity = '0'; }, 1600);
  }

  function labeledCount() {
    var n = 0;
    for (var k in labels) if (labels[k] && labels[k].label) n++;
    return n;
  }

  function render() {
    if (ITEMS.length === 0) return;
    if (index < 0) index = 0;
    if (index > ITEMS.length - 1) index = ITEMS.length - 1;
    var item = ITEMS[index];

    document.getElementById('sym').textContent = item.instrument;
    document.getElementById('meta').textContent = TF + ' · 快照 ' + '__SNAPSHOT__' + ' · ' + item.bars.length + ' 根';
    document.getElementById('progress').textContent = (index + 1) + ' / ' + ITEMS.length +
      '　已标 ' + labeledCount();
    document.getElementById('bar').style.width = ((index + 1) / ITEMS.length * 100) + '%';
    document.getElementById('score').textContent = showScore
      ? ('score ' + item.score.toFixed(3) + (item.converged ? ' · 判收敛' : '') + (item.passCoarse ? ' · 过粗筛' : ''))
      : '';

    // SlimBar: [timestamp, open, high, low, close] -> the chart's own shape.
    series.setData(item.bars.map(function (bar) {
      return { time: Math.floor(bar[0] / 1000), open: bar[1], high: bar[2], low: bar[3], close: bar[4] };
    }));
    chart.timeScale().fitContent();

    var rec = labels[item.instrument];
    reasonEl.value = rec && rec.reason ? rec.reason : '';
    noteEl.value = rec && rec.note ? rec.note : '';
  }

  function record(label) {
    var item = ITEMS[index];
    labels[item.instrument] = {
      label: label,
      reason: reasonEl.value,
      note: noteEl.value,
      scoreShown: showScore ? 1 : 0,
      labeledAt: new Date().toISOString()
    };
    save();
    var at = index;
    index += 1;
    save();
    render();
    if (at === ITEMS.length - 1) toast('最后一张了 — 记得导出 labels.csv');
  }

  function back() { index -= 1; save(); render(); }

  function csvCell(value) {
    var s = value === undefined || value === null ? '' : String(value);
    return /[",\\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function exportCsv() {
    var head = ['instrument', 'timeframe', 'anchor', 'label', 'reason', 'note', 'scoreShown', 'labeledAt'];
    var lines = [head.join(',')];
    for (var i = 0; i < ITEMS.length; i++) {
      var it = ITEMS[i];
      var rec = labels[it.instrument] || {};
      lines.push([
        csvCell(it.instrument), '1D', ANCHOR,
        csvCell(rec.label), csvCell(rec.reason), csvCell(rec.note),
        csvCell(rec.label ? rec.scoreShown : ''),
        csvCell(rec.labeledAt)
      ].join(','));
    }
    var blob = new Blob(['\\ufeff' + lines.join('\\n') + '\\n'], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'labels-' + ANCHOR + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('已导出 ' + labeledCount() + ' / ' + ITEMS.length + ' 条标签');
  }

  document.getElementById('y').onclick = function () { record('Y'); };
  document.getElementById('n').onclick = function () { record('N'); };
  document.getElementById('q').onclick = function () { record('?'); };
  document.getElementById('prev').onclick = back;
  document.getElementById('export').onclick = exportCsv;
  document.getElementById('toggle').onclick = function () {
    showScore = !showScore;
    this.textContent = showScore ? '隐藏 score' : '显示 score';
    render();
  };
  document.getElementById('reset').onclick = function () {
    if (!confirm('清空本快照的全部本地标注？导出过的 CSV 不受影响。')) return;
    labels = {};
    index = 0;
    save();
    render();
    toast('已重置');
  };

  document.addEventListener('keydown', function (e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) {
      if (e.key !== 'Escape') return;
      e.target.blur();
      return;
    }
    var k = e.key;
    if (k === 'y' || k === 'Y') { e.preventDefault(); record('Y'); }
    else if (k === 'n' || k === 'N') { record('N'); }
    else if (k === '?') { record('?'); }
    else if (k === 'ArrowLeft') { back(); }
    else if (k === 'ArrowRight') { index += 1; save(); render(); }
    else if (k === 's' || k === 'S') { document.getElementById('toggle').click(); }
    else if (k === '0') { reasonEl.selectedIndex = 0; }
    else if (k >= '1' && k <= '4') { reasonEl.selectedIndex = Number(k); }
  });

  render();
})();
</script>
</body>
</html>
`;

build();
