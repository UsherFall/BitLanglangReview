# 1分钟K线 + 单子加星收藏 + 标签选择优化

## Goal

1. 支持 1 分钟 K 线作为复盘时间框架
2. 支持对交易单子加星收藏，便于标记和筛选重点单子
3. 标签输入改为选择+输入混合模式（combobox）

## Confirmed Facts

- OKX history-candles API 支持 `1m` bar，返回格式与现有代码一致
- `ReviewTimeframe` 类型当前为 `'5m' | '15m' | '1H' | '4H' | '1D' | '1W' | '1M'`（`src/domain/trade.ts:25`）
- `TradeReview` 模型当前仅含 `tags` 和 `note`（`src/domain/review.ts:1-6`）
- `trade_reviews` 表当前列为 `trade_id, tags_json, note, updated_at`（`src/server/review-store.ts:24-30`）
- 现有标签输入在 `ReviewEditor.tsx` 中为纯文本输入框（`src/ui/ReviewEditor.tsx:35`）

## Requirements

### R1: 1分钟K线时间框架

- R1.1 将 `1m` 加入 `ReviewTimeframe` 类型和 `reviewTimeframes` 数组，排在 `5m` 之前
- R1.2 所有 `timeframeMs` 映射表补充 `1m: 60_000`
- R1.3 `formatChartTime` 适配 1m 显示格式（`MM-DD HH:MM`，与5m/15m一致）
- R1.4 初始窗口保持150根不变（与所有框架一致），按需加载行为不变

### R2: 单子加星收藏

- R2.1 `TradeReview` 模型新增 `starred: boolean` 字段
- R2.2 `trade_reviews` 表新增 `starred` 列（默认 `false`）
- R2.3 交易列表中每条单子显示⭐按钮，点击即时切换收藏状态（optimistic UI）
- R2.4 筛选条件新增"已收藏"选项

### R3: 标签选择优化

- R3.1 标签输入改为 combobox：下拉显示已有标签供选择，同时支持输入新标签
- R3.2 已选标签以 chip 形式展示，可点击移除

## Acceptance Criteria

- [ ] 1m K线可在时间框架切换按钮中选中，排在5m之前，图表正常加载和显示
- [ ] 1m 下前后导航、缩放、自动加载行为正常
- [ ] 加星/取消加星操作即时生效，无需额外保存按钮
- [ ] 可按已收藏/未收藏筛选交易列表
- [ ] 标签输入框支持从已有标签中选择，也支持输入新标签
- [ ] 已有测试全部通过，新增测试覆盖 1m 和收藏逻辑

## Out of Scope

- 1m 框架的窗口大小不特殊处理，保持与其他框架一致的 150 根
- 收藏功能不引入分类收藏夹，仅布尔标记

## Design Decisions

| 决策 | 选择 | 原因 |
|------|------|------|
| 1m 窗口大小 | 150根（与其他框架一致） | 按需加载已覆盖扩展需求，保持一致性 |
| 收藏模型 | 简单布尔标记 | 最小改动，复盘场景不需要分类夹层 |
| 标签输入 | Combobox（选择+输入） | 既复用已有标签又保留创建新标签的灵活性 |
