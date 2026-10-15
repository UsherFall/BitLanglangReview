# Implement — 收敛标注工作台

## 执行清单

### 0. 基建（一行级改动）
- [ ] `npm i -D tsx`，并确认 `npx tsx --version` 可跑。
- [ ] `package.json` 增加脚本：`"label:sample": "tsx tools/labeling/sample.ts"`、`"label:page": "tsx tools/labeling/build-page.ts"`。
- [ ] `tsconfig.json` 的 `include` 追加 `"tools"`。
- [ ] `.gitignore` 增加 `tools/labeling/out/`。

### 1. `tools/labeling/sample.ts`
- [ ] 组装 `BitgetTickerSource(undefined, bitgetInstrumentMetadata())` 与 `BitgetCandleSource(new CandlestickStore(resolveDataPath('labeling.sqlite')))`，db 与 review 库隔离。
- [ ] 池过滤：成交额下限（`defaultScanParams('bitget','crypto')`）→ `isScannable` → `scanScopeOf === 'crypto'` → `isMarketOpen(ticker.marketClass ?? 'CRYPTO', anchor)`。**逐行照抄 `coin-scan-service.ts:109-118` 的顺序。**
- [ ] 抓 1D：`limit: scanWindowFor(class)`（gated 类 200，其余 100），剔 `timestamp + timeframeMs('1D') > anchor` 的 bar。
- [ ] 落盘 `out/candles.json`；无 `--refresh` 且缓存存在时直接复用。
- [ ] 逐只 `coarseStructure` → 一次性 `coarseScreen` 得 `passes`；逐只 `probeStructure` 得 `score/qualified`。
- [ ] 分类 + 抽样（`合格`全量 / `边界` score≥0.35 取前 30 / `拒绝` 种子随机 30），写 `out/candidates.json` + `out/candidates.csv`。
- [ ] CLI 参数：`--anchor <ms>`、`--refresh`、`--band-min`、`--band`、`--reject`、`--seed`。
- [ ] 单只抓取失败按 `failedInstruments` 语义跳过（不中断整轮），并在候选里记为 `coarse: null`。

### 2. `tools/labeling/build-page.ts`
- [ ] 读 `out/candidates.json` + `out/candles.json`；拷贝 `lightweight-charts.standalone.production.js` 到 `out/`。
- [ ] 生成 `out/label.html`：数据内联为 `<script type="application/json" id="candidates">`。
- [ ] 页面逻辑：一次一张大图、`Y/N/?` 前进、`←` 回退、`S` 切换 score、理由下拉（含自由文本）、进度条。
- [ ] `localStorage`（键含 `anchor`）保存进度；导出按钮生成 `labels.csv`。
- [ ] 无外部网络依赖（图表库为本地文件）。

### 3. `tools/labeling/label-rubric.md`
- [ ] 骨架：三句判定口径（占位）+ 教具卡位（3 好 / 3 差 / 2 边界，留图位）+ 理由标签表（位置太高 / 上沿斜 / 时间太短 / 波动没缩 / 就是好 / 其他）。

## 验证

```bash
npx tsc --noEmit                  # AC7：tools/ 纳入检查
npm test                          # AC7：现有测试全绿
npm run label:sample              # 首次：拉数 + 落盘 + 抽候选
npm run label:sample              # 二次：复用缓存，输出应与首次逐行一致（AC1）
npm run label:page                # 生成 out/label.html
```

手动核对：
- [ ] AC1 `out/candidates.csv` 两次运行 diff 为空。
- [ ] AC2 三类齐全；`bucket=qualified` 的行数 == `passCoarse=true` 的行数。
- [ ] AC3 断网后 `file://` 打开 `out/label.html`，出图正常。
- [ ] AC4 连按 `Y/N/?` 与回退正常；导出 CSV 字段与 design §7 一致。
- [ ] AC5 标 5 张后关页面重开，进度保留。
- [ ] AC8 `git status` 中 `src/` 无任何改动。

## Review gates

- **Gate A（写页面之前）**：`sample.ts` 跑通，`candidates.csv` 的三类配比与特征列符合 PRD R1.3/R1.4。此处若配比或权重不对，先回 PRD 调参数，再继续。
- **Gate B（收尾之前）**：AC1–AC8 全绿；特别是 AC8（不得触碰 `src/`）。

## 回滚点

- 基建改完即可跑 → 若 `tsx` 路线不通（安装失败/解析异常），回滚 `package.json` / `tsconfig.json`，改评估 `vite.ssrLoadModule` runner 或 `vitest` 承载，重开本步骤。
- 每次 `sample.ts` 重跑前可删 `out/`（唯一副作用目录）；`tools/` 未提交前任何改动都可整目录丢弃。

## Spec 更新（finish 阶段 3.3）

- 预计**不新增** `src/` 相关 spec（工具不属运行时）。
- 如最终落地了"标注产物路径 / 快照格式"这类长期约定，在 `.trellis/spec/` 下开一份最小说明；否则在任务归档里记录即可。
