# 回溯复盘改用币安行情源 — 实施计划

## 前置

- [ ] 读 `src/server/binance-instrument-metadata.ts`（`symbolStatuses` 已有 `exchangeInfo` 读取，确认能否复用而非再拉一次）
- [ ] 读 `tests/chart-time.test.ts`、`tests/candlestick-cache.test.ts` 现有网格断言
- [ ] 读 `binance-candles.ts` 私有的 `boundaryAnchor` 与 `coversAnchorBar`

## Step 1. 时间轴网格（先做，前后端必须同一次改完）

- [ ] `chart-time.ts` `floorTimestamp`：`1D` / `1M` 去掉 `-8h`；`1W` 改用新 helper 按日历算周一 00:00 UTC
- [ ] `candlestick-service.ts` `boundaryAnchor`：同步去掉 `1D` 的 `-8h`
- [ ] 写一个测试同时锁定 `floorTimestamp` 与 `boundaryAnchor`：`1D`/`1W`/`1M` 对同一时间戳给出**相同**边界；`1W` 落在周一 00:00 UTC
- [ ] 跑 `tests/chart-time.test.ts`、`tests/candlestick-cache.test.ts`，按新网格更新旧断言

## Step 2. 服务端币安入口

- [ ] `review-candle-source.ts` 新增 `fetchBinanceOnlyCandles`：不做符号转换、不做 OKX 回退、错误原样上抛
- [ ] `app-plugin.ts` `/api/candles` 增加 `source=binance-only` 分支
- [ ] 新建 `src/server/binance-instrument-service.ts`：`exchangeInfo` → `quoteAsset=USDT` + `status=TRADING`，**不限 `contractType`**
- [ ] `/api/free-replay/instruments` 改注入币安服务；确认 `exchangeInfo` 失败走已有的 502 分支
- [ ] 检查 `exchangeInfo` 是否已有缓存（避免与 `symbolStatuses` 重复拉取加重限频）

## Step 3. 前端接入

- [ ] `App.tsx` `FreeReplayChart` 的 `fetchCandles` 加 `source=binance-only`
- [ ] `App.tsx` 回溯模式 `OtherCoinChart` 的 `fetchCandles` 加 `source=binance-only`；trade 模式**不加**
- [ ] 确认 `OtherCoinChart` 的 `source` 由父组件 prop 传入，不在组件内写死
- [ ] `App.tsx` `loadEarlierFreeReplayCandles` 与预取 effect 的两处 `fetchCandles` 同样加上

## Step 4. 测试

- [ ] `tests/binance-instrument-service.test.ts`（新建）：筛选口径、失败抛错
- [ ] `tests/review-candle-source.test.ts`：新增 `fetchBinanceOnlyCandles` 不回退 OKX、429/418 原样上抛
- [ ] `tests/app-free-replay.test.tsx`：更新请求断言（带 `source=binance-only`）
- [ ] 全量 `npx vitest run`

## Step 5. 收尾

- [ ] `npx tsc --noEmit`
- [ ] 更新 `CONTEXT.md`：`Market Data Source`、`Free Replay Instrument List` 词条
- [ ] 手工验证：回溯复盘选 QNT → 价格约 263.5；1D 日期与币安一致；1W 边界为周一 00:00 UTC
- [ ] 回归交割单复盘（不传 `source` 仍走 OKX）

## 回滚点

- Step 1 独立可回滚（只动两个纯函数 + 测试）
- Step 2–3 耦合：路由加了新 `source` 值，前端加参数，两者需一起回滚
- Step 4 测试失败先判断是实现错还是断言错，不改断言迁就实现
