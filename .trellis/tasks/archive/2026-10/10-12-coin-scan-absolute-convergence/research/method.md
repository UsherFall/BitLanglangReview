# Research: 口径 v1(脉冲锚定的绝对收敛)精确定义与复现

- **Query**: 实现 PRD「离线验证口径 v1」探针;在 12 已知样本上标定;在更大样本上出命中名单
- **Scope**: mixed(内部代码口径 + 外部 Bitget 公开行情)
- **Date**: 2026-10-12
- **任务**: `.trellis/tasks/10-12-coin-scan-absolute-convergence`
- **数据快照 anchor**: `2026-10-12T12:39:21.705Z`(= 2026-10-12 20:39 CST)
- **本轮不改 `src/`**;所有结论来自 `.scratch/` 下的探针实跑

---

## 1. 口径 v1 的精确定义

对每个 (标的, 周期) 取一串**已完成** K 线 `c[0..L]`(升序,`c[L]` 为最新已收 bar)。

### 1.1 找脉冲 `p`

- 搜索窗口 `W = c[max(0, L - lookbackPulse + 1) .. L]`,`lookbackPulse = 60`。
- 候选下标 `p ∈ [max(0, L - 59), L - minConsol]`,即收敛段至少留 `minConsol = 5` 根。
- `p = argmax_{候选} score(i)`;**并列时取更晚的一根**(离现在更近)。
- 本报告实测了 6 种 `score`(见 §1.4)。**主口径用成交额**,因为它是唯一能让 12 样本分开的(见 `calibration.md`)。

### 1.2 收敛段 `C`

`C = c[p+1 .. L]`,`len(C) = L - p`。要求 `len(C) ≥ minConsol`。

### 1.3 度量(`C` 上)

记 `vol_i = (high_i - low_i) / low_i`(**振幅,含影线** —— 与 shipped 的 `vol` 同口径,不是实体)。

| 度量 | 公式 |
|---|---|
| `rangePct` | `(max_{i∈C} high_i − min_{i∈C} low_i) / close_L` |
| `bodyMedPct` | `median_{i∈C}( |close_i − open_i| / close_i )` |
| `bodyMaxPct` | `max_{i∈C}( |close_i − open_i| / close_i )` |
| `decline` | `median(vol 后半) / median(vol 前半)`,其中 `half = floor(len(C)/2)`,`前半 = vol[0..half-1]`,`后半 = vol[len-half..len-1]` |
| `volTrend` | `Spearman(索引 i, vol_i)` on `C`(负 = 递减趋势) |
| `stepDownFrac` | `#{i∈C: vol_i < vol_{i−1}} / (len(C) − 1)` |
| `containment` | `1` iff `close_L ∈ [min low, max high] of C[0..len(C)−2]` |
| `retSincePulse` | `(close_L − close_p) / close_p` |
| `pulseAmpVsMed` | `((high_p − low_p)/low_p) / median_{i∈W}(vol_i)` |
| `pulseBodyVsMed` | `(|close_p − open_p|/close_p) / median_{i∈W}(body_i)` |
| `qvRel` | `quoteVol_p / median_{i∈W}(quoteVol_i)` |
| `maxBarVsMed` | `max_{i∈C}(vol_i) / median_{i∈C}(vol_i)` |
| `pulseDir` | `sign(close_p − open_p)`;`pulseBarsAgo = L − p` |

> **口径修正 1(v1 原文有 bug,已修)**:PRD 写「`containment` = 现价仍在 C 的区间内」。若区间含末根自身,`close_L ∈ [low_L, high_L]` **恒真**,该闸失效 —— 这与 `src/domain/coin-scan.ts` 的 `CONVERGENCE_CONFIRMED_TAIL` 注释里记的坑是同一个。本探针用**剔除末根**的区间算 containment。

> **口径修正 2**:`decline` 的分半在中位数为偶数长度时用**上中位数** `s[floor(n/2)]`,与 `src/domain/coin-scan.ts` 的 `median` 完全一致。

### 1.4 试过的脉冲定义

| key | score(i) |
|---|---|
| `body` | `|close-open|/close`(**v1 原文的默认**) |
| `amp` | `(high-low)/low`(v1 的备选) |
| `qv` | `quoteVol`(成交额)—— **主口径** |
| `qvrel` | `quoteVol / median_{W}(quoteVol)` |
| `bodyrel` | `body_i / median_{W}(body)` |
| `thrust3` | `|close_i − close_{i−3}| / close_{i−3}`(3 根推力) |

### 1.5 候选门槛

