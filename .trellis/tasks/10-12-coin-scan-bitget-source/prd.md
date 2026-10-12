# PRD: 选品扫描切换 Bitget 行情源

## 背景

选品扫描（`CoinScanService.scanShrink`）当前默认走 Binance USDT-M 永续（`MARKET_DATA_SOURCE=binance`），可切 OKX（`=okx`）。Binance 路径在国内网络下频繁触顶：weight 限额（klines weight 2、2400/min）迫使 110ms 全局 pacer（~9 req/s），且 429→418 升级封禁风险真实发生过（09-14 诊断任务）。用户要求把选品接口换成 Bitget 源。

2026-10-12 对 Bitget v2 公开行情实测（全部免鉴权）：

- `GET api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES`：一次返回全部 820 个 USDT 永续，含 `lastPr` / `change24h` / `usdtVolume`
- `GET api.bitget.com/api/v2/mix/market/candles?productType=USDT-FUTURES&symbol=X&granularity=1H&limit=N`：`[ts,o,h,l,c,baseVol,quoteVol]`，limit 至 1000，支持 `startTime/endTime`
- 限频：150 发 30 并发零 429；响应头 `X-MBX-USED-REMAIN-LIMIT: 19` 暗示名义 20 次/秒/IP；持续 10 并发 20s 出现软限速（单请求 ~2s，无 429）——必须加保守 pacer
- 历史深度：1D ≥ 2 年；5m 为滚动窗口约 3-4 个月
- granularity：mix 用大写 token（`1H/4H/1D`），与项目 `ReviewTimeframe` 取值 1:1 吻合

## 需求

1. `MARKET_DATA_SOURCE=bitget`（及插件选项）将选品扫描的 ticker 与 candle 数据源切换为 Bitget USDT-FUTURES，默认值不变（binance）。
2. 扫描语义完全不变：池子（成交额门槛 → 池策略 → scope → 休市剔除 → topN）、5 个时间框架、收敛判定、排序、响应结构全部与数据源无关层保持一致。
3. 字段映射正确：`change24h` 为百分数（Bitget 给的是小数，需 ×100）；`quoteVolume24h` 为 USDT 计价 24h 成交额。
4. **缓存键命名空间隔离**：Bitget candle 写入共享 SQLite store 的键必须带源前缀，杜绝与 Binance `base+USDT` 键撞车（已退休的 Bitget 源正是因此产生重复日线，见 `binance-candles.ts` 头部警告）。
5. 限频处理保守且可见：请求起点加 pacer（对齐名义 20 次/秒）；429 以用户可见警告透出并全局退避，不静默拉长扫描。
6. 错误信息可读：行情错误（`code != 00000`）、网络/超时均有明确文案，路由层 502 路径不变。

## 约束

- Bitget 公开行情免 API key；不发签名请求。
- Bitget 日/周/月 K 线开在 UTC+8 边界（与 OKX 同、与 Binance 的 UTC 0:00 不同），边界数学需带 -8h 偏移。
- 单次 candles 请求 `startTime~endTime` 跨度上限 90 天。
- 5m 等日内历史仅约 3-4 个月滚动窗口：刷新扫描（最近 100-200 根）无影响；超出窗口的锚定历史扫描返回空。
- Bitget ticker 不带 instrument 分类 metadata → 无 `marketClass` → 按加密处理（永远开盘）；**equity（股票）scope 在 Bitget 源下为空结果**，属预期。
- 市场热度（market heat）保持 Binance 不变。
- 延迟预期：实测本机到 Bitget 单请求 ~0.5-2s（含 TLS 全握手；进程内连接复用会低很多）。一次冷扫描 150×5=750 请求、并发 5，预计 1-3 分钟。

## 验收标准

- AC1：`MARKET_DATA_SOURCE=bitget` 启动后，加密 scope 扫描返回非空结果行；instrument 为 Bitget 原生 symbol；`change24h` 为百分数量级；`quoteVolume24h` 与 Bitget tickers 的 `usdtVolume` 一致。
- AC2：单测覆盖——ticker 映射（×100、稳定币剔除、排序、有限性过滤）、candle URL/参数（productType/symbol/granularity/limit/endTime、later 方向 90 天钳制）、**store 键带 `bitget:` 前缀**（撞键回归测试）、收盘 bar 过滤、`code != 00000` 错误、缓存新鲜度门。
- AC3：`npm test` 全绿，binance/okx 路径无回归。
- AC4：bitget 模式下一次扫描不产生任何 fapi.binance.com 请求，响应不携带币安限频警告。
- AC5：mock 429 时扫描响应出现可读警告且流水线退避（复用既有 gate 机制）。
- AC6：不设环境变量时行为与当前完全一致（默认 binance）。

## 非目标

- 不把市场热度、复盘图表、free replay 切到 Bitget。
- 不实现 equity scope 的 Bitget 支持（无 metadata 来源）。
- 不做 legacy 未前缀化历史数据的清理/迁移。
