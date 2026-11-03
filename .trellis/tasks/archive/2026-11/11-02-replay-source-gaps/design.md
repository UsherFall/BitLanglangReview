# 技术设计

## R1 行情源可选

### 类型与映射（src/ui/free-replay-chart.ts）

- 复用 `MarketDataSource = 'binance' | 'okx' | 'bitget'`（src/domain/scan-scope.ts，选品同款）。
- 源 → 蜡烛路由 source 参数：`binance → 'binance-only'`、`okx → 'okx'`、`bitget → 'bitget'`。新常量/纯函数 `replayRouteSource(source: MarketDataSource)`。`replayCandleSource(session)` 保持会话级语义（`candleSource` 字符串原样透传——存盘值直接用路由词汇 `binance-only|okx|bitget`，与会话现有字段兼容：legacy null → `binance-only`）。**会话的 `candleSource` 取值统一为 `MarketDataSource | 'binance-only'`**：新建会话存所选源（'bitget'/'okx'/'binance'…）；「币安」按钮对新建会话存 `binance-only`？——不。统一词汇：路由层区分 `binance-only`（严格无兜底，Free Replay 专属）与 `binance`（候选链，个人交割单复盘）。**回溯复盘选「币安」一律存 `binance-only`**；`binance` 不出现在回溯会话。即：UI 词汇 `币安` → 会话/路由 `binance-only`。
- 网格：`replayCandleGrid(session)`：`binance-only`/null(legacy) → `utc`；`okx`/`bitget` → `shanghai`。
- UI 标签：复用选品的 `SOURCE_LABELS`（提出为共享或本地复制：`binance: '币安', okx: 'OKX', bitget: 'Bitget'`）。

### 开始面板（src/ui/FreeReplayPanel.tsx）

- 状态 `source: MarketDataSource`（默认 `bitget`），三按钮（`.segmented-control` 或选品行样式，aria-label 行情源）。
- instruments fetch 依赖 source：`/api/free-replay/instruments?source=${source}`；切源重拉、选中项不在新列表时重置（现有 filteredInstruments 逻辑已处理）。
- `onStart` payload 带 `candleSource: source`（面板词汇 → 会话词汇映射在面板内做：币安→`binance-only`）。

### 进行中会话切换（src/ui/App.tsx）

- 工作区 detail-header（timeframes 旁）加一个源控件：紧凑 `<select aria-label="行情源">`，选项 = 三源（当前会话源高亮）。比三按钮省头部空间。
- `switchReplaySource(next)`：
  - `setFreeReplay(current => ({...current, candleSource: next, dataAnchorTime: new Date(progressTime*1000).toISOString(), startCursorTime: freeReplayCursorTimeForStart(current.startTime, timeframe, grid), cursorTime: freeReplayCursorTimeForTimeframeSwitch(current.progressTime, timeframe, grid)}))`——网格用新源，光标按新源重算（1D/1W/1M 日界随源走）。
  - `setFreeReplayCandles([])`、`setOrderFocus(null)`、清绘图层无关（board 按 instrument 规范名，跨源可见，不动）。
  - 时间周期选择器同一处 UI 词汇（`时间frame` 按钮行）不变。
- FreeReplayChart 初始加载 effect 依赖与 rangeKey 追加 `replay.candleSource`；其余（focus/earlier/later）已通过 `replayCandleSource(replay)` 跟随。
- 恢复路径 `restoreFreeReplaySession` 现有 `payload.candleSource ?? LEGACY` 不变。

### 词汇表翻译（src/domain/instrument-symbol.ts + FreeReplayChart）

- 新增 `usdtSymbolToOkxInstrument(symbol: string): string | null`：`^(?<base>[A-Z0-9]+)USDT$` → `${base}-USDT-SWAP`；已是 `-USDT-SWAP` 形式原样返回；不匹配返回 null。
- 新纯函数 `replayRequestInstrument(instrument: string, routeSource: string): string`（放 free-replay-chart.ts）：
  - routeSource `okx`：`usdtSymbolToOkxInstrument(instrument) ?? instrument`；
  - 其他：`okxInstrumentToBitgetSymbol(instrument) ?? instrument`。
- FreeReplayChart 四处 fetch（initial/earlier/later/focus）的 `instrument` 参数改走该函数；OtherCoinChart/画线不动（画线按 instrument 规范名跨源已可见）。
- 服务端无改动：路由三源都已支持（okx 走默认分支）。

### 自动保存修复（src/ui/App.tsx）

