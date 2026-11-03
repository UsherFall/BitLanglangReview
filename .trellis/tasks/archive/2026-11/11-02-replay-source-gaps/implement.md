# 执行计划

## 步骤

1. **自动保存 candleSource 修复**（最小、独立）
   - [x] App.tsx 自动保存 payload 补 `candleSource`。
   - [x] 回归：带源会话 reveal 后 PUT body 含 candleSource；恢复后源保留。

2. **领域助手 + 源映射纯函数**
   - [x] `src/domain/instrument-symbol.ts`：`usdtSymbolToOkxInstrument`。
   - [x] `src/ui/free-replay-chart.ts`：`replayRequestInstrument(instrument, routeSource)`、`replayCandleGrid` 扩为按源映射（okx/bitget→shanghai，binance-only/legacy→utc）。
   - [x] 单测：词汇翻译、网格映射。

3. **开始面板源选择**
   - [x] FreeReplayPanel：`source` 状态 + 三按钮（币安/OKX/Bitget，aria-label 行情源），切源重拉 instruments、重置选中；`onStart` payload 带 `candleSource`（币安→`binance-only`）。
   - [x] app 级测试：选 OKX 源后 instruments 请求带 `source=okx`、开始会话 PUT 带 `candleSource: 'okx'`。

4. **进行中会话切源**
   - [x] App：头部 `<select aria-label="行情源">`（三源 + 当前值）；`switchReplaySource`（重算 dataAnchor/startCursor/cursor 新网格、清 candles、清 orderFocus）。
   - [x] FreeReplayChart 初始加载 effect 依赖 + rangeKey + previousRangeKey 加 `replay.candleSource`；四处 fetch 的 instrument 走 `replayRequestInstrument`。
   - [x] app 级测试：切源后 candles 请求带新 `source=`、instrument 翻译（OKX 源下 `BTCUSDT→BTC-USDT-SWAP`）。

5. **洞回填脚本**
   - [x] `tools/backfill-candles.ts`（扫描/取数/写库/dry-run，按 design 的命名空间→源映射）。
   - [x] 脚本级 vitest（`tests/backfill-candles.test.ts`：洞区间计算、分块逻辑用注入 fetch 的假交易所）。
   - [x] 在用户库实跑（先 dry-run 看清单，再实跑），验证两 BTC 会话区间 0 洞。

6. **客户端中段洞自愈**
   - [x] `firstGapInRange` 纯函数 + 单测。
   - [x] FreeReplayChart gap-heal effect（可见范围 ∪ 光标前方 20 根；mode=initial 补洞；gapHealKeyRef 去重）。
   - [x] app 级测试：造中段洞 → 触发后收到洞中心的 initial 请求、合并后无洞。

7. **质量门 + 收尾**
   - [x] `npm test` 全绿、`npx tsc --noEmit`。
   - [x] 浏览器手动核对：开始面板选源三态；进行中切源重载；4-9 前后区间无空白；单子/进度跨切源保留。
   - [x] spec 更新：component-guidelines（回溯复盘行情源可选契约、会话源词汇、中段洞自愈）、server/market-data（回填脚本与洞的来源记录）。
   - [x] 提交（fix/feat 分开：自动保存修复+切源特性；脚本+自愈）。

## 验证命令

```bash
npm test
npx tsc --noEmit
npx tsx tools/backfill-candles.ts --dry-run
```

## 回滚点

- 步骤 1 独立可 revert。
- 步骤 2-4 一组（源选择特性）；步骤 5-6 一组（洞治理）。互不依赖（除 2 的翻译函数被 4/6 使用）。

## 风险

- OKX 源下某些 XXXUSDT 形式翻译后无对应 instId（如 1000x 面值合约）→ 图表空窗口（可见失败，符合「不静默换所」）；列表本身按源给出，多数用户从列表选。
- 回填脚本对 Bitget 不可达的深历史洞（如 5m 2023-03）会跳过并记录——BTC 5m 的三月洞在 Binance 侧可补（裸命名空间），bitget 1H 洞 Bitget history 可达（缓存已有 2021-09 数据佐证）。
- 切源后 1D/1W 光标随网格重算 ±8h 属预期（日界不同）。
