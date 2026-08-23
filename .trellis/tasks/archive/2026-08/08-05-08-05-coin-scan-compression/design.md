# 扫描收敛 v3:波动压缩判定 — Design

## 架构总览

在 v2(量缩 + boxTightness)基础上加**波动压缩门** + **收窄趋势门**,并**移除 boxTightness 箱体门**。全是相对自己过去的比率,scale-free,不加绝对百分比。

```
UI (CoinScanPanel)              -- maxCompression + maxLatestTrend + trendWindow 输入;压缩比/收窄趋势 列
   │
   ▼
app-plugin.ts /api/scan         -- 可选 maxCompression/maxLatestTrend/trendWindow 解析
   │
   ▼
CoinScanService.scanShrink      -- limit = max(window+consecutive, 2*boxWindow)+1;透传
   │
   ▼
computeQuietMetrics             -- 量缩门 && compression 门 && latestTrend 门
```

## 判定公式

`computeQuietMetrics`(completed bars,升序):

```
N = boxWindow(默认 12)
T = trendWindow(默认 4)
recent  = sorted 尾部 N 根
prior   = sorted 尾部 N..2N 根(紧邻 recent 之前)
meanAmp(w) = mean(每根 (high-low)/low over w)

compression = meanAmp(prior) > 0
            ? meanAmp(recent) / meanAmp(prior)
            : (meanAmp(recent) > 0 ? LARGE_RATIO : 0)

// 收窄趋势:最近 T 根 比 再前 T 根 还要小 = 波动仍在变小
latest = meanAmp(尾部 T 根)
middle = meanAmp(尾部 T..2T 根)
latestTrend = meanAmp(middle) > 0
            ? latest / meanAmp(middle)
            : (latest > 0 ? LARGE_RATIO : 0)

qualified = consecutiveQuiet >= consecutive            // 量缩门(volumeRatio<ratioThreshold)
         && compression <= maxCompression              // 波动压缩门(0.8)
         && latestTrend <= maxLatestTrend              // 收窄趋势门(0.9)
```

**boxTightness 已移除**:v3 目标「现在在收敛且收敛到极致」由 compression + latestTrend 承担,箱体度不是扫描必选。实证(XAU 4H):收敛窗口 compression 0.18~0.68(达标)、量缩达标、quiet 到 12,却全被 boxTightness 1.13~1.81 拒——黄金是缓坡压缩(振幅持续收窄但价格区间跨度相对偏大),不是紧箱体。移除后黄金收敛窗口(comp 达标 + latestTrend < 0.9)可过;latestTrend 仍拦截「躺平后波动反升」(08-02 起 trend>1.2)。

**为什么是压缩**:用户原话「现在的波动明显比之前小」。平躺币(一直安静)recent≈prior → compression≈1 → 拒,无张力。真压缩币 recent << prior → 通过。

**为什么还要 latestTrend**:用户扫 1H 发现 CRCL/NBIS 漏网——12/12 压缩只看「比之前小」,漏了「现在的波动是不是还在变小」:
- GIGGLE(对):latest 2.02 < middle 2.88 → 0.70 → 收窄 ✓
- CRCL(不对):latest 0.83 ≈ middle 0.89 → 0.93 → 走平,无「越来越小」感 ✗
- NBIS(不对):latest 1.42 > middle 1.02 → 1.39 → 波动在放大 ✗
latestTrend < 0.9 恰好分开三者。

## 契约

### 类型 (domain/coin-scan.ts)

```ts
export const DEFAULT_MAX_COMPRESSION = 0.8;
export const DEFAULT_MAX_LATEST_TREND = 0.9;
export const DEFAULT_TREND_WINDOW = 4;

// 移除: DEFAULT_MAX_BOX_RATIO、maxBoxRatio、boxTightness

// ShrinkScanParams / QuietMetricsParams 增:
maxCompression: number;          // 缺省回落 DEFAULT_MAX_COMPRESSION
maxLatestTrend: number;          // 缺省回落 DEFAULT_MAX_LATEST_TREND
trendWindow: number;             // 缺省回落 DEFAULT_TREND_WINDOW
// QuietMetrics / ScanRow 增:
compression: number;             // 均幅比;prior 均幅 0 时 recent>0 → LARGE_RATIO,否则 0
latestTrend: number;             // 最近 T 根 / 再前 T 根 均幅比;middle 均幅 0 时 latest>0 → LARGE_RATIO,否则 0
```

### 数据不足守卫

```
count < window + consecutive || count < 2 * boxWindow  → null
```

