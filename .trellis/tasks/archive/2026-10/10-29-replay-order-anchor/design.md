# 设计：回溯复盘单子面板 Tab 化 + 点单锚定开仓点

## 总览

两个改动面：

1. **面板重组**（`App.tsx` 的 `FreeReplayPaperTradingPanel` + `styles.css`）：头部/统计常显，下面分「操作 / 单子」两个 Tab，Tab 内容区独立滚动。
2. **焦点单锚定**（`App.tsx` 的 `App` + `FreeReplayChart`）：新增「焦点单」状态与图表视口定位通道，并把清除时机接到步进/开平仓/持仓行点击上。

不碰 `free-replay-paper-trading.ts` 的执行规则，不碰 `TradeChart`。

## 焦点单状态（App 层）

```ts
type OrderFocus = { id: string; timeMs: number; token: number } | null;
const [orderFocus, setOrderFocus] = useState<OrderFocus>(null);
```

- `id`：焦点单 id（已完成交易行的 `trade.id`），用于行高亮。
- `timeMs`：锚点时间 = 该交易的 `positionOpenTime`（仓位回合起点，与 `paperTradeMarkers` 的「开」标记锚点一致）。
- `token`：每次点击递增，让"点同一行重新归位"能穿透 FreeReplayChart 的"每次只定位一次"去重。

传递：

- `<FreeReplayChart focusRequest={orderFocus ? { timeMs, token } : null} ... />`（id 不下传，图表只关心时间+token）
- `<FreeReplayPaperTradingPanel focusedOrderId={orderFocus?.id ?? null} onFocusOrder={...} onReturnToCursor={...} ... />`

### 设置与清除

| 动作 | 处理 |
| --- | --- |
| 点已完成交易行 | `setOrderFocus({ id: trade.id, timeMs: trade.positionOpenTime, token: token+1 })` |
| `revealNextFreeReplayCandle` / `rewindFreeReplayCandle`（含键盘） | 清除 |
| `onMarketOpen` / `onLimitOpen` / `onCloseRatio` / `onLimitClose` 提交时 | 清除 |
| 点「单子」Tab 的当前持仓行 | 清除（= 回到光标） |
| `handleFreeReplayStart` / `restoreFreeReplaySession` / `handleDeleteSession` 删当前会话 | 清除 |
| `switchFreeReplayTimeframe` | **不清除**（R3 的要点） |
| 离开 freeReplay 模式 | 已有 `setOtherCoinOpen(false)` 的 mode effect，顺带清除 |

清除只清状态，不主动动视口；之后第一次步进由既有光标跟随 effect（舒适区外最小平移）把视图带回光标。

## FreeReplayChart：视口定位通道

新 prop：`focusRequest: { timeMs: number; token: number } | null`。

### 定位 effect（新增，声明在"初始化/光标跟随"effects 之后）

```ts
useEffect(() => {
  const chart = chartApiRef.current;
  if (!chart || !focusRequest) return;
  const rangeKey = `${replay.instrument}:${replay.startTime}:${timeframe}`;
  if (initializedRangeKeyRef.current !== rangeKey) return;       // 等初始化 effect 先跑
  const focusKey = `${rangeKey}:${focusRequest.token}`;
  if (appliedFocusKeyRef.current === focusKey) return;           // 每次点击只定位一次
  const first = loadedCandlesRef.current[0];
  if (first && focusRequest.timeMs < first.timestamp) {
    // 开仓点早于已加载窗口：追页加载直到覆盖；历史用尽则贴着已加载边缘定位
    if (!earlierExhaustedRef.current) {
      if (!loadingEarlierRef.current) void loadEarlierFreeReplayCandles();
      return;                                                    // 等数据到了再进这个 effect
    }
  }
  appliedFocusKeyRef.current = focusKey;
  const range = entryVisibleRange(new Date(focusRequest.timeMs).toISOString(), timeframe, replayCandleGrid(replay));
  suppressAutoLoadRef.current = true;
  chart.timeScale().setVisibleRange(range as { from: UTCTimestamp; to: UTCTimestamp });
  window.setTimeout(() => { suppressAutoLoadRef.current = false; }, 0);
}, [focusRequest, loadedCandles, renderedCandles, replay.instrument, replay.startTime, timeframe]);
```

要点：

- **复用 `entryVisibleRange`**（chart-time.ts）：开仓点吸附周期网格后 ±150 根，和交割单复盘同一个窗口函数。`timeMs → ISO` 转换；grid 必须传 `replayCandleGrid(replay)`（会话自带的 venue 网格，10/21 契约）。
- **去重键含 rangeKey**：切周期后 rangeKey 变 → 同一 token 在新周期重新定位（R3）。切周期不清 focus，所以焦点跨周期存活。
- **追页加载**：开仓点早于已加载窗口时复用既有 `loadEarlierFreeReplayCandles()`；它返回空数组时置 `earlierExhaustedRef.current = true`（在该函数里加一行），定位 effect 随之放行并贴边定位，不会死循环。`earlierExhaustedRef` 在数据加载 effect 重置 refs 的位置一并重置（换 rangeKey 清零）。
- **`suppressAutoLoadRef`**：与既有调用点同款，防止 setVisibleRange 触发自动加载回路。
- 依赖里带 `loadedCandles/renderedCandles`：追页加载落地后 effect 重跑完成定位。

### 初始化 effect 的协调

现有初始化分支（`initializedRangeKeyRef.current !== rangeKey` 时）会用 `cursorAnchoredLogicalRange` 把视口锚到光标。有 `focusRequest` 时**跳过这步光标锚定**（标记照置 `initializedRangeKeyRef`，只跳过 setVisible*），把首次定位让给上面的焦点 effect——焦点 effect 声明在后，同一 commit 内随后执行；开仓点未加载时它先追页，数据到了再定位。

