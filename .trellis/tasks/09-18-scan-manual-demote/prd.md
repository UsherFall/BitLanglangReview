# 选品:结果表手动降权

## Goal

收敛扫描会把「5m/15m 收敛、但日线结构不适合做多」的币一起扫出来(典型是**大跌后喘息**:小级别窄横盘,日线还在往下)。用户扫完要人工逐一看日线砍掉它们,而且**下次扫描还得重新看一遍**。

本任务让用户**人工判断后一键降权**:在结果表行上标记「降权」,被标记的币**沉底 + 灰化**,标记**跨扫描保留**,不必反复人工记忆。

## Background / Confirmed Facts

**产品决策(2026-09-18,用户)**:不做自动日线结构判定 —— 口径由用户自己看,算法不猜(原话「这个还是我自己判断,判断完直接降权吧」)。「日线行不行」是人的判断,工具只负责**记住并降权**。降权表现 = **沉底 + 灰化**。

**现状**

- 一币任一周期收敛即入表(`qualifiedCount >= 1`);日线状态不参与入选。
- 结果表顺序由服务端给定(`qualifiedCount desc → bestScore desc`),UI 原样渲染(`src/ui/CoinScanPanel.tsx:202-203`)。
- 结果表每行操作列现有:详情 / 记龙头 / 复制(`src/ui/CoinScanPanel.tsx:245-270`)。

**现成同类先例:「记龙头」per-row 标记**,本任务照搬其模式:

- `leaderCoins: string[]` 存在 App state(`src/ui/App.tsx:207`),`localStorage` 持久化(`:257-259`),key 常量 `LEADER_COINS_KEY = 'leader-coins'`(`:129`),读取函数 `loadLeaderCoins`(`:174`)。
- 传进结果表 `CoinScanResults`(`src/ui/App.tsx:795`)。
- 每行一个 toggle 按钮,文案 `已记 / 记龙头`(`src/ui/CoinScanPanel.tsx:254-261`)。
- 纯前端,无需新 API。

## Requirements

- **R1 按钮**:结果表每行操作列新增「降权」toggle 按钮(与 详情/记龙头/复制 并列);点击切换,文案反映当前状态(如 `降权 / 已降权`)。
- **R2 表现 = 沉底 + 灰化**:
  - 被降权的币在表中排到**所有未降权币之后**;降权组内部保持服务端原顺序。
  - 降权行**视觉弱化**(降低对比度/灰化),但内容仍可读、按钮仍可操作。
  - 表头统计(`扫描 N 个 · 收敛 M 个`)与各列数值**不因降权变化**。
- **R3 持久化**:沿用「记龙头」模式 —— `localStorage`、按 `row.instrument` 逐标的、**跨扫描与跨刷新保留**;新 key 命名沿用 kebab-case(建议 `scan-demoted`)。
- **R4 可取消**:再次点击同按钮恢复,币回到正常排序与正常视觉。
- **R5 与龙头币独立**:两个标记互不影响,同一行可同时「已降权」与「已记龙头」。
- **R6 不回归**:服务端契约、服务端排序、收敛算法、龙头币行为、scope 切换行为全部不变。

## Acceptance Criteria

- [x] AC1(R1)每行出现降权按钮;点击后文案切换为已降权态,再点切回。→ `tests/coin-scan-results.test.tsx`(aria-pressed 反映状态 + 点击回调带 instrument)
- [x] AC2(R2)存在降权币时:降权行位于表末尾,未降权行相对顺序与其在服务端顺序一致;降权行有可辨识的灰化样式;表头 `扫描/收敛` 计数与降权前一致。→ 顺序/类断言自动化;表头未改(渲染 `result.scanned.length` / `result.qualifiedCount`);**灰化视觉**见 Verification Notes
- [x] AC3(R3)标记后刷新页面并重新扫描,同一标的仍是降权态且仍沉底。→ 实现满足(初始化读取 + 写回两个独立 key);**无 App 级自动化覆盖**,见 Verification Notes
- [x] AC4(R4)取消降权后,该行回到其原始排序位置、视觉恢复正常。→ 同 AC1 的 toggle 路径 + `orderScanRows` 分组对称为互逆
- [x] AC5(R5)同一行可同时处于「已降权」与「已记龙头」;切换其一不影响另一个的持久化值(两个 localStorage key 互不写入)。→ 组件级自动化(点击降权只触发 `onToggleDemotedCoin`);持久化隔离由 `LEADER_COINS_KEY` / `SCAN_DEMOTED_KEY` 两个独立常量与两个独立 effect 保证
- [x] AC6(R6)`npm test` 全绿 + `npx tsc --noEmit` 干净;现有 `tests/coin-scan-results.test.tsx` / `tests/coin-scan-panel.test.tsx` 无回归。→ 57 files / 367 tests passed;tsc 无输出
- [x] AC7 在 `tests/coin-scan-results.test.tsx` 新增用例:切换降权、持久化读取与写回、沉底排序、与龙头币互不干扰。→ 另加纯函数单测 `tests/coin-scan-rows.test.ts`(4 例)

## Verification Notes

- **自动化**:`tests/coin-scan-rows.test.ts`(4 例)+ `tests/coin-scan-results.test.tsx`(7 例);`npm test` 367 通过。
- **仅代码可见、无自动化覆盖**:AC3 的「刷新后仍在」(需要 App 级测试,fetch 面过大)、AC5 的「两个 key 互不写入」。
- **需 dev server 肉眼确认**:AC2 的灰化观感(`.coin-scan-table tbody tr.demoted` 的 `opacity: 0.45`)。jsdom 不计算 CSS,测试只能断言类名存在 —— 见 `.trellis/spec/frontend/quality-guidelines.md` 的同类告警。


## Out of Scope

- **自动日线结构判定 / 门控**(用户 2026-09-18 明确不做)。
- 趋势线、形态标签(箱体/反弹/主升/主跌)、热度联动、仓位建议。
- 改动收敛检测算法(`detectConvergence`)或服务端排序契约。
- 降权与「龙头币」合并成同一套标记体系(按独立一套做,照搬先例)。
- 降权标的的**管理面板**(类似 `LeaderCoinPanel` 的集中列表 / 批量清除)。单个标的取消走行内按钮;「不再出现在任何扫描里就取消不掉」这一边缘情况本次不处理。
- equity scope 的差异化处理(两个 scope 共用同一份降权标记,与龙头币一致)。

## Notes

- 判定为**轻量任务**,PRD-only。
- 触碰面(预估):`src/ui/CoinScanPanel.tsx`(按钮 + 灰化 + props + 沉底重排)、`src/ui/App.tsx`(state + localStorage key + 传参)、`tests/`(UI 测试)。
- 不触碰:`src/domain/*`、`src/server/*`、任何 API 契约。
