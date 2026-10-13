# Implement — 选品:扩池 + 1D 分位粗筛 + 小级别绝对收敛

> 依赖 `design.md`。实现前先跑 `trellis-before-dev` 加载 `server/coin-scan.md`。
> **三段推进**:[A] 扩池 → [B] 分位粗筛落地 → [C] 小级别只做离线标定。

## A. 扩池(可独立验证)

1. **`src/domain/scan-scope.ts`** — `DEFAULT_SCAN_PARAMS` 的 `topN` 由"硬门槛"改为**上限保护**(默认取消或取远大于 150 的值,如 1000);`minQuoteVolume24h` 保留为低门槛。
2. **`src/server/coin-scan-service.ts`** — 池构造去掉 `slice(0, topN)` 的硬截断(或仅在显式传 `topN` 时生效);`skippedInstruments` 语义不变。
3. **`src/server/app-plugin.ts`** — `topN` 校验放宽(不再 `>= 1` 强制);缺省 = 全池。
4. **`src/ui/CoinScanPanel.tsx`** — `扫描数量` 输入框语义改为"上限(留空=全池)",默认值调整为全池。
5. **验证**:跑一次真实扫描,记录**行数 / 请求数 / 时长**,与现状(top150×5=750 次,~82s)对比;确认**池内出现了 KAVA/CATI/BLESS/ACE 这类中低市值标的**。

## B. 1D 分位粗筛落地

6. **`src/domain/coin-scan.ts`** — 新增 `coarseStructure(candles, params)`(**纯函数**,输出 `rangePct` / `netPct` / 度量;**不改** `detectConvergence`/`score`)+ 文件顶部默认常量。
7. **`src/domain/scan-scope.ts`** — 新增分位粗筛常量:`T = 23`、`pctR = 0.7371`、`pctN = 0.4849`(来自 465 池标定;务必**在池内重算分位阈值,不写死 `W`/`D`**)。
8. **`src/server/coin-scan-service.ts`** —
   - **两阶段取数**:先全池取 1D → 算分位阈值 → 剔除未通过者 → **只对通过者取其余周期**;
   - 行入选 = 通过 1D 粗筛;新增 `coarse` 字段(含本次实际分位阈值);`ScanResponse` 增对应字段。
9. **`src/ui/CoinScanPanel.tsx`** — 结果表新增"结构"列(盘整时长 / 区间 / 净漂移),老列语义不变。
10. **测试** — 新增 `tests/coin-scan-coarse.test.ts`(纯函数:分位排序、边界、池内重算);`tests/coin-scan-service.test.ts` 补"两阶段取数只对通过者取其他周期"与"行入选"用例;复核既有用例。
11. **spec** — `server/coin-scan.md`(池定义变更 + 新字段 + 两阶段取数 + 请求预算);`server/market-data.md`(**Bitget 1D 90 根硬上限**);`frontend/component-guidelines.md`(新列 + `扫描数量` 语义)。
12. **门禁**:报告多锚点下的**正样本覆盖**与**负样本混入**;若负样本混入 >0 或覆盖 <7/8,**回到用户**。

## C. 小级别绝对收敛(只离线标定,**不落地**)

13. 在粗筛通过的标的上,对 `5m/15m/1H/4H` 各取末尾窗口,标定 `B/R/D2/n`(按周期分级)。
14. **报告**:7~8 个正样本在其小级别上的表现、门槛敏感性、**全池通过率**(必须证明不是"人人都有窄区间")。
15. **门禁**:交用户确认后才决定是否落 `src/`(另开步骤或子任务)。

## 验证命令

```bash
npx vitest run tests/coin-scan.test.ts tests/coin-scan-service.test.ts tests/coin-scan-coarse.test.ts
npx vitest run tests/coin-scan-panel.test.tsx tests/coin-scan-results.test.tsx tests/scan-scope.test.ts
npx tsc --noEmit
```

## 风险文件 / 回滚点

- 风险最高:`coin-scan-service.ts` 的**池构造 + 两阶段取数** —— 会改变结果集合与请求模式,必须跑 service 与 results 测试,并**实测一次真实扫描的时长**。
- 回滚:恢复 `topN` 硬门槛 + 删除 `coarseStructure`/新字段;`detectConvergence` 未被触碰。

## `task.py start` 前检查

- [x] `prd.md` / `design.md` / `implement.md` 三件套齐全(计划已因"扩池"实质变更,**需用户重新批准**)
- [ ] `implement.jsonl` / `check.jsonl` 含真实 spec 条目
- [ ] 用户已批准最新规划摘要(扩池版)
