# 选品「距你标的线」正名 + 标线监控（范围 B）

> 状态：**已实施**（2026-10-21，范围 B + 名字已定，测试全绿；待用户验收后提交）。
> 用户原话（2026-10-21）：「要改名，你觉得啥名字对，你直接定吧」「b 先行，然后粗筛我发现现状的思路算对的，
> 我们主要找的还是在盘整有机会开主升浪的币，先这样吧或者你顺带看看实现有没有问题」

---

## 定案

1. **范围 = B**：改名 + 新增「标线监控」视图。粗筛判据、池、默认参数**一律不动**（用户 10/21 确认思路对）。
2. **名字（AI 定，已获委托）**：
   - 扫描方法（wire key `shrink`）：「距你标的线」→ **「主升浪候选」**
     —— 用户自己的语言（「盘整有机会开主升浪的币」）；行就是 1D 粗筛存活的盘整币，
     「候选」保真：精度来自你标线，不来自算法。
   - 新监控视图（wire key `watch`）：**「标线监控」**
     —— 对应「监控这些被我画了线的币，看他们的涨跌状态」。
   - wire key `shrink`/`heat`/`box` **不改**（API 稳定；这是纯文案改名，不是协议变更）。

## 用户三步模块观 vs 实现现状（背景，为何做 B）

| 步骤 | 用户概念 | 现状 | 本任务 |
|---|---|---|---|
| 1 扫 | 算法粗找盘整、有机会开主升浪的币 | `coarseScreen`（池内分位粗筛） | ✅ 思路已确认，不动 |
| 2 标 | 用水平线/射线标真正压力位 | 画线按钮 → level drawer → drawing-store | 已有，不动 |
| 3 监 | 持续监控画了线的币的涨跌状态 | 只有扫描结果里的「距线」列；**行必须过粗筛**，画线币过不了粗筛就从列表消失 | **新增「标线监控」补齐** |

## Requirements

### R1 · 改名（UI + 文档）

- **R1.1** `CoinScanPanel` 方法下拉：`距你标的线` → `主升浪候选`；新增 `标线监控`；`热度`（仅加密）不变。
- **R1.2** 面板提示文案改写：粗筛描述保留；距线描述不再绑定方法名；新增 watch 的描述。
- **R1.3** `CoinScanResults` 距线列头「距你标的线」→「距线」。
- **R1.4** `CONTEXT.md` 术语词条同步（Shrink Method 旧词条已陈旧，顺带校正）。
- **R1.5** `.trellis/spec/server/coin-scan.md` 契约同步 + **删除收敛时代死段落**（detectConvergence/minScore/structures 等，10/20 删码时未清理的残留）。

### R2 · 标线监控（server）

- **R2.1** `CoinScanService.scanWatch(params: { source, anchor? })`：
  - 行集合 = drawing-store 里 5 个周期中**画了线**（canonical 匹配）的全部币。**不粗筛、不 scope、不成交额门、不 topN**。
  - 线加载、(币×周期) 取数、`scaleLinesToSource` 跨所换算、`levelAlert` 全部与 `scanShrink` 共用同一段代码（抽私有 helper，两处调用）。
  - 画线币在当前行情源解析不到 → `missingInstruments` 上报（新字段），不静默丢。
  - 取数失败 → 删该行 + `failedInstruments`（与 shrink 同规则）；418 → 整体中止（同规则）。
  - **休市标的保留**：监控是跟进不是候选扫描；K 线本就按 session 逐根过滤。
  - 排序：距线倍数升序（同 `closestRatio`），无线可量的沉底。
- **R2.2** 路由：`GET /api/scan?method=watch`（只认 `source`/`anchor`；`scope` 忽略）。
- **R2.3** 响应类型（`domain/coin-scan.ts`）：`rows: ScanRow[]`（复用，`coarse` 不设 → 结构列显示「—」）+ `scannedAt` + `warnings?`/`failedInstruments?`/`levelScaleNotes?`/`missingInstruments?`。

### R3 · UI 监控视图

- **R3.1** 选「标线监控」时参数区只留「扫描时间点」（数量/成交额不适用）。
- **R3.2** 结果复用 `CoinScanResults`：`ScanRow` 兼容（coarse 未定义已有「—」路径）；表头标题按方法切换；画线/详情/记龙头/降权/复制照常。

### R4 · 硬约束（不变）

- 粗筛判据、池、默认参数原样。
- 距线口径 100% 复用 `level-alert`（波动尺、跨所换算、样本下限、判定日=最后已收盘），无新阈值魔法数。
- 不复活任何失败判据（收敛/结构/股性/自动找线——见 10-19 HANDOFF §3.1 与 10-20 失败清单）。

## Acceptance Criteria