(compression 需 2×boxWindow 根;latestTrend 的 T ≤ boxWindow,已覆盖。boxTightness 移除后 boxWindow 仍是压缩窗口,守卫不变。)

### 路由参数

| 参数 | 类型 | 缺省 | 说明 |
| --- | --- | --- | --- |
| `maxCompression` | number 可选 | 0.8 | `null`/空/NaN → undefined → 默认;填了 `<= 0` → 400 |
| `maxLatestTrend` | number 可选 | 0.9 | 同上 |
| `trendWindow` | number 可选 | 4 | 同上;`>= 1` 且 `<= boxWindow` |

optional 解析(复用 parseOptionalNumber,不用 parseScanParam)。`maxBoxRatio` 解析删除。

### 路由参数

| 参数 | 类型 | 缺省 | 说明 |
| --- | --- | --- | --- |
| `maxCompression` | number 可选 | 0.8 | `null`/空/NaN → undefined → 默认;填了 `<= 0` → 400 |
| `maxLatestTrend` | number 可选 | 0.9 | 同上 |
| `trendWindow` | number 可选 | 4 | 同上;`>= 1` 且 `<= boxWindow` |

optional 解析(复用 parseOptionalNumber,不用 parseScanParam)。

### JSON 序列化注意

`compression`/`latestTrend` 可能为 `Infinity`(分母均幅 0 且分子>0)。JSON 序列化 `Infinity` → `null`,前端显示空。**改用哨兵**:给大数 `LARGE_RATIO`(已有常量 1_000_000_000),避免 null。两字段输出始终是有限数。

## 关键决策与权衡

### 压缩窗口 = boxWindow,prior 紧邻 recent
两个等长相邻窗口,语义直白:「最近 N 根 vs 前 N 根」。prior 紧邻 recent,不混入更早的杂讯。
- **权衡**:窗口长度敏感(12 vs 24 结论可能不同),用户可调 boxWindow。

### latestTrend 捕捉「还在变小」,不只看「比之前小」
12/12 压缩(compression)漏掉「走平」(CRCL)和「放大」(NBIS)。latestTrend = 最近 T 根 / 再前 T 根,要求波动**向现在收窄**。
- **实证**(1H):GIGGLE 0.70 ✓、CRCL 0.93 ✗、NBIS 1.39 ✗——0.9 阈值恰好分开。
- **权衡**:统一小箱体(各根一样小)latestTrend ≈ 1 会被拒——用户明确要「越来越小」的张力,接受;想放行可调大 maxLatestTrend。

### 用均幅不用区间
meanAmp 对「单根波动收窄」(三角/箱体都如此)直接响应;区间 R 受 drift/重叠干扰。
- **权衡**:均幅对孤立大 bar 敏感(一根大 bar 抬均幅),但压缩门比较的是两段均幅,单根影响被稀释。

### 硬门 + 展示列
合格必须过所有门;**同时把 压缩比/收窄趋势 显示在结果列**,用户扫完肉眼对照调阈值。
- **权衡**:门越多越严格,结果越少;但用户明确要「收敛到极致」,宁少勿滥。

### 移除 boxTightness 门
boxTightness(箱体形状)是 v2 用「箱体」近似「收敛」的旧工具,与 v3「波动压缩」语义正交。黄金实证:真正的缓坡压缩(compression 0.18)因非紧箱体被 box 门误杀。目标「现在在收敛且收敛到极致」由 compression(比之前小)+ latestTrend(还在变小)承担。
- **权衡**:移除后「收敛但形状不紧」的币(缓坡/三角)可进;新鲜旗形(大阳线后小整理)仍由 compression 挡(大阳线在 recent 窗口 → 均幅高)。结果池比 v2 大,但语义对齐用户目标。
- **1D 局限**:黄金 1D 卡在量缩门(quiet 不足),与 box 无关,另开任务处理。

## 兼容性与回滚

- 新增可选参数 + 新字段 + 新门,全部增量;老请求(不带 maxCompression)回落默认 0.8,行为变严。
- service limit 公式改变(2×boxWindow),只影响拉取根数,不破坏既有。
- `compression: Infinity` 用 LARGE_RATIO 哨兵防 JSON null。
- **boxTightness 移除是破坏性变更**:`maxBoxRatio` 参数、`boxTightness` 字段、UI 输入框/列全删。老请求带 `maxBoxRatio` 会被忽略(route 不再解析);旧客户端引用 `boxTightness` 字段会得 undefined。本项目单客户端,可接受。
- 触碰文件全部可单提交回滚。
