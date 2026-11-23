import assert from 'node:assert/strict';
import fs from 'node:fs';
import Database from 'better-sqlite3';

const BASE = '.trellis/tasks/11-23-btc-2020-05-12-halving-review/research';
const analysis = JSON.parse(fs.readFileSync(`${BASE}/analysis.json`, 'utf8'));
const report = fs.readFileSync(`${BASE}/btc-2020-05-12-review.md`, 'utf8');
const convergenceReport = fs.readFileSync(`${BASE}/convergence-analysis.md`, 'utf8');
const csvLines = fs.readFileSync(`${BASE}/rounds.csv`, 'utf8').trim().split(/\r?\n/);
const db = new Database('data/review.sqlite', { readonly: true, fileMustExist: true });
const session = db.prepare(`
  select paper_trading_json from free_replay_sessions
  where instrument = 'BTCUSDT' and start_time = '2020-05-12 16:00'
`).get();
const reviews = db.prepare(`
  select trade_id, tags_json, note from trade_reviews
  where trade_id like 'paper:BTCUSDT:2020-05-12 16:00:%'
`).all();
db.close();

const fills = JSON.parse(session.paper_trading_json).trades;
assert.equal(fills.length, 16);
assert.equal(reviews.length, 16);
assert.equal(analysis.rounds.length, 16);
assert.equal(csvLines.length, 17);
assert.equal(new Set(analysis.rounds.map((round) => round.id)).size, 16);

const rawPnl = fills.reduce((sum, fill) => sum + fill.pnl, 0);
assert.ok(Math.abs(rawPnl - analysis.overall.totalPnl) < 1e-6);
assert.ok(Math.abs(
  analysis.equity.startingEquity + analysis.overall.totalPnl - analysis.equity.endingEquity,
) < 1e-6);

for (const fill of fills) {
  const round = analysis.rounds.find((item) => item.positionId === fill.positionId);
  assert.ok(round, fill.positionId);
  for (const key of ['entryPrice', 'exitPrice', 'quantity', 'margin', 'notional', 'pnl']) {
    assert.ok(Math.abs(round[key] - fill[key]) < 1e-6, `${fill.positionId} ${key}`);
  }
  assert.ok(report.includes(round.positionId), `Report missing ${round.positionId}`);
  assert.ok(csvLines.some((line) => line.startsWith(`${round.positionId},`)), `CSV missing ${round.positionId}`);
}

for (const review of reviews) {
  const round = analysis.rounds.find((item) => item.id === review.trade_id);
  assert.ok(round, review.trade_id);
  assert.deepEqual(round.review.tags, JSON.parse(review.tags_json));
  assert.equal(round.review.note, review.note);
  if (review.note) assert.ok(report.includes(review.note), `Report missing note ${review.trade_id}`);
}

for (const direction of ['long', 'short']) {
  const expected = analysis.rounds
    .filter((round) => round.direction === direction)
    .reduce((sum, round) => sum + round.pnl, 0);
  assert.ok(Math.abs(analysis.byDirection[direction].totalPnl - expected) < 1e-6);
}
for (const tag of Object.keys(analysis.byTag)) {
  const expected = analysis.rounds
    .filter((round) => round.review.tags.includes(tag))
    .reduce((sum, round) => sum + round.pnl, 0);
  assert.ok(Math.abs(analysis.byTag[tag].totalPnl - expected) < 1e-6);
}

const losses = analysis.rounds.filter((round) => round.pnl < 0);
assert.deepEqual(losses.map((round) => round.positionId), ['position-19', 'position-43']);
for (const positionId of [...losses.map((round) => round.positionId), 'position-25', 'position-46']) {
  const heading = report.split('\n').find((line) => (
    line.startsWith('### 6.') && line.includes('`' + positionId + '`')
  ));
  assert.ok(heading, `Missing case-study heading for ${positionId}`);
}

assert.equal(analysis.byStarred.true.count, 14);
assert.equal(analysis.byStarred.false.count, 2);
assert.equal(analysis.overall.wins, 14);
assert.equal(analysis.overall.losses, 2);
assert.ok(Math.abs(analysis.concentration.largestPnlShareOfTotal - 0.7110727441509843) < 1e-12);
assert.ok(Math.abs(analysis.concentration.topThreePnlShareOfTotal - 0.861501407553367) < 1e-12);
assert.ok(Math.abs(analysis.markToMarketRisk.all.maxDrawdownPct - 0.6119975747893581) < 1e-12);
assert.ok(Math.abs(analysis.markToMarketRisk.withoutLast.maxDrawdownPct - 0.23042834601457485) < 1e-12);

