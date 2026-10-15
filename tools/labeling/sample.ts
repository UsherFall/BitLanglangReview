/**
 * Sampling half of the labeling workbench (see the task's `design.md`).
 *
 * Fetches the crypto pool's 1D candles ONCE, freezes them to disk, then runs the
 * shipped coarse screen and convergence detector over that snapshot and picks
 * three groups to hand-label:
 *
 *   qualified — cleared the 1D coarse screen (the rows the panel would list)
 *   boundary  — did NOT clear it, but `score` sits near the cut (most informative)
 *   reject    — the rest, randomly sampled (hunts for missed good structures)
 *
 * The pool filter order, the bar-completion rule and both detectors are imported
 * from `src/` — never re-implemented here. This script must stay a thin driver.
 *
 *   npm run label:sample                 # fetch (first run) then sample
 *   npm run label:sample -- --refresh    # force a fresh snapshot at the current time
 *
 * Re-running WITHOUT `--refresh` reuses `out/candles.json` and its anchor, so the
 * candidate list is byte-identical — that is what makes a label set reproducible.
 */
import fs from 'node:fs';

import {
  COARSE_TIMEFRAME,
  DEFAULT_COARSE_PARAMS,
  coarseScreen,
  coarseStructure,
  defaultStructureParams,
  probeStructure,
  timeframeMinScore,
} from '../../src/domain/coin-scan';
import type { Candlestick } from '../../src/domain/candlestick';
import type { MarketClass } from '../../src/domain/market-class';
import { isCandleInSession, isMarketOpen, marketSession } from '../../src/domain/market-session';
import { isScannable } from '../../src/domain/scan-pool';
import { defaultScanParams, scanScopeOf } from '../../src/domain/scan-scope';
import { BitgetCandleSource } from '../../src/server/bitget-candles';
import { bitgetInstrumentMetadata } from '../../src/server/bitget-instrument-metadata';
import { BitgetTickerSource } from '../../src/server/bitget-tickers';
import { CandlestickStore } from '../../src/server/candlestick-store';
import { timeframeMs } from '../../src/server/candlestick-service';
import { resolveDataPath } from '../../src/server/data-root';
import type { Ticker } from '../../src/server/market-data';
import {
  CANDIDATES_CSV,
  CANDIDATES_FILE,
  CANDLES_FILE,
  ensureOutDir,
  mulberry32,
  readJson,
  toCandles,
  toSlim,
  writeJson,
  type Candidate,
  type SlimBar,
  type Snapshot,
} from './shared';

/** Same concurrency the service uses for its per-instrument fetches. */
const FETCH_CONCURRENCY = 5;
/** Progress line cadence, so a long fetch does not look hung. */
const PROGRESS_EVERY = 25;
const SOURCE = 'bitget';
const SCOPE = 'crypto';

type Options = {
  anchor: number | undefined;
  refresh: boolean;
  bandMin: number;
  bandMax: number;
  rejectCount: number;
  seed: number;
  minScore: number;
  history: number;
};

const HELP = `Usage: npm run label:sample -- [options]

  --refresh           fetch a new snapshot instead of reusing out/candles.json
  --anchor <ms>       snapshot instant (epoch ms); default = now. Ignored unless --refresh.
  --band-min <n>      boundary-band floor on score        (default 0.35)
  --band-max <n>      boundary-band ceiling on score      (default 1 = no ceiling)
  --reject <n>        random rejects to keep              (default 30)
  --seed <n>          PRNG seed for the reject sample     (default 20261014)
  --min-score <n>     the panel's 结构强度阈值 knob         (default 0.6)
  --history <bars>    daily bars to CHART for each candidate (default 365 ≈ 1 year)
`;

