# 选币改选品：加密 / 股票双子模块分开扫描

## Goal

把「选币」模块更名为「选品」（Instrument Scan），内部按标的类型分成两个子模块：**加密**（加密 + 指数 + 商品）与 **股票**（美股 + 韩股）。两者的差异不再是数据源，而是**时段语义**：加密 24/7 无时段判定，股票按真实交易时段判定并用会话序列取数（子任务 A 已落地）。两个子模块各自独立的扫描池、参数与结果，分开扫描，互不占用名额。

依赖兄弟子任务 `09-16-equity-yahoo-candles`（池子策略 `isScannable` + 美股时段放宽到 04:00–20:00 ET + 会话序列，**已完成**）：本任务只做模块边界、API 参数与 UI 形态，**不重复实现数据源**。

## Background

1. 顶层模块枚举：`App.tsx:92` `type ReviewMode = 'trade' | 'bitget' | 'freeReplay' | 'scan'`；`App.tsx:116` 标签文案「选币」；`App.tsx:626` 页签；`App.tsx:728-732` 渲染 `CoinScanPanel`；`App.tsx:778-784` 按 `scanResult.method` 渲染 `CoinScanResults` / `HeatScanResults`。
2. 扫描接口：`app-plugin.ts:219-267`（`method` / `topN` / `minQuoteVolume24h` / `anchor` / `minScore`；`method=shrink|heat`，非法参数 400）。
3. 面板：`CoinScanPanel.tsx`（参数表单 + 扫描按钮 + `CoinScanResults`）；`HeatScanResults.tsx` 为热度结果。
4. **混合池的实测代价**（`09-04` PRD）：`topN=60` 的池子里 **19 个（32%）** 是传统市场合约（NVDA/MSTR/TSLA/CRCL/INTC/HOOD/SKHYNIX/SAMSUNG…）→ 加密标的的名额被挤掉近三分之一；而 `MU 310M / MSTR 225M / SAMSUNG 140M` 的成交额会长期占位。
5. 两种标的的时段语义不同：加密 24/7（无时段问题）；股票需时段表 + 会话序列（子任务 A）。分开后加密侧的池子与窗口完全不受时段逻辑影响。
6. 热度（`heat`）的语义是「场子冷热」= 池子涨跌广度 + 24h 中位涨跌；子任务 A 已把热度池定为加密 + 指数 + 商品。

## Requirements

### R1. 更名

- R1.1 UI 文案「选币」→「选品」（页签、面板标题、提示文案）。
- R1.2 `CONTEXT.md` 术语 `Coin Scan`（选币）→ `Instrument Scan`（选品），并更新其「Methods」段落描述两个子模块。
- R1.3 **内部标识保持不变**：`ReviewMode` 仍用 `'scan'`，路由 `/api/scan` 不变（避免动持久化与既有链接）。

### R2. 子模块

- R2.1 选品模块内提供「加密 / 股票」切换，默认「加密」。
- R2.2 子模块状态由 `App.tsx` 持有（参数面板与结果面板共享同一个 scope），切换子模块时**清空上一次的结果**（避免看到错配的列表）。
- R2.3 结果面板标题显示当前子模块（加密 / 股票）。

### R3. 池子按 scope 过滤

- R3.1 新增 domain 类型 `ScanScope = 'crypto' | 'equity'`。
- R3.2 池子过滤基于子任务 A 的 `isScannable` + `marketClass`：`equity` → `US_EQUITY` / `KR_EQUITY`；`crypto` → 其余 scannable 类别（加密 + 指数 + 商品）与未分类标的。两个 scope 都先过 `isScannable`，池外类别（港/A 股、Pre-IPO）在任何 scope 下都不出现。
- R3.3 过滤发生在 24h 成交额门槛之后、休市剔除之前；`skippedInstruments` 语义不变（只报休市被剔除的标的）。

### R4. API

- R4.1 `/api/scan` 新增 `scope` 参数，缺省 `crypto`（既有调用行为完全不变）。
- R4.2 非法 `scope` → 400 `Invalid scan parameters`；`scope=equity` 与 `method=heat` 组合 → 400（股票侧没有热度，见 R6）。
- R4.3 响应 `params` 回显 `scope`（与 `anchor` 回显同一机制）。

### R5. 参数与默认值

- R5.1 每个 scope 有自己的默认值，互不影响：加密 `topN=60` / `minQuoteVolume24h=10_000_000`（现状）；股票 `topN=30` / `minQuoteVolume24h=10_000_000`（实测 10M 以上的股票类标的约 45 个）。
- R5.2 `minScore` / `anchor` 两个 scope 共用，行为不变。
- R5.3 切换 scope 时，面板的 `topN` / `minQuoteVolume24h` 重置为该 scope 的默认值（用户仍可手动改）。

### R6. 方法可用性

- R6.1 `heat`（热度）只在「加密」子模块提供；「股票」子模块只提供 `shrink`（缩量/收敛）。
- R6.2 理由：热度的读数是「场子冷热」（池子涨跌广度 + 中位涨跌），其池子已定为加密 + 指数 + 商品；给股票侧加热度需要另定义一套语义（另开任务）。

### R7. 结果面板

- R7.1 `记龙头 / 复制 / 详情` 行为不变（标的仍是币安符号 `AAPLUSDT`/`SAMSUNGUSDT`，可直接用于下单）。
- R7.2 龙头币列表是全局的，不做 scope 隔离（保持现状）。

## Acceptance Criteria

1. 选品页签下可见「加密 / 股票」切换，默认加密；切换后结果清空。
2. 加密扫描的池子不含任何股票类标的，结果与改动前一致（原被占用的 19 个名额回到加密标的）。
3. 股票扫描的结果只含 `US_EQUITY`/`KR_EQUITY` 标的；休市的标的被跳过并在提示里列出；其窗口只含真实时段 bar（会话序列生效）。
4. `heat` 只在加密子模块出现；股票子模块看不到该选项；`scope=equity&method=heat` 返回 400。
5. `/api/scan` 不带 `scope` 或 `scope=crypto` 时行为与改动前完全一致；`scope=equity` 正确；非法值 400。
6. 两个 scope 的 `topN` / `minQuoteVolume24h` 默认值与彼此隔离（切换时重置，不互相污染）。
7. `skippedInstruments`、`anchor` 回显、排序规则（`qualifiedCount` → `bestScore`）均不变。
8. `npx vitest run` 全绿；`npx tsc --noEmit` 无新增错误。

## Out of Scope

- 第三个子模块（商品单独成模块）。
- 股票侧的热度/温度读数。
- 跨 scope 的混合排序或「一次扫描同时出两个列表」。
- 选品结果与图表联动（现状不联动，见 `09-16-coin-scan-equity-source/research/session-pollution-measurements.md` §7.4）。
- 数据源实现（池子策略 `isScannable`、时段表、会话序列）—— 属兄弟子任务 `09-16-equity-yahoo-candles`。
