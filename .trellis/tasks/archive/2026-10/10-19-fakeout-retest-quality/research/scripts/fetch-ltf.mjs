/**
 * 拉 4H 与 1H 数据，供"结构破坏"检测用。
 *
 * 用户 10/20：转折点的粒度要在 4H 或 1H 上找，日线太大。
 * Bitget 分页规则（见 .trellis/spec/server/market-data.md 的 TRAP 条）：
 *   第 1 页 /candles?endTime=now
 *   第 2 页起 /history-candles?endTime=oldest（用 oldest 而不是 oldest-1，保持连续）
 *
 * Run: node .scratch/research-10-19\fetch-ltf.mjs --tf=4H --bars=1000
 */
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? 'true'];
}));
const TF = args.tf ?? '4H';
const WANT = Number(args.bars ?? 1000);
const OUT = args.out ?? `.scratch/research-10-19/ltf-${TF.toLowerCase()}`;
fs.mkdirSync(OUT, { recursive: true });

const cls = JSON.parse(fs.readFileSync('.scratch/research-10-19/market-class.json', 'utf8'));
const symbols = cls.crypto;
const todo = symbols.filter((s) => !fs.existsSync(path.join(OUT, `${s}.json`)));
console.log(`TF=${TF} 目标 ${WANT} 根；加密 ${symbols.length} 个，待拉 ${todo.length}`);

let done = 0;
const failed = [];
for (const symbol of todo) {
  try {
    const bars = [];
    let end = Date.now();
    let endpoint = 'candles';
    for (let page = 0; page < 10 && bars.length < WANT; page++) {
      const url = `https://api.bitget.com/api/v2/mix/market/${endpoint}?symbol=${symbol}&granularity=${TF}&productType=usdt-futures&limit=200&endTime=${end}`;
      const j = await (await fetch(url)).json();
      const d = j.data ?? [];
      if (!d.length) break;
      for (const x of d) bars.push(x.map(Number));
      const oldest = Math.min(...d.map((x) => Number(x[0])));
      if (oldest === end) break;
      end = oldest;
      endpoint = 'history-candles';
      if (d.length < 200) break;
    }
    if (bars.length < 200) { failed.push(`${symbol}(${bars.length})`); continue; }
    bars.sort((a, b) => a[0] - b[0]);
    fs.writeFileSync(path.join(OUT, `${symbol}.json`), JSON.stringify(bars.map((x) => x.slice(0, 5))));
    done++;
    if (done % 50 === 0) console.log(`  ${done} …`);
  } catch {
    failed.push(symbol);
  }
  await new Promise((r) => setTimeout(r, 80));
}
console.log(`完成 ${done}，失败 ${failed.length}${failed.length ? '：' + failed.slice(0, 8).join(', ') : ''}`);
