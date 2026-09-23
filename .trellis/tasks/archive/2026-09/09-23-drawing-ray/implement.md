# 射线画线工具 — 实施计划

## 实施清单（按顺序）

### 1. 领域类型
- [ ] `src/domain/drawing.ts:3`：`ChartDrawingKind` 增加 `'ray'`，**保留** `'segment'`（存量记录要能继续渲染）。

### 2. FreeReplayChart 面板（`App.tsx` 约 1448-1538）
- [ ] 工具栏（`App.tsx:1526`）：把 `title="线段"` 的按钮改为射线按钮，`drawingTool` 的值由 `'segment'` 改为 `'ray'`，更新 `title` 与图标。
- [ ] `handleOverlayClick`（`App.tsx:1448-1467`）：把 `segment` 的两点分支放宽为 `segment | ray`，`saveDrawing` 写入的 `kind` 用当前工具值。
- [ ] 草稿预览判断（`App.tsx:1488`）：`drawingTool === 'segment'` → `segment || ray`。
- [ ] 向 `DrawingOverlay` 传 `draftKind={drawingTool}`。

### 3. TradeChart 面板（`App.tsx` 约 1954-2042）
- [ ] 同上四项，对应 `App.tsx:2022`、`:1954-1973`、`:1994`、`:2037` 的 `DrawingOverlay`。
- [ ] 两个面板改动必须一致，改完对照检查一遍。

### 4. 共用渲染
- [ ] `DrawingOverlay`（`App.tsx:2060-2081`）：新增 `draftKind` prop，替换 `App.tsx:2078` 里硬编码的 `kind: 'segment'`。
- [ ] `DrawingShape`（`App.tsx:2083-2106`）：新增 `ray` 分支 —— 复用现有两点屏幕坐标（`App.tsx:2097`），按 `d = p1 - p0` 归一化后外推 `RAY_LENGTH`；`d` 为零向量时不加长，避免除零。
- [ ] 新增 `RAY_LENGTH` 常量（约 20000），注释说明依赖根 SVG 视口裁剪 + `.chart-wrap` 的 `overflow: hidden`，因此无需精确求交。
- [ ] 射线保留两个手柄（端点 `'start'`、方向点 `'end'`）。
- [ ] `App.tsx` 顶部 `lucide-react` import 补射线图标（建议 `MoveUpRight`），移除不再使用的 `Slash`（若确无其它引用）。

### 5. 测试
- [ ] `tests/app-drawings.test.tsx:65-85`：「previews a segment…」用例改名为射线并更新断言（预览形态变为延伸后的射线，`x2` 不再是 300 而是外推值）。
- [ ] `tests/app-drawing-snap.test.tsx:68-87`：`expect(drawing.kind).toBe('segment')` → `'ray'`。
- [ ] 新增 app 级用例：射线落两点后提交的 `kind` 为 `'ray'` 且 `points` 为 2 点；端点（`points[0]`）由第一次点击决定、方向点由第二次点击决定。
- [ ] 确认 `toolbarButtons[1]` 仍是射线按钮（因为是替换不是新增，下标不位移）。
- [ ] `tests/drawing-store.test.ts`：若已有按 kind 的断言，确认新 kind 不会破坏它。

### 6. 契约文档（由 Phase 3.3 `trellis-update-spec` 负责，实现阶段不做）
- [ ] `.trellis/spec/domain/trade-and-review-model.md:81`：把「`horizontal` or `segment` kind」更新为含 `ray`，并说明 segment 仅存量保留。
- [ ] `.trellis/spec/frontend/component-guidelines.md`：在「Drawing Magnet Snap (画线磁吸, 09/20)」段落（`:128-139`）之后补一段射线渲染语义（端点 + 方向点、大常量外推 + SVG 裁剪、跨周期斜率会变）。

## 验证命令

```bash
npx tsc --noEmit
npx vitest run tests/app-drawings.test.tsx tests/app-drawing-snap.test.tsx tests/drawing-store.test.ts
```

已知环境问题：全量 `npx vitest run` 会零星报 forks worker 启动超时，与业务改动无关，按文件定向跑即可。

## 风险文件与回滚点

- `src/ui/App.tsx` —— 单文件承载两个面板 + 共用渲染，改动最集中、最容易漏改，建议分两次提交（domain+渲染、两个面板接线）或至少改完逐个面板核对。
- 回滚：纯新增 kind 成员 + 新增渲染分支，`git revert` 单提交可完整回退，无数据迁移需要撤销。

## 启动前检查

- [ ] `prd.md` / `design.md` / `implement.md` 三者一致。
- [ ] 用户已明确批准最终计划摘要。
