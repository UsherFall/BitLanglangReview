# 统一复盘行情源与 Candle Grid 上下文

## Goal

让 Free Replay 主图和 Other Coin Panel 对同一个 Free Replay Session 使用完全一致的行情请求源与 Candle Grid，并让 Instrument List 使用对应 venue 的标的词汇，消除 OKX 或旧 Binance Session 下其他币图回落到默认 Bitget 的跨源风险。

## User Value

复盘者在主图和其他币图上看到的是同一时刻、同一 venue、同一日界的价格结构；不同交易所的价格与 Candlestick 不再被隐式混用，画线、Cursor 和 Review Window 有一致的市场语义。

## Confirmed Facts

- `src/ui/App.tsx:1690,2150,2189,2219,2263,2277` 的 Free Replay 主图通过 `replayCandleSource(replay)` 获取请求源，并通过 `replayCandleGrid(replay)` 获取日界。
- `src/ui/App.tsx:1104-1111` 渲染 Free Replay 的 `OtherCoinChart` 时没有传 `candleSource`。
- `src/ui/OtherCoinChart.tsx:84-92` 在 Replay 模式调用 `replayCandleSource(null)`，该调用按 `src/ui/free-replay-chart.ts:66-72` 返回当前默认 Bitget，而不是正在恢复的 Session 源；同一文件还把 venue 与 requestSource 视为同一个值。
- `src/domain/candlestick.ts:13` 的 `CandleSourceId` 不含 `binance-only`，而 `src/ui/free-replay-chart.ts:34` 的 `ReplayCandleSource` 含它，导致 Other Coin Panel 无法类型安全地继承旧 Binance Session。
- `CONTEXT.md:51-58,131-133` 要求 Other Coin Panel 始终与宿主图使用同一 Market Data Source 和 Candle Grid；Binance 使用 UTC 日界，OKX / Bitget 使用 Shanghai 日界。
- `tests/free-replay-chart.test.ts:103-109` 已覆盖 Session grid helper，但现有 App 测试没有覆盖“恢复 Session 后打开 Other Coin Panel”的组合路径，因此当前 686 个测试通过并不能排除上述跨源风险。
- 详细调用链、兼容矩阵和测试盲区见 `research/current-state.md`。

## Requirements

- **R1 — 单一映射。** 为图表使用的 source 值建立唯一、纯函数式映射，明确区分 Instrument List 使用的 venue、`/api/candles` 使用的 requestSource 和图表使用的 Candle Grid；不得再把三者靠分散三元表达式推导。
- **R2 — 主图接入。** FreeReplayChart 的所有 Candlestick 请求和需要 Candle Grid 的计算都读取该映射；`binance` 与 `binance-only` 必须保持两种不同的 requestSource，不得互相改写。
- **R3 — Other Coin Panel 继承 Session。** App 必须把 `replayCandleSource(freeReplay)` 显式传给 Free Replay 的 Other Coin Panel；Other Coin Panel 不得再通过 `replayCandleSource(null)` 猜测当前 Session。
- **R4 — Instrument List 同源。** Other Coin Panel 的 `/api/free-replay/instruments` 使用映射后的 venue：Binance 与 `binance-only` 都请求 `source=binance`，OKX / Bitget 分别请求自身 source。
- **R5 — 兼容旧行为。** 无 `candleSource` 的旧 Session 仍恢复为 `binance-only` + UTC；新 Replay 默认仍为 Bitget + Shanghai；单独渲染 OtherCoinChart 且未传 source 时，Replay 默认 Bitget、非 Replay 默认 OKX 的现有行为不变。
- **R6 — 不改路由与存储。** `/api/candles`、`/api/free-replay/instruments` 的现有词表和 Session SQLite 格式保持兼容，不做数据迁移，不增加新 venue。
- **R7 — 回归覆盖。** 增加纯映射测试和 App 组合测试，覆盖 OKX、旧 Binance、Bitget；至少一个 Other Coin Chart 测试用独立计算的字面时间断言旧 Binance 的 1D Review Window 使用 UTC 而非 Shanghai。
- **R8 — 保留 Replay 不变量。** 不改变 future 隐藏、预取、reveal / rewind、Timeframe Switch、Chart Navigation Anchor、Chart Drawing board 或 Paper Trading 行为。

