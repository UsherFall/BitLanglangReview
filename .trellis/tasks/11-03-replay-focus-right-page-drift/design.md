# 技术设计：回溯复盘焦点态右缘翻页视口漂移修复

## 变更面（3 处，全部在回溯复盘自己的代码里）

```
src/ui/App.tsx                      # FreeReplayChart：createChart 选项 + R4 触发条件 + cursorTimeRef
src/ui/free-replay-chart.ts         # 新纯函数 shouldLoadLaterFocusCandles
tests/free-replay-chart.test.ts     # 纯函数单测
tests/app-free-replay.test.tsx      # 组件级回归（createChart 选项 + 翻页风暴）
```

`TradeChart`（交割单复盘）、`OtherCoinChart`、游标态预取路径零改动。

## 修 1：`shiftVisibleRangeOnNewBar: false`（视口不再被拽走）

`FreeReplayChart` 的 `createChart`（App.tsx ~1395）`timeScale` 选项加一行：

```ts
timeScale: {
  borderColor: '#2D333B',
  tickMarkFormatter: (time: Time) => formatChartTime(time, timeframe),
  shiftVisibleRangeOnNewBar: false,
},
```

### 机制（LWC v5.2 源码实证）

`_internal_updateTimeScale` 在数据右端增长时二选一：

- `needShiftVisibleRangeOnNewBar`（= 旧最后一根可见 && `shiftVisibleRangeOnNewBar` && 非空白替换）→ **不补偿**，视口右缘 = 新 baseIndex + rightOffset，整体前移追加量 —— 乱飘的来源（给实时行情设计的行为）；
- 否则补偿：`rightOffset -= (newBaseIndex - currentBaseIndex)` → 视口时间范围不变。

关掉该选项后，回溯复盘里**一切**右端追加（焦点态右缘翻页、中段洞自愈插入、揭示步进）全部走补偿分支，视口保持用户拖到的位置。前插（earlier 翻页）本就走「baseIndex+rightOffset 语义天然保视口」路径，不受影响。

### 揭示步进为什么不受影响（等价性论证）

现状（shift 开）：每步 setData 追加 1 根实蜡烛 + 1 根尾空白，最后一根可见 → LWC 前移 +1 → 舒适区 effect 检查 `cursor + pad <= visible.to` 恰好相等 → no-op。
改后（shift 关）：LWC 补偿 → 视口不动 → 舒适区 effect 检查 `cursor_new + 10*step > visible.to`（恒成立，游标刚 +1）→ `setVisibleRange` +1 根（span 取当前可见 span，zoom 保持）。
两条路径每步都把「光标右侧留 10 根」的不变量恢复，用户看到的都是每步 +1 根，逐帧等价。向后揭示/舒适区内不动/跨过舒适区的分支完全相同。

### 为什么不搬 TradeChart 的延迟渲染 + 锚定恢复

那套（`pendingRenderRef` + 250ms 空闲 + `captureNavigationAnchor`）适合 TradeChart 的**指令式渲染**（`renderCandles` 直接在回调里跑）。FreeReplayChart 是 **React effect 渲染**（`renderedCandles` state → effect setData），锚定恢复要跨「状态提交 → effect 执行」两拍，实现要引入「渲染后恢复」的新时序协议；而关一个选项即可覆盖全部追加路径，改动最小、无新时序。10-30 已有回归用例「earlier 加载不恢复旧视口」证明 prepend 天然安全，本修只补右端。

## 修 2：焦点态右缘翻页的揭示边界闸（掐掉无限取数）

### 纯函数（free-replay-chart.ts）

```ts
/**
 * 焦点态右缘翻页是否还有可揭示的目标（11/03 视口漂移修复）。
 * 活动数据集最后一根已触及/越过揭示边界（cursorTime）时，mode=later 取回的
 * 蜡烛全是未揭示未来，visibleCandlesForFreeReplay 全部过滤 → 渲染数组永不
 * 增长 → barsAfter 恒 < 50 → 每个拖动帧都再发一次请求（请求风暴的根因）。
 * 揭示边界（未来不可见）本来就是回放的右墙：这种态不翻页。
 * 空数据集同样不翻页。
 */
export function shouldLoadLaterFocusCandles(activeCandles: Candlestick[], cursorTime: number): boolean {
  const last = activeCandles[activeCandles.length - 1];
  return last !== undefined && last.timestamp < cursorTime * 1000;
}
```

