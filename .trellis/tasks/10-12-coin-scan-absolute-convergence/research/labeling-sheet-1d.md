# Research: 1D 标注清单(第 1 轮 ground-truth 采集)

- **Query**: 用 **shipped 检测器**在 Bitget 加密永续 top150 上跑 1D 判定,产出供用户亲自勾选的标注清单
- **Scope**: internal(`src/domain/coin-scan.ts` 的 `probeStructure` + `defaultStructureParams`,**只读**)+ external(Bitget 公开 v2 mix)
- **Date**: 2026-10-12
- **快照 anchor**: `2026-10-12T13:00:30Z`(1D K 线缓存 anchor `2026-10-12T12:39:21Z`,同日复用,差 21 分钟)
- **本轮不改 `src/` / `tests/`,不 commit**

---

## 0. 池定义与数据口径

| 项 | 值 |
|---|---|
| 合约总数(USDT-FUTURES) | 825 |
| 加密池(`isRwa=NO` ∧ `symbolStatus=normal` ∧ 非 `STABLECOIN_QUOTE_PAIRS` ∧ 有成交额) | **465** |
| 标注池 | 按 24h `usdtVolume` 降序取 **top 150** |
| 判定器 | `probeStructure(candles, defaultStructureParams())` → `qualified === true` |
| 1D 门槛 | `score >= timeframeMinScore('1D', 0.6) = 0.50` |
| 1D bar 数 | 143/150 只有 89 根已完成 bar(7 只是次新币:11/24/40/41/42/43/62 根) |
| 抓取失败 | 0 |

**⚠️ 1D 硬上限 90 根(上一轮已发现,本轮再次确认)**:`/market/candles` 的 `granularity=1D` 无论 `limit` 传 200/500/1000 都只回 **90 行**(`/history-candles` 同);`5m/15m/1H/4H` 正常 200 行。故 1D 上「脉冲搜索窗口」实际最深只能回看 60 根、`C` 最长 59 根 —— PRD 里「1D 用 200 根」做不到。

稳定币剔除用 `src/domain/stablecoin-quotes.ts` 的 `STABLECOIN_QUOTE_PAIRS`(USDC/FDUSD/DAI/TUSD/USDD/USDP/USD1/USD0 共 8 个对)。
RWA 剔除用 `contracts` 的 `isRwa === 'YES'`(825 中 359 个被剔),抽样确认被剔的是股票/金属/指数,未见加密币误伤。

---

## 1. 总体清单:1D 合格标的(top150 内,**12 只**)

`score` 降序。

| # | 符号 | 现价 | 1D score | bandLen | 带高% | 实体中位% | r30% | ret30% | mv31_60% | 24h排名 | 标签 |
|---|------|------|----------|---------|-------|-----------|------|--------|----------|---------|------|
| 1 | MOVRUSDT | 1.7266 | 0.792 | 6d | 20.95 | 6.838 | 152.69 | 136.10 | -17.92 | #129 | ❌ |
| 2 | ONEUSDT | 0.002037 | 0.757 | 12d | 38.12 | 5.783 | 225.03 | 215.77 | -9.79 | #150 | ❌ |
| 3 | QNTUSDT | 242.9000 | 0.647 | 8d | 23.66 | 4.358 | 129.74 | 276.30 | 9.89 | #32 | ❌ |
| 4 | BGBUSDT | 1.9568 | 0.645 | 12d | 7.14 | 1.056 | 16.16 | -0.42 | 18.71 | #101 | ❌ |
| 5 | UAIUSDT | 0.338960 | 0.638 | 16d | 53.06 | 4.609 | 178.88 | -47.74 | 155.03 | #111 | ❌ |
| 6 | BTWUSDT | 1.6814 | 0.619 | 10d | 52.69 | 8.585 | 76.37 | 234.99 | 127.85 | #57 | ❌ |
| 7 | AKEUSDT | 0.026309 | 0.593 | 13d | 49.23 | 5.929 | 563.88 | 82.54 | n/a¹ | #121 | ❌ |
| 8 | NILUSDT | 0.094150 | 0.561 | 11d | 42.38 | 6.348 | 117.61 | 119.82 | -1.13 | #67 | ❌ |
| 9 | PROMUSDT | 5.2432 | 0.547 | 31d | 45.91 | 4.210 | 45.91 | 3.02 | 64.12 | #147 | ✅ |
| 10 | TRXUSDT | 0.330420 | 0.533 | 10d | 2.16 | 0.474 | 5.92 | -1.38 | -0.23 | #145 | ❌ |
| 11 | RIVERUSDT | 1.1720 | 0.504 | 7d | 14.25 | 2.812 | 40.27 | -4.56 | -52.62 | #134 | ✅ |
| 12 | WLDUSDT | 0.579200 | 0.501 | 8d | 24.91 | 3.768 | 45.48 | 41.68 | 21.02 | #16 | ❌ |

