# 设计：距线警报替换扫收敛

## 1. 数据流

```
用户在看盘页画线（水平线 / 射线）
        │
        ▼
DrawingStore (sqlite, chart_drawings)          ← 已存在，格式不变
        │  instrument + timeframe + kind + points
        ▼
CoinScanService.scanShrink()
   ├─ Stage 1: 全池取 1D → coarseScreen（不变）
   └─ Stage 2: 只对【画了线的币 × 画了线的周期】取 K 线 → levelAlert()
        │
        ▼
ScanRow { levelAlerts, alertTimeframes }
        │
        ▼
CoinScanPanel「距你标的线」列
```

**关键**：第二阶段的取数量从「池子大小 × 4」变成「画了线的币数」。没画线的币只花 1 次请求。

## 2. level-alert.ts（新增，纯算术）

```
尺子  = 该币该周期的日内振幅中位数
        有射线 → 射线起点之后那段（样本 <30 根时退回最近 60 根）
        否则   → 最近 60 根
距线% = |收盘 - 线价| / 线价 × 100     （射线按当前时刻插值）
倍数  = |距线%| / 尺子

倍数 ≤ 0.5 → 🔔 贴近（alert）
倍数 ≤ 1.0 → · 接近（watch）
否则        → 远（far）
```

**为什么尺子不能用固定百分比**：BTC 的日内振幅中位约 2.4%，山寨币 5%~8%。
同一个 1.5%，对 BTC 还很远、对山寨已经很近——写死会把 BTC 误报。

**为什么距离与尺子必须同一时点**：距离用盘中价、尺子用收盘数据，
同一个「倍数」今天和明天不是一个意思，而且无法与研究脚本对齐。

**为什么要有样本下限**：射线起点之后可能只剩十几根（线刚画不久），
这么少的样本算出的中位数不稳，会把尺子压小、把「还没接近」误报成「贴近」。
修之前 BTC 是 0.49×（误报），修之后 0.56×（观察中）——与用户判断一致。

## 3. 删除收敛

| 文件 | 删什么 |
|---|---|
| `src/domain/coin-scan.ts` | `detectConvergence` / `StructureParams` / `StructureResult` / `ConvergenceStructure` / `TIMEFRAME_SCORE_OFFSET` / `timeframeMinScore` / `effectiveConvergenceRatio` / `clamp01` / `edgeDrift`；`ScanRow` 的 `structures` `convergedTimeframes` `qualifiedCount` `bestScore` `qualified`；`ShrinkScanParams.minScore` |
| `src/server/coin-scan-service.ts` | 第二阶段改为按线取数；`neutralStructure`；排序改为「离你标的线最近」 |
| `src/ui/CoinScanPanel.tsx` | 「收敛结构」「强度分」两列；「结构强度阈值」输入框；`minScore` state |
| `src/ui/coin-scan-rows.ts` | 排序说明注释 |
| `src/domain/box-brace.ts` | 提到 `detectConvergence` 的注释（箱体蓄力本身**保留**） |

`ScanResponse.qualifiedCount`（= 行数）**保留**——它与收敛无关。

## 4. 排序

原来：最高收敛等级 → `qualifiedCount` → `bestScore`（按算法猜的结构强度排）。

现在：**离你标的线最近**（最小的倍数在前）。没有线的币排最后。

理由：线是用户标的，排序就该按「离我的线多近」，而不是「离算法猜的结构多强」。

## 5. 测试

| 文件 | 内容 |
|---|---|
| `tests/level-alert.test.ts` | 单元测试（19 个）：中位数、射线插值、尺子、三档判定 |
| `tests/level-alert-parity.test.ts` | **两条独立实现路径逐段比对**（AC4）：产品代码 vs 研究脚本口径的复算 |
| `tests/coin-scan-service.test.ts` | 改写：第二阶段按线取数、线周期失败丢行 |
| `tests/coin-scan-results.test.tsx` | 改写：表头、距线列内容 |
| `tests/coin-scan.test.ts` | **整个删除**（全是收敛用例） |

parity 测试的关键：参考实现用**不同的数据形状**（`t/h/l/c` vs `timestamp/high/low/close`），
所以它确实是另一条路径，而不是同一个函数被调两次。

## 6. 风险与对策

| 风险 | 对策 |
|---|---|
| 38 处引用改漏 | AC1 用 grep 全库核查 11 个标识符 |
| 现有测试围绕「5 档全合格才出行」 | 前提消失，按新行为重写（不是改断言） |
| 用户在别的页面标的线要生效 | `drawing-store` 按 instrument+timeframe 存，选品服务直接读 |
| 尺子口径在研究脚本与产品间漂移 | parity 测试锁定；两边都用「射线起点后 + 样本下限 + 同一时点」 |