- payload 补 `candleSource: freeReplay.candleSource`。
- 顺带：`restoreFreeReplaySession` 的类型注释更新（`candleSource` 可能是 `binance-only|okx|bitget`）。

## R2 洞回填与自愈

### 回填脚本 tools/backfill-candles.ts

- 输入：`--db data/review.sqlite`（默认）、可选 `--instrument BTCUSDT`、`--dry-run`。
- 扫描：`SELECT instrument, timeframe, timestamp FROM candles ORDER BY instrument, timeframe, timestamp`，逐对找 gap > 1.5×step（1M 用 30 天 step，宽限 1.5）。
- 洞区间 `[prev + step, next - step]`（开区间边界按各所请求语义取整）。
- 取数：
  - 裸 `XXXUSDT`（无前缀无后缀）：先 Binance `fapi/v1/klines`（startTime/endTime，limit 1500 循环）；空 → Bitget history-candles 分页；仍空 → 记录跳过。
  - `bitget:` 前缀：Bitget（`/history-candles` endTime 分页，90/页，符号去前缀；Bitget endTime=右端（收盘时刻语义，右端 = next 时间戳 + step 保证含 next 前最后一根）……实现细节：按「endTime 从洞右端逐步左移」翻页直到覆盖洞左端）。
  - `-USDT-SWAP` 后缀：OKX `history-candles`（`after` 从洞右端往左翻，100/页）。
- 每段写库前打印 `[instrument/timeframe] 洞 from→to 补 N 根`；dry-run 只打印。
- 复用现成 fetch 封装（src/server/http.ts 的 defaultFetchJson 不带 UA 差异——直接用全局 fetch + 必要 header，Bitget 需要的 header 参照 src/server/http.ts 的 defaultBitgetMarketFetchJson——脚本可直接 import src/server 模块（tsx 运行））。
- 蜡烛行 shape 同 CandlestickStore（instrument=命名空间后的请求键）。写库用 `store.save`（better-sqlite3 直连同一 db 文件，WAL 并发安全）。

### 客户端中段洞自愈（FreeReplayChart）

- 纯函数（free-replay-chart.ts）：`firstGapInRange(candles, from, to, timeframe): { from, to } | null`——扫描已排序蜡烛在 [from, to] 内第一个相邻 gap > 1.5×step，返回洞的边界对。
- 图表 effect（deps: [loadedCandles, replay.cursorTime, renderedCandles, timeframe, replay.instrument, replay.startTime, replay.candleSource]）：
  - 候选范围 = 可见时间范围（`chart.timeScale().getVisibleRange()`）∪ [cursorTime, cursorTime + 20×step]。
  - `firstGapInRange(loadedCandlesRef.current, 候选范围)` 且非 loading（`gapHealKeyRef` 去重：同一 `rangeKey:from:to` 只补一次）→ `loadGapWindowCandles(centerMs)`：mode=initial、entryTime=洞中心 ISO、source=replayCandleSource(replay)、instrument=翻译名；合并。
  - 失败/空窗口：gapHealKeyRef 记下，范围变化前不重试。
- 揭示跳蜡烛问题随洞消失（回填 + 自愈覆盖光标前方 20 根 = 揭示预取同一视界）。测试造洞：mock 蜡烛留中段空缺 → 滚动/揭示后观察到第二次 initial 请求 entryTime 在洞区 → 合并后数组无洞。

## 权衡

- **选 `<select>` 而非三按钮**（工作区头部）：头部已有 8 个周期按钮 + 其他币，三按钮再挤一行；select 紧凑且可显示当前源。开始面板用三按钮（同选品观感）。
- **会话词汇统一存路由源名**（`binance-only|okx|bitget`）而非 UI 名：存盘值与请求值一致，省一层映射；legacy null → binance-only 兜底已有。
- **洞自愈放客户端而非服务端**：服务端 earlier/later 的锚点语义（边缘取窗）不该为中段洞扩展；initial 模式天然是「以任意点为中心的交易所连续窗」，客户端知道可见范围与光标视界，由它发起最贴合。回填脚本兜住存量，自愈兜住未来。
- **不迁移/不改写旧会话数据**：切源是显式用户动作，会话键与单子/进度不动。

## 兼容与回滚

- 存量会话（candle_source null）恢复行为不变（binance-only）。
- 切源不落新行（同键 upsert，candle_source 更新）。
- 回填脚本独立可单独运行/跳过；读侧无 schema 变化。
- 回滚 = revert 对应 commit；无数据迁移依赖。