字段口径:
- `现价` = 末根已完成 1D bar 的 close。
- `bandLen` = shipped 检测器选中的那条 band 的 `runLen`(根数)。**shipped 的 `StructureResult` 不暴露 `runLen`**,本列由探针复刻同一条搜索逻辑取出;`score` 与 shipped 本尊逐只交叉核对,**0 处不一致**。
- `带高%` = band 确认区间 `(rangeHigh − rangeLow) / 现价`(shipped containment 闸用的同一区间)。
- `实体中位%` = 最近 30 根 1D bar 的 `median(|close−open|/close)`。
- `r30%` = 最近 30 根 `(最高 high − 最低 low) / 现价`(含影线的绝对区间)。
- `ret30%` = 最近 30 根净涨跌 `(close₋₀ − close₋₃₀) / close₋₃₀`。
- `mv31_60%` = 第 31~60 根前的净涨跌 `(close₋₃₀ − close₋₆₀) / close₋₆₀`(看「收敛之前有没有行情」)。
- `24h排名` = 在 465 只加密池里的 24h 成交额排名。

¹ `AKEUSDT` 只有 40 根 1D bar(次新币),窗口不足 60 根,`mv31_60%` 记 `n/a`。

---

## 2. 勾选简表(top150 内 1D 合格)

> 说明:这 12 只**全部**是已知标签(见 §3),所以本表**没有新样本**。
> 真正可扩充的候选在 **附录 A**(top150 之外另有 33 只 1D 合格)。

```
- [ ] MOVRUSDT   ❌已知不认可
- [ ] ONEUSDT    ❌已知不认可
- [ ] QNTUSDT    ❌已知不认可
- [ ] BGBUSDT    ❌已知不认可
- [ ] UAIUSDT    ❌已知不认可
- [ ] BTWUSDT    ❌已知不认可
- [ ] AKEUSDT    ❌已知不认可
- [ ] NILUSDT    ❌已知不认可
- [ ] PROMUSDT   ✅已知认可
- [ ] TRXUSDT    ❌已知不认可
- [ ] RIVERUSDT  ✅已知认可
- [ ] WLDUSDT    ❌已知不认可
```

---

## 3. 统计

| 指标 | 值 |
|---|---|
| 加密池总数 | 465 |
| 标注池(top150) | 150 |
| **1D 合格数** | **12 / 150**(= 8.0%) |
| 有任意 band(不要求过门槛)的标的 | 95 / 150;其中 score ≥ 0.50 = 12 |
| 完全无 band(1D 上毫无收敛) | 55 / 150 |
| 12 个已知标签在名单里的数量 | **12 / 12 (=100%)** |
| — 其中 ✅ 认可 | PROMUSDT #9(0.547)、RIVERUSDT #11(0.504) |
| — 其中 ❌ 不认可 | MOVRUSDT #1、ONEUSDT #2、QNTUSDT #3、BGBUSDT #4、UAIUSDT #5、BTWUSDT #6、AKEUSDT #7、NILUSDT #8、TRXUSDT #10、WLDUSDT #12 |

各 `score` 分位(仅 95 只有 band 的标的):`≥0.50 → 12`、`≥0.45 → 16`、`≥0.40 → 21`、`≥0.35 → 30`、`≥0.30 → 42`、`≥0.25 → 59`、`≥0.20 → 75`。

**各周期合格数量(top150 池,阈值 5m/15m/1H = 0.60,4H = 0.55,1D = 0.50):**

| 周期 | 阈值 | 合格数 |
|---|---|---|
| 5m | 0.60 | **2** |
| 15m | 0.60 | **1** |
| 1H | 0.60 | **3** |
| 4H | 0.55 | **12** |
| 1D | 0.50 | **11~12** |

> 各周期名单见 `research/data/labeling-tf-lists.md`(按任务要求,正文只给数量)。
> 一个值得注意的事实:**4H 的 12 只与已知 12 标签几乎不相交**(只有 UAIUSDT 重合)—— 4H 是唯一能提供「新样本」的现成周期。1D 名单则与已知标签**完全重合**。

---

## 4. 产出文件

| 文件 | 内容 |
|---|---|
| `research/labeling-sheet-1d.md` | 本文件 |
| `research/data/labeling-1d-qualified-table.md` | §1 表格的原始生成物 |
| `research/data/labeling-1d-checkboxes.md` | §2 勾选简表的原始生成物 |
| `research/data/labeling-1d-pool.csv` | top150 全量明细(含未合格):symbol,rank,usdtVolume,lastPrice,score1D,bandLen,bandHeightPct,bodyMed30Pct,r30Pct,ret30Pct,mv3160Pct,bars1D,label |
| `research/data/labeling-tf-lists.md` | 各周期合格名单 + **全 465 池的 1D 合格 45 只** |
| `research/data/labeling-tf-qualified-counts.csv` | 各周期合格数 |
| `.scratch/label-1d.ts` | 探针:top150 池 + shipped 1D 判定 + 描述性字段(本轮新增) |
| `.scratch/label-tf.ts` | 探针:top150 × 5 周期 + 全 465 池 1D(本轮新增) |

