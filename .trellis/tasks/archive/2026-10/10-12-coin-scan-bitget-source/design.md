# Design: 选品扫描切换 Bitget 行情源

## 1. 总体结构

沿用既有数据源无关层（`market-data.ts` 的 `TickerSource` / `CandleSource`），Bitget 作为第三源平行接入，OKX 是现成先例。涉及 5 处改动：

| 文件 | 改动 |
|---|---|
| `src/server/http.ts` | 新增 Bitget 公开行情 fetcher + pacer + gate；`fetchJsonWithRetry` 增补告警文案的源标签参数 |
| `src/domain/stablecoin-quotes.ts`（新） | 从 `binance-tickers.ts` 抽出稳定币集合，两源共用 |
| `src/server/bitget-tickers.ts`（新） | `BitgetTickerSource` |
| `src/server/bitget-candles.ts`（新） | `BitgetCandleSource`（以已退休实现 99a0a8f^ 为底，加命名空间隔离与 `coversAnchorBar` 门） |
| `src/server/app-plugin.ts` | `marketDataSource` 联合类型加 `'bitget'`；装配三个 Bitget 实例；扫描警告源随数据源切换 |

## 2. http.ts：Bitget 公开行情通道

```
defaultBitgetMarketFetchJson(url):
  await bitgetMarketRatePacer.pace()          // 50ms 间隔 + 10ms 抖动 ≈ 20 req/s
  try { return await labeledFetch(url, 'Bitget request failed', bitgetMarketRateGate, silentWeightMonitor) }
  catch (e) { AbortError → 'Bitget request timed out after 12s'; 其余原样抛出 }
```

- `bitgetMarketRatePacer = createRequestPacer(50, 10)`：对齐响应头名义 20 次/秒。持续压测证明超发会被软限速（单请求 ~2s）而非 429，pacer 是必要保险。750 请求的冷扫描 pacing 下限 37.5s，与 Binance 路径 ~82s 同量级。
- `bitgetMarketRateGate = createRateGate()`：接 429 退避 + 用户可见警告；418 快速失败（Bitget 无此升级机制，保留只为契约完整）。
- `silentWeightMonitor`：OKX 同款理由——Bitget 不发 `X-MBX-USED-WEIGHT-1M`，且 429 若记到 binance monitor 会打错标签的日志行。
- **`fetchJsonWithRetry` 增加 `sourceLabel` 参数（默认 `'币安'`）**：gate 警告文案目前硬编码「币安限频(HTTP 429)…」（290/293 行），Bitget 复用会文不对题。参数化后 Bitget 传 `'Bitget'`。`labeledFetch` 透传。Binance/OKX 调用点不变（默认值）。
- AbortError 翻译只加在 Bitget market fetcher 的 catch 里（私有 fetcher 已有同款翻译），不改 `fetchJsonWithRetry` 共享逻辑。

## 3. BitgetTickerSource

- 端点：`GET /api/v2/mix/market/tickers?productType=USDT-FUTURES`，一次全量（实测 820 个、~413KB）。
- 过滤：`symbol.endsWith('USDT')` 且不在稳定币集合（实测列表中仅 `USDCUSDT` 命中，集合保留其余防新增）。实测 USDT-FUTURES 无交割合约（`deliveryStartTime` 全空），无需交割过滤。
- 映射：`instrument=symbol`（原生 `BTCUSDT`）、`quoteVolume24h=Number(usdtVolume)`、`lastPrice=Number(lastPr)`、**`change24h=Number(change24h)*100`**（Bitget 给小数 0.00744，项目契约是百分数）。
- 不带 `marketClass`（无 metadata 源，同 OKX）→ 不实现 `metadataAvailable()`；equity scope 在该源下自然为空，PRD 已列为预期。
- 缓存：30s TTL + in-flight 去重，照 `BinanceTickerSource`（413KB 全量响应值得缓存；扫描点击不重复全量拉取）。
- 稳定币集合抽到 `src/domain/stablecoin-quotes.ts`：两个 source 共用避免漂移；`binance-tickers.ts` 改为 import（其导出名 `STABLECOIN_QUOTE_PAIRS` 保留，测试无感）。

## 4. BitgetCandleSource

以退休实现（`git show 99a0a8f^:src/server/bitget-candles.ts`）为底，四件事修改/保留：

