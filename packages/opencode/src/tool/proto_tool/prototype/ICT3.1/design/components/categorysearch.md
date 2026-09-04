# CategorySearch 分类搜索使用规范

用于分类搜索关键词，弹出下拉列表框选择分类并输入搜索内容。

## 使用规则

- 必须设置 `value` 作为搜索输入框的值。
- `categoryOptions` 定义分类下拉选项，每项包含 `text`（显示文本）和 `value`（选项值）。
- 通过 `category` 设置当前选中的分类，其值应对应 `categoryOptions` 中某一项的 `value`。
- 使用 `placeholder` 提示搜索内容或格式，如"搜索名称、ID 或关键词"。
- 需要禁止用户编辑时设置 `disabled=true`。

## 布局

- CategorySearch 通常放置在页面顶部或筛选区域，宽度适配容器。
- 同一筛选区域内 CategorySearch 与其他控件高度保持对齐。

## Don't

- 不要用 Input + Select 组合代替 CategorySearch；CategorySearch 提供了分类与搜索的一体化交互。
- 不要在 `categoryOptions` 中使用缺少 `text` 或 `value` 的选项。
- 不要给 CategorySearch 添加阴影或任意状态色。
- 不要使用开发组件不存在的属性或枚举值。
