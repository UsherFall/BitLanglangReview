# 选币自选列表与通知 — Design

## 架构总览

```
UI (CoinScanPanel)
  │  POST/GET/DELETE /api/alerts
  ▼
app-plugin.ts (configureServer)
  ├── AlertStore            ← SQLite price_alerts 表
  ├── ServerChanNotifier    ← POST sctapi.ftqq.com/{key}.send
  └── AlertMonitor          ← setInterval 定时查价 + 触发判定
        │  每次 tick
        └── fetchOkxTickers()  ← 从 CoinScanService 提取,共享
```

新增文件:
- `src/domain/price-alert.ts` — 域类型 + 纯函数判定
- `src/server/okx-tickers.ts` — 提取 ticker 拉取,scan 与 monitor 共用
- `src/server/alert-store.ts` — 警报持久化
- `src/server/notify.ts` — `Notifier` 接口 + `ServerChanNotifier`
- `src/server/alert-monitor.ts` — 定时监控循环

改动文件:
- `src/server/coin-scan-service.ts` — 私有 `fetchTickers` 改为引用 `okx-tickers.ts`(行为不变)
- `src/server/app-plugin.ts` — 实例化 + 挂 `/api/alerts` 路由 + 启动 monitor
- `vite.config.ts` — `loadEnv` 读 `SERVERCHAN_KEY` 传入 plugin
- `src/ui/CoinScanPanel.tsx` — 警报表单 + 列表 + 行「设警报」+ 配置状态
- `src/ui/styles.css` — 警报区样式

## 数据流

1. **建警报**:UI → `POST /api/alerts` → `AlertStore.saveAlert` → SQLite。
2. **监控**:`AlertMonitor.tick`(每 60s)`:fetchOkxTickers()` 拿全部实时价 → 对每个 `active` 警报取价 → `isAlertTriggered` → 是则 `markTriggered(id)` + `notifier.send(...)`。
3. **展示**:UI `GET /api/alerts` → `{ alerts, config }`,config 含 `notifierConfigured`(是否有 key)与 `monitorIntervalMs`。

## 契约

### PriceAlert (domain/price-alert.ts)

```ts
export type AlertDirection = 'above' | 'below';
export type AlertStatus = 'active' | 'triggered';
export type PriceAlert = {
  id: number;
  instrument: string;          // BTC-USDT-SWAP
  direction: AlertDirection;
  targetPrice: number;
  status: AlertStatus;
  createdAt: string;           // ISO
  triggeredAt: string | null;
};
export function isAlertTriggered(alert: PriceAlert, currentPrice: number): boolean;
```

判定:非 `active` → false;`above` → `currentPrice >= targetPrice`;`below` → `currentPrice <= targetPrice`(等值触发,文档化)。

### 建表 (alert-store.ts)

```sql
create table if not exists price_alerts (
  id           integer primary key autoincrement,
  instrument   text    not null,
  direction    text    not null,
  target_price real    not null,
  status       text    not null default 'active',
  created_at   text    not null,
  triggered_at text
);
```

### API /api/alerts

| 方法 | 入参 | 出参 | 错误 |
| --- | --- | --- | --- |
| GET | — | `{ alerts, config: { notifierConfigured, monitorIntervalMs } }` | — |
| POST | body `{ instrument, direction, targetPrice }` | 新建 `PriceAlert` | 缺字段 / direction 非法 / targetPrice 非正 → 400 |
| DELETE | `?id=` | `{ ok: true }` | 缺 id → 400 |
| POST `/reactivate` | `?id=` | `{ ok: true }` | 缺 id → 400 |

### Server酱消息

- title:`价格警报: {短币名} {上破|下破} {目标价}`
- desp:`币: {短币名}\n方向: 上破\n目标价: {target}\n当前价: {price}\n触发时间: {ISO}`
- URL:`https://sctapi.ftqq.com/{key}.send`,body `title` + `desp`。

## 关键决策与权衡

### ticker 提取共享(okx-tickers.ts)
`CoinScanService.fetchTickers` 是私有方法,monitor 也需要全量价格。提取为 `fetchOkxTickers(fetchJson)` 模块函数,scan 与 monitor 共用。
- **权衡**:小重构触碰工作代码,但消除重复拉取;`coin-scan-service.test.ts` 保持全绿即证明行为不变。
- 备选:在 CoinScanService 暴露公共方法 —— 耦合扫描服务与监控,不选。

### 一次 tick 一次拉取
monitor 每轮只拉一次全量 ticker,再查 Map 判所有警报;不为每币单独请求。
- **权衡**:ticker 全量接口数据量小、免费;单次拉取避免 N 次请求,省时省限频。

### 通知 channel 抽象(notify.ts)
`Notifier` 接口 + `ServerChanNotifier` + 未配置时的 no-op。
- **权衡**:留扩展缝(邮件 / QQ 后续一个 adapter);未配置 key 时监控照跑、警报照标记,只是不推 —— 用户补 key 后无需重建警报。
- 已定:触发时**先 markTriggered 再 send**;send 失败记日志,警报保持 triggered(不重复推)。

### monitor 生命周期
`configureServer` 里 `setInterval`,`timer.unref()` 不阻塞进程退出;`running` 标志防重叠 tick。
- **权衡**:只随 dev server 跑 —— 24/7 需本机常开(已向用户说明)。可配置间隔(默认 60_000ms)。

### 配置加载
`vite.config.ts` 用 `loadEnv(mode, process.cwd(), '')` 读 `SERVERCHAN_KEY`,传入 `tradingReviewApiPlugin({ serverChanKey })`;plugin 参数可选,默认回落 `process.env`。
- **权衡**:零新依赖;`.env` 不进 DB / UI。

## 兼容性与回滚

- 新增表、新增路由、新增文件,全部**增量**;`coin-scan.ts` 纯函数不动。
- 唯一行为触碰点:`coin-scan-service.ts` ticker 提取重构 —— 回滚点 = 该文件;重构前后 `npm test` 全绿为门禁。
- 未配置 key 时功能 inert,不影响既有扫描。
