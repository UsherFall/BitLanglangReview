# 侧边栏布局灵活化改造 — 技术设计

## 架构概要

现有布局全在 `App.tsx` inline 实现，CSS 集中在 `styles.css`。改动也集中在这两个文件，不需拆分组件。

**3 个独立状态：**

| 状态 | 默认 | 类型 | 持久化 |
|---|---|---|---|
| `sidebarWidth` | `390` | `number` (px) | localStorage |
| `sidebarCollapsed` | `false` | `boolean` | localStorage |
| `filterCollapsed` | `false` | `boolean` | localStorage |

## 方案一：CSS Grid + inline style 控制宽度

当前：
```css
.app-shell {
  grid-template-columns: 390px minmax(0, 1fr);
}
```

改为 CSS 变量驱动：
```css
.app-shell {
  grid-template-columns: var(--sidebar-grid-width) minmax(0, 1fr);
}
```

`--sidebar-grid-width` 由 JS 计算：
- 展开：`sidebarWidth + "px"`
- 收起（宽屏）：`"40px"`
- 收起（窄屏 ≤920px）：`"1fr"`（不收起，满宽）

JSX 改动：
```tsx
<main className="app-shell" style={{ '--sidebar-grid-width': sidebarGridWidth } as React.CSSProperties}>
```

## 方案二：Resize Handle

新增一个元素放在 `.sidebar` 右边、`.workspace` 左边：

```
┌──────────┬──┬──────────────────┐
│ sidebar  │H │   workspace      │
│          │A │                  │
│          │N │                  │
│          │D │                  │
│          │L │                  │
│          │E │                  │
└──────────┴──┴──────────────────┘
```

- `.resize-handle`：宽度 4px，cursor `col-resize`，hover 时高亮
- 点击 handle 触发收起/展开切换（和拖拽不冲突：点击 = mousedown 后无 mousemove 即 mouseup）
- mousedown → mousemove → 更新 sidebarWidth，最小 280，最大 70vw
- 防止选中文字：拖动时 `user-select: none` on body

拖拽性能：用 `useRef` 记录拖动状态，mousemove 直接更新 state，CSS 用 `inline style`，React re-render 一次。

## 方案三：侧边栏收起状态

宽屏（>920px）：
- 展开：`--sidebar-grid-width = sidebarWidth + "px"`，显示全部内容
- 收起：`--sidebar-grid-width = "40px"`，`.sidebar` 内容切换 class `.collapsed`

`.sidebar.collapsed` 样式：
```css
.sidebar.collapsed {
  /* 只显示 mode-switch 的模式图标（缩小版）+ 展开按钮 */
  /* 其余内容 display: none */
}
```

收起时 sidebar 内部只渲染：
- 一个展开按钮（`»`）
- mode-switch 图标化（小 icon 表示当前模式）

窄屏（≤920px）：不启用 sidebar 整体收起，`--sidebar-grid-width` 始终为 `"1fr"`。

## 方案四：筛选区折叠

筛选区加标题栏：

```tsx
<div className="toolbar">
  <div className="toolbar-header" onClick={() => setFilterCollapsed(!filterCollapsed)}>
    <span>筛选</span>
    <ChevronDown size={16} className={filterCollapsed ? '' : 'rotated'} />
  </div>
  {!filterCollapsed && (
    <div className="toolbar-body">
      {/* existing filter controls */}
    </div>
  )}
</div>
```

- 标题栏点击切换 `filterCollapsed`
- `.toolbar-header` 有 `cursor: pointer`，hover 高亮
- 折叠动画：`.toolbar-body` 用 `grid-template-rows: 0fr` + overflow hidden + transition，或用条件渲染 + CSS `@keyframes` 做展开折叠。简单场景用条件渲染即可
- 折叠时 `border-bottom` 保留在 `.toolbar` 上，保持视觉分隔

## 方案五：localStorage 持久化

使用两个简单封装：

```ts
const SIDEBAR_CONFIG_KEY = 'sidebar-config';

type SidebarConfig = {
  width: number;
  collapsed: boolean;
  filterCollapsed: boolean;
};

function loadSidebarConfig(): SidebarConfig {
  try {
    return JSON.parse(localStorage.getItem(SIDEBAR_CONFIG_KEY) ?? '');
  } catch {
    return { width: 390, collapsed: false, filterCollapsed: false };
  }
}

function saveSidebarConfig(config: SidebarConfig) {
  localStorage.setItem(SIDEBAR_CONFIG_KEY, JSON.stringify(config));
}
```

初始化时 `useState(loadSidebarConfig)`，每次状态变化 `useEffect` 自动保存。

## 影响范围

| 文件 | 改动 |
|---|---|
| `src/ui/App.tsx` | 新增 4 个 state + resize 逻辑 + collapsible filter + 侧边栏折叠逻辑 |
| `src/ui/styles.css` | 新增 `.resize-handle`, `.sidebar.collapsed`, `.toolbar-header`, `.collapsed-filter` 样式 |
| (无其他文件) | |

## 不需要改的

- FreeReplayPanel（不涉及筛选区）
- ReviewEditor（不涉及侧边栏布局）
- server / domain 层
- 其他 component

## 回滚方案

纯 CSS + state 改动，不涉及 API/数据。出问题直接 revert 即可。
