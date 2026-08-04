# 选币模块(缩量方法 V1) — 技术设计

## 架构与边界

```
[UI] CoinScanPanel(选币) ── GET /api/scan ──> [Server] CoinScanService ──> OKX
   │                                                  │
   │ 点击行跳转 Free Replay                            └─ CandlestickService(缓存复用)
   ▼
App.tsx: setReviewMode('freeReplay') + setFreeReplay(...)
```

- 新文件:`src/server/coin-scan-service.ts`(服务)、`src/ui/CoinScanPanel.tsx`(面板)、`src/domain/coin-scan.ts`(类型)。
- 改动现有文件:`src/server/app-plugin.ts`(加 `/api/scan` 路由)、`src/ui/App.tsx`(加 `'scan'` 模式 + tab + 跳转集成)。
- 不改:candlestick-service、缓存、FreeReplayPanel 内部。

## 数据流与契约

### 1. 请求

```
GET /api/scan?method=shrink&timeframe=5m&topN=50&ratioThreshold=0.7&consecutive=3&window=20
```

`method` 参数化 = 未来扩展点(放量/突破等各带自己的参数集)。V1 服务端只认 `shrink`,其它返回 400。

### 2. 服务端步骤(CoinScanService.scanShrink)

1. `OkxInstrumentService` 或新 fetch:`/api/v5/market/tickers?instType=SWAP`(一次调用,全市场 24h 统计)。响应字段实现期验证;按 24h 成交额(`volCcy24h`)降序。
2. 过滤 `instId` 含 `-USDT-SWAP`,取前 `topN`。
3. 对每个 instrument,调 `candleService.getCandlesticks({ instrument, timeframe, anchor: now, direction: 'earlier', limit: window + consecutive + 2 })` — **复用现有 K 线缓存**。串行执行,避免撞 OKX 限频(约 20 次/2 秒)。
4. 按时间升序排列后,**丢弃最后一根**(未走完的当前 bar),只用已收盘线。
5. 逐根算:量比 `r[i] = vol[i] / mean(vol[i-window .. i-1])`(i 前 window 根均量)。
6. 缩量强度分 `intensity = mean(r[last-consecutive+1 .. last])`;合格 `qualified = 全部连续 consecutive 根 r < ratioThreshold`。
7. 用 tickers 响应填充最新价、24h 涨跌幅。
8. 返回:`{ scanned, qualified: number[], params, scannedAt }`。

### 3. 响应契约

```ts
type ScanShrinkParams = {
  method: 'shrink';
  timeframe: ReviewTimeframe;   // 5m|15m|1H|4H|1D
  topN: number;                 // 默认 50
  ratioThreshold: number;       // 默认 0.7
  consecutive: number;          // 默认 3
  window: number;               // 默认 20
};

type ScanRow = {
  instrument: string;           // BTC-USDT-SWAP
  lastPrice: number;            // 来自 tickers
  change24h: number;            // 来自 tickers,百分数
  currentVolume: number;        // 最近已收盘根成交量
  averageVolume: number;        // 该根前 window 根均量
  ratio: number;                // currentVolume / averageVolume
  intensity: number;            // 最近 consecutive 根量比均值
  consecutiveShrunk: number;    // 实际连续量比<阈值根数
  qualified: boolean;
};

type ScanResponse = {
  scanned: ScanRow[];           // 按 intensity 升序(缩得最狠在前)
  qualifiedCount: number;
  params: ScanShrinkParams;
  scannedAt: string;
};
```

`src/domain/coin-scan.ts` 放这些类型(与 `Candlestick` 等并列),纯类型可被前后端共用。

### 4. UI 集成(App.tsx)

- `ReviewMode` 扩为 `'trade' | 'freeReplay' | 'scan'`。
- 侧边栏 tab:在 Trade Review / Free Replay 下加 `<button>选币</button>`。
- `reviewMode === 'scan'` 时渲染 `<CoinScanPanel />`。
- CoinScanPanel 内部:参数控件(周期下拉 + N/threshold/consecutive/window 数字输入,默认值 5m/50/0.7/3/20)→"扫描"按钮 → 调 `/api/scan` → 渲染排名表。
- 合格行高亮(如绿色背景 + "合格"标记);未合格按强度排序跟进。
- 点击行:组装 `FreeReplayStart`(instrument + 扫描 timeframe + cursor 时间),复用 `chart-time` 里的 `freeReplayCursorTimeForStart` 等工具计算 startTime / cursor 字段;`setReviewMode('freeReplay')` + `setFreeReplay(start)`。此时 FreeReplay 图表直接加载该币该周期近期图。
- 扫描失败:显示中文错误文案 + 保留参数,可重试。

## 兼容与迁移

- 不改现有路由/模式行为;新增 `'scan'` 分支不影响 `'trade'` / `'freeReplay'`。
- `/api/scan` 为新路由,不与现有 `/api/candles` 等冲突。
- 现有 candlestick 缓存天然复用,扫描过的币再次扫描即时返回。

## 关键权衡

- **Top-N 限定范围**:换取扫描成本可控(50 币 ≈ 50 次串行拉取)。代价:Top-N 外缩量小币扫不到。未来可加"自定义关注列表"作为扩展。
- **串行拉取 + 缓存**:稳、不撞限频、重复扫描快。代价:首次全量扫描较慢(50 币 × ~0.3s ≈ 15s 级)。
- **已收盘线判定**:排除未走完当前 bar,信号稳定;代价:5m 信号有最多 5 分钟滞后,与手动刷新机制匹配。
- **通用 method 框架**:V1 只做 shrink,但路由/面板已按 method 分派,新增方法只加 case + 面板控件。

## 运维 / 回滚

- 全为新增文件 + 两个既有文件的小改动;回滚 = `git revert` 或还原这两个文件。
- OKX 不可达:路由统一 502 + 可读 message,UI 展示失败态,不崩溃。
