# 选币模块优化-复制币名与流动性筛选 — 技术设计

## 架构与边界

增量修改上一任务交付的选币模块。改动集中在:
- `src/domain/coin-scan.ts` — 参数/行字段增删。
- `src/server/coin-scan-service.ts` — 成交额下限过滤 + 行字段。
- `src/server/app-plugin.ts` — `/api/scan` 新参数解析。
- `src/ui/CoinScanPanel.tsx` — 参数输入 + 复制按钮 + 成交额列。
- `src/ui/App.tsx` — 移除 `openScanReplay` 及跳转相关集成。
- `src/ui/chart-time.ts` — 移除 `formatReviewInputTime`。

## 数据流与契约

### 1. 请求

```
GET /api/scan?method=shrink&timeframe=5m&topN=50&ratioThreshold=0.7&consecutive=3&window=20&minQuoteVolume24h=10000000
```

新增 `minQuoteVolume24h`(USDT,默认 `10_000_000`,即 1000 万)。解析用现有 `parseScanParam`,`>= 0` 校验。

### 2. 服务端扫描顺序(CoinScanService.scanShrink)

1. `fetchTickers()` 拿全市场 24h 统计。
2. 过滤 `instId` 含 `-USDT-SWAP`。
3. **过滤 `quoteVolume24h < minQuoteVolume24h` 的币**(R3,先过滤后取 Top-N)。
4. 按 `quoteVolume24h` 降序,`slice(0, topN)`。
5. 串行拉 K 线(复用缓存),算缩量指标,合并 ticker 字段。

### 3. 响应契约变更

`ShrinkScanParams` 加 `minQuoteVolume24h: number`。

`ScanRow`:
- 加 `quoteVolume24h: number`(来自 `volCcy24h`,用于结果列展示)。
- **删 `lastCandleTime: number`**(R4,跳转不再使用)。

`scanShrink` 不再计算 `lastCandleTime`(删除 `Math.max(...completed.map(...))`)。

### 4. UI 集成

- **参数面板**:加"最低成交额(USDT)"数字输入,默认 `10000000`。
- **结果表**:加"成交额"列(用 `formatVolume` 显示,如 `150.0M`);行点击 **不再有 onClick**(R1)。
- **复制按钮**:每行加图标/文字按钮,点击执行 `navigator.clipboard.writeText(shortInstrument(row.instrument).toLowerCase())`(R2,如 `btc`)。按钮显示"已复制"反馈(记录当前复制行 id,1.5s 后复位)。`shortInstrument` 现有 helper 返回大写短名,小写在其后应用。
- `CoinScanResults` 移除 `onOpenReplay` prop;`App.tsx` 删除 `openScanReplay`,移除不再使用的 `formatReviewInputTime` / `freeReplayProgressTimeForStart` import(确认 `freeReplayCursorTimeForProgress` 是否他处仍用,保留则不动)。

### 5. 剪贴板注意事项

`navigator.clipboard` 需 secure context(localhost 满足)与用户手势(点击按钮满足)。若 `writeText` 抛错(如权限),按钮显示失败文案,不崩溃。V1 不做降级 fallback。

## 兼容与迁移

- `/api/scan` 参数增量扩展,旧请求(无 `minQuoteVolume24h`)回退默认值,向后兼容。
- 删除 `lastCandleTime` / `formatReviewInputTime` 为本任务唯一破坏性变更,作用于刚交付代码,无外部依赖。

## 关键权衡

- **成交额下限替代真实市值**:零新依赖、扫描一次搞定;代价是无法排除"高成交额但市值小"的异常币(用户接受)。
- **先过滤后 Top-N**:下限过滤后若幸存币 < topN,结果更少,符合"排除小市值"意图。

## 运维 / 回滚

- 全部改动集中在选币模块及相关文件,`git revert` 即可回滚。
- 测试:更新 `tests/coin-scan-service.test.ts`(下限过滤、quoteVolume24h 字段、删 lastCandleTime 断言)、删除 `tests/chart-time.test.ts` 的 `formatReviewInputTime` 用例。
