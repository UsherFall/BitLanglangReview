# Free Replay 缩放后光标跟随修复 — 执行计划

## 实现清单

### [1] 修改 `src/ui/App.tsx` — 添加光标跟随 effect

**目标**: 在 `FreeReplayChart` 组件中添加 `useEffect` 监听 `replay.cursorTime` 变化。

**位置**: 在现有 `useEffect`（`renderEffect` ~689 行）之后，`useEffect`（`visibleLogicalRangeChange` handler ~714 行）之前。

**代码**:

```ts
// Cursor follow effect — scroll viewport to keep cursor 10 steps from right edge
const cursorFollowInitRef = useRef(false);

// Inside the component body, after other effects:
useEffect(() => {
  const chart = chartApiRef.current;
  if (!chart) return;
  if (!cursorFollowInitRef.current) {
    cursorFollowInitRef.current = true;
    return; // Skip first render (initial cursor position already set)
  }
  const visible = currentFreeReplayVisibleRange(chart);
  if (!visible) return;
  const step = timeframeMs(timeframe) / 1000;
  const span = visible.to - visible.from;
  suppressAutoLoadRef.current = true;
  chart.timeScale().setVisibleRange({
    from: (replay.cursorTime - span + step * 10) as UTCTimestamp,
    to: (replay.cursorTime + step * 10) as UTCTimestamp,
  });
  window.setTimeout(() => {
    suppressAutoLoadRef.current = false;
  }, 0);
}, [replay.cursorTime]);
```

**边缘情况**: 
- 首次 mount 跳过（初始化已经设置了 range）
- `currentFreeReplayVisibleRange` 返回 null 时跳过
- 设置 `suppressAutoLoadRef` 防止 `visibleLogicalRangeChange` 冲突

### [2] 修改 `src/ui/free-replay-chart.ts` — 修复严格匹配

**目标**: `shouldPrefetchFutureCandles` 从 `===` 改为 `>=` 匹配。

**变更** (`free-replay-chart.ts:23`):

```ts
// before:
const cursorIndex = ordered.findIndex((candle) => candle.timestamp === cursorTime * 1000);
// after:
const cursorIndex = ordered.findIndex((candle) => candle.timestamp >= cursorTime * 1000);
```

### [3] 新 ref 声明

在 `FreeReplayChart` 的 ref 声明区域（`~616` 行）添加：

```ts
const cursorFollowInitRef = useRef(false);
```

## 验证命令

```bash
# 类型检查
npx tsc --noEmit

# 现有测试
npm test
```

## 风险点 & 回滚

| 风险 | 影响 | 缓解 |
|------|------|------|
| `setVisibleRange` 在渲染期间竞争 | 视口闪烁 | `suppressAutoLoadRef` 保护 + 异步恢复 |
| 连续快速光标推进导致多次 `setVisibleRange` | 性能 | React 批处理 state，effect 一次执行 |
| `currentFreeReplayVisibleRange` 在 Mount 前返回 null | 跳过 | 用了 guard `if (!visible) return` |
| 首次 `cursorFollowInitRef` 跳过和 `initializedRangeKeyRef` 初始化冲突 | 无 | 首次由 render effect 的 init 块处理 |
| 1m/5m 等其他 timeframe 是否受影响 | 无 | 实现通用，step 由 `timeframeMs` 计算 |

回滚: `git checkout -- src/ui/App.tsx src/ui/free-replay-chart.ts` 恢复。

## 上线前检查

- [ ] 新增 effect 不与其他 `useEffect` 有竞态
- [ ] `suppressAutoLoadRef.current = false` 在 render effect 中不会误清除
- [ ] 单元测试通过
