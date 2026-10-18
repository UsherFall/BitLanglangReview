/**
 * Build a SECOND, separate labeling page for "top-pin" candidates.
 *
 * Why a copy instead of editing build-page.ts: the shipped page's data format,
 * sorting and template are tuned for the 285-label convergence round, and that
 * round's findings are load-bearing. This script only reads:
 *   - tools/labeling/out/candles.json   (read-only, same snapshot)
 *   - tools/labeling/out/label.html     (read-only, the template to clone)
 * and writes exactly two new files:
 *   - tools/labeling/out/label-toppin.html
 *   - tools/labeling/out/label-toppin-data.json
 *
 * It uses a DIFFERENT localStorage key (`labeling-toppin:<anchor>`), so the
 * existing page's progress cannot be overwritten by this one.
 *
 *   npx tsx tools/labeling/build-toppin-page.ts
 */
import fs from 'node:fs';

import { CANDLES_FILE, OUT_DIR, readJson } from './shared';

type SlimBar = [number, number, number, number, number];
type Snapshot = {
  anchor: number;
  timeframe: string;
  candles: Record<string, SlimBar[]>;
  history?: Record<string, SlimBar[]>;
  volume: Record<string, { quoteVolume24h: number; volumeRank: number }>;
};

const PAGE_SRC = `${OUT_DIR}label.html`;
const PAGE_OUT = `${OUT_DIR}label-toppin.html`;
const DATA_OUT = `${OUT_DIR}label-toppin-data.json`;

const barRange = (b: SlimBar) => (b[2] - b[3]) / b[4];
const meanOf = (xs: SlimBar[]) => (xs.length ? xs.reduce((a, b) => a + barRange(b), 0) / xs.length : 0);

type Measures = {
  pos90: number;
  priorMove: number;
  s20: number;
  contraction: number;
  runStart: string | null;
  runBars: number;
};

function measuresOf(bars: SlimBar[]): Measures | null {
  if (bars.length < 60) return null;
  const n = bars.length;
  const last = bars[n - 1];
  const window = bars.slice(-90);
  const hi = Math.max(...window.map((b) => b[2]));
  const lo = Math.min(...window.map((b) => b[3]));
  const pos90 = hi > lo ? (last[4] - lo) / (hi - lo) : 0.5;
  const back = (k: number) => bars[Math.max(0, n - 1 - k)]?.[4] ?? 0;
  const base = back(90);
  const priorMove = base > 0 ? (back(23) - base) / base : 0;
  const last20 = bars.slice(-20);
  const prev20 = bars.slice(-40, -20);
  const s20 = prev20.length === 20 && meanOf(prev20) > 0 ? meanOf(last20) / meanOf(prev20) : 1;
  const baseline = meanOf(window);
  const contraction = baseline > 0 ? meanOf(last20) / baseline : 1;
  let bestLen = 0;
  let bestStart: string | null = null;
  for (let len = 5; len <= 15 && len <= n; len += 1) {
    const run = bars.slice(n - len);
    if (meanOf(run) <= contraction * baseline * 1.05) {
      bestLen = len;
      bestStart = new Date(run[0][0]).toISOString().slice(0, 10);
    }
  }
  return { pos90, priorMove, s20, contraction, runStart: bestStart, runBars: bestLen };
}

// ---- 1. pick candidates ------------------------------------------------------
const snapshot = readJson<Snapshot>(CANDLES_FILE);
if (!snapshot) throw new Error(`no snapshot at ${CANDLES_FILE}`);
if (!fs.existsSync(PAGE_SRC)) throw new Error(`no page template at ${PAGE_SRC} 鈥?run: npm run label:page first`);

const history = snapshot.history ?? {};
const seriesOf = (instrument: string) => history[instrument] ?? snapshot.candles[instrument];

const PINNED = ['STRKUSDT', 'TIAUSDT', 'BTCUSDT', 'ZECUSDT', 'KAVAUSDT'];

const ranked = Object.keys(snapshot.candles)
  .map((instrument) => ({ instrument, bars: seriesOf(instrument), m: measuresOf(seriesOf(instrument)) }))
  .filter((r) => r.m !== null)
  .sort((a, b) => b.m!.pos90 - a.m!.pos90);

const aboveCut = ranked.filter((r) => r.m!.pos90 >= 0.65);

