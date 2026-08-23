# 选币模块优化-复制币名与流动性筛选

## Goal

优化选币模块:①移除点击行跳 Free Replay(避免污染会话历史),改为**每行复制币名按钮**(复制小写短名,如 btc/eth/hype);②加**24h 成交额下限筛选**,排除流动性过小(近似市值过小)的币。

## Background

- 上一任务(`08-04-shrink-volume-scan`,已归档)交付选币模块:`/api/scan` + `CoinScanService` + `CoinScanPanel/Results`。
- 当前点击行 → `openScanReplay` 跳 Free Replay 并自动保存会话 → 污染历史(用户反馈)。
- OKX 无市值字段;已定用 24h 成交额(`volCcy24h`,扫描已抓取)作流动性代理,零新依赖。
- 图表/链接方案已否决:不做弹窗图、不做 OKX 外链。

## Requirements

| ID | 需求 |
|----|------|
| R1 | 移除点击结果行跳 Free Replay。行点击不再触发任何模式切换/动作。 |
| R2 | 每行加**复制币名按钮**:复制该币**小写短名**(`BTC-USDT-SWAP` → `btc`,即去 `-USDT-SWAP` 后缀并小写)。复制后给"已复制"反馈。 |
| R3 | 流动性筛选:新增可调参数 `minQuoteVolume24h`(**24h 成交额下限**,默认 1000 万 USDT)。先按 `volCcy24h` 过滤低于下限的币,再按成交额取 Top-N。 |
| R4 | 清理无用代码:`openScanReplay`(App.tsx)、`formatReviewInputTime`(chart-time.ts)、`lastCandleTime`(ScanRow + service + tests)。 |
| R5 | 新模块界面全中文;复制按钮/参数面板文案中文。 |

## Acceptance Criteria

- [ ] AC1:点击结果行不再切换模式,不产生 Free Replay 会话。
- [ ] AC2:每行有复制按钮,点击后剪贴板内容为小写短名(如 `btc`),按钮显示"已复制"反馈。
- [ ] AC3:扫描参数面板含"最低成交额",默认 1000 万;`/api/scan` 接受 `minQuoteVolume24h`,非法值回退默认或 400。
- [ ] AC4:低于成交额下限的币不会出现在结果中;结果列显示每币 24h 成交额。
- [ ] AC5:无引用残留(openScanReplay / formatReviewInputTime / lastCandleTime 已从代码与测试移除)。
- [ ] AC6:全量测试绿(含更新后的 coin-scan / coin-scan-service / chart-time 测试)。

## Out of Scope

- 弹窗图表、OKX 外链、真实市值外部 API。
- 自动定时刷新。

## Open Questions

无阻塞项。默认下限 1000 万 USDT 为初值,参数可调。

## Notes

- 增量修改,基于已归档 `08-04-shrink-volume-scan`。
- 跨层契约变更(`/api/scan` 参数),`design.md` + `implement.md` 在 `task.py start` 前补齐。
