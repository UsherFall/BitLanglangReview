import { chromium } from 'file:///C:/Users/Fuzz/AppData/Roaming/npm/node_modules/playwright/index.mjs';

const url = 'file:///E:/vibe/bl-review/.trellis/tasks/10-20-anomaly-level-tracker/research/out/annotate-today.html';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1600, height: 980 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e).slice(0, 180)));
await p.goto(url);
await p.waitForTimeout(1000);

// 手动给当前卡塞一条水平线（模拟画线），看状态框是否更新
const r = await p.evaluate(() => {
  const s = st();
  s.segments = [{ region: ['2026-10-01', '2026-10-19'], source: 'edited', verdict: 'good', lines: [{ kind: 'h', price: 81909.3 }] }];
  segSel = 0;
  save();
  renderDrawn();
  renderList();
  if (window.__syncDist) window.__syncDist();
  return (document.getElementById('dist-box') || {}).innerText;
});
console.log('after inject line:', JSON.stringify(r));
console.log('errs', errs.length, errs.join('|'));

await p.screenshot({ path: 'E:/vibe/bl-review/.trellis/tasks/10-20-anomaly-level-tracker/research/out/ac8-preview.png', clip: { x: 1230, y: 0, width: 370, height: 980 } });
await b.close();