function parseOptions(argv: readonly string[]): Options {
  const options: Options = {
    anchor: undefined,
    refresh: false,
    bandMin: 0.35,
    bandMax: 1,
    rejectCount: 30,
    seed: 20261014,
    minScore: 0.6,
    history: 365,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => Number(argv[(i += 1)]);
    switch (arg) {
      case '--refresh':
        options.refresh = true;
        break;
      case '--anchor':
        options.anchor = value();
        break;
      case '--band-min':
        options.bandMin = value();
        break;
      case '--band-max':
        options.bandMax = value();
        break;
      case '--reject':
        options.rejectCount = value();
        break;
      case '--seed':
        options.seed = value();
        break;
      case '--min-score':
        options.minScore = value();
        break;
      case '--history':
        options.history = value();
        break;
      case '--help':
        process.stdout.write(HELP);
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown option: ${arg}\n\n${HELP}`);
    }
  }
  if (options.anchor !== undefined && !Number.isFinite(options.anchor)) {
    throw new Error('--anchor must be an epoch-millisecond number');
  }
  return options;
}

/**
 * Raw candle window for one candidate. Mirrors `coin-scan-service.scanWindowFor`:
 * a session-gated class (US/KR/HK/CN equity) pays for the bars a closed market
 * drops, so it asks for twice as many.
 */
function scanWindowFor(marketClass: MarketClass | undefined): number {
  const gated = marketClass !== undefined && marketSession(marketClass) !== null;
  return gated ? 200 : 100;
}

/**
 * The bars a detector may see, exactly as `coin-scan-service.completedCandles`
 * reduces them: the still-forming bar is dropped BY TIME (never by slicing the
 * newest element, which would wrongly drop the newest COMPLETED bar), and bars
 * outside a gated class's session are dropped so a closed-market stretch cannot
 * read as a quiet band.
 */
function completedCandles(raw: readonly Candlestick[], marketClass: MarketClass | undefined, anchor: number): Candlestick[] {
  const step = timeframeMs(COARSE_TIMEFRAME);
  const cls = marketClass ?? 'CRYPTO';
  return raw
    .filter((candle) => candle.timestamp + step <= anchor && isCandleInSession(cls, candle.timestamp, step))
    .sort((a, b) => a.timestamp - b.timestamp);
}

async function mapLimit<T, R>(items: readonly T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

/** 1-based 24h-volume rank across the whole crypto-scope pool (floor NOT applied). */
function rankByVolume(tickers: readonly Ticker[]): Map<string, number> {
  const pool = tickers
    .filter((ticker) => isScannable(ticker.marketClass) && scanScopeOf(ticker.marketClass) === SCOPE)
    .sort((a, b) => b.quoteVolume24h - a.quoteVolume24h);
  return new Map(pool.map((ticker, index) => [ticker.instrument, index + 1]));
}

/** The service's pool filter, in the same order (volume rail -> class -> scope -> open). */
function selectPool(tickers: readonly Ticker[], anchor: number): Ticker[] {
  const floor = defaultScanParams(SOURCE, SCOPE).minQuoteVolume24h;
  const pool: Ticker[] = [];
  for (const ticker of tickers) {
    if (ticker.quoteVolume24h < floor) continue;
    if (!isScannable(ticker.marketClass)) continue;
    if (scanScopeOf(ticker.marketClass) !== SCOPE) continue;
    if (!isMarketOpen(ticker.marketClass ?? 'CRYPTO', anchor)) continue;
    pool.push(ticker);
  }
  return pool;
}

async function fetchSnapshot(tickers: readonly Ticker[], anchor: number): Promise<Snapshot> {
  fs.mkdirSync(resolveDataPath(), { recursive: true });
  // A dedicated SQLite file so the tool never touches the review candlestick cache.
  const candleSource = new BitgetCandleSource(new CandlestickStore(resolveDataPath('labeling.sqlite')));
  const ranks = rankByVolume(tickers);
  const pool = selectPool(tickers, anchor);
  process.stdout.write(`snapshot: fetching 1D for ${pool.length} candidates (scope ${SCOPE})\n`);

  let done = 0;
  const failures: string[] = [];
  const fetched = await mapLimit(pool, FETCH_CONCURRENCY, async (ticker) => {
    try {
      const raw = await candleSource.getCandlesticks({
        instrument: ticker.instrument,
        timeframe: COARSE_TIMEFRAME,
        anchor,
        direction: 'earlier',
        limit: scanWindowFor(ticker.marketClass),
        refresh: true,
      });
      done += 1;
      if (done % PROGRESS_EVERY === 0) process.stdout.write(`  fetched ${done}/${pool.length}\n`);
      return { instrument: ticker.instrument, bars: completedCandles(raw, ticker.marketClass, anchor) };
    } catch (error) {
      failures.push(ticker.instrument);
      process.stdout.write(`  ! ${ticker.instrument}: ${error instanceof Error ? error.message : String(error)}\n`);
      return { instrument: ticker.instrument, bars: [] as Candlestick[] };
    }
  });

  const candles: Record<string, SlimBar[]> = {};
  for (const { instrument, bars } of fetched) {
    if (bars.length > 0) candles[instrument] = toSlim(bars);
  }
  // Freeze the volume reading too, so a rerun from this file is reproducible.
  const volume: Snapshot['volume'] = {};
  for (const ticker of pool) {
    if (candles[ticker.instrument]) {
      volume[ticker.instrument] = { quoteVolume24h: ticker.quoteVolume24h, volumeRank: ranks.get(ticker.instrument) ?? 0 };
    }
  }
  const snapshot: Snapshot = {
    anchor,
    source: SOURCE,
    timeframe: COARSE_TIMEFRAME,
    fetchedAt: new Date().toISOString(),
    candles,
    history: {},
    historyBars: 0,
    volume,
  };
  writeJson(CANDLES_FILE, snapshot, 0);
  process.stdout.write(
    `snapshot written: ${Object.keys(candles).length} instruments with bars` +
      (failures.length > 0 ? `, ${failures.length} failed (${failures.join(', ')})` : '') +
      `\n  -> ${CANDLES_FILE}\n`,
  );
  return snapshot;
}

/** The frozen snapshot, or a fresh one when asked / when there is none. */
async function resolveSnapshot(options: Options): Promise<Snapshot> {
  const cached = readJson<Snapshot>(CANDLES_FILE);
  if (cached && !options.refresh) {
    if (options.anchor !== undefined && options.anchor !== cached.anchor) {
      process.stdout.write(
        `note: --anchor ${options.anchor} ignored; reusing the frozen snapshot's anchor ${cached.anchor}.\n` +
          `      pass --refresh to take a new snapshot.\n`,
      );
    }
    process.stdout.write(`snapshot reused: anchor ${cached.anchor} (${new Date(cached.anchor).toISOString()})\n`);
    return cached;
  }
  // Only a refresh touches the network: a reuse run works offline.
  const tickerSource = new BitgetTickerSource(undefined, bitgetInstrumentMetadata());
  const tickers = await tickerSource.listTickers();
  return fetchSnapshot(tickers, options.anchor ?? Date.now());
}

