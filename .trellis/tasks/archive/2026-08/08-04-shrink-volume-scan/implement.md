# 选币模块(缩量方法 V1) — 执行计划

## 前置检查

- `prd.md` 已收敛,评审通过。
- `npm test` 现有测试全绿(基线)。
- `npm run dev` 可启动。

## 实现清单(顺序)

1. **domain 类型** — 新建 `src/domain/coin-scan.ts`:`ScanShrinkParams`、`ScanRow`、`ScanResponse`(见 design.md 契约)。
2. **OKX tickers 拉取** — `src/server/coin-scan-service.ts`:fetcher 调 `/api/v5/market/tickers?instType=SWAP`,**实现期用真实响应验证字段名**(成交额 `volCcy24h`、最新价 `last`、24h 涨跌幅),返回 `{ instrument, quoteVolume24h, lastPrice, change24h }[]`。过滤 `-USDT-SWAP`。
3. **缩量算法(纯函数,先写测试再接线)** — 同文件或 `src/domain/`:`computeShrinkRows(candles, {window, consecutive, threshold}) → { currentVolume, averageVolume, ratio, intensity, consecutiveShrunk, qualified }`。丢弃最后一根未走完 bar;`r[i] = vol[i]/mean(前 window 根)`;强度分 = 最近 consecutive 根量比均值;qualified = consecutive 根全 < 阈值。
4. **CoinScanService.scanShrink** — 串行遍历 topN 币,`candleService.getCandlesticks({ instrument, timeframe, anchor: now, direction: 'earlier', limit: window+consecutive+2 })`,缓存复用;合并 tickers 字段;按强度升序。
5. **路由** — `src/server/app-plugin.ts` 加 `GET /api/scan`:校验 `method==='shrink'` + timeframe ∈ 领域周期 + 数值参数,错误 400;服务异常 502 + 可读 message。
6. **UI 面板** — 新建 `src/ui/CoinScanPanel.tsx`:参数控件(周期下拉 5m/15m/1H/4H/1D + topN/threshold/consecutive/window 数字输入,默认 5m/50/0.7/3/20)、"扫描"按钮、结果排名表(列:币/最新价/24h涨跌幅/当前量/均量/量比/强度分/连续缩量根数)、合格高亮、加载中/失败态、点击行回调 `onOpenReplay(row, timeframe)`。全中文文案。
7. **App 集成** — `src/ui/App.tsx`:`ReviewMode` 加 `'scan'`;tab 按钮"选币";`reviewMode==='scan'` 渲染面板;`onOpenReplay` → 用 `chart-time` 工具组装 `FreeReplayStart` + `setReviewMode('freeReplay')` + `setFreeReplay(start)`。
8. **测试** — 新建 `tests/coin-scan-service.test.ts`:算法单测(量比/强度/合格/排序/未走完 bar 排除)+ 服务级(注入 mock tickers + mock candleService)。参照 `tests/okx-instrument-service.test.ts` 风格。

## 验证命令

```bash
npm test                  # 全部测试,新增用例必须过
npm run build             # vite build 通过
npm run dev               # 手动:选币 tab → 扫描 → 排名表 → 点击行跳 Free Replay
```

## 风险文件 / 回滚点

- `src/server/app-plugin.ts` — 路由追加,低风险;回滚还原此文件即可。
- `src/ui/App.tsx` — 模式扩展 + tab;注意不破坏现有 trade/freeReplay 分支。
- candlestick-service 复用 — 只读调用,不改动。

## task.py start 前复查

- [x] prd.md 收敛(无重复事实、无残留 Open Questions 块)。
- [x] 本 checklist 已过一遍。
- [x] 用户已评审 prd/design/implement。

## 实施记录

全部 8 步已完成。验证:
- `npm test`:28 文件 126 测试全绿(新增 coin-scan / coin-scan-service / chart-time round-trip)。
- `tsc --noEmit`:干净。
- Playwright 手动验证(dev server):选币 tab → 扫描(50 币/15 合格/5m)→ 排名表按强度升序、合格置顶 → 点 DOGE 行跳 Free Replay,起始 11:40(最近已收盘 5m 线,未走完 bar 已排除),会话自动保存,图表 K 线加载成功。
- 网络闭环:`/api/scan` → 200;跳转后 `/api/candles?instrument=DOGE-USDT-SWAP&entryTime=2026-08-04 11:40` → 200;PUT 会话 → 200。

说明:无 `build` 脚本(项目只有 dev/test),用 tsc --noEmit 作为构建门禁。
