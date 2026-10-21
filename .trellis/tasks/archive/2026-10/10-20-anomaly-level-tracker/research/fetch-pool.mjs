/**
 * 拉一份 1D 日线池（加密，isRwa=NO），口径与上一轮研究一致：
 *   - Bitget USDT-FUTURES，granularity=1D（北京 8:00 开盘 = UTC 00:00）
 *   - 日期 = new Date(t).toISOString().slice(0, 10)
 *   - 剔除 isRwa=YES（股票/ETF/RWA）
 *
 * 输出：
 *   research/pool/<INST>.json   [[t, o, h, l, c], ...]  按时间升序
 *   research/pool-class.json    { crypto: [...], rwa: [...] }
 *
 * Run: node .trellis/tasks/10-20-anomaly-level-tracker/research/fetch-pool.mjs
 *      环境变量 POOL_LIMIT 可只拉前 N 个（调试用）
 */
import fs from 'node:fs';
import path from 'node:path';

const OUT = '.trellis/tasks/10-20-anomaly-level-tracker/research';
const POOL = path.join(OUT, 'pool');
const BARS = Number(process.env.BARS ?? 200);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 6);
fs.mkdirSync(POOL, { recursive: true });

const dayOf = (t) => new Date(Number(t)).toISOString().slice(0, 10);

async function getJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.code !== '00000') throw new Error(`code ${json.code} ${json.msg ?? ''}`);
      return json.data;
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
}

const contracts = await getJson('https://api.bitget.com/api/v2/mix/market/contracts?productType=USDT-FUTURES');
const crypto = [];
const rwa = [];
for (const c of contracts) {
  if (typeof c.symbol !== 'string') continue;
  (String(c.isRwa ?? '').toUpperCase() === 'YES' ? rwa : crypto).push(c.symbol);
}
fs.writeFileSync(path.join(OUT, 'pool-class.json'), JSON.stringify({ crypto, rwa }, null, 0));
console.log(`合约 ${contracts.length}：加密 ${crypto.length}，RWA ${rwa.length}`);

const targets = crypto.slice(0, Number(process.env.POOL_LIMIT ?? crypto.length));
const endTs = Date.now();
const end = Math.floor(endTs / 86_400_000) * 86_400_000; // 当前 UTC 日 0 点（未收盘那根）

let done = 0;
let failed = 0;
const stale = [];

async function one(inst) {
  try {
    // Bitget 单次最多 1000 根；从当前日往回翻页拿够 BARS 根
    const rows = new Map();
    let cursor = end;
    while (rows.size < BARS && cursor > endTs - (BARS + 30) * 86_400_000) {
      // API 限制：startTime..endTime 不超过 90 天，单次最多 100 根
      const start = Math.max(cursor - 89 * 86_400_000, endTs - (BARS + 30) * 86_400_000);
      const data = await getJson(
        `https://api.bitget.com/api/v2/mix/market/candles?symbol=${inst}&productType=USDT-FUTURES&granularity=1D&startTime=${start}&endTime=${cursor}&limit=100`,
      );
      if (!data?.length) break;
      for (const b of data) rows.set(Number(b[0]), [Number(b[0]), b[1], b[2], b[3], b[4], b[5]]);
      const first = Math.min(...data.map((b) => Number(b[0])));
      if (first >= cursor) break;
      cursor = first - 86_400_000;
    }
    const arr = [...rows.values()].sort((a, b) => a[0] - b[0]).slice(-BARS);
    if (arr.length < 120) throw new Error(`只有 ${arr.length} 根`);
    fs.writeFileSync(path.join(POOL, `${inst}.json`), JSON.stringify(arr));
    const lastDay = dayOf(arr.at(-1)[0]);
    if (lastDay < dayOf(endTs - 2 * 86_400_000)) stale.push(`${inst}@${lastDay}`);
  } catch (e) {
    failed++;
    if (process.env.VERBOSE) console.log(`  ✗ ${inst}: ${e.message}`);
  }
  done++;
  if (done % 50 === 0) console.log(`  ${done}/${targets.length}`);
}

for (let i = 0; i < targets.length; i += CONCURRENCY) {
  await Promise.all(targets.slice(i, i + CONCURRENCY).map(one));
}

console.log(`完成：成功 ${done - failed}，失败 ${failed}`);
console.log(`最新日期：${dayOf(endTs)}（UTC 今日，未收盘那根也保留）`);
if (stale.length) console.log(`数据偏旧（最后 < 2 天前）：${stale.length} 个 ${stale.slice(0, 20).join(', ')}`);
