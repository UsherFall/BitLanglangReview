# Design — 收敛标注工作台

## 1. 边界与定位

- 这是一个**离线工具**，不是生产运行时的一部分。它不注册路由、不进入 `src/` 的构建产物、不被 `src/ui` 引用。
- 它**只读复用**现有模块，绝不复制判定逻辑（避免与 `src/domain/coin-scan.ts` 产生第二份真相）：
  - 取数：`src/server/bitget-tickers.ts` (`BitgetTickerSource`)、`src/server/bitget-candles.ts` (`BitgetCandleSource`)、`src/server/bitget-instrument-metadata.ts`、`src/server/candlestick-store.ts`、`src/server/data-root.ts`
  - 判定：`src/domain/coin-scan.ts` (`coarseStructure` / `coarseScreen` / `probeStructure` / `timeframeMinScore` / `DEFAULT_COARSE_PARAMS` / `defaultStructureParams`)、`src/domain/scan-pool.ts` (`isScannable`)、`src/domain/scan-scope.ts` (`scanScopeOf` / `defaultScanParams`)、`src/domain/market-session.ts` (`isMarketOpen` / `isCandleInSession`)
- 新增目录 `tools/labeling/`（提交入库）。产物落在 `tools/labeling/out/`（gitignore）。

## 2. 运行方式（唯一的基建改动）

Node 原生 TS 无法直接跑本仓库的源码：`src/` 内部是无扩展名 import（`moduleResolution: Bundler`），`node --experimental-strip-types` 会在 `import './scan-scope'` 处失败（已实测）。因此引入 `tsx` 作为 `devDependency`：

```bash
npx tsx tools/labeling/sample.ts        # 抽候选
npx tsx tools/labeling/build-page.ts    # 生成标注页
```

被否决的替代方案：把逻辑复制进脚本（第二份真相，与既有"原型必须逐行对照"的教训冲突）；走 `vite.ssrLoadModule` 自定义 runner（会连带跑 `tradingReviewApiPlugin` 的 `configureServer`，副作用不可控）；把脚本塞进 `vitest`（语义错位）。

`tsconfig.json` 的 `include` 追加 `"tools"`，让工具纳入 `tsc --noEmit` 检查。

## 3. 数据流

```
sample.ts
  BitgetTickerSource.listTickers()
    → 过滤池: quoteVolume24h >= 100_000 → isScannable → scanScopeOf === 'crypto' → isMarketOpen(anchor)
    → anchor = 运行时刻(可用 --anchor 覆盖)
  BitgetCandleSource.getCandlesticks({ timeframe:'1D', direction:'earlier', limit:100, refresh:true })
    → 剔未收盘 bar: timestamp + step <= anchor   (与 coin-scan-service.completedCandles 同规则)
  ── 快照落盘 ── out/candles.json   (key = instrument, value = Candlestick[])
  coarseStructure(每只, DEFAULT_COARSE_PARAMS) → coarseScreen(全部) → passes[]
  probeStructure(每只的 1D, defaultStructureParams())
  分类: 合格 = passes[];  边界 = !pass && score >= 0.35;  拒绝 = 其余
  抽样(固定种子抽 边界/拒绝) → out/candidates.json + out/candidates.csv

build-page.ts
  读 out/candidates.json + out/candles.json
    → 拷 node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js 到 out/
    → 生成 out/label.html (数据以 <script type="application/json"> 内联)
```

关键点：**池过滤、bar 完成判定、判定函数三处都调用线上同一份代码**，因此快照所代表的"检测器输出"与用户在面板里看到的一致。

### 3.1 快照的实测事实（2026-10-14 只读复核）

| 项 | 实测值 |
| --- | --- |
| 端点 | `GET https://api.bitget.com/api/v2/mix/market/candles?productType=USDT-FUTURES&granularity=1D&limit=…&endTime=anchor-1`（= `BitgetCandleSource`，与线上同源同端点） |
| 行数硬顶 | **90**（传 `limit=200` 仍只回 90）→ 快照窗口 ≈ 3 个月 |
| bar 对齐 | **UTC+8 切日**，边界在 `16:00Z`（不是 UTC 零点） |
| 剔未收盘 | `timestamp + step > anchor` 丢弃（与 `completedCandles` 同规则）；crypto 无休市过滤 → 90 行得 **≈89 根已完成** |
| 落盘 | `out/candles.json` 为准据；第二次运行不带 `--refresh` 时不触网、抽样逐行一致 |
| 源缓存 | `data/labeling.sqlite`（`CandlestickStore`），与 `review.sqlite` 隔离 |

即"最新已完成的 1D bar"= 上一个完整收盘的**北京时间日**（例：锚点在 `2026-10-14T02:41Z` 时，最新进快照的是 `2026-10-12T16:00Z` 那根）。

## 4. 抽样

