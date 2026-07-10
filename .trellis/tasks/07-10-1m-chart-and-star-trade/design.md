# Technical Design: 1m K-line + Star + Tags Combobox

## Architecture

```
src/
├── domain/          # types, pure logic
│   ├── trade.ts     # ReviewTimeframe type ← R1
│   ├── review.ts    # TradeReview model ← R2
│   ├── review-queue.ts  # ReviewQueueOptions ← R2
│   └── build-review-queue.ts  # filter logic ← R2
├── server/          # persistence, API
│   ├── candlestick-service.ts  # timeframeMs map ← R1
│   ├── review-store.ts         # DB schema + CRUD ← R2
│   └── app-plugin.ts           # API routes ← R2
└── ui/              # React components
    ├── chart-time.ts     # timeframeMs, formatChartTime ← R1
    ├── App.tsx           # trade list, filters, star toggle ← R2
    └── ReviewEditor.tsx  # star toggle, tags combobox ← R2, R3
```

---

## R1: 1m Timeframe

### Type Change

`src/domain/trade.ts:25-27`:

```ts
// Before
export type ReviewTimeframe = '5m' | '15m' | '1H' | '4H' | '1D' | '1W' | '1M';
export const reviewTimeframes: ReviewTimeframe[] = ['5m', '15m', '1H', '4H', '1D', '1W', '1M'];

// After
export type ReviewTimeframe = '1m' | '5m' | '15m' | '1H' | '4H' | '1D' | '1W' | '1M';
export const reviewTimeframes: ReviewTimeframe[] = ['1m', '5m', '15m', '1H', '4H', '1D', '1W', '1M'];
```

`1m` 放在最前面，UI 按钮渲染时自然排在第一。

### Duplicated `timeframeMs`

两处 `timeframeMs` 映射表（`src/ui/chart-time.ts:42-51` 和 `src/server/candlestick-service.ts:107-116`）各加 `'1m': 60_000`。

现有代码已经有两份重复的映射表，本次不改动这个结构——不引入提取公共函数的额外重构，保持改动面最小。

### `formatChartTime` 1m 行为

1m 走现有 5m/15m 分支：当日非零点显示 `MM-DD HH:MM`，零点显示 `MM-DD`。无需特殊处理。

### `floorTimestamp` 1m 行为

`stepMinutes = 60000 / 60000 = 1`，`Math.floor(totalMinutes / 1) * 1 = totalMinutes`。自然取整到分钟，无需特殊处理。

### `boundaryAnchor` 1m 行为

与 5m/15m 一致，`offset = 0`（非 1D），正常计算边界锚点。

### Files NOT Changed

- `chart-viewport.ts` — 不依赖 timeframe
- `free-replay-chart.ts` — 不依赖 timeframe
- `App.tsx` 中的 timeframe 按钮 — 通过 `reviewTimeframes.map()` 动态渲染，自动适配

---

## R2: Star/Favorite

### Data Flow

```
User clicks ★ → optimistic UI toggle → POST /api/reviews { tradeId, starred: true/false }
  → ReviewStore.saveReview() → UPSERT trade_reviews
  → response updates local state
```

### DB Migration

`src/server/review-store.ts` constructor 中，`CREATE TABLE IF NOT EXISTS` 之后执行：

```ts
// Migration: add starred column if not exists
try {
  this.db.exec(`ALTER TABLE trade_reviews ADD COLUMN starred INTEGER NOT NULL DEFAULT 0`);
} catch {
  // Column already exists — ignore
}
```

### Model Change

```ts
// src/domain/review.ts
export type TradeReview = {
  tradeId: string;
  tags: string[];
  note: string;
  starred: boolean;  // NEW
  updatedAt: string;
};
```

### Store Change

`SaveReviewInput` 增加 `starred?: boolean`，`saveReview` 方法写入 `starred` 列。

### API Changes

**POST `/api/reviews`** — body 增加 `starred?: boolean`（`src/server/app-plugin.ts:43`）

**GET `/api/trades`** — params 增加 `starred=yes|no`，`toQueueOptions` 解析后传入 `ReviewQueueOptions`

### Filter Logic

`src/domain/review-queue.ts` 的 `ReviewQueueOptions` 增加 `starred?: 'yes' | 'no'`。

`src/domain/build-review-queue.ts` 的 `matchesOptions` 增加：

```ts
if (options.starred === 'yes' && !trade.review?.starred) return false;
if (options.starred === 'no' && trade.review?.starred) return false;
```

Trade 没有 review 记录时 `trade.review` 为 null，`starred` 视为 `false`。

### UI Location

- **Star toggle**: 每条 trade row（`src/ui/App.tsx:212-221`）左侧加 ★/☆ 按钮，点击即时切换
- **Star filter**: 筛选区（`src/ui/App.tsx:156-193`）增加一个 select: 全部 / 已收藏 / 未收藏

Star toggle API call:

```ts
async function toggleStarred(trade: ReviewedTrade) {
  const next = !(trade.review?.starred ?? false);
  // Optimistic update
  setData(prev => ({ ...prev, trades: prev.trades.map(t =>
    t.id === trade.id ? { ...t, review: { ...t.review ?? { tradeId: t.id, tags: [], note: '', updatedAt: '' }, starred: next } } : t
  )}));
  // Persist
  const review = await fetch('/api/reviews', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tradeId: trade.id, tags: trade.review?.tags ?? [], note: trade.review?.note ?? '', starred: next }),
  }).then(r => r.json());
  handleReviewSaved(review);
}
```

---

## R3: Tags Combobox

### Component Design

自定义 combobox，不引入外部 UI 库。

状态：
- `inputValue: string` — 当前输入文本
- `isOpen: boolean` — 下拉是否展开
- `selectedTags: string[]` — 已选标签（来自 draftTags 的解析）

交互：
1. 点击输入框 → 展开下拉，显示全部已有标签（来自 props）
2. 输入文字 → 过滤下拉列表，匹配的显示在上方
3. 输入文字完全匹配某个已有标签 → 高亮该项，回车/点击选中
4. 输入文字不匹配任何已有标签 → 下拉底部显示 "创建「xxx」" 选项
5. 选中标签 → 添加 chip，清空输入，保持下拉展开
6. 点击 chip 上的 × → 移除该标签
7. 失焦 → 关闭下拉；如果输入框有未提交的文字，自动创建为新标签

Props:
- `availableTags: string[]` — 已有标签列表
- `selectedTags: string[]` — 当前已选
- `onChange: (tags: string[]) => void` — 变化回调

### Location

替换 `src/ui/ReviewEditor.tsx` 中的 `<input aria-label="标签" ...>`，将现有 `draftTags` 的 `split/join` 逻辑替换为数组操作。

---

## Compatibility & Risk

| 风险 | 缓解 |
|------|------|
| 1m 历史数据量极少 | OKX 对历史 1m 数据有范围限制（约近期几天），旧交易单子可能没有 1m 数据。图表会显示空白区域，按需加载到边界后自动停止。 |
| DB migration 失败 | `ALTER TABLE` 用 try/catch 包裹，重复执行安全 |
| Star optimistic UI 和 API 不一致 | API 失败后不做回滚（简单处理），下次列表刷新时自动纠正 |
| 标签 combobox 在移动端不好用 | 保持原始文本输入作为 fallback——combobox 的输入框本身就是 text input |
