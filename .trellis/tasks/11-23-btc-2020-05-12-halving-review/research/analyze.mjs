import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const TASK_DIR = '.trellis/tasks/11-23-btc-2020-05-12-halving-review';
const RESEARCH_DIR = path.join(TASK_DIR, 'research');
const OUT_DIR = path.join(RESEARCH_DIR, 'out');
const DB_PATH = 'data/review.sqlite';
const INSTRUMENT = 'BTCUSDT';
const START_TIME = '2020-05-12 16:00';
const PREFIX = `paper:${INSTRUMENT}:${START_TIME}:`;
const FETCH_START = Date.parse('2020-03-01T00:00:00Z');
const FETCH_END = Date.parse('2020-11-01T00:00:00Z');
const OFFLINE = process.argv.includes('--offline');
const DAY = 86_400_000;
const HOUR = 3_600_000;

fs.mkdirSync(OUT_DIR, { recursive: true });

function finite(value) {
  const result = Number(value);
  assert.ok(Number.isFinite(result), `Non-finite numeric value: ${value}`);
  return result;
}

function round(value, digits = 6) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function bj(ms) {
  return new Date(ms + 8 * HOUR).toISOString().slice(0, 16).replace('T', ' ');
}

function utc(ms) {
  return new Date(ms).toISOString();
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJsonWithRetry(url) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
      const body = await response.text();
      const error = new Error(`Binance HTTP ${response.status}: ${body.slice(0, 300)}`);
      if (![418, 429, 500, 502, 503, 504].includes(response.status)) throw error;
      lastError = error;
      const retryAfter = Number(response.headers.get('Retry-After'));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 10_000)
        : 500 * 2 ** attempt;
      await sleep(wait);
    } catch (error) {
      lastError = error;
      if (attempt < 4) await sleep(500 * 2 ** attempt);
    }
  }
  throw lastError;
}

async function fetchCandles(interval, step) {
  const cachePath = path.join(OUT_DIR, `binance-btcusdt-${interval}.json`);
  if (fs.existsSync(cachePath)) {
    const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    assert.equal(cached.source, 'https://fapi.binance.com/fapi/v1/klines');
    assert.equal(cached.interval, interval);
    return cached.candles;
  }
  assert.ok(!OFFLINE, `Missing ${cachePath}; run once without --offline`);

  const candles = [];
  let cursor = FETCH_START;
  while (cursor < FETCH_END) {
    const url = new URL('https://fapi.binance.com/fapi/v1/klines');
    url.searchParams.set('symbol', INSTRUMENT);
    url.searchParams.set('interval', interval);
    url.searchParams.set('startTime', String(cursor));
    url.searchParams.set('endTime', String(FETCH_END - 1));
    url.searchParams.set('limit', '1500');
    const rows = await fetchJsonWithRetry(url);
    assert.ok(Array.isArray(rows), `Unexpected Binance ${interval} response`);
    if (!rows.length) break;
    for (const row of rows) {
      candles.push({
        timestamp: finite(row[0]),
        open: finite(row[1]),
        high: finite(row[2]),
        low: finite(row[3]),
        close: finite(row[4]),
        volume: finite(row[5]),
        closeTime: finite(row[6]),
      });
    }
    const next = rows.at(-1)[0] + step;
    assert.ok(next > cursor, `${interval} cursor did not advance`);
    cursor = next;
    if (rows.length < 1500) break;
    await sleep(140);
  }

  candles.sort((a, b) => a.timestamp - b.timestamp);
  const unique = new Map(candles.map((candle) => [candle.timestamp, candle]));
  const normalized = [...unique.values()];
  for (let index = 1; index < normalized.length; index += 1) {
    assert.equal(
      normalized[index].timestamp - normalized[index - 1].timestamp,
      step,
      `${interval} gap at ${utc(normalized[index - 1].timestamp)}`,
    );
  }
  assert.ok(normalized.length > 0);
  assert.ok(normalized[0].timestamp <= Date.parse('2020-05-01T00:00:00Z'));
  assert.ok(normalized.at(-1).timestamp >= Date.parse('2020-10-15T00:00:00Z'));
  const payload = {
    source: 'https://fapi.binance.com/fapi/v1/klines',
    symbol: INSTRUMENT,
    interval,
    start: utc(FETCH_START),
    endExclusive: utc(FETCH_END),
    fetchedAt: utc(Date.now()),
    candles: normalized,
  };
  fs.writeFileSync(cachePath, JSON.stringify(payload));
  return normalized;
}