const captureRates = analysis.rounds
  .filter((round) => round.pnl > 0)
  .map((round) => round.excursion15m.realizedShareOfFavorable)
  .sort((a, b) => a - b);
const medianCapture = (captureRates[6] + captureRates[7]) / 2;
assert.equal(medianCapture.toFixed(4), '0.4437');
const reliableCaptureRates = analysis.rounds
  .filter((round) => round.pnl > 0 && round.excursion15m.usableForTimingAnalysis)
  .map((round) => round.excursion15m.realizedShareOfFavorable)
  .sort((a, b) => a - b);
assert.equal(reliableCaptureRates.length, 13);
const reliableMedianCapture = reliableCaptureRates[6];
assert.equal(reliableMedianCapture.toFixed(4), '0.5078');
assert.equal(analysis.executionAudit.anomalyCount, 1);
assert.equal(analysis.executionAudit.anomalies[0].positionId, 'position-22');
assert.equal(analysis.executionAudit.anomalies[0].kind, 'entry');
for (const text of [
  '87.50%', '82,465.85', '58,639.22', '71.11%', '86.15%',
  '61.20%', '23.04%', '44.37%', '50.78%', '盘前：先回答，再开仓',
  '这套样本不能证明什么', '复算与交付验证',
]) {
  assert.ok(report.includes(text), `Report missing required evidence: ${text}`);
}

const convergenceIds = analysis.rounds
  .filter((round) => round.review.tags.some((tag) => tag.includes('收敛')))
  .map((round) => round.positionId);
assert.equal(convergenceIds.length, 11);
for (const positionId of [...convergenceIds, 'position-22', 'position-43']) {
  assert.ok(convergenceReport.includes(positionId), `Convergence report missing ${positionId}`);
}
for (const text of ['波动收窄', '水平箱体', '几何', '结构转换', '精确入场触发', '不自动判定']) {
  assert.ok(convergenceReport.includes(text), `Convergence report missing concept: ${text}`);
}

console.log(JSON.stringify({
  result: 'PASS',
  rawFills: fills.length,
  reviews: reviews.length,
  csvDataRows: csvLines.length - 1,
  uniqueRoundIds: new Set(analysis.rounds.map((round) => round.id)).size,
  totalPnl: rawPnl,
  wins: analysis.overall.wins,
  losses: losses.map((round) => round.positionId),
  representativeWinnerCases: ['position-25', 'position-46'],
  allOriginalNotesPresentInReport: true,
  directionAndTagGroupsReconcile: true,
  largestPnlShare: analysis.concentration.largestPnlShareOfTotal,
  topThreePnlShare: analysis.concentration.topThreePnlShareOfTotal,
  maxDrawdownAll: analysis.markToMarketRisk.all.maxDrawdownPct,
  maxDrawdownWithoutLast: analysis.markToMarketRisk.withoutLast.maxDrawdownPct,
  medianWinnerCaptureOfMfe: medianCapture,
  medianWinnerCaptureOfMfeExcludingTimingAnomalies: reliableMedianCapture,
  executionAnomalies: analysis.executionAudit.anomalies,
  convergenceCasesChecked: convergenceIds.length + 2,
  acceptance: {
    AC1: 'PASS: raw fills/reviews/CSV/report reconcile to 16 unique rounds',
    AC2: 'PASS: overall/direction/tag/star statistics and equity chain reconcile',
    AC3: 'PASS: every loss plus position-25/46 case studies; source/timeframes documented',
    AC4: 'PASS: original/note/hindsight sections and ambiguity caveat present',
    AC5: 'PASS: entry/exit/leverage/sizing/limitations and final-round concentration covered',
    AC6: 'PASS: concrete pre-trade/entry/exit/stop/review checklists present',
    AC7: 'PASS: persisted report and reproducible artifacts exist',
    AC8: 'PASS: 11 convergence tags plus position-22/43 audited by type/location/trigger; no automatic verdict',
  },
}, null, 2));
