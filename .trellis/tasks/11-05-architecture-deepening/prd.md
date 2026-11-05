# 架构深化：复盘与行情上下文

## Goal

把架构评审发现的改进点拆成可独立规划、执行、验证和归档的子任务，一次只推进一个交付项。优先处理正确性风险，再深化高耦合 Module 的 Interface，提升 Locality、Leverage 和可测试性，而不是做全仓重写或机械文件拆分。

## Background

2026-11-05 只读架构评审确认：

- 当前基线为 75 个测试文件、686 个测试通过，`tsc --noEmit` 通过。
- `src/domain` 的纯契约与 `src/server/market-data.ts` 的多 Adapter Seam 值得保留。
- 主要改进机会集中在 Free Replay 状态协调、图表数据协议、行情上下文、持久化原子性、路由测试面和共享契约归属。
- 用户要求一次做一个，并由外部执行者按照本任务树中的方案实施；父任务只负责范围、顺序和最终集成验收，不直接承担代码改造。

## Task Map

| # | Deliverable | Task | State |
| --- | --- | --- | --- |
| 1 | 统一 Market Data Source、requestSource 与 Candle Grid 映射，修复 Free Replay Other Coin Panel 跨源风险 | `archive/2026-11/11-05-replay-market-context` | Completed（commit `9e627a6`） |
| 2 | 把 Free Replay Cursor / Focus 双数据集及加载协议收进独立 Module | `archive/2026-11/11-05-free-replay-dataset` | Completed（commit `665ad0d`） |
| 3 | 优先复现并修复回溯复盘主图看不到 K 线的回归 | `archive/2026-11/11-05-replay-candlestick-regression` | Completed（commit `d4e55a1`；全量可运行测试通过，既有 parity fixture 失败单独记录） |
| 4 | 把 Free Replay Session 生命周期从 App 中深化为独立 Module | `archive/2026-11/11-05-replay-session-lifecycle` | Completed（commit `81896b4`） |
| 5 | 让 Free Replay Session 与 Paper Round Review 的级联删除具备事务性 | `archive/2026-11/11-05-replay-session-delete-transaction` | Completed（commit `720367d`） |
| 6 | 按领域工作流提取可独立测试的路由 Module，保留 Vite 组装根 | `archive/2026-11/11-05-domain-workflow-routes` | Completed（commit `9f771a2`） |
| 7 | 把共享响应类型、nominal timeframe duration 与 Candlestick 合并规则移到中性纯 Module | `archive/2026-11/11-05-shared-candlestick-contracts` | Completed（commit `4c78c8d`） |

顺序是交付顺序，不表示任务树本身提供依赖。每个子任务必须在自己的 `prd.md` / `implement.md` 中写明真实依赖、兼容约束和独立验收方式。

## Cross-child Requirements

- **R1 — 行为优先。** 保留 `CONTEXT.md` 的 Market Data Source、Candle Grid、Other Coin Panel、Free Replay Cursor、Chart Navigation Anchor 和 Paper Round 契约；已知行为变化必须单独写明并验收。
- **R2 — 深化而非搬家。** 每个改造都要说明 Interface 如何收窄、Locality 如何提升、测试如何跨同一 Seam；不得只把大文件切成一批浅 Module。
- **R3 — 小步兼容。** 优先增量迁移，不引入全局 frontend store、微服务、通用 Router、ORM 或通用图表框架。
- **R4 — 独立质量门。** 每个子任务先跑 focused tests，再跑完整 `npm test` 与 `npx tsc --noEmit`；新增风险必须有回归测试。
- **R5 — 独立交付。** 一个子任务完成实现、检查、spec 更新和提交后，再创建下一个子任务；不得把多个交付项混在一个执行提交中。
- **R6 — 知识沉淀。** 新形成的跨层契约必须更新相关 `.trellis/spec`；若引入新的领域名词，先更新 `CONTEXT.md`。

## Cross-child Acceptance Criteria

- [ ] 所有交付项分别拥有经过评审的 PRD、技术方案、执行步骤和独立验证证据。
- [ ] 每个已完成子任务的 focused tests、完整测试和类型检查均通过，且没有通过删除或放宽旧断言掩盖回归。
- [ ] Free Replay 主图与 Other Coin Panel 不再因为默认源或空 Session 推导而读取不同 Market Data Source。
- [ ] 高风险的 Cursor / Focus、自动保存、删除和视口规则拥有比整页 App 挂载更直接的 Interface 测试面。
- [ ] 最终集成评审确认没有引入全局状态库、过度抽象、数据迁移或无关产品行为变化。
- [ ] 最终完整测试与类型检查通过，架构决策和防护规则已写回项目 spec。

## Out of Scope

- 重写整个 App、更换 React、图表库、SQLite 或 Vite。
- 部署为多人云端平台，增加账户、权限或跨设备同步。
- 重新设计扫描算法、自动支撑阻力识别或交易产品行为。
- 在子任务之外顺手清理 mojibake、升级全部依赖或重写测试框架。

## Deferred Finding

`source=binance` 在服务端代表 Binance→OKX candidate chain，而 `source=binance-only` 代表严格 Binance。现有 Other Coin Chart 测试对 native Binance symbol 与 `source=binance` 的注释存在语义不一致。子任务 1 只保留并显式区分这两种策略，不擅自改变 `binance` 调用；若后续要修 native-symbol panel 的 candidate-chain 适配，必须另立缺陷任务并先确认兼容预期。
