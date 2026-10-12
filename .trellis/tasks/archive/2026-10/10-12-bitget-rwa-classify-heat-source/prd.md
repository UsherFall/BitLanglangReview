# PRD: Bitget 标的分类与热度切源

## 背景

选品扫描默认源已切 Bitget（10/12），但 Bitget tickers 不带标的分类，所有合约按加密处理。实测 Bitget USDT-FUTURES 820 个合约中 354 个是 RWA（美股 TSLA/NVDA/AAPL…、港股、韩日股、黄金 XAU、原油 CL、指数 SPY/QQQ、pre-IPO OPENAI/ANTHROPIC…），它们成交额高，把加密扫描结果淹没了（用户实测反馈"扫出来的大部分是股票"）。

Bitget `/api/v2/mix/market/contracts` 端点提供 **`isRwa`** 字段（YES=354 / NO=466），是唯一的分类信号。用户决策（10/12）：**只分两类——加密货币和其他**，不做商品/港股/韩日股/pre-IPO 的细分符号表。

市场热度（market heat）目前硬编码 Binance 实例，与"选品整个模块默认 Bitget"不一致，需改为跟随 `MARKET_DATA_SOURCE`。

## 需求

1. `BitgetTickerSource` 从 contracts 端点取 `isRwa`，给每个 ticker 挂 `marketClass`：`NO → CRYPTO`，`YES → US_EQUITY`。两类之间不做细分。
2. 分类缺失/端点故障时降级为无 class（按加密处理），并实现 `metadataAvailable()` 让扫描以 `metadataUnavailable` 警告透出——不允许静默失去门控。
3. 市场热度跟随 `MARKET_DATA_SOURCE`：bitget 模式用 Bitget 源，binance 模式仍共享币安实例（TTL 语义不变）。
4. 加密 scope 在 Bitget 源下只出现真加密（RWA 全部移出）；股票 scope 在 Bitget 源下出现 RWA 合约，按美股时段（04:00–20:00 ET）门控。

## 约束

- **两类是用户明确决策**：不建商品/港股/日韩/pre-IPO 符号表。接受后果：黄金 XAU、原油、指数、FX、港股、pre-IPO 全部按 US_EQUITY 门控。Bitget 这些产品 24/7 交易，门控会每天丢掉约 8 小时 bar，session-only 序列在断层处截断——用户已知并接受（"纯两类，黄金也门控"）。
- contracts 端点公开免鉴权，与 tickers 同一限频桶；一次全量拉取，TTL 6h（仿币安 metadata 的 6h exchangeInfo 缓存）。
- metadata 拉取失败/非数组 → 空 map，绝不抛错（仿币安 metadata 的降级契约）。
- 市场热度在 OKX 模式下会随之读 OKX（原为硬编码币安）——模块整体随源切换，视为预期。

## 验收标准

- AC1：bitget 源加密 scope 扫描结果不含 RWA 符号（TSLA/NVDA/XAU/SPY 等缺席）；只含 isRwa=NO 的合约。
- AC2：bitget 源股票 scope 扫描返回非空（扫描时刻处于美股时段），行内 instrument 为 RWA 合约；`skippedInstruments` 在闭市时段正确出现。
- AC3：`XAUUSDT` 等 24/7 RWA 产品归股票 scope 且被美股时段门控（两类决策的预期行为，有测试固定）。
- AC4：单测覆盖 isRwa→MarketClass 映射（YES/NO/缺值三类输入）、metadataAvailable（正常/降级）、TTL 缓存与 in-flight 去重、失败降级为空 map 不抛错。
- AC5：`/api/market-heat` 在 bitget 模式返回基于 Bitget 数据的结果；`MARKET_DATA_SOURCE=binance` 时热度行为与改动前一致（共享实例、TTL）。
- AC6：`npm test` 全绿 + `npx tsc --noEmit` 干净；binance/okx 源路径无回归。
- AC7：不设环境变量时默认仍为 bitget，且分类生效（集成实测）。

## 非目标

- 不做 HK/KR/JP/商品/指数的细分分类（用户明确两类）。
- 不改 `market-session.ts` 的时段定义。
- 不动 market heat 的算法与池定义（Top-N 口径不变，只换数据源）。
