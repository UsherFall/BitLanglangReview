# Design — 选品:扩池 + 1D 分位粗筛 + 小级别绝对收敛

依赖 `prd.md`。**本设计在获批后有过一次实质性变更**:标定研究发现**真正的瓶颈是扫描池**(8 个正样本里 4 个的成交额排名在 #257~#319,根本进不了 top150),用户据此决定**扩到全 465 加密永续**。因此系统重排为三段:

```
[A] 扩池:扫描范围 = 全 465 加密永续(不再用 topN 当硬门槛)
[B] 1D 分位粗筛:按当前池内分位取"盘得够久 + 收得住 + 不在趋势中"的一批(宽)
[C] 小级别绝对收敛:在粗筛通过的标的上,按周期判"实体小 + 小区间"(精确)
```

## 1. 边界与改动面

| 层 | 文件 | 改什么 |
|---|---|---|
| domain | `src/domain/scan-scope.ts` | 池参数:`topN` 由"硬门槛"改为**上限保护**(默认取消 / 取全池);新增分位粗筛常量 |
| domain | `src/domain/coin-scan.ts` | 新增 `coarseStructure`(**纯函数**,含分位排序所需的度量);**不碰** `detectConvergence`/`score` |
| server | `src/server/coin-scan-service.ts` | 池构造改为全池;新增"全池 1D 粗筛 → 通过者再取其他周期"的两阶段取数;行上新增字段 |
| server | `src/server/app-plugin.ts` | `topN` 语义与校验(可选,不再强制) |
| ui | `src/ui/CoinScanPanel.tsx` | 结构列 + 各周期绝对收敛标记;`topN` 输入框语义调整 |
| spec | `server/coin-scan.md`、`server/market-data.md`、`frontend/component-guidelines.md` | 同步(含 **Bitget 1D 90 根上限** 与 **池定义变更**) |

**不改**:`detectConvergence`/`score` 公式与语义、限流 pacer/gate、换源。

## 2. 契约

### 2.1 [A] 池:全 465 加密永续

- 池 = `tickerSource.listTickers()` 里 **`isScannable(class)` ∧ `scanScopeOf(class) === scope`** 的全部标的(加密类约 465;equity scope 同规则)。
- **`minQuoteVolume24h` 保留为低门槛**(防止纯垃圾合约),但**不再是主要选择器**;`topN` 改为**上限保护**(默认不限;若保留,值要远大于 150)。
- **代价(必须记录在 spec)**:冷扫请求量上升。估算:全池 1D ≈ 465 次 + 通过粗筛者(≈44% ≈ 205 只)× 其余 4 个周期 ≈ 820 次 ⇒ **≈1285 次**(现状 top150×5 = 750 次)。Bitget 20 req/s ⇒ **≈65s**,与现状冷扫(~82s)同级;**pacer/gate 不动**。

### 2.2 [B] 1D 分位粗筛

在 1D 已完成序列(≤90 根)上,对窗口 `T`(天)算 `rangePct = (max high − min low)/close` 与 `|netPct|`,然后**在本次扫描的池内按分位取靠前的一批**:

```
通过 ⟺ rangePct ≤ percentile(pool, pctR)  ∧  |netPct| ≤ percentile(pool, pctN)
```

- 初值(来自 `research/coarse-1d-percentile.md` 的 465 池标定):`T = 23`、`pctR = 0.7371`、`pctN = 0.4849` ⇒ 覆盖 7/8 正样本、0/9 负样本混入、池通过率 **≈44%**。
- **阈值每天从当次池内重算,绝不写死 `W`/`D`** —— 这是"池率腐蚀消除"(31.2pp → 4.7pp)的原因。
- **已知残留**:`AND(分位R, 分位N)` 等价于"自适应绝对盒",**没有新增区分力**;正样本覆盖仍会从**第 9 个锚点**起漂移。⇒ 粗筛**只做宽筛**,精度不指望它。

### 2.3 [C] 小级别绝对收敛(第 2 段;**本轮只做标签,不做入选条件**)

对每个小周期 `tf ∈ {5m,15m,1H,4H}` 的末尾窗口(长度 `n(tf)`):

| 量 | 定义 |
|---|---|
| `bodyMedPct` | `median(\|close−open\|/close)` —— **实体小**(用户口径,不是 `high-low`) |
| `rangePct` | `(max high − min low)/close` —— 价格在**小区间** |
| `netPct` | 窗口净涨跌 —— 排除"还在趋势中" |

门槛 `B/R/D2/n` **按周期分级**,由离线标定给出(**不预设立场**);**不要求"先拉起"**(用户 Q8)。

### 2.4 行与字段

- **行入选** = 通过 1D 粗筛(池内分位)。预期行数 ≈ 200(全池 465 × 44%)。
- 新增:`coarse`(通过 + 度量 + 本次的分位阈值)与 `absConv`(按周期的绝对收敛标记 + 度量)。
- **老字段(`structures`/`convergedTimeframes`/`qualifiedCount`/`bestScore`/`qualified`)语义不变**,契约向后兼容。
- ACE 固定不在第 1 段(结构性失配,见 `prd.md` Q9)⇒ 它靠第 2 段/别的维度。

## 3. 数据流

```
/api/scan?source=&scope=            (topN 不再是硬门槛)
  → tickerSource → 全池(≈465)
  → ① 全池取 1D K 线 → 分位粗筛 → 不通过者剔除(只花了 1 次/标的)
  → ② 通过者按需取其余周期 K 线 → absoluteConvergence() 标记
  → 行(coarse + absConv + 老字段) → 排序 → ScanResponse(含本次分位阈值)
```

两阶段取数让**未通过粗筛的标的只消耗 1 次请求**,这是扩池后请求量仍可控的关键;沿用既有 candle store 与 `bitget:` 命名空间。

## 4. 实施顺序(有门禁)

1. **先落地 [A] 扩池**(可独立验证:行数、请求量、时长)。
2. **再落地 [B] 分位粗筛**(纯函数 + 服务层接入):报告行数、覆盖 7/8、负样本 0 混入、以及**多锚点成分漂移**的实测。
3. **[C] 只做离线标定**(研究),交用户确认后才落 `src/`。

## 5. 兼容性 / 回滚

- 纯新增 + 池改动;`detectConvergence`/`score`/老字段不动。回滚 = 恢复 `topN` 硬门槛、删除新增函数与字段。
- 无数据迁移(只读 K 线)。

## 6. 风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 扩池后请求量/时长上升 | ≈1285 次 ≈65s(最坏) | 两阶段取数(未通过者只 1 次);pacer/gate 不动;UI 提示时长 |
| 行数暴涨 | ≈200 行(原 top150 最多 150) | 粗筛已筛一轮;结果表可加排序/过滤(现有 `orderScanRows` 稳定分组) |
| 粗筛无新增区分力 | 分位 ≡ 自适应绝对盒 | **精度不指望粗筛**;粗筛只负责"缩小范围 + 不漏" |
| 成分漂移残留 | 正样本第 9 锚点起掉 | 记录为已知;第 2 段承担精度 |
| ACE 固定漏掉 | 结构性失配 | 已由用户确认(Q9) |
| equity scope 同规则 | 未单独标定 | 本轮先做 crypto;equity 沿用同一实现、参数待验 |
