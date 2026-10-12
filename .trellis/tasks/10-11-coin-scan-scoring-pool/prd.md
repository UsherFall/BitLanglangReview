# 选品收敛打分与扫描池调整

## Goal

让"启动前只有大级别(日线/4H)收敛"的币能被选品扫出、并排到前面,而不是被小级别阈值和小扫描池挡掉。触发案例:2026-09-29 前后的 STRKUSDT。

用户价值:选品的用途是提前发现蓄力币;当前"单阈值 + topN=60 + 合格周期数优先排序"三重门槛系统性地漏掉"只有日线级收敛"的中等市值币。

## Background / 已确认事实(代码与实测)

**合格判定与排序**
- 现行:一个周期"合格" = `qualified && score >= minScore`;排序 = `qualifiedCount desc → bestScore desc`。`src/server/coin-scan-service.ts:137-140,160`
- `score = clamp01(1 - runMed/preMed)`,只衡量"本带相对前段同长段的缩量深度",**无周期/级别权重**。`src/domain/coin-scan.ts:308-309`
- 09/20 曾**刻意删除** length bonus(时长不参与打分),理由是它只会压低短带。`src/domain/coin-scan.ts:252-254`、`.trellis/spec/server/coin-scan.md`「Score is the shrink depth alone (09/20)」
- `minScore` 默认:UI 输入框 `0.6`;service 缺省 `0`(UI 总是传值)。`src/ui/CoinScanPanel.tsx:45`、`src/server/coin-scan-service.ts:92`

**扫描池**
- 池 = 24h 成交额 ≥ `minQuoteVolume24h` → 池政策/scope → 休市剔除 → `slice(0, topN)`;真正的硬门槛是 `topN` 切片。`src/server/coin-scan-service.ts:78-88`
- 默认(crypto):`topN=60`,`minQuoteVolume24h=10_000_000`。`src/domain/scan-scope.ts:40-43`
- 池用的是**当前**实时 24h 成交额,与锚点无关。`src/server/coin-scan-service.ts:69`、`src/server/binance-tickers.ts:89`
- **换源后的池规模塌陷(2026-10-12 实测,24h 成交额)**:Bitget/Binance 重叠标的成交额比中位数 ≈ **0.10**。当前下限 10M 在 Bitget 上先于 `topN` 卡住 —— Bitget crypto 只剩 **33** 个(≥10M)、equity 只剩 **12** 个,`topN=150/30` 形同虚设;Binance 侧 189 个 ≥10M,`topN` 先卡,**下限是 no-op**。
- **源是启动期常量**:`MARKET_DATA_SOURCE` 在 `app-plugin` 构造时解析一次,选品 UI 无法换源。`src/server/app-plugin.ts:63`

**限流(与 418)**
- klines(limit=100)权重 2/请求;IP 限额 2400 权重/min。`src/server/http.ts:152-158`
- `binanceRatePacer` 强制请求间隔 ≥110ms ⇒ 本进程上限 ≈1090 权重/min(约 45%)——这才是 418 的真正防护。`src/server/http.ts:139-141,171`
- 429 全局退避 10–30s;418 按 Retry-After(≥2min)停全管道并 fail-fast。`src/server/http.ts:49-63,283-296`
- 结论:成交量门槛**不承担限流职责**;放宽它不会 418,代价是单次扫描时长。

**实测 STRKUSDT(币安 fapi,默认结构参数,100 根/周期)**
- 9/29 三个锚点(04/12/20Z):5m/15m/1H 多为无或 0.24–0.37,4H 0.44–0.47,**1D ≈0.51(探针口径,含锚点当天未完成的日线)** —— 均 < 0.6。
- **口径修正**:按 service 规则丢掉"锚点内未完成 bar"后(最后一根 = 09-28 日线),9/29 12:00Z 的 1D score = **0.5522**、4H = 0.4424。这一口径下 1D 仍是唯一合格周期。即选 `1D=-0.10`(0.50)是稳的——若当初选 −0.05(0.55),0.5522 只会勉强擦线。
- 9/26–10/3 全窗口最高分仅 **0.615**(10/2 20:00Z 的 5m),唯一一次摸到 0.6。
- 当时实时池:9/29 全市场 top60 成交额门槛 ≈ **110M**,STRK 日成交额 16.8M、**第 169/740 名** → 当时进不了 top60。
- 当前实时池:STRK 1.5B、第 3 名 → 用锚点=9/29 复现时它**在池里**,堵点是结构分而非成交额。

## Requirements

