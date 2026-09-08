# Implement：个人交割单复盘增强

实现顺序建议 R3 → R1 → R2（R3 独立先行便于回归隔离；R1/R2 各自单提交）。每个 R 一个提交，风险点见各步。

## 前置校验
- [ ] `git status` 干净基线（或记录当前 dirty 文件，避免误并入）；`npm test` 跑一遍确认当前全绿基线。
- [ ] 读取 `tests/bitget-import.test.ts`、`tests/app-bitget-mode.test.tsx`、`tests/app-tag-management.test.tsx` 现有断言，标注会被本任务改动的用例。

## Step A（R3）data 路径锚定
1. 新增 `src/server/data-root.ts`：`resolveDataPath(...segments)` 用 `import.meta.url` 向上定位 `<root>/data`。
2. 改 `src/server/app-plugin.ts`：`path.resolve('data')` 与各 `path.resolve('data/review.sqlite')` 全部改用 `resolveDataPath(...)`。
3. 改 `src/server/bitget-keys.ts`：`DEFAULT_KEYS_PATH = resolveDataPath('bitget-keys.json')`。
4. 新增 `tests/data-root.test.ts`：临时 `process.chdir` 到系统临时目录（finally 恢复 cwd）断言路径仍指向项目根的 `data/`。
5. 校验：`npx tsc --noEmit`；`npm test`（data-root 相关）。
6. 手工：项目根 `npm run dev` 起服 → `/api/bitget/config` 仍 `configured:true`、`/api/bitget/trades` 仍有单。

## Step B（R1）名义价值显示
1. `src/server/bitget-import.ts`：`turnover: entryPrice * size`（替代 null）。同步注释（说明=开仓名义价值，Bitget 可算）。
2. `src/ui/App.tsx`：新增 `positionMoneyLabel(trade)` helper（margin!==null → `杠杆 … · 保证金 …`；否则 `名义价值 {formatUsdtAmount(turnover)}`）；行 `:707` 用其替换杠杆+保证金段。
3. 测试：`tests/bitget-import.test.ts` 补 turnover 断言；`tests/app-bitget-mode.test.tsx` 断言行含「名义价值」且不再含「保证金 —」（若现有断言含 "保证金" 需同步）；跑 trade 模式 UI 测试确认 xlsx 行文案不变（app-tag-management 等若断言行内「保证金」字样需保持通过）。
4. 校验：`npx tsc --noEmit`；`npm test`。

## Step C（R2）标签按模块隔离
1. app-plugin.ts：抽纯函数 `scopedTagPayload(reviews, universeIds)`（或同功能 domain 纯函数 + 测试文件）。返回 `{tags, tagCounts}`。
   - `/api/trades`：universeIds = 全部 xlsx trades id。
   - `/api/bitget/trades`：universeIds = 映射成功的全部 Trade id。
   - 两个路由的 `tags/tagCounts` 改用 scoped 结果；`trades/instruments` 不动。
2. `src/ui/App.tsx` `mutateTag`：成功分支移除 `tags/tagCounts` 本地覆盖，保留过滤器迁移；末尾调用 `requestTradeRefresh()`（并确认 response 不需要再 json 消费——成功即可返回）。
3. 测试：
   - 新增 scoped 纯函数单测（两模块 id 集合 + 交叉 review 数据）。
   - `tests/app-tag-management.test.tsx`：核对现有用例是否依赖全局计数；若依赖则改为模块口径语义后保持绿。
   - `tests/app-bitget-mode.test.tsx`：如覆盖标签计数则同步断言模块口径。
4. 校验：`npx tsc --noEmit`；`npm test`；手工 dev 双模块打同一标签验证两侧计数独立、改名后两边引用同步。

## Review Gate（每步后）
- 每 Step 完成即 `npm test`（目标 + 相关回归文件）+ `tsc`；git 独立提交（如 Step A 出问题直接 revert）。
- 全部完成后跑全量 `npm test` + `tsc --noEmit`，浏览器手工回归：trade 模式（xlsx）行为与文案不变；bitget 模式行/标签符合预期。

## Spec 同步（Phase 3）
- `.trellis/spec/` 中 trade-and-review-model / persistence-and-imports / api-plugin 相关章节若描述了 tagCounts 全库口径或 data 路径约定需同步。
- `CONTEXT.md` 若受 tagCounts 语义影响同步措辞（Review Tag 共享语义仍成立，仅计数按模块）。