**保留（退休实现的正确部分）**：
- granularity 直接透传 `request.timeframe`——`ReviewTimeframe` 取值集与 Bitget mix token 集 1:1（`1m/5m/15m/1H/4H/1D/1W/1M`）。测试断言映射覆盖全部 `reviewTimeframes`。
- `earlier` 方向：`endTime = anchor - 1` + `limit`，返回 anchor 之前最新 N 根（实测确认：endTime=05:00 → 返回 03/04/05 三根）。收盘 bar 过滤 `timestamp + step <= anchor`。
- `later` 方向：`startTime = anchor + 1`，`endTime = anchor + min(step*limit, 90d)`（Bitget 单请求跨度上限 90 天，实测确认超限行为）。
- 边界数学带 **-8h 偏移**：Bitget 日/周/月 bar 开在 UTC+8（与 OKX 同）。日内档（5m~4H）8h 可整除，不受影响。扫描只用 `earlier`，偏移主要影响 later 与连续性种子。

**修改（本任务的核心修正）**：
- **store 键命名空间**：读写共享 `CandlestickStore` 时 instrument 加前缀 `bitget:`（常量 `BITGET_KEY_PREFIX = 'bitget:'`）；发往网络的 symbol 用裸名；`Ticker.instrument` 保持裸名（UI 展示与 Binance 模式一致）。这是退休实现缺失的一环——它只考虑了 OKX 的 `-USDT-SWAP` 后缀，没考虑 Binance 同用 `base+USDT`，导致两源数据混键产生重复日线（`binance-candles.ts:36-43` 有完整警告）。**回归测试：断言 `store.save` 收到的 instrument 是 `bitget:BTCUSDT`。**
- 缓存门补 `coversAnchorBar`（BinanceCandleSource 的演化版）：防止"差一根到 anchor"的洞永久绕过缓存。扫描 `refresh=true` 时本就走不到缓存门，但锚定回扫路径需要。
- `payload.code !== '00000'` → throw `Bitget 行情错误 code=...: msg`（HTTP 200 包业务错误的 Bitget 风格）。
- 遗留数据：退休实现写下的未前缀旧键不读取、不迁移（PRD 非目标）。

## 5. app-plugin 装配

```ts
marketDataSource: 'binance' | 'okx' | 'bitget'   // options 与 env 同源
bitgetTickerSource = new BitgetTickerSource()
bitgetCandleSource = new BitgetCandleSource(candleStore)
tickerSource    = bitget ? bitgetTickerSource : (okx ? ... : binanceTickerSource)
scanCandleSource= bitget ? bitgetCandleSource : (okx ? candleService : binanceCandleSource)
coinScanService = new CoinScanService(tickerSource, scanCandleSource, bitget ? bitgetMarketRateGate : binanceRateGate)
```

- 第三个构造参数（`rateLimitWarnings`）已存在于 `CoinScanService`，无需改服务；Bitget 模式下 429 警告经 `ScanResponse.warnings` 透出（UI 已有渲染）。
- 市场热度继续用 `binanceTickerSource`/`binanceCandleSource`，不受开关影响。

## 6. 测试策略

| 测试文件 | 覆盖 |
|---|---|
| `tests/bitget-tickers.test.ts` | ×100 百分数、`usdtVolume` 映射、稳定币剔除、USDT 过滤、降序、非有限值过滤、TTL 缓存与 in-flight 去重 |
| `tests/bitget-candles.test.ts` | URL 参数（earlier/later）、90 天钳制、**`bitget:` 前缀回归**、收盘 bar 过滤、`code!=00000` 抛错、-8h 边界、连续性、缓存门（stale 刷新 / 历史锚定复用 / coversAnchorBar） |
| `tests/http-retry.test.ts`（增补） | `sourceLabel` 参数化后 Bitget 429 警告文案；Bitget fetcher 的 AbortError 翻译 |
| 既有全部 | binance/okx/http 无回归 |

注入式测试：两个源都接受 `fetchJson: FetchJson` 参数（同 OKX/Binance 源的构造约定），用假实现断网跑。

## 7. 风险与权衡

- **延迟**：本机实测单请求 0.5-2s（含握手）。若进程内连接复用后仍慢，冷扫描可能到 2-3 分钟。可接受（Binance 冷扫描已 ~82s），但集成时需实测确认；若不可接受，再评估调高并发或放宽 pacer。
- **equity scope 空结果**：用户切到股票 sub-module 会看到空列表。UI 已有空态，PRD 列为预期，不做特殊提示（避免过度设计）。
- **源切换的键卫生**：`bitget:` 前缀保证与 Binance/OKX 三者键空间互不相交；切换数据源不会读到别所的 bar。
- **结果集差异**：换所后价量结构不同，收敛集合与 Binance 模式不完全一致——业务决策已在对话中确认接受。

## 8. 回滚

- 运行期：`MARKET_DATA_SOURCE` 不设即回 Binance，零代码回滚。
- 代码级：5 处改动相互独立，按 implement.md 分步提交粒度可逐 file revert；无数据迁移、无 schema 变更。
