# Design: 收敛结构检测(三角/低波动箱体)

## 架构总览

改造现有「缩量」方法为**收敛结构检测**。核心改动在 `src/domain/coin-scan.ts`(算法)+ `src/server/coin-scan-service.ts`(取数/装配)+ `src/ui/CoinScanPanel.tsx`(参数/结果表)。API method 仍为 `shrink`,契约升级。

```
candles(某周期, completed)
  → probeSwings(): 候选 N 扫描,选最规整结构的 N,产出 swing highs/lows
  → classifyStructure(): 'triangle' | 'box' | null + 明细
  → scoreStructure(): 收敛强度分 + 结构内位置
  → 每周期一个 StructureResult
装配:一币一行,含全部周期结构结果
```

## 模块边界

- `src/domain/coin-scan.ts`:
  - `detectSwings(candles, n)` → `SwingPoint[]`(纯函数,确定性,单 N fractal)。
  - `probeStructure(candles, params)` → `StructureResult | null`(候选 N 扫描:各 N detect + classify,选最规整)。
  - `classifyStructure(swings)` → `StructureResult | null`(纯函数,单 N 结构分类)。
  - 类型:`ConvergenceStructure = 'triangle' | 'box'`;`StructureResult`;新 `ScanRow` 结构。
- `src/server/coin-scan-service.ts`:
  - `scanShrink` 改为调 `computeStructure`,拉足 K 线(窗口自适应,不再固定 13 根)。
  - 参数解析更新(极简参数面)。
- `src/server/app-plugin.ts`:`/api/scan` 参数校验适配新参数。
- `src/ui/CoinScanPanel.tsx`:参数面板极简化,结果表列改为结构类型/位置/强度分。

## 数据结构

```ts
export type ConvergenceStructure = 'triangle' | 'box';

export type StructureResult = {
  /** 结构类型;null = 该周期无收敛结构。 */
  structure: ConvergenceStructure | null;
  /** 结构内位置 0..1:箱体=(价-箱底)/(箱顶-箱底);三角=当前价在收敛区间的相对位置。 */
  position: number;
  /** 收敛强度分,越大越强。排序主键。 */
  score: number;
  /** 触碰次数(各边 swing 触点之和)。 */
  touchCount: number;
  /** 是否通过结构成熟度门槛。 */
  qualified: boolean;
};

export type ScanRow = {
  instrument: string;
  lastPrice: number;
  change24h: number;
  quoteVolume24h: number;
  /** 各周期结构结果,scanTimeframes 序。 */
  structures: Record<ReviewTimeframe, StructureResult>;
  /** 有合格结构的周期列表。 */
  convergedTimeframes: ReviewTimeframe[];
  qualifiedCount: number;
  /** 全部合格周期里最强 score。 */
  bestScore: number;
  qualified: boolean; // qualifiedCount >= 1
};
```

`ShrinkScanParams` 极简化:

```ts
export type ShrinkScanParams = {
  method: 'shrink';
  topN: number;
  minQuoteVolume24h: number;
  anchor?: number;
  /** 结构强度阈值主旋钮;调高 = 宁少勿滥。 */
  minScore?: number;
};
```

## 算法设计

### 1. swing 检测(探测型 N —— 候选 N 扫描)

对已完成 K 线升序排列后:

```
swing high: bar[i] 是局部最高 ⟺ high[i] 严格大于左右各 N 根 high
swing low:  bar[i] 是局部最低 ⟺ low[i]  严格小于左右各 N 根 low
```

**探测型 N(用户选定方案 B,真自适应):** 不预置 N,而是在候选 N 集合上全试,选产出**最规整结构**的那个 N。

```
候选 N = [2, 3, 4, 5, 6, 8, 10, 12]
对每个 N:
  swings_N = detectSwings(candles, N)   // fractal + 相邻同向去重
  structure_N = classifyStructure(swings_N)  // 结构分类(见下节)
选 N* = 产出结构最规整者:
  优先级: 有结构(非 null) > 触碰次数多 > swing 对数多 > score 强
```

