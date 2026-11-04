# 技术设计

三个需求都收敛在 `src/ui/App.tsx` / `FreeReplayPanel.tsx` / `styles.css`，不改服务端、不改纯函数执行层。

## R1 回退禁用：prop 传递 + 函数守卫 + deps 补全

```
App(paperTrading) ──canRewind={!paperTrading.active}──▶ FreeReplayPanel
   │
   └─ rewindFreeReplayCandle() ──守卫 if (!freeReplay || paperTrading.active) return
        ▲
        └─ 键盘 effect 闭包调用（deps 补 paperTrading.active，防陈旧）
```

- `FreeReplayPanel` 新 prop `canRewind?: boolean`（默认 `true`，组件可独立测试）；按钮 `disabled={!canRewind}`、`title` 提示「开始模拟交易后不能回退 K 线」。
- 样式：`.replay-controls button:disabled { opacity: 0.45; cursor: not-allowed; }`（对齐 `.drawing-toolbar button:disabled` 既有语言）。
- 键盘 effect deps 从 `[reviewMode, freeReplay, freeReplayCandles, timeframe]` 补 `paperTrading.active`（布尔基元，只在开关翻转时重订阅，成本可忽略）。
- 为什么函数级守卫必须保留：`rewindFreeReplayCandle` 还被恢复会话/未来新调用路径复用，单一防线放在函数入口最稳。

## R2 开仓点前视图：揭示边界「临时换轨」

核心思想：不新增第二套过滤管线，而是把既有「揭示边界」概念参数化 —— 正常态边界 = `replay.cursorTime`，焦点隐藏态边界 = `focusRequest.timeMs / 1000`（positionOpenTime，秒）。所有读边界的地方统一换轨：

```
hideAfterFocus (FreeReplayChart 本地 state, bool)
focusCutoffMs  = hideAfterFocus && focusRequest ? focusRequest.timeMs : null
revealBoundary = focusCutoffMs !== null ? focusCutoffMs / 1000 : replay.cursorTime   // 秒
```

换轨点（全在 FreeReplayChart 内，App 无感知）：

| 消费点 | 现读 | 改读 |
| --- | --- | --- |
| 渲染过滤（渲染 effect 的 `visibleCandlesForFreeReplay`） | `replay.cursorTime` | `revealBoundary`（补进 deps） |
| 磁吸 `magnetCandles` | `replay.cursorTime` | `revealBoundary` |
| 右缘翻页闸 `shouldLoadLaterFocusCandles(activeCandles, X)` | `cursorTimeRef` 镜像 | `revealBoundaryRef` 新镜像（同 11-03 的 ref 镜像模式：订阅 effect deps 不含边界，闭包会陈旧） |

其余不动且不坏的（逐条论证过）：

- **左缘翻页**（`mode=earlier`）：锚 = 活动数据集第一根，向更早取，永远 < cutoff，隐藏态照常工作（用户向左翻历史）。
- **游标预取**：焦点态本来就跳过。
- **中段洞自愈**：焦点窗口恒定连续（服务端保证），洞只在 earlier 翻页缺数据时出现，自愈窗落在 cutoff 左侧无害。
- **舒适区跟随 effect**：只在 `replay.cursorTime` 变化时跑；焦点态下不步进（步进会清焦点），不触发。
- **开平仓标记点**：点集由 App 按「活动数据集 + cursorTime」计算（不动）；隐藏后 post-cutoff 点的包含 candle 不在 series 数据里 → `timeToCoordinate` null → primitive 自动不画。零新代码。
- **`chartDataWithWhitespace`**：以过滤后的 `visibleCandles` 为骨架，200 根空白垫在 cutoff 右侧 —— 用户向右拖最多看到空白，翻页闸已停，无风暴。

### 交互细节

