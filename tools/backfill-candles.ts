/**
 * 一次性回填 candles 缓存里的洞（11/02，任务 11-02-replay-source-gaps）。
 *
 * 背景：历史翻页取数在缓存里留下了空窗（10/21–10/30 期间旧会话翻页硬编码走
 * Bitget、币安侧只拿到零散窗口等），落在用户会话复盘区间内 → 图表出现「一段
 * K 线空缺」。服务端 `contiguousCandles` 在洞处截断返回窗口、客户端翻页锚点
 * 永远来自已加载边缘，洞夹在中间时无请求会锚定到洞里 —— 洞不会自愈。
 *
 * 本脚本扫描 store 全部 (instrument, timeframe)，对每对相邻蜡烛 gap > 1.5×step
 * 的洞从对应交易所补齐并 upsert。命名空间 → 源：
 *   - `bitget:` 前缀   → Bitget /history-candles（endTime 收盘时刻语义，90/页）
 *   - `-USDT-SWAP` 后缀 → OKX /history-candles（after 往回翻，100/页）
 *   - 裸 `XXXUSDT`     → Binance fapi klines（startTime/endTime，1500/次）；
 *                        Binance 无此标的再试 Bitget；仍空则记日志跳过
 * （见 spec market-data.md 的缓存键命名空间规则 —— 裸键当前属 Binance）。
 *
 * 只写洞区间内的已收盘 bar（closed-bar 不变量与三个正式 source 相同），写库
 * 走 CandlestickStore.save（主键 upsert，重叠无害）。WAL 下可与 dev server 并存。
 *
 * 用法：
 *   npx tsx tools/backfill-candles.ts --dry-run          # 只打印洞清单与补取计划
 *   npx tsx tools/backfill-candles.ts                    # 实跑写库
 *   npx tsx tools/backfill-candles.ts --instrument BTCUSDT
 */

import Database from 'better-sqlite3';
import type { Candlestick } from '../src/domain/candlestick';
import type { ReviewTimeframe } from '../src/domain/trade';
import { CandlestickStore } from '../src/server/candlestick-store';
import { timeframeMs } from '../src/server/candlestick-service';
import { BITGET_KEY_PREFIX } from '../src/server/bitget-candles';
import { defaultBinanceFetchJson, defaultBitgetMarketFetchJson } from '../src/server/http';

/**
 * 一个洞最多补多少根。更宽的「洞」是两段已加载窗口之间从未拉过的历史（跨月/跨年），
 * 硬拉要几百个请求（11/02 实测：全库扫描把 30 万根缺口当洞拉，拖慢且触发 Bitget 429）；
 * 那种区间留给按需加载（initial/earlier）与客户端洞自愈去补。上限 2 万根：币安
 * 11 个请求、OKX/Bitget ≈200-230 页，能覆盖落在用户会话区间内的全部真洞（如
 * BTC 5m 2023-04→05 的 1.5 万根），而跨年区间（4 万根以上）仍跳过。
 */
const MAX_GAP_BARS = 20000;

type Gap = { from: number; to: number };

/** 一根已收盘判断（1M 用自然月收线，与 bitget-candles 的 barCloseTime 同规则）。 */
function isClosedBar(timestamp: number, timeframe: ReviewTimeframe): boolean {
  if (timeframe !== '1M') return timestamp + timeframeMs(timeframe) <= Date.now();
  const beijing = new Date(timestamp + 8 * 60 * 60_000);
  return Date.UTC(beijing.getUTCFullYear(), beijing.getUTCMonth() + 1, 1) - 8 * 60 * 60_000 <= Date.now();
}

/** 扫描已排序蜡烛的洞：相邻 gap > 1.5×step 即缺段（与 contiguousCandles 同口径）。 */
export function scanGaps(timestamps: number[], timeframe: ReviewTimeframe): Gap[] {
  const step = timeframeMs(timeframe);
  const gaps: Gap[] = [];
  for (let i = 1; i < timestamps.length; i += 1) {
    if (timestamps[i] - timestamps[i - 1] > step * 1.5) {
      gaps.push({ from: timestamps[i - 1], to: timestamps[i] });
    }
  }
  return gaps;
}

type FetchPage = (url: string) => Promise<unknown>;

/**
 * Binance 一段 [from, to] 的 klines（循环 1500/次）。返回按时间升序。
 *
 * `storeInstrument` 是蜡烛行的存储键（即 CandlestickStore 的 instrument 字段），
 * `symbol` 是交易所原生符号 —— 两者在裸键场景一致，在命名空间键（`bitget:`）
 * 场景不同：写库必须用带前缀的存储键，否则污染裸键命名空间（Binance 缓存）。
 */
