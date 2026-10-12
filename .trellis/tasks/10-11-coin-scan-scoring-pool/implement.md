# Implement — 选品收敛打分与扫描池调整

> 依赖:`design.md`。实现前先跑 `trellis-before-dev` 加载 `server/coin-scan.md`。

## 变更清单(按顺序)

1. **`src/domain/coin-scan.ts`** — 新增并导出 `TIMEFRAME_SCORE_OFFSET`(`5m/15m/1H:0`,`4H:-0.05`,`1D:-0.10`)与 `timeframeMinScore(timeframe, minScore)`(下界夹 0)。放在 `scanTimeframes` 附近,补注释说明"单旋钮 + 大级别更宽容"。
2. **`src/server/coin-scan-service.ts`** — import `timeframeMinScore`;
   - `:137-140` 合格判定改为 `s.score >= timeframeMinScore(timeframe, minScore)`;
   - `:160` 排序改为 `highestLevel desc → qualifiedCount desc → bestScore desc`,其中 `highestLevel = max(scanTimeframes.indexOf(tf) for tf in converged)`;保持纯稳定排序。
3. **`src/domain/scan-scope.ts`** — `DEFAULT_SCAN_PARAMS.crypto.topN: 60 → 150`(equity 仍 30)。
4. **`src/ui/CoinScanPanel.tsx`** — 只在 shrink 的 hint 文案补一句大级别自动更宽容;不动输入框与默认 `minScore=0.6`。

## 测试改动

5. **`tests/coin-scan.test.ts`** — 新增 `timeframeMinScore` 断言:默认 0.6 → 1D 0.50 / 4H 0.55 / 其余 0.60;`minScore=0` 时全部 0(向后兼容);负偏移夹 0。
6. **`tests/coin-scan-service.test.ts`** —
   - `:197` `sorts by qualifiedCount desc, then bestScore desc` 改名为"最高合格级别优先",并新增对应用例:构造"仅 1D 合格"的币排在"仅 5m+15m+1H 合格"的币之前;
   - 新增"每周期阈值"用例:同一币 1D≈0.51、4H≈0.44,`minScore=0.6` 时只有 1D 合格;
   - 复核 `:226` minScore gate 用例在新偏移下仍成立(0.4 全放行 / 0.7 过滤弱币)。
7. **`tests/scan-scope.test.ts:33`** — `toEqual({ topN: 150, minQuoteVolume24h: 10_000_000 })`。
8. **`tests/coin-scan-panel.test.tsx`** — 已用 `DEFAULT_SCAN_PARAMS.crypto.topN`,预期自动跟随;确认无需改。

## 验证命令

按文件精确跑(全量 vitest 有零星 worker 超时,不用全量):

```bash
npx vitest run tests/coin-scan.test.ts
npx vitest run tests/coin-scan-service.test.ts
npx vitest run tests/scan-scope.test.ts
npx vitest run tests/coin-scan-panel.test.tsx
npx vitest run tests/coin-scan-rows.test.ts
npx vitest run tests/coin-scan-results.test.tsx
```

类型检查:`npx tsc --noEmit`

手动验收(可选,需联网):以锚点 `2026-09-29T12:00:00Z` 拉 STRKUSDT 各周期 100 根 K 线跑 `probeStructure`,确认 1D(≈0.507)在 `minScore=0.6` 下被判合格、4H(≈0.44)不合格。可用 `node --experimental-strip-types` 临时探针,验完即删。

## 风险文件 / 回滚点

- 风险最高:`coin-scan-service.ts` 的排序与合格判定 —— 改完必须跑 `coin-scan-service.test.ts` 与 `coin-scan-results.test.tsx`。
- 回滚:还原 `coin-scan.ts` / `coin-scan-service.ts` / `scan-scope.ts` / `CoinScanPanel.tsx` 四处,无数据迁移。

## `task.py start` 前检查

- [ ] `prd.md` / `design.md` / `implement.md` 三件套齐全
- [ ] `implement.jsonl` / `check.jsonl` 各含真实 spec 条目
- [ ] 验收标准(锚点 9/29 → STRK 1D 合格)可实现且可测

---

## 追加(R5 分源下限 + R6 UI 选源)

> 依赖 `design.md` §2.4–2.6。前置:`prd.md` Background 已补实测数据。

9. **`src/domain/scan-scope.ts`** —
   - 新增 `MARKET_DATA_SOURCES` / `MarketDataSource` / `DEFAULT_MARKET_DATA_SOURCE='bitget'` / `isMarketDataSource` / `ScanParams` / `SCAN_PARAM_DEFAULTS`(私有表)/ `defaultScanParams(source, scope)`(见 design §2.4);
   - 删除旧 `DEFAULT_SCAN_PARAMS`。
10. **`src/server/app-plugin.ts`** —
    - option 类型与 `defaultSource` 归一化(非法/缺省 → `DEFAULT_MARKET_DATA_SOURCE`);
    - 上提 `okxTickerSource`,建 `Record<MarketDataSource, {tickerSource, candleSource, gate}>`,每源各建 `CoinScanService` / `MarketHeatService`;
    - 新增 `GET /api/scan/config`(注册在 `/api/scan` 之前)→ `{ source: defaultSource }`;
    - `/api/scan` 解析并校验 `source`,缺省下限改用 `defaultScanParams(source, scope)`,把 `source` 放进 `scanShrink` 入参;
    - `/api/market-heat` 固定走 `defaultSource` 的 heat 服务。
11. **`src/domain/coin-scan.ts`** — `ShrinkScanParams` 增可选 `source?: MarketDataSource`(import 自 `./scan-scope`),仅回显用。
12. **`src/ui/CoinScanPanel.tsx`** — 新增"行情源"选择行 + `source` 状态;挂载 `fetch('/api/scan/config')`(带 `.catch` 兜底);默认值走 `defaultScanParams(source, scope)`;请求带 `source`。

### 追加测试

13. **`tests/scan-scope.test.ts`** — 用 `defaultScanParams` 断言矩阵(BINANCE 10M/10M、BITGET 0.5M/3M、OKX 1M/1M;topN 150/30)。
14. **`tests/coin-scan-panel.test.tsx`** — stub `/api/scan/config`(如 `{source:'binance'}`);断言初始源与切源后输入框默认值按 `defaultScanParams` 变化,点击源按钮后扫描请求带 `source`。
15. **`tests/coin-scan-results.test.tsx`** — fixture `params` 不含 `source`(可选字段)应继续通过;确认无需改。

### 追加验证命令

```bash
npx vitest run tests/scan-scope.test.ts
npx vitest run tests/coin-scan-panel.test.tsx
npx vitest run tests/coin-scan-service.test.ts
npx vitest run tests/coin-scan-results.test.tsx
npx tsc --noEmit
```

### 追加风险 / 回滚点

- 风险最高:`app-plugin.ts` 的多源装配(三份实例、`/api/scan/config` 的注册顺序)—— 手动 `npm run dev` 切三个源各扫一次确认。
- 回滚:还原 `scan-scope.ts` / `app-plugin.ts` / `coin-scan.ts` / `CoinScanPanel.tsx` 四处 + 两个测试文件。