- **按钮**：`toolbarExtra` 里 `focusRequest` 非空时渲染剪刀（`Scissors`，lucide），`className selected` + `aria-pressed` 反映开启；`title`：「隐藏开仓点后的 K 线」/「显示开仓点后的 K 线」。无焦点单不渲染（与复盘图 `!showAllMarkers ? Eye : null` 的条件渲染同语言）。
- **开启瞬间的视口锚定**：把开仓点吸附到当前周期网格（`floorTimestamp`，`entryVisibleRange` 同款 snap 理由：off-grid 时间会被 LWC ceiling 到下一索引）后，用 `cursorAnchoredTimeRange(snappedSeconds, step, visibleBars)` 设视口 —— 开仓点贴右缘留 10 根。`suppressAutoLoadRef` 包裹（同其它程序化 `setVisibleRange`）。关闭时不移动视口（蜡烛原地重现）。
- **复位**：`useEffect(() => { if (!focusRequest) setHideAfterFocus(false); }, [focusRequest])` —— 退出焦点（步进/开平仓/回光标/切会话/离开模式，既有清理路径全走 `setOrderFocus(null)`）自动关。换焦点单不清（cutoff 跟随新单，连续审单的体验）。
- **跨周期**：焦点跨周期存活（App 不清 orderFocus），`focusRequest` 不变 → cutoff 不变；新周期焦点取窗后重锚（既有 effect），隐藏态重新过滤。positionOpenTime 的包含 candle 在任何周期的开档时间都 ≤ positionOpenTime，「开仓点及之前」语义跨周期成立。
- **兜底**：`hideAfterFocus` 即使意外残留 `true`，`focusCutoffMs` 因 `focusRequest === null` 而为 null → 边界回到游标，非焦点态零影响。

## R3 顶部面板重叠：右对齐

- `.hover-price-percentage`：`left: 252px` → `right: 10px`。固定宽度可变工具栏的左侧锚是结构性错误；右对齐 + `pointer-events: none` + 半透明底 = 既有浮动读数语言。
- `.candlestick-readout`：`left: 252px` → `left: auto`（保留 `right: 10px`），随内容收缩贴右上。两图（复盘/回溯）行为一致。
- 不改 `.drawing-toolbar`（按钮尺寸是 10-28 已定的 30×30 语言，磁吸 32px）。

## 兼容与回滚

- 三项彼此独立，可单独回滚；无数据迁移、无存取结构变化（新 UI 态均为 ephemeral，不进 session payload）。
- 恢复旧会话（无 paperTrading）→ R1 按钮可用、R2 无焦点单无按钮 —— 旧会话零行为变化。

## 测试设计

全部走 `tests/app-free-replay.test.tsx` 既有模式（fetch stub + chartMocks 捕获 + `makeCandle`）：

1. **R1**：开始回溯 → 开始模拟 → 断言 `上一根 K 线` 按钮 `toBeDisabled()` → 键盘 `ArrowLeft`（`fireEvent.keyDown(window, ...)`）→ 断言游标未回退（auto-save payload 的 cursorTime 不变 / `setVisibleRange` 未被回退触发）。重置模拟 → 按钮恢复 `toBeEnabled()`。
2. **R2 隐藏**：复用「supports a paper trading market open and close」+ 焦点取窗 mock（initialFetchCount 分流）→ 点单子 → 点剪刀（`隐藏开仓点后的 K 线`）→ 断言 `chartMocks.setData` 末次蜡烛时间数组截止于开仓点包含 candle → 再点恢复。
3. **R2 无风暴**：隐藏态下 `barsInLogicalRange` 返回 `barsAfter: 5`，连发三个拖动帧 → 断言零 `mode=later` 请求（对齐既有 request-storm 用例形态）。
4. **R2 复位**：隐藏态下步进（下一根）→ 焦点清 → 剪刀按钮消失 → `setData` 恢复完整揭示数组。
5. **R3**：纯 CSS，`npm run dev` 手查（jsdom 无布局，不写断言测试）。

纯函数层（`free-replay-chart.ts`）无需新函数：边界换轨用的都是既有 `visibleCandlesForFreeReplay` / `shouldLoadLaterFocusCandles`，只是喂的边界值变了 —— 语义测试在 app 层覆盖。
