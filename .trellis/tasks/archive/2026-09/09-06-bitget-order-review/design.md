# Design — Bitget API 拉单复盘自己的交割单

## 1. 架构与边界

沿用三层约定（`.trellis/spec/frontend/directory-structure.md`、`.trellis/spec/server/index.md`）：

```
src/domain/bitget-position.ts       纯类型 + history-position 行 → Trade 映射（无 IO）
src/domain/trade.ts                 小改：部分字段 number|null（R9）
src/server/bitget-keys.ts           密钥文件读写（data/bitget-keys.json，0600）
src/server/bitget-client.ts         Bitget V2 私有客户端（签名/时钟/翻页拉历史仓位）
src/server/bitget-position-store.ts SQLite 表 bitget_positions（原始行缓存）
src/server/bitget-sync.ts           窗口切分 + 翻页 + upsert 编排
src/server/app-plugin.ts            装配新 service/store + 4 组路由
src/ui/TradeReviewWorkspace.tsx     (R2 抽取) 共享复盘工作台（从 App.tsx 迁出）
src/ui/BitgetPanel.tsx              新模块侧栏（key 设置 + 同步 + 复用工作台入口）
src/ui/App.tsx                      只减：加 'bitget' 模式分支，调用共享组件
tests/bitget-position.test.ts       映射纯函数单测
tests/bitget-keys.test.ts           (可选) 密钥文件读写
tests/bitget-position-store.test.ts 缓存表 upsert/增量
tests/bitget-sync.test.ts           (可选) 窗口/翻页编排（mock client）
```

新增模块不进入任何共享服务；仅复用：`CandlestickService`(OKX K线)、`ReviewStore`+`/api/reviews`+`/api/tags/*`、`DrawingStore`+`/api/drawings`、`buildReviewQueue`、`ReviewEditor`、chart-*.ts。

## 2. 数据模型与契约

### 2.1 SQLite 表 `bitget_positions`

```sql
create table if not exists bitget_positions (
  id text primary key,          -- 'bg-' + sha256 摘要(见 2.3)
  raw_json text not null,       -- Bitget 原始行（原样保留，含未来字段）
  symbol text not null,
  ctime integer not null,       -- 开仓 ms（索引/增量用）
  utime integer not null,       -- 平仓 ms（索引/增量用）
  fetched_at text not null
);
create index if not exists idx_bitget_positions_utime on bitget_positions (utime);
```

store 方法：`upsert(row)`、`listAll()`、`maxUtime()`、`deleteByTime(startMs,endMs)`（仅显式全量重拉时用）、`close()`。参照 `review-store.ts`（独立 new Database + WAL）。

### 2.2 密钥文件 `data/bitget-keys.json`

```json
{ "apiKey": "...", "secret": "...", "passphrase": "...", "updatedAt": "ISO" }
```

写权限 `0o600`（Windows 下尽力设置即可）；`data/` 已在 `.gitignore`。密钥**只在服务端进程内使用**，任何 API 响应不得回传；`GET /api/bitget/config` 只回 `{ configured: boolean }`。

### 2.3 域类型与映射（`src/domain/bitget-position.ts`）

```ts
export type BitgetHistoryPosition = {
  symbol: string; marginCoin: string; holdSide: 'long' | 'short';
  openAvgPrice: string; closeAvgPrice: string; openTotalPos: string; closeTotalPos: string;
  pnl: string; netProfit: string; totalFunding: string; openFee: string; closeFee: string;
  ctime: string; utime: string; marginMode?: string;
  // 可能的附加字段按需透传，映射函数只取上述字段
};

export function bitgetSymbolToOkxInstrument(symbol: string): string
// 'BTCUSDT' → 'BTC-USDT-SWAP'；非 USDT 结尾按未知处理（返回 null 由调用方过滤/告警）

export function toTradeId(row): string   // 'bg-' + sha256(symbol|holdSide|ctime|utime|openAvgPrice|closeAvgPrice|closeTotalPos|netProfit)

export function toTrade(row, sequence: number): Trade | null
// direction: long→'多', short→'空'
// entryTime/exitTime: ms → 上海 ISO(+08:00)，复用 trade-import 的 formatShanghai 思路（抽公共 helper 或复制 6 行）
// entryPrice/exitPrice: open/closeAvgPrice; size=closeTotalPos(开平相等，取 close)
// profit=netProfit; fee=-(openFee+closeFee) 取正值 = |openFee|+|closeFee|
// leverage/margin/maxPositionValue/returnRate/turnover=null; amplitude=null
// holdingMinutes=round((utime-ctime)/60000); sourceNote='bitget:history-position'
```

