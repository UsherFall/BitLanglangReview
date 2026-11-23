# 活跃度扫描升级：实现与验证记录

## 实现结果

- Top80 市场温度与旧涨跌榜语义保持不变；新增 Top120 活跃度工作清单。
- 每币新增：成交额倍数、波幅倍数、活跃度、最近4h强度；历史不足返回 `null` 并置后。
- 选品页：市场温度摘要、前20候选、四种排序、近4h加速/降温/历史不足筛选、展开全部、指标说明、同行情源看图。
- 旧 `MarketHeatPanel` 继续展示原市场温度与涨跌榜，不显示新增工作清单。
- 15m与1D实时读取按源边界取整；`app-plugin` 同时传入源限频 gate 和 `dailyGrid`（Binance `utc`，OKX/Bitget `shanghai`）。

## 自动化验证

### 聚焦测试

```text
npx vitest run tests/market-heat-service.test.ts tests/market-heat.test.ts tests/heat-scan-results.test.tsx tests/market-heat-panel.test.tsx
```

结果：**4 个文件、31 个测试通过**。覆盖公式、Top80/Top120 隔离、空基线、实时 UTC/Shanghai 锚点、排序、筛选、展开、看图回调和旧面板兼容。

### 类型检查

`npx tsc --noEmit`：通过。

### 全量测试

`npm test`：

- **84 个测试文件、754 个测试通过**；
- 唯一失败为 `tests/level-alert-parity.test.ts` 启动时缺少历史 fixture：`.trellis/tasks/archive/2026-10/10-20-anomaly-level-tracker/research/pool`；
- 该失败与本次修改无关。补充运行 `npx vitest run --exclude tests/level-alert-parity.test.ts`，**84 个文件、754 个测试全部通过**。

BTC 原研究的 `research/validate.mjs` 与 `research/aug-activity.mjs` 也重新执行通过，未发生研究结论回归。

## 真实行情源 smoke

均通过实际 Vite `/api/scan?method=heat&scope=crypto&source=...` 调用：

| 行情源 | 耗时 | 市场覆盖 | 活跃候选 | null 活跃度 | 限频警告 | 结果 |
|---|---:|---:|---:|---:|---|---|
| Bitget | 约24.2s | 80/80 | 120 | 0 | 无 | HTTP200，字段完整 |
| Binance | 约30.6s | 80/80 | 120 | 1 | 无 | HTTP200，历史不足正确置空 |
| OKX | 约43.1s | 80/80 | 120 | 0 | 无 | HTTP200，UTC+8 日界下基线正常 |

原始响应保存在 `research/out/heat-smoke-{bitget,binance,okx}.json`。

OKX 初次实扫曾暴露两个实时锚点问题：15m最新收盘段不连续、1D基线为空。分别通过15m边界取整与源日界取整修复；修复后 OKX 同样返回120个有效候选。

## 真实浏览器 UI 验证

通过独立 headless Edge + CDP 实际执行「选品 → 热度 → 扫描」：

- 默认显示20行，活跃池120、可计算120；
- 点击「近4h降温」后显示11个候选；
- 点击「看图」打开 `ACEUSDT` 实际图表；
- 1600px 视口无横向溢出；
- 表格、筛选、排序、展开和图表按钮均真实可见可用。

截图：

- `research/out/heat-ui.png`
- `research/out/heat-ui-cooling.png`
- `research/out/heat-ui-chart.png`

## 边界

- Top120 是扩大后的注意力池，不是全市场无遗漏保证；
- 真实扫描请求量较旧实现增加，三种源耗时不同；
- 活跃度只安排看图顺序，不预测方向，也不能证明粗筛胜率；
- 历史锚点仍受当前 ticker 池限制，不能据此宣称当时全市场排名。
