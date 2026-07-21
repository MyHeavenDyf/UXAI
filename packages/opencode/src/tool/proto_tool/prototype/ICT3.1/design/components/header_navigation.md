# header_navigation 顶部导航使用规范

## Props

基于 Menu 组件实现，使用 `mode=horizontal`：

- `mode`: `vertical | horizontal`（顶部导航使用 `horizontal`）
- `items`: array（`{ title, key, icon, children }`）
- `selectedKeys`: array
- `openKeys`: array
- `inlineCollapsed`: boolean

### 用途

用于全局导航、产品上下文、工作区切换、搜索、工具入口和账号入口。

### 结构

- 产品标识或工作区标识
- 一级导航
- 分组导航或下拉
- 搜索
- 工具操作
- 用户账号区

### 规则

- 高度为 `3rem`。
- 使用 `bg-surface-container-highest`。
- 内容垂直居中。
- Active、hover、selected、dropdown 状态一致。
- 导航过长时使用分组或下拉，不要硬塞。
- Header 承载全局层级，不承载页面内部的大量筛选或批量操作。
- 产品标识、一级导航、全局工具和用户区需要形成稳定位置，不随页面内容变化。
- 当前模块 active 状态必须清晰，但不要压过页面主标题和主操作。

### Do

- 高度为 `3rem`，使用 `bg-surface-container-highest`，内容垂直居中。
- Active、hover、selected、dropdown 状态一致。
- 导航过长时使用分组或下拉，不硬塞。
- Header 承载全局层级，不承载页面内部的大量筛选或批量操作。
- 产品标识、一级导航、全局工具和用户区形成稳定位置。
- 当前模块 active 状态清晰，但不压过页面主标题和主操作。

### Don't

- 不要把 Header 做成 hero。
- 不要放装饰大图或强渐变。
- 不要放过多页面级操作。
