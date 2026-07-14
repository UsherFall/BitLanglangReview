# Free Replay 缩放后光标跟随修复 — 设计文档

## 架构 & 边界

### 修改范围

`src/ui/App.tsx` 内的 `FreeReplayChart` 组件：新增一个 `useEffect` 处理光标跟随，修改现有的 render effect 逻辑。

`src/ui/free-replay-chart.ts`: 修改 `shouldPrefetchFutureCandles` 的匹配逻辑。

**不涉及**: `TradeChart`（950行附近），`FreeReplayPanel`，`src/server/`，`src/domain/`。

### 现有调用链

```
用户按 →  / Next Candle
   ↓
parent: revealNextFreeReplayCandle()
   ↓  setFreeReplay({cursorTime: newTime})
   ↓
FreeReplayChart re-renders
   ↓
useEffect([cursorTime]) → setRenderedCandles(allLoaded)
   ↓
render effect → series.setData(filtered + whitespace)
                (但 setVisibleRange 只在首次运行)
```

### 新增调用链

```
FreeReplayChart re-renders
   ↓
useEffect([cursorTime]) → setRenderedCandles(allLoaded)
   ↓
[NEW] cursorFollowEffect:
   - 跳过首次 mount
   - 获取当前 visibleRange (time 坐标)
   - 保持当前 span (= visible.to - visible.from)
   - chart.timeScale().setVisibleRange({
       from: cursorTime - span + 10*step,
       to:   cursorTime + 10*step,
     })
```

## 数据流

### 光标跟随算法

```
输入: cursorTime (秒), visibleRange {from, to} (秒, from < to)
      step = timeframeMs(timeframe) / 1000 (秒)

span = to - from
newFrom = cursorTime - span + 10 * step
newTo   = cursorTime + 10 * step

如果 newFrom < 最小可用数据时间（第一个蜡烛 - 200*step），
  则 clamp 到那里，保持 span。
如果 newTo > 最大可用数据时间 + 200*step，同理 clamp。

调用 chart.timeScale().setVisibleRange({ from: newFrom, to: newTo })
```

原则：保持用户当前的缩放（span 不变），仅平移视口使光标距右边缘 10 step。

### 与现有渲染交互

1. `cursorFollowEffect` 设置 `suppressAutoLoadRef.current = true` 防止冲突
2. `setTimeout(0)` 后恢复，与现有模式的 `suppressAutoLoadRef` 用法一致
3. `cursorFollowEffect` 在 render effect 之后运行（`useEffect` 按定义顺序执行，新增的在后；或者通过 `useEffect` order 保证）

### 未来预取修复

`shouldPrefetchFutureCandles` 从严格相等改为：

```ts
const cursorIndex = ordered.findIndex((candle) => candle.timestamp >= cursorTime * 1000);
if (cursorIndex < 0) return false;
```

找到第一个 >= cursorTime 的蜡烛。这样即使光标不在精确蜡烛时间上也能触发预取。

## 滚动场景矩阵

| 用户操作 | 当前行为（有 bug） | 修复后行为 |
|---------|-------------------|-----------|
| 缩放后按 → / Next Candle | 光标 state 前进，视口不动 | 视口右移，光标距右边缘 10 bar |
| 缩放手动平移 | 视口移动 | 不变（与用户行为一致） |
| 缩放后按 ← / Previous Candle | 正常工作（与 TradeChart 同） | 不变 |
| 不缩放，逐次 Next Candle | cursor 推进，视口不动（已有问题） | 视口跟随光标 |
| 连续快速 Next Candle | 推进到末尾 | 推进+滚动，自动触发预取 |

## 兼容性

- 此更改不修改 `TradeChart`（Trade review 模式）的行为
- `FreeReplayChart` 的初始设置逻辑不变
- whitespace 计算（`chartDataWithWhitespace`）不变
- 对 `lightweight-charts` 的版本无新依赖