- **R1 大级别加权(排序)**:排序键改为 **最高合格周期级别 desc → qualifiedCount desc → bestScore desc**。级别序 = `scanTimeframes` 下标(5m=0 … 1D=4);`highestLevel = max(level(tf) for tf in convergedTimeframes)`。等键靠稳定排序保留原 ticker(成交额)顺序。`ScanRow` 契约不新增字段。
- **R2 放宽扫描池**:`DEFAULT_SCAN_PARAMS.crypto.topN` **60 → 150**(equity 仍 30);`minQuoteVolume24h` 不变。不改选池口径(仍用当前实时成交额)。
- **R3 分周期阈值预设**:保留 UI **单一**"结构强度阈值"旋钮(默认 0.6),内部按周期偏移:4H **−0.05**、1D **−0.10**、5m/15m/1H **0**。有效阈值 = `max(0, minScore + offset)`,即默认下 5m/15m/1H=0.60、4H=0.55、**1D=0.50**。`minScore=0`(service 缺省)时全部退化为 0,行为与改动前逐字节一致。
- **R4 约束**:不得改变 `detectConvergence`/`score` 公式;不得引入 418 风险;pacer/gate 不动;单次冷扫时长(~82s)可接受。
- **R5 分源下限(默认值)**:`minQuoteVolume24h` 默认值改为按 `source × scope` 分级,使下限始终**低于该源的 topN 门槛**、让 `topN` 成为唯一硬门槛:
  - binance:crypto 10M / equity 10M(不变)
  - bitget:crypto **0.5M** / equity **3M**
  - okx:crypto 1M / equity 1M(OKX 无股票类标的,equity 仅占位)
  `topN` 保持 crypto 150 / equity 30。
- **R6 UI 选源**:选品面板新增"行情源"选择(币安/OKX/Bitget),默认取服务端启动源;`/api/scan` 按请求的 `source` 参数解析数据源(缺省/非法 → 启动源);切换源时参数默认值按 R5 重新推导。

## Acceptance Criteria

- [x] **AC1** `timeframeMinScore`:默认 0.6 → `1D=0.50`、`4H=0.55`、5m/15m/1H=0.60;`minScore=0` → 全部 0;负值下界夹 0。
- [x] **AC2** 服务层每周期阈值:合成带 1D score≈0.51、4H≈0.44(测试 fixture,非真实数据),`minScore=0.6` 时 `convergedTimeframes` **只含 `1D`**。
- [x] **AC3** 排序:`仅 1D 合格`的币排在`仅 5m/15m/1H 合格`的币**之前**;级别相同时再按 qualifiedCount、bestScore。
- [x] **AC4** `DEFAULT_SCAN_PARAMS.crypto.topN === 150`,`equity.topN === 30`。
- [x] **AC5**(联网验收)以锚点 `2026-09-29T12:00:00Z` 扫描,STRKUSDT 进榜且 **1D(0.5522 ≥ 0.50)合格**、4H(0.4424 < 0.55)不合格,`convergedTimeframes=["1D"]`。
- [x] **AC6** UI 仍为单旋钮(无新增输入框);相关 6 个测试文件 72 passed,`tsc --noEmit` 通过。
- [ ] **AC7** `defaultScanParams` 矩阵:BINANCE `10M/10M`、BITGET `0.5M/3M`、OKX `1M/1M`;`topN` 均 `150/30`。
- [ ] **AC8** `/api/scan` 带 `source=bitget` 时走 Bitget tickers/candles 并按 Bitget 缺省下限;缺省/非法 `source` 等同启动源;响应 `params.source` 回显。
- [ ] **AC9** 选品面板"行情源"切换后参数默认值随之变化,且扫描请求带上 `source`。

## Out of Scope

- 历史锚点使用"当时"成交额选池(池仍用当前实时成交额)——用户未选此项。
- 改动 `score` 公式或恢复 length bonus(09/20 决策保持)。
- 新增周期权重列/多旋钮 UI。

## Key Decisions

1. **大级别"更值钱"的机制** = 分周期阈值 + 排序加权(用户选),不是改 score。
2. **阈值形态** = 单旋钮 + 内部偏移(用户选),不暴露 5 个输入框。
3. **排序语义** = 最高合格级别优先(用户选),而非级别权重求和/加权 bestScore。
4. **扫描池** = topN 抬到 150(用户选),不去 topN、不改成绝对成交额下限。
5. **阈值分级**(用户选):下限按"源 × scope"给默认,而非全局单值 —— 下限是护栏、`topN` 是硬门槛,下限须低于该源的 topN 门槛。
6. **换源下沉到请求**(用户选):源不再是启动期常量,`/api/scan` 按请求参数解析;启动源降级为"默认选中项"。

## Risks / Deferred

- 列表会变长(多出"只有大级别收敛"的币);偏移很小,基础旋钮仍 0.6,可再调严。
- 排序变化会冲击既有手感;`收敛结构` 列已列出合格周期,顺序可解释。
- 冷扫 33s→~82s(手动触发,可接受)。
- `.trellis/spec/server/coin-scan.md` 记录的是旧 topN/单阈值/旧排序,Phase 3 需同步更新。
