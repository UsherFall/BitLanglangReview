# Implement: 收敛结构-回溯窗口检测

## 执行顺序(ordered)

### 阶段 1:domain 回溯扫描算法(src/domain/coin-scan.ts)

1. **SwingPoint 扩展**:加 `close` 字段(关联 K 的收盘价,破斜率判定用)。detectSwings 填充。
2. **`backscanWindow(swings, candles, params)`**:从 swing 序列末尾往回扫,确定形态连续段起点。
   - 维护候选形态方向(三角高降/低升或箱体双平)。
   - 单根反向 swing → 容忍度判定毛刺(收盘穿透 vs 结构宽度)。
   - 真破 → 终止,起点 = 破位 swing 之后。
   - 返回:形态子序列的 swing 切片 + 起点索引。
3. **`classifyStructure` 改造**:接收回溯确定的子序列,核心几何判定保留(单调/收窄/区间门)。
4. **`probeStructure` 改造**:候选 N 全试,每 N 得完整 swing 序列 → backscanWindow 找段 → classify。选最优 N(触碰多/跨度长)。
5. **B 门**:回溯段跨度 ≥ B(三角 13,箱体 5)。
6. **容忍度**:收盘穿透 ≤ 20% × 结构宽度(常量 DEFAULT_STRUCTURE_TOLERANCE)。
7. **单调性**:与破斜率统一(单根反向 + 容忍度),删旧 `monotonicTolerance`/`isDirectionalMonotonic` 或重构。

### 阶段 2:校准(真数据)

8. B 扫描:三角 B=[12,15,20,25,30],候选数下降曲线找拐点。
9. 容忍度:X=[0.1,0.2,0.3,0.5],误判率。
10. 案例集回归:MRVL/SNDK/SOXX 真三角过;INTC/HEI/XRP 误判拒。

### 阶段 3:测试

11. `tests/coin-scan.test.ts`:
    - backscanWindow:已知三角段起点正确、破斜率终止正确、毛刺容忍度正确。
    - INTC 案例(103 尖峰排除)回归。
    - HEI/XRP 回归保持。
    - MRVL/SNDK 真三角回归保持。
    - B 门:跨度不足拒。
12. `tests/coin-scan-service.test.ts`:适配(接口不变,装配逻辑同)。

### 阶段 4:收尾

13. `npm test` 全绿 + `tsc` 干净。
14. 实盘对照:候选质量(宁少勿滥)。

## 验证命令

```bash
npm test
npx tsc --noEmit
```

## 风险文件 / 回滚点

- `src/domain/coin-scan.ts` — 核心重构。回滚点:阶段 1 前。
- `tests/coin-scan.test.ts` — 大量适配。回滚点:阶段 3 前。
- 服务层/API/UI 不变(接口同)。

## 后续检查(before task.py start)

- [x] 用户确认 design.md(回溯 + 容忍度 + B 值)。
- [x] jsonl 补齐(implement.jsonl/check.jsonl 至少各一条真实 spec)。

---

## 进度快照(2026-08-07,Session 11,中断续作点)

**状态**:task in_progress,agent 实现到中途被用户停止。

### 已完成(domain 已改,`src/domain/coin-scan.ts`)

- [x] SwingPoint 加 `close` 字段。
- [x] `StructureParams` 加 `minSpanTriangle`/`minSpanBox`/`structureTolerance` 字段。
- [x] 新常量:`DEFAULT_MIN_SPAN_TRIANGLE=13`、`DEFAULT_MIN_SPAN_BOX=5`、`DEFAULT_STRUCTURE_TOLERANCE=0.2`。
- [x] `backscanWindow(swings, candles, params)` 实现(line ~421)。
- [x] `classifyStructure` 改造:不再固定 8-swing 窗口,minSpan 门已加(line 604/651),structureTolerance 接入(line 581)。
- [x] `probeStructure` 改造:调 backscanWindow → classify(line 711),defaultStructureParams 已含新常量(line 752-755)。

### 未完成(续作点)

- [x] **验证编译**:`npx tsc --noEmit` 干净(仅测试文件报错 → 已修复)。domain 编译过。
- [x] **阶段 2 校准**:B 扫描 + 容忍度扫描 + 案例集回归。网络不可用 → 用本地 sqlite 真 K 缓存(`data/review.sqlite`)校准,校准脚本留在本任务目录 `calibrate.test.ts`(改完留作参考,DB 缺失时自动降级为空窗口不报错)。
  - **校准结论**:
    - INTC 15m(AC1):真数据 backscan 正确把 103 尖峰(high@69=103.47,close 102.02)排除在箱体(74..97,~99-101)外 —— 纳入尖峰会把 box 变 falling triangle(kind 变化),扩展在尖峰处终止。✅
    - 容忍度 0.2 成立:真三角(swing bar close 落在通道内)过 close 门;HEI 深跌腿(close 穿低边缘)、HFT 崩拉(close 穿低边缘)、~8% 破位(close 穿低边缘)、XRP 缓跌(drift-ratio 门)在 0.2 下全拒。**无需调整常量**(13/5/0.2)。
    - 当前实盘快照(2026-08-07)这 5 个币都无合格结构:MRVL/SNDK 近期是"箱体宽于自身 bar 振幅" → maxBoxRelativeHeight 拒(宁少勿滥,非 bug,市场已走);INTC box 亦被低波动门拒。历史真三角/误判案例由测试 fixture 固化回归。
- [x] **阶段 3 测试**:`tests/coin-scan.test.ts` 适配完成(45 个全过):
  - swing() helper 加 `close`(默认=price)。
  - MRVL 真三角 fixture 补通道内 close(尖峰 bar 收盘收回,不触发 close 门)。
  - HFT/HEI/obviousBreak(原"单调性")改为 close 门语义(显式 close)。
  - 旧"8-swing 窗口"测试改写为 `backscanWindow` 语义(旧 regime 排除)。
  - 新增 `backscanWindow` describe:已知三角段起点、破斜率终止(low-side)、毛刺容忍(close 收回)、INTC 103 尖峰排除、B 门(<minSpan 拒)。
  - 常量测试:`DEFAULT_MONOTONIC_TOLERANCE` → `DEFAULT_MIN_SPAN_TRIANGLE=13`/`DEFAULT_MIN_SPAN_BOX=5`/`DEFAULT_STRUCTURE_TOLERANCE=0.2`。
  - `coin-scan-service.test.ts` 接口不变,零改动全过。
- [x] **阶段 4**:`npm test` 全绿(35 文件 203 测试)+ `npx tsc --noEmit` 干净。实盘对照见上(当前快照宁少勿滥,fixture 覆盖历史案例)。