function emaSeries(candles, period) {
  const alpha = 2 / (period + 1);
  const values = [];
  let ema = null;
  candles.forEach((candle, index) => {
    ema = ema === null ? candle.close : alpha * candle.close + (1 - alpha) * ema;
    values[index] = ema;
  });
  return values;
}

function atrSeries(candles, period) {
  const values = Array(candles.length).fill(null);
  const trueRanges = candles.map((candle, index) => {
    if (index === 0) return candle.high - candle.low;
    const previousClose = candles[index - 1].close;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose),
    );
  });
  let atr = null;
  for (let index = 0; index < candles.length; index += 1) {
    if (index < period - 1) continue;
    if (index === period - 1) {
      atr = mean(trueRanges.slice(0, period));
    } else {
      atr = (atr * (period - 1) + trueRanges[index]) / period;
    }
    values[index] = atr;
  }
  return values;
}

function technicalContext(allCandles, entryTime) {
  // Ex-ante approximation: only bars fully closed BEFORE the recorded entry.
  const candles = allCandles.filter((candle) => candle.closeTime < entryTime);
  assert.ok(candles.length >= 51, `Insufficient history before ${utc(entryTime)}`);
  const ema20 = emaSeries(candles, 20);
  const ema50 = emaSeries(candles, 50);
  const atr14 = atrSeries(candles, 14);
  const lastIndex = candles.length - 1;
  const last = candles[lastIndex];
  const prior20 = candles.slice(-20);
  const prior20High = Math.max(...prior20.map((candle) => candle.high));
  const prior20Low = Math.min(...prior20.map((candle) => candle.low));
  const reference20 = candles[lastIndex - 19];
  const reference30 = candles[Math.max(0, lastIndex - 29)];
  return {
    lastClosedBarOpen: utc(last.timestamp),
    lastClose: last.close,
    ema20: round(ema20[lastIndex], 4),
    ema50: round(ema50[lastIndex], 4),
    emaAlignment: ema20[lastIndex] > ema50[lastIndex] ? 'bullish' : 'bearish',
    closeVsEma20: round(last.close / ema20[lastIndex] - 1, 6),
    closeVsEma50: round(last.close / ema50[lastIndex] - 1, 6),
    atr14: round(atr14[lastIndex], 4),
    atr14Pct: round(atr14[lastIndex] / last.close, 6),
    prior20High,
    prior20Low,
    closePositionInPrior20: round((last.close - prior20Low) / (prior20High - prior20Low), 6),
    return20Bars: round(last.close / reference20.close - 1, 6),
    return30Bars: round(last.close / reference30.close - 1, 6),
  };
}

function executionPointAudit(candles15m, time, price) {
  const candle = candles15m.find((item) => item.closeTime === time - 1) ?? null;
  const tolerance = price * 0.0005;
  const outsideBy = candle === null ? null
    : price < candle.low ? candle.low - price
      : price > candle.high ? price - candle.high : 0;
  return {
    candleOpenTimeUtc: candle ? utc(candle.timestamp) : null,
    candleLow: candle?.low ?? null,
    candleHigh: candle?.high ?? null,
    tolerance,
    outsideBy,
    withinTolerance: candle !== null && outsideBy <= tolerance,
  };
}

