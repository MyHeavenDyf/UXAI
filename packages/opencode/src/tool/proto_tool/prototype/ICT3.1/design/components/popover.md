# Popover 气泡卡片使用规范

用于在触发器附近以浮层展示补充说明、轻量确认或结构化内容卡片。

## 使用规则

- 必须设置 `content`：可为字符串文本、`DataBinding` 绑定或 `SlotNode`（`{ "componentId": "..." }`）引用结构化节点；复杂内容用 SlotNode，纯文本提示用字符串。
- 可选 `title` 设置标题文本（字符串或 `DataBinding`），保持简短。
- 非默认触发方式才设置 `trigger=click | hover | contextMenu`，默认 `hover`。
- 浮层位置通过 `placement=top | left | right | bottom | topLeft | topRight | bottomLeft | bottomRight | leftTop | leftBottom | rightTop | rightBottom` 选择，默认 `top`。
- `children` 必须且仅引用一个触发元素（ID 数量恰为 1）。
- 提示、解释、轻量确认使用 Popover；菜单操作使用 Dropdown；长表单或复杂录入使用 Modal/Drawer。

## 布局

- 浮层靠近触发器并与边缘对齐，靠近视口边缘时选择不会溢出的 `placement`。
- 内容保持简短，单行为佳；长内容或表单改用 Modal/Drawer。
- 标题与正文文案保持同一命名维度。

## Don't

- 不要用 Popover 承载长表单、复杂层级或主操作入口。
- 不要在 `children` 放多个触发元素或留空。
- 不要写 API 表未定义的 trigger/placement 枚举值。
- 不要用 Popover 替代 Dropdown 菜单或纯文本 Tooltip。
