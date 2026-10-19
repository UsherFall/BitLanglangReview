# Implement — retention 判据替换扫描排序

> 设计见 `design.md`；需求见 `prd.md`。**只改 5 个源文件 + 3 个测试文件**，不动 `detectConvergence` / `detectBoxBrace` / 粗筛 / 池。

## 执行顺序（每一步都能单独编译/测试）

### 1. 领域层：`src/domain/coin-scan.ts`
- [ ] 1.1 新增常量 `RETENTION_WINDOW = 60`（导出，可参数覆盖）与 `DEFAULT_RETENTION_PCT = 0.1`。
- [ ] 1.2 新增 `export type RetentionMeasure = { retention: number; offHigh: number; legPct: number }` 与纯函数
      `export function retentionStructure(candles: readonly Candlestick[], window = RETENTION_WINDOW): RetentionMeasure | null`
      规则严格按 design §2（起点=窗口内最低**收盘**；hi=起点后最高**最高价**；hi==lo → retention 0；<W 根 → null；非正价 → null）。
- [ ] 1.3 `ScanRow`：删 `bestScore`，加 `retention?: RetentionRow`（类型 `RetentionRow = RetentionMeasure & { rank: number; poolSize: number }`）。
- [ ] 1.4 `ShrinkScanParams` 增加 `retentionPct?: number`（文档：0<X≤1，缺省 0.1）。
- [ ] 1.5 文件头/`ScanRow` 注释里所有 "bestScore 排序" 的描述同步改写。

### 2. 服务层：`src/server/coin-scan-service.ts`
- [ ] 2.1 `coinsFetches` 之后：用**同一份** `completed` 算 `retentionStructure()`（有值者入 `ranking`）。
- [ ] 2.2 按 retention 降序（稳定排序，不加次级键）建 `rankMap: instrument → rank`；`poolSize = ranking.length`；
      `cut = Math.max(1, Math.round(pct * poolSize))`，`pct = params.retentionPct ?? DEFAULT_RETENTION_PCT`。
- [ ] 2.3 出行条件 = `passes[index] && completed !== null && !failed && rank < cut`；行上写 `retention: { ...measure, rank, poolSize }`。
- [ ] 2.4 排序改为 `retention` 降序；删 `highestLevel` / `bestScore` 相关代码与注释。
- [ ] 2.5 响应 `params` 回显 `retentionPct`。

### 3. 路由：`src/server/app-plugin.ts`
- [ ] 3.1 解析 `retentionPct`（`parseOptionalNumber`）；非法（≤0 或 >1）→ 400 `Invalid scan parameters`。
- [ ] 3.2 传进 `scanShrink`。

### 4. UI：`src/ui/CoinScanPanel.tsx`
- [ ] 4.1 参数区新增「位置前 X%」输入（默认 `10`，0.1~100）；`scan()` 校验后发 `retentionPct = X/100`。
- [ ] 4.2 删「强度分」列与其 `formatScore(row.bestScore)`；新增「位置」（`retention` 百分比 + `title` 名次）与「离高点」（`offHigh` 一位小数）。
- [ ] 4.3 头部统计加「位置前 10% K 个」。
- [ ] 4.4 明细子表**保留** `score` 列（`StructureResult` 原始字段）。

### 5. 注释：`src/ui/coin-scan-rows.ts`
- [ ] 5.1 注释里的排序键改成 `retention` 降序（逻辑不变）。

## 验证命令

```bash
npx tsc --noEmit
npm test
# 新增/改动的测试
npx vitest run tests/coin-scan-service.test.ts tests/coin-scan-results.test.tsx tests/coin-scan-rows.test.ts
```

## 测试计划

| 文件 | 用例 |
|---|---|
| `tests/coin-scan.test.ts`（或新建 `retention.test.ts`） | `retentionStructure`：WAL 形状高 retention / CFX 形状低；起点用收盘（长下影不算起点）；<60 根 → null；全平 → 0；`offHigh`/`legPct` 数值 |
| `tests/coin-scan-service.test.ts` | ①只出 retention 前 X% 的行（20 币池，X=0.5 → 10 行）；②`bestScore` 不再存在、行上有 `retention.rank/poolSize`；③排序按 retention 降序；④X 缺省 10%；⑤`retentionPct` 回显；⑥粗筛未过的币即使 retention 高也不出行 |
| `tests/coin-scan-results.test.tsx` | 表头不含「强度分」、含「位置」「离高点」；头部出现「位置前」统计；行内显示百分比 |
| `tests/coin-scan-api.test.ts`（若已有路由测试文件则并入） | `retentionPct=0` / `1.5` / `abc` → 400；合法值透传 |

## 回归闸门（review gate）

- [ ] `git diff --stat` 只涉及上述 5 个源文件 + 测试；
- [ ] `git diff src/domain/coin-scan.ts` 里 `detectConvergence` 函数体**零改动**（用 `git diff -U0` 目视确认）；
- [ ] AC3 脚本 `POOL_DIR=... node .scratch/research-10-19/rebound-rule.mjs` 复跑仍给出 64.7% / 30.3%；
- [ ] 全量 `npm test` 干净。

## 回滚点

- 每个步骤结束后 `git stash`/单文件 revert 都能回退；整体回滚 = revert 一个 commit（无迁移、无 schema）。
