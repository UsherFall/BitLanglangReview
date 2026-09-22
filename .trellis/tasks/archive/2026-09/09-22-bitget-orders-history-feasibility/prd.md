# Bitget 复盘数据源改用 orders-history 的可行性评估

## Goal

Bitget 复盘当前以 `position/history-position`（一轮已平仓 = 一行 Trade）为唯一数据源，缺杠杆/保证金等字段。评估**换成或扩展为订单级 `order/orders-history`** 的可行性与代价，给出结论与推荐方案，供用户拍板后再开实现任务。

## 背景与事实（2026-09-22 用本机只读 key 实测）

### 三接口对照

| 维度 | `position/history-position`（现用） | `order/orders-history` | `order/fill-history` |
| --- | --- | --- | --- |
| 粒度 | 一轮已平仓（开→平聚合） | 一笔订单 | 一笔成交 |
| 返回容器 | `data.list[]` | `data.entrustedList[]` | `data.fillList[]` |
| 历史深度 | **仅最近 90 天**，更早报 `code=00001 "startTime and endTime interval cannot be greater than 90 days"` | **≥104 天仍可查**（97-104d 有 4 单；120d 起返回 `entrustedList: null`） | 同 orders（90-97d 有 17 笔） |
| 单窗跨度上限 | 90 天 | **7 天** | **7 天** |
| 分页 | `limit≤100`（满了需时间二分） | `limit≤100` + `idLessThan` 游标 | 同 orders |
| 杠杆 | ❌ 无 | ✅ `leverage`（100/100 有值，同标的恒定，如 BTCUSDT 全 30） | ❌ 无 |
| 资金费 | ✅ `totalFunding`，`netProfit` 已含 | ❌ 无字段 | ❌ 无字段 |
| 止损可识别 | ❌ | ✅ `orderSource=loss_market` | ❌ |
| 轮次边界 | ✅ Bitget 给（`positionId` 实测存在） | ❌ 需按数量自行配对 | ❌ 需自行配对（更碎） |
| 手续费 | ✅ `openFee/closeFee` | ✅ `fee`（订单级） | ✅ `feeDetail[].totalFee` |
| 盈亏口径 | `netProfit`（含资金费+双边手续费） | `totalProfits`（不含资金费） | `profit`（不含资金费） |

### 实测样本（最近 7 天，BTCUSDT，全部 30x）

```
open  0.0059 @75561.9            src=market        (一轮)
close 0.0029 @75673.4  +0.32335  src=market        ← 分批平
close 0.0030 @75773.5  +0.63480  src=market        ← 分批平
...
open  0.0013 @79938.2            src=market        (一轮)
open  0.0021 @80258.2            src=market        ← 加仓
close 0.0034 @80462.4  +1.11028  src=market        ← 一次平掉
...
open  0.0036 @81188.5  src=normal/limit
close 0.0036 @80869.0  -1.15020  src=loss_market   ← 止损
```

其它实测事实：

- 最近 7 天 orders 共 **144 单**（第 1 页 100 满 → `idLessThan` 第 2 页 44），其中 `status=filled` 125、`canceled` 19；14 单 `priceAvg` 为空。
- `orderSource` 取值：`market` / `normal` / `modify_order_limit` / `loss_market`。
- 请求延迟与是否计入权重限频**未核实**（Bitget 私有接口权重文档当时不可访问）。

### 轮次 ↔ 订单对齐实测（决定"能否把明细挂到轮次下"）

