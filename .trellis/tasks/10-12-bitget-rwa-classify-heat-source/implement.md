# Implement: Bitget 标的分类与热度切源

步骤 1-2 是分类链，3 是 ticker 挂载，4 是热度接线，5 验证，6 spec。每步独立可回滚。

## 步骤

- [x] 1. `src/domain/bitget-market-class.ts` + `tests/bitget-market-class.test.ts`
  - [x] `bitgetMarketClass(isRwa)`：`'NO'→CRYPTO`、`'YES'→US_EQUITY`、其余（undefined/空/异常值）→`undefined`
  - [x] 表驱动测试四种输入
  - [x] 验证：`npx vitest run tests/bitget-market-class.test.ts`
- [x] 2. `src/server/bitget-instrument-metadata.ts` + `tests/bitget-instrument-metadata.test.ts`
  - [x] `BitgetInstrumentMetadataSource`：拉 `contracts?productType=USDT-FUTURES`，映射 symbol→class（经步骤 1 纯函数，undefined 不入 map）
  - [x] 6h TTL + in-flight 去重；失败/非数组/无 data → 空 map 不抛错
  - [x] 模块级共享工厂 `bitgetInstrumentMetadata()`（仿 `binanceInstrumentMetadata()`）
  - [x] fetcher 走 `defaultBitgetMarketFetchJson`（可注入）
  - [x] 测试：映射、TTL+in-flight、降级三类（throw/非数组/空 data）
  - [x] 验证：`npx vitest run tests/bitget-instrument-metadata.test.ts tests/binance-instrument-metadata.test.ts`
- [x] 3. `src/server/bitget-tickers.ts` 挂分类 + 测试增补
  - [x] 构造增加可选 `metadataSource` 参数（对齐 `BinanceTickerSource` 形状）
  - [x] `fetchAndMap` 并行拉 tickers + metadata；分类 symbol 挂 `marketClass`
  - [x] 实现 `metadataAvailable()`（source 接线且 map 非空）
  - [x] `tests/bitget-tickers.test.ts` 增补：两类挂载、未分类不挂、metadataAvailable 正常/降级
  - [x] 验证：`npx vitest run tests/bitget-tickers.test.ts tests/binance-tickers.test.ts`
- [x] 4. `src/server/app-plugin.ts` 装配
  - [x] `new BitgetTickerSource(undefined, bitgetInstrumentMetadata())`
  - [x] 热度改为 `new MarketHeatService(tickerSource, scanCandleSource)`（删除硬编码币安实例；binance 模式共享语义不变）
  - [x] 更新源选择处注释（热度随源切换）
- [x] 5. 全量验证 + 集成实测
  - [x] `npm test` + `npx tsc --noEmit`
  - [x] `MARKET_DATA_SOURCE` 不设（默认 bitget）起 dev server：
    - [x] 加密 scope 扫描：结果不含 TSLA/NVDA/XAU/SPY 等 RWA 符号（AC1）
    - [x] 股票 scope 扫描：非空、instrument 为 RWA 合约、美股时段内 `skippedInstruments` 为空或仅闭市标的（AC2）
    - [x] `/api/market-heat` 返回 200 且有数据（AC5）
  - [x] `MARKET_DATA_SOURCE=binance` 重启：热度与扫描行为同改动前（AC5/AC6）
- [x] 6. 规格更新
  - [x] `.trellis/spec/server/market-data.md`：Bitget 小节补 isRwa→两类分类、`metadataAvailable`；删掉"无 instrument metadata"的旧表述
  - [x] `.trellis/spec/server/market-heat.md`：重写 "Always Binance, independent of MARKET_DATA_SOURCE" 为随源切换
  - [x] `.trellis/spec/server/coin-scan.md`：股票 scope 在 Bitget 源下可用的表述更新（两类分类后不再为空）

## 验证命令

```bash
npx vitest run tests/bitget-market-class.test.ts tests/bitget-instrument-metadata.test.ts tests/bitget-tickers.test.ts tests/market-heat-service.test.ts
npm test
npx tsc --noEmit
# 集成：默认(bitget)起 dev server，扫加密/股票两个 scope + /api/market-heat
```

## 评审门

- 步骤 3 后：分类挂载测试必须覆盖"未分类 symbol 不挂 class"（metadata outage 语义）
- 步骤 5 后：全绿 + tsc + 两个 scope 的集成实测通过才提交

## 回滚点

- 每步独立 file 级 revert；无 schema / 数据迁移
- 运行期 `MARKET_DATA_SOURCE=binance` 即旧行为