function excursion(candles15m, item, step) {
  const overlapping = candles15m.filter((candle) => (
    candle.timestamp < item.exitTime && candle.timestamp + step > item.entryTime
  ));
  assert.ok(overlapping.length > 0, `No 15m candles for ${item.positionId}`);
  const highest = Math.max(...overlapping.map((candle) => candle.high));
  const lowest = Math.min(...overlapping.map((candle) => candle.low));
  const favorablePriceReturn = item.direction === 'long'
    ? (highest - item.entryPrice) / item.entryPrice
    : (item.entryPrice - lowest) / item.entryPrice;
  const adversePriceReturn = item.direction === 'long'
    ? (item.entryPrice - lowest) / item.entryPrice
    : (highest - item.entryPrice) / item.entryPrice;
  const realizedPriceReturn = item.direction === 'long'
    ? (item.exitPrice - item.entryPrice) / item.entryPrice
    : (item.entryPrice - item.exitPrice) / item.entryPrice;
  return {
    method: '15m OHLC overlap approximation; entry/exit boundary bars can contain time outside the holding period',
    bars: overlapping.length,
    highest,
    lowest,
    favorablePriceReturn: round(favorablePriceReturn, 6),
    adversePriceReturn: round(adversePriceReturn, 6),
    favorableMarginReturn: round(favorablePriceReturn * item.leverage, 6),
    adverseMarginReturn: round(-adversePriceReturn * item.leverage, 6),
    realizedPriceReturn: round(realizedPriceReturn, 6),
    favorableGivebackPriceReturn: round(favorablePriceReturn - realizedPriceReturn, 6),
    realizedShareOfFavorable: favorablePriceReturn > 0
      ? round(realizedPriceReturn / favorablePriceReturn, 6)
      : null,
  };
}

function markToMarketRisk(items, candles15m) {
  assert.ok(items.length > 0);
  const startingEquity = items[0].margin;
  let equity = startingEquity;
  let globalPeak = equity;
  let globalPeakTime = items[0].entryTime;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;
  let drawdownPeakTime = globalPeakTime;
  let drawdownTroughTime = globalPeakTime;
  const perRound = [];

  for (const item of items) {
    const startingRoundEquity = equity;
    let roundPeak = equity;
    let roundPeakTime = item.entryTime;
    let roundTrough = equity;
    let roundTroughTime = item.entryTime;
    let roundMaxDrawdown = 0;
    let roundMaxDrawdownPct = 0;
    const marks = candles15m
      .filter((candle) => candle.closeTime > item.entryTime && candle.closeTime < item.exitTime)
      .map((candle) => ({ time: candle.closeTime, price: candle.close }));
    marks.push({ time: item.exitTime, price: item.exitPrice });

    for (const mark of marks) {
      const unrealized = item.direction === 'long'
        ? (mark.price - item.entryPrice) * item.quantity
        : (item.entryPrice - mark.price) * item.quantity;
      const markedEquity = startingRoundEquity + unrealized;
      if (markedEquity > globalPeak) {
        globalPeak = markedEquity;
        globalPeakTime = mark.time;
      }
      const globalDrawdown = globalPeak - markedEquity;
      const globalDrawdownPct = globalPeak > 0 ? globalDrawdown / globalPeak : 0;
      if (globalDrawdown > maxDrawdown) {
        maxDrawdown = globalDrawdown;
        maxDrawdownPct = globalDrawdownPct;
        drawdownPeakTime = globalPeakTime;
        drawdownTroughTime = mark.time;
      }

      if (markedEquity > roundPeak) {
        roundPeak = markedEquity;
        roundPeakTime = mark.time;
      }
      if (markedEquity < roundTrough) {
        roundTrough = markedEquity;
        roundTroughTime = mark.time;
      }
      const roundDrawdown = roundPeak - markedEquity;
      const roundDrawdownPct = roundPeak > 0 ? roundDrawdown / roundPeak : 0;
      if (roundDrawdown > roundMaxDrawdown) {
        roundMaxDrawdown = roundDrawdown;
        roundMaxDrawdownPct = roundDrawdownPct;
      }
    }
    equity = startingRoundEquity + item.pnl;
    assert.ok(Math.abs(equity - (startingRoundEquity + (
      item.direction === 'long'
        ? (item.exitPrice - item.entryPrice) * item.quantity
        : (item.entryPrice - item.exitPrice) * item.quantity
    ))) < 1e-6);
    perRound.push({
      positionId: item.positionId,
      startingEquity: startingRoundEquity,
      endingEquity: equity,
      peakEquity: roundPeak,
      peakEquityTimeUtc: utc(roundPeakTime),
      troughEquity: roundTrough,
      troughEquityTimeUtc: utc(roundTroughTime),
      maxDrawdown: roundMaxDrawdown,
      maxDrawdownPct: roundMaxDrawdownPct,
    });
  }
  return {
    method: '15m close mark-to-market; gaps between rounds carry equity flat; excludes fees, funding and slippage',
    startingEquity,
    endingEquity: equity,
    peakEquity: globalPeak,
    maxDrawdown,
    maxDrawdownPct,
    drawdownPeakTimeUtc: utc(drawdownPeakTime),
    drawdownTroughTimeUtc: utc(drawdownTroughTime),
    perRound,
  };
}