复现:

```bash
node .scratch/label-1d.ts    # top150 明细 + 勾选表(复用 .scratch/conv-cache/)
node .scratch/label-tf.ts    # 各周期合格名单 + 全池 1D
```

> 复用了上一轮 `.scratch/conv-cache/*.json`(126 只 × 5 周期已缓存);本轮只补拉了新增约 24 只 × 5 周期 + 全池 1D 的 339 只,请求节奏 40ms + jitter(≈20 req/s),0 失败。

---

## 5. 关键发现 / Caveats

1. **top150 的 1D 合格名单 = 恰好那 12 个已知标签,一个不多一个不少。** 这不是巧合 —— 说明用户的 12 个标注**很可能就是这个 shipped 检测器在相近口径下输出的名单**(用户是对检测器结果做的「是/否」判读)。因此:
   - **本清单在 1D 上没有提供任何新样本**,无法直接扩大 ground truth。
   - 想扩大标注,必须换**采样框**:①放宽到全 465 加密池(1D 合格 45 只,top150 之外还有 33 只,见附录 A / `labeling-tf-lists.md`);②或改用 **4H**(12 只,与已知标签基本不相交)。

2. **1D 合格率本身不异常**:150 只里 8.0% 过门槛;95 只有 band 的里 12.6% 过门槛;门槛 0.50 落在一个**连续尾部**上而非空隙里(第 12 名 WLD 0.5006,第 13 名 MUBARAKUSDT 0.4940,第 14 名 USELESSUSDT 0.4699)。所以 `0.50` 这个阈值是「可移动的」:调到 0.49 会放进 MUBARAK,调到 0.55 会砍掉 PROM/TRX/RIVER/WLD。**判定的稳定性依赖阈值,而不是依赖一个天然的 score 断崖。**

3. **top150 这个采样框对 1D 收敛是偏的**:合格标的的 24h 成交额排名大多落在 **#100~#450** 区间(全池 45 只里只有 12 只在 top150)。头部币(BTC/ETH/SOL/BGB 之外的 BTC #1 score 0.278、ETH #2 0.163)几乎从不合格。**按成交额取 topN 会系统性漏掉 1D 收敛。**

4. **top150 边界抖动**:`ONEUSDT` 在两次 ticker 快照里于全池 #150 / #151 之间跳动,导致 1D 名单在 11/12 之间摆动。凡把 `ONEUSDT` 计入的统计都带 ±1 的不确定性。

5. 所有数字基于**单一时间快照**(2026-10-12 13:00Z),加密行情随时变化,重跑会有差异。

6. 本轮**未**验证:检测器判「合格」的形态是否真的符合用户对「日线收敛」的直觉 —— 这正是需要用户标注来回答的问题。

---

## 附录 A:top150 之外、1D 也合格的 33 只(全池 465 只里 45 只)

按 `score` 降序,括号内为 465 只加密池中的 24h 成交额排名:

| 符号 | 排名 | 1D score | | 符号 | 排名 | 1D score |
|---|---|---|---|---|---|---|
| CYSUSDT | #282 | 0.729 | | COTIUSDT | #167 | 0.585 |
| TUTUSDT | #233 | 0.724 | | CATIUSDT | #306 | 0.560 |
| SOONUSDT | #213 | 0.714 | | KERNELUSDT | #432 | 0.559 |
| KAVAUSDT | #319 | 0.700 | | BLESSUSDT | #291 | 0.556 |
| BEATUSDT | #203 | 0.697 | | ACEUSDT | #257 | 0.555 |
| SOPHUSDT | #234 | 0.672 | | REUSDT | #279 | 0.552 |
| ARKUSDT | #192 | 0.658 | | ACUUSDT | #293 | 0.547 |
| HOMEUSDT | #268 | 0.643 | | PROSUSDT | #208 | 0.540 |
| DEXEUSDT | #299 | 0.634 | | SYNUSDT | #184 | 0.532 |
| BICOUSDT | #365 | 0.626 | | VELVETUSDT | #155 | 0.532 |
| ONGUSDT | #258 | 0.620 | | MOVEUSDT | #369 | 0.529 |
| LYNUSDT | #206 | 0.602 | | EVAAUSDT | #263 | 0.527 |
| RAREUSDT | #339 | 0.602 | | BROCCOLIUSDT | #187 | 0.527 |
| CELRUSDT | #433 | 0.592 | | 10000NEXUSDT | #464 | 0.522 |
| MAGMAUSDT | #220 | 0.591 | | MYXUSDT | #354 | 0.513 |
| | | | | ATUSDT | #401 | 0.512 |
| | | | | GENIUSUSDT | #255 | 0.508 |
| | | | | UBUSDT | #180 | 0.507 |

> 拿到这份清单后可直接在聊天里回「要: A、B;C 不要」。
