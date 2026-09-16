# 设计（父任务视角）：集成视图

本文件只描述**两个子任务之间的接缝与集成顺序**，实现细节见各子任务自己的 `design.md`。

## 组件图（A 落地后）

```
                     币安 fapi/v1/ticker/24hr           币安 fapi/v1/exchangeInfo
                              │                                  │
                              │                    symbol → MarketClass（6h 缓存）
                              ▼                                  ▼
                     BinanceTickerSource ──附 marketClass（全部已分类标的）+ metadataAvailable()──▶ Ticker[]
                              │
                              ▼
        ┌─────────── CoinScanService.scanShrink（A + B）─────────────────────┐
        │ 成交额门槛 → isScannable(A) → scope 过滤(B) → isMarketOpen(A)      │
        │ → slice(0,topN) → 取数(limit = gated ? 200 : 100) →               │
        │ isCandleInSession(A) 过滤 → 结构检测 → 响应（+ metadataUnavailable）│
        └──────────────────────────────────────────────────────────────────┘
                              │
        BinanceCandleSource（全部标的，币安 USDT-M 7×24）

        MarketHeatService（A）：池子 = isScannable ∩ isMarketOpen(anchor)
        scan-pool.ts（A，domain）：池子策略唯一真相来源
        scanScope / DEFAULT_SCAN_PARAMS（B，domain）：范围与默认值唯一真相来源
```

## 接缝契约（跨子任务）

| 接缝 | 归属 | 契约 |
|---|---|---|
| `isScannable(marketClass)` | A（domain，纯函数） | `CRYPTO`/`COMMODITY`/`US_EQUITY`/`KR_EQUITY` 入池；`HK_EQUITY`/`CN_EQUITY`/`PRE_IPO` 出池；`undefined` 入池；**B 只消费不改** |
| `Ticker.marketClass` | A | 所有已分类标的都填；缺失 = 类别未知（元数据降级） |
| `Ticker.source.metadataAvailable?()` | A | `false` = 该快照没有类别，休市过滤失效 |
| `isMarketOpen` / `isCandleInSession` | A（domain） | 时段表 + 会话序列；B 的 scope 划分不得绕过它们 |
| `ScanResponse.metadataUnavailable?` | A | 仅在降级时出现 |
| `ScanScope` / `DEFAULT_SCAN_PARAMS` | B（domain） | `crypto` = 非股票市场类别 + 未分类；`equity` = `US_EQUITY`/`KR_EQUITY`；缺省 `crypto` |
| `/api/scan?scope=` | B | 缺省 `crypto`；非法值与 `equity+heat` → 400 |

## 集成顺序与不可分割的改动

1. A 已完成（52 文件 / 321 测试全绿；真机验证：MUUSDT 5m 200 根原始 → 120 根会话 bar，隔夜与晚间全剔）。
2. B 依赖 A 的 `isScannable` 与 `marketClass` 语义，可在 A 之后直接开始；B 只改 UI + `/api/scan` + 池子过滤。
3. A 单独上线即修掉休市污染（UI 仍是单列表）；B 是形态升级。两者可分开交付与回滚。
