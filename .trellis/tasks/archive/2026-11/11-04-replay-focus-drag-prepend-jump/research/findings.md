# Findings: 回溯复盘焦点单拖动乱飘 —— LWC 拖动快照撤销追加补偿（11-04）

## 复现方法

- `research/harness.html`：复刻 `src/ui/App.tsx` `chartDataWithWhitespace` 的数据形状（真实蜡烛 + 两侧 200 根 whitespace + 去重排序），用 standalone LWC 5.2.0 跑五个场景。
- `research/run-harness.mjs`：本地 HTTP 服务（同源）+ headless Edge（`/mnt/c/.../msedge.exe`，WSL 下用 `/mnt/c/nvm4w/nodejs/node.exe` 驱动），结果 POST 回服务打印。
- 关键经验：LWC pane 拖动需要 **mousedown → move×2** 才真正启动滚动（第一次 move 捕获 startScrollingPos，第二次 `startScrollTime` 建立快照并开始平移），场景必须按这个节奏派发。

## 实证数据（logical range，bar=1 根）

| 场景 | before | 追加/前插落地后 | 继续拖 10px 后 | 判定 |
| --- | --- | --- | --- | --- |
| S2 中段视图：拖动进行中追加 150 根 | [100,300] | [100,300]（补偿生效，视口保持） | **[251.8,451.8]，甩 +151.8 根** | ❌ 乱飘根因 |
| S2b 贴边视图（复刻焦点右缘拖动） | [300,500] | [300,500] | **[451.8,651.8]，甩 +151.8 根** | ❌ 同上 |
| S3 拖动进行中前插 150 根 | [190,390] | [340,540]（逻辑+150，时间范围不变） | [338.2,538.2]（纯拖动增量 -1.75 根） | ✅ 安全 |
| S4 拖动进行中补洞（中段插入 150 根） | [300,500] | [300,500] | **[451.8,651.8]，甩 +151.8 根** | ❌ 同样中招 |
| S1 释放后追加（shift=false） | [300,500] | [300,500] | — | ✅ 11/03 修复有效面 |
| S0 释放后追加（shift=true 敏感性对照） | [300,500] | [450,650]（+150） | — | harness 能测到漂移 |
| **S5 修复后（拖动中不 setData，释放后再 setData）** | [300,500] | 不渲染 | **继续拖 10px： [301.8,501.8]（纯拖动 +1.75 根，无甩页）** | ✅ 修复验证 |

S5 完整数字（11/04 修复后重跑，与 S2b 同一起点/同一手势）：

```
before [300,500] → 拖动启动 [300,500] → 继续拖 10px [301.8,501.8]
→ 松手 [301.8,501.8] → 松手后 setData（迟到的追加页）[301.8,501.8]
```

即：拖动中零 setData 时视口只有拖动增量；释放后补上 setData 由 LWC
`_internal_updateTimeScale` 的补偿分支保住时间范围（与 S1 同一条路径）。

## 根因机制（LWC 5.2.0 dev bundle 行号）

1. `_internal_startScroll`（6319）在拖动启动时捕获 `commonTransitionStartState = { rightOffset, ... }`（`_private__saveCommonTransitionsStartState`，6604）。
2. 每次拖动 move：`_internal_scrollTo`（6329）`rightOffset = 快照.rightOffset + (scrollStartPoint - x)/barSpacing` —— **从快照重导出**，不是增量累加。
3. `_internal_updateTimeScale`（7088）对「右侧追加」且 `shiftVisibleRangeOnNewBar:false` 时做补偿 `setRightOffset(rightOffset - compensationShift)`（视口时间范围保持）—— 但**不更新拖动快照**（快照只在 startScroll/startScale 写入、endScroll/endScale 清除，全库仅 6299/6327 写、6611 清）。
4. 于是拖动进行中追加落地：补偿写入 live rightOffset → 下一次 mousemove 从拖动开始时的快照重导出 → **补偿被撤销 → 视口向前甩一整页**（本页 150 根 + 拖动增量）。
5. 前插（earlier 翻页）走 `isLeftBarShiftToLeft=true` 分支，**不动 rightOffset**，快照与 live 一致 → mid-drag 安全（S3 实证）。
6. 中段插入（补洞）首点不变 → 走与追加相同的补偿分支 → 同样中招（S4 实证）。

## 与 FreeReplayChart 现状对号

- **焦点单右缘翻页**（`loadLaterActiveCandles` → `installIntoDataset('focus')` → `publishActive(render:true)` → 渲染 effect `series.setData`）：触发手势正是「指针按住向右缘拖」，页落地必然 mid-drag → 继续拖 → 甩页。**用户报障场景**。
- **中段洞自愈**（`loadWindowCandles` → `installIntoDataset` render:true）：拖动经过洞区同样 mid-drag 落地 → 甩页（游标/焦点态均可能）。
- **非焦点右缘预取**（`shouldPrefetchFutureCandles` 路径）`render:false`，不 setData → 无此问题 —— 这解释了为什么只有「选中单子后」乱飘。
- **earlier 翻页**（左缘）：mid-drag 安全，无需处理。
- 11/03 修复（`shiftVisibleRangeOnNewBar:false` + 揭示边界闸，commit 76c0ddd）的完整边界 = **指针未按下**时有效；spec `component-guidelines.md:193` 的「前插天然保视口」结论正确（S3 实证）。

## 修复方向（已验证）

拖动进行中落地的**追加型安装**（焦点右缘翻页页 + 补洞窗）不得立即 setData；推迟到 pointerup 后（LWC endScroll 已同步清快照）再渲染。释放后渲染由 LWC 补偿保视口（S1 实证）。数据层（属主数据集 ref、loaded 状态、翻页闸、App 游标数据集）照常即时更新，闸门/去重语义不变。

## 验证修复的 harness 场景

修复后重跑 harness 应新增 S5（模拟「推迟渲染」策略）：拖动中追加落地（不 setData）→ 继续拖（视口只平移拖动增量）→ pointerup + setData → 视口保持。预期：afterContinueDrag ≈ afterDragStart + 拖动增量（无 +150 甩页），afterRelease 保持。
