# 扫描全周期收敛(每币一行 + 收敛周期列)

## Goal

点「扫描」一次跑全周期(5m/15m/1H/4H/1D),结果**每币一行**,显示该币在哪些周期收敛(收敛周期列)。解决案例库 C5:「15m 走平扫不出,切 1H 就扫出」——每个币在它自然的周期显形,无需改 latestTrend(放宽会放回 CRCL 类「长期安静」误报)。

## Background / 案例库

案例库:`.trellis/tasks/08-06-coin-scan-daily-gate-v5/research/case-library.md`(真数据,可重跑)。

- C1/C2 黄金 1D 08-03/08-04:应出 ✓(单周期已过)
- C3 ONUSDT 4H:应出 ✓
- C4 HYPE 4H now(突破后横盘):不应出 ✓(plateau 0)
- **C5 HYPE 15m @08-03 19:00+08 箱体顶部收敛:应出,但 15m 被 latestTrend 误杀(lt≈1.1)**
  - **验证:同箱体切 1H 扫 @08-03 19:00+08 就扫出**(comp 0.61~0.67 / lt 0.669,plateau {3,4})
  - 1H 聚合平滑 15m 日内噪声 → 表现为「仍在收窄」
- C6 HYPE 4H 08-03 16:00:已撤(用户认可非收敛)

关键机制:**plateau(多窗口连续收敛)** — 扫 bw∈{3,4,5,6},要求连续 ≥2 窗口合格。滤 C4 孤立误报(bw=4 单点),且自动适配箱体长度。

## Requirements

- **R1**:点扫描 = 全周期(5m/15m/1H/4H/1D)。ticker 拉一次,每币每周期拉 K(有缓存)。
- **R2**:结果每币一行,「收敛周期」列(如 `1H`、`1H,4H`);币在任一周期收敛即出现。
- **R3**:每周期判定沿用纯价格门(compression + latestTrend),每周期要求 plateau ≥2 连续 bw,滤孤立误报。
- **R4**:每行可看各周期 comp/lt 细节(折叠或 tooltip 级)。
- **R5**:保留 anchor(历史点扫描)能力,应用到各周期。
- **R6**:性能 — topN×5 拉取,需考虑并行/缓存;首扫延迟可接受(<~15s)。

## Acceptance Criteria

- [ ] AC1:案例库全绿 — C1~C4 行为不变;C5 在 1H(或全周期模式下)应扫出。
- [ ] AC2:结果每币一行,收敛周期列正确显示(如 C5 应显示 1H)。
- [ ] AC3:点扫描一次返回全周期聚合结果。
- [ ] AC4:anchor 在全周期模式下对每个周期生效。
- [ ] AC5:`npm test` 全绿 + `npx tsc --noEmit` 干净。

## Out of Scope

- 黄金 4H(旧任务 AC2)重定义 —— 挂起,案例库 F3 记录,待定。
- 改 latestTrend 默认(放宽会放回 CRCL 误报;保留单周期备选思路)。
- 绝对振幅门槛(会误杀 ONUSDT,C3,案例库 F4)。

## Notes

- **复杂任务**:契约大改(ScanRow 加收敛周期/多周期指标、service 多周期聚合、UI 每币行+周期列、测试)。
- 触碰:`src/domain/coin-scan.ts`、`src/server/coin-scan-service.ts`、`src/server/app-plugin.ts`、`src/ui/CoinScanPanel.tsx`、`tests/coin-scan*.test.ts`、`.trellis/spec/server/coin-scan.md`。
- 需 design.md + implement.md 后 `task.py start`。