- **时间偏差坑**：history-position 的 `ctime` 比该轮开仓订单 `cTime` **晚约 16ms**（实测 PEPEUSDT 订单 02:10:54.553 / 轮次 02:10:54.569），`utime` 比最后一笔平仓单晚约 24ms。按 `[ctime, utime]` 直接查订单**会切掉开仓单**（首轮探测只捞到 1 笔平仓单，误判为"开仓单缺失"）。
- 往前留余量（如 ctime − 2h）后，同一 symbol 的近 3 轮 6 笔 open/close 全部返回；但窗口同时会带进**相邻轮次**订单，故归属需数量配对 + 校验。
- **数量与价格吻合**：每轮 open 单数量合计 = close 单数量合计 = history-position 的 `closeTotalPos`（如 71137000 / 57999000 / 45718000 三轮全部相等）；`priceAvg` 与 `openAvgPrice`/`closeAvgPrice` 一致（末位四舍五入）。可用 `openTotalPos`/`closeTotalPos` 做归属校验，对不上则不展示明细。
- **分批与撤单同时存在**：BTCUSDT 实测一轮 = 1 开 + 2 笔分批平；PEPEUSDT 目标轮的前 2 分钟内有 2 笔 `canceled` 限价开仓单插在成交之间（`priceAvg` 空）。过滤 `status=filled` 后干净。
- 轮次内每笔订单还可取到 `orderSource=loss_market`（止损）/ `market` / `normal`，以及 `leverage`。
- **自算轮次与官方一致**：按"open 累计 / close 递减归零"状态机切轮，最近 7 天 52 轮中 **50 轮**与 history-position 的数量、时间完全吻合；1 条异常为跨 7 天查询窗的边界轮（开仓在窗外），实现时需往前扩窗。
- **画点必须用 `uTime` 而非 `cTime`**：限价单实测 cTime→uTime 差 61s / 357s / **799s**（挂单到成交），市价单只差 21ms。用 cTime 会把限价单的点画到挂单时刻。
- **"平一半再加仓"确属同一轮**（用户核心疑问）：BTCUSDT 实测一轮 = 开 0.0029 → 加仓 0.0039 → 平 0.0029 → 再加仓 0.0044 → 平 0.0083，官方记 `openTotalPos = closeTotalPos = 0.0112`（**累计量**，含中途加仓）。多动作轮次很常见：一笔开+多笔分批平（UBUSDT 705 → 352+353）、多笔开+一笔平（PYTHUSDT 825+910 → 1735）、平一半再平一半（USELESSUSDT 456 → 228+228）。
- 每个动作可从订单直接读到：`tradeSide`(open/close)、`baseVolume`、`priceAvg`、`uTime`、`orderSource`(含 loss_market 止损)、`leverage`、`fee`。

### 影响面（本地 `data/review.sqlite` 只读统计）

- `bitget_positions` 缓存 322 行；`trade_reviews` 中 `bg-` 前缀 **317 条**；`chart_drawings` 中 `bg-` **25 条**。
- Trade id = `bg-` + sha256(symbol|holdSide|ctime|utime|开盘均价|平仓均价|平仓量|netProfit)（`src/server/bitget-import.ts:56`），即**内容摘要**，换源必然改变。

## 候选方案

- **A 直接替换**：orders-history 独立支撑一行 Trade。需自写轮次配对（加仓/分批平仓/残量/canceled 过滤）、自补资金费口径、重算 id。**实测不可取**：317 条 bg- 复盘 + 25 条画线因 id 变化失联，且 orders-history 无资金费字段。
- **B 富化（推荐待决）**：Trade 主源仍是 history-position（id、净盈亏口径、轮次边界不变），orders-history 作补充源，按 symbol + posSide + 时间窗（留余量）+ 数量校验匹配，补 `leverage`、`loss_market` 止损标记。
- **B+ 轮次内明细（本次新增诉求）**：在 B 之上，把匹配到的订单作为该轮的**展开明细**展示（分批开仓/分批平仓逐笔列出），解决"history-position 只看得到首开均价与末平均价、中间过程不可见"。同一份数据、同一套匹配，不额外拉接口。
- **C 逐笔视图**：另加 fill-history 成交级面板（比订单级更碎、无 leverage/orderSource），与 B/B+ 正交，暂不推荐。

### 关键取舍

- **B/B+ 相对 A 的核心优势**：交易身份（`bg-` id）与净盈亏口径不变 → 已有复盘资产零损失；撤单不参与结构判断；匹配失败最坏只损失一个字段/一段明细，不会污染交易本身。
- **B/B+ 的代价**：orders-history 单窗 7 天 + 游标翻页（7 天 144 单需 2 页），3 个月约 26+ 次请求；成交极活跃的标的在 7 天内可能超 100 单需多页。限频权重未核实。
- **B+ 的边界**：持仓跨 7 天窗的轮次要切片查询；归属校验失败（数量对不上）时放弃该轮明细而非猜测；90 天以前的轮次没有 history-position 主数据，明细无处归属。

## UI 需求：图上逐笔开平点位标记（2026-09-22 用户追加）

**需求**：K 线图上标出这一轮的**每一笔**开仓/平仓点位（用户明确"开和平就够了"，不区分加仓/减仓）；图上**只留小图标**，鼠标悬停才显示该笔订单详情（价格/数量/杠杆/手续费/来源/盈亏）。左栏列表仍是**一行一轮**不变。

**历史教训（8 月两次尝试后全部回退，直接决定技术路线）**：

```
5ac739f 经典红绿进出场标记
cfed62e 指针 callout：绿色 B / 红色 S 方块 + 小三角指向 + 价格文字（SVG overlay）
2dd0e0f 因 SVG overlay 拖拽卡顿 → 改用 canvas 画标记
10ba64c 回退成"箭头 + 价格文字"
d99a762 整套回退到 4ff646b（最终状态）
```