function summarize(rounds) {
  const pnls = rounds.map((round) => round.pnl);
  const returns = rounds.map((round) => round.returnRate);
  const wins = rounds.filter((round) => round.pnl > 0);
  const losses = rounds.filter((round) => round.pnl < 0);
  const grossProfit = wins.reduce((sum, round) => sum + round.pnl, 0);
  const grossLoss = -losses.reduce((sum, round) => sum + round.pnl, 0);
  return {
    count: rounds.length,
    wins: wins.length,
    losses: losses.length,
    winRate: rounds.length ? wins.length / rounds.length : null,
    totalPnl: pnls.reduce((sum, value) => sum + value, 0),
    averagePnl: mean(pnls),
    medianPnl: median(pnls),
    averageReturnRate: mean(returns),
    medianReturnRate: median(returns),
    averageWinReturnRate: mean(wins.map((round) => round.returnRate)),
    averageLossReturnRate: mean(losses.map((round) => round.returnRate)),
    medianWinReturnRate: median(wins.map((round) => round.returnRate)),
    medianLossReturnRate: median(losses.map((round) => round.returnRate)),
    grossProfit,
    grossLoss,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    averageHoldingHours: mean(rounds.map((round) => round.holdingHours)),
    medianHoldingHours: median(rounds.map((round) => round.holdingHours)),
    averageNotional: mean(rounds.map((round) => round.notional)),
    maxNotional: rounds.length ? Math.max(...rounds.map((round) => round.notional)) : null,
  };
}

function roundedStats(stats) {
  return Object.fromEntries(Object.entries(stats).map(([key, value]) => [key, round(value, 8)]));
}

const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
const sessionRow = db.prepare(`
  select instrument, candle_source, start_time, timeframe, progress_time, cursor_time,
         review_status, updated_at, paper_trading_json
  from free_replay_sessions
  where instrument = ? and start_time = ?
`).get(INSTRUMENT, START_TIME);
assert.ok(sessionRow, 'Target Free Replay session not found');
const reviewRows = db.prepare(`
  select trade_id, tags_json, note, starred, updated_at
  from trade_reviews where trade_id like ?
`).all(`${PREFIX}%`);
db.close();

const paper = JSON.parse(sessionRow.paper_trading_json);
assert.ok(Array.isArray(paper.trades));
assert.equal(paper.position, null, 'Session still has an open position');
const byPosition = new Map();
for (const fill of paper.trades) {
  const bucket = byPosition.get(fill.positionId) ?? [];
  bucket.push(fill);
  byPosition.set(fill.positionId, bucket);
}
const reviews = new Map(reviewRows.map((row) => [row.trade_id, {
  id: row.trade_id,
  tags: JSON.parse(row.tags_json),
  note: row.note,
  starred: Boolean(row.starred),
  updatedAt: row.updated_at,
}]));

