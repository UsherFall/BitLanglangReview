# Design：回溯复盘点单焦点窗口 = 双数据集整窗替换

## 一句话

把「焦点态」从 **merge 进游标数据集** 改成 **切换到独立数据集**：游标数据集只服务 App（模拟交易当前价）与步进/回光标，焦点数据集只服务渲染与翻页；同一份渲染数据里永远只有一个连续窗口。

## 为什么不是「把 TradeChart 拼过来」

`TradeChart` 是「一单 = 一次整窗替换」的查看器（`trade.id` 变 → 清空重挂 → 一次 `mode=initial` → `setVisibleRange(entryVisibleRange)`），没有游标/步进/会话。它可复用的是**语义**（单窗口 + `entryVisibleRange` 锚定），不是组件。所以做法是把这套语义移植进 `FreeReplayChart`，而不是复用组件。

## 数据模型

`FreeReplayChart` 内新增/替换以下 ref（原 `loadedCandlesRef` 语义变为「**活动数据集**」）：

| ref | 含义 | 谁消费 |
|---|---|---|
| `cursorCandlesRef` | **游标数据集**：锚在 `cursorTime` 的连续窗口 | `onCandlesLoaded` → App 的 `freeReplayCandles`（`currentCursorCandle`/浮盈/开平仓可用性）、步进的 `previousFreeReplayCursor` |
| `focusCandlesRef` | **焦点窗口**：以开仓点为中心的一次 `mode=initial`，连续 | 仅渲染与焦点态翻页 |
| `activeCandlesRef`（即原 `loadedCandlesRef`） | 当前活动数据集 = 焦点态 ? `focusCandlesRef` : `cursorCandlesRef` | 渲染、历史回填、未来预取、earlier/later 翻页、绘图 overlay 坐标 |

不变式：

1. **任何一份数据集内部都必须连续**（相邻两根时间差 = 一个 step）。禁止再出现 `mergeCandles(游标窗口, 焦点窗口)` 这类跨空洞拼接。
2. `onCandlesLoaded`（即 App 的 `freeReplayCandles`）**只喂游标数据集**。焦点态下不发布活动数据集 → R2 自动成立：焦点期间 App 仍持有游标窗口，`currentCursorCandle` 照常可用。
3. `focusCandlesRef` 与 `cursorCandlesRef` 互不覆盖；切换活动数据集时必须同时 `setLoadedCandles` + `setRenderedCandles`，否则渲染 effect 会读到旧数组。

## 状态切换

焦点事实来源仍为 `focusRequest: { timeMs, token } | null`（App 的 `orderFocus`，临时状态，不落盘）。`focusActive` 由 `focusRequest != null` 派生。

### 进入/切换焦点（`focusRequest.token` 或 `rangeKey` 变化）

1. 若此前非焦点态：`cursorCandlesRef.current = activeCandlesRef.current` 在**切换前**备份游标数据集。
2. 发一次 `mode=initial`，`entryTime = new Date(timeMs).toISOString()`，`source = replayCandleSource(replay)`，`timeframe` = 当前周期；用 `replayCandleGrid(replay)` 算 `entryVisibleRange`。
3. `focusCandlesRef.current = mergeCandles(response)`（**单个响应内部已由服务端保证连续**）；设为活动数据集；`setVisibleRange(entryVisibleRange)`。
4. 去重键仍为 `rangeKey:token`（`focusWindowKeyRef`）。**切周期不改 token**，但 `rangeKey` 变 → 新键 → 用新周期重新取窗并重新锚定（10/29 契约：焦点跨周期存活）。
5. 取窗失败/空：退化为「贴游标数据集最早边缘」，不循环重试。

与旧实现的差异：**不再判断「开仓点是否已在已加载窗口内」**——一律重取一次窗口。这样焦点态的渲染数据集恒定 = 一个连续窗口，不依赖游标窗口的边界，也就没有缝。代价是每次点单一次请求（旧实现只在窗口外才请求）。

### 退出焦点（`focusRequest` 变 null）

