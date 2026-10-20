import { chromium } from 'file:///C:/Users/Fuzz/AppData/Roaming/npm/node_modules/playwright/index.mjs';

const url = 'file:///E:/vibe/bl-review/.trellis/tasks/10-20-anomaly-level-tracker/research/out/annotate-today.html';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1600, height: 950 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e).slice(0, 180)));
await p.goto(url);
await p.waitForTimeout(800);

// 不画段，直接点「股性不行」
await p.click('#verdict button[data-v="chart"]');
await p.waitForTimeout(400);
console.log('verdict w/o seg:', JSON.stringify(await p.evaluate(() => st().segments.map((g) => ({ region: g.region, verdict: g.verdict })))));

// 再点一次应取消
await p.click('#verdict button[data-v="chart"]');
await p.waitForTimeout(300);
console.log('toggle off:', JSON.stringify(await p.evaluate(() => st().segments.map((g) => g.verdict))));

// 再点一次「股性不行」，然后框一段，结论应挂在已有段上而不是新建
await p.click('#verdict button[data-v="chart"]');
await p.waitForTimeout(200);
await p.click('#t-rg');
const box = await p.locator('#overlay').boundingBox();
const y = box.y + box.height * 0.5;
await p.mouse.move(box.x + 500, y);
await p.mouse.down();
await p.mouse.move(box.x + 800, y, { steps: 8 });
await p.mouse.up();
await p.waitForTimeout(400);
console.log('after region drag:', JSON.stringify(await p.evaluate(() => st().segments.map((g) => ({ region: g.region, verdict: g.verdict })))));
console.log('errs', errs.length, errs.join('|'));

await p.screenshot({ path: 'E:/vibe/bl-review/.trellis/tasks/10-20-anomaly-level-tracker/research/out/verdict-preview.png', clip: { x: 1230, y: 0, width: 370, height: 720 } });
await b.close();