### 光标跟随 effect 不受影响

焦点态只移动视口，不动 `cursorTime`；光标跟随 effect 只在 `cursorTime` 变化时评估，焦点期间不介入。清除 focus 时 cursorTime 没变，不会触发回拉；下一次步进时按舒适区规则最小平移回光标——正好是 PRD 的解除语义。

## 面板重组（FreeReplayPaperTradingPanel）

```tsx
<aside className="paper-trading-panel">
  <div className="paper-panel-header">…标题+重置…</div>
  <div className="paper-stats">…4 个 Metric…</div>
  <div className="paper-tabs" role="tablist">
    <button role="tab" className={tab==='trade'?'selected':''} onClick={…}>操作</button>
    <button role="tab" className={tab==='orders'?'selected':''} onClick={…}>单子{orderCount ? ` (${orderCount})` : ''}</button>
  </div>
  {tab === 'trade' ? (
    <div className="paper-tab-body">…开始模拟 / 参数 / 开仓 / 持仓操作(加仓/平仓/止损)…</div>
  ) : (
    <div className="paper-tab-body paper-order-list">
      {position && <button className="paper-position-row" onClick={onReturnToCursor}>…方向/均价/数量/浮盈 + 开仓时间…</button>}
      {session.pendingEntry && <div className="paper-pending-row">待开仓 {limitPrice}</div>}
      {session.pendingExit && <div className="paper-pending-row">待平仓 {limitPrice}</div>}
      {trades.map(trade => (
        <button key={…} className={`paper-trade-row ${focusedOrderId===trade.id?'active':''}`} onClick={() => onFocusOrder(trade)}>
          …方向 / entryPrice→exitPrice / pnl / returnRate / 开仓时间…
        </button>
      ))}
      空态：「暂无单子」
    </div>
  )}
</aside>
```

- Tab state：`const [panelTab, setPanelTab] = useState<'trade' | 'orders'>('trade')`，面板内本地状态。
- `orderCount = (position ? 1 : 0) + (pendingEntry ? 1 : 0) + (pendingExit ? 1 : 0) + trades.length`。
- 单子行显示开仓时间（`MM-DD HH:mm`，Asia/Shanghai，本地小 helper `formatPaperTime(ms)`，毫秒 → 字符串），让用户知道会跳去哪。
- 持仓行是 button：点击 = 回到光标（PRD 解除条款）。持仓的加仓/平仓/止损**操作**仍留在「操作」Tab。
- 已完成交易行从 `<div>` 改为 `<button>`，保留原有字段，追加开仓时间与 `.active` 高亮。

## CSS（styles.css）

```css
.paper-trading-panel {           /* 改：grid → flex 列，滚动区内收 */
  display: flex; flex-direction: column;
  overflow: hidden;              /* 整体不滚，只滚 tab body */
}
.paper-tab-body { flex: 1; min-height: 0; overflow-y: auto; … }
.paper-tabs { display: flex; gap: 8px; }  /* 按钮复用 .mode-switch 的选中态风格 */
.paper-trade-row, .paper-position-row { cursor: pointer; width: 100%; text-align: left; }
.paper-trade-row.active { outline/背景高亮 }
```

窄布局媒体查询里 `.paper-trading-panel { max-height: 32vh }` 保留——flex 列 + 内部滚动在该约束下正常工作。

## 数据流小结

```
点已完成交易行 ──▶ App.orderFocus {id,timeMs,token}
                     │ focusRequest prop
                     ▼
            FreeReplayChart 定位 effect
              已覆盖开仓点？──是──▶ entryVisibleRange ±150 根 setVisibleRange（每 rangeKey+token 一次）
                     │否
                     ▼ 追页 loadEarlierFreeReplayCandles（earlierExhausted 防护）

步进/开平仓/点持仓行 ──▶ orderFocus=null ──▶ 下次步进时光标跟随 effect 最小平移回光标

切周期（focus 存活）──▶ 新 rangeKey ──▶ 初始化 effect 跳过光标锚定 ──▶ 焦点 effect 在新周期重新定位
```

## 测试计划（tests/app-free-replay.test.tsx 扩展，沿用 chartMocks.setVisibleRange 断言）

1. 面板 Tab：默认「操作」；切「单子」看到已完成交易行；操作 Tab 的开仓交互回归。
2. 点开仓过的已完成交易行 → `setVisibleRange` 以 `entryVisibleRange(positionOpenTime)` 被调；行高亮。
3. 点单后平移（用户拖图）不被拽回（同一 token 不重复 setVisibleRange）。
4. 点单后切周期 → 新周期下再次以该单开仓点定位（rangeKey 变化触发）。
5. 点单后点「下一根」→ focus 清除；之后的光标移动走舒适区规则（回归既有断言模式）。
6. 点当前持仓行 → focus 清除（回到光标）。
7. 开仓点早于初始窗口 → 触发 `mode=earlier` 请求，数据落地后定位（仿 10/28 backfill 测试的写法）。

## 风险与对策

- **追页死循环**：earlierExhaustedRef + loadingEarlierRef 双闸；历史用尽贴边定位。
- **与历史回填（shouldBackfillFreeReplayHistory）打架**：两者都只调同一个 loadEarlier（内部有 loadingEarlierRef 闸），回填的触发条件看的是光标侧可见条数，焦点跳走不改变其判定；实测用例 4/7 覆盖。
- **大量追页体验**：初始窗 ±数百根，回放会话内的开仓点一般 1–2 页内覆盖；极端长会话逐页加载可接受（每页数百根）。