1. `focusActive = false`；活动数据集 ← `cursorCandlesRef.current`，并 `onCandlesLoaded(游标数据集)` 恢复 App。
2. 若游标数据集为空或 `[0].timeframe !== 当前 timeframe`（焦点期间切过周期），**先跑一次标准游标初始加载**再恢复；恢复后才允许锚定视口（见下方时序）。
3. 退出焦点本身不主动跳视口：步进走 10/28 舒适区跟随；「回到光标」（开平仓/点持仓行）由既有的 `cursorReturnToken` effect 跳转。

## Effect 时序与守卫（最容易出错的地方）

同一 commit 内 effect 按声明顺序执行，state 更新要到下一次 commit 才可见，所以：

1. **活动数据集切换 effect 声明在渲染 effect 之前**，且切换即 `setLoadedCandles` + `setRenderedCandles`。
2. **回光标锚定必须等游标 K 线真的在 series 里**：`anchorViewportToCursor` 走 `timeScale().timeToIndex(cursorTime, true)`，数据不对时会退化成 `setVisibleRange`。退出焦点后活动数据集是刚恢复的游标窗口，因此给回光标 effect 加守卫 `candlestickAtTime(activeCandlesRef.current, replay.cursorTime) != null`，并把活动数据集纳入依赖，让它在下一次 commit 重试（否则会拿焦点窗口的索引去锚光标）。
3. **历史回填在焦点态跳过**：`shouldBackfillFreeReplayHistory` 追的是游标；焦点态追错目标。焦点态下清掉 `historyBackfillVisibleBarsRef`/`historyBackfillKeyRef`，避免切周期后残留一次错误触发。
4. **切周期（`rangeKey` 变化）**：焦点态由焦点 effect 负责取新周期窗口；非焦点态由既有的初始加载 + 历史回填负责。两条路都不允许把两个周期的数组合并。
5. **未来预取 / 左右翻页**：作用在**活动数据集**上即可（焦点态 = 焦点窗口，天然满足 R4）。焦点态翻页不调用 `onCandlesLoaded`。
6. **切周期时的过渡守卫**（新周期数据未到）：保留「等 `activeCandlesRef.current[0].timeframe === timeframe` 再锚定」的闸门，但焦点取窗**不受**它限制（取窗结果自己是新周期的，直接替换即可）。

## 边界与风险

- **不再有跨空洞拼接**后，`chartDataWithWhitespace` 只在活动数据集两端补白，中间不会再有假缝。
- 焦点窗口全在游标之前（已完成单的开仓点 ≤ 游标），所以 `visibleCandlesForFreeReplay` 在焦点态不会截断任何东西；不需要额外处理「焦点窗口含未来柱」。
- 焦点态下 App 的 `freeReplayCandles` 是**旧周期/旧窗口**但仍是游标窗口，`paperStats` 仍然正确；退出焦点会刷新。开平仓提交本身触发退出焦点，所以不会用旧周期价格成交。
- `orderFocus` 仍是临时 UI 状态，**不进** `session.payload`。

## 测试策略

新增（`tests/app-free-replay.test.tsx`，需要给共用 chart mock 补 `setData` 捕获）：

1. **无跨越**：恢复会话 → 点最老单（开仓点远离游标，中间隔缓存空洞）→ 最后一次 `series.setData` 的载荷里**每对相邻两根时间差都等于一个 step**（出现跨天/跨周缝即失败）。这是本任务的核心回归。
2. **R2 不退化**：焦点态下 `市价开仓` 仍可用（证明 `currentCursorCandle` 仍由游标数据集供给）。
3. **R3 回光标**：点单 → `下一根` → 视口回到光标且图上立刻有游标附近 K 线；点单 → 点持仓行 → 同样成立。
4. **R3 切周期**：点单 → 切 15m → 仍锚在该单开仓点，且载荷无跨周期缝。

保持绿：10/29 焦点锚定/解除全部用例、10/30 回光标用例、10/30 标记过滤用例、`tests/app-review-progress.test.tsx`（TradeChart 不受影响）。

## 不做

- 不改 `TradeChart`；不预填缓存；不改 paper trading 领域逻辑；不改 10/28 舒适区契约。
