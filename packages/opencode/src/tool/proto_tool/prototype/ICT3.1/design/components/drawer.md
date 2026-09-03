# Drawer 抽屉使用规范

用于从屏幕边缘滑出的面板，承载需要更多纵向空间的内容（详情、筛选、分步表单、多字段编辑等）。比 Modal 更适合信息量较大的场景。

## 使用规则

- `open` 必须绑定到一个布尔 state（如 `{ "path": "/isDrawerOpen" }`），由其他元素的事件来切换；禁止写死 `true`。
- `onClose` 必须配套设置，通常是一条 `setState`，把 `open` 绑定的同一 path 写回 `false`；该事件在点击遮罩、关闭图标或按 ESC 时触发。
- 使用 `placement` 指定滑出方向（`right` | `left` | `top` | `bottom`），默认 `right`；同一产品内同侧抽屉保持一致。
- 抽屉主体内容使用 `children`，不要为正文再单独定义 content 插槽。
- 底部操作区使用 `footer` 命名插槽，传入一个 `componentId`（通常是一个按钮组）；不需要底部时省略 `footer`，不要把操作按钮塞进 `children`。
- 默认 `mask: true`；仅在需要同时操作抽屉与底层页面时才设 `mask: false`。
- 标题使用 `title`；标题与触发该抽屉的动作保持同一语境。
- 使用 `width` 指定抽屉宽度，默认 `300`。

## 布局

- Drawer 通过 portal 渲染在文档根节点，沿 `placement` 方向滑入，不参与页面 flex/grid 流式布局。
- 抽屉宽度/高度由其方向决定，主体内容纵向滚动；避免在抽屉内再嵌套复杂多栏布局。
- 底部按钮组靠右排列（`placement=top` 时可居中），主操作在最右。

## Don't

- 不要用 Drawer 承载强打断型的关键确认；强打断场景用 Modal。
- 不要同时打开多个 Drawer 形成级联；需要分步时在同一抽屉内切换内容。
- 不要在 `children` 和 `footer` 中放重复的操作入口；操作按钮统一放 `footer`。
- 不要臆造 API 未定义的属性（如 height、closable 等），需要时再补充。