- 每个币、每个周期独立探测到自己的结构尺度:小盘整在小 N 显形,大盘整在大 N 显形。
- 窗口 = 该 N 下 swing 间距,从结构量出来,不预设。
- 无任何 N 产出结构 → 该周期 null(不收敛)。
- 若多个 N 都产出结构,取触碰最多者(结构最可信);平手取 score 强、N 适中者(防大 N 过度平滑)。

候选 swing 后处理:
- 相邻 swing 去重:连续多个 same-direction swing 只留极值。
- 需至少 4 个 swing(2 high + 2 low)才可能构成结构 → 不足返回 null。

### 2. 结构分类

取最近的 swing 序列(如最近 4~8 个 swing),按类型分列:

**箱体**:
- highs 组、lows 组各自线性回归,斜率 ≈ 0(斜率容差内,如 |slope| / 平均价格 < 阈值)。
- 箱高 = mean(highs) − mean(lows),相对该币前期波动收窄(箱高/前期平均振幅 < 阈值)。
- 各边触碰 ≥ 2 次(highs 点数 ≥ 2 且 lows 点数 ≥ 2)。

**三角**:
- highs 组回归斜率 < 0(下移)、lows 组回归斜率 > 0(上移)→ 对称收敛三角。
- 一边平(highs 斜 ≈ 0 且 lows 升 / highs 降且 lows 斜 ≈ 0)→ 上升/下降三角。
- 两线延伸后向一点收敛(斜率异号即满足基本条件)。
- 各边触碰 ≥ 2 次。

**位置**:
- 箱体:`position = (lastPrice − boxLow) / (boxHigh − boxLow)`。
- 三角:用当前价在两趋势线之间的相对位置,接近收敛点 → 接近突破前兆。

**强度分**:
- 箱体:`score = 收缩比贡献 + 水平度贡献 + 触碰贡献`。收缩越强、越水平、触碰越多分越高。
- 三角:`score = 收敛度(两线往一点的聚合速度)+ 触碰贡献`。
- 统一归一化到可比区间,作为排序主键。

### 3. 全周期装配

- 每周期独立拉 K、独立 detect/classify/score。
- 一币一行,`structures` 按 scanTimeframes 序。
- 行仅在 `qualifiedCount >= 1` 时出现(宁少勿滥)。
- 排序:`qualifiedCount desc` → `bestScore desc`(结构越强越靠前)。

## 取数窗口(探测型)

不再固定 13 根。每周期拉取量随结构尺度需求:

```
perTimeframeLimit(timeframe) = max( baseLimit, 预估结构跨度所需 )
5m/15m: 拉 ~100 根(小盘整快速演化)
1H/4H:  拉 ~100 根
1D:     拉 ~40 根
```

具体值 implement 阶段校准。swing 间距大(大级别盘整)时若窗口不足,swing 检测自动只看到窗口内能容纳的结构 —— 配合全周期扫描覆盖成长。

## 兼容性与迁移

- **API 契约变化**:`/api/scan?method=shrink` 参数从 `plateauMin/maxCompression/maxLatestTrend/trendWindow` 改为 `minScore`。旧参数被忽略或 400。
- **响应结构变化**:`ScanRow` 从 `timeframes/compression/latestTrend/score/plateauWidth` 改为 `structures/position/score/touchCount`。UI 同步改。
- **测试**:`tests/coin-scan-service.test.ts` 现有用例基于旧机制(qualifyingAmplitudes 步进收窄),需改写为构造真实箱体/三角形态。新增纯函数单测:`detectSwings`(已知形态)+ `classifyStructure`(箱体/三角/下跌中继)。
- **回滚**:保留 git 历史;旧行为可通过还原 `coin-scan.ts` + 服务层恢复。UI 参数面板旧字段移除前先与用户确认。

## 风险与权衡

- **swing 检测质量**是全案核心风险:自适应 N 参数不当 → 漏结构或噪声。缓解:纯函数 + 真数据校准 + 实盘对照。
- **箱体/三角误判**:水平/收敛判定阈值松紧直接影响宁少勿滥。缓解:`minScore` 主旋钮让用户可调。
- **性能**:每周期拉 100 根 × 5 周期 × topN 币,并发受现有 SCAN_CONCURRENCY=10 限制。缓存已存在,可接受。
