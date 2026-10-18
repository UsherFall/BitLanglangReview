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
type PageItem = Candidate & { bars: SlimBar[]; pos90: number; priorMove: number };

/**
 * The two measurable proxies that actually separated the hand labels (2026-10-18,
 * 285 labels: base rate of Y is 12.6%). `pos90` at its 80th percentile lifted the
 * Y rate to 29.8%; `priorMove` moved it 17.5% → 21.1%. Both are SORT keys only —
 * neither is a verdict, and `score` is deliberately NOT used as the default
 * because raising it LOWERED the Y rate (29.3% → 6.9%), i.e. it ranks backwards.
 *
 *  pos90      (lastClose − min low of last 90) / (max high − min low of last 90)
 *  priorMove  (close[-24] − close[-90]) / close[-90]  — the move BEFORE the recent
 *             23 days, i.e. the "前戏" that the user judges as 结构饱满
 */
function metricsFor(bars: readonly SlimBar[]): { pos90: number; priorMove: number } {
  const closes = bars.map((bar) => bar[4]);
  const last = closes[closes.length - 1] ?? 0;
  const window = bars.slice(-90);
  const high = Math.max(...window.map((bar) => bar[2]));
  const low = Math.min(...window.map((bar) => bar[3]));
  const pos90 = high > low ? (last - low) / (high - low) : 0.5;
  const back = (n: number) => closes[Math.max(0, closes.length - 1 - n)] ?? 0;
  const base = back(90);
  const priorMove = base > 0 ? (back(23) - base) / base : 0;
  return { pos90, priorMove };
}

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

  const items: PageItem[] = shuffled(listing.candidates, snapshot.anchor).map((candidate) => {
    const bars = barsFor(candidate.instrument)!;
    return { ...candidate, bars, ...metricsFor(bars) };
  });

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
  #banner { padding: 8px 16px; background: #3A1D1D; border-bottom: 1px solid #7F1D1D;
            color: #FCA5A5; font-size: 13px; flex: none; }
  #banner[hidden] { display: none; }
  #status { flex: none; padding: 6px 16px 10px; color: #8B949E; font-size: 12px;
            border-top: 1px solid #2D333B; }
  #mark { color: #16A34A; font-size: 13px; }
  kbd { background: #21262D; border: 1px solid #30363D; border-bottom-width: 2px;
        border-radius: 4px; padding: 1px 5px; font-family: inherit; font-size: 12px; }
</style>
</head>
<body>
<div id="banner" hidden></div>
<header>
  <span class="sym" id="sym">—</span>
  <span class="dim" id="meta"></span>
  <span class="grow"></span>
  <span class="dim" id="feat"></span>
  <span id="mark"></span>
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
  <select id="sort" title="排序方式；切换后回到第 1 张，已标结论不丢">
    <option value="shuffle">打散</option>
    <option value="pos90">按 90日位置</option>
    <option value="prior">按 前戏幅度</option>
    <option value="score">按 score（已知反向）</option>
  </select>
  <button id="toggle">显示 score <kbd>S</kbd></button>
  <button id="export">导出 labels.csv</button>
  <button id="import" title="读回导出的 labels.csv，按 anchor 校验后合并">导入 labels.csv</button>
  <input type="file" id="file" accept=".csv,text/csv" style="display:none" />
  <button id="reset" title="清空本快照的本地进度">重置</button>
