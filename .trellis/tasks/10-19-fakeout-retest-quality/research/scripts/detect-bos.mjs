/**
 * 下跌结构破坏检测（4H/1H 级别）。
 *
 * 用户 10/20 定的分工：
 *   · 算法只负责提醒「这个结构已经被破坏了」，入场细节用户自己操作
 *   · 只提醒一种：**下跌结构被破坏**（转多信号）
 *   · 每天最多 20 个
 *   · 转折点在 4H / 1H 上找，日线太大
 *
 * 方法（ICT / SMC 的 BOS 思路，但阈值用相对量）：
 *   ① ZigZag：价格从最近转折点回撤超过 N × ATR 才算一个转折点
 *   ② 下跌结构：最近的转折点是「高点越来越低 + 低点越来越低」
 *   ③ 结构破坏：收盘价突破最近一个「更低的高点」→ 当天就是破坏日
 *   ④ 输出：币、破坏时间、该高点价位、突破幅度
 *
 * N 用相对量（ATR 倍数），不写死价格百分比。
 *
 * Run: LTF_DIR=<4h目录> node .scratch/research-10-19/detect-bos.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = process.env.LTF_DIR ?? '.scratch/research-10-19/ltf-4h';
const N_ATR = Number(process.env.N_ATR ?? 1.5); // 回撤多少个 ATR 算一个转折点
const MAX_PER_DAY = Number(process.env.MAX_PER_DAY ?? 20);
const STEP_MS = 4 * 3_600_000; // 4H

const dayOf = (t) => new Date(t).toISOString().slice(0, 10);

if (!fs.existsSync(DIR)) {
  console.error(`缺少 ${DIR}，先跑 fetch-ltf.mjs`);
  process.exit(2);
}

function atr(bars, i, n = 14) {
  let s = 0, k = 0;
  for (let j = Math.max(1, i - n + 1); j <= i; j++) {
    const tr = Math.max(bars[j].h - bars[j].l, Math.abs(bars[j].h - bars[j - 1].c), Math.abs(bars[j].l - bars[j - 1].c));
    s += tr; k++;
  }
  return k ? s / k : bars[i].h - bars[i].l;
}

/**
 * ZigZag：返回转折点数组 [{ i, price, kind: 'high'|'low' }]。
 * 规则：从当前极值回撤超过 N×ATR 才确认一个转折。
 */
function zigzag(bars, N) {
  const pts = [];
  if (bars.length < 30) return pts;
  let dir = 0; // 1 = 在找高点, -1 = 在找低点
  let ext = { i: 0, price: bars[0].h };
  let extLow = { i: 0, price: bars[0].l };
  // 初始化方向：先看前 20 根往哪走
  const first = bars.slice(0, 20);
  const hiI = first.reduce((a, b, k) => (b.h > first[a].h ? k : a), 0);
  const loI = first.reduce((a, b, k) => (b.l < first[a].l ? k : a), 0);
  dir = hiI > loI ? 1 : -1;
  ext = dir === 1 ? { i: hiI, price: bars[hiI].h } : { i: loI, price: bars[loI].l };
  extLow = dir === 1 ? { i: loI, price: bars[loI].l } : { i: hiI, price: bars[hiI].h };

  for (let i = 21; i < bars.length; i++) {
    const a = atr(bars, i) * N;
    if (dir === 1) {
      if (bars[i].h > ext.price) ext = { i, price: bars[i].h };
      else if (bars[i].l < ext.price - a) {
        pts.push({ i: ext.i, price: ext.price, kind: 'high' });
        dir = -1;
        ext = { i, price: bars[i].l };
      }
    } else {
      if (bars[i].l < ext.price) ext = { i, price: bars[i].l };
      else if (bars[i].h > ext.price + a) {
        pts.push({ i: ext.i, price: ext.price, kind: 'low' });
        dir = 1;
        ext = { i, price: bars[i].h };
      }
    }
  }
  pts.push({ i: ext.i, price: ext.price, kind: dir === 1 ? 'high' : 'low' });
  return pts;
}

/**
 * 扫描一个币的每根 K 线，找「下跌结构被破坏」。
 * 下跌结构 = 最近的高点一个比一个低（LH），且低点一个比一个低（LL）。
 * 破坏 = 某根收盘价 > 最近那个 LH 的高点，且此前结构确实是下跌。
 */