- `合格` 全量 —— 通过粗筛的（10/14 实测 152）。这是线上会出现在结果里的那批，用户的"是/否"直接构成对检测器的评价。
- `边界` = `!passCoarse && score ∈ [bandMin, bandMax]`（默认 `[0.35, 1]`），**全量，不按数量截断**。**不能**写成"按 score 降序取前 30"：10/14 首跑实测 31 只 converged 的币里 21 只没过粗筛，且它们 score 最高，会被前 30 整组吃掉——而"检测器说收敛、粗筛说不要"正是最有信息的一格（检测器与粗筛的分歧）。`--band-max` 才是收窄到贴门槛那一段的旋钮。
- `拒绝` 从剩余池里**固定种子**随机抽（默认 30，`--reject 30`）——用于发现假阴性；量小，因为大多数是明显垃圾。
- 三类各自写入候选记录的 `bucket` 字段。**页面上的顺序是确定性打散**的（种子 = anchor），既避免 152 只合格样本连续出现，也不让用户从顺序反推 bucket。

## 5. 快照与可复现

- `out/candles.json` 是**唯一数据源**：`sample.ts` 用 `--refresh` 决定是否重新拉；不带 `--refresh` 时若缓存存在则**直接复用且完全不触网**（tickers 也在这一路径上被跳过），抽样结果逐行一致（实测连续 3 次 md5 相同）。
- **成交量必须一起冻结**：`quoteVolume24h` / `volumeRank` 来自实时 ticker 拉取，若留活，两次等价重跑的 `candidates.csv` 就会不同（10/14 首跑即踩到）。它们随 K 线一起写进快照的 `volume` 字段。
- 每次运行把 `anchor` 写进候选文件；`labels.csv` 的每一行都带 `anchor`，因此标签可回到确切的那张图。
- 换一轮快照 = `--refresh`（可用 `--anchor` 指定时刻）；这是操作，不是新代码。

## 6. 页面

- 单文件 HTML + 同目录 `lightweight-charts.standalone.production.js`，**file:// 断网可开**。
- 布局：顶部进度 `已标 i / N`；中间一张大图（1D 蜡烛，含合约名、快照日期）；底部三个按钮 + 理由选择。
- 键盘：`Y`/`N`/`?` 记录并前进，`←` 回退。每次记录写入 `localStorage`（键 = `anchor`）。
- `score` 默认隐藏，`S` 键或开关切换显示；切换动作记入该条标注的 `scoreShown` 字段。
- 导出按钮：把 localStorage 里的记录拼成 `labels.csv` 并触发下载（`Blob` + `a[download]`）。

## 7. 契约

`out/candidates.json`
```ts
type Candidate = {
  instrument: string;
  anchor: number;              // 快照时刻 epoch ms
  bucket: 'qualified' | 'boundary' | 'reject';
  score: number;               // probeStructure(...)?.score ?? 0
  structureQualified: boolean; // structure.qualified（找到过三闸全过的 band）
  converged: boolean;          // structureQualified && score >= timeframeMinScore('1D', minScore)
  passCoarse: boolean;         // 通过 1D 粗筛——线上行的判据
  coarse: { rangePct: number; netPct: number; posRange: number } | null; // null = 窗口不足/取数失败
  rangePctThreshold: number;   // 本次池内阈值(全队一致)
  netPctThreshold: number;
  quoteVolume24h: number;      // 来自快照，不是实时
  volumeRank: number;          // 1-based，crypto scope 全池 24h 成交额排名
};
```

`out/candles.json`（快照准据）额外带 `volume: Record<instrument, {quoteVolume24h, volumeRank}>`，理由见 §5。

`out/labels-<anchor>.csv`（页面导出）
```csv
instrument,timeframe,anchor,label,reason,note,scoreShown,labeledAt
PROMUSDT,1D,1791946462789,Y,就是好,,0,2026-10-14T03:00:00.000Z
```
未标项留空 `label`，因此导出的行数恒等于候选数。

## 8. 权衡

- **为什么不在线跑**：判定是纯函数，但取数要打几百个请求；离线跑一次落盘，之后标注与重跑都不再触网，也避开限频。
- **为什么只有 1D**：口径最容易统一，且用户的原问题就是"日线结构"。4H 的增量样本留待下一轮。
- **为什么不做"合格类全池 45 + 大量边界"**：边界样本最能暴露阈值该往哪挪，而拒绝堆边际收益低——默认配比反映了这一点，参数可调。
- **已知代价**：`tools/` 引入一个 `tsx` 依赖；页面用 `localStorage` 存进度，换浏览器/清缓存会丢（导出 CSV 是持久化手段）。

## 9. 回滚

纯新增 + 两处一行改动：删除 `tools/`、从 `tsconfig.json` 的 `include` 去掉 `"tools"`、从 `package.json` 移除 `tsx`、从 `.gitignore` 去掉 `tools/labeling/out/`。不涉及任何运行时路径。