`rangePct ≤ R(tf)`、`decline ∈ [D_lo, D_hi]`、`len(C) ∈ [minConsol, maxConsol]`、`containment = 1`,
可选 `pulseAmpVsMed ≥ P`、`|retSincePulse| ≤ Rt`。门槛以标定结果为准,不预设。

---

## 2. 数据源与实测约束(重要)

`https://api.bitget.com/api/v2/mix/...`,公开 v2 mix,无需 key。

| 用途 | 端点 |
|---|---|
| tickers | `GET /api/v2/mix/market/tickers?productType=USDT-FUTURES` → `usdtVolume` |
| contracts | `GET /api/v2/mix/market/contracts?productType=USDT-FUTURES` → `isRwa` = `YES`/`NO` |
| candles | `GET /api/v2/mix/market/candles?productType=USDT-FUTURES&symbol=X&granularity=<5m\|15m\|1H\|4H\|1D>&limit=200` |

行格式 `[ts, open, high, low, close, baseVol, quoteVol]`,**升序**(最旧在前)。

实测确认的约束:

1. **`1D` 被 Bitget 硬性截断在 90 根**。`limit` 取 90/100/200/500/1000 都只返回 90 行;`/history-candles` 同样只给 90 行。
   ⇒ PRD 里写的「1D,200 根窗口」**做不到**;1D 上实际是「89 根已完成 bar,脉冲搜索窗口 = 最后 60 根,C 最长 59 根」。
   `5m/15m/1H/4H` 均正常返回 200 根。
2. `granularity` **大小写敏感**:`5m/15m/1H/4H/1D`。写成 `1d`/`1h` 会失败。
3. 1D bar 的边界是 **UTC+8 零点**(时间戳落在 UTC 16:00),不是 UTC 0:00。
4. 去掉未完成 bar:`ts + step <= anchor`,`step` = 300000/900000/3600000/14400000/86400000。
5. 请求节奏:脚本用 40ms + 10ms jitter 起步间隔(≈20 req/s 名义上限),429 时指数退避重试。126 标的 × 5 周期 = 630 请求 0 失败。
6. 原始 K 线缓存于 `.scratch/conv-cache/<SYMBOL>-<TF>.json`(带回 anchor,同日内复用)。

---

## 3. 探针脚本

| 文件 | 作用 |
|---|---|
| `.scratch/conv-lib.ts` | 取数(带缓存/节流)+ 统计 + 度量 + 门槛;**唯一权威实现** |
| `.scratch/conv-dump.ts` | 打印指定标的尾部逐根 K 线(绝对价 + body%/amp%/成交额倍数),人眼定位脉冲 |
| `.scratch/conv-diag.ts` | 12 样本 × 6 种脉冲定义的度量对比 |
| `.scratch/conv-calibrate.ts` | 12 样本 1D 标定 + 门槛网格(落 `calibration-sweep.csv`) |
| `.scratch/conv-sweep2.ts` | 2838 万组参数组合穷举,找「2 YES 命中 / 0 NO 命中」区域 |
| `.scratch/conv-power.ts` | 单度量区分力排序(最佳阈值/余量/阻塞样本)+ 多候选脉冲语义 |
| `.scratch/conv-robust.ts` | 稳健性:脉冲选点(lookback × topK)敏感性 + `decline` 度量变体 |
| `.scratch/conv-scan.ts` | 大样本扫描:top120 + watchlist × 5 周期,出命中名单与敏感性 |
| `.scratch/conv-tighten.ts` | 离线二次分析(读 `all-metrics.csv`,不再联网) |
| `.scratch/gen-sens.py` | 生成 `ret-and-range-sensitivity.md` |

### 复现命令

```bash
cd <repo root>
node .scratch/conv-dump.ts 1D PROMUSDT RIVERUSDT   # 看形态
node .scratch/conv-calibrate.ts                    # 12 样本标定
node .scratch/conv-sweep2.ts                       # 参数区域穷举(约 16s)
node .scratch/conv-power.ts                        # 区分力排序
node .scratch/conv-robust.ts                       # 稳健性
node .scratch/conv-scan.ts                         # 大样本命中名单(约 3 分钟)
node .scratch/conv-tighten.ts 1D
python .scratch/gen-sens.py
```

Node 24 原生 strip-types 直接跑 `.ts`(无需 tsx);脚本 import 时写显式 `.ts` 后缀。

---

## 4. 大样本口径

