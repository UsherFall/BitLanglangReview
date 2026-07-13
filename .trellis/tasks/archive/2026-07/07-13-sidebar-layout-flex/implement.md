# 侧边栏布局灵活化改造 — 执行计划

## 前置条件

- [ ] `task.py start` 执行

## 实施步骤

### Step 1: styles.css — 新增样式
- [ ] 添加 `.resize-handle` 样式（4px 宽，col-resize cursor，hover 高亮，active 时变色）
- [ ] 添加 `.sidebar-collapsed` 样式（~40px，overflow hidden，flex 内只显示 header）
- [ ] 添加 `.toolbar-header` 样式（flex row，padding，cursor pointer，hover 高亮）
- [ ] 添加 `.toolbar-header .chevron` 旋转动画
- [ ] 窄屏（≤920px @media）下 sidebar 不启用折叠模式

### Step 2: App.tsx — 新增状态与持久化
- [ ] 添加 `SidebarConfig` 类型定义
- [ ] 添加 `loadSidebarConfig` / `saveSidebarConfig` localStorage 封装
- [ ] 添加 3 个 state：`sidebarWidth`, `sidebarCollapsed`, `filterCollapsed`
- [ ] 添加 `useEffect` 自动保存 config 到 localStorage

### Step 3: App.tsx — resize handle 逻辑
- [ ] 在 `<aside>` 和 `<section>` 之间渲染 `.resize-handle` 元素
- [ ] mousedown 记录开始拖动，mousemove 计算新宽度（clamp 280 ~ 70vw）
- [ ] mouseup 结束拖动，click 检测无拖动则 toggle sidebarCollapsed
- [ ] 拖动时 body 加 `user-select: none` / `pointer-events: none` 防选文字

### Step 4: App.tsx — sidebar 折叠/展开
- [ ] 展开时渲染全部内容，收起时渲染窄条版本（展开按钮 + 模式图标）
- [ ] 展开按钮点击恢复 `sidebarCollapsed = false`
- [ ] `.app-shell` 的 `--sidebar-grid-width` 根据状态计算

### Step 5: App.tsx — 筛选区折叠
- [ ] toolbar 顶部加标题行（"筛选" + 展开/折叠图标）
- [ ] 点击标题行 toggle `filterCollapsed`
- [ ] 折叠时隐藏全部筛选控件

### Step 6: 验证
- [ ] 拖拽调整宽度，松开后保持
- [ ] 收起/展开侧边栏，窄条模式显示正常
- [ ] 筛选区折叠/展开
- [ ] 刷新页面后三个状态恢复
- [ ] 窄屏（浏览器 ≤920px）侧边栏不整体收起
- [ ] freeReplay 模式不受影响

## 验证命令

```bash
npm run build
# 或
npm run dev
```

## 风险点

- resize handle 和 sidebar collapse 共享右侧边缘，需要处理好 click vs drag 区分
- 窄屏媒体查询中 `--sidebar-grid-width` 覆盖逻辑要精确，避免和 JS 冲突
