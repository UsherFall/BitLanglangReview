import fs from 'node:fs';
const h = fs.readFileSync('.trellis/tasks/10-19-fakeout-retest-quality/research/annotate.html', 'utf8');
const i = h.indexOf("b.onclick = function(){", h.indexOf("#verdict button"));
const seg = h.slice(i, i + 220);
console.log(JSON.stringify(seg));
console.log('---');
console.log('has CRLF:', seg.includes('\r\n'));
console.log('repr lines:');
for (const line of seg.split(/\r?\n/)) console.log(JSON.stringify(line));
