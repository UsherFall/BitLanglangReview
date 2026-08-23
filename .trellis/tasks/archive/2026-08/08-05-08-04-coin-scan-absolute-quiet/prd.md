# 缩量扫描收敛约束:极致收敛判定 (v2)

## Goal

筛「**收敛到极致、快要选方向**」的蓄力币:价格在窄箱里坐实很久、量缩到低,不是「大阳/大阴后小盘整」的新鲜旗形。判定归一化到币自身尺度,一个阈值通吃山寨/主流/股票类币。

## Background / Confirmed Facts

- v1(绝对振幅上限)废弃:绝对阈值误杀高波动山寨。
- v1.5(boxTightness scale-free)已实现未提交:箱体窗口 = consecutive(3 根),保留 `amplitudeRatio < volatilityThreshold` 相对门。
- **用户实测反馈 + 分析发现**:现有「相对安静门」(`amplitudeRatio < 0.7`) 筛的是「刚安静下来的」——大阳大阴灌高窗口均值 → 后续盘整比值极小 → 轻松过;而真正长盘整的币(一直安静,当前≈均值)比值≈1 → 被误拒。过滤器基因就是「大阴大阳后盘整」,与「收敛到极致」诉求相反。
- 用户目标:**坐实窄箱** + **量缩** + **无近期大阳/大阴**。

## 已定决策 (v2)

| 决策 | 结论 |
| --- | --- |
| 箱体形状 | `boxTightness = R / (m × √N)`,N = **`boxWindow`(新参数,默认 12)**,R=该窗口总区间,m=该窗口平均单根振幅;真箱体≈1,单边趋势≈√N |
| 阈值 | `maxBoxRatio`(默认 **0.9**):嵌套极窄箱 < 1.0 才过 = 极致收敛;可调 |
| 近期大蜡烛排除 | boxWindow 拉长到 12 → 大阳/大阴落在近 12 根内,箱体被撑破 → 拒 |
| 振幅相对门 | **删除** `amplitudeRatio < volatilityThreshold`(元凶;boxTightness 承担形状职责) |
| 量缩门 | 保留 `volumeRatio < ratioThreshold`(量缩);死币(一直没量,比值≈1)被拒 |
| volatilityThreshold 参数 | **移除**(不再使用) |
| 排序 | 不变,按相对 `intensity` 升序 |
| 归一化 | scale-free,单一全局阈值,无 per-timeframe 表 |

## Requirements

- **R1 domain**(`src/domain/coin-scan.ts`):移除 `volatilityThreshold`、移除 calm 的 `amplitudeRatio` 条件;`calm[i] = volumeRatio[i] < ratioThreshold`;新增 `boxWindow`(默认 12)与 `maxBoxRatio`(默认 0.9)参数;`boxTightness` 在尾部 **boxWindow** 根完成 bar 上算 `R/(m×√boxWindow)`,`m<=0 → 0`;`qualified = consecutiveQuiet >= consecutive && boxTightness <= maxBoxRatio`;`QuietMetrics`/`ScanRow` 带 `boxTightness`;`DEFAULT_BOX_WINDOW=12`、`DEFAULT_MAX_BOX_RATIO=0.9`;数据不足守卫覆盖 boxWindow。
- **R2 service**(`src/server/coin-scan-service.ts`):拉取 limit 用 `max(window+consecutive, boxWindow) + 1`(drop 成型 bar 后完成 bar 数 ≥ 两者);参数透传;`response.params` 回显。
- **R3 route**(`src/server/app-plugin.ts`):移除 `volatilityThreshold` 解析与校验;新增可选 `boxWindow`/`maxBoxRatio` 解析(缺省回落默认;`<= 0` → 400),用 optional 解析避免 `Number(null)===0`。
- **R4 UI**(`src/ui/CoinScanPanel.tsx`):移除 volatilityThreshold 输入;加 `boxWindow`(预填 12)与 `maxBoxRatio`(预填 0.9)输入,必填恒携带;结果表加 箱体度 列。
- **R5 spec**:`.trellis/spec/server/coin-scan.md` 更新契约。

## Acceptance Criteria

- [ ] AC1:大阳/大阴在近 boxWindow 根内 → boxTightness 高 → 不 qualified;坐实 boxWindow 根极窄箱 → qualified。
- [ ] AC2:极致收敛(嵌套箱)< 1.0 通过,随机震荡 ≈ 1.0 拒绝(阈值 0.9)。
- [ ] AC3:长安静币(当前振幅≈均值)不再被 amplitudeRatio 门误拒;死币被量缩门拒。
- [ ] AC4:scale-free:2%/bar 与 0.5%/bar 箱体同阈值都过。
- [ ] AC5:`npm test` 全绿 + `npm run dev` 手动扫描,用户复核是否「收敛到极致」形态。

## Out of Scope

- 前期方向判断(阳线后蓄力 vs 阴线后派发)。
- 量能绝对约束、箱体末期检测(`08-04-coin-scan-box-end`)。
- 排序算法改。

## Notes

- 本任务 v1.5 实现未提交;改动含移除 volatilityThreshold(类型/route/UI/测试/spec 全链路)。
- 触碰:`src/domain/coin-scan.ts`、`src/server/coin-scan-service.ts`、`src/server/app-plugin.ts`、`src/ui/CoinScanPanel.tsx`、`tests/coin-scan.test.ts`、`tests/coin-scan-service.test.ts`、`.trellis/spec/server/coin-scan.md`。