const rounds = [...byPosition.entries()].map(([positionId, fills]) => {
  const ordered = [...fills].sort((a, b) => a.exitTime - b.exitTime);
  const first = ordered[0];
  const last = ordered.at(-1);
  const quantity = ordered.reduce((sum, fill) => sum + finite(fill.quantity), 0);
  const margin = ordered.reduce((sum, fill) => sum + finite(fill.margin), 0);
  const notional = ordered.reduce((sum, fill) => sum + finite(fill.notional), 0);
  const pnl = ordered.reduce((sum, fill) => sum + finite(fill.pnl), 0);
  const entryPrice = quantity > 0
    ? ordered.reduce((sum, fill) => sum + fill.entryPrice * fill.quantity, 0) / quantity
    : first.entryPrice;
  const id = `${PREFIX}${positionId}`;
  const review = reviews.get(id);
  assert.ok(review, `Missing review for ${id}`);
  const result = {
    id,
    positionId,
    direction: first.direction,
    entryTime: finite(first.entryTime),
    exitTime: finite(last.exitTime),
    entryTimeBeijing: bj(first.entryTime),
    exitTimeBeijing: bj(last.exitTime),
    entryTimeUtc: utc(first.entryTime),
    exitTimeUtc: utc(last.exitTime),
    entryPrice,
    exitPrice: finite(last.exitPrice),
    quantity,
    margin,
    notional,
    leverage: finite(last.leverage),
    pnl,
    returnRate: margin > 0 ? pnl / margin : 0,
    holdingHours: (last.exitTime - first.entryTime) / HOUR,
    fillCount: ordered.length,
    review,
  };
  for (const fill of ordered) {
    const pricePnl = fill.direction === 'long'
      ? (fill.exitPrice - fill.entryPrice) * fill.quantity
      : (fill.entryPrice - fill.exitPrice) * fill.quantity;
    assert.ok(Math.abs(pricePnl - fill.pnl) < 1e-6, `${fill.id} PnL mismatch`);
    assert.ok(Math.abs(fill.entryPrice * fill.quantity - fill.notional) < 1e-6, `${fill.id} notional mismatch`);
    assert.ok(Math.abs(fill.notional / fill.leverage - fill.margin) < 1e-6, `${fill.id} margin mismatch`);
  }
  return result;
}).sort((a, b) => a.entryTime - b.entryTime);

assert.equal(rounds.length, 16, 'Expected exactly 16 closed Paper Rounds');
assert.equal(new Set(rounds.map((round) => round.id)).size, 16, 'Duplicate round IDs');
assert.equal(reviews.size, rounds.length, 'Extra or missing reviews for this session');
for (const id of reviews.keys()) assert.ok(rounds.some((round) => round.id === id), `Unexpected review ${id}`);
assert.ok(rounds.every((round) => round.fillCount === 1), 'This snapshot unexpectedly contains partial closes');

const equityStart = rounds[0].margin;
let equity = equityStart;
const equityChain = [];
for (const item of rounds) {
  const marginToEquity = item.margin / equity;
  assert.ok(Math.abs(item.margin - equity) < 1e-6, `${item.positionId} is not sized from full current equity`);
  equityChain.push({
    positionId: item.positionId,
    equityBefore: round(equity, 8),
    margin: round(item.margin, 8),
    marginToEquity: round(marginToEquity, 8),
    pnl: round(item.pnl, 8),
    equityAfter: round(equity + item.pnl, 8),
  });
  equity += item.pnl;
}
const totalPnl = rounds.reduce((sum, round) => sum + round.pnl, 0);
assert.ok(Math.abs(equity - equityStart - totalPnl) < 1e-6, 'Equity chain does not reconcile');

