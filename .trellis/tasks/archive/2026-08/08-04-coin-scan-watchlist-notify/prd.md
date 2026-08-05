# 选币自选列表与通知

## Goal

给选币模块加**自选币价格警报 + 微信通知**:缩量扫描发现蓄力币后,用户对关注的币**手动设价格警报**(上破 / 下破),系统定时查价,到价推微信提醒。用户不用一直盯盘,关注的币到关键价位自动收到通知。

## Background / Confirmed Facts

- 选币模块已存在:插件式 method,只有"缩量"方法。`src/domain/coin-scan.ts`、`src/server/coin-scan-service.ts`、`src/ui/CoinScanPanel.tsx`、`/api/scan`(契约见 `.trellis/spec/server/coin-scan.md`)。
- 扫描范围目前是"按 24h 成交额 topN 扫全市场";本次不动扫描算法,只加警报能力。
- 存储:本地 SQLite `data/review.sqlite`,多个 store 共存(`ReviewStore` / `DrawingStore` / `FreeReplaySessionStore` 模式可仿)。
- 价格数据:OKX 全量 ticker 一次可拿全部实时价(`CoinScanService.fetchTickers` 已有,当前是私有方法)。
- 服务架构:Vite 插件 `configureServer` 挂中间件(`src/server/app-plugin.ts`),API 路由在此;定时器可挂在此,应用开着就跑。
- 用户明确要求砍掉自动突破检测:扫描只做缩量候选,突破判断由用户手动设价完成。

## 已定决策

| 决策 | 结论 |
| --- | --- |
| 通知渠道 | 只做**微信(Server酱)**;留 channel 抽象接口,邮件 / QQ 后续加 adapter |
| 警报方向 | **上破 + 下破**都做(方向下拉) |
| 触发后行为 | **触发一次**,标"已触发",不重复推;可手动「重新启用」或「删除」 |
| 监控频率 | 默认 **60 秒**,可配置 |
| 警报来源 | 扫描结果行「设警报」(预填币)+ 面板手动输入,两种都要 |
| SendKey 存放 | `process.env.SERVERCHAN_KEY`,vite `loadEnv` 读 `.env`,不进 DB 不进 UI |

## Requirements

- **R1 域模型**:`PriceAlert = { id, instrument, direction: 'above'|'below', targetPrice, status: 'active'|'triggered', createdAt, triggeredAt? }`;纯函数 `isAlertTriggered(alert, currentPrice)`:非 active 不触发;`above` 当前价 `>=` 目标价触发,`below` 当前价 `<=` 目标价触发。
- **R2 持久化**:SQLite `price_alerts` 表(建在 `data/review.sqlite`);CRUD + `markTriggered(id)` + `reactivate(id)`。
- **R3 API**(仿现有路由风格,契约见 `.trellis/spec/server/api-plugin.md`):
  - `GET /api/alerts` → `{ alerts, config: { notifierConfigured, monitorIntervalMs } }`
  - `POST /api/alerts` body `{ instrument, direction, targetPrice }` → 新建警报
  - `DELETE /api/alerts?id=…` → 删除
  - `POST /api/alerts/reactivate?id=…` → 重新启用
- **R4 监控**:`AlertMonitor` 定时循环(默认 60s):拉全量 OKX ticker → 对每个 active 警报判定 → 触发则 `markTriggered` + Server酱推送;重叠 tick 防抖(上一轮未结束则跳过);警报币不在 ticker 列表则跳过。
- **R5 通知**:`ServerChanNotifier`,POST `https://sctapi.ftqq.com/{key}.send`;消息含币、方向、目标价、当前价、时间。未配置 key 时推送 no-op(警报仍正常标记触发)。
- **R6 UI**(`CoinScanPanel`):结果行加「设警报」按钮(预填币);面板警报区 = 手动添加表单(币 + 方向 + 目标价)+ 警报列表(币 / 方向 / 目标价 / 状态 / 操作:重新启用、删除)+ 通知配置状态(已配置 ✓ / 未配置 ✗)。
- **R7 配置**:`.env` 读 `SERVERCHAN_KEY`(vite `loadEnv` 传入 plugin,无新依赖);未配置时监控不推送、UI 显示未配置。

## Acceptance Criteria

- [ ] AC1:`isAlertTriggered` 边界正确(above `>=` / below `<=` 触发;equal 触发;triggered 状态不触发),`tests/price-alert.test.ts` 覆盖。
- [ ] AC2:`AlertStore` CRUD + markTriggered + reactivate 正确落库/读取,`tests/alert-store.test.ts` 覆盖(临时 SQLite 文件)。
- [ ] AC3:`AlertMonitor` tick:正确触发目标警报、标 triggered、不重复触发、缺价格跳过、重叠 tick 防抖,`tests/alert-monitor.test.ts` 覆盖(mock ticker + notifier)。
- [ ] AC4:`ServerChanNotifier` POST 到正确 URL + body,`tests/serverchan-notifier.test.ts` 覆盖(mock fetch);未配置 key 时不抛错。
- [ ] AC5:全量测试绿(`npm test`);现有 `coin-scan-service.test.ts` 在 ticker 提取重构后仍绿。
- [ ] AC6:手动验证(`npm run dev`):扫描结果行「设警报」→ 建警报 → 警报列表增删/重新启用 → 到价触发推微信 → 状态变"已触发";未配置 key 时 UI 显示未配置。

## Out of Scope

- 自动强势突破 / 箱体末期检测(已搁置,见 `08-04-coin-scan-box-end`)。
- 邮件 / QQ 通知渠道(只留接口,不实现)。
- 多用户 / 鉴权、警报历史统计、部署守护进程(本地 dev server 运行,机器关了不扫)。

## Notes

- 复杂任务:已写 `design.md` + `implement.md`,`task.py start` 前需 review。
- 涉及:新域模型、ticker 提取重构、新 store、新监控服务、通知服务、API 路由、UI、配置。