/**
 * Fetches the CHART window (about a year) for the sampled candidates only, via
 * the paged read. These bars are never fed to a detector — see `Snapshot.history`.
 *
 * A rerun without `--refresh` and with an unchanged `--history` costs nothing:
 * the snapshot already holds the series. That is also why this is a separate
 * stage rather than part of `fetchSnapshot` — the candidate set is not known
 * until after the coarse screen.
 */
async function ensureHistory(snapshot: Snapshot, candidates: readonly Candidate[], options: Options): Promise<void> {
  const existing = snapshot.history ?? {};
  const covered =
    snapshot.historyBars === options.history &&
    candidates.length > 0 &&
    candidates.every((candidate) => existing[candidate.instrument] !== undefined);
  if (covered) {
    process.stdout.write(`history reused: up to ${options.history} bars for ${candidates.length} candidates\n`);
    return;
  }

  fs.mkdirSync(resolveDataPath(), { recursive: true });
  const candleSource = new BitgetCandleSource(new CandlestickStore(resolveDataPath('labeling.sqlite')));
  process.stdout.write(`history: paging up to ${options.history} bars for ${candidates.length} candidates\n`);
  let done = 0;
  const fetched = await mapLimit(candidates, FETCH_CONCURRENCY, async (candidate) => {
    try {
      // No extra completion filter here: the source already drops the
      // still-forming bar with the same `timestamp + step <= anchor` rule.
      const bars = await candleSource.getCandlesticks({
        instrument: candidate.instrument,
        timeframe: COARSE_TIMEFRAME,
        anchor: snapshot.anchor,
        direction: 'earlier',
        limit: options.history,
        refresh: true,
        allowPaging: true,
      });
      done += 1;
      if (done % PROGRESS_EVERY === 0) process.stdout.write(`  history ${done}/${candidates.length}\n`);
      return { instrument: candidate.instrument, bars };
    } catch (error) {
      process.stdout.write(`  ! history ${candidate.instrument}: ${error instanceof Error ? error.message : String(error)}\n`);
      return { instrument: candidate.instrument, bars: [] as Candlestick[] };
    }
  });

  const history: Record<string, SlimBar[]> = {};
  for (const { instrument, bars } of fetched) history[instrument] = toSlim(bars);
  snapshot.history = history;
  snapshot.historyBars = options.history;
  writeJson(CANDLES_FILE, snapshot, 0);
  const lengths = Object.values(history)
    .map((bars) => bars.length)
    .sort((a, b) => a - b);
  process.stdout.write(
    `history written: ${lengths.length} instruments, bars ${lengths[0]}–${lengths[lengths.length - 1]} ` +
      `(median ${lengths[Math.floor(lengths.length / 2)]})\n`,
  );
}

