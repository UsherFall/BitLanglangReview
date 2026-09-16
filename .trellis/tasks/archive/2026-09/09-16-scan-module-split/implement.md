# 执行计划（已完成）

前置：兄弟子任务 `09-16-equity-yahoo-candles` **已完成并归档**（`isScannable` 池子策略 + 美股时段 04:00–20:00 ET + 会话序列 `isCandleInSession`）。

验证命令：
- `npx vitest run` —— 基线 52 文件 / 321 测试；完成后 **54 文件 / 336 测试全绿**
- `npx tsc --noEmit` —— 干净

## 实际执行记录

### 1. domain：scope 与默认值 ✅
- 新增 `src/domain/scan-scope.ts`：`ScanScope` / `SCAN_SCOPES` / `isScanScope` / `scanScopeOf` / `DEFAULT_SCAN_PARAMS`（crypto 60/10M，equity 30/10M）。
- `coin-scan.ts`：`ShrinkScanParams.scope?: ScanScope`。
- 新增 `tests/scan-scope.test.ts`（5 用例）。

### 2. 服务：池子分治 ✅
- `coin-scan-service.ts`：门槛之后插入 `scanScopeOf(ticker.marketClass) !== scope → continue`（池外类别与另一子模块都静默排除）；`params` 回显解析后的 `scope`。
- `tests/coin-scan-service.test.ts`：新增 4 个 scope 用例（crypto 池 / equity 池 / 两池互斥且并集=全部可扫 / 未分类落 crypto），并改写既有 gating 与 session-series 用例为按 scope 分次扫描（12 → 30 用例）。

### 3. API ✅
- `app-plugin.ts`：`scope` 解析与校验（非法值 400；`method=heat` + `scope=equity` → 400）；`topN`/`minQuoteVolume24h` 的缺省值改为按 scope 取 `DEFAULT_SCAN_PARAMS`。
- **顺手修掉一个既有缺陷**：原 `parseScanParam` 用 `Number(null) === 0`，导致**不带 `topN` 的请求会变成 0 并 400**（与 spec「非数字回退默认值」矛盾）。改用 `parseOptionalNumber` 并把已无引用的 `parseScanParam` 删除。

### 4. UI ✅
- `App.tsx`：新增 `scanScope` 状态；切 scope 时**清空结果**；页签与标题「选币」→「选品」。
- `CoinScanPanel.tsx`：新增「品种」子模块切换（加密/股票）；`股票` 下隐藏 `热度` 并在切换时把已选热度退回 `收敛结构`；切 scope 重置 `topN`/`minQuoteVolume24h` 为该 scope 默认值；请求带上 `scope`；提示文案按 scope 区分。
- `CoinScanResults`：标题改为「选品结果 · 加密/股票」（scope 从 `result.params.scope` 读回）。
- `styles.css`：新增 `.coin-scan-scope-row` / `.coin-scan-scope`（复用主色，不新增设计语言）。
- 新增 `tests/coin-scan-panel.test.tsx`（6 用例）。

### 5. 文档 ✅
- `CONTEXT.md`：`Coin Scan`(选币) → `Instrument Scan`(选品)，新增 **Crypto Scope / Equity Scope** 子模块语义；`Shrink Method` / `Market Session` / `Session-only Series` / `Scan Pool Policy` / 个人交割单复盘条目内的旧称一并更新（全文已无「选币 / Coin Scan」残留）。
- `spec/server/coin-scan.md`：标题与 §1 更名；请求表新增 `scope` 与按 scope 的默认值；新增「子模块拆的是池子不是数据源」Design Decision；流水线伪码加 scope 层；测试清单补 `scan-scope` / `coin-scan-panel`。

## 与规划的两处偏差（都是实测所得）

1. **测试锚点**：原计划假设存在「美股与韩股同时开盘」的时刻 —— 实测不存在（美股 04:00–20:00 ET = 08:00–24:00 UTC，韩股 09:00–15:30 KST = 00:00–06:30 UTC，不重叠）。因此「两池并集 = 全部可扫标的」的用例改为跨两个锚点（US 开盘 + KR 开盘）取并集，并在用例内注明原因。
2. **scope 按钮的 DOM**：最初把按钮放在 `<label>` 内，`button` 属于 labelable 元素 → 可访问名变成「品种加密」，测试与读屏都会拿到脏名字。改为 `<div class="coin-scan-scope-row"><span>品种</span><span class="coin-scan-scope">按钮…</span></div>`。

## 已知波动（与本任务无关）

全量套件偶发 1 例失败：`tests/app-tag-management.test.tsx > drops a tag from the dropdown once its last trade loses it`（标签管理，未触碰；单独跑 3 次均通过，`vitest.config.ts` 注释已说明该文件在并行负载下贴近超时线）。重跑即绿，不阻断。

## 回滚点

改动集中在 `scan-scope.ts`（新增）/ `coin-scan-service.ts` / `app-plugin.ts` / `coin-scan.ts` / `CoinScanPanel.tsx` / `App.tsx` / `styles.css` + 3 个 spec/CONTEXT。只回滚 UI 层即退回「单列表但池子已按 scope 分治」；`scope` 缺省 `crypto`，所以不带 scope 的调用行为与改动前一致。
