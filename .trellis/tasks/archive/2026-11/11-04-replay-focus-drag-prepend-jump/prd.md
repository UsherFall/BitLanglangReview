# 回溯复盘焦点单拖动左缘翻页视口瞬移修复 → 视口瞬移修复（追加型 setData 在拖动进行中落地）

## Goal

修复回溯复盘选中单子（焦点态）后拖动图表仍乱飘的问题：追加一页 K 线（焦点右缘翻页 / 中段洞自愈）在**拖动进行中** `setData` 落地时，LWC 5.2.0 的拖动快照会撤销其视口补偿，下一次 mousemove 视口向前甩一整页（150 根）。用户拖得越远甩得越多。

## Background（实证确认的事实）

- 根因已用 headless Edge + 独立 harness 实证（`research/findings.md`，数据形状复刻 `chartDataWithWhitespace`）：
  - 拖动进行中追加 150 根：补偿后视口保持，但下一次拖动 move 视口甩 **+151.8 根**（预期 +1.75）。
  - 拖动进行中前插 150 根：视口保持，**安全**（走 `isLeftBarShiftToLeft` 分支不动 rightOffset）。
  - 拖动进行中补洞（中段插入）：与追加同分支，**同样甩 +151.8 根**。
  - 释放后追加：视口保持，11/03 修复（`shiftVisibleRangeOnNewBar:false`）在非拖动场景有效。
- LWC 机制：`_internal_startScroll` 捕获拖动快照 `commonTransitionStartState.rightOffset`（dev bundle 6319/6604）；每次 move `_internal_scrollTo`（6329）从**快照**重导出 rightOffset；`_internal_updateTimeScale`（7088）对追加的补偿 `setRightOffset(-Δ)` **不更新快照** → 补偿被下一次 move 撤销。
- 为何只有「选中单子后」报障：非焦点态右缘是未来预取（`render:false`，无 setData）；焦点态右缘翻页（R4）与补洞自愈都是即时渲染 → mid-drag 必中招。触发翻页的手势本身就是「指针按住拖向边缘」。
- `component-guidelines.md:193`「前插天然保视口」结论正确，保留；其 11/03 段需补充拖动中的洞。

## Requirements

- **R1 焦点态右缘翻页页在拖动进行中落地时不得 `setData`**：安装只更新数据层（属主数据集 ref、`loadedCandles`、翻页闸读到的 active 数据集、App 游标数据集供给），渲染推迟。
- **R2 补洞自愈窗同样推迟渲染**（游标/焦点态一致）。
- **R3 推迟的渲染在拖动结束（pointerup）后 flush**：LWC `endScroll` 同步清快照后渲染，由补偿保视口；数据不丢、顺序不乱。
- **R4 拖动期间闸门/去重语义不变**：追加后 `shouldLoadLaterFocusCandles`（焦点闸）与补洞键照常读最新数据层；连续拖可继续预载下一页。
- **R5 前插（earlier 翻页）行为不变**：mid-drag 安全（实证），继续立即渲染，不引入额外锚定恢复。
- **R6 非拖动场景一切不变**：释放后落地照常立即渲染（S1 语义）；焦点取窗、切周期、回光标、舒适区跟随等既有契约不动。
- **R7（11/04 追加）换焦点单复位「开仓点前」视图**：剪刀（hideAfterFocus）点亮后点击另一笔已完成单子，新单的视图不得继承隐藏态 —— 显示该单揭示内的完整焦点窗口；同单重复点击（token 递增重定位）不清。11/03「换焦点单不清，连续审单」的设计决策由用户报障反转：剪刀是单笔单子的审读工具，非跨单粘性模式。

## Acceptance Criteria

- [ ] harness 实证（`research/harness.html` 重跑）：拖动中追加落地后继续拖，视口只有拖动增量（无 +150 甩页）；pointerup 后渲染视口保持。
- [ ] `tests/app-free-replay.test.tsx`：焦点态指针按下期间右缘翻页页落地不调用 `series.setData`；pointerup 后调用且数据完整（追加合并结果）。
- [ ] `tests/app-free-replay.test.tsx`：补洞窗在指针按下期间落地同样推迟渲染、pointerup 后 flush。
- [ ] `tests/app-free-replay.test.tsx`：非拖动（无指针按下）时右缘翻页照常立即渲染（回归对照）。
- [ ] `tests/app-free-replay.test.tsx`：指针按下期间追加后翻页闸按最新数据层关闭/放行（连续拖可预载多页，无请求风暴回归）。
- [ ] 既有全部测试保持绿（`npx vitest run`，level-alert-parity 环境性缺失除外）。
- [ ]（R7）`tests/app-free-replay.test.tsx`：剪刀点亮后切换单子，新单渲染揭示内的完整窗口且剪刀按钮回到「隐藏…」（aria-pressed false）；同单重复点击剪刀态不清（两例）。

## Out of Scope

- earlier 翻页的锚定恢复（实证安全，不引入）。
- TradeChart（交割单复盘）改动：其 later 加载本就走 pendingRender 推迟 + anchor 恢复，无此缺陷。
- 升级/patch lightweight-charts；向 LWC 上游报告该 mid-drag 快照行为可另行进行，不在本任务。
- 「拖动中暂停请求」类方案（闸语义已正确，不动）。

## Technical Notes

- 改动集中在 `src/ui/App.tsx` 的 `FreeReplayChart`：指针按下跟踪（chart-wrap pointerdown + window pointerup 兜底）、追加型安装的渲染推迟（`publishActive`/`installIntoDataset` 增加渲染推迟路径）、pointerup 后 `setTimeout(0)` flush。
- harness（`research/`）作为根因与修复的实证资产保留在任务目录，随任务归档。
