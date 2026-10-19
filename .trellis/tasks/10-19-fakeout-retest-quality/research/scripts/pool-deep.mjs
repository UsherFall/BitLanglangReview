/**
 * Fetch ~1 year of daily candles per symbol with CORRECT pagination:
 *   page 1  /candles?endTime=now            (returns the bar containing endTime)
 *   page 2+ /history-candles?endTime=oldest (returns only bars closed by it;
 *           using `oldest` (not oldest-1) keeps the series contiguous)
 *
 *   node .scratch/pool-deep.mjs --only=30
 */
import fs from 'node:fs';

const OUT = '.scratch/pool-deep';
fs.mkdirSync(OUT, { recursive: true });
const only = Number(process.argv.find((a) => a.startsWith('--only='))?.slice(7) ?? Infinity);

const res = await fetch('https://api.bitget.com/api/v2/mix/market/tickers?productType=usdt-futures');
const symbols = ((await res.json()).data ?? []).map((t) => t.symbol).filter((s) => s.endsWith('USDT')).sort();
const todo = symbols.slice(0, Number.isFinite(only) ? only : symbols.length).filter((s) => !fs.existsSync(`${OUT}/${s}.json`));
console.log(`symbols ${symbols.length}, to fetch ${todo.length}`);

let done = 0;
const failures = [];
for (const symbol of todo) {
  try {
    const bars = [];
    let end = Date.now();
    let endpoint = 'candles';
    for (let page = 0; page < 8 && bars.length < 380; page++) {
      const url = `https://api.bitget.com/api/v2/mix/market/${endpoint}?symbol=${symbol}&granularity=1D&productType=usdt-futures&limit=200&endTime=${end}`;
      const j = await (await fetch(url)).json();
      const d = j.data ?? [];
      if (!d.length) break;
      for (const x of d) bars.push(x.map(Number));
      const oldest = Math.min(...d.map((x) => Number(x[0])));
      if (oldest === end) break; // no progress
      end = oldest;
      endpoint = 'history-candles';
      if (d.length < 90) break;
    }
    if (bars.length < 100) { failures.push(`${symbol}(${bars.length})`); continue; }
    bars.sort((a, b) => a[0] - b[0]);
    fs.writeFileSync(`${OUT}/${symbol}.json`, JSON.stringify(bars.map((x) => x.slice(0, 5))));
    done++;
    if (done % 20 === 0) console.log(`fetched ${done}…`);
  } catch (e) {
    failures.push(symbol);
  }
  await new Promise((r) => setTimeout(r, 150));
}
console.log(`done fetched ${done}, failed ${failures.length}`, failures.slice(0, 10).join(', '));
