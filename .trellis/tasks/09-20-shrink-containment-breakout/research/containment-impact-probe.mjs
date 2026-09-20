/**
 * 收敛扫描「包含性闸门」影响探针（只读，不写任何数据库）。
 *
 * 用法（仓库根目录）：
 *   node --experimental-transform-types .trellis/tasks/09-20-shrink-containment-breakout/research/containment-impact-probe.mjs
 *
 * 作用：镜像 `detectConvergence` 的循环，并把"确认区间留出末尾几根K线"参数化，
 * 用真实币安行情对比各口径下的在榜币数、合格(币×周期)数与包含性拒绝次数。
 * `TAIL=0` 即改动前的行为（区间含最新一根，包含性永不触发）。
 *
 * 自包含：通过 data: URL 注册一个扩展名解析钩子，使 Node 能直接 import 仓库里
 * 那些 vite 风格的无扩展名相对导入。不依赖仓库外的任何脚本。
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

const loaderSource = `
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (error) {
    if (specifier.startsWith('.') && !/\\.[a-z]+$/.test(specifier)) {
      return next(specifier + '.ts', context);
    }
    throw error;
  }
}
`;
register(`data:text/javascript,${encodeURIComponent(loaderSource)}`);

const REPO = pathToFileURL('D:/haveFun/BitLanglangReview/').href;
const { defaultStructureParams, detectConvergence, scanTimeframes } = await import(REPO + 'src/domain/coin-scan.ts');
const { BinanceTickerSource } = await import(REPO + 'src/server/binance-tickers.ts');
const { binanceInstrumentMetadata } = await import(REPO + 'src/server/binance-instrument-metadata.ts');
const { isScannable } = await import(REPO + 'src/domain/scan-pool.ts');
const { scanScopeOf } = await import(REPO + 'src/domain/scan-scope.ts');

const BI = { '5m': '5m', '15m': '15m', '1H': '1h', '4H': '4h', '1D': '1d' };
const STEP = { '5m': 3e5, '15m': 9e5, '1H': 36e5, '4H': 144e5, '1D': 864e5 };
const P = defaultStructureParams();
const MIN_SCORE = 0.6;

const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0);
const clamp01 = (v) => Math.min(1, Math.max(0, v));
function edgeDrift(p, startIndex) {
  const n = p.length;
  if (n < 2) return 0;
  let sX = 0, sY = 0, sXY = 0, sXX = 0;
  for (let i = 0; i < n; i += 1) { const x = startIndex + i; sX += x; sY += p[i]; sXY += x * p[i]; sXX += x * x; }
  const d = n * sXX - sX * sX; if (!d) return 0;
  const slope = (n * sXY - sX * sY) / d; const m = sY / n; if (!m) return 0;
  return (Math.abs(slope) * (n - 1)) / m;
}

/** 镜像 detectConvergence，唯一差别是确认区间留出末尾 excludeTail 根。 */
export function detectMirror(s, excludeTail) {
  if (s.length < P.minRun * 2) return { result: null, containRej: 0, containEval: 0 };
  if (s.some((c) => c.low <= 0)) return { result: null, containRej: 0, containEval: 0 };
  const vol = s.map((c) => (c.high - c.low) / c.low);
  const last = s.length - 1;
  const lastPrice = s[last].close;
  let containRej = 0, containEval = 0, best = null;
  for (let start = last - P.minRun + 1; start >= 0; start -= 1) {
    const runLen = last - start + 1;
    if (start - runLen < 0) continue;
    const band = s.slice(start, last + 1);
    const runMed = median(vol.slice(start, last + 1));
    if (Math.max(edgeDrift(band.map((c) => c.low), start), edgeDrift(band.map((c) => c.high), start)) > P.flatRatio * runMed) continue;
    const preMed = median(vol.slice(start - runLen, start));
    if (runMed >= P.convergenceRatio * preMed) continue;
    const confirmed = band.slice(0, band.length - excludeTail);
    if (confirmed.length < 2) continue;
    containEval += 1;
    const rangeLow = Math.min(...confirmed.map((c) => c.low));
    const rangeHigh = Math.max(...confirmed.map((c) => c.high));
    const tolerance = 0.1 * (rangeHigh - rangeLow);
    if (lastPrice < rangeLow - tolerance || lastPrice > rangeHigh + tolerance) { containRej += 1; continue; }
    const score = clamp01(0.7 * clamp01(1 - runMed / preMed) + 0.3 * clamp01(runLen / P.lengthScale));
    if (!best || score > best.score) best = { score, runLen };
  }
  return { result: best, containRej, containEval };
}

