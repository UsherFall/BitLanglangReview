# Design：选币模块新增「热度」扫描方法

## 1. 架构与边界

```
选币侧栏(CoinScanPanel)            工作区(选币结果)
  method 下拉 [收敛结构|热度] ──────► App.scanResult{method, data}
  参数区按 method 切换                    │
  扫描 → GET /api/scan?method=...         ├─ shrink → CoinScanResults(现状表格)
        │                                  └─ heat   → HeatScanResults(MarketHeatView)
        ├─ method=shrink → CoinScanService.scanShrink（现状，可随 MARKET_DATA_SOURCE 换源）
        └─ method=heat   → marketHeatService.computeHeat({anchor, poolTopN?})（恒 Binance）
```

- 不新建共享服务；复用 `MarketHeatService`（app-plugin 已持有 Binance 实例，L24/233 区域）。
- 新增 UI 文件：`src/ui/HeatScanResults.tsx`；呈现抽取：`MarketHeatPanel.tsx` 中把"result → 视图"段提为可导出展示组件（见 §3）。

## 2. 后端 `/api/scan` 加 `method=heat`

app-plugin.ts `/api/scan` 路由（现 :196-222）改为按 method 分发：

- `method=shrink`：现逻辑不动。
- `method=heat`：
  - 参数：`anchor`（可选，缺省 `Date.now()`；提供时须 `>0`），池固定 `HEAT_POOL_TOP_N=80` 不暴露池大小参数。
  - 调用 `marketHeatService.computeHeat({ anchor })`（无 reviewInstrument）。
  - 返回 `MarketHeatResult`（结构即 `/api/market-heat` 的同构体）。
  - 非法参数沿用 400 文案风格（'Invalid scan parameters' / 'Unsupported scan method' 保留给未知 method）。
- 路由内同时持有 `coinScanService` 与 `marketHeatService`（均已实例化），无构造改动。
- `MarketHeatResult` 无 method/params 回显；前端用本地扫描时刻/锚点做标题。可接受，或后端简单包 `{ ...result }` 即可（不加字段）。

## 3. 结果视图抽取与复用（R4）

`src/ui/MarketHeatPanel.tsx` 现状：fetch /api/market-heat → header(标题/锚点/close) + 结果视图（tier + numbers + HeatBoard×2 + skips + warnings）。

### 抽取目标（防双份样式漂移）
- 在 `src/ui/market-heat-view.tsx` 新建**纯展示组件**：
  ```tsx
  export function MarketHeatView({ result }: { result: MarketHeatResult })
  ```
  内含：TIER_LABEL/TIER_HINT、tier 块、numbers 行、涨幅榜/跌幅榜（HeatBoard）、skips、warnings 渲染。文案/className 与现 MarketHeatPanel 完全一致。
- `MarketHeatPanel.tsx` 重构为：保留 fetch/loading/error/header（含 close），正文改渲染 `<MarketHeatView result={result} />`；文件内原 HeatBoard/renderSkips/常量随迁或导出自 market-heat-view.tsx（建议一并迁出，MarketHeatPanel 只留 header+数据获取）。
- `HeatScanResults.tsx`（新）：
  - 接收 `{ result: MarketHeatResult; scannedLabel: string }`（scannedLabel = 锚点本地时间或"现在"）。
  - 渲染与选币一致的 `detail-header`（标题「选币结果 · 热度」/ 副标题锚点）→ `<MarketHeatView result={result} />`；无 close。
- 回归：MarketHeatPanel DOM/文案不变 ⇒ `tests/market-heat-panel.test.tsx` 不改即绿（如取测试库断言 class 文本，保持 class/文案一致即可）。

## 4. 选币 UI（CoinScanPanel + App）

- `CoinScanPanel.tsx`：
  - `const [method, setMethod] = useState<'shrink'|'heat'>('shrink')`；方法下拉由 disabled 改为可控（选项 收敛结构/热度，value=shrink/heat）。
  - 参数区按 method 切换：
    - shrink：扫描数量/最低成交额/结构强度阈值/扫描时间点（现状）。
    - heat：只显示扫描时间点（锚点，留空=现在）；最低成交额/结构强度阈值不显示。
  - `scan()`：按 method 拼 query；`onScanned` 上抛带 method 的结果。
  - `CoinScanPanelProps.onScanned` 类型改为 `(result: ScanResult) => void`，其中
    ```ts
    type ScanResult = { method: 'shrink'; data: ScanResponse } | { method: 'heat'; data: MarketHeatResult };
    ```
  - 状态文案/提示按 method 区分（heat 提示：留空=现在场子热度；需要几秒拉全池）。
- `App.tsx`：
  - `scanResult` 状态类型改为 `ScanResult | null`（现 :212 `ScanResponse|null`）。
  - 工作区（:766）：`scanResult && (scanResult.method==='heat' ? <HeatScanResults result={scanResult.data} scannedLabel={...}/> : <CoinScanResults result={scanResult.data} .../>)`。
  - CoinScanResults 内部 `result===null` 空态不再需要（App 已分派）；类型改收 `ScanResponse`。

## 5. 兼容与回滚

- `/api/scan` shrink 分支与响应结构零改动；MarketHeatPanel 对外行为不变。
- R4 抽取独立提交；若复盘热度有回归，直接 revert 该提交。
- 全量验证：`npm test` + `npx tsc --noEmit`。

## 6. 测试

- UI：MarketHeatPanel 既有测试必须保持绿（抽取回归）；为 MarketHeatView/HeatScanResults 补一个渲染断言（如 tier label 文案 + 涨跌榜行数），或并入 market-heat-panel 测试新增用例；CoinScanPanel 方法切换/参数区切换若无现成测试，做最小单测或手工。
- 后端：/api/scan 无路由级测试先例；新增可省略或对 `scanShrink`/`computeHeat` 已有单测不做新增；如做，用 app-plugin 层集成会较重——本轮以手工 dev 验证 method=heat + 参数校验覆盖（记录在 implement.md）。
- 回归：tests/coin-scan-service.test.ts、market-heat-service.test.ts、market-heat.test.ts 全绿。
