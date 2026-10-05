# 回溯复盘支持查看其他币 — 技术设计

## 1. 现状与约束

### 1.1 现有其他币面板

`src/ui/OtherCoinChart.tsx`（292 行，单组件）：

- props：`{ entryTime: string; timeframe: ReviewTimeframe; onClose: () => void }`
- 数据源：`/api/candles`，默认 OKX（不传 `source`）
- 视口策略：`entryVisibleRange(entryTime, timeframe)` = 锚点 ±150 根（`chart-time.ts:58`）
- 自动加载：`subscribeVisibleLogicalRangeChange` → `shouldLoadEarlier` / `shouldLoadLater`（`chart-autoload.ts`），双向
- 参考线：`markerTimeForEvent(entryTime, ...)` 映射到 X 像素，`entryX` state 驱动一条 SVG 竖线

**关键冲突**：`shouldLoadLater` + `loadMore('later')` 会在用户右滚时把未来 K 线直接 `setData` 出去。回溯复盘里这就是剧透。

### 1.2 主图（回溯复盘）的既有做法

`App.tsx:1112` `FreeReplayChart`：

| 关注点 | 做法 | 位置 |
|---|---|---|
| 数据加载 | `mode=initial`（±150）一次性取回 | App.tsx:1222 |
| 渲染裁剪 | `visibleCandlesForFreeReplay(renderedCandles, cursorTime)` 过滤 `timestamp <= cursorTime*1000` | App.tsx:1242 |
| 右侧留白 | `chartDataWithWhitespace(visible, [range.from*1000, range.to*1000])` | App.tsx:1246 |
| 后续预取 | `shouldPrefetchFutureCandles(loaded, cursorTime, 20)` → `mode=later` → **进 loaded 不进 rendered** | App.tsx:1327-1362 |
| 视口跟随 | `cursorAnchoredTimeRange` / `cursorAnchoredLogicalRange`，光标右侧留 10 根 | App.tsx:1300, 1245 |
| 左侧补历史 | `shouldLoadEarlierByLogicalRange` → `mode=earlier` | App.tsx:1318 |

注意 `App.tsx:1350` 的注释：预取成功后必须 `setLoadedCandles(merged)`，否则「已取过」守卫会永久拦住第二轮预取。这是主图踩过的坑。

### 1.3 布局约束

`.chart-float-stack`（styles.css:579）是 `position: absolute; top: 76px; right: 18px`，挂在 `.workspace`（styles.css:567，`position: relative`）下。回溯复盘的 `.free-replay-workspace`（styles.css:893）是 `grid-template-columns: minmax(0,1fr) 340px`，右侧被模拟交易面板占 340px。**浮层 `right: 18px` 会压在模拟交易面板上**，需要单独定位。

## 2. 方案选择

### 2.1 组件形态

**决定：扩展 `OtherCoinChart`，用可选 prop 切换到「回溯模式」。**

```tsx
export function OtherCoinChart({ entryTime, timeframe, cursorTime, onClose }: {
  entryTime: string;
  timeframe: ReviewTimeframe;
  /** 回溯复盘的光标（秒）。给出时面板进入回溯模式：只画到光标、不泄露未来。 */
  cursorTime?: number;
  onClose: () => void;
})
```

不新建组件的理由：

- 搜索框、候选下拉、header、关闭按钮、竖线 overlay、CSS 全部可复用（占组件约一半代码）
- 差异集中在数据加载与渲染两处，用 prop 分支比复制一遍组件更可控
- trade 模式路径保持默认行为（`cursorTime` 为 `undefined`），改动前后行为一致

回溯模式的差异点收敛为 4 个，其余复用：

| 行为 | trade 模式 | 回溯模式 |
|---|---|---|
| 初始加载锚点 | `entryTime`（交易开仓） | `entryTime`（由父组件传光标时间） |
| 渲染集合 | 全部已加载 | `timestamp <= cursorTime*1000` |
| 向后加载触发 | 右滚（`shouldLoadLater`） | 光标接近右缘（`shouldPrefetchFutureCandles`） |
| 竖线锚点 | `entryTime` | `cursorTime` |

### 2.2 cursorTime 的表示

主图的 `replay.cursorTime` 是**秒**（`UTCTimestamp`）。而 `/api/candles` 的 `entryTime` 参数要的是**可被 `Date.parse` 解析的字符串**。所以父组件传 `entryTime={new Date(freeReplay.cursorTime * 1000).toISOString()}`。

面板内部对 cursor 的比较统一走 `cursorTime * 1000`（毫秒），与 `visibleCandlesForFreeReplay` 一致。

传 ISO 字符串而非本地时间字符串，是因为服务端会 `Date.parse` 它；主图恢复会话时已经踩过本地时间字符串被按服务器时区解析的偏差（见 archive task `09-06-free-replay-cursor-resume` 的决策 4）。

### 2.3 视口策略

**决定：回溯模式下光标前进不自动平移视口。**

与主图不同——主图有「光标跟随」effect（App.tsx:1287）让光标保持在右侧 10 根处。面板不跟：

- 面板是可拖动缩放的小浮窗（380px 高），用户常会把它拖到一边对照主图；自动平移会和用户自己的拖动打架
- reveal 的语义本就是「不移动可见范围」（`Free Replay Reveal`，见 CONTEXT.md）
- 用户手动右滚时**不会**拿到未来 K 线（渲染集合被 cursorTime 裁死），只会看到空白——这是有意的：空白即「尚未揭示」

