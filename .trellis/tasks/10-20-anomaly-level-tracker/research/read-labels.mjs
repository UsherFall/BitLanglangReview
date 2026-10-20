/**
 * 读用户 10/20 的实际标注，把"会做 / 不好"两边拆开看。
 * 这版是唯一的真值：9 个标了段（8 good + 1 structure），8 个没标（= 觉得不好）。
 *
 * 输出每张卡的：备注、段、线、以及我们粗筛算出的量（涨幅/回到几成/离顶/顶后）。
 *
 * Run: node .trellis/tasks/10-20-anomaly-level-tracker/research/read-labels.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = '.trellis/tasks/10-20-anomaly-level-tracker/research';
const labels = JSON.parse(fs.readFileSync(path.join(DIR, 'draw', 'labels.json'), 'utf8'));
const list = JSON.parse(fs.readFileSync(path.join(DIR, 'out', 'bottom-list.json'), 'utf8'));
const byInst = new Map(list.map((r) => [r.inst, r]));

const verdictName = { good: '会做', structure: '结构不行', chart: '股性不行', missed: '错过了' };

const good = [];
const bad = [];
for (const c of labels) {
  const short = c.inst.replace(/USDT$/, '');
  const q = byInst.get(short) ?? {};
  const segs = c.segments ?? [];
  const rec = {
    inst: short,
    note: (c.note || '').trim(),
    nSeg: segs.length,
    verdict: segs[0]?.verdict ?? null,
    regions: segs.map((s) => s.region.join('~')),
    linesH: segs.flatMap((s) => (s.lines ?? []).filter((l) => l.kind === 'h').map((l) => l.price)),
    linesR: segs.flatMap((s) => (s.lines ?? []).filter((l) => l.kind === 'r').length),
    gain: q.gain,
    fromBase: q.fromBase,
    fromPeak: q.fromPeak,
    holdDays: q.holdDays,
  };
  (segs.length ? good : bad).push(rec);
}

console.log(`=== 标的 ${good.length} 个 ===`);
for (const r of good) {
  console.log(`\n${r.inst}  [${verdictName[r.verdict] ?? r.verdict}]  涨幅${r.gain}% 回到${r.fromBase}% 离顶${r.fromPeak}% 顶后${r.holdDays}天`);
  console.log(`  段：${r.regions.join(' | ')}`);
  console.log(`  线：水平 ${r.linesH.length} 条${r.linesH.length ? '（' + r.linesH.map((p) => p.toPrecision(6)).join(', ') + '）' : ''}${r.linesR ? ` · 射线 ${r.linesR} 条` : ''}`);
  if (r.note) console.log(`  备注：${r.note}`);
}

console.log(`\n=== 没标的 ${bad.length} 个（= 觉得不好，原因没录） ===`);
for (const r of bad) {
  console.log(`\n${r.inst}  涨幅${r.gain}% 回到${r.fromBase}% 离顶${r.fromPeak}% 顶后${r.holdDays}天${r.note ? '  备注：' + r.note : ''}`);
}

// 两边的量对比
const med = (xs) => { const v = xs.filter(Number.isFinite).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : NaN; };
console.log('\n=== 两边对比（中位） ===');
console.log(`${'量'.padEnd(14)}${'会做'.padStart(10)}${'没标/不好'.padStart(12)}`);
for (const k of ['gain', 'fromBase', 'fromPeak', 'holdDays']) {
  console.log(`${k.padEnd(14)}${String(med(good.map((x) => x[k]))).padStart(10)}${String(med(bad.map((x) => x[k]))).padStart(12)}`);
}

fs.writeFileSync(path.join(DIR, 'out', 'labels-summary.json'), JSON.stringify({ good, bad }, null, 1));
