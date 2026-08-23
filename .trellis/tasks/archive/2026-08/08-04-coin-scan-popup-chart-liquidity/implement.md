# 选币模块优化-复制币名与流动性筛选 — 执行计划

## 前置检查

- prd.md 已收敛,评审通过。
- 基线 `npm test` 全绿(当前 28 文件 126 测试)。
- `tsc --noEmit` 干净。

## 实现清单(顺序)

1. **domain** — `src/domain/coin-scan.ts`:`ShrinkScanParams` 加 `minQuoteVolume24h: number`;`ScanRow` 加 `quoteVolume24h: number`、删 `lastCandleTime: number`。
2. **service** — `src/server/coin-scan-service.ts`:`fetchTickers` 保留 `quoteVolume24h`;`scanShrink` 在取 Top-N 前过滤 `quoteVolume24h < minQuoteVolume24h`;行填充 `quoteVolume24h`;删除 `lastCandleTime` 计算。
3. **route** — `src/server/app-plugin.ts`:`parseScanParam(minQuoteVolume24h, 10_000_000)`,`>= 0` 校验(非法 400),传入 `scanShrink`。
4. **UI 面板/结果** — `src/ui/CoinScanPanel.tsx`:参数区加"最低成交额"数字输入(默认 `10000000`);结果表加"成交额"列;每行加复制按钮(`navigator.clipboard.writeText(小写短名)` + "已复制"反馈);删除行 onClick。
5. **App 集成** — `src/ui/App.tsx`:删 `openScanReplay`;`CoinScanResults` 去掉 `onOpenReplay` prop;移除不再使用的 import(`formatReviewInputTime`、`freeReplayProgressTimeForStart`,确认 `freeReplayCursorTimeForProgress` 他处仍用则保留)。
6. **chart-time** — `src/ui/chart-time.ts`:删 `formatReviewInputTime`;`tests/chart-time.test.ts` 删对应用例。
7. **测试** — `tests/coin-scan-service.test.ts`:加下限过滤用例、`quoteVolume24h` 断言、删 `lastCandleTime` 断言。`tests/coin-scan.test.ts` 若引用 `lastCandleTime` 一并删。
8. **spec** — `.trellis/spec/server/coin-scan.md`:请求参数表加 `minQuoteVolume24h`,响应 `ScanRow` 增删字段;CONTEXT.md 若提及跳转行为则同步(缩量方法定义不含跳转,一般不需改)。

## 验证命令

```bash
npm test
npx tsc --noEmit
npm run dev   # 手动:选币 → 设置最低成交额 → 扫描 → 看成交额列 + 复制按钮 → 确认行点击无跳转、无新 Free Replay 会话
```

## 风险文件 / 回滚点

- `src/ui/App.tsx` — 删 import 时确认不被他处使用(编译期即暴露)。
- `src/server/coin-scan-service.ts` — 过滤顺序(先下限后 Top-N)是本任务核心,测试覆盖。
- `src/ui/CoinScanPanel.tsx` — 复制按钮行为,手动验证。

## task.py start 前复查

- [x] prd.md 收敛(无重复、无残留 Open Questions)。
- [x] 清单已过一遍。
- [x] 用户已评审 prd/design/implement。

## 实施记录

8 步全部完成,另修复一个**潜伏正确性问题**:
- 移除点击行跳 Free Replay + `openScanReplay` / `formatReviewInputTime` / `lastCandleTime` 清理。
- 每行复制按钮(小写短名),已复制反馈。
- `minQuoteVolume24h` 参数(默认 1000 万),先过滤后 Top-N。
- **发现**:OKX `volCcy24h` 是基础币数量(XLM 比值 100 = 合约乘数实证),非 USDT。改为 **USDT 成交额 = volCcy24h × last** 参与排序与下限;修正 market-data.md / coin-scan.md 语义说明。

验证:
- `npm test`:28 文件 126 测试全绿(更新 coin-scan-service 5 用例)。
- `tsc --noEmit`:干净。
- Playwright 手动(注意:旧实例残留 5173 曾导致误测,清理后 5173 为最新代码):扫描 50 币/9 合格/5m;成交额列按 USDT 排序(BTC/ETH/SOL/XRP 等);复制按钮 → "已复制"反馈(writeText resolved);行点击不再跳转(停留选币页,无新会话)。