function toCsv(rows: readonly Candidate[]): string {
  const header = [
    'instrument',
    'anchor',
    'bucket',
    'score',
    'structureQualified',
    'converged',
    'passCoarse',
    'rangePct',
    'netPct',
    'posRange',
    'rangePctThreshold',
    'netPctThreshold',
    'quoteVolume24h',
    'volumeRank',
  ];
  const lines = rows.map((row) =>
    [
      row.instrument,
      row.anchor,
      row.bucket,
      row.score.toFixed(4),
      row.structureQualified ? 1 : 0,
      row.converged ? 1 : 0,
      row.passCoarse ? 1 : 0,
      row.coarse ? row.coarse.rangePct.toFixed(6) : '',
      row.coarse ? row.coarse.netPct.toFixed(6) : '',
      row.coarse ? row.coarse.posRange.toFixed(6) : '',
      row.rangePctThreshold.toFixed(6),
      row.netPctThreshold.toFixed(6),
      String(row.quoteVolume24h),
      String(row.volumeRank),
    ].join(','),
  );
  return `${header.join(',')}\n${lines.join('\n')}\n`;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  ensureOutDir();

  const snapshot = await resolveSnapshot(options);
  const anchor = snapshot.anchor;
  const instruments = Object.keys(snapshot.candles).sort();
  // The detector input: the frozen ~90-bar series, rebuilt into the domain shape.
  const candlesOf = (instrument: string) => toCandles(instrument, COARSE_TIMEFRAME, snapshot.candles[instrument]);

  // The same two calls the service makes, over the same snapshot.
  const coarseParams = DEFAULT_COARSE_PARAMS;
  const measures = instruments.map((instrument) => coarseStructure(candlesOf(instrument), coarseParams));
  const { screen, passes } = coarseScreen(measures, coarseParams);
  const structureParams = defaultStructureParams();
  const threshold = timeframeMinScore(COARSE_TIMEFRAME, options.minScore);

  const all: Candidate[] = instruments.map((instrument, index) => {
    const structure = probeStructure(candlesOf(instrument), structureParams);
    const score = structure?.score ?? 0;
    const structureQualified = structure?.qualified ?? false;
    const measure = measures[index];
    const volume = snapshot.volume[instrument];
    return {
      instrument,
      anchor,
      bucket: 'reject', // assigned below
      score,
      structureQualified,
      converged: structureQualified && score >= threshold,
      passCoarse: passes[index],
      coarse: measure ? { rangePct: measure.rangePct, netPct: measure.netPct, posRange: measure.posRange } : null,
      rangePctThreshold: screen.rangePctThreshold,
      netPctThreshold: screen.netPctThreshold,
      quoteVolume24h: volume?.quoteVolume24h ?? 0,
      volumeRank: volume?.volumeRank ?? 0,
    };
  });

  const qualified = all.filter((candidate) => candidate.passCoarse);
  const qualifiedSet = new Set(qualified.map((candidate) => candidate.instrument));
  // Everything the screen rejected whose score reaches the boundary floor. NOT
  // capped by count and NOT sorted-and-sliced: the previous "top 30 by score"
  // silently consumed the whole `converged-but-coarse-rejected` group (measured
  // 21 of 31 converged coins on 10/14), which is the single most informative
  // frame — the detector and the screen disagree there. The score WINDOW is the
  // only lever; `--band-max` narrows it to the near-cut band when wanted.
  const boundary = all
    .filter((candidate) => !candidate.passCoarse && candidate.score >= options.bandMin && candidate.score <= options.bandMax)
    .sort((a, b) => b.score - a.score || a.instrument.localeCompare(b.instrument));
  const boundarySet = new Set(boundary.map((candidate) => candidate.instrument));

  const rejectPool = all.filter(
    (candidate) => !qualifiedSet.has(candidate.instrument) && !boundarySet.has(candidate.instrument),
  );
  const random = mulberry32(options.seed);
  const shuffled = [...rejectPool];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const reject = shuffled.slice(0, options.rejectCount).sort((a, b) => b.score - a.score || a.instrument.localeCompare(b.instrument));

  for (const candidate of qualified) candidate.bucket = 'qualified';
  for (const candidate of boundary) candidate.bucket = 'boundary';
  for (const candidate of reject) candidate.bucket = 'reject';

  const rows = [...qualified, ...boundary, ...reject];
  await ensureHistory(snapshot, rows, options);
  writeJson(CANDIDATES_FILE, {
    anchor,
    source: SOURCE,
    timeframe: COARSE_TIMEFRAME,
    minScore: options.minScore,
    scoreThreshold: threshold,
    bandMin: options.bandMin,
    bandMax: options.bandMax,
    seed: options.seed,
    poolSize: all.length,
    rangePctThreshold: screen.rangePctThreshold,
    netPctThreshold: screen.netPctThreshold,
    candidates: rows,
  });
  fs.writeFileSync(CANDIDATES_CSV, toCsv(rows), 'utf8');

  const convergedOnly = all.filter((candidate) => candidate.converged && !candidate.passCoarse).length;
  process.stdout.write(
    [
      '',
      `anchor            ${anchor} (${new Date(anchor).toISOString()})`,
      `pool measured     ${all.length}`,
      `  qualified       ${qualified.length}    cleared the 1D coarse screen`,
      `  boundary        ${boundary.length}    rejected by it, score in [${options.bandMin}, ${options.bandMax}]`,
      `  reject          ${reject.length}    random of ${rejectPool.length} (seed ${options.seed})`,
      '',
      `converged (1D)    ${all.filter((candidate) => candidate.converged).length}    threshold ${threshold} (knob ${options.minScore})`,
      `  of which the coarse screen REJECTED ${convergedOnly}  <- the detector/screen disagreement`,
      `coarse cuts       rangePct <= ${screen.rangePctThreshold}, |netPct| <= ${screen.netPctThreshold}`,
      '',
      `-> ${CANDIDATES_CSV}`,
      `-> ${CANDIDATES_FILE}`,
      'next: npm run label:page',
      '',
    ].join('\n'),
  );
}

main().catch((error) => {
  process.stderr.write(`sample failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exit(1);
});