// The named examples are ALWAYS included, even when their pos90 falls below the
// cut: the batch exists to learn what separates them from high-position coins.
const pinned = PINNED.map((instrument) => {
  const bars = seriesOf(instrument);
  const m = bars ? measuresOf(bars) : null;
  return m ? { instrument, bars: bars!, m } : null;
}).filter((r): r is { instrument: string; bars: SlimBar[]; m: Measures } => r !== null);
const pinnedNames = new Set(pinned.map((r) => r.instrument));

const topNames = aboveCut.slice(0, 40).map((r) => r.instrument);
const chosen = [...new Set([...topNames, ...pinnedNames, ...aboveCut.slice(0, 40).map((r) => r.instrument)])];
const rowFor = (instrument: string) =>
  ranked.find((r) => r.instrument === instrument) ?? pinned.find((r) => r.instrument === instrument)!;

console.log(`snapshot ${new Date(snapshot.anchor).toISOString().slice(0, 10)}: ${ranked.length} measurable, ${aboveCut.length} with pos90>=0.65`);
console.log(`chosen ${chosen.length} = pos90 top-${topNames.length} + named (${pinned.map((r) => r.instrument).join(', ')})`);

type Item = {
  instrument: string;
  pos90: number;
  priorMove: number;
  s20: number;
  contraction: number;
  runStart: string | null;
  runBars: number;
  volumeRank: number;
  pinned: boolean;
  /** Bars the chart actually shows, so a short-history coin is visible as such. */
  historyBars: number;
  bars: SlimBar[];
};
const items: Item[] = chosen.map((instrument) => {
  const row = rowFor(instrument);
  return {
    instrument,
    pos90: row.m!.pos90,
    priorMove: row.m!.priorMove,
    s20: row.m!.s20,
    contraction: row.m!.contraction,
    runStart: row.m!.runStart,
    runBars: row.m!.runBars,
    volumeRank: snapshot.volume[instrument]?.volumeRank ?? 9999,
    pinned: pinnedNames.has(instrument),
    historyBars: row.bars.length,
    bars: row.bars,
  };
});
const shortHistory = items.filter((item) => item.historyBars < 200);
if (shortHistory.length > 0) {
  console.log(`WARNING: ${shortHistory.length} candidate(s) have short history: ${shortHistory.map((i) => `${i.instrument}(${i.historyBars})`).join(', ')}`);
}

// ---- 2. build the page -------------------------------------------------------
let html = fs.readFileSync(PAGE_SRC, 'utf8');
const DATA_JSON = JSON.stringify({ anchor: snapshot.anchor, timeframe: '1D', items, note: 'toppin' });

const dataStart = html.indexOf('id="data">');
const dataEnd = html.indexOf('</script>', dataStart);
if (dataStart < 0 || dataEnd < 0) throw new Error('could not find the data script tag in label.html');
html = `${html.slice(0, dataStart + 'id="data">'.length)}${DATA_JSON}${html.slice(dataEnd)}`;
// A separate storage key so this page can never overwrite the 285-label progress.
if (!html.includes(`var STORE_KEY = 'labeling:' + ANCHOR;`)) throw new Error('STORE_KEY pattern not found');
html = html.replace(`var STORE_KEY = 'labeling:' + ANCHOR;`, `var STORE_KEY = 'labeling-toppin:' + ANCHOR;`);
// Mark the batch in the header; the template's own Chinese is left untouched.
const marker = '<span class="sym" id="sym">';
if (!html.includes(marker)) throw new Error('header marker not found');
html = html.replace(marker, '<span class="dim" id="batch">toppin</span>' + marker);
// Show the real bar count so a short-history coin is visible, not guessed.
// The template's own Chinese is mojibake in the template literal, so this text
// is kept ASCII on purpose.
const metaAnchor = "document.getElementById('meta').textContent =";
if (!html.includes(metaAnchor)) throw new Error('meta renderer not found');
html = html.replace(
  metaAnchor,
  "if (item.historyBars < 200) { document.getElementById('meta').textContent += '  [SHORT HISTORY: ' + item.historyBars + ' bars]'; }\n    " + metaAnchor,
);
fs.writeFileSync(PAGE_OUT, html, 'utf8');
fs.writeFileSync(
  DATA_OUT,
  JSON.stringify({ anchor: snapshot.anchor, items: items.map(({ bars, ...rest }) => ({ ...rest, bars: bars.length })) }, null, 2),
  'utf8',
);
console.log(`\nwrote ${PAGE_OUT}\nwrote ${DATA_OUT}`);


