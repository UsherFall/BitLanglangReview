# 执行计划（已完成）

验证命令：
- `npx vitest run` —— 基线 51 文件 / 308 测试；完成后 **52 文件 / 321 测试全绿**
- `npx tsc --noEmit` —— 干净

## 实际执行记录

### 1. domain：池子策略与类型 ✅
- 新增 `src/domain/scan-pool.ts`：`isScannable(marketClass)`（HK/CN/pre-IPO 出池，未分类入池）。
- 新增 `src/domain/market-class.ts`：`MarketClass` 从 `market-session.ts` 迁出。
- 新增 `tests/scan-pool.test.ts`（3 用例）。

### 2. domain：时段与会话序列 ✅
- `market-session.ts`：美股窗口 09:30–16:00 → **04:00–20:00 ET**；新增 `isCandleInSession(marketClass, openMs, barMs)`（跨度探针 `min(barMs, 15min)`）。
- `tests/market-session.test.ts`：改写 US 窗口与 DST 用例；新增 `isCandleInSession` 块（边缘 bar、UTC 对齐日线、节假日、韩股、未 gated 类别），共 17 用例。

### 3. 元数据与 ticker ✅
- `binance-instrument-metadata.ts`：保持 `Map<string, MarketClass>`（`baseAsset` 需求随 Yahoo 方案一起撤销）。
- `binance-tickers.ts`：**所有**已分类标的都带 `marketClass`；新增 `metadataAvailable()`；`market-data.ts` 的 `TickerSource` 增加该可选方法。
- `tests/binance-tickers.test.ts`、`tests/binance-instrument-metadata.test.ts` 同步（7 + 7 用例）。

### 4. 扫描流水线 ✅
- `coin-scan-service.ts`：插入池子策略层；分周期取数窗口（gated 200 / 未 gated 100）；`isCandleInSession` 过滤；`metadataUnavailable` 回传。
- `coin-scan.ts`：`ScanResponse` 增加 `metadataUnavailable?`，`skippedInstruments` 注释更新。
- `tests/coin-scan-service.test.ts`：新增 4 用例（会话序列配对、分周期窗口、`metadataUnavailable` 有/无），共 21 用例。

### 5. 热度池 ✅
- `market-heat-service.ts`：池子加 `isScannable`（不进池、不计入 `closedCount`）。
- `tests/market-heat-service.test.ts`：新增「池外类别不计为休市」用例（9 用例）。

### 6. UI ✅
- `CoinScanPanel.tsx`：`metadataUnavailable` 时显示「休市过滤未生效:合约类别元数据拉取失败…」。

### 7. 文档 ✅
- `CONTEXT.md`：`Market Session`（04:00–20:00 ET）、`Session Gating`（含降级可见）、新增 `Session-only Series` 与 `Scan Pool Policy`；`TradFi Instrument` / `Coin Scan` / `Shrink Method` / `Market Heat Pool` 同步。
- `spec/server/coin-scan.md`：池子策略、会话序列、分周期窗口、`metadataUnavailable`、Design Decisions 重写、测试清单更新。
- `spec/server/market-data.md`：`Ticker` 语义（缺失 = 未知而非无时段）、`metadataAvailable`、元数据段更新。
- `spec/server/market-heat.md`：池子策略 + 测试清单。

## 待完成 / 未验证

- **真机端到端**：`/api/scan` 实跑被币安 418（共享出口 IP 被他人流量打满，`used-weight-1m` 低至 0）阻塞两次。已用 `.scratch/session-gating-live.probe.ts` 备好探针，封禁解除后可直接重跑；单元/集成层已覆盖全部验收点。
- **子任务 B（`09-16-scan-module-split`）**：未开始，依赖本任务的 `isScannable` 与池子语义（crypto/equity 两 scope 的划分方式需按 `isScannable` + 日历重述）。

## 回滚点

改动集中在 6 个源文件 + 3 个 spec + CONTEXT.md；`tests/` 无删除（新增 13 个用例）。整体 revert 该提交即可回到 09/06 的日历式 gating。
