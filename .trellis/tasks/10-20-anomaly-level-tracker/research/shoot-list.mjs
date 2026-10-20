/** 截图自查：粗筛名单页渲染是否正确。 */
import { chromium } from 'file:///C:/Users/Fuzz/AppData/Roaming/npm/node_modules/playwright/index.mjs';

const url = 'file:///E:/vibe/bl-review/.trellis/tasks/10-20-anomaly-level-tracker/research/out/list-2026-10-19.html';
const out = process.argv[2] ?? 'E:/vibe/bl-review/.trellis/tasks/10-20-anomaly-level-tracker/research/out/preview.png';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1400 }, deviceScaleFactor: 1 });
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(300);
await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1280, height: 1400 } });
const counts = await page.evaluate(() => ({
  cards: document.querySelectorAll('.card').length,
  sparks: document.querySelectorAll('svg.spark').length,
  drawn: [...document.querySelectorAll('svg.spark')].filter((s) => s.childElementCount > 0).length,
}));
console.log(JSON.stringify(counts));
await browser.close();
console.log('wrote', out);
