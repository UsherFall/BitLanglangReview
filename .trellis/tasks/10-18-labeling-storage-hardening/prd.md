# 标注页加固：localStorage 不可用时要能看出来

## Goal

用户在另一台电脑用「拷贝 `out/` + 导入 labels.csv」的方式续标，**选完文件完全没反应、连提示都没弹**。

根因：`save()` 直接调 `localStorage.setItem` 且没有保护。当浏览器在 `file://` 下禁用本地存储时它抛异常，把 `FileReader.onload` 里的 `importCsv` 整段打断——后面的 `render()` 与 `toast()` 都没执行，所以用户看到的就是"毫无反应"。

要修的不只是这个异常，还有**失败不可见**这件事：整页只有 1.6 秒的浮动 toast，一旦中断就连"为什么"都看不到。

## Requirements

- **R1 存储访问全部加固**：`load` / `save` 内部 try/catch；写失败时置 `storageOk = false`，**保留内存态**让当前会话照常可用（标注、导出仍工作）。
- **R2 不可用时必须说**：`storageOk === false` 时页面顶部出现**常驻横幅**，写明"本地存储不可用，进度只存在内存里，刷新会丢——请用导出/导入的 CSV 当记录"。
- **R3 常驻状态行**：页脚加一行状态文本，**不自动消失**；`toast()` 同时写入它。导入/导出的结果（含失败原因）都落在这里，不再只靠浮动提示。
- **R4 已标可见**：页头显示当前这张的既有结论徽标（如 `已标：Y · 就是好`），未标则留空。这样导入是否生效**一眼可验**，不必靠计数猜。
- **R5 导入失败要分类型报**：读文件失败 / 不是 labels.csv / anchor 不匹配（**报出两边 anchor**）/ 导入 0 条 —— 每种都写进状态行。
- **R6 边界**：不改 `src/`；不改导出 CSV 的字段与顺序；不动采样与快照。

## Acceptance Criteria

- [ ] AC1 模拟 `localStorage` 抛异常（jsdom 里替换为会 throw 的 stub）：页面照常渲染、照常能标、导出内容正确；顶部横幅出现且文案明确。
- [ ] AC2 同样环境下**导入不中断**：标签进入内存、徽标与"已标"数更新，状态行写明"保存失败，仅本次会话有效"。
- [ ] AC3 状态行常驻：执行导入后不因超时消失（对比 toast 会淡出）。
- [ ] AC4 正常环境（存储可用）行为不变：导入后标签落 localStorage、刷新仍在。
- [ ] AC5 anchor 不匹配时状态行报出**两边的 anchor 值**。
- [ ] AC6 `npx tsc --noEmit` 与 `npm test` 全绿；`git status -- src/` 为空；内联 JS 通过 `node --check`。

## Notes

- 轻量任务，PRD 即计划。
- 用户侧修复动作：`git pull` → `npm run label:page`（`out/` 里已有 candidates/candles，**不需要联网**）→ 重开页面。
