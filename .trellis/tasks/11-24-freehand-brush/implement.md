# 新增自由画笔 — 实施计划

## 实施顺序

- [x] 1. 扩展领域契约：在 `src/domain/drawing.ts` 增加 `brush` kind，注释明确有序多点、秒级原始时间及不参与 Level Alert 的边界；不改旧 kind。
- [x] 2. 锁定持久化与扫描排除：
  - `tests/drawing-store.test.ts` 增加 brush 3+ 点 save/list 逐点 round-trip。
  - `tests/level-alert.test.ts` 增加 brush 不生成 `LevelLine`。
  - `tests/coin-scan-service.test.ts` 增加 scan board 只有 brush 时 `scanWatch` 无行、无 missing、无 Candlestick 请求，并保留现有 horizontal/ray 用例。
  - 不为上述两项扫描行为修改生产代码，除非测试证明现有白名单路径不足。
- [x] 3. 增加画笔入口与 SVG 渲染：
  - 在 `src/ui/chart-drawing.tsx` 使用 lucide `Brush` 图标，按钮 title 为「画笔」，置于射线之后、删除之前。
  - 增加 brush 草稿点状态，使用非填充、圆角 polyline 渲染草稿与已保存轨迹。
  - brush 跳过 `timeframeTimeForPoint`；其他 kind 的坐标转换不变。
  - brush 复用选中配色、body 拖动和删除，不渲染首尾 handle。
- [x] 4. 实现独立 pointer 手势：
  - pointerdown capture 起点 + pointer capture；move 追加 raw 点；up 一次保存、退出并抑制后续 click。
  - 使用 ref 保存最新手势和 pointerId，state 驱动草稿；忽略完全重复点，无移动不保存。
  - pointercancel、切换工具及加载作用域变化时清理未提交草稿，不产生幽灵 polyline。
  - 不改变现有水平线、射线及 saved drawing drag 的事件顺序。
- [x] 5. 增加 App 回归测试，优先放在 `tests/app-drawings.test.tsx`，需要时复用 `tests/app-drawing-snap.test.tsx` 的线性价格 mock：
  - 一笔 3+ 点的草稿/保存、kind/points/board、POST 恰好一次、完成后工具退出、后续 click 不重复保存。
  - 默认弱磁吸下仍保留原始 time/price；同一 Candlestick 内多个 x 不塌陷。
  - 已保存 brush 跨 timeframe 仍显示完整 polyline，不重拉 drawings。
  - 选中后无 handle、整体拖动所有点同 delta、删除可用。
  - pointercancel、切换工具和无移动 click 不 POST、不残留草稿。
  - 为新测试补充 jsdom pointer capture stubs；保持现有 toolbar 下标和 line 选择器测试稳定。
- [x] 6. 自查改动范围：服务端与扫描生产文件应保持不变；若确需变更，先回到 PRD/design 记录原因，不做隐式范围扩张。（已核实：生产代码仅 `src/domain/drawing.ts` 与 `src/ui/chart-drawing.tsx`，服务端/扫描生产文件零改动）
- [x] 7. Phase 3.3 同步 `.trellis/spec/domain/trade-and-review-model.md`、`.trellis/spec/frontend/component-guidelines.md` 及必要的扫描说明，记录 brush 原始点、手势、编辑与扫描排除契约。（coin-scan.md 已加 11/24 决策条目）

## 验证命令

定向：

```bash
npx vitest run tests/app-drawings.test.tsx tests/app-drawing-snap.test.tsx tests/drawing-store.test.ts tests/level-alert.test.ts tests/coin-scan-service.test.ts tests/chart-routes.test.ts
npx tsc --noEmit
```

最终全量：

```bash
npm test
npx tsc --noEmit
git diff --check
```

项目没有独立 lint script，不虚构 lint 命令。

## 手工验证

使用 `npm run dev` 在真实浏览器检查：

1. 复盘图与自由回放可画笔；选品可绘制抽屉也有画笔，只读其他币面板没有。
2. 按下后移出图表再释放不会卡死或重复保存；完成后的 click 不创建第二条，自动退出后可以正常拖动图表。
3. 弱/强磁吸下自由轨迹均不吸附；刷新和切换周期后轨迹保持原始点，整体移动/删除可用且无逐点 handle。
4. 水平线、射线、磁吸及旧 segment 渲染无回归。
5. 仅有 brush 的选品 Instrument 不出现在标线监控，距线没有新增读数。

## 风险文件与回滚点

- 高风险：`src/ui/chart-drawing.tsx`（共享所有图表的事件与渲染）。任何旧画线回归都先还原该文件内 brush 分支，不改扫描算法兜底。
- 中风险：`tests/app-drawings.test.tsx` / `tests/app-drawing-snap.test.tsx`（共享 chart mock 与 toolbar 下标）。brush 按钮必须放在射线后，新增查询优先 title/role/polyline。
- 低风险：`src/domain/drawing.ts` 与存储/扫描测试。SQLite 无迁移。
- 回滚：按一个 coherent change 整体还原 domain、hook 和测试；不自动删除用户已保存的 brush 数据。

- [x] 定向测试 6 文件 100/100 通过；`npm test` 761/761 通过（仅预存的 `level-alert-parity.test.ts` 因归档研究数据目录缺失在干净 HEAD 上同样失败）；`npx tsc --noEmit` 与 `git diff --check` 通过。真实浏览器手测（pointer capture、后续 click、图表拖动）需用户在 `npm run dev` 中验证。

## 开始实施前审查门

- [x] 用户已决定：不参与扫描、一笔后自动退出、固定样式并复用选中/整体拖动/删除。
- [x] `prd.md`、`design.md`、`implement.md` 已规划。
- [x] `implement.jsonl` / `check.jsonl` 配置真实 spec + research 条目。
- [x] 用户明确批准最终规划摘要后，才运行 `task.py start`。
