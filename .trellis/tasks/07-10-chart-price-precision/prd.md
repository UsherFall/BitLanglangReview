# 图表 Y 轴价格精度自适应

## Goal

图表 Y 轴价格标签根据价格量级自动适配小数位数，让 BTC 和 LUNA 都能看清精确价格位置。

## Background

当前图表（Trade Review 和 Free Replay）Y 轴完全依赖 lightweight-charts 默认 priceFormatter，未自定义。对于价格极低的币种（如 LUNA `0.00001234`），Y 轴只显示 2 位小数 `0.00`，无法定位开仓价在图表上的精确位置。

十字光标 readout（`formatCandlestickPrice`）和交易标记（`tradeMarkers`）已显示完整精度，仅 Y 轴缺失。

## Requirements

- **R1**: Y 轴价格标签按价格量级分档显示小数位，边界使用半开区间避免重叠：
  - ≥ 1000 → 2 位小数
  - ≥ 1 且 < 1000 → 4 位小数
  - ≥ 0.01 且 < 1 → 6 位小数
  - < 0.01 → 最多 8 位，去除尾部多余零
- **R2**: Trade Review (`TradeChart`) 和 Free Replay (`FreeReplayChart`) 两个图表都应用该 formatter
- **R3**: formatter 复用 `Intl.NumberFormat`，不要自己拼接字符串
- **R4**: 不影响现有的十字光标 readout 和交易标记显示

## Acceptance Criteria

- [ ] BTC 类高价币（≥ 1000）Y 轴显示 2 位小数
- [ ] ETH/SOL 类中价币（≥ 1 且 < 1000）Y 轴显示 4 位小数
- [ ] 小币（≥ 0.01 且 < 1）Y 轴显示 6 位小数
- [ ] LUNA 类极低价币（< 0.01）Y 轴显示最多 8 位且无尾部零
- [ ] Trade Review 和 Free Replay 图表均生效
- [ ] 现有测试全量通过

## Out of Scope

- 十字光标 readout 格式调整（`formatCandlestickPrice` 保持现有 8 位行为不变）
- 交易标记文本格式调整
- 模拟交易面板中的价格显示
