# dsh-trellis 插件安装与使用

Trellis 工作流集成插件：把 `.trellis` 任务暴露为 DSH 技能 + 可视化看板（DSH 侧边栏面板 + 独立页面）。

## 前置要求

- DSH `0.2.1-rc.2`（`dsh --version` 确认；其他 0.2.x 可能需要版本豁免）
- Node `^22.19.0 || >=24.0.0`，pnpm 可用
- 目标项目有 `.trellis/` 目录（插件向上查找 `.trellis/workflow.md` 定位项目根）

## 安装（三步）

### 1. 拿到插件

整个插件就是一个目录，拷走即可（只需要 `src/`、`tsdown.config.ts`、`tsconfig.json`、`package.json`、`cordis.patch.yml`）：

```powershell
Copy-Item -Recurse <本项目>\tools\dsh-trellis-plugin <目标机任意路径>\dsh-trellis-plugin
```

或者用已构建好的包 `dsh-trellis-0.1.0.tgz`（无需再构建）。

### 2.（tgz 方式可跳过）构建

```powershell
cd dsh-trellis-plugin
pnpm install
pnpm run build
```

### 3. 装进目标机器的 DSH profile

```powershell
# 方式 A：tgz 包（推荐，快照固化）
dsh plugin --profile web add "D:\path\to\dsh-trellis-0.1.0.tgz"

# 方式 B：link 本地目录（改代码后重启即生效，适合继续开发）
dsh plugin --profile web add "link:D:\path\to\dsh-trellis-plugin"
```

安装会自动把 `dsh-trellis` 加进 profile 的 bundles 并写入 `cordis.patch.yml`。**重启 DSH** 生效。

> 若版本不匹配报 incompatible：先试 `dsh plugin --profile web allow-version dsh-trellis@0.1.0 --dsh-version <运行版本> --accept-risk`； peer 依赖是宽松范围（cordis ~4.0.5），大概率直接装上。

## 验证

1. `http://127.0.0.1:3080/plugins/dsh-trellis/tasks` 返回 JSON（有 `tasks` 数组）
2. DSH 侧边栏出现 **Trellis** 图标 → 点开是看板
3. 会话技能目录出现 `trellis-status` / `trellis-board` / `trellis-continue`
4. （可选）独立看板 `http://127.0.0.1:3210`

## 配置

在 profile 的 `cordis.patch.yml` 里给该插件加 config：

```yaml
- id: trellis
  name: dsh-trellis
  config:
    dashboard: true        # 独立 HTTP 看板开关
    dashboardPort: 3210    # 独立看板端口
```

## 注意

- 任务数据**实时读取** `.trellis/tasks/**/task.json`，不依赖 python、不缓存；归档任务（`tasks/archive/**`）也会列出并标记 archived。
- 侧边栏面板的数据来自 DSH 自身 webserver 上的 `/plugins/dsh-trellis/tasks`，无跨端口问题。
- 卸载：DSH 设置 → 插件 → dsh-trellis → Remove（或在 profile `package.json` 删依赖）。
