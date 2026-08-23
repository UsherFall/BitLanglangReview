# 选币自选列表与通知 — Implement

## 实施清单(按序)

1. **domain**:`src/domain/price-alert.ts` — `PriceAlert` / `AlertDirection` / `AlertStatus` / `isAlertTriggered`(纯函数)。
2. **test**:`tests/price-alert.test.ts` — above/below、等值触发、triggered 不触发。
3. **ticker 提取**:`src/server/okx-tickers.ts` — `OkxTicker` 类型 + `fetchOkxTickers(fetchJson)`(从 CoinScanService 平移,含 USDT-SWAP 过滤、volCcy24h×last、排序、change24h)。`coin-scan-service.ts` 改用它,删除私有 `fetchTickers`。
4. **gate**:`npm test` — `coin-scan-service.test.ts` 必须保持全绿(证明重构行为不变)。
5. **store**:`src/server/alert-store.ts` — `price_alerts` 表 + `listAlerts` / `saveAlert` / `deleteAlert` / `markTriggered` / `reactivate`,仿 `FreeReplaySessionStore`。
6. **test**:`tests/alert-store.test.ts` — CRUD + 状态流转(临时 SQLite 文件,用完清理)。
7. **notify**:`src/server/notify.ts` — `Notifier` 接口 + `ServerChanNotifier`(POST `https://sctapi.ftqq.com/{key}.send`)+ 未配置 key 时的 no-op。
8. **test**:`tests/serverchan-notifier.test.ts` — mock fetch,断言 URL + body + 超时;无 key 不抛错。
9. **monitor**:`src/server/alert-monitor.ts` — `start`(setInterval + `unref`)/ `stop`;`tick`:防重叠标志 → `fetchOkxTickers` → 对 active 警报判定 → `markTriggered` + `send`;缺价格跳过;捕获异常记日志不崩。
10. **test**:`tests/alert-monitor.test.ts` — mock ticker + notifier:正确触发、标 triggered、不重复触发、缺价格跳过、重叠 tick 防抖。
11. **API**:`app-plugin.ts` — 实例化 `AlertStore`(同 sqlite 文件)/ `Notifier` / `AlertMonitor`(仅当有 key 时也启动,无 key 用 no-op notifier);挂 `GET|POST /api/alerts`、`DELETE /api/alerts`、`POST /api/alerts/reactivate`;`GET` 返回 `{ alerts, config }`。
12. **config**:`vite.config.ts` — `defineConfig(({ mode }) => ...)` + `loadEnv` 读 `SERVERCHAN_KEY`,传入 `tradingReviewApiPlugin({ serverChanKey })`;plugin 参数可选,回落 `process.env`。
13. **UI**:`CoinScanPanel.tsx` — 结果行「设警报」按钮(预填币,回调父级表单);警报区 = 手动表单(币 + 方向下拉 + 目标价)+ 警报列表(币/方向/目标价/状态/重新启用/删除)+ 通知配置状态(`GET /api/alerts` 的 config)。
14. **styles**:`styles.css` — 警报区样式,沿用 `.coin-scan-*` 命名与配色。
15. **gate**:`npm test` 全绿 + `npm run dev` 手动验证(见 prd AC6)。

## 验证命令

- `npm test` — 全量单测(每步后跑)。
- `npm run dev` — 手动:建警报(上破/下破)→ 看监控 tick 日志 → 触发后微信收到 → 状态变"已触发" → 重新启用/删除。
- 临时模拟触发:建一个 `below` 警报,目标价设高于现价(立即触发),验证推送 + 状态。
- `.env` 建 `SERVERCHAN_KEY=...` 后 UI 显示"已配置";删除后显示"未配置"且不推。

## 风险文件 / 回滚点

- **`src/server/coin-scan-service.ts`** — 唯一触碰既有行为的重构(第 3 步);回滚点 = 此文件。门禁:重构后 `coin-scan-service.test.ts` 全绿。
- **`src/server/app-plugin.ts`** — 集中装配;新增 store/monitor/路由均增量,出问题可单独摘掉 monitor 启动行。
- 其余全部新增文件,无既有行为影响。

## task.py start 前复查

- [ ] prd.md 收敛完成,无重复事实、无残留 brainstorm 段。
- [ ] `npm test` 基线(重构前)全绿。
- [ ] design.md / implement.md 就位。
- [ ] implement.jsonl / check.jsonl 有真实 spec 条目。
- [ ] 用户已 review 本规划。