const byDirection = Object.fromEntries(['long', 'short'].map((direction) => [
  direction,
  roundedStats(summarize(rounds.filter((round) => round.direction === direction))),
]));
const tagNames = [...new Set(rounds.flatMap((round) => round.review.tags))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
const byTag = Object.fromEntries(tagNames.map((tag) => [
  tag,
  roundedStats(summarize(rounds.filter((round) => round.review.tags.includes(tag)))),
]));
const byStarred = Object.fromEntries([true, false].map((starred) => [
  String(starred),
  roundedStats(summarize(rounds.filter((round) => round.review.starred === starred))),
]));

const candles15m = await fetchCandles('15m', 15 * 60 * 1000);
const candles1h = await fetchCandles('1h', HOUR);
const candles4h = await fetchCandles('4h', 4 * HOUR);
const candles1d = await fetchCandles('1d', DAY);

for (const round of rounds) {
  round.priceReturnRate = round.direction === 'long'
    ? (round.exitPrice - round.entryPrice) / round.entryPrice
    : (round.entryPrice - round.exitPrice) / round.entryPrice;
  assert.ok(Math.abs(round.priceReturnRate * round.leverage - round.returnRate) < 1e-8, `${round.positionId} return mismatch`);
  round.excursion15m = excursion(candles15m, round, 15 * 60 * 1000);
  round.executionAudit15m = {
    entry: executionPointAudit(candles15m, round.entryTime, round.entryPrice),
    exit: executionPointAudit(candles15m, round.exitTime, round.exitPrice),
  };
  round.excursion15m.usableForTimingAnalysis = round.executionAudit15m.entry.withinTolerance
    && round.executionAudit15m.exit.withinTolerance;
  round.context4h = technicalContext(candles4h, round.entryTime);
  round.context1d = technicalContext(candles1d, round.entryTime);
}

const pnlRanking = [...rounds].sort((a, b) => b.pnl - a.pnl);
const last = rounds.at(-1);
const withoutLast = rounds.slice(0, -1);
const longest = [...rounds].sort((a, b) => b.holdingHours - a.holdingHours)[0];
assert.equal(last.positionId, longest.positionId);
const markedRisk = markToMarketRisk(rounds, candles15m);
const markedRiskWithoutLast = markToMarketRisk(withoutLast, candles15m);
const markedRiskByPosition = new Map(markedRisk.perRound.map((risk) => [risk.positionId, risk]));
for (const item of rounds) item.markToMarket15mClose = markedRiskByPosition.get(item.positionId);
const executionAnomalies = rounds.flatMap((item) => ['entry', 'exit']
  .filter((kind) => !item.executionAudit15m[kind].withinTolerance)
  .map((kind) => ({ positionId: item.positionId, kind, ...item.executionAudit15m[kind] })));
const winnerCaptureRates = rounds
  .filter((item) => item.pnl > 0 && item.excursion15m.realizedShareOfFavorable !== null)
  .map((item) => item.excursion15m.realizedShareOfFavorable);
const reliableWinnerCaptureRates = rounds
  .filter((item) => item.pnl > 0 && item.excursion15m.usableForTimingAnalysis && item.excursion15m.realizedShareOfFavorable !== null)
  .map((item) => item.excursion15m.realizedShareOfFavorable);

const summary = {
  metadata: {
    generatedAt: utc(Date.now()),
    database: DB_PATH,
    databaseAccess: 'readonly',
    instrument: INSTRUMENT,
    startTime: START_TIME,
    candleSource: sessionRow.candle_source ?? 'Binance (legacy null)',
    sessionTimeframe: sessionRow.timeframe,
    sessionProgressTimeUtc: utc(sessionRow.progress_time * 1000),
    sessionCursorTimeUtc: utc(sessionRow.cursor_time * 1000),
    sessionUpdatedAt: sessionRow.updated_at,
    marketData: 'Binance USDT-M public klines, BTCUSDT, 2020-03-01 through 2020-11-01 UTC',
    candleCounts: { '15m': candles15m.length, '1h': candles1h.length, '4h': candles4h.length, '1d': candles1d.length },
    timeDisplay: 'Beijing = UTC+8 in CSV/report; Binance 1d bars open at 00:00 UTC = 08:00 Beijing',
    returnDefinition: 'returnRate = realized PnL / consumed margin; priceReturnRate excludes leverage',
    excursionCaveat: '15m OHLC ranges overlap the holding period; boundary bars may include pre-entry/post-exit movement and are not tick-accurate',
    executionAuditRule: 'The 15m candle immediately completed at each event must contain its price within 0.05%; this tolerates fills made on finer timeframes',
  },
  executionAudit: {
    anomalyCount: executionAnomalies.length,
    anomalies: executionAnomalies,
  },
  exitQuality: {
    rawMedianWinnerCaptureOfMfe: median(winnerCaptureRates),
    medianWinnerCaptureOfMfeExcludingTimingAnomalies: median(reliableWinnerCaptureRates),
    rawWinnerCount: winnerCaptureRates.length,
    reliableWinnerCount: reliableWinnerCaptureRates.length,
  },
  overall: roundedStats(summarize(rounds)),
  overallWithoutLast: roundedStats(summarize(withoutLast)),
  equity: {
    startingEquity: equityStart,
    endingEquity: equity,
    totalPnl,
    accountReturnRate: totalPnl / equityStart,
    everyRoundUsedFullEquityAsMargin: equityChain.every((row) => Math.abs(row.marginToEquity - 1) < 1e-8),
    chain: equityChain,
  },
  concentration: {
    largestPnlPositionId: pnlRanking[0].positionId,
    largestPnl: pnlRanking[0].pnl,
    largestPnlShareOfTotal: pnlRanking[0].pnl / totalPnl,
    topThreePnlShareOfTotal: pnlRanking.slice(0, 3).reduce((sum, round) => sum + round.pnl, 0) / totalPnl,
    lastPositionHoldingDays: last.holdingHours / 24,
    lastPositionId: last.positionId,
  },
  byDirection,
  byTag,
  byStarred,
  markToMarketRisk: {
    all: markedRisk,
    withoutLast: markedRiskWithoutLast,
  },
  rounds,
};

fs.writeFileSync(path.join(RESEARCH_DIR, 'analysis.json'), JSON.stringify(summary, null, 2));
const csvHeaders = [
  'positionId', 'direction', 'entryTimeBeijing', 'exitTimeBeijing', 'holdingHours',
  'entryPrice', 'exitPrice', 'quantity', 'margin', 'notional', 'leverage', 'pnl',
  'returnRate', 'priceReturnRate', 'tags', 'starred', 'note',
  'mfePriceReturn15m', 'maePriceReturn15m', 'favorableGivebackPriceReturn15m', 'executionTimingReliable15m',
];
const csvRows = rounds.map((item) => ({
  positionId: item.positionId,
  direction: item.direction,
  entryTimeBeijing: item.entryTimeBeijing,
  exitTimeBeijing: item.exitTimeBeijing,
  holdingHours: round(item.holdingHours, 4),
  entryPrice: round(item.entryPrice, 4),
  exitPrice: item.exitPrice,
  quantity: round(item.quantity, 8),
  margin: round(item.margin, 4),
  notional: round(item.notional, 4),
  leverage: item.leverage,
  pnl: round(item.pnl, 4),
  returnRate: round(item.returnRate, 8),
  priceReturnRate: round(item.priceReturnRate, 8),
  tags: item.review.tags,
  starred: item.review.starred,
  note: item.review.note,
  mfePriceReturn15m: item.excursion15m.favorablePriceReturn,
  maePriceReturn15m: round(item.excursion15m.adversePriceReturn, 6),
  favorableGivebackPriceReturn15m: item.excursion15m.favorableGivebackPriceReturn,
  executionTimingReliable15m: item.excursion15m.usableForTimingAnalysis,
}));
const csv = [csvHeaders.join(','), ...csvRows.map((row) => csvHeaders.map((header) => csvCell(row[header])).join(','))].join('\n');
fs.writeFileSync(path.join(RESEARCH_DIR, 'rounds.csv'), `\uFEFF${csv}\n`);

console.log(JSON.stringify({
  overall: summary.overall,
  overallWithoutLast: summary.overallWithoutLast,
  equity: { ...summary.equity, chain: undefined },
  concentration: summary.concentration,
  byDirection: summary.byDirection,
  byTag: summary.byTag,
  byStarred: summary.byStarred,
  markToMarketRisk: {
    all: { ...summary.markToMarketRisk.all, perRound: undefined },
    withoutLast: { ...summary.markToMarketRisk.withoutLast, perRound: undefined },
  },
  candleCounts: summary.metadata.candleCounts,
  executionAudit: summary.executionAudit,
  exitQuality: summary.exitQuality,
}, null, 2));
console.log('\nROUND LEDGER (Beijing time)');
for (const round of rounds) {
  console.log([
    round.positionId,
    round.direction,
    round.entryTimeBeijing,
    round.exitTimeBeijing,
    `${round.holdingHours.toFixed(2)}h`,
    round.entryPrice.toFixed(2),
    round.exitPrice.toFixed(2),
    `pnl=${round.pnl.toFixed(2)}`,
    `ROE=${(round.returnRate * 100).toFixed(2)}%`,
    `MFE=${(round.excursion15m.favorablePriceReturn * 100).toFixed(2)}%`,
    `MAE=${(round.excursion15m.adversePriceReturn * 100).toFixed(2)}%`,
    round.review.tags.join('|'),
    round.review.starred ? 'star' : 'no-star',
  ].join('\t'));
}