### 2.4 `Trade` 可空性（R9，`src/domain/trade.ts`）

`leverage/margin/maxPositionValue/returnRate/turnover: number | null`。
影响面审计（实现时逐条核对）：
- `src/domain/build-review-queue.ts` `compareByField`：null 恒沉底（封装 `nullSafeCompare`）。
- `src/ui/App.tsx` 内 trade 行渲染（`:653-654`）与指标条（`:731-736`）：走 null 感知的显示 helper（列表行 Bitget 显示如 `杠杆 — · 保证金 —`；`formatPercent(null)`→"—"）。
- `src/server/trade-import.ts:53-62` 的 `?? 0` 保持数字语义，无感。
- `review-progress.ts` 只用 profit：不受影响。
- xlsx 数据永不产生 null，队列/排序行为对 trade 模式不变。

## 3. Bitget 私有客户端（`src/server/bitget-client.ts`）

构造参数：`{ apiKey, secret, passphrase, fetchJson?: FetchJson }`（注入 `defaultFetchJson` 便于测试与走代理/重试）。公开方法：

```ts
async serverTimeOffsetMs(): Promise<number>      // GET /api/v2/public/time，取 now - server 差
async fetchHistoryPositions(input): Promise<{ rows: BitgetHistoryPosition[]; cursor: string | null }>
// input: { productType:'USDT-FUTURES', startTime, endTime, cursor? , limit=100 }
```

签名实现（照 ccxt bitget.ts:11526-11576）：
- 请求路径 `path = '/api/v2/mix/position/history-position'`；GET 参数键排序拼接 `key=value&...`（ASCII 值原样，不百分号转义）后：`url = base + path + '?' + urlencodeQuery`；`sign = base64(hmacSha256(ts + 'GET' + path + '?' + rawSortedQuery, secret))`。
- headers：`ACCESS-KEY/ACCESS-SIGN/ACCESS-TIMESTAMP/ACCESS-PASSPHRASE`。
- base `https://api.bitget.com`；错误统一抛 `BitgetApiError(message, code?)`，UI 层映射中文提示。
- 每请求前用缓存偏移量校正时间戳；`|ts-now|>30s` 触发重新校准。
- `productType` 放查询串内参与签名（对照 ccxt）。

## 4. 同步编排（`src/server/bitget-sync.ts`）

```
sync(fromMs = now-90d, toMs = now):
  ts 窗口切分为 ≤90 天?  不——API 单窗 ≤3 个月，取 SAFE_WINDOW = 80 天留余量
  for each [start,end] window:
    cursor=null
    loop:
      page = client.fetchHistoryPositions({productType:'USDT-FUTURES', startTime:start, endTime:end, cursor})
      for row in page.rows: toTradeId(row) → store.upsert
      cursor = page.cursor; 直到 null 或行数 0
  返回 { fetched, upserted, windows, error? }
```

- 幂等：全量拉时按 id upsert（`insert ... on conflict(id) do update set raw_json/fetched_at`）。
- 增量：`fromMs = max(store.maxUtime(), now - 90d)`（实现首版从 `now-90d` 起步即可，加 maxUtime 作为后续优化点，记录于 implement.md，避免首版过度设计）。
- 删除语义：不做；当用户在 UI 选"全量重拉"时先 `deleteByTime(from,to)` 再拉。

## 5. Server 路由（`app-plugin.ts` 新增，均在 configureServer 内）

| 方法/前缀 | 行为 |
|---|---|
| `GET /api/bitget/config` | `{ configured }` |
| `POST /api/bitget/config` | 校验 3 字段非空 → 写密钥文件 → `{ configured: true }`；恶意超长/非字符串直接 400 |
| `POST /api/bitget/sync` | body `{ startTime?: ms }` → 调 sync → 200 `{ fetched, upserted, error? }`；未配置 key → 400 |
| `GET /api/bitget/trades` | 从 store 读全部 → 映射 `Trade[]` → `buildReviewQueue(...)` 同 `/api/trades` 契约：`{ trades, instruments, tags, tagCounts }` |

注意 connect 中间件剥前缀：统一挂 `/api/bitget/config|sync|trades` 三个独立 use（如 `/api/free-replay/sessions` 先例），避免在 `/api/bitget` 前缀内再判 path 的混淆。`/api/reviews`、`/api/tags/*`、`/api/candles`、`/api/drawings` 原样复用（trade id 带 `bg-` 前缀天然隔离）。

