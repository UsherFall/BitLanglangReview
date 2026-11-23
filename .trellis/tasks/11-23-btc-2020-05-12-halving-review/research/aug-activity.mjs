import assert from 'node:assert/strict';
import fs from 'node:fs';
import Database from 'better-sqlite3';

const BASE = '.trellis/tasks/11-23-btc-2020-05-12-halving-review/research';
const DAY = 86_400_000;
const BAR = 15 * 60 * 1000;
const candles = JSON.parse(fs.readFileSync(`${BASE}/out/binance-btcusdt-15m.json`, 'utf8')).candles;
const db = new Database('data/review.sqlite', { readonly: true, fileMustExist: true });
const session = db.prepare(`
  select instrument, start_time, timeframe, updated_at, paper_trading_json
  from free_replay_sessions where instrument = 'BTCUSDT' and start_time = '2020-08-03 12:00'
`).get();
const reviewRows = db.prepare(`
  select trade_id, tags_json, note, starred from trade_reviews
  where trade_id like 'paper:BTCUSDT:2020-08-03 12:00:%'
`).all();
db.close();
const reviews = new Map(reviewRows.map((row) => [row.trade_id, row]));
const paper = JSON.parse(session.paper_trading_json);

function bj(ms) {
  return new Date(ms + 8 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ');
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function quantile(values, q) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const fraction = position - lower;
  return sorted[lower] + (sorted[lower + 1] ?? sorted[lower]) * fraction;
}

function window(end, start = end - DAY) {
  return candles.filter((candle) => candle.timestamp >= start && candle.closeTime <= end);
}

function quoteVolume(rows) {
  return rows.reduce((sum, candle) => sum + candle.close * candle.volume, 0);
}

function rangePct(rows) {
  if (!rows.length) return null;
  const reference = rows[0].open;
  return (Math.max(...rows.map((candle) => candle.high)) - Math.min(...rows.map((candle) => candle.low))) / reference * 100;
}

function features(entryTime) {
  const current = window(entryTime);
  assert.ok(current.length >= 90, `Insufficient current 24h window at ${new Date(entryTime).toISOString()}`);
  const reference = candles.filter((candle) => candle.closeTime <= entryTime - DAY).at(-1);
  assert.ok(reference);
  const baselineWindows = [];
  for (let index = 1; index <= 20; index += 1) {
    const end = entryTime - index * DAY;
    const rows = window(end);
    assert.ok(rows.length >= 90, `Insufficient baseline ${index} at ${new Date(entryTime).toISOString()}`);
    baselineWindows.push(rows);
  }
  const baselineBars = baselineWindows.flat();
  const currentQuote = quoteVolume(current);
  const baselineQuote = median(baselineWindows.map(quoteVolume));
  const currentRange = rangePct(current);
  const baselineRange = median(baselineWindows.map(rangePct));
  const currentBarRanges = current.map((candle) => (candle.high - candle.low) / candle.close * 100);
  const baselineBarRanges = baselineBars.map((candle) => (candle.high - candle.low) / candle.close * 100);
  const baselineP90 = quantile(baselineBarRanges, 0.9);
  const last4h = current.slice(-16);
  const previous20h = current.slice(0, -16);
  const recentQuote = quoteVolume(last4h);
  const previousQuote = quoteVolume(previous20h);
  const lastClose = current.at(-1).close;
  const high = Math.max(...current.map((candle) => candle.high));
  const low = Math.min(...current.map((candle) => candle.low));
  const volumeRatio = currentQuote / baselineQuote;
  const rangeRatio = currentRange / baselineRange;
  return {
    change24hPct: (lastClose / reference.close - 1) * 100,
    absoluteChange24hPct: Math.abs((lastClose / reference.close - 1) * 100),
    range24hPct: currentRange,
    quoteVolume24h: currentQuote,
    quoteVolumeRatio20d: volumeRatio,
    rangeRatio20d: rangeRatio,
    activityScore: Math.sqrt(volumeRatio * rangeRatio),
    medianBarRangeRatio20d: median(currentBarRanges) / median(baselineBarRanges),
    aboveBaselineP90BarPct: currentBarRanges.filter((value) => value > baselineP90).length / currentBarRanges.length * 100,
    recent4hVolumeIntensity: previousQuote > 0 ? 5 * recentQuote / previousQuote : null,
    recent4hRangeSharePct: rangePct(last4h) / currentRange * 100,
    positionIn24h: (lastClose - low) / (high - low),
    offHigh24hPct: (lastClose / high - 1) * 100,
  };
}

function summarize(rows) {
  const fields = ['quoteVolumeRatio20d', 'rangeRatio20d', 'activityScore', 'absoluteChange24hPct', 'aboveBaselineP90BarPct', 'recent4hVolumeIntensity'];
  return {
    count: rows.length,
    ...Object.fromEntries(fields.map((field) => [field, median(rows.map((row) => row[field]))])),
  };
}

const rounds = paper.trades.map((fill) => {
  const reviewId = `paper:BTCUSDT:2020-08-03 12:00:${fill.positionId}`;
  const review = reviews.get(reviewId);
  assert.ok(review, `Missing ${reviewId}`);
  return {
    positionId: fill.positionId,
    direction: fill.direction,
    entryTimeBeijing: bj(fill.entryTime),
    exitTimeBeijing: bj(fill.exitTime),
    entryTime: fill.entryTime,
    entryPrice: fill.entryPrice,
    exitPrice: fill.exitPrice,
    pnl: fill.pnl,
    returnRate: fill.returnRate,
    tags: JSON.parse(review.tags_json),
    note: review.note,
    starred: Boolean(review.starred),
    ...features(fill.entryTime),
  };
}).sort((a, b) => a.entryTime - b.entryTime);

assert.equal(rounds.length, 22);
assert.equal(reviews.size, rounds.length);
const output = {
  metadata: {
    instrument: session.instrument,
    sessionStart: session.start_time,
    sessionUpdatedAt: session.updated_at,
    sessionTimeframe: session.timeframe,
    candleSource: 'Binance BTCUSDT USDT-M 15m',
    window: 'Rolling 24h versus median of the previous 20 non-overlapping 24h windows',
    activityScore: 'sqrt(quoteVolumeRatio20d * rangeRatio20d); descriptive ranking only',
    recent4hVolumeIntensity: '(last4h quote/4h) / (previous20h quote/20h); 1 = same intensity',
    aboveBaselineP90BarPct: 'Share of current 15m bars wider than the previous-20-day 90th percentile; unconditional expectation = 10%',
    caveat: 'One instrument and reviewer-chosen entries only. This cannot estimate cross-coin scanner precision, recall, or future PnL.',
  },
  groups: {
    winners: summarize(rounds.filter((round) => round.pnl > 0)),
    losers: summarize(rounds.filter((round) => round.pnl < 0)),
    noLogic: summarize(rounds.filter((round) => round.tags.includes('无逻辑'))),
    starred: summarize(rounds.filter((round) => round.starred)),
    unstarred: summarize(rounds.filter((round) => !round.starred)),
  },
  rounds,
};
fs.writeFileSync(`${BASE}/aug-activity.json`, JSON.stringify(output, null, 2));
const headers = ['positionId', 'direction', 'entryTimeBeijing', 'pnl', 'returnRate', 'tags', 'note', 'change24hPct', 'range24hPct', 'quoteVolumeRatio20d', 'rangeRatio20d', 'activityScore', 'aboveBaselineP90BarPct', 'recent4hVolumeIntensity', 'positionIn24h', 'offHigh24hPct'];
const csvCell = (value) => {
  const text = Array.isArray(value) ? value.join('|') : String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
const csv = [headers.join(','), ...rounds.map((round) => headers.map((header) => csvCell(round[header])).join(','))].join('\n');
fs.writeFileSync(`${BASE}/aug-activity.csv`, `\uFEFF${csv}\n`);
console.log(JSON.stringify(output.groups, null, 2));
console.log('id\tdir\tpnl\tROE%\ttag\tchg24%\trange24%\tvolX\trangeX\tscore\tp90bars%\trecent4hX\tpos24');
for (const round of rounds) {
  console.log([
    round.positionId, round.direction, round.pnl.toFixed(2), (round.returnRate * 100).toFixed(2), round.tags.join('|'),
    round.change24hPct.toFixed(2), round.range24hPct.toFixed(2), round.quoteVolumeRatio20d.toFixed(2),
    round.rangeRatio20d.toFixed(2), round.activityScore.toFixed(2), round.aboveBaselineP90BarPct.toFixed(1),
    round.recent4hVolumeIntensity.toFixed(2), round.positionIn24h.toFixed(2),
  ].join('\t'));
}
