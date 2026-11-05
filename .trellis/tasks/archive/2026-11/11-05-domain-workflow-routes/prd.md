# 领域工作流路由 Module 深化

## Goal

把 `app-plugin.ts` 中的 HTTP handlers 按领域工作流提取为可独立测试的 Route Modules，保留 Vite 组装根、注册顺序和全部 API 行为，使路由解析与响应组合无需启动整个服务器即可验证。

## Background

- 父任务地图 #6；#1–#5 已完成，包括 Session 生命周期和真实事务级联。
- 当前 15 个 middleware 注册点与依赖 inventory 见 `research/current-state.md`。
- 本任务只移动/收窄 HTTP 边界，不改变业务规则；#7 才处理共享响应类型和 Candlestick 纯契约。

## Requirements

- **R1 — 完整工作流覆盖。** 提取 review/tag、Free Replay instruments+sessions+paper rounds、candles/drawings、scan/config+scan+market-heat、bitget config/sync/trades 全部注册点，不留 shadow handlers 在 App 根。
- **R2 — 组装根与顺序。** `app-plugin.ts` 继续构造 Stores/Services/Adapters 并调用 registration functions；保持原注册顺序，尤其 `/api/scan/config` 先于 `/api/scan`。
- **R3 — HTTP 兼容。** URL/query/body parsing、status codes、response JSON、错误文本和 Connect mount-prefix 语义不变；无通用 Router、微服务或新框架。
- **R4 — 直接测试 Interface。** registration functions 接收明确 deps；用 fake middleware + request/response harness 直接验证解析、响应组合、关键顺序和 cascade wiring，不读取真实密钥或生产 DB。
- **R5 — 行为质量门。** 既有 service/store/domain/App 测试不削弱，focused route suites、全量可运行测试、类型和 diff 检查通过。
- **R6 — 规范沉淀。** API spec 写清 Module ownership、registration order、dependency injection 和 route harness 要求。

## Acceptance Criteria

- [x] `app-plugin.ts` 只负责 construction/composition 与根级 helpers；15 个注册点全部由领域 Route Modules 提供且顺序与旧表一致。
- [x] 每个工作流都有直接 route 测试，至少覆盖成功响应、关键 400/405、scan order、atomic DELETE wiring 和 Bitget adapter isolation。
- [x] 所有既有 API payload/status/error 行为保持不变，Connect stripped-prefix 注释与实现保留。
- [x] 无通用 Router、生产环境副作用测试、真实 key 读取或业务逻辑复制；#5 事务删除仍由单一 cascade 调用完成。
  - 证据：直接 route harness 5 文件 / 8 tests + cascade 复验；根文件仅保留 7 个有序 registration calls，Modules 中恰好 15 个 `middlewares.use`。
- [x] focused tests、全量可运行测试、`npx tsc --noEmit`、`git diff --check` 通过；既有 parity fixture 失败单独记录。
  - 证据：全量可运行 83 文件 / 723 tests；类型与 CRLF-aware diff 检查通过。原始 `npm test` 仅同一缺 pool fixture suite 无法加载。
- [x] API/相关 specs 与父地图更新，独立提交并归档。

## Out of Scope

- 更改任何 endpoint、payload 字段、市场算法、Store schema 或前端调用。
- 把共享响应类型、nominal timeframe duration、Candlestick merge 移到中性 Module（#7）。
- 引入通用 Router、依赖注入框架、HTTP server 替换或账户/权限功能。