function detectBOS(bars) {
  const pts = zigzag(bars, N_ATR);
  const out = [];
  // 对每个时刻 i，取它之前最近的转折点
  let pi = 0;
  let lastHighs = [];
  let lastLows = [];
  for (let i = 0; i < bars.length; i++) {
    while (pi < pts.length && pts[pi].i < i) {
      const p = pts[pi];
      if (p.kind === 'high') lastHighs.push(p);
      else lastLows.push(p);
      pi++;
    }
    if (lastHighs.length < 2 || lastLows.length < 2) continue;
    const h1 = lastHighs[lastHighs.length - 1];
    const h2 = lastHighs[lastHighs.length - 2];
    const l1 = lastLows[lastLows.length - 1];
    const l2 = lastLows[lastLows.length - 2];
    // 下跌结构：高点越来越低 + 低点越来越低
    const downtrend = h1.price < h2.price && l1.price < l2.price;
    if (!downtrend) continue;
    // 破坏：收盘突破最近的高点 h1；且前一根还没破（抓"刚破坏"那一下）
    const c = bars[i].c;
    const prev = i > 0 ? bars[i - 1].c : c;
    if (c > h1.price && prev <= h1.price) {
      out.push({
        i,
        t: bars[i].t,
        day: dayOf(bars[i].t),
        brokenLevel: h1.price,
        close: c,
        levelAt: dayOf(bars[h1.i].t),
        lastLow: l1.price,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- 跑全池
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json'));
console.log(`TF=${path.basename(DIR)}，N=${N_ATR}×ATR，币 ${files.length}`);

const all = [];
for (const f of files) {
  const inst = f.replace(/\.json$/, '');
  let raw;
  try { raw = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch { continue; }
  if (!Array.isArray(raw) || raw.length < 250) continue;
  const bars = raw.map(([t, o, h, l, c]) => ({ t, o, h, l, c }));
  for (const e of detectBOS(bars)) all.push({ inst: inst.replace(/USDT$/, ''), ...e });
}

// 按天统计（只看最近 90 天）
const days = [...new Set(all.map((x) => x.day))].sort().slice(-90);
const byDay = new Map(days.map((d) => [d, []]));
for (const x of all) if (byDay.has(x.day)) byDay.get(x.day).push(x);

const counts = [...byDay.values()].map((l) => l.length).sort((a, b) => a - b);
console.log(`\n最近 ${days.length} 天：每天中位 ${counts[Math.floor(counts.length / 2)]}，p75 ${counts[Math.floor(counts.length * 0.75)]}，最多 ${counts[counts.length - 1]}`);
console.log('\n最近 10 天：');
for (const d of days.slice(-10)) {
  const l = byDay.get(d);
  console.log(`  ${d}  ${String(l.length).padStart(3)}  ${l.slice(0, 10).map((x) => `${x.inst}@${new Date(x.t).toISOString().slice(11, 16)}`).join(', ')}`);
}

// 昨天以后的完整名单（最多 20 个，按突破幅度排）
const lastDay = days[days.length - 1];
const list = [...byDay.get(lastDay)].sort((a, b) => (b.close / b.brokenLevel - 1) - (a.close / a.brokenLevel - 1)).slice(0, MAX_PER_DAY);
console.log(`\n${lastDay} 的提醒名单（最多 ${MAX_PER_DAY} 个，按突破幅度）：`);
console.log(`${'币'.padEnd(12)}${'时间'.padEnd(8)}${'被突破的高点'.padStart(13)}${'高点日期'.padStart(12)}${'突破幅度'.padStart(10)}`);
for (const x of list) {
  console.log(`${x.inst.padEnd(12)}${new Date(x.t).toISOString().slice(11, 16).padEnd(8)}${x.brokenLevel.toPrecision(6).padStart(13)}${x.levelAt.padStart(12)}${(((x.close / x.brokenLevel) - 1) * 100).toFixed(1).padStart(9)}%`);
}

fs.writeFileSync('.scratch/research-10-19/bos-detections.json', JSON.stringify(all, null, 0));
