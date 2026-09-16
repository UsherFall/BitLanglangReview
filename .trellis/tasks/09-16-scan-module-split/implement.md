# 执行计划

前置：兄弟子任务 `09-16-equity-yahoo-candles` **已完成**（`isScannable` 池子策略 + 美股时段 04:00–20:00 ET + 会话序列 `isCandleInSession`）。本任务只做 scope 分治。

验证命令（每个里程碑都跑）：
- `npx vitest run`
- `npx tsc --noEmit`

## 步骤

### 1. domain：scope 与默认值
- [ ] `src/domain/coin-scan.ts`：新增 `ScanScope` / `SCAN_SCOPES` / `DEFAULT_SCAN_PARAMS`（`design.md` §4 的表）；`ShrinkScanParams` 增加 `scope?: ScanScope`。
- [ ] 新增 `tests/coin-scan-scope.test.ts`（或并入现有 `coin-scan.test.ts`）：`SCAN_SCOPES` 覆盖、默认值表内容、缺省 scope 解析为 `crypto`。

### 2. 服务：池子过滤
- [ ] `src/server/coin-scan-service.ts`：在成交额门槛之后插入 scope 过滤（`design.md` §3 的 `kindOf` 写法），策略结论用局部 Map 缓存并同时供后续 K 线源路由使用；`scope` 缺省 `crypto`；`params` 回显里带 `scope`。
- [ ] 更新 `tests/coin-scan-service.test.ts`：新增/改写用例 — ① `scope=crypto` 池子不含 `US_EQUITY`/`KR_EQUITY` 标的（也不含池外的港/A 股与 Pre-IPO）；② `scope=equity` 池子只含 `US_EQUITY`/`KR_EQUITY`；③ 两个 scope 的池子互斥且并集 = 全部可扫标的；④ `scope` 缺省时行为与改动前一致；⑤ 未分类标的（元数据降级）落在 crypto 侧。

### 3. API
- [ ] `src/server/app-plugin.ts`（`/api/scan`，219-267）：解析 `scope`（缺省 `crypto`）；非法值 400；`method=heat` 且 `scope=equity` → 400；`topN` / `minQuoteVolume24h` 的缺省值改为按 `scope` 从 `DEFAULT_SCAN_PARAMS` 取（替换现有两个硬编码默认值）。
- [ ] 若有服务端路由测试则补用例；否则以服务层用例 + 真机验证覆盖（见「完成前检查」）。

### 4. UI
- [ ] `src/ui/App.tsx`：新增 `scanScope` 状态，`reviewMode === 'scan'` 分支把 `scope` / `onScopeChange` 传入 `CoinScanPanel`；`onScanned` 载荷带 `scope`；**scope 变化时清空 `scanResult`**（`App.tsx:216`）。
- [ ] `src/ui/CoinScanPanel.tsx`：方法选择区上方加「加密 / 股票」子模块按钮（复用 `selected` 样式，参照 `App.tsx:626`）；`股票` 时隐藏 `heat` 选项；切 scope → 重置 `topN` / `minQuoteVolume24h` 为该 scope 默认值并清空结果；`onScanned` 带上 scope。
- [ ] 面板标题与 `src/ui/CoinScanResults.tsx` 标题加「加密」/「股票」标识。
- [ ] 文案：「选币」→「选品」（`App.tsx:116`/`626`、面板标题、`CoinScanPanel.tsx:177` 的跳过提示保持「已跳过 N 个休市/无数据标的」）。
- [ ] 更新 `tests/coin-scan-results.test.tsx`：补 scope 切换、结果清空、股票侧无 heat 选项的用例。

### 5. 文档与 spec
- [ ] `CONTEXT.md`：`Coin Scan`（选币）→ `Instrument Scan`（选品），Methods 段说明两个子模块与各自的方法可用性（`heat` 仅加密侧）。
- [ ] `spec/server/coin-scan.md`：写入 `scope` 契约、默认值表、`method × scope` 合法矩阵、池子过滤位置。
- [ ] `spec/frontend/state-management.md`（若涉及模块状态约定）：记录 scope 由 App 持有、切 scope 清结果。

## 风险文件 / 回滚点
- `src/server/app-plugin.ts`（参数解析与默认值，最易漏改）→ 改动后必须真机验证三种请求（无 scope / `scope=crypto` / `scope=equity`）。
- `src/ui/App.tsx`（`scanResult` 状态与 scope 的联动，易留脏结果）→ UI 测试兜底。
- 回滚点：步骤 1–3（服务端）与步骤 4（UI）可分别回滚；只回滚 UI 会退化为「单列表但池子已分治」。

## 完成前检查
- [ ] `npx vitest run` 全绿、`npx tsc --noEmit` 干净。
- [ ] 真机：`/api/scan?method=shrink&topN=200&minQuoteVolume24h=0`（无 scope）返回的池子里没有股票类标的；加 `&scope=equity` 返回的池子里只有美股/韩股。
- [ ] 真机：`&scope=equity&method=heat` → 400；`&scope=bogus` → 400。
- [ ] 真机 UI：加密/股票切换后结果清空、参数重置、股票侧无热度选项。
- [ ] 排序规则、`skippedInstruments`、`anchor` 回显与改动前一致（对比一次加密扫描的前后结果）。
