# SearchInput 搜索输入框使用规范

带下拉建议列表的搜索输入框，输入时按文本过滤候选项并点击回填。

## 使用规则

- 必须设置 `value` 作为搜索输入框的当前值（通常绑定到 state）。
- `placeholder` 为输入框占位语；为空时不显示。
- `popItems` 提供下拉建议项，每项含 `text`（显示与过滤依据）、`value`（值），可选 `disabled`（该项不可选）。
- 输入内容时按 `text` 过滤 `popItems` 并展示下拉；点击某项将其 `text` 回填到 `value` 并关闭下拉。
- `popItems` 可通过 `{ "path": "/searchPopItems" }` 绑定到 state，实现动态建议列表。
- 需要禁止编辑时设置 `disabled=true`，输入框灰化且不可操作。

## 布局

- 单行输入框，右侧附搜索图标。
- 下拉项过多时纵向滚动，名称截断为单行，不挤压周围布局。

## Don't

- 不要用 Input + Popover 组合代替 SearchInput。
- 不要用 SearchInput 替代 Select 或自动补全等需要分页/懒加载的复杂场景。
- 不要使用开发组件不存在的属性或枚举值。
