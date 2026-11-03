# Implement：回溯复盘点单焦点窗口改为整窗替换

## 改动面

- `src/ui/App.tsx` — `FreeReplayChart`（唯一实现文件）
- `tests/app-free-replay.test.tsx` — 回归用例
- `tests/app-free-replay.test.tsx` 的共用 chart mock — 补 `setData` 捕获
- `.trellis/spec/frontend/component-guidelines.md` — 焦点单契约追加「整窗替换/双数据集」条款

不动：`TradeChart`、`free-replay-paper-trading.ts`、服务端、`free-replay-chart.ts` 纯函数。

## 步骤

### 1. 数据模型改名与分离（无行为变化）

- `loadedCandlesRef` → 语义变更为 `activeCandlesRef`（活动数据集）
- 新增 `cursorCandlesRef: Candlestick[]`（游标数据集）
- 新增 `focusCandlesRef: Candlestick[]`（焦点窗口）
- 新增 helper：
  - `publishActive(candles, { publishToApp }: { publishToApp: boolean })`：写 `activeCandlesRef` + `setLoadedCandles` + `setRenderedCandles`；`publishToApp` 为真时才 `onCandlesLoaded(candles)`
  - `focusActive()`：派生自 `focusRequest != null`（用 ref 保存，供非渲染路径读取）

验收：`npx tsc --noEmit` 干净；现有测试全绿（此步不应有行为变化）。

### 2. `onCandlesLoaded` 收敛到游标数据集

- 所有 `publishActive(..., { publishToApp: true })` 仅出现在**游标数据集**路径：初始加载、历史回填、earlier/later（非焦点态）、未来预取（非焦点态）
- 焦点取窗与焦点态翻页一律 `publishToApp: false`
- `loadedCandles`/`renderedCandles` 仍由活动数据集驱动（渲染/步进/翻页不变）

验收：焦点态下 `市价开仓` 仍 enable（新用例 2）。

### 3. 焦点 effect 改为整窗替换

重写现有焦点 effect：

- 依赖 `[focusRequest, replay.instrument, replay.startTime, timeframe]`（去掉 `loadedCandles`/`renderedCandles` 依赖，避免被翻页触发）
- 去重键 `focusKey = ${rangeKey}:${token}`（`focusWindowKeyRef`）
- 首次进入焦点（`focusRequest` 从 null 变非 null，或 `rangeKey` 变化）：备份游标数据集 → 取窗 → `focusCandlesRef = 响应` → `publishActive(focus, {publishToApp:false})` → `setVisibleRange(entryVisibleRange(...))`
- 开仓点在窗口外/取窗失败：贴游标数据集最早边缘（保留现有兜底），不死循环
- 删除「开仓点已在已加载窗口内就不取窗」的分支（一律重取，保证活动数据集恒为一个连续窗口）

验收：新用例 1（无跨越）与 4（切周期无跨周期缝）。

### 4. 退出焦点：恢复游标数据集

- 新 effect（声明在渲染 effect 之前）：`focusRequest` 由非 null 变 null 时
  - 若 `cursorCandlesRef.current` 为空或 `[0].timeframe !== timeframe` → 跑一次标准游标初始加载，成功后恢复
  - 否则立即 `publishActive(cursorCandlesRef.current, { publishToApp: true })`
- 清理焦点态残留：`appliedFocusKeyRef`/`focusWindowKeyRef` 重置；`historyBackfillVisibleBarsRef`/`historyBackfillKeyRef` 清空

验收：新用例 3（回光标后图上立刻有游标附近 K 线）。

### 5. 回光标锚定的守卫

- `anchorViewportToCursor` 调用点加守卫：活动数据集必须含 `replay.cursorTime` 那根（`candlestickAtTime`）
- 回光标 effect 依赖加入活动数据集，让恢复后在下一次 commit 重试锚定

验收：新用例 3；既有 10/30 回光标用例保持绿。

### 6. 焦点态跳过历史回填

- 历史回填 effect 开头 `if (focusActive()) { 清 ref; return; }`

验收：焦点态切周期不触发游标历史回填（用例 4 覆盖视口正确性）。

### 7. 测试基建 + 回归

- `tests/app-free-replay.test.tsx` 的 chart mock：`addSeries` 返回的 `setData` 提到 `chartMocks.setData`，`beforeEach` 清理
- 新增 4 个用例（见 design.md「测试策略」）；用例 1 断言「相邻两根时间差恒等于一个 step」

验收：`npx vitest run tests/app-free-replay.test.tsx` 全绿。

### 8. spec 更新

- `component-guidelines.md` 焦点单锚定节追加：整窗替换语义、双数据集与 `onCandlesLoaded` 只喂游标数据集的不变式、回光标锚定的时序守卫、对应的回归用例名

## 验证命令

```bash
npx tsc --noEmit
npx vitest run tests/app-free-replay.test.tsx
npx vitest run            # 全量
```

## 审查关卡

- **G1（步骤 1 后）**：纯改名/分离，全量测试必须仍绿 —— 若此处有行为变化说明分离做错了
- **G2（步骤 3–4 后）**：手工核对「点单 → 图上无跨空洞缝」「点单 → 下一根 → 回光标有数据」两条；这是本任务的核心缺陷是否真被消除
- **G3（提交前）**：全量测试 + tsc；检查 `git diff` 里没有任何 `mergeCandles(` 把两个独立窗口拼起来的调用

## 回滚点

- 单一提交粒度：`FreeReplayChart` 的数据集改造 + 测试一起提交；spec 单独一个 docs 提交
- 若 G2 不过：先只回滚步骤 3–4（焦点 effect），保留步骤 1–2 的数据集分离与 `publishToApp` 收敛（它们本身无害且必要）
