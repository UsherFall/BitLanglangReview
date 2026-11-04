# Design：切周期首锚等新数据 + 焦点单不跨周期

## 现状与根因

### 根因 1：首锚发生在旧周期数据上（`src/ui/App.tsx` FreeReplayChart）

切周期（`switchFreeReplayTimeframe`）后的同一个 commit 里：

1. rangeKey effect（~L1760）：重置 `initializedRangeKeyRef=''`，异步 `loadCursorInitialWindow()`。
2. 渲染 effect（~L1853）**同 commit 立刻跑**：`renderedCandles` 仍是旧周期数据（加载不会先清空它），`visibleCandlesForFreeReplay` 只按时间过滤不校验周期 → 列表非空 → `initializedRangeKeyRef` 被消费，并在旧数据 series 上 `timeToIndex(cursorTime)` 锚定。
3. 新数据落地后再渲染：`initializedRangeKeyRef === rangeKey` → 不重锚；LWC `setData` 保留 logical range。

→ 锚定索引自旧周期数据，套在新数据上含义全变（5m→1h 差 12 倍）。会话切换（同周期不同 session）同样踩这个坑。

### 根因 2：焦点单跨周期存活（10/29 R3 设计）

`switchFreeReplayTimeframe` 不清 orderFocus → 焦点 effect（~L1984）在新周期重新取窗锚开仓点。用户决策：回溯模式切周期一律回右缘。

## 方案

### Fix A：首锚只认当前 rangeKey 的数据

给渲染数据打 rangeKey 标记：

- 新增 `renderedRangeKeyRef`。`publishActive(..., { render: true })`（唯一把取数结果交给渲染的入口）里同步 `renderedRangeKeyRef.current = rangeKeyRef.current`。
- 渲染 effect 的首锚守卫从：

  ```ts
  if (visibleCandles.length && initializedRangeKeyRef.current !== rangeKey)
  ```

  改为：

  ```ts
  if (visibleCandles.length && initializedRangeKeyRef.current !== rangeKey && renderedRangeKeyRef.current === rangeKey)
  ```

  旧数据（rangeKey 不匹配）不消费 `initializedRangeKeyRef`，新数据落地那一帧才锚定—— timeframe 与会话切换都天然覆盖，不需要清空 `renderedCandles`（避免加载期间整屏空白闪变）。

- 边界：`render: 'defer'` 的推迟渲染（`flushPendingInstallRender` 直接 `setRenderedCandles(activeCandlesRef.current)`）不改标记——拖动追加页属于同一 rangeKey 的数据生长，标记仍是该 rangeKey，语义不变。

### Fix B：切周期清焦点

`switchFreeReplayTimeframe` 内加 `setOrderFocus(null)`（与 `dataAnchorTime`/`cursorTime` 同一次 setState 批次）：

- 退出焦点 effect（10-30）接管：`wasFocusedRef` 路径把活动数据集切回游标数据集；`cursorCandles[0].timeframe !== timeframe`（必然，旧周期数据）→ `loadCursorInitialWindow()`，与 rangeKey effect 的在飞请求被 `cursorInitialKeyRef` 去重，不会重复取。
- 剪刀 effect：`focusRequest` 变 null → `setHideAfterFocus(false)`，开仓点前视图复位。
- 新数据落地 → Fix A 守卫通过 → `anchorViewportToCursor`（光标右缘 + 10 根缓冲）。

### 不改的部分

- 焦点单取窗、拖动推迟渲染、历史回填、未来预取、洞自愈：均按 rangeKey/焦点态各自的既有闸门运转，Fix A 只收紧首锚条件。
- 交割单复盘（`OtherCoinChart`/交割单图表）不走 FreeReplayChart，零影响。

## 权衡

- **清焦点 vs 保留焦点重锚右缘**：后者会留下"行高亮但视图在光标"的状态错位，且剪刀态语义复杂化。选清焦点——重新看单子只需再点一次行（token 递增归位，10/29 现场场景保住）。
- **数据 rangeKey 标记 vs 清空 renderedCandles**：清空会带来加载期空白闪变，且 `candlestickAtTime` 等守卫路径都要重验；标记法改动面最小、语义直白。

## 兼容性 / 回滚

- 行为变化只有一处：切周期后焦点单不再存活（测试 `keeps the order anchor across timeframe switches` 改写新契约）。
- 回滚 = revert 单个 commit，无数据迁移、无存储格式变化。

## 测试策略

- LWC 全 mock（`tests/app-free-replay.test.tsx` 现有基建）：`timeToIndex`/`setVisibleLogicalRange`/`setVisibleRange` 均可断言。
- 新增/改写用例见 implement.md。