export async function fetchBinanceRange(fetchPage: FetchPage, storeInstrument: string, symbol: string, timeframe: ReviewTimeframe, from: number, to: number): Promise<Candlestick[]> {
  const out: Candlestick[] = [];
  let cursor = from;
  for (let page = 0; page < 200 && cursor < to; page += 1) {
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${toBinanceInterval(timeframe)}&startTime=${cursor}&endTime=${to}&limit=1500`;
    const rows = (await fetchPage(url)) as unknown[];
    if (!Array.isArray(rows) || !rows.length) break;
    for (const row of rows as [string, string, string, string, string, string, string][]) {
      const timestamp = Number(row[0]);
      if (timestamp <= from || timestamp >= to || !isClosedBar(timestamp, timeframe)) continue;
      out.push({ instrument: storeInstrument, timeframe, timestamp, open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]), volume: Number(row[5] ?? 0) });
    }
    const last = Number((rows[rows.length - 1] as unknown[])[0]);
    if (last <= cursor) break;
    cursor = last + 1;
  }
  return out;
}

/** OKX 洞段补取：after 从洞右端往回翻（100/页），直到越过左端。返回升序。 */
export async function fetchOkxRange(fetchPage: FetchPage, storeInstrument: string, instId: string, timeframe: ReviewTimeframe, from: number, to: number): Promise<Candlestick[]> {
  const out: Candlestick[] = [];
  let after = to;
  for (let page = 0; page < 200; page += 1) {
    const url = `https://www.okx.com/api/v5/market/history-candles?instId=${instId}&bar=${timeframe}&after=${after}&limit=100`;
    const payload = (await fetchPage(url)) as { data?: string[][] };
    const rows = payload?.data ?? [];
    if (!rows.length) break;
    for (const row of rows) {
      const timestamp = Number(row[0]);
      if (timestamp <= from || timestamp >= to || row[8] === '0') continue;
      out.push({ instrument: storeInstrument, timeframe, timestamp, open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]), volume: Number(row[5] ?? 0) });
    }
    // 游标取页内最旧一根，与返回顺序无关（OKX 实测新→旧）。
    const oldest = Math.min(...rows.map((row) => Number(row[0])));
    if (oldest <= from) break;
    if (oldest >= after) break; // 不再前进，防死循环
    after = oldest;
  }
  return out;
}

/** Bitget 洞段补取：endTime（收盘时刻，含等于）从洞右端往左翻（90/页）。返回升序。 */
export async function fetchBitgetRange(fetchPage: FetchPage, storeInstrument: string, symbol: string, timeframe: ReviewTimeframe, from: number, to: number): Promise<Candlestick[]> {
  const out: Candlestick[] = [];
  let endTime = to;
  for (let page = 0; page < 200; page += 1) {
    const url = `https://api.bitget.com/api/v2/mix/market/history-candles?productType=USDT-FUTURES&symbol=${symbol}&granularity=${timeframe}&endTime=${endTime}&limit=90`;
    const payload = (await fetchPage(url)) as { code?: unknown; data?: string[][] };
    if (payload?.code !== undefined && payload.code !== '00000') throw new Error(`Bitget 行情错误 code=${String(payload.code)}`);
    const rows = payload?.data ?? [];
    if (!rows.length) break;
    for (const row of rows) {
      const timestamp = Number(row[0]);
      if (timestamp <= from || timestamp >= to || !isClosedBar(timestamp, timeframe)) continue;
      out.push({ instrument: storeInstrument, timeframe, timestamp, open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]), volume: Number(row[5] ?? 0) });
    }
    // 游标取页内最旧一根，与返回顺序无关（Bitget 实测旧→新）。曾取 rows[last]
    //（升序时=最新）导致每页只前进 1 根，全部洞跑到 200 页上限，一个洞要 9 分钟。
    const oldest = Math.min(...rows.map((row) => Number(row[0])));
    if (oldest <= from) break;
    if (oldest >= endTime) break; // 不再前进，防死循环
    endTime = oldest;
  }
  return out;
}

/** 命名空间 → 该洞从哪个所补。裸键属 Binance（当前唯一写裸键的正式源）。 */
function venueOf(storeInstrument: string): 'binance' | 'okx' | 'bitget' {
  if (storeInstrument.startsWith(BITGET_KEY_PREFIX)) return 'bitget';
  if (storeInstrument.endsWith('-USDT-SWAP')) return 'okx';
  return 'binance';
}

/** 去掉命名空间前缀后的「该所原生符号」。 */
function nativeSymbol(storeInstrument: string): string {
  return storeInstrument.startsWith(BITGET_KEY_PREFIX) ? storeInstrument.slice(BITGET_KEY_PREFIX.length) : storeInstrument;
}

export type BackfillOptions = {
  dbPath: string;
  dryRun?: boolean;
  instrument?: string;
  /** 注入的取数器（测试用）；缺省用全局 fetch。 */
  fetchPage?: FetchPage;
  /** 写库器（测试用）；缺省用 CandlestickStore。 */
  save?: (candles: Candlestick[]) => void;
  log?: (message: string) => void;
};

