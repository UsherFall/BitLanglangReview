# 执行计划

前置：`design.md`（边界换轨方案）+ `prd.md`（需求口径）。改动集中在 `src/ui/App.tsx`、`src/ui/FreeReplayPanel.tsx`、`src/ui/styles.css`、`tests/app-free-replay.test.tsx`、`tests/free-replay-panel.test.tsx`。

## 步骤

### 1. R1 回退禁用

- [x] `FreeReplayPanel.tsx`：加 `canRewind?: boolean` prop（默认 true）；「上一根 K 线」按钮 `disabled={!canRewind}` + `title`。
- [x] `App.tsx`：`<FreeReplayPanel ... canRewind={!paperTrading.active} />`；`rewindFreeReplayCandle()` 首行守卫 `paperTrading.active`；键盘 effect deps 补 `paperTrading.active`。
- [x] `styles.css`：`.replay-controls button:disabled`。
- [x] 测试：`tests/free-replay-panel.test.tsx`（组件级：canRewind=false → disabled）；`tests/app-free-replay.test.tsx`（app 级：开始模拟 → 按钮 disabled + ArrowLeft 不回退；重置 → 恢复）。

### 2. R3 顶部面板重叠（先做，独立且小）

- [x] `styles.css`：`.hover-price-percentage` `left: 252px` → `right: 10px`；`.candlestick-readout` `left: 252px` → `left: auto`。
- [x] 手查 `npm run dev`：回溯图 hover 百分比、复盘图 OHLC 读数条均不再压工具栏（用户 11-03 验收后归档）。

### 3. R2 开仓点前视图

- [x] `App.tsx` FreeReplayChart：`hideAfterFocus` state + `focusCutoffMs` 派生 + 双边界（渲染/磁吸严格小于 positionOpenTime；翻页闸早一个 step）+ `laterGateBoundaryRef` 镜像（对齐 `cursorTimeRef` 模式）。
- [x] 渲染 effect：`visibleCandlesForFreeReplay(renderedCandles, revealBoundary)`，deps 补 `revealBoundary`。
- [x] `magnetCandles` 同口径换 `revealBoundary`。
- [x] 翻页闸：`shouldLoadLaterFocusCandles(activeCandlesRef.current, laterGateBoundaryRef.current)`。
- [x] `toolbarExtra` 剪刀按钮（`focusRequest` 非空才渲染；`Scissors` import from lucide-react）。
- [x] 开启锚定：`containingCandleTimestamp` 取开仓 candle + `cursorAnchoredTimeRange` 右缘留 10 根 + `suppressAutoLoadRef` 包裹；声明在渲染 effect 后（同 commit 先 setData 再锚定）。
- [x] 复位 effect：`focusRequest` 为 null → `setHideAfterFocus(false)`。
- [x] 测试：4 个 app 级用例（隐藏/恢复+锚定、无风暴、退出复位+重点不残留）。

### 4. 质量闸

- [x] `npm test` 全量通过（647 用例；level-alert-parity 为本机缺 gitignored 研究数据的既有失败，干净检出同样挂）。
- [x] 对照 spec：`component-guidelines.md` 焦点单锚定契约逐条未破（整窗替换/R2 数据集专线/翻页闸/揭示边界）。
- [x] 手查 `npm run dev`：三项交互实机走一遍（R1 置灰、R2 隐藏/恢复/复位、R3 不重叠）——用户 11-03 验收后归档。

## 验证命令

```bash
npm test
npm run dev   # 手查 R1/R2/R3
```

## 回滚点

- 每步一个独立提交粒度；任一项可单独 revert（无共享状态/存储变更）。

## 风险

- R2 渲染数组收缩时 LWC 视口行为：`shiftVisibleRangeOnNewBar: false`（11-03 已关）+ 空白垫恒定 200 根，数据右端收缩不触发 shift 分支；若实测视口跳动，在换轨 effect 里补一次 `setVisibleRange`（已含开启锚定，风险低）。
- 中文 UI 文案与既有 mojibake 字面量并存：新增文案按 UTF-8 无 BOM 写入（quality-guidelines 的 Windows 陷阱）。
