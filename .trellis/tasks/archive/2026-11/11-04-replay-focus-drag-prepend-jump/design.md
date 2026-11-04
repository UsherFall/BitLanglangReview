# Design: 追加型 setData 在拖动进行中落地的视口瞬移修复（FreeReplayChart）

## 1. 边界与不变式

- **改动只在 `src/ui/App.tsx` 的 `FreeReplayChart`**。数据加载路径、请求参数、闸门纯函数（`free-replay-chart.ts`）不动。
- 不变量 A（10-30 双数据集）：焦点态活动数据集 = 焦点窗口，游标态 = 游标窗口，互不 merge。
- 不变量 B（11/03）：`shiftVisibleRangeOnNewBar: false` 保留；释放后追加由 LWC 补偿保视口（harness S1 实证）。
- 新增不变式 C：**拖动进行中（pointerdown 到 pointerup 之间），FreeReplayChart 不得对「追加型」数据集变化调用 `series.setData`**（渲染 effect 的唯一触发是 `renderedCandles` state 变化 —— 推迟 `setRenderedCandles` 即推迟 setData）。

## 2. 数据流设计

### 2.1 指针状态跟踪

```
chartRef 容器（.chart-wrap / .chart）
  onPointerDown  → pointerDownRef.current = true
window（useEffect 挂载）
  pointerup / pointercancel → 若 pointerDownRef 为 true：置 false，flushPendingInstallRender()
```

- pointerup 用 window 级兜底（拖出 chart 元素外释放也生效）；LWC 自身 mouseup→`endScroll` 同步清拖动快照，flush 再加 `setTimeout(0)` 错开同 tick 的 endScroll，保证渲染时快照已清。
- wheel 缩放（`_internal_scaleTo` 只改 barSpacing 不重导 rightOffset）实证外安全，不需处理；只对 pointer 拖动做推迟。
- 不追踪具体按键/坐标：任何按住状态下的追加型落地都推迟（保守面），拖动极短时（按下即抬）等同现状。

### 2.2 安装路径分层（installIntoDataset → publishActive）

`publishActive(candles, { publishToApp, render })` 现有语义保留；新增第三种模式 `render: 'defer'`（命名实义：pending 渲染）：

```
installIntoDataset(candles, dataset, options)
  ├─ 数据层（永远立即）：ownerRef 合并；activeCandlesRef = merged；setLoadedCandles(merged)
  │    （翻页闸/补洞键/历史回填读的是这些，语义不变 —— R4）
  ├─ publishToApp 语义不变：cursor 数据集发布时 onCandlesLoaded(merged)
  │    （游标数据集供给 App 统计/步进 —— R2 外的 App 面照常）
  └─ 渲染层（按条件）：
       render !== false 且 pointerDownRef.current === true（追加型调用点）
         → pendingInstallRef.current = { dataset }（标记待 flush，不 setRenderedCandles）
       否则 → setRenderedCandles(merged)（现状）
```

- **追加型调用点**（推迟面）：`loadLaterActiveCandles`（焦点右缘翻页，App.tsx ~1885）与 `loadWindowCandles`（补洞自愈，~1920）。两处都是 `installIntoDataset(candles, dataset)` → 改传 `{ render: 'defer' }`。
- **非追加型不动**：`loadEarlierFreeReplayCandles`（前插，mid-drag 安全）、`loadCursorInitialWindow`（整窗替换，点击触发非拖动）、焦点取窗 fetchInitialWindow 落地（点单行触发）、未来预取（本就 `render:false`）。
- 调用方「defer」模式下，`publishActive` 不改（保持单一职责）：`installIntoDataset` 内部先做数据层，再决定渲染层走 `setRenderedCandles` 还是记 pending。

### 2.3 flush（拖动结束后渲染）

```
flushPendingInstallRender():
  const pending = pendingInstallRef.current
  pendingInstallRef.current = null
  若 !pending 或 chart 不在 → return
  → setRenderedCandles(activeCandlesRef.current)（渲染 effect 据此 setData + 喂标记层 + onActiveCandlesLoaded）
```

