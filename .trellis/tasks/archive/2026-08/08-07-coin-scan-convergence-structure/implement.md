# Implement: 收敛结构检测(三角/低波动箱体)

## 执行顺序(ordered)

### 阶段 1:domain 算法(src/domain/coin-scan.ts)

1. **类型层**:加 `ConvergenceStructure`、`StructureResult`、新 `ScanRow`/`ScanResponse`/`ShrinkScanParams`。删旧 `QuietMetrics`/`PlateauResult`/`PlateauWindow`/`QuietMetricsParams`/`PlateauParams` 及相关常量(`DEFAULT_MAX_COMPRESSION` 等)。保留 `scanTimeframes`。
2. **`detectSwings(candles, n)`**:升序排序 → 单 N fractal 高低点 → 相邻同向去重 → 不足 4 点返回空。纯函数。
3. **`classifyStructure(swings, params)`**:分列 highs/lows → 箱体/三角判定 → 触碰计数 → 返回 `StructureResult | null`。纯函数。
4. **`probeStructure(candles, params)`**:组合入口,候选 N = [2,3,4,5,6,8,10,12] 全试,选最规整(有结构 > 触碰多 > swing 对数多 > score 强)。
5. 用真数据校准初始常量(斜率容差、触碰门槛、候选 N 集合)。

### 阶段 2:服务层(src/server/coin-scan-service.ts)

6. `scanShrink` 改为调 `computeStructure`;取数窗口改 `perTimeframeLimit(timeframe)`(不再固定 13)。
7. 每周期 `StructureResult` → 装配 `ScanRow`;过滤 `qualifiedCount >= 1`;排序 `qualifiedCount desc → bestScore desc`。
8. 参数:`minScore` 并入,echo 到 params。

### 阶段 3:API(src/server/app-plugin.ts)

9. `/api/scan` 参数解析:删 `plateauMin/maxCompression/maxLatestTrend/trendWindow`,加 `minScore`(可选,默认 0)。校验 minScore >= 0。

### 阶段 4:UI(src/ui/CoinScanPanel.tsx)

10. 参数面板极简:扫描数量、最低成交额、扫描时间点、结构强度阈值(minScore)。
11. 结果表列改:币、最新价、24h 涨跌、成交额、结构类型(周期映射)、位置、强度分、操作。详情行展示各周期结构。

### 阶段 5:测试

12. 纯函数单测:`detectSwings`(已知箱体/三角形态)、`classifyStructure`(箱体/三角/下跌中继/噪声)。
13. 改写 `tests/coin-scan-service.test.ts`:构造真实箱体/三角 K 线,验证装配、排序、宁少勿滥。

### 阶段 6:收尾

14. `npm test` 全绿 + `tsc` 干净。
15. 实盘扫描对照:确认能扫出肉眼可见的三角/箱体。

## 验证命令

```bash
npm test
npx tsc --noEmit
```

## 风险文件 / 回滚点

- `src/domain/coin-scan.ts` — 核心算法,最大变更。回滚点:恢复旧算法(阶段 1 前)。
- `tests/coin-scan-service.test.ts` — 测试大改。回滚点:阶段 5 前。
- `src/server/app-plugin.ts` + `CoinScanPanel.tsx` — 契约/UI 变更。回滚点:阶段 3/4 前。

## 后续检查(before task.py start)

- [ ] 用户确认设计(design.md)。
- [ ] jsonl 清单补齐(implement.jsonl/check.jsonl 至少各一条真实 spec 条目)。
- [ ] 阶段 1 常量先用真数据跑通,再定稿。