初始视口用 `entryVisibleRange(entryTime, timeframe)`（锚点 ±150），锚点是光标，所以打开面板时看到的是光标附近的历史 + 右侧空白。后续光标推进，新 K 线在原地长出来。

### 2.4 加载策略

回溯模式下三个 effect：

**A. 初始加载**（依赖 `instrument` / `entryTime` / `timeframe`）
和现在一样 `mode=initial`。`entryTime` 随 cursorTime 变化，但**不能让它进依赖数组**——否则每揭示一根就重载 300 根，疯狂打接口。

处理：把初始加载的依赖固定为 `[instrument, timeframe]`，`entryTime` 通过 ref 读最新值。同时用一个 `anchorKey`（`instrument:timeframe`）标记已初始化，切换币种/周期时才重新初始加载。

**B. 后续预取**（依赖 `loaded` / `cursorTime`）
照主图 `App.tsx:1327-1362`：`shouldPrefetchFutureCandles(loaded, cursorTime, 20)` → `mode=later` → 合并进 `loadedCandlesRef` + `loaded` state，**不 setData**。

**C. 左侧补历史**（依赖 `loaded`）
保留现有的 `shouldLoadEarlier` 逻辑——回溯模式下向左拖仍然要能补历史（用户会往回看）。这部分不需要区分模式。

**D. 渲染裁剪**（依赖 `loaded` / `cursorTime` / `instrument` / `timeframe`）
回溯模式下 `setData(visibleCandlesForFreeReplay(loaded, cursorTime))`；trade 模式仍 `setData(loaded)`。

### 2.5 自动加载 handler 的模式分支

现有 `subscribeVisibleLogicalRangeChange` handler（OtherCoinChart.tsx:130-159）在回溯模式下要做两处调整：

1. `shouldLoadLater` 分支**跳过**（否则右滚会显示未来）——但注意：`shouldLoadLater` 只是触发加载，渲染仍被裁剪，所以严格说不会泄露。为了语义清晰和少打无用接口，直接跳过。
2. `shouldLoadEarlier` 分支保留。

另外 handler 目前依赖 `[timeframe, instrument, entryTime]`，回溯模式下去掉 `entryTime`（改用 ref）。

### 2.6 竖线参考线

回溯模式下竖线锚点从 `markerTimeForEvent(entryTime, ...)` 改为直接用 `floorTimestamp(cursorTime*1000, timeframe)` 对齐的 candle time。

`markerTimeForEvent` 走 `containingCandleTimestamp`（要已加载 K 线覆盖该时间）。光标处通常正好是已加载数据的末端，`containingCandleTimestamp` 对「时间戳晚于最后一根」会返回 `null` → 回退到 `floorTimestamp`，结果一样。所以直接复用 `markerTimeForEvent(isoOfCursor, ...)` 即可，不新增函数。

## 3. 改动清单

| 文件 | 改动 |
|---|---|
| `src/ui/OtherCoinChart.tsx` | 加可选 `cursorTime` prop；`isReplay` 模式分支；初始加载 anchorKey + entryTime ref；渲染裁剪；预取 effect；handler 模式分支；竖线锚点 |
| `src/ui/App.tsx` | 回溯复盘 header 加「其他币」按钮；`freeReplay` 分支加 `.chart-float-stack` 容器与 `OtherCoinChart`；切模式时收起面板；回溯模式浮层专用定位 class |
| `src/ui/styles.css` | 回溯复盘工作区的浮层定位（避开右侧 340px 模拟交易面板） |
| `CONTEXT.md` | 「其他币」面板在回溯复盘下的行为写入 glossary（`Free Replay Chart Context` 或新增词条） |
| `tests/other-coin-chart.test.tsx`（新建） | 覆盖：切换币种、周期跟随、渲染裁剪到光标、预取触发 |

不改：`/api/candles`、`/api/free-replay/instruments`、`free-replay-chart.ts`、`FreeReplayChart`。

## 4. 风险与规避

| 风险 | 规避 |
|---|---|
| cursorTime 进 effect 依赖导致每揭示一根就重新初始加载 | 初始加载依赖只用 `anchorKey = instrument:timeframe`；`entryTime` 走 ref |
| 预取被「已取过」守卫拦住，只成功一次 | 照 `App.tsx:1328-1351` 的写法，预取成功后**同时**更新 `loaded` state 与 ref |
| 浮层遮住模拟交易面板 | 回溯模式用独立定位（`right: 358px`），不复用 trade 模式的 `right: 18px` |
| 切 reviewMode 后面板残留 | `reviewMode` 变化时 `setOtherCoinOpen(false)` |
| 回溯模式下右滚加载无用接口 | handler 在 `isReplay` 下跳过 `shouldLoadLater` |
| 面板初始加载的 `entryTime` 用本地时间串导致时区偏差 | 父组件传 ISO(UTC) |

## 5. 验证方式

- `npx tsc --noEmit` 无新增错误
- `npx vitest run` 全绿；新增 `tests/other-coin-chart.test.tsx` 断言行为（裁剪到光标、预取合并、币种切换重锚），而非元素存在
- 手工：起 dev server，回溯复盘中打开面板，右滚确认看不到未来 K 线，主图「下一根 K 线」推进时面板同步长出
