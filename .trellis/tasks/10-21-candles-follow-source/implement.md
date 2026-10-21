# Implement · K 线按各自行情源走

> 依据：`prd.md` + `design.md`（2026-10-21）。
> 状态：全部完成（570 测试全绿，tsc 干净）。提交：`011f147` / `0c35248` / `4ff3350`。
> 顺序：**源接线 → 回溯复盘 → 个人交割单复盘 → 画线抽屉**。第一步做完就有了可用的 `source=bitget`，后面三步都是"让某个场景用它"。

## Step 0 · 准备

- [x] 读 `.trellis/spec/server/market-data.md`（各源的 K 线约定、缓存命名空间、翻页语义）
- [x] 读 `.trellis/spec/server/coin-scan.md`（选品的两阶段取数与 `posRange` 的 90 根约束）
- [x] 读 `.trellis/spec/frontend/component-guidelines.md`（图表组件与 CandleGrid 约定）
- [x] 确认 `npm test` 基线干净（563 测试）

## Step 1 · `source=bitget` 接进 `/api/candles`（server）

- [x] `src/domain/candlestick.ts`：`CandleSourceId` 加 `'bitget'`
- [x] `src/server/app-plugin.ts`：
  - [x] `/api/candles` 加 `source === 'bitget'` 分支 → `getCandlesForMode({ candleSource: bitgetCandleSource, ... })`
  - [x] **instrument 翻译**：`source=bitget` 时接受 OKX 名（`PEPE-USDT-SWAP`）或 Bitget 名（`PEPEUSDT`），统一成 Bitget 原生符号再请求
  - [x] 翻译函数放 `src/domain/instrument-symbol.ts`：`okxInstrumentToBitgetSymbol(instId)`（`BTC-USDT-SWAP` → `BTCUSDT`；非 USDT 永续 → `null`）
  - [x] `allowPaging: true`（1D 单次只有 90 根，见 design §3.1）
- [x] `src/server/bitget-candles.ts`：**补 `later` 方向的翻页**（现在只有 `earlier`）
  - [x] 与 `fetchEarlierPaged` 对称：`/candles` 取近段 → `/history-candles` 补老段
  - [x] 注意 `/candles` 与 `/history-candles` 的 `endTime` 语义差异（已有注释），游标用 `oldest` 本身
  - [x] `later` 方向的游标是 `newest`
- [x] 测试：
  - [x] `tests/bitget-candles.test.ts`：`earlier` 翻页到 150 根；`later` 翻页；缓存命中时零请求
  - [x] 新增：路由层接受两种 instrument 命名

## Step 2 · 回溯复盘改用 Bitget 源

- [x] `src/ui/free-replay-chart.ts`：
  - [x] `FREE_REPLAY_CANDLE_SOURCE = 'bitget'`
  - [x] `FREE_REPLAY_CANDLE_GRID: CandleGrid = 'shanghai'`（Bitget 日线 16:00Z 开 = 00:00 北京）
- [x] **会话兼容**：
  - [x] `src/server/free-replay-session-store.ts`：表加 `candle_source text`（NULL = 旧行为）；迁移照抄 `drawing-store` 的重建模式
  - [x] `FreeReplaySessionPayload` 加 `candleSource?: CandleSourceId`
  - [x] 旧会话（无 `candle_source`）→ **保持旧行为**（OKX 名 + 币安源）
  - [x] 新会话写入 `candleSource: 'bitget'` + Bitget 名
- [x] `/api/free-replay/instruments?source=bitget`：
  - [x] 用 `bitgetTickerSource.listTickers()` 的 symbol 列表（已有 30s TTL 缓存，不额外请求）
  - [x] `src/ui/FreeReplayPanel.tsx`：请求带上当前会话的源
- [x] **切日影响核对**（`src/ui/chart-time.ts`，逐个确认 grid 传对）：
  - [x] `markerTimeForEvent` / `timeframeTimeForPoint` / `freeReplayCursorTimeForProgress` / `freeReplayCandleCompletionTime` / `entryVisibleRange`
