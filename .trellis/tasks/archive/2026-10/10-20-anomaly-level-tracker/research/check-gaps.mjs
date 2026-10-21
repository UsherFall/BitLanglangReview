import fs from 'node:fs';
const dayOf = (t) => new Date(Number(t)).toISOString().slice(0, 10);
const count = {};
for (const f of fs.readdirSync('.trellis/tasks/10-20-anomaly-level-tracker/research/pool')) {
  const raw = JSON.parse(fs.readFileSync('.trellis/tasks/10-20-anomaly-level-tracker/research/pool/' + f, 'utf8'));
  for (const b of raw) count[dayOf(b[0])] = (count[dayOf(b[0])] ?? 0) + 1;
}
const days = Object.keys(count).sort();
const sparse = days.filter((d) => count[d] < 200);
console.log('总天数', days.length, 'from', days[0], 'to', days.at(-1));
console.log('币数 <200 的日期（疑似交易所缺日）：', sparse.length);
for (const d of sparse) console.log(' ', d, count[d]);
const xmr = JSON.parse(fs.readFileSync('.trellis/tasks/10-20-anomaly-level-tracker/research/pool/XMRUSDT.json', 'utf8'));
console.log('XMR bars', xmr.length, dayOf(xmr[0][0]), '->', dayOf(xmr.at(-1)[0]));
const gaps = [];
for (let i = 1; i < xmr.length; i++) {
  const gap = (xmr[i][0] - xmr[i - 1][0]) / 86400000;
  if (gap > 1) gaps.push(`${dayOf(xmr[i - 1][0])}->${dayOf(xmr[i][0])}`);
}
console.log('XMR 缺日:', gaps.length, gaps.slice(0, 10).join(', '));