export async function backfillCandles(options: BackfillOptions): Promise<{ gaps: number; filled: number; skipped: number }> {
  const log = options.log ?? ((message: string) => console.log(message));
  // 限速取数器：复用正式源的限速/重试（币安 weight 监控 + Bitget 市场限速）——
  // 11/02 全库 dry-run 实测裸 fetch 会把 Bitget 打到 429。
  const fetchPage = options.fetchPage ?? ((url: string) => {
    if (url.includes('api.bitget.com')) return defaultBitgetMarketFetchJson(url);
    if (url.includes('fapi.binance.com')) return defaultBinanceFetchJson(url);
    return fetch(url).then((response) => response.json());
  });
  const store = options.save ? null : new CandlestickStore(options.dbPath);
  const save = options.save ?? ((candles: Candlestick[]) => store!.save(candles));
  const db = new Database(options.dbPath, { readonly: true });
  const rows = db.prepare(
    `select instrument, timeframe, timestamp from candles ${options.instrument ? 'where instrument = @instrument' : ''} order by instrument, timeframe, timestamp`,
  ).all(options.instrument ? { instrument: options.instrument } : {}) as Array<{ instrument: string; timeframe: ReviewTimeframe; timestamp: number }>;
  db.close();

  let gaps = 0;
  let filled = 0;
  let skipped = 0;
  // 分组游标：instrument 自带 `bitget:` 前缀冒号，不能拼 key 再 split，分开存。
  let currentInstrument = '';
  let currentTimeframe: ReviewTimeframe | null = null;
  let timestamps: number[] = [];
  const flush = async (instrument: string, timeframe: ReviewTimeframe) => {
    if (!instrument || !timeframe || !timestamps.length) return;
    for (const gap of scanGaps(timestamps, timeframe)) {
      gaps += 1;
      const venue = venueOf(instrument);
      const symbol = nativeSymbol(instrument);
      const step = timeframeMs(timeframe);
      const missingBars = Math.round((gap.to - gap.from) / step) - 1;
      // 宽洞（从未加载的历史区间）不拉：几百个请求拖慢且触发限速，留给按需加载。
      if (missingBars > MAX_GAP_BARS) {
        skipped += 1;
        log(`[跳过] ${instrument} ${timeframe} 洞 ${new Date(gap.from).toISOString()} → ${new Date(gap.to).toISOString()}（缺约 ${missingBars} 根，超 ${MAX_GAP_BARS} 上限，属未加载历史区间）`);
        continue;
      }
      try {
        let candles: Candlestick[] = [];
        // 蜡烛行写存储键（命名空间键带前缀）；交易所请求用原生符号。裸键只从
        // Binance 补 —— 不回退 Bitget，避免把另一个所的数据写进裸键命名空间。
        if (venue === 'binance') {
          candles = await fetchBinanceRange(fetchPage, instrument, symbol, timeframe, gap.from, gap.to);
        } else if (venue === 'okx') {
          candles = await fetchOkxRange(fetchPage, instrument, symbol, timeframe, gap.from, gap.to);
        } else {
          candles = await fetchBitgetRange(fetchPage, instrument, symbol, timeframe, gap.from, gap.to);
        }
        if (!candles.length) {
          skipped += 1;
          log(`[跳过] ${instrument} ${timeframe} 洞 ${new Date(gap.from).toISOString()} → ${new Date(gap.to).toISOString()}（缺约 ${missingBars} 根）：交易所无此段数据`);
          continue;
        }
        if (options.dryRun) {
          log(`[dry-run] ${instrument} ${timeframe} 洞 ${new Date(gap.from).toISOString()} → ${new Date(gap.to).toISOString()}：将补 ${candles.length} 根`);
        } else {
          save(candles);
          log(`[回填] ${instrument} ${timeframe} 洞 ${new Date(gap.from).toISOString()} → ${new Date(gap.to).toISOString()}：补 ${candles.length} 根`);
        }
        filled += 1;
      } catch (error) {
        skipped += 1;
        log(`[失败] ${instrument} ${timeframe} 洞 ${new Date(gap.from).toISOString()} → ${new Date(gap.to).toISOString()}：${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };
  for (const row of rows) {
    if (row.instrument !== currentInstrument || row.timeframe !== currentTimeframe) {
      void await flush(currentInstrument, currentTimeframe as ReviewTimeframe);
      currentInstrument = row.instrument;
      currentTimeframe = row.timeframe;
      timestamps = [];
    }
    timestamps.push(row.timestamp);
  }
  void await flush(currentInstrument, currentTimeframe as ReviewTimeframe);
  store?.close();
  return { gaps, filled, skipped };
}

function toBinanceInterval(timeframe: ReviewTimeframe): string {
  const map: Record<ReviewTimeframe, string> = { '1m': '1m', '5m': '5m', '15m': '15m', '1H': '1h', '4H': '4h', '1D': '1d', '1W': '1w', '1M': '1M' };
  return map[timeframe];
}

if (process.argv[1]?.endsWith('backfill-candles.ts')) {
  const dryRun = process.argv.includes('--dry-run');
  const instrument = process.argv.includes('--instrument') ? process.argv[process.argv.indexOf('--instrument') + 1] : undefined;
  const dbPath = process.argv.includes('--db') ? process.argv[process.argv.indexOf('--db') + 1] : 'data/review.sqlite';
  backfillCandles({ dbPath, dryRun, instrument })
    .then(({ gaps, filled, skipped }) => {
      console.log(`完成：发现 ${gaps} 个洞，补 ${filled} 个，跳过/失败 ${skipped} 个。`);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
