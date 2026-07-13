# 侧边栏布局灵活化改造

## Goal

让复盘工具侧边栏布局更灵活：支持拖拽调整宽度、整体收起/展开、筛选区可折叠收起，把更多空间让给图表和详情区。

## Background

当前侧边栏（`.sidebar`）固定在 `390px` 宽，由 CSS Grid `grid-template-columns: 390px minmax(0, 1fr)` 控制。无运行时宽度调整，无收起/展开功能。

侧边栏内部结构（trade review 模式）：
1. **mode-switch** — Trade Review / Free Replay 切换
2. **toolbar（筛选区）** — 7 个筛选控件 + 排序控件，始终展开
3. **review-progress** — 复盘进度条
4. **trade-list** — 交易列表（占剩余空间）

freeReplay 模式侧边栏显示 FreeReplayPanel，不含筛选区。

## Requirements

### R1: 侧边栏宽度可调
- 拖拽右侧边缘调整宽度，范围 280px ~ 70vw
- 宽度调整不影响 workspace 内容布局

### R2: 侧边栏可收起/展开
- 展开时点击右侧边缘（resize handle 区域）收起
- 收起时缩为窄竖条（~40px），显示展开箭头和模式图标
- 窄条上点击展开箭头恢复侧边栏（恢复上次宽度）
- 窄屏（≤920px 上下布局）时不做侧边栏整体收起，只保留筛选区折叠

### R3: 筛选区（toolbar）可折叠
- toolbar 顶部加标题栏"筛选 + 折叠按钮"，点击折叠/展开
- 折叠后只显示标题栏，trade-list 获得更多显示空间

### 状态持久化
- 侧边栏宽度、筛选区折叠状态、侧边栏收起状态 → 全部存 localStorage

## Acceptance Criteria

- [ ] R1: 拖拽侧边栏右侧边缘，宽度在 280px ~ 70vw 之间变化
- [ ] R1: 松开鼠标后宽度保持，切换 mode 或刷新后不丢失
- [ ] R2: 点击右侧边缘收起为 ~40px 窄条
- [ ] R2: 窄条显示展开箭头和模式图标，点击恢复
- [ ] R2: 窄屏（≤920px）侧边栏不整体收起，筛选区折叠仍生效
- [ ] R3: 点击"筛选"标题行，筛选控件折叠/展开，有过渡动画
- [ ] R3: 筛选区折叠后 trade-list 占用更多空间

## Out of Scope

- 不改变现有筛选控件的功能和样式
- 不改变 FreeReplayPanel 布局
- 不改变 workspace 内容
- 不涉及后端 API

## Design Decisions

| 问题 | 决策 |
|---|---|
| 收起形式 | 窄竖条（~40px），非完全隐藏 |
| 筛选折叠触发 | toolbar 顶部加标题栏 |
| 侧边栏收起触发 | 展开时点右侧边缘 / 拖到底 |
| 状态持久化 | 三个状态存 localStorage |
| 窄屏收起 | 不整体收起，筛选折叠仍生效 |
