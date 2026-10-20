# 执行计划

## 已完成（研究层）

- [x] 拉 2026-10-20 最新 1D 池（443 个加密币，isRwa 剔除）——`research/fetch-pool.mjs`
- [x] 批平上一轮 38 段标注为 `research/labels.json`
- [x] 粗筛 v1（现在正在拉升里）→ 35% 币日命中，否决
- [x] 粗筛 v2（拉升→横住）多参数扫描 → 与随机不可分，否决
- [x] 粗筛 v3（拉升≥30% & ≥4天 & 回吐≤60%）→ 85 个候选
- [x] 第 3 步回放：31 段 170 个币日，算出涨跌幅 + 距上方最近线
- [x] 距离口径交叉验证（8.11% vs 9.02% vs 8.11%）

## 待办

### A. 口径固化（本轮）
- [x] A1 粗筛 v3 常量集中在 `build-tape.mjs` 顶部并注释
- [x] A2 `--as-of=YYYY-MM-DD` 参数支持回放任意一天
- [x] A3 输出 `out/list-<date>.md` + `out/list-<date>.html`（可视化名单页）

### B. 交给用户看一眼（验收）
- [x] B1 生成 85 个候选的可视化页（前 60 个，按离拉升顶排序）
- [ ] B2 **等用户看图后确认**：候选数量偏多 / 偏少 / 漏了谁
- [ ] B3 用户在新页面标线后，跑第 3 步确认两个数字读起来对

### C. 产品化（另开任务，本任务不做）
- [ ] C1 扫描列表页：币 / 最新价 / 今日涨跌 / 距用户线 / 拉升区间
- [ ] C2 画线保留在 instrument 上，跨天复用
- [ ] C3 粗筛结果并入现有 `coin-scan` 流程前，先确认与旧字段的取舍

## 验证命令

```bash
node .trellis/tasks/10-20-anomaly-level-tracker/research/fetch-pool.mjs
node .trellis/tasks/10-20-anomaly-level-tracker/research/build-tape.mjs
node .trellis/tasks/10-20-anomaly-level-tracker/research/diag-levels.mjs
```

## 回滚点

- 全部改动都在 `.trellis/tasks/10-20-anomaly-level-tracker/` 下，**不碰 `src/`**；删除该目录即回滚。
- 上一轮研究目录只读引用，不改动。
