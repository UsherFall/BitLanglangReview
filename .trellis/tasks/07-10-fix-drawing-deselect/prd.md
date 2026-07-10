# 修复画线选中后点击空白无法取消选中

## Goal

画线被选中后（黄色高亮），点击图表空白区域应取消选中。

## 根因

`styles.css:602-614` — `.drawing-overlay` 默认 `pointer-events: none`，只有画线工具激活时（`.drawing` class）才设为 `pointer-events: auto`。当无工具激活时，点击空白区域的 click 事件穿透 SVG 到达底层 canvas，`handleOverlayClick` 中的 `setSelectedDrawingId('')` 永远不执行。

上一个修复 `f009f47` 在 JS 层加了取消选中逻辑，但受 CSS `pointer-events` 阻断，在真实浏览器中不可达。配套测试在 jsdom 中通过是因为 jsdom 不模拟 CSS `pointer-events`。

## Requirements

- [R1] 画线被选中、无画线工具激活时，点击图表空白区域应取消选中
- [R2] 画线工具激活时，点击空白区域创建新画线（现有行为，保持不变）
- [R3] 点击画线本身应选中/保持选中（现有行为，保持不变）
- [R4] 按 Escape 键可取消选中

## Acceptance Criteria

- [ ] 选中一条画线 → 点击图表空白区域 → 画线取消选中（变回蓝色细线，拖拽手柄消失）
- [ ] 画线工具激活时，点击空白区域仍正常创建画线，不会错误取消选中
- [ ] 点击画线本身仍正常选中
- [ ] 按 Escape 键取消选中
- [ ] `tests/app-drawings.test.tsx` 现有测试继续通过

## Out of Scope

- 画线拖拽行为
- 画线创建/删除逻辑