- [x] AC1 UI 不再出现「距你标的线」字样；下拉为「主升浪候选」「标线监控」「热度（仅加密）」。
- [x] AC2 选「主升浪候选」的请求、粗筛口径、行排序与改前一致（仅文案变化）；除文案断言外现有测试不改即过。
- [x] AC3 `method=watch` 返回**所有**画了线的币（含被粗筛拒掉的、休市的、另一 scope 的），每行现价/24h 涨跌/各周期距线三档，按距线倍数升序。（测试：粗筛拒掉的画线币仍出行 + 与 shrink 同池对比；休市 TSLA 保留）
- [x] AC4 画线币在当前源不可解析 → `missingInstruments` 上报且 UI 可见；取数失败 → 无该行且 `failedInstruments` 上报；两个通道不混。
- [x] AC5 watch 不读取、不校验 `topN`/`minQuoteVolume24h`/`scope`。（路由只认 source/anchor；面板测试断言 query 不携带）
- [x] AC6 同一时刻，监控行距线数值与 shrink 扫描中同币的数值一致（共用 `measureLevelAlert`；测试逐字段比对）。
- [x] AC7 测试全绿：71 文件 / 586 用例（含 11 条新增）。`tsc --noEmit`：**全库 0 错误**（用户 10/21 授权删除 `tools/`（dsh-trellis-plugin 带 49 个类型错误 + 已归档的 labeling 研究工具）并从 tsconfig include 移除后，预存错误清零）。
- [x] AC8 `spec/server/coin-scan.md` 与 `CONTEXT.md` 同步新契约；收敛时代死段落删除（detectConvergence/minScore/structures 等；设计决策保留为历史并加前言说明）。

## 粗筛实现审查（用户委托「顺带看看」，已完成）

**结论：实现严谨，未发现 bug，不动。**

对的部分（逐项核过）：
- 池内分位每扫重算（绝对阈值会随行情漂移 31.2pp，分位形式 4.7pp——校准结论）；
- 并列取最保守秩、`floor(q·N)` 边界 `≤`；
- 短历史（<23 根）/非正价格 → 出局且不进分位基；
- 单币取数失败隔离（只有 418 整体中止）；
- 跨所线价换算带降级上报（`levelScaleNotes`）；
- 休市标的在成交额门之后剔除，不花请求。

两个观察（记录，不动）：
1. **监控缺口** —— 本任务 B 正在修复的：行入选 = 粗筛通过，画线币一旦不满足盘整口径就从列表消失。
2. **posRange 的「全序列」实际只有 ~90–100 根日线**（粗筛取数不分页 + 交易所单页上限 90；equity 取 2× 原始再过滤 ≈140 根）。「不趴绝对底部」看不见 3 个月以前的**年内大底**——一只在年内大底横了几个月的币会读成「中位」而通过。这是校准时刻意的口径（代码注释与 spec 均写明 ≤90 根），不是 bug；若哪天想按年内大底过滤，属于「加大日线取数」的口径变更，另立任务。

## Out of Scope

- 粗筛判据/口径变更（用户 10/21：思路对，先这样）
- 自动找线 / 收敛 / 结构 / 股性判据
- 监控自动刷新 / 推送告警（现在是手动点扫描；自动化另立任务）
- wire key `shrink` 改名
- 箱体蓄力（box）UI 入口恢复

## 环境约束

- 本会话最初 **无 bash**，后来用户把 `E:\git` 的 Git Bash 配进 `pi` 的 `settings.json`（`shellPath`）后可用。
- **已处理**：`tools/`（dsh-trellis-plugin + labeling）按用户指示删除（labeling 的研究产物已在 `.trellis/tasks/archive/2026-10/*/research/` 留存，用户另存了 `tools.zip` 只含 labeling）；`tsconfig.json` 的 include 移除 `tools` → 全库 tsc 归零。

## 实施记录（2026-10-21）

改动：13 文件，+777/−276。

- `domain/coin-scan.ts`：新增 `LevelWatchParams` / `LevelWatchResponse`。
- `server/coin-scan-service.ts`：抽出共用 `loadLinesByTimeframe` / `measureLevelAlert` / `closestRatio`；`scanShrink` 的 stage-2、1D 复用路径改走 `measureLevelAlert`（行为不变）；新增 `scanWatch`。
- `server/app-plugin.ts`：`/api/scan` 增加 `method=watch` 分支（只认 source/anchor）。
- `ui/CoinScanPanel.tsx`：方法下拉改名 + 新选项；`scan()` 分发 watch；提示文案；`CoinScanResults` 接受两种载荷（`isLevelWatchResult` 类型守卫），表头/统计行/结构列自适应，新增 missing 提示；距线列头改「距线」。
- `ui/App.tsx`：零改动（结果分发已有 shrink/heat/box 分支，watch 走 CoinScanResults）。
- 测试：service 新增 8 条（含两条视图一致性比对）、panel 新增 1 条、results 新增 2 条；更新选项断言与表头断言。
- 文档：CONTEXT.md（改 Instrument Scan/Shrink Method/Coarse Screen 词条，新增 Level Alert/Level Watch，删除死掉的 Volume Ratio/Shrink Intensity，更新对话例）；spec/server/coin-scan.md（§1–§7 全面对齐现状 + 新 10/21 设计决策条目）。
