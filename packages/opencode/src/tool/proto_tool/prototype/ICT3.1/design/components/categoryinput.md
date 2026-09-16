# CategoryInput 分类输入使用规范

用于分类输入，通过下拉框选择分类后在输入框中输入对应内容。

## 使用规则

- 必须设置 `value` 作为输入框的值。
- `categoryOptions` 定义分类下拉选项，每项包含 `text`（显示文本）和 `value`（数值）。
- 通过 `category` 设置当前选中的分类，其值应对应 `categoryOptions` 中某一项的 `value`。
- 使用 `placeholder` 提示输入内容或格式。
- `inputPosition` 控制输入框相对于分类下拉框的位置，默认为 `right`。
- 需要禁止用户编辑时设置 `disabled=true`。

## 布局

- CategoryInput 通常用于表单区域，宽度适配容器。
- 同一表单区域内 CategoryInput 与其他控件高度、Label 保持对齐。

## Don't

- 不要用 Input + Select 组合代替 CategoryInput；CategoryInput 提供了分类与输入的一体化交互。
- 不要在 `categoryOptions` 中使用缺少 `text` 或 `value` 的选项。
- 不要给 CategoryInput 添加阴影或任意状态色。
- 不要使用开发组件不存在的属性或枚举值。
