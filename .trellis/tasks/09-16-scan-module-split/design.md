# 设计：选品模块的 scope 分治

## 1. 边界

只改「选择层」：UI 子模块切换 + `/api/scan` 的 `scope` 参数 + 池子按 scope 过滤 + 结果面板标题。**不动**数据源、检测器、缓存、图表链路。数据源与策略表来自兄弟子任务 `09-16-equity-yahoo-candles`。

## 2. 契约

```ts
// src/domain/coin-scan.ts（或新 src/domain/scan-scope.ts）
export type ScanScope = 'crypto' | 'equity';
export const SCAN_SCOPES: readonly ScanScope[] = ['crypto', 'equity'];

// ShrinkScanParams 新增（heat 方法不需要 scope：其池子已固定）
scope?: ScanScope; // 缺省 'crypto'

// ScanResponse.params 回显 scope（与既有 anchor 回显同一机制）
```

`ScanMethod` 与 `scope` 的合法矩阵（API 层校验，越界一律 400 `Invalid scan parameters`）：

| method | scope | 结果 |
|---|---|---|
| `shrink` | 缺省 / `crypto` | 加密 + 指数 + 商品池 |
| `shrink` | `equity` | 美股 + 韩股池 |
| `heat` | 缺省 / `crypto` | 热度（池子固定为加密 + 指数 + 商品） |
| `heat` | `equity` | **400** |

> `heat` 的池子在子任务 A 已固定，因此 `scope` 对 `heat` 无意义；显式传 `equity` 属于调用方错误，必须报错而不是静默忽略。

## 3. 池子过滤

在 `CoinScanService.scanShrink` 内，紧跟 24h 成交额门槛之后插入一层（顺序仍是 `门槛 → 池子策略 → scope 过滤 → 休市剔除 → slice(0, topN)`）：

```ts
const scopeOf = (ticker: Ticker): ScanScope =>
  ticker.marketClass === 'US_EQUITY' || ticker.marketClass === 'KR_EQUITY' ? 'equity' : 'crypto';
const scoped = pooled.filter((ticker) => isScannable(ticker.marketClass) && scopeOf(ticker) === scope);
```

`isScannable`（子任务 A）先把港/A 股与 Pre-IPO 挡在外面，因此在**两个 scope 下都不入池**，无需额外分支；未分类标的（元数据降级）落进 `crypto` 侧，与改动前的保守回退一致。

## 4. 参数默认值

| scope | `topN` 默认 | `minQuoteVolume24h` 默认 | 依据 |
|---|---|---|---|
| `crypto` | 60 | 10_000_000 | 现状不变 |
| `equity` | 30 | 10_000_000 | 实测 10M 以上的股票类标的约 45 个，30 已覆盖主要流动性 |

默认值集中为 `DEFAULT_SCAN_PARAMS: Record<ScanScope, { topN: number; minQuoteVolume24h: number }>`；`app-plugin.ts` 在参数缺省时按 `scope` 取值（把现在的两个硬编码默认值改掉）。UI 侧同一张表，切 scope 时重置两个输入框。

## 5. UI 形态

- `App.tsx`：新增 `const [scanScope, setScanScope] = useState<ScanScope>('crypto')`；`reviewMode === 'scan'` 分支把 `scope` + `onScopeChange` 传给 `CoinScanPanel`；`CoinScanPanel` 内部扫描时带上当前 scope，`onScanned` 的载荷里带上 scope（结果面板据此显示标题并在 scope 变化时被清空）。
- `CoinScanPanel.tsx`：方法选择区上方加一对子模块按钮（「加密」/「股票」）；`股票` 选中时隐藏热度方法；切 scope → 重置 `topN`/`minQuoteVolume24h` 为对应默认值，并清空既有结果。
- `CoinScanResults.tsx`：标题显示「加密」/「股票」。
- 复用现有按钮样式（`selected` class，见 `App.tsx:626` 的页签写法），不新增设计语言。

## 6. 兼容与回滚

- 缺省 `scope='crypto'` → 老请求、老链接、老测试行为不变。
- 回滚点：`scope` 参数与池子过滤是两处独立改动；只回滚 UI 层即退回「单列表但池子已分治」的中间状态（无数据损坏风险）。
- 无持久化变更：scope 是组件状态，不写 sqlite。

## 7. 风险

| 风险 | 处置 |
|---|---|
| 切换 scope 后旧结果残留 → 误读 | 切 scope 立即清空结果（R2.2） |
| `heat` + `equity` 被静默当成加密热度 | API 显式 400（R4.2）+ 测试覆盖 |
| 股票池太小导致结果列表过短 | 默认 `topN=30` 可调；如仍偏少，后续调 `minQuoteVolume24h` 而不是扩大 topN |
| `CoinScanPanel` 已承载较多状态 | 只加一个 scope 状态 + 一张默认值表；不引入新的全局状态或 context |
