/**
 * 11-04 复现驱动：本地 HTTP 服务（同源）→ headless Edge 真跑 rAF → harness 把结果 POST 回来。
 * 用法：node run-harness.mjs
 */
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const RESEARCH_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(RESEARCH_DIR, '../../../..');
const BUNDLE = path.join(REPO_ROOT, 'node_modules', 'lightweight-charts', 'dist', 'lightweight-charts.standalone.development.js');
const EDGE = process.platform === 'win32'
  ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  : '/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const TEMP_PROFILE = path.join(process.env.TEMP ?? '/tmp', 'lwc-harness-17890');
const PORT = 17890;

let result = null;
const server = http.createServer((req, res) => {
  if (req.url === '/lwc.js') {
    res.writeHead(200, { 'content-type': 'application/javascript' });
    res.end(readFileSync(BUNDLE));
    return;
  }
  if (req.url === '/' || req.url === '/harness.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(readFileSync(path.join(RESEARCH_DIR, 'harness.html')));
    return;
  }
  if (req.url === '/result' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      result = body;
      res.writeHead(200);
      res.end('ok');
    });
    return;
  }
  res.writeHead(404);
  res.end('nope');
});
await new Promise((resolve) => server.listen(PORT, '0.0.0.0', resolve));

const edge = spawn(EDGE, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  `--user-data-dir=${TEMP_PROFILE}`,
  '--window-size=1400,800',
  `http://127.0.0.1:${PORT}/`,
], { stdio: 'ignore' });

const deadline = Date.now() + 90_000;
while (result === null && Date.now() < deadline) {
  await sleep(400);
}
try { edge.kill(); } catch { /* ignore */ }
server.close();
console.log(result ?? 'TIMEOUT: harness did not report back');
process.exit(0);
