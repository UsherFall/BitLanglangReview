# Design: 收敛结构-回溯窗口检测

## 架构变化

当前:`probeStructure` 固定 8-swing 窗口 + 候选 N + classifyStructure。

新:窗口确定改回溯扫描,swing 检测与形态边界扫描分离。

```
candles(100 根, completed)
  → detectSwingsOnce(): 候选 N 全试,得完整 swing 序列(每 N 一个序列)
  → backscanWindow(): 从当前往回扫 swing 序列,找最后一段满足形态条件的连续子序列
  → 破斜率终止(容忍度判定毛刺)
  → classifyStructure(该子序列): 输出结构类型/位置/强度
```

## 模块边界(coin-scan.ts)

- `detectSwings(candles, n)` — 保留,单 N fractal。
- `probeStructure(candles, params)` — **改造**:不再"固定窗口选最规整 N",改为:
  1. 对每个候选 N,detectSwings 得完整 swing 序列。
  2. `backscanWindow(swings, params)` 找形态连续段。
  3. 若该 N 下找到形态段,记录;选最优 N(触碰多/跨度长)。
- 新增 `backscanWindow(swings, params)`:从 swing 序列末尾往回,确定形态起点。
- `classifyStructure` — 保留核心几何判定,但窗口参数改为"回溯确定的子序列"。

## 回溯扫描算法(`backscanWindow`)

```
swings = 完整 swing 序列(按时间序,末端=当前)
i = swings.length - 1  // 从当前往回
while i > 0:
  // 检查 swing[i] 是否"破坏"当前形态
  // 形态方向:三角 = 高降低升;先假定一个候选方向组合
  // 破斜率判定:单根 swing 反向即破,但容忍度区分毛刺

候选段 = 从 i 往回取一段连续 swing(至少 B 根 K 跨度)
对候选段跑 classifyStructure:
  若成形 → 记录起点 i,继续往回扩(看是否更长形态也成立)
  若破 → 终止,取最后成立的起点
```

更具体:往回扫维护"当前形态起点"。每纳入一个更早的 swing,检查:
- 它是否保持形态(高降/低升/收窄)?
- 若违反(单根反向),用容忍度判定:
  - 该 swing 对应 K 的**收盘**相对趋势线的穿透距离 ≤ 容忍度 → 毛刺,形态保持,记为该 swing 是毛刺。
  - 穿透 > 容忍度 → 真破,终止,起点 = 破位 swing 之后那个 swing。
- 扩展时检查跨度(当前起点到末端)≥ B,否则不判三角/箱体。

**容忍度**:收盘穿透趋势线的距离 ≤ X% × 当前结构宽度(该位置两趋势线间距)。初始 X=0.2(20%)。

## 破斜率/毛刺判定

- **影线穿透**:不算(swing 点是 high/low 影线,穿透趋势线但收盘收回 → 毛刺)。
- **收盘穿透**:该 K 收盘价相对趋势线穿透距离 > 容忍度 → 真破。
- 实现:classifyStructure 时,对候选段内每个 swing,检查其收盘(需要 swing 关联 K 的 close —— SwingPoint 需扩展存 close,或 backscanWindow 拿原始 candles)。

## B(最小成形跨度)

| 结构 | B 初始 | 说明 |
|---|---|---|
| 三角 | 13 根 | 12-13 起试,数据校准 |
| 箱体 | 5 根 | 用户定 |

- 每周期一致(形态以根计,不看真实时间)。
- B 是兜底门:回溯段跨度(起点 swing 到当前)的 K 根数 ≥ B 才判。

## 单调性判定(重新设计)

用户质疑百分比容差。新方案:单调性 = 相对结构自身。
- 三角趋势边:每个后续 swing 必须不**明显**反向。"明显" = 反向幅度超过该边已观测的波动范围的 X%。
- 具体:反向 swing 的穿透距离,用同一容忍度机制(收盘穿透 vs 结构宽度)判定 —— 与毛刺判定统一。
- 即:单调性检查和破斜率判定是**同一个机制**(单根反向 + 容忍度),不再单独用百分比容差。

## 输出契约

`StructureResult` 不变(`{ structure, position, score, touchCount, qualified }`)。服务层/API/UI 不变。

## 校准实验(implement 阶段)

1. B 扫描:三角 B=[12,15,20,25,30],看候选数下降曲线找拐点。
2. 容忍度:X=[0.1,0.2,0.3,0.5],看误判率。
3. 用真实案例集:MRVL/SNDK/SOXX(真三角)、INTC/HEI/XRP(误判)校准。

## 兼容与回滚

- 接口不变,服务层/API/UI 不动。
- 回滚点:保留 `probeStructure` 旧实现?不,直接改。git 历史可回滚。
- 现有测试大量适配(窗口机制变了)。
