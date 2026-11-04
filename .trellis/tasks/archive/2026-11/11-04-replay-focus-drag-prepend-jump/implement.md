# Implement: 追加型 setData 拖动中落地推迟渲染

## 执行清单（有序）

1. **前置阅读**（trellis-before-dev 已注入 spec 上下文时跳过重复阅读）：
   - `.trellis/spec/frontend/component-guidelines.md` 焦点单锚定节（176-202 行区域）
   - `src/ui/App.tsx` FreeReplayChart（1285-2060 行区域）：`publishActive`/`installIntoDataset`/`loadLaterActiveCandles`/`loadWindowCandles`
   - `research/findings.md`（根因与实证）
7. **【11/04 追加】换单复位剪刀（R7，design.md §6）**：`focusRequest` prop 补 `id`（App 传递处 + 图表 prop 类型）；图表加 `scissorsOrderRef`，复位 effect 改「null 或 id 变化都复位」；同步改 hideAfterFocus 声明注释与 spec「换焦点单不清」表述；新增两例测试（切单复位 + 同单重点击不清，仿 `hides candles after the focused order open point` 的双窗分支 stub —— 焦点窗按 entryTime ISO 分支：单 1 窗 [09:45..10:10]、单 2 开在更晚游标且窗含开仓点之后的蜡烛）。
2. **指针跟踪**：`FreeReplayChart` 加 `pointerDownRef`；chart-wrap 加 `onPointerDown`；useEffect 挂 window `pointerup`/`pointercancel`（含 flush 调用与 `setTimeout(0)` 错峰）；rangeKey 切换/卸载清理 pending。
3. **安装分层**：`installIntoDataset` 增加渲染推迟路径（options.render === 'defer' && pointerDownRef.current）；`loadLaterActiveCandles` 与 `loadWindowCandles` 传 `'defer'`；新增 `flushPendingInstallRender`（渲染 = setRenderedCandles(activeCandlesRef.current)）。数据层/`publishToApp` 语义保持立即。
4. **组件测试**（`tests/app-free-replay.test.tsx`，对照 design.md §5）：
   - 焦点右缘翻页：指针按下期间落地不 `setData`、闸按最新数据层关闭；pointerup 后 flush 渲染追加合并结果。
   - 非拖动对照：无 pointerdown 时照常立即渲染。
   - 补洞路径：同推迟/flush 两面。
   - 既有用例全绿。
5. **harness 复验**：`research/harness.html` 加 S5（defer 策略：拖动中追加不 setData → 继续拖无甩页 → 释放 + setData 视口保持），跑 `run-harness.mjs` 记录数字进 findings.md。
6. **spec 更新**（trellis-update-spec 流程）：`component-guidelines.md` 焦点单锚定节补契约 ——「追加型 setData 不得在拖动进行中发生（LWC 拖动快照会撤销补偿）；焦点右缘翻页与补洞的渲染推迟到 pointerup；前插与释放后追加不受影响（实证）」；修正 11/03 段的适用边界表述。

## 验证命令

```bash
npx vitest run                 # 全量（level-alert-parity 既有环境性失败除外）
cd .trellis/tasks/11-04-replay-focus-drag-prepend-jump/research && /mnt/c/nvm4w/nodejs/node.exe run-harness.mjs   # harness 复验（Windows node）
```

## 风险文件 / 回滚点

- 唯一改动面：`src/ui/App.tsx`（FreeReplayChart 内部状态机 + 两个调用点）。
- 单 commit 交付；回滚 = revert 该 commit（会带回乱飘 bug，需在 revert 信息注明）。

## start 前检查

- [x] prd.md / design.md / implement.md 齐
- [x] 根因实证落 research/findings.md
- [ ] implement.jsonl / check.jsonl 已 curate（spec 条目）
- [ ] 用户批准最终规划摘要 → `task.py start`
