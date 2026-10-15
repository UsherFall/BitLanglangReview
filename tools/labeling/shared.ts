import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Candlestick } from '../../src/domain/candlestick';
import type { ReviewTimeframe } from '../../src/domain/trade';

/** Everything this tool writes lives here; the directory is gitignored. */
export const OUT_DIR = fileURLToPath(new URL('./out/', import.meta.url));

export const CANDLES_FILE = `${OUT_DIR}candles.json`;
export const CANDIDATES_FILE = `${OUT_DIR}candidates.json`;
export const CANDIDATES_CSV = `${OUT_DIR}candidates.csv`;
export const PAGE_FILE = `${OUT_DIR}label.html`;

/**
 * Which sampling frame a candidate came from. `qualified` means it cleared the
 * 1D coarse screen — i.e. it is the kind of row the shipped scan would list —
 * NOT that the convergence detector called it converged (that is `converged`).
 */
export type CandidateBucket = 'qualified' | 'boundary' | 'reject';

/** One 1D candidate to be hand-labelled. Mirrors `design.md` §7. */
export type Candidate = {
  instrument: string;
  /** Snapshot anchor (epoch ms); the chart is drawn as of this instant. */
  anchor: number;
  bucket: CandidateBucket;
  /** `probeStructure(...)?.score ?? 0` — the shrink depth. */
  score: number;
  /** The detector found a band passing all three gates. */
  structureQualified: boolean;
  /** `structureQualified && score >= timeframeMinScore('1D', minScore)` — a 1D row the panel would highlight. */
  converged: boolean;
  /** Cleared the 1D coarse screen — the row criterion of the shipped scan. */
  passCoarse: boolean;
  /** Coarse measures; null when the window could not be measured (short history or a failed fetch). */
  coarse: { rangePct: number; netPct: number; posRange: number } | null;
  /** Pool-relative cuts, identical on every candidate of one run. */
  rangePctThreshold: number;
  netPctThreshold: number;
  quoteVolume24h: number;
  /** 1-based rank by 24h quote volume across the whole crypto-scope pool. */
  volumeRank: number;
};

/** The frozen snapshot of record: the ONLY data source the page is built from. */
export type Snapshot = {
  anchor: number;
  source: string;
  timeframe: string;
  fetchedAt: string;
  /**
   * The bars the DETECTORS see, for the whole pool: the newest ~90 (exactly the
   * window the shipped scan gets, see `design.md` §2). Slimmed to `SlimBar`
   * because the verbose `Candlestick` shape costs ~238 B/bar.
   */
  candles: Record<string, SlimBar[]>;
  /**
   * The bars the CHART sees, for the sampled candidates only: about a year, so a
   * human can see whether a real prior move ("前戏") happened. Never fed to the
   * detectors — that would move `posRange` and decouple the sample from the live
   * scan.
   */
  history: Record<string, SlimBar[]>;
  /** How many bars `history` was fetched for; lets a reuse run detect a changed `--history`. */
  historyBars: number;
  /**
   * instrument -> its 24h volume reading AT THE SNAPSHOT. Frozen alongside the
   * bars because these come from a live ticker fetch: leaving them live would
   * make `candidates.csv` differ between two otherwise identical reruns.
   */
  volume: Record<string, { quoteVolume24h: number; volumeRank: number }>;
};

/** `[timestamp, open, high, low, close]` — the storage-friendly candle shape. */
export type SlimBar = [number, number, number, number, number];

export function toSlim(candles: readonly Candlestick[]): SlimBar[] {
  return candles.map((candle) => [candle.timestamp, candle.open, candle.high, candle.low, candle.close]);
}

/**
 * Rebuilds the domain shape for the detectors. `volume` is not read by
 * `coarseStructure` / `probeStructure`, so it is not carried in `SlimBar`.
 */
export function toCandles(instrument: string, timeframe: ReviewTimeframe, bars: readonly SlimBar[]): Candlestick[] {
  return bars.map(([timestamp, open, high, low, close]) => ({
    instrument,
    timeframe,
    timestamp,
    open,
    high,
    low,
    close,
    volume: 0,
  }));
}

export function ensureOutDir(): void {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

export function readJson<T>(file: string): T | null {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

/**
 * `indent` defaults to 2 for the small human-read files (candidates.json). The
 * candle snapshot passes 0: with ~140k `SlimBar` arrays, pretty-printing costs
 * more than twice as much (measured 14.3 MB vs 6.6 MB for 1 year × 285).
 */
export function writeJson(file: string, value: unknown, indent = 2): void {
  fs.writeFileSync(file, `${JSON.stringify(value, null, indent)}\n`, 'utf8');
}

/** Deterministic 32-bit PRNG so the `reject` sample is reproducible per seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