- 连续拖多页：每页落地都进 pending（同一槽位覆盖，数据层已串行合并）→ 松手一次渲染最终合并结果，一次补偿生效，无中间跳动。
- flush 后 `renderedCandles` 变化驱动渲染 effect → `visibleCandlesForFreeReplay` 过滤、标记层 setPoints、`onActiveCandlesLoaded` 全部按既有链路走（R2 内 App 的活动数据集更新也自动恢复）。
- 指针抬起时若无 pending：无操作（零开销路径）。
- 组件卸载 / rangeKey 切换：pendingInstallRef 一并清（跟随现有 reset effect 族，避免跨会话渲染旧数据）。

### 2.4 为什么不需要 anchor 恢复

释放后 setData 走 LWC `_internal_updateTimeScale` 补偿分支（`isSeriesPointsAddedToRight && !needShift` → `setRightOffset(-Δ)`），时间范围保持 —— harness S1 实证。TradeChart 的 anchor 恢复是历史遗留双保险，本修复不引入（R5 / out of scope）。

## 3. 修复后预期行为（对照 harness）

- 拖动向右缘 → 翻页请求落地 →（松手前）视口继续跟手、右缘外仍空白 → 松手 → 新页一次补上、视口不动。
- 拖动经过洞区 → 补洞请求落地 → 同上。
- 视觉上与 TradeChart 的 pendingRender（later 推迟渲染）语义一致，无新 UX。

## 4. 风险与回滚

- 风险 1：pending 渲染在极端情况下（pointerup 未触发，如浏览器打断）滞留。缓解：window pointercancel + blur 兜底清 pending + flush；卸载清理。
- 风险 2：测试对 `render:'defer'` 语义的组件级覆盖不足。缓解：acceptance 里三条组件级用例（推迟、flush、非拖动对照）。
- 回滚：改动集中一个组件内部状态机，单 commit revert 即恢复现状（现状 = 乱飘 bug 回归，回滚需带说明）。

## 5. 测试设计

- 组件级（jsdom，mock chart，现有 `tests/app-free-replay.test.tsx` 基建）：
  1. 指针按下 → 焦点右缘翻页 fetch resolve → 断言 `setData` 未被调用（渲染未发生）且数据层已合并（闸随 active 关闭）。
  2. window pointerup + 微任务 → 断言 `setData` 被调用且参数含追加页（最终合并结果）。
  3. 无指针按下（对照）→ fetch resolve → `setData` 立即调用（现状回归）。
  4. 补洞路径同 1/2。
- harness（真实 LWC）：新增 S5 场景验证「推迟渲染」策略下无甩页（修复后人工重跑一次，数字记回 findings.md）。
- 全量 `npx vitest run`。

## 6. 追加（11/04）：换焦点单复位「开仓点前」视图

**行为变更**：剪刀点亮（hideAfterFocus）后点击另一笔已完成单子 → 剪刀复位为关，新单按揭示边界（游标）渲染完整焦点窗口；同单重复点击（token 递增重定位）不清。反转 11/03 的「换焦点单不清，连续审单」决策（用户报障：点亮剪刀切单，新单也被隐藏）。

**实现**：`focusRequest` prop 补 `id`（App 传 `orderFocus.id`）；图表加 `scissorsOrderRef` 记上一焦点单 id；复位 effect 从「焦点为 null 才复位」改为「焦点为 null **或 id 变化**都复位」：

```typescript
useEffect(() => {
  if (!focusRequest || focusRequest.id !== scissorsOrderRef.current) setHideAfterFocus(false);
  scissorsOrderRef.current = focusRequest?.id ?? null;
}, [focusRequest]);
```

时序安全：切单 commit 里剪刀锚定 effect 先跑但 `containing(B.timeMs-1, 旧 A 窗口)` 为 null 跳过（无误锚）；复位 re-render 后 cutoff 归 null，渲染边界回游标；新单窗口落地后由既有 `appliedFocusKeyRef` 锚定接管。焦点切换期间 focusRequest 恒非空，剪刀按钮不消失。

**不改**：同单重复点击 + 剪刀开着时视图走 `appliedFocusKeyRef` 居中锚（既有行为，本次不动）；剪刀锚定 effect 的 renderedCandles 陈旧跳过是 11/03 已知边界，不在本次范围。