</footer>
<div id="status"></div>
<div id="toast"></div>
<script type="application/json" id="data">__DATA__</script>
<script src="__LIB__"></script>
<script>
(function () {
  var DATA = JSON.parse(document.getElementById('data').textContent);
  var BASE = DATA.items;
  var VIEW = BASE.slice();
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

  // Must be declared BEFORE the first load(): a read that throws flips it and
  // shows the banner, and hoisting would have it read as undefined there.
  var storageOk = true;
  var labels = load().labels;
  var index = load().index;
  var showScore = false;
  var reasonEl = document.getElementById('reason');
  var noteEl = document.getElementById('note');
  var toastEl = document.getElementById('toast');
  var statusEl = document.getElementById('status');
  var toastTimer = null;

  function load() {
    try {
      var raw = JSON.parse(readStore() || '{}') || {};
      return {
        index: typeof raw.index === 'number' ? raw.index : 0,
        labels: raw.labels && typeof raw.labels === 'object' ? raw.labels : {}
      };
    } catch (e) { return { index: 0, labels: {} }; }
  }

  // localStorage throws on file:// in some browsers. An unguarded setItem used
  // to abort the whole import callback, which is why "选完文件没反应" happened.
  function readStore() {
    try { return window.localStorage.getItem(STORE_KEY); }
    catch (e) { markStorageBroken(); return null; }
  }

  function save() {
    if (!storageOk) return false;
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify({ index: index, labels: labels }));
      return true;
    } catch (e) { markStorageBroken(); return false; }
  }

  function markStorageBroken() {
    if (!storageOk) return;
    storageOk = false;
    var banner = document.getElementById('banner');
    banner.textContent = '⚠ 浏览器禁用了本地存储（file:// 下常见）。进度只存在内存里，刷新或关页就会丢 —— '
      + '请用「导出 labels.csv」当记录，换机器时用「导入」恢复。';
    banner.hidden = false;
  }

  // The floating toast fades in 1.6s and is easy to miss; this line stays.
  function status(msg) { statusEl.textContent = msg; }

  function toast(msg) {
    status(msg);
    toastEl.textContent = msg;
    toastEl.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.style.opacity = '0'; }, 1600);
  }

  // The detector's score is offered only as a comparison: it ranked BACKWARDS
  // against the hand labels (raising it lowered the Y rate), which is why it is
  // not the default order.
  function applySort(mode) {
    if (mode === 'pos90') VIEW = BASE.slice().sort(function (a, b) { return b.pos90 - a.pos90; });
    else if (mode === 'prior') VIEW = BASE.slice().sort(function (a, b) { return b.priorMove - a.priorMove; });
    else if (mode === 'score') VIEW = BASE.slice().sort(function (a, b) { return b.score - a.score; });
    else VIEW = BASE.slice();
    index = 0;
    render();
    reasonEl.value = '';
    noteEl.value = '';
    var sortEl = document.getElementById('sort');
    status('已按「' + sortEl.options[sortEl.selectedIndex].textContent + '」排序，共 ' + VIEW.length + ' 张；已标结论不受影响。');
  }

  function labeledCount() {
    var n = 0;
    for (var k in labels) if (labels[k] && labels[k].label) n++;
    return n;
  }

  function render() {
    if (VIEW.length === 0) return;
    if (index < 0) index = 0;
    if (index > VIEW.length - 1) index = VIEW.length - 1;
    var item = VIEW[index];

    document.getElementById('sym').textContent = item.instrument;
    document.getElementById('meta').textContent = TF + ' · 快照 ' + '__SNAPSHOT__' + ' · ' + item.bars.length + ' 根';
    document.getElementById('progress').textContent = (index + 1) + ' / ' + VIEW.length +
      '　已标 ' + labeledCount();
    document.getElementById('bar').style.width = ((index + 1) / VIEW.length * 100) + '%';
    document.getElementById('feat').textContent =
      '90日位置 ' + (item.pos90 * 100).toFixed(0) + '%　前戏 ' +
      (item.priorMove >= 0 ? '+' : '') + (item.priorMove * 100).toFixed(0) + '%';
    document.getElementById('score').textContent = showScore
      ? ('score ' + item.score.toFixed(3) + (item.converged ? ' · 判收敛' : '') + (item.passCoarse ? ' · 过粗筛' : ''))
      : '';

    // SlimBar: [timestamp, open, high, low, close] -> the chart's own shape.
    series.setData(item.bars.map(function (bar) {
      return { time: Math.floor(bar[0] / 1000), open: bar[1], high: bar[2], low: bar[3], close: bar[4] };
    }));
    chart.timeScale().fitContent();

    var rec = labels[item.instrument];
    document.getElementById('mark').textContent = rec && rec.label
      ? '已标：' + rec.label + (rec.reason ? ' · ' + rec.reason : '')
      : '';
    reasonEl.value = rec && rec.reason ? rec.reason : '';
    noteEl.value = rec && rec.note ? rec.note : '';
  }

  function record(label) {
    var item = VIEW[index];
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
    // Start the next chart with a clean slate. Without this, re-labelling an
    // already-answered chart kept its old reason (21 of the 285 Y rows ended up
    // carrying a negative reason).
    reasonEl.value = '';
    noteEl.value = '';
    if (!storageOk) status('已记录「' + label + '」，但本地存储不可用 —— 刷新会丢，记得导出。');
    if (at === VIEW.length - 1) toast('最后一张了 — 记得导出 labels.csv');
  }

  function back() { index -= 1; save(); render(); }

  function csvCell(value) {
    var s = value === undefined || value === null ? '' : String(value);
    return /[",\\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function exportCsv() {
    var head = ['instrument', 'timeframe', 'anchor', 'label', 'reason', 'note', 'scoreShown', 'labeledAt'];
    var lines = [head.join(',')];
    for (var i = 0; i < VIEW.length; i++) {
      var it = VIEW[i];
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
    toast('已导出 ' + labeledCount() + ' / ' + VIEW.length + ' 条标签');
  }

  // Minimal RFC4180-ish parser: the note column is free text, so a naive
  // split(',') would shift every column after a comma. Handles the BOM, quoted
  // fields, doubled quotes and CRLF line endings.
  function parseCsv(text) {
    var rows = [];
    var row = [];
    var field = '';
    var quoted = false;
    var src = text.replace(/^\\uFEFF/, '');
    for (var i = 0; i < src.length; i += 1) {
      var ch = src.charAt(i);
      if (quoted) {
        if (ch === '"') {
          if (src.charAt(i + 1) === '"') { field += '"'; i += 1; }
          else quoted = false;
        } else field += ch;
      } else if (ch === '"') {
        quoted = true;
      } else if (ch === ',') {
        row.push(field); field = '';
      } else if (ch === '\\n') {
        row.push(field); rows.push(row); row = []; field = '';
      } else if (ch === '\\r') {
        // \\n ends the record
      } else field += ch;
    }
    if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
    return rows;
  }

  function importCsv(text) {
    var rows = parseCsv(text);
    if (rows.length < 2) { toast('CSV 里没有数据行'); return; }
    var header = rows.shift().map(function (cell) { return cell.trim(); });
    var col = {};
    for (var c = 0; c < header.length; c += 1) col[header[c]] = c;
    if (col.instrument === undefined || col.anchor === undefined || col.label === undefined) {
      toast('不是 labels.csv（缺 instrument / anchor / label 列）');
      return;
    }
    var added = 0;
    var otherAnchor = 0;
    var skippedNoLabel = 0;
    var seenAnchors = {};
    for (var r = 0; r < rows.length; r += 1) {
      var line = rows[r];
      var instrument = String(line[col.instrument] || '').trim();
      var label = String(line[col.label] || '').trim();
      if (!instrument || !label) { skippedNoLabel += 1; continue; }
      // Never let another snapshot's labels leak into this one.
      var rowAnchor = String(line[col.anchor] || '').trim();
      if (rowAnchor !== String(ANCHOR)) { otherAnchor += 1; seenAnchors[rowAnchor] = 1; continue; }
      labels[instrument] = {
        label: label,
        reason: col.reason === undefined ? '' : String(line[col.reason] || ''),
        note: col.note === undefined ? '' : String(line[col.note] || ''),
        scoreShown: Number(line[col.scoreShown] || 0) ? 1 : 0,
        labeledAt: col.labeledAt === undefined ? new Date().toISOString() : String(line[col.labeledAt] || new Date().toISOString())
      };
      added += 1;
    }
    var persisted = save();
    render();
    var msg = '导入 ' + added + ' 条';
    if (otherAnchor > 0) {
      msg += '；跳过 ' + otherAnchor + ' 条（CSV 的 anchor 是 ' + Object.keys(seenAnchors).join('/') + '，本页是 ' + ANCHOR + '）';
    }
    if (skippedNoLabel > 0) msg += '；' + skippedNoLabel + ' 条没有 label';
    if (added === 0) msg = '⚠ 没有导入任何标签 —— ' + msg;
    if (!persisted) msg += '　（本地存储不可用：只在本页有效，刷新会丢）';
    toast(msg);
  }

  document.getElementById('import').onclick = function () { document.getElementById('file').click(); };
  document.getElementById('file').onchange = function () {
    var input = this;
    var file = input.files && input.files[0];
    if (!file) { status('没有选到文件'); return; }
    var reader = new FileReader();
    // Any throw inside the callback used to abort silently — that was the whole
    // "选完文件没反应" symptom. Nothing inside here may escape unreported.
    reader.onload = function () {
      try {
        importCsv(String(reader.result));
      } catch (err) {
        toast('导入出错：' + (err && err.message ? err.message : String(err)));
      }
      input.value = '';
    };
    reader.onerror = function () {
      toast('读取文件失败：' + (reader.error && reader.error.name ? reader.error.name : '未知错误'));
      input.value = '';
    };
    try {
      reader.readAsText(file, 'utf-8');
    } catch (err) {
      toast('无法读取文件：' + (err && err.message ? err.message : String(err)));
      input.value = '';
    }
  };

  document.getElementById('y').onclick = function () { record('Y'); };
  document.getElementById('n').onclick = function () { record('N'); };
  document.getElementById('q').onclick = function () { record('?'); };
  document.getElementById('prev').onclick = back;
  document.getElementById('sort').onchange = function () { applySort(this.value); };
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
