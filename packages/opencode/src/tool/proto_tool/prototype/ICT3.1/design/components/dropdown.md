# Dropdown 下拉菜单使用规范

用于从当前上下文展开一组操作或轻量导航入口。

## 使用规则

- 必须设置 `menu`，每项必须包含 `menu.label` 和唯一 `menu.key`；仅在图标帮助识别时设置 `menu.icon`。
- 非默认触发方式才设置 `trigger`；浮层位置通过 `placement=bottom | bottomLeft | bottomRight | top | topLeft | topRight` 选择。
- 更多操作、导出、下载、复制和行操作使用 Dropdown；选择表单值使用 Select。
- 菜单项使用短动词或名词短语，同组语法保持一致。

## 布局

- 浮层贴近触发器并与其边缘对齐，靠近视口边缘时选择不会溢出的 `placement`。
- 菜单宽度容纳最长菜单项，文字保持单行。

## Don't

- 不要用 Dropdown 替代 Select、主导航或复杂层级选择。
- 不要在菜单项内放表单、图表或长段说明。
- 不要写 API 表未定义的 trigger 枚举值。
