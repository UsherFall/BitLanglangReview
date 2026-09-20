# Implement — 缓存只存已收盘 K 线

前置：AC 见 `prd.md`，判定依据与推演见 `design.md`。

## 0. 备份与基线

- [ ] 备份缓存库：`cp data/review.sqlite data/review.sqlite.bak-20260920`
- [ ] 记录基线（预期 5 根不一致，全在 BTCUSDT 2026-09-17）——重跑 design.md 引用的交叉校验脚本，存下输出以便和修复后对比。
- [ ] 确认 dev server 已停（数据清理阶段需要独占写）。

## 1. Binance 源

- [ ] `src/server/binance-candles.ts`：fetch 之后、`toCandlestick` 之前，按 `Number(row[6]) < Date.now()` 过滤未收盘行；`rows` 仍要防非数组。
- [ ] 同步更新该文件顶部/`earlier` 语义的注释：说明"未收盘 bar 不落库、也不返回"，并写清这与 09/10 "包含锚点所在 bar" 的决策不冲突（历史锚点的那根必然已收盘）。
- [ ] `coversAnchorBar`：把比较基准改成 `Math.min(request.anchor, Date.now() - step)`，并补注释说明未收盘 bar 缺席是合法的；保留 `<= spacing` 与"spacing 取自缓存 run"的现有写法。

## 2. OKX 源

- [ ] `src/server/candlestick-service.ts`：`response.data` 过滤 `row[8] !== '0'`；补注释说明未知取值按已收盘处理的理由（宁可漏挡不可误挡）。
- [ ] 更新该文件 `isCacheFresh` 上方注释里"缓存只存终值"的不变量表述。

## 3. 测试

- [ ] `tests/binance-candles.test.ts`
  - [ ] AC1：`earlier` 的 fixture 里放一根 `closeTime >= now` 的行（用 `nowBoundary` 现算 openTime，别写死），断言它既不在返回值里、`store.listAfter` 也查不到。
  - [ ] AC3：`1M` 场景——`openTime + 30 天 < now` 但 `closeTime > now` 的行必须被丢弃（守住不能用名义步长这一点）。
  - [ ] AC5：live 锚点连续两次 `earlier` 只回源一次（`fetchJson` 调用次数断言）。
  - [ ] AC6：历史锚点 + 锚点所在 bar 已收盘时，该 bar 仍在返回值里（现有 "returns the bar CONTAINING a non-aligned earlier anchor" 用例已覆盖，确认不被改动破坏即可）。
- [ ] `tests/candlestick-cache.test.ts`
  - [ ] AC2：一行 `confirm='0'` 不入库、一行 `confirm='1'` 入库；再加一行 6 字段（无 `confirm`）的老形态，断言仍入库（R4 的宽松分支）。
- [ ] fixture 提醒：现有 `kline()` 辅助函数已经写了 `closeTime = openTime + 5min` 且时间戳是 2022 年，属于"已收盘"，不要为了让新用例通过而改动它。

## 4. 验证

- [ ] `npx vitest run tests/binance-candles.test.ts tests/candlestick-cache.test.ts`
- [ ] 回归相邻用例：`npx vitest run tests/review-candle-source.test.ts tests/candle-fetch.test.ts tests/coin-scan-service.test.ts tests/market-heat-service.test.ts`
- [ ] `npx tsc --noEmit`
- [ ] 已知问题：本机全量 `npm test` 长期全红（vitest 4.x 的 `@vitest/runner` 双模块实例，与业务改动无关），不要为它回滚代码；判断标准是上面的目标用例全绿。

## 5. 数据清理（不可逆，需确认后执行）

- [ ] 精确删除 5 行（`data/review.sqlite`）：

```sql
delete from candles where instrument = 'BTCUSDT' and (
  (timeframe = '15m' and timestamp = 1789...  -- 2026-09-17T12:00:00Z
)
```

  实际执行前用查询把 5 行先 select 出来核对（`15m@2026-09-17T12:00Z`、`1H@2026-09-17T01:00Z`、`1H@2026-09-17T12:00Z`、`4H@2026-09-17T00:00Z`、`1D@2026-09-17T00:00Z`），再按 `(instrument, timeframe, timestamp)` 逐行删。
- [ ] 删完立刻重跑交叉校验脚本：不一致数应为 0（此时脏行不存在，脚本会跳过这些 bar）。
- [ ] 启动 dev server，打开 BTC 图表并翻到 9-17：确认断线消失、窗口自动补齐；再次重跑交叉校验脚本，确认重新拉取的 5 根与真值一致（AC7）。

## 6. 收尾

- [ ] 更新 `.trellis/spec/server/market-data.md`：在 "Binance Candles" 与 "Candlestick Service" 两节补"**缓存只存已收盘 bar**"的最终态不变量、`closeTime` / `confirm` 判定方式、以及 `coversAnchorBar` 为何用 `min(anchor, now - step)`。
- [ ] 提交（代码 + 测试 + spec；`data/*.sqlite` 不入库，确认 `.gitignore` 已覆盖）。

## 回滚点

- 步骤 1/2/3 随时可 revert。
- 步骤 5 不可逆（删行），因此先备份；回滚 = 用备份覆盖 `data/review.sqlite`。
