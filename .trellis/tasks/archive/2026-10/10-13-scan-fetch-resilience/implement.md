# Implement — 选品扫描取数容错

依赖：Phase 1 评审通过 + `task.py start`。改动 4 个源文件 + 2 个测试文件。

## 执行清单（按序）

1. **域类型** — `src/domain/coin-scan.ts`：`ScanResponse` 增加
   `failedInstruments?: string[]`，注释对齐 `skippedInstruments` 的写法（说明"因取数失败被跳过的标的"，
   并点明它与休市跳过、限频 warnings 是三条不同通道）。
   验证：`npx tsc --noEmit` 仍绿（纯加法）。

2. **服务层隔离** — `src/server/coin-scan-service.ts`：
   - `scanShrink` 内新增 `const failed = new Set<string>()`（在 `skippedInstruments` 附近）。
   - Stage 1 的 `mapLimit` mapper 包 try/catch：fatal 重抛，否则 `failed.add(instrument)` 并返回
     `{ ticker, completed: null }`；`measures` 映射改为 `completed === null ? null : coarseStructure(...)`。
   - Stage 2 的 `mapLimit` mapper 包 try/catch：fatal 重抛，否则 `failed.add(instrument)`。
   - 构造行时 `if (!passes[index] || failed.has(ticker.instrument)) continue;`。
   - 响应组装处：`if (failed.size > 0) response.failedInstruments = [...failed];`。
   - 构造器注入类型放宽为 `Pick<RateGate, 'takeWarnings' | 'reason'>`；新增私有/模块级
     `isFatalScanError(gate)`（`gate?.reason() === '418'`）——catch 里调它。注释写明"418 = IP 被封，
     继续发请求只会延长封禁，因此整体中止；429/超时/网络错误按标的隔离"。
   - `mapLimit` 泛型要允许 `null`（Stage 1 的返回类型变为 `{ ticker; completed: Candlestick[] | null }`）。
   验证：`npx tsc --noEmit`。

3. **UI 提示** — `src/ui/CoinScanPanel.tsx` 的 `CoinScanResults` 头部（`skippedInstruments` 提示之后）：
   新增 `failedInstruments` 非空时的 `<p className="coin-scan-skip-hint" title={...}>` 一行，
   文案与既有「已跳过 N 个休市标的」同构，标的名用 `formatSkippedNames` 折叠。
   验证：不动 grid 结构（`.detail-header` 仍是 2 个顶层子元素之一）。

4. **测试** — `tests/coin-scan-service.test.ts`：
   - 夹具：让 `Source.getCandlesticks` 可按 (instrument, timeframe) 抛错（在既有 `buildSource` 之上加一个
     薄包装或按需的 `throwingSource`，不重写夹具）。
   - `serviceFrom` / 既有 `{ takeWarnings }` 假 gate 注入处补 `reason: () => null`（类型放宽后的编译需要）。
   - 新增用例：AC1 / AC2 / AC3 / AC4（见 prd「Acceptance Criteria」）。
5. **测试** — `tests/coin-scan-results.test.tsx`：AC5（头部提示存在、含数量与标的名、仍在 `.detail-header` 内）。
   验证：`npm test`。

## 验证命令

```bash
npx tsc --noEmit
npm test -- coin-scan-service coin-scan-results
npm test                      # 全量，作为 finish 前门禁
```

## 评审门

- 改动 review 前先自查 AC1–AC7；AC3 必须有独立用例（418 语义是本任务唯一"反直觉"的分支，
  只靠阅读不足以证明没被 catch 吞掉）。
- AC1 的断言要求"与对照运行一致"，不只是"没抛错"——防止把隔离实现成"整池淘汰但仍返回 200"。

## 回滚点

- 每个文件独立可回滚；若第 2 步的类型放宽引起连锁编译问题，可退回"从 `http.ts` 导出类型化
  `IpBanError`"的备选方案（design §2 备选）。

## 收尾

- 更新 `.trellis/spec/server/coin-scan.md`：`ScanResponse` 契约加 `failedInstruments`、
  服务聚合伪码加 try/catch 与 418 分支、错误矩阵加一行（"单标的取数失败 → 跳过并回报，不失败整轮"）。
- 提交时只 stage 本任务涉及的 6 个文件；仓库里有 3 个未跟踪的 `*.local.bak/` 脏路径，**不要**扫进去。
