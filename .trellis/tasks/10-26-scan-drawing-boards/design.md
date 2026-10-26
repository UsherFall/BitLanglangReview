# 设计：画线板（board）隔离 + 距线列「已画」徽标

## 架构与边界

画线的「板」是一个**存储层字段 + 全链路打标**，不是分表、不是新 endpoint：

```
图表（打标 board） → useChartDrawings（fetch/save 带 board）
  → /api/drawings（校验 board） → DrawingStore（board 列 + 板内 canonical 过滤）
扫描服务 → DrawingStore.listDrawingsByTimeframe(tf, 'scan') → 距线测量（现状逻辑不变）
```

板取值：`DrawingBoard = 'scan' | 'review'`。**打标责任在图表**，hook 不猜：

| 图表 | board | 位置 |
|---|---|---|
| 选品画线抽屉（`OtherCoinChart` + `drawable`） | `scan` | `App.tsx` L891-897 |
| 交割单复盘图（`TradeChart`） | `review` | `App.tsx` L1550 |
| 回溯复盘图（`FreeReplayChart`） | `review` | `App.tsx` L1219 |
| 其他币面板（不 `drawable`，不加载画线） | 占位 `review` | `OtherCoinChart` 默认值 |

## 契约变更

- `domain/drawing.ts`：`ChartDrawing.board: DrawingBoard`（必填）；`SaveChartDrawingInput` 同步。注释写明：board 决定可见性与扫描测量归属，与 instrument 命名正交。
- `GET /api/drawings?instrument=X&board=scan|review`：`board` 必填，缺失/非法 → 400；可选 `timeframe` 过滤保留（定向查询）。
- `POST /api/drawings`：body 必填 `board`，非法 → 400。
- `DELETE` 按 id，不变。
- `domain/coin-scan.ts` `ScanRow` 增加：
  ```ts
  /** scan 板手画线信息（10/26）：距线列「已画」徽标的数据源；与测量成功与否无关（休市也标）。 */
  drawnLineCount: number;
  drawnTimeframes: ReviewTimeframe[];
  ```

## DrawingStore（`server/drawing-store.ts`）

- 迁移 `allowBoardColumn()`，沿用本文件已有的整表重建模式（`allowNullableTradeId` / `allowReferenceColumns`）：新表带 `board text not null default 'review'`，拷数据时全部落 `'review'`，随后按 PRD R4 的启发式把两条抽屉线改归 `'scan'`：
  ```sql
  update chart_drawings set board = 'scan'
  where trade_id is null and created_at >= '2026-10-21' and instrument not like '%-USDT-SWAP';
  ```
  （对当前库精确命中 `JUPUSDT`/`ASTERUSDT`；注释写明假设与核实日期。）
- `listDrawings({ instrument, board, timeframe? })`：SQL 过滤 `board`（+ 可选 `timeframe`），JS 侧按 `canonicalInstrument` 过滤 instrument（canonical 无法进 SQL；表 ~80 行，全扫可接受）。
- `listDrawingsByTimeframe(timeframe, board)`：SQL 加 `board = @board`。

## 扫描服务（`server/coin-scan-service.ts`）

- `loadLinesByTimeframe()` 改调 `listDrawingsByTimeframe(timeframe, 'scan')`；其余（canonical 归桶、refPrice 重标、`measureLevelAlert`、`closestRatio` 排序）一律不动。
- shrink（~L273-293）与 watch（~L438-448）建行时，从 `linesByTimeframe` 按行的 canonical instrument 汇总 `drawnLineCount`（各周期 LevelLine 数之和）与 `drawnTimeframes`（有 ≥1 条线的周期，按 `scanTimeframes` 序）—— 与 `levelAlerts` 是否测出无关（休市行照样有徽标，AC6）。

## UI

- `ui/chart-drawing.tsx`：`ChartDrawingsOptions` 增加必填 `board: DrawingBoard`；fetch URL 与 save body 带 `board`。effect 依赖加 `board`。
- `ui/OtherCoinChart.tsx`：新增 `board?: DrawingBoard`（默认 `'review'`），透传给 hook；`App.tsx` 抽屉处传 `board="scan"`；复盘/回溯图传 `'review'`。
- `ui/CoinScanPanel.tsx` `CoinScanResults`：币列 `<td>` 内 `shortInstrument(...)` 后追加徽标：
  ```tsx
  {row.drawnLineCount > 0 && (
    <span className="coin-scan-drawn" title={`已手画 ${row.drawnLineCount} 条线（${row.drawnTimeframes.join('、')}）`}>已画</span>
  )}
  ```
  新增 CSS `.coin-scan-drawn`（小字号、浅色描边胶囊，不抢距线列的视觉优先级）。

## 兼容与回滚

- 迁移走「整表重建 + 拷贝」，旧表数据先复制后改名，失败不丢数据；回滚 = 代码回退（多出的 `board` 列无害残留，旧代码不读它）。
- API 客户端只有本前端，`board` 必填无第三方破坏面；存量测试里 stub `/api/drawings` 的 URL 匹配要同步加 `board`。
- watch 视图每行恒有徽标（行入选即画线名单），属预期同构，不特殊隐藏。

## 风险

- 存量归类启发式只对本库精确 —— 已在 PRD R4 写明假设；错分的线用户重画即可，无数据损失。
- 板内 canonical 可见性让「同名不同价」的跨所线可能画在屏外（如 QNT 双所价差）—— 与今日行为一致，裁掉了事，不做图表端重标（PRD Out of Scope）。