用户对那版的反馈：**价格文字太占地方 / 图标本身不好看 / 挡住 K 线 / 拖拽缩放卡顿**（四项全中）。

**技术约束**：
- 内置 `SeriesMarker` 只有 `arrowUp | arrowDown | circle | square` 四种形状 + 4 种 position，`text` 与形状绑死，**无悬停能力** → 无法满足"只留图标 + 悬停详情"。
- **DOM/SVG 覆盖层路线已被历史否决**（拖拽卡顿，且没能救回）。
- 选定路线：**Series Primitive（canvas 自绘图标，随图表重绘天然跟随拖拽）+ DOM 悬浮卡片**。官方 `plugin-examples` 有可直接参考的实现：`plugins/tooltip`（209 行 `TooltipElement`，含跟随/死区/定位避让）、`plugins/user-price-alerts`（图上可交互标记点）、`plugins/image-watermark`（canvas 画任意图形）；辅助包 `@tradingview/lwc-toolkit`。npm 上无第三方现成插件。

**预览产物（已实现，待用户挑选）**：`preview/marker-preview.html`（双击即可，数据内联）。
- 数据：用户真实 Bitget 一轮 5 动作（开 0.0029 → 加仓 0.0039 → 平 0.0029 → 再加仓 0.0044 → 平 0.0083）；K 线补自 Binance 5m（本地缓存有 29 小时缺口，已补齐 791 根）。
- 可切换：**13 种图标样式**（圆点 / 光晕 / 环点 / 空心环 / 定位针 / 立体高光 / 菱形 / 同心环 / 缺口环 / 胶囊 / 点内箭头 / 箭头 / 徽章）× 3 种配色（青绿-玫红 / 黄-蓝沿用现状 / 绿-红）× 3 档大小（小/中/大）+ 价格文字开关。用户首轮反馈："青绿玫红圆点还可以，想要更美观的"。
- 其中"空心环"与"胶囊"用**形状**本身区分开/平（开=实心、平=空心），不只依赖颜色。
- 技术验证（像素级）：图标颜色与位置正确、悬停卡片内容与定位正确、拖拽后图标随图平移、四种样式截图互不相同。

## Requirements

- R1 给出 A / B / C 的可行性结论，含各自代价与不可逆影响（尤其复盘数据失联风险）。
- R2 明确推荐方案，并写清推荐方案下必须解决的开放问题。
- R3 结论落到本任务 `prd.md`（事实与结论）与后续实现任务的输入边界；不写实现代码。

## Acceptance Criteria

- [ ] A1 三接口的窗口/深度/分页/字段差异有实测依据（非文档推测），并落到本文件。
- [ ] A2 换源对既有 317 条复盘 + 25 条画线的影响被量化，并给出规避或迁移结论。
- [ ] A3 用户基于结论拍板后续方向；若选 B，产出实现任务的范围与验收草案。

## 决策定案（2026-09-22，用户已确认）

- **D1 目标**：看清"轮次内每一笔开/平"，不是补杠杆。
- **D2 展示形态**：K 线图上标出每个动作点（**只分开/平两类**）；默认**只留圆点图标**，悬停显示该笔详情；左栏列表**仍是一行一轮**。图标样式定为**圆点 + 中号 + 青绿/玫红**（预览页 13 种样式中选出）。
- **D3 拉取范围**：**同步时全量拉**（90 天）。实测成本 16 次请求 / 821 单 / 7.2s / 0 错误，可接受。
- **D4 全部开平仓模式**：**每轮都展开全部动作点**（非当前轮用更小尺寸 + 半透明）。
- **D5 xlsx 交割单复盘一起换**同一套圆点渲染（那边只会有首开/末平两点，源数据无中间动作）；价格默认进悬停卡片，另提供"显示价格文字"开关。
- **D6 只补杠杆**：订单历史直接给 `leverage`，Bitget 来源的 `Trade.leverage` 填该轮首笔开仓订单的杠杆；`margin` / `maxPositionValue` / `returnRate` 保持 `null`（用户决定不引入推算口径）。

## 关联产物

- `design.md` — 数据表、归属算法、同步扩展、前端 primitive + 悬停卡片、降级路径。
- `implement.md` — 9 步实施清单与验证命令。
- `preview/marker-preview.html` — 图标样式预览页（实现完成后删除）。

## Out of Scope

- 本任务不写实现代码、不改 `bitget-client.ts` / `bitget-import.ts`。
- 现货、币本位、子账户数据的拉取。
