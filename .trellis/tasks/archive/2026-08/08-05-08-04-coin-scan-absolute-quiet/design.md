# 缩量扫描收敛约束:极致收敛判定 (v2) — Design

## 架构总览

改动在 quiet-consolidation 判定链路。上一轮 boxTightness(未提交)基础上迭代:v2 移除 amplitudeRatio 相对门、box 窗口从 consecutive 改 boxWindow、收紧阈值。

```
UI (CoinScanPanel)              -- boxWindow + maxBoxRatio 输入(预填 12 / 0.9,恒携带)
   │
   ▼
app-plugin.ts /api/scan         -- 可选 boxWindow/maxBoxRatio 解析;移除 volatilityThreshold
   │
   ▼
CoinScanService.scanShrink      -- 拉取 limit = max(window+consecutive, boxWindow)+1;透传
   │
   ▼
computeQuietMetrics             -- calm = volumeRatio<阈值;boxTightness(boxWindow) 门槛
```

## 判定公式

`computeQuietMetrics`(completed bars,升序):

```
// 逐根 calm —— 只剩量缩门
calm[i] = volumeRatio[i] < ratioThreshold          // volumeRatio = 当前量 / 前 window 根均值

// 箱体形状 —— 窗口 = boxWindow(独立于 consecutive)
N = boxWindow
lastN = sorted 尾部 N 根完成 bar
R = (max(high) - min(low)) / min(low)
m = mean( 每根 (high-low)/low )
boxTightness = m > 0 ? R / (m * sqrt(N)) : 0

qualified = consecutiveQuiet >= consecutive      // 尾部连续 consecutive 根量缩
         && boxTightness <= maxBoxRatio          // 极致收敛
```

**为什么这样满足用户诉求**:
- **boxWindow 长**(12):大阳/大阴落近 12 根内 → R 巨大 → boxTightness 高 → 拒。新鲜旗形出局,只有「坐实窄箱」过。
- **maxBoxRatio 紧**(0.9):随机震荡 ≈ 1.0 被拒,只有嵌套极窄箱(< 1.0)过 = 极致。
- **删 amplitudeRatio 门**:它是「大阴大阳后盘整」过筛的元凶,也让长安静币被误拒(比值≈1)。boxTightness 单独扛形状。
- **留 volumeRatio 门**:量缩到低;死币(一直没量,比值≈1)被拒。

## 契约

### 类型 (domain/coin-scan.ts)

```ts
export const DEFAULT_BOX_WINDOW = 12;
export const DEFAULT_MAX_BOX_RATIO = 0.9;

// ShrinkScanParams / QuietMetricsParams:
// 移除 volatilityThreshold
// 新增: boxWindow: number(默认 12), maxBoxRatio: number(默认 0.9)
// 保留: ratioThreshold, window, consecutive
// ScanRow / QuietMetrics 增: boxTightness
```

`window` 仍作 volumeRatio 参考窗口;amplitudeAverages 计算删除(不再用)。

### 数据不足守卫

```
count < window + consecutive || count < boxWindow  → null
```

(volumeRatio 需 window+consecutive 根;boxTightness 需 boxWindow 根。)

### 路由参数

| 参数 | 类型 | 缺省 | 说明 |
| --- | --- | --- | --- |
| `boxWindow` | number 可选 | 12 | `null`/空/NaN → undefined → 默认;填了 `<= 0` → 400 |
| `maxBoxRatio` | number 可选 | 0.9 | 同上 |

用 optional 解析(不用 `parseScanParam`,其 `Number(null)===0` 缺陷)。`volatilityThreshold` 移除。

## 关键决策与权衡

### 长 boxWindow 天然排除近期大蜡烛
不用单独写「无近期大阳」检测——大阳只要在近 12 根内,箱体区间就被撑破,boxTightness 自动超阈值。一个机制干两件事(排除旗形 + 要求坐实)。
- **权衡**:刚收敛 5 根的币(还没满 12 根)会被拒,直到盘整坐实 12 根。用户要「收敛到极致」,可接受;想更早,调小 boxWindow。

### 删振幅相对门,boxTightness 扛形状
amplitudeRatio 相对门与「长安静」冲突,是误报源。boxTightness 已含形状信息(每根振幅 m + 总区间 R)。
- **权衡**:丢一个可调旋钮(volatilityThreshold);换来对「极致收敛」的直击。

### 量缩门保留作「蓄力」信号
volumeRatio < ratioThreshold 筛量缩;死币(无量、比值≈1)被拒,符合「缩量蓄力」原始语义。
- **权衡**:统一安静的活币若量不再缩(比值≈1)也会被拒——用户要的是「量缩到极致」,接受。

### 阈值 0.9 + boxWindow 12 是起点
scale-free 保证跨币种/周期一致;数值按用户扫描结果调。结果太少 → 放大 maxBoxRatio / 调小 boxWindow;混入新鲜旗形 → 反之。

## 兼容性与回滚

- 未提交迭代,无历史负担;工作区 v1.5 改动在实现前回 HEAD 或直接改写。
- 移除 volatilityThreshold 是契约变更,route/UI/测试/spec 同步;老请求带 volatilityThreshold 会被忽略(URL 多余参数无害)。
- 触碰文件全部可单提交回滚。