## 6. UI 设计

### 6.1 App.tsx 改动（增量）
- `ReviewMode` 加 `'bitget'`；导航 4 按钮；侧栏收起态标签文字映射补 `'bit'`→'B'。
- `reviewMode === 'bitget'` 分支：侧栏挂 `<BitgetPanel/>`；工作区由 BitgetPanel 状态驱动选中交易后渲染共享 `TradeDetailWorkspace`（见 6.3）。或整体采用 6.4 的 TradeReviewWorkspace 抽取形态。

### 6.2 `BitgetPanel.tsx`（侧栏，模式入口容器）
状态机：`unconfigured`（内联设置表单）→ `ready`（同步范围选择：默认最近 90 天 / 自定义起始日期；同步按钮；结果与错误提示条）→ 已同步有数据后，区域切换为与 trade 相同的"筛选+进度+交易列表"。
该面板复用 trade 侧栏的筛选/进度/列表**展示组件**（6.3 抽取产物），数据来自 `/api/bitget/trades`。

### 6.3 共享工作台抽取（R2，行为零变化）
从 `App.tsx` 迁出以下（保持 JSX/class 名不变，组件移到 `src/ui/TradeReviewWorkspace.tsx` 与 `src/ui/trade-review-source.ts`）：
- `useTradeReviewSource(endpoint)`：封装 filters/data/selectedId/timeframe 状态、按 filters 请求 `GET {endpoint}`、toggleStarred、mutateTag(全局改名/删除)、handleReviewSaved、进度计算（`reviewProgress`/`firstUnreviewedTrade`）。
- `TradeReviewSidebar(source)`：工具栏筛选 + 进度条 + 交易列表（含收藏星标），trade 分支现状逐字保留。
- `TradeDetailWorkspace(source)`：detail-header（含 timeframes + 其他币/龙头按钮与 Overlay 开关）、`TradeChart`、metrics、`ReviewEditor`。
- trade 模式在 App 中替换为 `useTradeReviewSource('/api/trades')` 驱动的上述组件；bitget 模式用 `useTradeReviewSource('/api/bitget/trades')`。
- **迁移纪律**：本次只搬移不改逻辑；trade 模式 DOM/样式/事件与原实现一致。既有 UI 测试（app-tag-management、app-review-progress、app-drawings、review-editor）全绿 = 通过门槛；绿后手动 `npm run dev` 回归 trade 模式。

### 6.4 可选：整体模式化
若 App.tsx 现状使 6.3 的跨 `<aside>/<section>` 挂载过于别扭，允许采用替代形态：`<TradeReviewWorkspace source>` 自行渲染完整"侧栏 + resize-handle + 工作区"骨架，App 仅保留 mode-switch 与顶部框架。**取舍在实现阶段 step 0 用最少 diff 判断**，两条路都必须满足"行为零变化 + 测试全绿"。此项在 implement.md 中列为带 review gate 的决策点，不允许夹带其他重构。

## 7. 错误与兼容

- 错误分层：HTTP 层失败（网络/429）走 `fetchJsonWithRetry` 既有策略；业务层 `code!=00000` 抛 `BitgetApiError`，UI 中文文案：`40008`→passphrase 错、`40006`→key 无效、`IP 不在白名单`→提示绑定 IP、时间窗超保留范围→提示缩短起始时间。
- 兼容：trade(xlsx)、freeReplay、scan 行为与渲染不变；`Trade` 可空化对 xlsx 路径无感。
- 滚动：不引入新的构建/依赖（Bitget 签名用 `node:crypto` 原生，无需 hmac 库）。

## 8. 安全与操作

- key 只读、仅本机；建议用户绑 IP + 只读权限；写文件 0600。
- 若 key 失效/误配置：UI 提供"清除配置"（删除文件）入口。
- 回滚点：每一实现步对应 git 单提交；App 抽取步单独成 commit，行为回退即 `git revert` 该 commit。

## 9. 权衡记录

- 选 `history-position` 而非 fill：免写开平配对、天然带 pnl/手续费/资金费，与 xlsx 行口径一致（D4）。
- 选独立模块而非改 trade 数据源：互不干扰；代价是共享代码需抽取，用"纯搬移+测试兜底"控制风险（D1/D5）。
- 字段置 null 而非伪造近似杠杆/ROE：避免数字误导（R9）。
- 先不引入增量断点（maxUtime），首版默认最近 90 天全量窗口同步；增量优化留 implement 候选，防止过度设计。
