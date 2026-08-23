# 缩量扫描收敛约束:极致收敛判定 (v2) — Implement

## 前置

工作区有 v1.5(boxTightness)未提交改动。实现前先 `git checkout` 回 HEAD,从干净 HEAD 按本清单实现 v2。

## 实施清单(按序)

1. **domain**:`src/domain/coin-scan.ts` —
   - 移除 `volatilityThreshold`(参数 + calm 条件 + amplitudeAverages 计算)
   - `calm[i] = volumeRatio[i] < ratioThreshold`
   - 加 `DEFAULT_BOX_WINDOW = 12`、`DEFAULT_MAX_BOX_RATIO = 0.9`
   - `ShrinkScanParams`/`QuietMetricsParams` 加 `boxWindow`、`maxBoxRatio`(可缺省回落默认)
   - `boxTightness` 在尾部 `boxWindow` 根完成 bar 上算 `R/(m×√boxWindow)`,`m<=0 → 0`
   - `qualified = consecutiveQuiet >= consecutive && boxTightness <= maxBoxRatio`
   - `QuietMetrics`/`ScanRow` 带 `boxTightness`;数据不足守卫加 `count < boxWindow`
2. **test**:`tests/coin-scan.test.ts` —
   - 大阳/大阴落近 boxWindow 根内 → 不 qualified
   - 坐实 boxWindow 根极窄箱 → qualified
   - 随机震荡 ≈1.0 → 拒绝(阈值 0.9);嵌套箱 <1.0 → 通过
   - 长安静币不再被振幅门误拒(仅量缩门)
   - 死币(量不缩)被拒;scale-free 0.5%/bar vs 2%/bar;缺省回落;既有用例更新(去 volatilityThreshold)
3. **service**:`src/server/coin-scan-service.ts` — 拉取 limit = `max(params.window + params.consecutive, params.boxWindow) + 1`;透传;`response.params` 回显。
4. **route**:`src/server/app-plugin.ts` — 移除 `volatilityThreshold` 解析/校验;加可选 `boxWindow`/`maxBoxRatio` 解析(optional 解析,null/空/NaN → undefined → 默认;`<= 0` → 400)。
5. **UI**:`src/ui/CoinScanPanel.tsx` — 移除 volatilityThreshold 输入;加 `boxWindow`(预填 12)、`maxBoxRatio`(预填 0.9)输入,必填恒携带;结果表 箱体度 列。
6. **spec**:`.trellis/spec/server/coin-scan.md` — 更新:参数表(去 volatilityThreshold,加 boxWindow/maxBoxRatio)、判定公式、错误矩阵、Good/Base/Bad、设计决策。
7. **gate**:`npm test` 全绿 + `npx tsc --noEmit` 干净。

## 验证命令

- `npm test` — 每步后跑聚焦 `tests/coin-scan.test.ts` + `tests/coin-scan-service.test.ts`;最后全量。
- `npm run dev` — 手动扫描:确认「大阴大阳后盘整」出局、「坐实窄箱」入池;用户复核形态并反馈(可能要调 boxWindow/maxBoxRatio)。

## 风险文件 / 回滚点

- **`src/domain/coin-scan.ts`** — 纯函数语义改动(删振幅门 + 换 box 窗口);回滚点 = 此文件。
- **`src/server/coin-scan-service.ts`** — 拉取 limit 换公式;漏改则 boxTightness 数据不足。
- **`src/server/app-plugin.ts`** — 参数增减;optional 解析别复用 `parseScanParam`。

## task.py start 前复查

- [x] 工作区 v1.5 改动已回 HEAD。
- [ ] prd.md / design.md / implement.md v2 就位。
- [ ] jsonl 更新。
- [ ] 用户已确认 v2 方向(「试一试吧」)。
