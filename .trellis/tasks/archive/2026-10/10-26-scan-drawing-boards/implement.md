# 执行计划：画线板隔离 + 距线列「已画」徽标

## 有序清单

1. `src/domain/drawing.ts` — 加 `DrawingBoard` 类型；`ChartDrawing.board` / `SaveChartDrawingInput.board` 必填。
2. `src/server/drawing-store.ts` — `allowBoardColumn()` 迁移（重建表 + R4 启发式归板）；`listDrawings` 改 `{ instrument, board, timeframe? }` + canonical 过滤；`listDrawingsByTimeframe(timeframe, board)`。
3. `src/server/app-plugin.ts` — `/api/drawings` GET/POST 校验 `board`（缺/非法 → 400）并透传。
4. `src/domain/coin-scan.ts` — `ScanRow` 加 `drawnLineCount` / `drawnTimeframes`。
5. `src/server/coin-scan-service.ts` — `loadLinesByTimeframe` 传 `'scan'`；shrink/watch 建行填 drawn 字段。
6. `src/ui/chart-drawing.tsx` — hook 必填 `board`；fetch/save 带 board；effect 依赖加 board。
7. `src/ui/OtherCoinChart.tsx` + `src/ui/App.tsx` — `board` prop 透传；三处图表打标（抽屉 `scan` / 复盘 `review` / 回溯 `review`）。
8. `src/ui/CoinScanPanel.tsx` + CSS — 币列「已画」徽标。
9. 测试：
   - `tests/drawing-store.test.ts`：迁移默认值与 R4 归板、板隔离、板内 canonical 互见、byTimeframe 板过滤。
   - `tests/coin-scan-service.test.ts`：review 板线不被测量；scan 板线被测量；行带 drawn 字段（含休市 null-alert 行）；watch 同构；shrink/watch parity 保持。
   - `tests/app-drawings.test.tsx`：fetch/save URL/body 带 board；既有可见性用例适配。
   - `tests/other-coin-chart.test.tsx`：抽屉（`board="scan"`）拉取 scan 板画线。
   - `tests/coin-scan-results.test.tsx`：徽标渲染/不渲染/hover 文案；watch 视图徽标。
10. 全量验证（见下）。
11. Phase 3.3 spec 更新：`spec/server/coin-scan.md`（距线只测 scan 板 + 行新字段）、`spec/frontend/component-guidelines.md`（hook 契约 + 可见性改板级）、`spec/frontend/state-management.md`（API board 参数）、`spec/frontend/quality-guidelines.md`（可见性红线改板级）、`spec/domain/trade-and-review-model.md`（board 字段）、`spec/guides/cross-layer-thinking-guide.md`（数据流加 board）。

## 验证命令

```bash
npm test                 # vitest run 全量
npx tsc --noEmit         # 类型检查
```

## 风险文件 / 回滚点

- `drawing-store.ts` 迁移：整表重建模式，先做列存在性检查幂等；回滚 = git 回退（board 列残留无害）。
- `coin-scan-service.ts` 行构造两处（shrink ~L273 / watch ~L438）都要填 drawn 字段，漏一处 = 两视图不一致。
- 存量测试 stub `/api/drawings` 的 URL 匹配（`tests/app-drawings.test.tsx` L201 注释处的请求断言）需同步。

## start 前检查

- [x] prd.md / design.md / implement.md 齐
- [x] implement.jsonl / check.jsonl 已策展（spec 条目，非代码路径）
- [ ] 用户批准最终规划摘要
