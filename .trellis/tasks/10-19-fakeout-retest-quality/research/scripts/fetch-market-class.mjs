/**
 * 拉一次 Bitget 合约元数据，按 isRwa 把币分成「加密」与「股票/其他 RWA」。
 * 与 src/server/bitget-instrument-metadata.ts 用的是同一个字段（isRwa），
 * 只是这里落成文件，给离线研究脚本用。
 *
 * Run: node .scratch/research-10-19\fetch-market-class.mjs
 */
import fs from 'node:fs';

const url = 'https://api.bitget.com/api/v2/mix/market/contracts?productType=USDT-FUTURES';
const res = await fetch(url);
const json = await res.json();
const list = json.data ?? [];
const crypto = [];
const rwa = [];
for (const c of list) {
  if (typeof c.symbol !== 'string') continue;
  const isRwa = String(c.isRwa ?? '').toUpperCase() === 'YES';
  (isRwa ? rwa : crypto).push(c.symbol);
}
console.log(`合约 ${list.length}：加密 ${crypto.length}，RWA（股票/商品等）${rwa.length}`);
console.log('RWA 示例：', rwa.slice(0, 12).join(', '));
fs.writeFileSync(
  '.scratch/research-10-19/market-class.json',
  JSON.stringify({ crypto, rwa }, null, 0),
);
