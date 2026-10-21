# 执行计划

## 已完成

### 新增
- [x] `src/domain/level-alert.ts` —— 距线警报的纯算术（尺子 / 距离 / 三档判定）
- [x] `src/server/drawing-store.ts` 加 `listDrawingsByTimeframe(timeframe)`
- [x] `tests/level-alert.test.ts` —— 19 个单元测试
- [x] `tests/level-alert-parity.test.ts` —— AC4：两条独立路径逐段比对

### 删除收敛
- [x] `src/domain/coin-scan.ts` —— 删掉全部收敛类型/常量/函数，`ScanRow` 换成 `levelAlerts`/`alertTimeframes`
- [x] `src/server/coin-scan-service.ts` —— 第二阶段改为按线取数，排序改为「离你标的线最近」
- [x] `src/ui/CoinScanPanel.tsx` —— 「收敛结构」「强度分」两列 → 「距你标的线」一列；删掉「结构强度阈值」输入框
- [x] `src/ui/coin-scan-rows.ts` / `src/domain/box-brace.ts` —— 更新过时注释
- [x] `src/server/app-plugin.ts` —— 注入 drawingStore，删 `minScore` 参数
- [x] `src/ui/styles.css` —— 距线列样式
- [x] `tests/coin-scan.test.ts` —— 整个删除（全收敛用例）
- [x] 其余 coin-scan 测试按新行为重写

### 口径修正（实现中发现）
- [x] 尺子与距离统一到**判定日**（最后一根已收盘）
- [x] 尺子加**样本下限**（射线起点后 <30 根时退回最近 60 根）——修掉 BTC 的误报
- [x] 射线端点字段名 `time` / `t` 都认（否则静默 NaN）
- [x] 同步修 `10-20-anomaly-level-tracker/research/alert.mjs` 的同样三个问题

## 验证结果

- `npx tsc --noEmit` —— src/tests **0 错误**（`tools/dsh-trellis-plugin` 的 49 个是既有问题，与本次无关）
- `npx vitest run` —— **71 文件 / 533 测试全过**
- AC1 grep 全库核查 —— 11 个收敛符号只剩 `ScanResponse.qualifiedCount`（= 行数，与收敛无关，保留）

## 待办

- [x] 选品页加「画线」入口（`48e8885`）——点一下在选品模块内弹出画线浮层，定位到该币，可切周期
- [x] 顺手改掉两处过时文案：方法下拉「收敛结构」→「距你标的线」，说明文字重写
- [ ] 用户在实际使用中确认「距你标的线」列与画线浮层的显示效果
- [ ] 更新 `.trellis/spec/` 里 coin-scan 相关 spec（如果 spec 覆盖到被删的收敛契约）