## Acceptance Criteria

- [x] **AC1 / R1,R2：** 对 `binance`、`binance-only`、`okx`、`bitget` 的纯映射测试分别验证 venue、requestSource、grid；其中 `binance` 仍为 `binance`，`binance-only` 仍为 `binance-only`，二者 grid 都是 UTC。
  - 证据：`tests/chart-market-context.test.ts`（四行矩阵 + 二者不合并断言）。
- [x] **AC2 / R2,R3,R4：** 从 OKX Free Replay Session 打开 Other Coin Panel 后，主图与面板的 Candlestick 请求都带 `source=okx`，面板的 Instrument List 也带 `source=okx`，没有默认 Bitget 请求混入。
  - 证据：`tests/app-free-replay.test.tsx` 的组合用例（OKX 行）。
- [x] **AC3 / R3,R4,R5,R7：** 恢复无 source 或显式 `binance-only` 的旧 Session 后，主图与面板 Candlestick 请求都带 `source=binance-only`，Instrument List 带 `source=binance`；面板 1D 初始 Review Window 按 00:00Z 日界计算，而不是 00:00 Beijing。
  - 证据：`tests/app-free-replay.test.tsx` 的显式/隐式 `binance-only` 两行；`tests/other-coin-chart.test.tsx` 的 1D UTC 用例（独立计算 00:00Z ±150 根）。
- [x] **AC4 / R2,R3,R4,R5：** 新建或恢复 Bitget Session 时，主图与面板继续使用 `source=bitget` 和 Shanghai grid；独立 OtherCoinChart 的既有默认 source 测试保持通过。
  - 证据：组合用例的 Bitget 对照行；`tests/other-coin-chart.test.tsx` 既有默认 source 用例未改动。
- [x] **AC5 / R5,R6：** 现有非 Replay 的 OKX、Bitget、`binance` OtherCoinChart 调用保持原请求策略；不得把 `candleSource="binance"` 的旧断言批量改成 `binance-only`，也不得修改服务端 candidate-chain 行为。
  - 证据：既有 `candleSource="binance"` 断言保持原样并通过；`src/server` 无改动。同一 venue 下 `binance` → `binance-only` 请求策略切换会重新取窗（`tests/other-coin-chart.test.tsx` 的 `reloads when the request policy changes under the same venue`，两次 initial 分别为 `binance` / `binance-only`，Instrument List 不重取）。
- [x] **AC6 / R8：** `tests/free-replay-chart.test.ts`、`tests/other-coin-chart.test.tsx`、`tests/app-free-replay.test.tsx`、`tests/chart-time.test.ts` 全部通过，future 隐藏、预取和 Cursor 行为无回归。
  - 证据：返修后 focused 5 个文件 / 115 tests 通过；`npm test` 全文 76 files / 694 tests 通过。
- [x] **AC7：** 完整 `npm test`、`npx tsc --noEmit` 和 `git diff --check` 通过；最终 diff 仅包含本任务所需代码、测试、任务文档和相关 spec。
  - 证据（返修后）：`npm test` 76 files / 694 tests 通过；`npx tsc --noEmit` 通过；按 `research/review-findings.md` 设置 `git config core.whitespace cr-at-eol` 后，plain `git diff HEAD --check` 退出 0（未归一化整文件、未删除检查）；diff 仅含 domain / ui / helper / tests / spec / task 文件。分支已登记为 `feat/replay-market-context`（`task.py set-branch`）。

## Out of Scope

- Free Replay Dataset、Session 生命周期、SQLite 原子删除、路由拆分等后续架构子任务。
- 修改 `/api/candles` 的 candidate-chain、fallback、缓存、分页或错误处理。
- 把现有 `source=binance` 的 native-symbol panel 问题一并修掉；该问题在父任务中记录为独立 deferred finding。
- 引入全局状态库、通用图表框架、新依赖、新 venue 或 Session schema 迁移。
- 全仓清理测试 `act(...)` 警告、mojibake 或依赖版本。