1. `contracts` 里取 `isRwa === 'NO'` 且 `symbolStatus === 'normal'` → 825 个合约中 359 个 `isRwa=YES` 被剔除。
   抽样确认被剔除的头部名单是股票/金属:`SOXLUSDT, SNDKUSDT, XAUUSDT, KORUUSDT, MUUSDT, CLUSDT, XAGUSDT, MSTRUSDT, BZUSDT, SKHYNIXUSDT, XAUTUSDT, NVDAUSDT, SPCXUSDT, INTCUSDT …`,未见加密币被误伤。
2. 再用 `src/domain/stablecoin-quotes.ts` 的 `STABLECOIN_QUOTE_PAIRS` 去重(脚本内联同一份名单)。
   ⇒ 剩 **465** 个加密永续候选。
3. 按 24h `usdtVolume` 降序取 **top 120**。
4. **额外补 12 个标定样本到扫描池**(watchlist,标 `*`),因为 PROM/RIVER 排名在第 120 名之外,否则无法交叉核对:

   | 标的 | 全量加密排名(465 中) |
   |---|---|
   | WLDUSDT | #16 |
   | QNTUSDT | #32 |
   | BTWUSDT | #57 |
   | NILUSDT | #67 |
   | BGBUSDT | #101 |
   | UAIUSDT | #111 |
   | AKEUSDT | #123 |
   | MOVRUSDT | #128 |
   | RIVERUSDT | #134 |
   | TRXUSDT | #143 |
   | PROMUSDT | #147 |
   | ONEUSDT | #151 |

   ⇒ 扫描池 = 126 只/周期,共 630 条记录,**0 条抓取失败**。

---

## 5. 产出文件

| 文件 | 内容 |
|---|---|
| `research/method.md` | 本文件 |
| `research/calibration.md` | 12 样本标定过程与结论,含分不开的样本 |
| `research/hit-lists.md` | 大样本各周期命中名单 + 敏感性 |
| `research/data/all-metrics.csv` | 630 条 (标的, 周期) 的全量逐条度量(主口径 `qv`) |
| `research/data/universe.csv` | 扫描池 126 只 + 24h 成交额 + 排名 + watch 标记 |
| `research/data/calibration-1d-metrics-body.csv` / `-amp.csv` | 12 样本 1D 在两种脉冲定义下的全量度量 |
| `research/data/calibration-sweep.csv` | 12 样本门槛网格(2838 万组)的逐组命中数 |
| `research/data/pulse-defs-1d.csv` | 12 样本 × 6 种脉冲定义 |
| `research/data/pulse-snapshot-1d.csv` | 12 样本 × 6 种脉冲定义(更全字段) |
| `research/data/power-12.md` | 单度量区分力排序 + 多候选语义 |
| `research/data/sweep-12.md` | 完美分离组合分布 + 各 NO 的泄漏频率 |
| `research/data/hits-summary.md` | 各参数集 × 周期的命中数量 |
| `research/data/hits-lists-raw.md` | 7 个参数集 × 5 周期的完整命中名单(含全部度量) |
| `research/data/sensitivity.md` | 命中数随 `rangePct 上限 × decline 带` 的变化 |
| `research/data/ret-and-range-sensitivity.md` | 命中数随 `rangePct 上限 × |retSincePulse| 上限` 的变化 |
| `research/data/distribution-by-tf.md` | 各周期 `rangePct` / `decline` 的分位数 |
| `research/data/watch-cross-check.md` | 12 标定样本 × 5 周期 在各参数集下是否命中 |
| `research/data/calibration-raw.md` | 标定脚本的原始 markdown 输出 |
| `research/data/scan-failures.txt` | 抓取失败记录(本次为空,未生成) |

---

## 6. Caveats

- **1D 只有 90 根** 是硬约束。任何「1D 用 200 根」的假设(包括 PRD 里的表头)都不成立。1D 上能看到的「前置行情」最多 89 天。
- 度量全部基于**当前快照**。加密行情随时间变化,重跑会有差异;`anchor` 已记录在 `all-metrics.csv` 的生成时刻(2026-10-12T12:39Z)。
- `quoteVol` 用的是 Bitget 返回的 `quoteVol`(USDT 计价成交额),不是 `baseVol`。
- 标定样本只有 12 个,**不是统计意义上的样本**;本轮所有「能分开」的结论都必须按「12 个点上拟合」来读。`calibration.md` 给了过拟合证据。
- 未做的事:未验证「脉冲」是否应该允许多根(脉冲段而非单根);未做跨时段的样本外回放(只有单一时间快照);未评估把口径落成正式代码后的性能。
