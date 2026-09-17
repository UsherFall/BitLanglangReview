# 个人复盘币安符号映射修正(SHIB/RAY/VANRY)

## 背景

「个人交割单复盘」(`reviewModeBindings.bitget`) 的 K 线走 `source=binance`（`src/ui/App.tsx:104`）。链路是：

Bitget 持仓 `symbol` → `bitgetSymbolToOkxInstrument` 还原成 OKX 风格 (`SHIBUSDT` → `SHIB-USDT-SWAP`)
→ `/api/candles` 里 `okxInstrumentToBinanceSymbol` 再机械转成币安符号 (`SHIB-USDT-SWAP` → `SHIBUSDT`)。

`okxInstrumentToBinanceSymbol` (`src/domain/instrument-symbol.ts:16`) 只做「去后缀 + 拼 USDT」，
既没有别名表，也不校验该符号在币安是否存在 / 是否还在交易，更没有不可用时的回退。

## 实测结论（2026-09-17，Binance `fapi/v1/exchangeInfo` + `fapi/v1/klines`）

用户当前 51 个 Bitget 持仓 symbol 中，44 个映射后即为币安在交易的永续，3 个失败、3 个在导入阶段就被丢弃。

| Bitget symbol | 映射出的币安符号 | 币安实际状态 | 现象 |
| --- | --- | --- | --- |
| `SHIBUSDT` | `SHIBUSDT` | 不存在 → `400 {"code":-1121,"msg":"Invalid symbol."}` | 请求 502，图表加载不出来 |
| `RAYUSDT` | `RAYUSDT` | `status: "SETTLING"`（2022-11 起下线清算） | 币安仍返回 klines 但价格冻结在 `0.248`、成交量 `0` → 一条无波动直线 |
| `VANRYUSDT`（6 笔） | `VANRYUSDT` | `status: "SETTLING"` | 同上（1D 缓存 520 根里 40 根 frozen） |
| `牛来USDT` / `哈基米USDT` / `龙虾USDT` | — | 不匹配 `bitgetSymbolToOkxInstrument` 正则 | 导入阶段即返回 null，这些持仓根本没进复盘队列 |

直线现象的缓存证据：`candles` 表中 `RAYUSDT` 的 15m/5m/1H 共 2111 根**全部** `high == low`。

替代数据源可用性实测：

| 符号 | 币安可用替代 | OKX |
| --- | --- | --- |
| SHIB | `1000SHIBUSDT`（TRADING，但价格是 1000 倍：0.0049 vs 交割单 0.00000602） | `SHIB-USDT-SWAP`（TRADING，≈0.00000496，与 Bitget 一致） |
| RAY | `RAYSOLUSDT`（TRADING，≈1.37，与 Bitget 1.18~1.6 一致） | `RAY-USDT-SWAP`（TRADING，≈1.407，一致） |
| VANRY | 无 VANRY 类替代符号 | 无 `VANRY-USDT-SWAP` |

## Requirements

- R1 个人交割单复盘的图表，对「币安无可交易合约」的持仓必须给出**真实行情**或**明确的不可用提示**，二者其一；不允许再画出冻结价格的假直线。
- R2 `RAYUSDT` 这类「币安改了符号名但同一标的仍在交易」的情况（`RAYUSDT` → `RAYSOLUSDT`）要能取到真实行情。
- R3 `SHIBUSDT` 这类「币安标的仍在交易但符号/面值不同」的情况要能取到真实行情，且**图表价格轴与交割单里的开平仓价必须是同一量纲**（不得出现 1000 倍错位）。
- R4 `VANRYUSDT` 这类「币安、OKX 都无可用合约」的情况，图表必须显式告知用户该标的无行情，而不是空图或直线。
- R5 符号解析的正确性不得依赖「去后缀拼 USDT」这一条字符串规则；新增符号应能在不猜的情况下判定可用性。
- （待定，见 Open Questions）R6 导入阶段被丢弃的中文名 meme 持仓是否要处理。

## Acceptance Criteria

- [ ] 用 `RAYUSDT` 的持仓单打开个人复盘：图表显示 2026-09 区间真实波动的 RAY 行情，且开平仓价（1.186 / 1.1865）与价格轴同量纲。
- [ ] 用 `SHIBUSDT` 的持仓单打开个人复盘：图表有真实 K 线，开平仓价（0.000006027）落在价格轴可见范围内。
- [ ] 用 `VANRYUSDT` 的持仓单打开个人复盘：图表给出「该标的无行情数据」一类明确提示，且**不渲染** `high == low` 的冻结直线。
- [ ] 任取一个原本正常的符号（如 `ZECUSDT`、`BTCUSDT`）回归：图表与修复前一致，仍走币安。
- [ ] 币安 metadata（exchangeInfo）不可用时，复盘图表不因此整体失败：退化为修复前的行为（尝试币安取数）。

## Constraints

- 缓存主键是 `(instrument, timeframe, timestamp)`，**没有 source 列**：OKX 的 `X-USDT-SWAP` 与币安/Bitget 的 `base+USDT` 两套词表天然隔离，回退到 OKX 不会污染币安缓存（见 `.trellis/spec/server/market-data.md`「Cache-key namespace rule」）。
- `.trellis/spec/server/market-data.md:63` 目前明确写着「No fallback」，本任务会改动这条约定，需同步 spec。
- 币安 `fapi/v1/klines` 对 SETTLING 合约返回 200 + 冻结数据，**无法从 klines 自身判定合约已下线**，判定必须来自 `exchangeInfo` 的 `status`。
- 现有 `BinanceInstrumentMetadataSource`（`src/server/binance-instrument-metadata.ts`）已经拉取并 6h 缓存 `exchangeInfo`，但只暴露 `symbol → MarketClass`，未暴露 `status`；失败时降级为空 map。

## Decisions

- D1（2026-09-17，用户决策）取数策略 = **别名表 + 币安不可用时回退 OKX**。
  - 币安可用（符号存在且 `status === "TRADING"`）→ 走币安，行为不变。
  - 币安不可用 → 用**原始 OKX 风格 instrument** 回退 `CandlestickService`（OKX）。
  - 两源都不可用 → 明确空态 + 提示（R4）。
  - 理由：SHIB/RAY 在 OKX 都有同名合约且价格与交割单同量纲（`SHIB-USDT-SWAP`、`RAY-USDT-SWAP`），
    走回退可同时满足 R2/R3，不必引入「1000 倍面值」的价格缩放机制。
- D2（2026-09-17，实现期收紧）换源的触发条件只有一个：**币安合约状态被判定为不可交易**。空窗口不换源（否则右滚到当下之后每次都报错），币安抛错也不换源（否则 429/418 限频时图表会静默换成 OKX，掩盖必须透出的限频警告，且两个场子价格不同）。代价是元数据不可用时的降级行为等同修复前，已写进 spec 的已知残留。

## Open Questions

- O2 中文名 meme 持仓（`牛来USDT` 等）在导入阶段被静默丢弃，是否属于本任务范围。（建议另开子任务，本任务不做）

## Notes

- 现象复现（一次性命令）：
  `node -e "fetch('https://fapi.binance.com/fapi/v1/klines?symbol=RAYUSDT&interval=1h&limit=2').then(r=>r.json()).then(console.log)"`
- 相关 spec：`.trellis/spec/server/market-data.md`、`.trellis/spec/server/api-plugin.md`。
- 相关测试：`tests/binance-candles.test.ts`、`tests/binance-instrument-metadata.test.ts`、`tests/app-bitget-mode.test.tsx`、`tests/candlestick-cache.test.ts`。