判据用**严格小于**：`last == cursorTime` 时后续蜡烛全是未来，同样禁止。

### 接线（App.tsx 自动加载 handler，R4 分支）

```ts
if (focusActiveRef.current && shouldLoadLaterFocusCandles(activeCandlesRef.current, cursorTimeRef.current) && shouldLoadLaterByLogicalRange(...) && !isSameVisibleRange(...)) {
```

**陈旧闭包问题**：该订阅 effect 的 deps 是 `[loadedCandles, replay.instrument, replay.startTime, replay.candleSource, timeframe]`，不含 `replay.cursorTime`（揭示步进不改 loadedCandles）→ handler 闭包里的 `replay.cursorTime` 会陈旧。解法沿用 `rangeKeyRef` 的既有模式：每渲染同步镜像 `cursorTimeRef.current = replay.cursorTime`，handler 读 ref。焦点态继续步进后游标前进、数据集右缘落后时，闸自动重新放行。

### 终止性

- 截断态（右缘 > cursor）：闸直接禁止 → 零请求；
- 老单（右缘 << cursor）：翻页追加 ≤ cursor 的蜡烛 → barsAfter 增长 → 触发解除；某次取回跨越 cursor 后右缘 ≥ cursor → 闸关闭；
- 游标步进前进后右缘重新 < cursor → 放行一次，游标数据集不受影响（R2 不变式：焦点取窗/翻页 `publishToApp: false`，本就不喂 App）。

## 修 3：回归测试

### 纯函数（tests/free-replay-chart.test.ts）

`shouldLoadLaterFocusCandles` 四形态：右缘 < cursor（true）、右缘 == cursor（false）、右缘 > cursor（false）、空数组（false）。

### 组件级（tests/app-free-replay.test.tsx）

1. **createChart 选项**：chartMocks 需捕获 `createChart` 的 options（当前 mock 忽略入参，要小改 mock：`createChart: vi.fn((_, options) => ({...}))`），断言 FreeReplayChart 挂载后 `shiftVisibleRangeOnNewBar === false`。
2. **请求风暴**：走完整焦点流（开始会话 → 开始模拟交易 → 市价开仓 → 揭示若干根 → 市价平仓 → 点该单行进焦点）→ 把 `barsInLogicalRange` 桩成 `barsAfter: 5` → 连续多次调用捕获的 handler（不同 logical range 模拟拖动帧）→ 断言**零** `mode=later` 请求（焦点窗口取窗后右缘 ≥ cursor，闸关）。对照用例：右缘 < cursor 时（焦点单较老 / 游标已前进），handler 调用后恰好发出一次 `mode=later`。
   - 注意焦点取窗 mock：`mode=initial` 的 candles 响应需按 entryTime 参数返回开仓点周围窗口（现有测试已有按 mode 分流的模式，739-795 行）。

## 权衡与风险

| 风险 | 评估 |
| --- | --- |
| 关 shift 改变揭示跟随手感 | 已论证逐帧等价（舒适区每步 +1 重锚）；由组件级用例覆盖 |
| 陈旧 cursorTimeRef | 每渲染同步镜像，与 `rangeKeyRef` 同款既有模式 |
| focus 窗口截断时用户想看更晚已揭示区间 | 揭示边界本来就是墙（未来不可见是回放语义）；步进前进后闸自动放行 |
| TradeChart 同病不同修 | 不在本任务范围；其锚定恢复已覆盖，留待后续统一 |

## 回滚

两个修相互独立：`shiftVisibleRangeOnNewBar` 一行可单独回退；闸条件从 R4 分支移除即回退。无数据/持久化迁移。
