# Implement：复盘图表画线与步进体验修复

执行顺序按依赖排列：R1/R2 都在 `chart-drawing.tsx`（一个文件两个改动），R3 独立在 `App.tsx`。每步带验证，任一步失败先修再前进。

## Step 1 — R2 画完自动退出（最小改动，先做）

- [ ] `src/ui/chart-drawing.tsx` `handleOverlayClick`：
  - `horizontal` 分支 `saveDrawing(...)` 后 `setDrawingTool(null)`
  - 两击工具（ray/segment）第二击保存后 `setDrawingTool(null)`
- [ ] `tests/app-drawings.test.tsx` 新增断言：水平线保存后、射线第二击保存后，工具按钮不再带 `selected` class
- [ ] 验证：`npx vitest run tests/app-drawings.test.tsx` 全绿（含既有用例）

## Step 2 — R1 越界画线坐标外推

- [ ] `src/ui/chart-drawing.tsx`：新增导出 `coordinateForTime(time, { chart, timeframe, candles })`，逻辑按 design.md（timeToCoordinate → 空数据 null → 范围内缺口内插 → 范围外网格外推 `barSpacing`）
- [ ] `pointToScreen` 增加 `timeframe` / `candles` 参数，`DrawingShape` 调用点同步传参（draft 与已保存路径同改）
- [ ] `tests/app-drawings.test.tsx`：`timeToCoordinate` mock 改为对已加载K线范围外的时间返回 null；预置锚点越界的射线用例，断言线渲染且 `x1` 等于边界K线x − 槽数×barSpacing（精确值按 mock 推导）；补一个范围内缺口内插用例（若 mock 数据允许）
- [ ] 验证：`npx vitest run tests/app-drawings.test.tsx tests/app-drawing-snap.test.tsx tests/drawing-snap.test.ts`

## Step 3 — R3 步进视口稳定

- [ ] `src/ui/App.tsx` `FreeReplayChart` cursor follow effect：改为舒适区判定（见 design.md 伪代码），前进越界维持「距右缘 10 根」不变量，后退越界对称锚定「距左缘 10 根」，视野内不动
- [ ] 保留：`cursorFollowRangeKeyRef` 切周期首跳跳过、`suppressAutoLoadRef` 抑制模式、初始锚定 effect 不动
- [ ] `tests/app-free-replay.test.tsx`：新增/调整用例 —— 光标在视野中部步进不调 `setVisibleRange`；光标越右缘时恰一次最小平移。先读该 suite 现有 mock 与断言再动手
- [ ] 验证：`npx vitest run tests/app-free-replay.test.tsx`

## Step 4 — 全量回归 + 手动验收

- [ ] `npm test` 全绿
- [ ] 手动（可选，`npm run dev` → 回溯复盘）：4H 画射线 → 切 5m 线可见；画一根工具自动退出；连续点下一根/上一根，画面不动，光标到边缘才平移
- [ ] `npx tsc --noEmit`（若 tsconfig 允许）确认无类型回归

## 回滚

单一提交前所有改动局限在：`src/ui/chart-drawing.tsx`、`src/ui/App.tsx`、`tests/app-drawings.test.tsx`、`tests/app-free-replay.test.tsx`。任一步不可收拾时 `git checkout -- <file>` 回滚该文件即可，三个需求彼此独立可分别回滚。

## 检查门

- Step 2 完成后自检：draft 线（预览）路径传参正确，磁吸/拖拽用例不回退
- Step 3 完成后自检：切周期初始锚定行为与现状一致（不能出现切周期后画面乱跳）