export async function buildWindows(concurrency = 5) {
  const tickerSource = new BinanceTickerSource(undefined, binanceInstrumentMetadata());
  const tickers = await tickerSource.listTickers();
  const pool = tickers
    .filter((t) => t.quoteVolume24h >= 10_000_000 && isScannable(t.marketClass) && scanScopeOf(t.marketClass) === 'crypto')
    .slice(0, 60);
  const candles = new Map();
  const jobs = [];
  for (const t of pool) for (const tf of scanTimeframes) jobs.push([t.instrument, tf]);
  let i = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (i < jobs.length) {
      const [sym, tf] = jobs[i]; i += 1;
      const u = new URL('https://fapi.binance.com/fapi/v1/klines');
      u.searchParams.set('symbol', sym);
      u.searchParams.set('interval', BI[tf]);
      u.searchParams.set('limit', '100');
      u.searchParams.set('endTime', String(Date.now() - 1));
      const raw = await (await fetch(u)).json();
      if (!Array.isArray(raw)) continue;
      const step = STEP[tf], anchor = Date.now();
      candles.set(`${sym}:${tf}`, raw
        .map((r) => ({ timestamp: +r[0], open: +r[1], high: +r[2], low: +r[3], close: +r[4] }))
        .filter((c) => c.timestamp + step <= anchor));
    }
  }));
  return { pool, candles };
}

export function summarise(pool, candles, variants) {
  const out = {};
  for (const v of variants) out[v] = { coinsOnList: 0, qualifiedPairs: 0, containRej: 0, containEval: 0, perTf: {} };
  for (const v of variants) for (const tf of scanTimeframes) out[v].perTf[tf] = 0;
  for (const t of pool) {
    const perCoin = {};
    for (const v of variants) perCoin[v] = 0;
    for (const tf of scanTimeframes) {
      const s = candles.get(`${t.instrument}:${tf}`);
      if (!s) continue;
      for (const v of variants) {
        const { result, containRej, containEval } = detectMirror(s, v);
        out[v].containRej += containRej;
        out[v].containEval += containEval;
        if (result && result.score >= MIN_SCORE) { out[v].qualifiedPairs += 1; out[v].perTf[tf] += 1; perCoin[v] += 1; }
      }
    }
    for (const v of variants) if (perCoin[v] > 0) out[v].coinsOnList += 1;
  }
  return out;
}

/**
 * AC4 对照：改动前（mirror excludeTail=0）vs 改动后（真实 detectConvergence）。
 * 同时逐条交叉验证"真实函数"与"mirror excludeTail=1"的决策是否一致 —— 镜像若不忠实，
 * 本次测量就没有意义。
 */
export function compareReal(pool, candles) {
  const out = {
    before: { coinsOnList: 0, qualifiedPairs: 0 },
    after: { coinsOnList: 0, qualifiedPairs: 0 },
    containRej: 0,
    containEval: 0,
    mirrorMismatch: [],
  };
  for (const t of pool) {
    let beforeCoin = 0, afterCoin = 0;
    for (const tf of scanTimeframes) {
      const s = candles.get(`${t.instrument}:${tf}`);
      if (!s) continue;
      const before = detectMirror(s, 0);
      const mirror1 = detectMirror(s, 1);
      const real = detectConvergence(s, P);
      out.containRej += mirror1.containRej;
      out.containEval += mirror1.containEval;
      if ((real === null) !== (mirror1.result === null)) out.mirrorMismatch.push(`${t.instrument}:${tf}`);
      if (before.result && before.result.score >= MIN_SCORE) { out.before.qualifiedPairs += 1; beforeCoin += 1; }
      if (real && real.score >= MIN_SCORE) { out.after.qualifiedPairs += 1; afterCoin += 1; }
    }
    if (beforeCoin > 0) out.before.coinsOnList += 1;
    if (afterCoin > 0) out.after.coinsOnList += 1;
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const VARIANTS = [0, 1, 2, 3];
  const { pool, candles } = await buildWindows();
  const s = summarise(pool, candles, VARIANTS);
  console.log(`样本币数 = ${pool.length} × ${scanTimeframes.length} 周期（窗口 100 根，minScore ${MIN_SCORE}）`);
  console.log('');
  console.log('excludeTail  在榜币数  合格(币×周期)  包含性被评估  包含性拒绝');
  for (const v of VARIANTS) {
    const r = s[v];
    console.log(`${String(v).padEnd(12)} ${String(r.coinsOnList).padEnd(10)} ${String(r.qualifiedPairs).padEnd(14)} ${String(r.containEval).padEnd(13)} ${r.containRej}`);
  }
  console.log('');
  console.log('分周期合格数:');
  console.log('excludeTail  ' + scanTimeframes.map((t) => t.padEnd(5)).join(''));
  for (const v of VARIANTS) {
    console.log(String(v).padEnd(13) + scanTimeframes.map((t) => String(s[v].perTf[t]).padEnd(5)).join(''));
  }

  console.log('');
  console.log('=== AC4：改动前(mirror 0) vs 改动后(真实 detectConvergence) ===');
  const c = compareReal(pool, candles);
  console.log(`在榜币数      改动前 ${c.before.coinsOnList}  →  改动后 ${c.after.coinsOnList}`);
  console.log(`合格(币×周期) 改动前 ${c.before.qualifiedPairs}  →  改动后 ${c.after.qualifiedPairs}`);
  console.log(`包含性被评估 ${c.containEval}  包含性拒绝 ${c.containRej}`);
  console.log(`镜像忠实度：真实函数与 mirror(excludeTail=1) 决策不一致的条目 = ${c.mirrorMismatch.length}${c.mirrorMismatch.length ? ' → ' + c.mirrorMismatch.join(', ') : ' （完全一致）'}`);
}
