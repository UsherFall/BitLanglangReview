# Design — retention 判据替换扫描排序

> 任务：`10-19-fakeout-retest-quality`。需求见 `prd.md`，证据见 `research/findings.md`（尤其 §4.5 复核）。
> 范围：**一层新的排序/筛选**，不改任何已有检测器。

## 1. 现状与改动点

```
/api/scan?method=shrink
  └─ CoinScanService.scanShrink
       ├─ stage1: 每个候选取 1D(100根) → coarseScreen(池内分位 + posRange≥0.03)   ← 不动
       ├─ stage2: 只对通过者取 5m/15m/1H/4H → probeStructure                       ← 不动
       ├─ 组装 ScanRow: convergedTimeframes/qualifiedCount/bestScore                ← 改
       └─ sort: 最高合格周期 desc → qualifiedCount desc → bestScore desc            ← 改
```

**改动点只有三处** + 两处 UI 展示：

| 位置 | 改动 |
|---|---|
| `src/domain/coin-scan.ts` | 新增纯函数 `retentionStructure()` 与类型 `RetentionMeasure`；`ScanRow` 增加 `retention?: RetentionRow`，删除 `bestScore` |
| `src/server/coin-scan-service.ts` | 用 **粗筛阶段已取的 1D 序列**算 retention → 当天全市场排名 → 前 X% 才出行 → 以 retention 降序排序 |
| `src/server/app-plugin.ts` | `/api/scan` 新增可选参数 `retentionPct`（0<X≤1，默认 0.1），非法值 400 |
| `src/ui/CoinScanPanel.tsx` | 参数框「位置前 X%」；删「强度分」列；加「位置」「离高点」列；表头统计改按 retention |
| `src/ui/coin-scan-rows.ts` | 注释更新（服务端排序键变了），逻辑不动 |

## 2. 判据定义（冻结）

```
W = 60（RETENTION_WINDOW，可参数覆盖）
窗口 = 最近 W 根**已完成**1D K 线
lo   = 窗口内最低**收盘**        ← 不是 low：影线会给 lo 送假谷（findings §4.5 E）
loIdx= lo 所在下标
hi   = loIdx..窗口末 的最高**最高价**
retention = clamp01((lastClose - lo) / (hi - lo))   // hi == lo 时约定 0
offHigh   = (1 - lastClose / hi) * 100 (%)
legPct    = (hi / lo - 1) * 100 (%)
```

**为什么窗口起点用收盘而不是最低价**：CFX 10-09 的长下影是窗口最低价、当天收盘却在高位——用 low 会让"冲高后阴跌"的币 retention 变好看。实测 5 锚点 top10%：用 low 5.0%，用 close 6.2%。

**为什么不用未来数据**：只用 `completedCandles()` 过滤后的已完成 K 线（现有机制，`anchor` 之前的）；`lo`/`hi` 都在 `E` 及以前。

**边界**：
- 序列 < W 根 → 返回 `null`（该币不参排名、不出行；与粗筛"窗口不足=不可测"同向）。
- `hi ≤ lo`（全平）→ `retention = 0`、`offHigh = 0`，仍参排名（位置最低）。
- 非有限数/非正价格 → `null`。

## 3. 数据流（不新增取数）

```
stage1 coarseFetches[i].completed  ──┬─→ coarseStructure()      （现有）
                                     └─→ retentionStructure()   （新增，同一份 1D）
                                             ↓
                     rankings = retention 降序（只含有值者）
                                             ↓
                     第 i 名 名次 ≤ floor(X × N) ? 出行 : 不出行
```

- `N` = 有 retention 值（完成 ≥60 根）的候选数；名次从 0 起。
- 截断 = `max(1, round(X * N))`（与研究中 `Math.max(1, Math.round(list.length * pct))` 一致），保证小池也有 1 个结果。
- **候选集合 = 粗筛前的候选池**（`candidates` 变量），而不是粗筛后：排名必须对全市场算，粗筛只是出行前置（`passes[i]`）。两者同时满足才出行。
- 平手：`retention` 相同 → 按原始 ticker（24h 成交额）顺序，`Array#sort` 稳定，不额外加键。

## 4. 契约

```ts
/** 一道新的"位置"度量，挂在行上以便列表显示与回归测试。 */
export type RetentionRow = {
  /** 0..1，1 = 还贴在窗口高点，0 = 跌回窗口起点。 */
  retention: number;
  /** 离窗口高点还有多少 %。 */
  offHigh: number;
  /** 这波上涨的幅度（%，hi/lo-1），用于"保住 87% 的 210% 涨幅"这类文案。 */
  legPct: number;
  /** 当天全市场名次（0 起）+ 当天基数，便于界面说明"第 12 / 679"。 */
  rank: number;
  poolSize: number;
};

export type ScanRow = {
  ...                      // 不变
  /** 位置度量；服务端必然填（能出行就说明它有值）。旧 payload 可缺省。 */
  retention?: RetentionRow;
  // bestScore 删除
};
```

`ScanResponse.params` 增加 `retentionPct`（回显实际用的 X）。

`StructureResult` **不改**（`score` 字段保留，只是不上行到 `ScanRow`）。

## 5. 周期与 UI

- 表头：`币 / 最新价 / 24h 涨跌 / 成交额 / 结构 / 收敛结构 / 位置 / 离高点 / 操作`。
  - 删「强度分」（= 旧 `bestScore`）。**各周期明细表里的 `score` 列保留**（那是 `StructureResult` 的原始报告列，不在本任务范围）。
  - 「位置」= `retention` 显示为百分比，`title` 里带「第 r+1 / N 名」。
  - 「离高点」= `offHigh`，一位小数。
- 参数框：「位置前 X%」数字输入（默认 `10`，允许 0.1~100，步长 1），走 `retentionPct = X/100`。
- 面板状态行：`位置前 10%（约 61 个/天）` 之类的一句提示，说明"按当天全市场 retention 排名取前 X%"，并说明**不是**绝对阈值。
- 头部统计：`粗筛 N 个 · 位置前 10% K 个 · 收敛 M 个`。

## 6. 参数与接口

| 参数 | 默认 | 校验 |
|---|---|---|
| `retentionPct` | `0.1` | `0 < X ≤ 1`，否则 400 |

不新增 `retentionWindow`：窗口是**标定常量**（60），放 `RETENTION_WINDOW` 导出，测试可覆盖；界面不出旋钮（避免用户把窗口调坏而不自知）。若将来要调，服务层已按参数化写好。

## 7. 兼容 / 回滚

- 旧客户端不带 `retentionPct` → 走默认 10%，行为即新行为（这是一次**有意**的行为变更，用户已确认）。
- 回滚 = 单次 revert 本任务的 4 个文件（无 DB/schema/迁移）。
- `bestScore` 删除会让旧 payload 的消费方少一个字段：全仓只有 `CoinScanPanel.tsx` 和两个测试读它（已核）。

## 8. 风险

| 风险 | 处置 |
|---|---|
| 小池（如美股候选少）截断为 1~2 个 | `max(1, round(...))`；界面显示"前 10% · K 个"让人看清 |
| 1D 取数失败 | 现有 `failedInstruments` 通道不变；无 retention 者不参排名（不进 N），也不出行 |
| 前 X% 与粗筛的交集太小 | 研究中全市场 679 个里前 10% = 68，粗筛约 44% → 交集约 30 个/天；已由 AC 里"K 个"暴露 |
