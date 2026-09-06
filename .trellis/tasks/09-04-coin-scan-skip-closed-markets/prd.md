# 选币扫描跳过休市的传统市场合约

## Goal

选币（Coin Scan / 缩量方法）不再把**休市中的传统市场合约**当成收敛标的扫出来：美股、港股、韩股、A 股合约在各自市场休市时不进入扫描池，开盘时照常参与扫描；加密合约与商品合约（XAU/CL 等）行为完全不变。

## Background

- 币安 USDT-M 永续里有 191 个 TradFi 合约（美股 156、港股 15、韩股 8、A 股 2、商品 8、Pre-IPO 2）。按 24h 成交额排，`topN=60` 的扫描池里 **19 个（32%）** 是传统市场合约（NVDA/MSTR/TSLA/CRCL/INTC/HOOD/SKHYNIX/SAMSUNG…）。
- 币安对这些合约 7×24 出 K 线，不会断：休市时只是量塌掉（TSLA 开盘小时成交 12.5 万 vs 盘后 3 千，差 40 倍）。缩量扫描判断的正是「近段比前段安静」，所以**休市时段必然全中**，结果列表被一堆不动的美股占满。
- 币安接口**有**标的类别标识（`fapi/v1/exchangeInfo` 的 `contractType: TRADIFI_PERPETUAL` / `underlyingType: EQUITY|HK_EQUITY|KR_EQUITY|CN_EQUITY|COMMODITY|PREMARKET`），但**没有**交易时段字段，也没有交易日历接口 → 类别从 API 拿，是否开盘自己算。
- 商品类（黄金 XAUUSDT 实测全天有量，最低小时 3,797 / 最高 159,015，且各品种时段不同）**不做**时段过滤。
- 参考调研：`.trellis/tasks/09-04-coin-scan-skip-closed-markets/research/binance-tradfi-instrument-metadata.md`。

## Confirmed Decisions

1. **过滤范围**：只按时段过滤 `EQUITY`（美股，含 ETF）、`HK_EQUITY`、`KR_EQUITY`、`CN_EQUITY`。`COMMODITY`、`PREMARKET`、`INDEX`、`COIN` 不做时段过滤（一直扫）。
2. **过滤时机**：在 `minQuoteVolume24h` 过滤之后、`slice(0, topN)` **之前**剔除休市标的 —— 休市合约不能占用 topN 名额。
3. **判定依据**：内置市场日历（各市场本地时区 + 交易日 + 开盘区间 + 美股节假日表），不依赖外网日历服务；夏令时由 IANA 时区数据库处理，不手写偏移。
4. **美股节假日**：内置 NYSE 休市日表（覆盖 2026 / 2027，含 13:00 提前收盘日）；代码注释写明每年需更新，并用测试断言当前年份在覆盖范围内。
5. **锚点时间**：用扫描的 `anchor`（缺省 `Date.now()`）判断是否开盘，历史锚点扫描同样按当时的时段过滤，行为可复现。
6. **可见性**：扫描结果里带上被跳过的标的，UI 显示「已跳过 N 个休市标的（美股 X / 韩股 Y …）」，避免用户以为扫描漏了东西。
7. **OKX 数据源不变**：OKX 没有 TradFi 永续，`OkxTickerSource` 不提供类别 → 一律视为无时段限制。

## Requirements

### R1. 标的类别识别

- 新增币安 `fapi/v1/exchangeInfo` 元数据读取：拉取全量 symbol，输出 `symbol → 市场类别` 的映射，进程内缓存（TTL 6 小时）+ in-flight 合并，避免重复消耗请求权重。
- 映射规则：`COIN`/`INDEX` → 加密（无时段）；`EQUITY` → 美股；`HK_EQUITY` → 港股；`KR_EQUITY` → 韩股；`CN_EQUITY` → A 股；`COMMODITY` → 商品（无时段）；`PREMARKET` → 无时段；未知/缺失 → 无时段（保守：继续扫）。
- 拉不到元数据（网络失败/非数组）时**降级为不过滤**，扫描照常跑完，不因元数据失败中断选币。

### R2. 市场时段判定（domain 纯函数）

- 支持的市场与时段（均为本地时间，含午休）：
  - 美股：09:30–16:00（`America/New_York`），周一至周五，扣除 NYSE 节假日；提前收盘日为 09:30–13:00。
  - 港股：09:30–12:00 + 13:00–16:00（`Asia/Hong_Kong`），周一至周五。
  - 韩股：09:00–15:30（`Asia/Seoul`），周一至周五。
  - A 股：09:30–11:30 + 13:00–15:00（`Asia/Shanghai`），周一至周五。
  - 加密 / 商品 / Pre-IPO：恒为开盘。
- 时区换算用 `Intl.DateTimeFormat` + IANA 时区，夏令时自动正确（3 月/11 月切换日要覆盖测试）。
- 判定区间为左闭右开 `[start, end)`。

### R3. 扫描接入

- `CoinScanService.scanShrink` 用 `anchor` 时刻判断每个 ticker 的市场是否开盘，休市的直接剔除。
- 被剔除的标的不进入 `topN` 切片、不发 K 线请求（省掉 topN×5 的请求预算）。
- 响应用 `skippedInstruments: string[]`（被跳过的 instrument 列表）回传；为空时该字段可省略。

### R4. UI 提示

- 选币面板在结果里显示一行「已跳过 N 个休市标的」及被跳过的 instrument 名称（列表过长截断 + title 提示），仅在 N > 0 时显示。

### R5. 术语与文档

- `CONTEXT.md` 补充术语：**TradFi Instrument（传统市场合约）**、**Market Session（交易时段）**、**Session Gating（休市跳过）**，并更新 Coin Scan / Shrink Method 条目说明扫描池排除休市标的。

## Acceptance Criteria

1. 美股休市时段（如北京时间周二 08:00 = 美东周一 20:00，或周六周日）扫描：结果里不含 `TSLAUSDT/NVDAUSDT/MSTRUSDT` 等 `EQUITY` 合约；`XAUUSDT`、`BTCUSDT` 仍在。
2. 美股开盘时段（美东周一 10:00）扫描：美股合约正常出现在扫描池并参与排序。
3. 休市的美股合约不占用 `topN` 名额：`topN=60` 且池子里有 19 个休市 TradFi 时，实际进入扫描的加密合约数量与「没有这些 TradFi」时一致。
4. 历史 `anchor` 扫描（如锚到上一个周六）同样按该时刻的时段过滤。
5. 美股节假日（如 2026-12-25）全天判定为休市；提前收盘日 13:00 后判定为休市、13:00 前为开盘。
6. 夏令时切换前后，美股开盘对应的 UTC 小时从 13:30 变到 14:30（或反向），判定跟着变。
7. 元数据请求失败时，扫描结果等同改动前（不过滤），且不抛错。
8. `npx vitest run` 全绿；`npx tsc --noEmit` 无新增错误。
