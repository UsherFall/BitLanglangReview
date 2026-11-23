# Implement — 热度扫描升级为活跃度粗筛

## 已完成的研究前置

- [x] 审计现有 `heat` 的 Top80、24h净涨跌榜和 UI 输出；
- [x] 复算 `BTCUSDT / 2020-08-03 12:00` 当前22回合的24h活跃度；
- [x] 确认活跃度只用于看图排序、最近4h用于节奏提示、低活跃路径与热度扫描互补；
- [x] 保存 `research/aug-activity.{mjs,json,csv}` 与 `research/aug-activity-review.md`。

## 执行清单

### 1. 领域契约与服务实现

- [x] `src/domain/market-heat.ts`：增加活跃池常量、可选活跃字段和结果字段，写明公式与 null 语义；
- [x] `src/server/market-heat-service.ts`：拆分 Top80 市场池与 Top120 活跃池，新增20个完整日线基线、活跃排序和最近4h强度；
- [x] 保持原 tier/stats/topGainers/topLosers、reviewCoin、skip/warning、缓存和限频行为；
- [x] `tests/market-heat-service.test.ts`：补基线 fixture，覆盖公式、排序、池隔离、历史不足、空数据和缓存；
- [x] `tests/market-heat.test.ts`：覆盖新增领域常量/纯函数（若提取）。

### 2. 选品结果工作清单

- [x] `src/ui/HeatScanResults.tsx`：新增活跃候选表、排序、前20/全量切换、指标解释和看图按钮；
- [x] `src/ui/App.tsx`：复用 `openLevelDrawer` 接入同行情源图表；
- [x] `src/ui/styles.css`：仅补活跃榜所需样式，不改变其它列表布局；
- [x] `src/ui/CoinScanPanel.tsx`：更新热度方法说明为“Top80市场温度 + Top120活跃候选”，不新增监控依赖；
- [x] `tests/heat-scan-results.test.tsx`：覆盖排序、null 置后、展开、看图和旧市场温度区域；
- [x] 必要时补 App 级热度扫描交互测试。

### 3. 契约同步

- [x] `.trellis/spec/server/market-heat.md`：写入 Top80/Top120 隔离、公式、null、缓存与兼容约定；
- [x] `CONTEXT.md`：更新 Market Temperature / Market Heat Pool / Instrument Scan 的热度方法边界，保留低波动候选与活跃度候选的区分；
- [x] 不复活自动收敛识别，不把活跃度描述写成买卖信号。

### 4. 验证与复核

- [x] 先跑 `npx vitest run tests/market-heat-service.test.ts tests/market-heat.test.ts tests/heat-scan-results.test.tsx tests/market-heat-panel.test.tsx`；
- [x] 再跑 `npx tsc --noEmit` 和 `npm test`；
- [x] 调用 `research/validate.mjs`，确认此前 BTC 研究与 AC1–AC8 未回归；
- [x] 运行 `node research/aug-activity.mjs` 核对22回合研究数据未变；
- [x] 如网络允许，做一次真实 `method=heat` 扫描，记录耗时、候选数、null 数和限频警告；失败则如实记录，不伪称 smoke 通过；
- [x] `git diff --check`，检查只包含本任务文件。

## 回滚点

- 服务端公式/池隔离问题 → 回滚第1步，保留研究和设计；
- UI 信息过载或排序不符合看图习惯 → 回滚第2步，保留服务端新字段和旧涨跌榜；
- 真实扫描请求成本不可接受 → 优先把活跃池降回80或恢复旧视图，不改市场温度口径，不通过减少必要K线来伪造指标。