- [x] 测试：
  - [x] `tests/free-replay-panel.test.tsx`：instrument 列表走 Bitget；会话写入 `candleSource`
  - [x] `tests/app-free-replay.test.tsx`：旧会话仍走币安，新会话走 Bitget

## Step 3 · 「个人交割单复盘」改用 Bitget 源

- [x] `src/ui/App.tsx`：`reviewModeBindings.bitget.candleSource = 'bitget'`
- [x] `src/ui/chart-time.ts` / `src/ui/OtherCoinChart.tsx`：`CandleGrid` 映射加 `bitget → 'shanghai'`
- [x] **instrument 翻译在请求层**（存储层不动 → 已有的复盘标注与画线不丢）
  - [x] `src/ui/OtherCoinChart.tsx` / `src/ui/App.tsx` 的图表请求：`source=bitget` 时把 OKX 名翻成 Bitget 名（服务端翻译，见 Step 1）
  - [x] ⚠️ Bitget 没有该币时 → 无 K 线 → **UI 要说出来**（不是静默空白）
- [x] 测试：`tests/app-bitget-mode.test.tsx` 扩 —— Bitget 模式的图表请求带 `source=bitget`

## Step 4 · 画线抽屉跟随扫描源

- [x] `src/ui/CoinScanPanel.tsx`：`source` state 提升到 `App`（加 `onSourceChange` 回调，与 `onScopeChange` 同模式）
- [x] `src/ui/App.tsx`：
  - [x] 持有 `scanSource`
  - [x] 画线抽屉的 `OtherCoinChart` 传 `candleSource={scanSource}`（'binance' | 'okx' | 'bitget'）
  - [x] `initialInstrument` 传扫描行的 instrument（**已经是该源的符号**）
- [x] `src/ui/OtherCoinChart.tsx`：
  - [x] `venue` 支持 `'bitget'` → grid `shanghai`
  - [x] instrument 列表请求带 `source=bitget`
- [x] 测试：`tests/other-coin-chart.test.tsx` 扩 —— `source=bitget` 的 grid 与列表请求

## Step 5 · 收尾

- [x] `npx tsc --noEmit` 干净
- [x] `npm test` 全绿
- [x] 更新 spec：
  - [x] `.trellis/spec/server/market-data.md`：Bitget 源的路由接线、`later` 翻页、切日
  - [x] `.trellis/spec/frontend/component-guidelines.md`：`CandleSourceId` 加 bitget、grid 映射
  - [x] `.trellis/spec/server/coin-scan.md`：画线抽屉跟随扫描源（同源同尺度）
- [x] 记录一条 spec 提醒：**跨源比较"日线形态"没有意义**（币安 UTC 切日 vs Bitget/OKX UTC+8 切日）

## 验证清单（人工）—— 待用户在浏览器里过一遍

- [ ] 选品选 Bitget 源 → 画线抽屉是 Bitget K 线
- [ ] 选品选币安源 → 抽屉是币安 K 线
- [ ] 回溯复盘（新建会话）→ Bitget K 线，往回翻能翻到很久
- [ ] 回溯复盘（旧会话）→ 仍能正常回放
- [ ] 个人交割单复盘 → Bitget K 线，开仓价落在 K 线上（PEPE/SHIB/LUNC 尤其要看）
- [ ] 交割单复盘 → 完全没变

（自动化已覆盖：source=bitget 的路由与改名翻译、`later` 翻页、会话的
`candle_source` 存取与旧会话兼容、抽屉的源上报。实测：选品抽屉与个人交割单
复盘读到的 150 根 K 线**逐根完全一致**（收盘 0.0000045349），切日在
16:00Z = 00:00 北京。）

## 回滚点

| Step | 独立提交 | 回滚代价 |
| --- | --- | --- |
| 1 | `feat(candles): /api/candles 支持 source=bitget` | 低（纯新增路径） |
| 2 | `feat(replay): 回溯复盘改用 Bitget 源` | 中（会话表迁移，但只加列） |
| 3 | `feat(bitget-review): 个人交割单复盘改用 Bitget 源` | 低（改一行绑定） |
| 4 | `feat(scan): 画线抽屉跟随扫描源` | 低 |
| 5 | `docs(spec): 口径同步` | 低 |
