import fs from 'node:fs';
const p = '.trellis/tasks/10-20-anomaly-level-tracker/research/out/annotate-today.html';
let h = fs.readFileSync(p, 'utf8');
const before = "tickMarkFormatter:function(t){ return String(t).slice(0,10); }";
const after =
  "tickMarkFormatter:function(t){ var n=Number(t); return new Date((n<1e12?n*1000:n)).toISOString().slice(5,10); }";
if (!h.includes(before)) {
  console.log('NOT FOUND');
  process.exit(1);
}
h = h.replace(before, after);
fs.writeFileSync(p, h);
console.log('patched');
