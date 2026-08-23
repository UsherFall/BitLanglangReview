# 选币模块-缩量盘整规则优化 — 执行计划

## 前置检查

- prd.md 已收敛,评审通过。
- 基线 `npm test` 全绿(28 文件 126 测试)。
- `tsc --noEmit` 干净。

## 实现清单(顺序)

1. **domain 算法重写** — `src/domain/coin-scan.ts`:`computeShrinkMetrics` → `computeQuietMetrics`(入参加 `volatilityThreshold`);计算每根振幅/振幅比;`calm = 量比<阈值 AND 振幅比<波动阈值`;强度分 = 最近 M 根 (量比+振幅比)/2 均值;`consecutiveQuiet` / `qualified`。类型:`ShrinkScanParams` 加 `volatilityThreshold`;`ShrinkMetrics` → `QuietMetrics` 加 `amplitudeRatio`、`consecutiveQuiet`。
2. **算法单测** — `tests/coin-scan.test.ts` 重写为 `computeQuietMetrics` 用例(见 design.md 测试要点)。
3. **service** — `src/server/coin-scan-service.ts` 调 `computeQuietMetrics`,行填 `amplitudeRatio` / `consecutiveQuiet`,删 `consecutiveShrunk`。
4. **route** — `src/server/app-plugin.ts`:`parseScanParam(volatilityThreshold, 0.7)`,`> 0` 校验,传入 params。
5. **UI** — `src/ui/CoinScanPanel.tsx`:参数加"波动阈值"(默认 0.7);结果表加"振幅比"列、"连续缩量"→"连续平静"列头。
6. **服务单测** — `tests/coin-scan-service.test.ts`:params 加 `volatilityThreshold`,新字段断言。
7. **spec** — `.trellis/spec/server/coin-scan.md`:请求参数表加 `volatilityThreshold`;`ScanRow` 字段;`scanShrink` 算法说明。
8. **回归验证** — `npm test` 全绿 + `tsc --noEmit` + dev 手动(参数面板/表格/合格判定)。

## 验证命令

```bash
npm test
npx tsc --noEmit
npm run dev   # 手动:选币 → 波动阈值参数在 → 扫描 → 振幅比列/连续平静 → 合格按平静判定
```

## 风险文件 / 回滚点

- `src/domain/coin-scan.ts` — 算法核心,单测先行。
- `src/ui/CoinScanPanel.tsx` — 表格列/文案。
- 注意:dev server 改动后需重启(此前踩过残留实例占端口坑)。

## task.py start 前复查

- [x] prd.md 收敛(无重复、无残留 Open Questions)。
- [x] 清单已过一遍。
- [x] 用户已评审 prd/design/implement。

## 实施记录

8 步全部完成。
- domain:`computeShrinkMetrics` → `computeQuietMetrics`(量比+振幅比双条件,平静判定,平静强度)。
- 契约:`ShrinkScanParams` 加 `volatilityThreshold`(默认 0.7);`ScanRow` 加 `amplitudeRatio`/`consecutiveQuiet`,删 `consecutiveShrunk`。
- UI:波动阈值输入 + 振幅比列 + "连续缩量"→"连续平静"。
- 边界:振幅基准为零 → 全平 bar 判平静,有波动判不平静(用有限哨兵避免 JSON null)。

验证:
- `npm test`:28 文件 126 测试全绿(算法 6 用例 + 服务 5 用例更新)。
- `tsc --noEmit`:干净。
- Playwright 手动:波动阈值参数在;扫描 50 币/合格 3 个(纯量时 8 个,价稳过滤更严);表头含振幅比/连续平静;合格行两指标均<0.7(如 SKHYNIX 量比0.40/振幅比0.41/强度分0.40/连续平静3);按平静强度升序。
