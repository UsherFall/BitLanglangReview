# 选品画线与复盘画线隔离，距线列语义清晰化

## Goal

画线按「出身板」分成两个互不串扰的池：**选品扫描画线抽屉**里画的线（`board='scan'`）只服务扫描（距线测量 + 抽屉显示），**复盘**（交割单复盘 / 回溯复盘，`board='review'`）里画的线只服务复盘。扫描结果表「距线」列的每个数字都对应一条打开抽屉就能看见的线；有手画线的行在币列名称旁带「已画」徽标。

用户价值：消除「距线数字像算法扫出来的」困惑 —— 数字背后的线可见、可对质；复盘与扫描两条工作流互不污染。

## Background / Confirmed Facts

证据来自代码与 `data/review.sqlite` 实测（2026-10-26）：

- 扫描「距线」**100% 来自用户手画的线**，不存在算法自动识别的线：`coin-scan-service.ts` `loadLinesByTimeframe()`（~L566-586）只读 `drawingStore.listDrawingsByTimeframe`，按 `canonicalInstrument` 归一匹配。
- 「算法不定线」是 10/21 用户亲自定的分工（`spec/server/coin-scan.md` L509-517）：粗筛找盘整候选 → 用户标注真正关键的压力位 → 距线跟踪 + 标线监控。行入选 = 粗筛，与是否画线无关；行排序键 = `closestRatio`。10/26 用户再次确认该分工成立。
- 画线可见性（图表加载）是 instrument **精确字符串匹配**：`GET /api/drawings?instrument=X`（`app-plugin.ts` L267-285）→ `drawing-store.ts` `listDrawings`；跨周期共享、不按 timeframe 过滤（`spec/frontend/component-guidelines.md` L50）。
- 同一个币在不同图表里命名不同：复盘图是 OKX 名（`JUP-USDT-SWAP`），选品抽屉跟扫描源走（`JUPUSDT`）（`domain/instrument-symbol.ts`）。
- **根因**：两个池因命名不同在视觉上「意外隔离」，但扫描测量（canonical 匹配）把两池合并了 → 用户在扫描表看到距线数字，打开抽屉却看不到线，感觉像「算法扫出来的」。
- DB 实测：79 条画线 = 71 条 `trade_id` 非空（复盘图）+ 8 条 NULL（回溯/抽屉）；native 命名仅 3 条：`QNTUSDT`（10-04，抽屉功能 10-21 才上线 → 回溯图所画）、`JUPUSDT`/`ASTERUSDT`（10-26，抽屉所画）。10-21 之后无其他 NULL trade_id 行。
- 各图表现有画线 hook 入参（`App.tsx`）：复盘图 `tradeId: trade.id`（L1550-1553）；回溯图 `tradeId: null`（L1219-1222）；选品抽屉 `OtherCoinChart` `tradeId: null` + `drawable`（L891-897）。
- 扫描行结构 `ScanRow`（`domain/coin-scan.ts` L315-335）：`levelAlerts` / `alertTimeframes` / `coarse?`；shrink 与 watch 两视图共用 `ScanRow`（L355、L431）与同一测量路径 `measureLevelAlert`。
- 「已画」徽标的真信息场景：休市/取数失败时画过线的币距线显示「—」，徽标把它和「没画过」的「—」区分开。

## Requirements

- R1（板模型）：`ChartDrawing` 增加 `board: 'scan' | 'review'`，保存时由所在图表打标 —— 选品抽屉 → `scan`；交割单复盘图、回溯复盘图 → `review`。存储命名不变（各交易所原生名）。
- R2（测量隔离）：扫描（shrink + watch）的距线只测量 `board='scan'` 的线；行入选口径（粗筛 / 画线名单）不变。
- R3（可见性隔离 + 板内归一）：图表只加载本板的线；板内按 `canonicalInstrument` 归一匹配（扫描源切换 bitget ↔ binance / 旧 OKX 源扫描遗留的抽屉线，同币仍可见）。跨周期共享规则不变。
- R4（存量归类迁移）：新增 `board` 列默认 `'review'`；`trade_id IS NULL AND created_at >= '2026-10-21' AND instrument NOT LIKE '%-USDT-SWAP'` 的存量行归 `'scan'`（实测精确命中 `JUPUSDT`/`ASTERUSDT` 两条抽屉线；假设：10-21 后无回溯图所画的 native 命名线，已对当前库核实）。
- R5（「已画」徽标）：`ScanRow` 增加手画线信息（线条数 + 周期列表，与测量成功与否无关）；结果表币列名称旁显示「已画」小徽标，hover 报「已手画 N 条线（周期列表）」。shrink 与 watch 两视图同构渲染（watch 行恒有徽标）。

## Out of Scope

- 算法自动识别参考线 —— 10/26 用户确认「算法不定线」分工成立（选项 A），后续想要再单开任务。
- 画线存储命名统一改写（canonical 只用于匹配 —— 既有约定不变）。
- 图表端跨交易所价格重标（`refPrice` 重标只发生在扫描测量端 —— 现状不变）；板内跨命名线的价格按所画原样渲染，屏外裁剪与今日一致。
- 自动刷新 / 推送告警（既有决定，不变）。

## Acceptance Criteria

- AC1（R1/R3）：复盘图画一条线 → 复盘图可见；选品抽屉打开同币不可见；重新扫描该币距线仍「—」。回溯图同理。
- AC2（R1/R2/R3）：抽屉画一条线 → 重开抽屉可见；复盘图打开同币不可见；重新扫描后该行距线出现。
- AC3（R3）：以 OKX 名存储的 scan 板旧线（如 OKX 源扫描时期所画），在 bitget/binance 源抽屉里同币可见、被测量。
- AC4（R2）：shrink 与 watch 同一锚点下同一币的距线读数一致（现有 parity 测试保持通过）。
- AC5（R4）：迁移后复盘图看不到 `JUPUSDT`/`ASTERUSDT` 两条抽屉线；抽屉打开 JUP/ASTER 能看到且只能看到这两条；其余 77 条复盘线扫描不测量。
- AC6（R5）：有 scan 板线的行，币列名称旁显示「已画」徽标，hover 显示线条数与周期；画过但休市测不出的行有徽标且距线「—」；没画线的行无徽标、距线「—」。
- AC7（API）：`GET /api/drawings` 缺 `board` 或非法值 → 400；`POST` 缺/非法 `board` → 400。
- AC8：`npm test` 全绿；`npx tsc --noEmit` 无错。
