# Trellis 项目清理与研究数据 git 治理

## Goal

审计发现 Trellis 体系有 6 类卫生问题：归档任务的研究原始数据被提交进 git（约 10MB 且持续增长）、一个无 task.json 的孤儿任务目录、失效的 session 指针、根目录临时文件堆积、workspace 主索引过期、平台目录与 `.pi/` 去向未定。本任务一次性清理并建立防止复发的规则。

## Requirements

### R1 研究数据 git 治理（核心）

- `.gitignore` 增加规则，阻挡任务 research 下的可再生数据：`**/research/pool/`、`**/research/out/`（覆盖 `.trellis/tasks/` 含 archive）。
- 已在 git 索引中的此类文件用 `git rm -r --cached` 移出索引；**不 rewrite 历史**，历史里的保留。
- 处理后 `git ls-files .trellis/tasks` 不再匹配任何 `research/pool/` 或 `research/out/` 路径。

### R2 孤儿任务目录处理

- `.trellis/tasks/10-18-box-brace-squeeze/` 只有 `research/`（findings.md、标注数据、脚本、replay-charts.html），没有 `task.json` / `prd.md`，`task.py list` 不可见。
- 为它补一份最小 `task.json` + `prd.md`（注明这是 research-only 工作的补救归档），然后用 `task.py archive` 正常归档，让机制记录状态；若 archive 拒绝则手动移入 `archive/2026-10/` 并说明。
- 归档后 `.trellis/tasks/` 下只剩本任务目录。

### R3 失效 session 指针

- `.trellis/.runtime/sessions/dsh_session-*.json` 指向已归档的 `10-19-fakeout-retest-quality`，删除该失效 session 文件（`.runtime/` 已 gitignore，纯本地操作）。

### R4 根目录与备份清理

- 删除：`_tmp_session13877.jsonl`、`_tmp_session13877.zstd`、`.trellis/.backup-2026-09-07T01-46-30/`（1.3MB，9 月 update 备份）。
- 删除平台迁移残留：`.codebuddy.local.bak/`、`.gitattributes.local.bak`、`.codex/hooks/inject-subagent-context.py.local.bak`。
- `tools.zip` 的删除（`D` 状态）随本次工作一起 commit 落定。
- `annotations-34.json`：已确认是 34 条**人工画线标注**（inst/markDate/quote/verdict），不可再生，不删。默认挪入 `.scratch/` 暂存，用户指定归属后再定。

### R5 Workspace 主索引修复

- `.trellis/workspace/index.md` 的 Active Developers 表更新为实际三位开发者（Fuzz、UsherFall、fupan）及各自最后活跃时间/session 数。

### R6 平台目录与 `.pi/` 去向

- `.pi/`（pi 平台生成物）当前未追踪未忽略：提交进 git（含 settings/prompts/agents/extensions），保证换机器可复现。
- `.trellis/.template-hashes.json` 的未提交修改随本次提交落定。
- 平台精简（`.claude`/`.codex`/`.codebuddy` 是否移除）：默认**不动**，仅记录现状；用户明确要求再删。

## R7 data/ 冗余文件清理

`data/` 已全部 gitignore，纯磁盘清理，不动任何现役文件：

- 删除 `review (1).sqlite` 及 `-shm`/`-wal`（7-13 旧快照，仅 53 条 review，无代码引用）。
- 删除 `review.bak-20260920.sqlite`（23MB，过期一个月的手动备份）。
- 删除 `vite-free-replay.out/err.log` 及两个 `(1)` 副本（7-13 陈旧日志）。
- 保留不碰：`review.sqlite*`（现役，含 24MB 未 checkpoint WAL）、`labeling.sqlite*`（在用标注库）、`bitget-keys.json`（现役密钥）。

## Non-goals

- 不 rewrite git 历史（不 git filter-repo / rebase）。
- 不改 `.trellis/workflow.md` 等 Trellis 生成文件的内容。
- 不改 spec/ 现有文档结构、不动 CONTEXT.md。
- 不关闭 `session_auto_commit`（维持现状）。
- 不触碰 `src/`、`tests/`、`.scratch/`。

## Acceptance Criteria

- [ ] `git ls-files .trellis/tasks | grep -E "research/(pool|out)/"` 无输出；`.gitignore` 含对应规则。
- [ ] `python3 ./.trellis/scripts/task.py list` 无异常，`.trellis/tasks/` 下除 archive 外只有 `10-26-trellis-repo-hygiene`。
- [ ] `.trellis/.runtime/sessions/` 下无指向已归档任务的 session 文件。
- [ ] 根目录无 `_tmp_session*`、`*.local.bak`、`.codebuddy.local.bak/`；`.trellis/` 下无 `.backup-*`。
- [ ] `.trellis/workspace/index.md` Active Developers 表列出三位开发者。
- [ ] `.pi/` 已提交进 git。
- [ ] `data/` 中无 `review (1).sqlite*`、`review.bak-*.sqlite`、`vite-free-replay.*.log`；现役三个文件原样保留。
- [ ] 最终 `git status` 干净（除本任务自身规划文件的后续提交）。

## Notes

- 本任务为轻量任务，PRD-only，无需 design.md / implement.md。
- 本任务不碰任何业务代码，不需要 spec 层上下文，`task.py start --allow-empty-context` 是有意的。
- 清理动作多为删除，执行前先列清单给用户确认再动手。
