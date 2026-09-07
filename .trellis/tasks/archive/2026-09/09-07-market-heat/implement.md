# 市场热度复盘 — 实施计划

三块工作按依赖顺序分 3 个 Cluster，各自独立验证 + commit。全部完成后跑全量回归。

## Cluster 1：删除价格警报功能

**改动文件**
- 删除：`src/domain/price-alert.ts`、`src/server/alert-store.ts`、`src/server/alert-monitor.ts`、`src/server/notify.ts`
- `src/server/app-plugin.ts`：删 import（AlertMonitor/AlertStore/notify 相关）、`alertMonitorIntervalMs`、notifier+alertMonitor 装配（62-66）、`/api/alerts` 路由（221-255）、options 里 `serverChanKey`
- `src/ui/CoinScanPanel.tsx`：删警报 UI 区块与全部 alert state/handlers；`CoinScanResults` 删「设警报」按钮与 props
- `src/ui/App.tsx`：删 `alertInstrument` state（195）与相关传参（691,741）
- `src/ui/styles.css`：删 `.coin-scan-alerts` 样式段（1605-1694）
- 删除测试：`tests/alert-monitor.test.ts`、`tests/alert-store.test.ts`、`tests/price-alert.test.ts`、`tests/serverchan-notifier.test.ts`
- 检查 `tests/coin-scan-service.test.ts` 中提及 alert tick 的注释是否需同步

**验证门 G1**
- `npm test` 全绿
- `grep -rn "价格警报\|设警报\|SERVERCHAN\|ServerChan" src tests` 无命中（排除历史 git）
- `npx tsc --noEmit`（或项目实际 typecheck 命令）通过

## Cluster 2：全局共享保守限速器

**改动文件**
- `src/server/http.ts`：从 coin-scan-service 迁入 `createRequestPacer`（含 jitter）；新增 `BINANCE_MIN_INTERVAL_MS=110`、`BINANCE_PACE_JITTER_MS=15`、`export const binanceRatePacer`
- `src/server/binance-candles.ts`：`getCandlesticks` 在决定真实 fetch 后、`fetchJson` 前 `await binanceRatePacer.pace()`；cache 命中路径不 pace
- `src/server/binance-tickers.ts`：真实出网前 pace；TTL/in-flight 命中不 pace
- `src/server/coin-scan-service.ts`：删私有 `scanPacer`、`SCAN_MIN_INTERVAL_MS`/`SCAN_PACE_JITTER_MS`、`pace()` 调用（91,120）与 `createRequestPacer` 函数
- 检查 `alert-monitor.ts` 已随 Cluster 1 删除，无需处理

**验证门 G2**
- `npm test` 全绿（含 coin-scan-service 现有限频/并发测试不回归）
- 手动 `npm run dev`：跑一次选币扫描计时，确认单次 ~30-36s、无 418
- 确认 `/api/scan` 限频警告（429 退避提示）行为不回归

## Cluster 3：市场温度功能（核心）

### 3a. Domain 纯逻辑 + 测试先行
- 新增 `src/domain/market-heat.ts`：类型、常量、`classifyTier`、`normalizeToBinance`
- 新增 `tests/market-heat.test.ts`：5 档分类边界、normalize（OKX `BTC-USDT-SWAP` / Bitget `BTCUSDT` / 商品 `XAUUSDT` / 无法归一）
- **验证门 G3a**：`npx vitest run tests/market-heat.test.ts` 绿

### 3b. Server 服务 + API
- 新增 `src/server/market-heat-service.ts`（computeHeat，见 design）
- `src/server/app-plugin.ts`：装配 `MarketHeatService`（注入 Binance ticker/candle + rateGate）；`GET /api/market-heat`
- 新增 `tests/market-heat-service.test.ts`：fake ticker/candle source + gate——池切片、休市跳过计数、noData 跳过、复盘币追加与无法归一、档位与 stats、内存缓存同锚点二次调用不打源
- **验证门 G3b**：`npm test` 绿

### 3c. UI 面板
- 新增 `src/ui/MarketHeatPanel.tsx`；`src/ui/App.tsx` header 加「热度」按钮 + open state（trade/bitget 明细才出现）
- `src/ui/styles.css`：`.market-heat-panel` 变体 + 档位配色
- 新增 `tests/market-heat-panel.test.tsx`（RTL）：渲染档位与数字、入场/离场切换重发请求、418 错误提示展示
- **验证门 G3c**：`npm test` 绿

### 3d. 手动端到端
- `npm run dev`：真实交割单/Bitget 复盘打开面板 → 出温度 + 榜；切离场重算；同一笔交易二次打开无新请求（devtools 观察）；锚点推进复用缓存；无代理断网场景报错文案可读
- **验证门 G3d**：端到端行为符合 AC1-AC5

## 全量收尾
- `npm test` 全绿；`grep -rn "market-heat\|市场热度\|热度"` 确认命名一致
- 术语沉淀进 CONTEXT.md（市场温度 Market Temperature、池、档位术语）——按项目术语纪律走 spec 更新流程
- 三块依次 commit（Cluster1/2/3），每块独立可 revert

## 风险文件 / 回滚点
- `src/server/app-plugin.ts`：Cluster1 删路由与装配、Cluster3 新增装配，两处改动叠加，**逐 cluster commit** 降低冲突
- `src/server/http.ts` + `binance-candles.ts` + `coin-scan-service.ts`：限速下沉改动面，G2 前不继续
- `src/ui/CoinScanPanel.tsx` / `App.tsx`：props 删改波及传参点，靠 `tsc --noEmit` 兜底
- 若 Cluster2 后 scan 耗时超预期或仍偶发 418：回退点 = Cluster2 commit，另行评估间隔或并发

## 开工前置
- 三份产物就绪：prd.md（已批准）、design.md、implement.md
- `task.py start` 后按 Cluster 1 → 2 → 3 顺序执行
