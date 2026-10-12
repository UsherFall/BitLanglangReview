# Design — 选品收敛打分与扫描池调整

## 1. 边界与改动面

| 层 | 文件 | 改什么 |
|---|---|---|
| domain | `src/domain/coin-scan.ts` | 新增"每周期阈值偏移"常量 + 有效阈值函数(纯函数) |
| server | `src/server/coin-scan-service.ts` | 合格判定改用有效阈值;排序改为"最高合格级别优先" |
| domain | `src/domain/scan-scope.ts` | `DEFAULT_SCAN_PARAMS.crypto.topN` 60 → 150 |
| ui | `src/ui/CoinScanPanel.tsx` | 仅提示文案(说明大级别自动更宽容);不新增输入框 |

**不改**:`detectConvergence` / `score` 公式(09/20 决策:score 只表示缩量深度)、限流 pacer/gate、池的选池口径(仍用当前实时成交额)、`minQuoteVolume24h` 默认值。

## 2. 契约

### 2.1 domain 新增(`src/domain/coin-scan.ts`)

```ts
/**
 * 单旋钮的每周期偏移:大级别收敛门槛更低。UI 仍只有一个"结构强度阈值"旋钮
 * (默认 0.6);每周期有效阈值 = max(0, minScore + offset)。
 */
export const TIMEFRAME_SCORE_OFFSET: Readonly<Partial<Record<ReviewTimeframe, number>>> = {
  '5m': 0, '15m': 0, '1H': 0, '4H': -0.05, '1D': -0.10,
};

/** 某周期的有效合格阈值(下界夹到 0,避免负阈值)。 */
export function timeframeMinScore(timeframe: ReviewTimeframe, minScore: number): number {
  return Math.max(0, minScore + (TIMEFRAME_SCORE_OFFSET[timeframe] ?? 0));
}
```

> 类型是 `Partial<Record<...>>` 而非 `Record<...>`:`ReviewTimeframe` 有 8 个成员(含 `1m/1W/1M`),扫描只测 5 个,未收录周期按偏移 0 处理(`?? 0`),与 5m/15m/1H 同待遇。

- 默认 0.6 时:5m/15m/1H=0.60,4H=0.55,**1D=0.50**。
- **向后兼容**:service 的 `minScore` 缺省是 `0`,加上偏移后 1D 得 `max(0,-0.10)=0`,与改动前逐字节一致;受影响面只有"显式传 minScore"的调用(即 UI)。

### 2.2 server 合格判定(`coin-scan-service.ts:137-140`)

```ts
const converged = scanTimeframes.filter((tf) => {
  const s = structures[tf];
  return s.qualified && s.score >= timeframeMinScore(tf, minScore);
});
```

### 2.3 server 排序(`coin-scan-service.ts:160`)

新增"级别序" = `scanTimeframes` 的下标(5m=0 … 1D=4)。每行取 `highestLevel = max(level(c) for c in convergedTimeframes)`。

```ts
rows.sort((a, b) =>
  b.highestLevel - a.highestLevel ||   // 1) 最高合格级别 desc
  b.qualifiedCount - a.qualifiedCount || // 2) 合格周期数 desc
  b.bestScore - a.bestScore);            // 3) 最强分 desc
```

- 等键时靠 JS 稳定排序保留原 ticker(成交额)顺序 —— 满足既有稳定序测试。
- `ScanRow` 契约**不新增字段**(`highestLevel` 仅排序期局部变量);`convergedTimeframes` 已按升序排列,`strongestTimeframe = convergedTimeframes.at(-1)`,UI 需要时可直接推导,无需入参。

### 2.4 默认参数(`src/domain/scan-scope.ts`)

`crypto.topN: 60 → 150`;`equity.topN` 保持 30;`minQuoteVolume24h` 两者不变。

### 2.5 UI(`CoinScanPanel.tsx`)

- 不新增输入框;`minScore` 旋钮默认仍 `0.6`。
- 提示文案补充一句:阈值对 4H/1D 更宽容(单旋钮自动按级别微调),避免用户以为排序/阈值没生效。

## 3. 数据流(不变)

`/api/scan` → `CoinScanService.scanShrink` → tickerSource(实时池,topN=150)→ candleSource(锚点 K 线)→ `probeStructure`(逐周期)→ **每周期阈值判定** → **最高级别优先排序** → `ScanResponse`。

## 4. 限流与时长

- topN=150 ⇒ 150 × 5 = **750** 次 klines(weight 2)= 1500 weight;110ms pacer ⇒ ~**82s** 冷启动(未命中缓存时)。
- 每分钟请求上限 ~545 ⇒ 每分钟权重 ~1090,仍 ≤ 45% 的 2400 上限 → **不引入 418 风险**(pacer/gate 未改)。
- 锚点历史扫描命中缓存后基本不再发请求;`refresh` 仅对"当前"扫描为真。

## 5. 关键取舍

- **不改 score 公式**:用户诉求是"大级别更值钱",但 09/20 已刻意移除 length bonus 并论证过;方案用"合格门槛 + 排序"表达,而不是把级别塞回 score。这样 `强度分` 列仍是原始缩量深度,语义不漂移。
- **单旋钮 + 内部偏移**:避免 UI 出现 5 个阈值框;偏移是小常量(-0.05/-0.10),既能让 1D≈0.51 入选,又不放开小级别。
- **topN=150 而非去 topN**:去 topN 会让池随行情漂移且单次数分钟;150 是"覆盖到 STRK 当时量级(169 名)"与时长之间的折中。

## 6. 兼容性 / 迁移 / 回滚

- 无数据迁移;纯常量与排序逻辑。
- 缺省 `minScore=0` 路径行为不变;历史锚点缓存继续复用。
- 回滚 = 还原 3 个源文件(coin-scan.ts / coin-scan-service.ts / scan-scope.ts)+ 1 处文案。

## 7. 风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 列表变长 | 1D/4H 门槛降低会多出"只有大级别收敛"的币 | 偏移很小;基础旋钮仍 0.6;`弱收敛`可再调严 |
| 排序变化冲击手感 | 原 `qualifiedCount` 优先改为级别优先 | `收敛结构` 列已列出合格周期,顺序可解释;文档同步 |
| 扫描变慢 | 60→150 使冷扫 ~33s→~82s | 手动触发;UI 提示;缓存命中后更快 |
| 规格文档过期 | `server/coin-scan.md` 记录了 60/topN 与 0.6 单阈值 | Phase 3 更新 spec |
