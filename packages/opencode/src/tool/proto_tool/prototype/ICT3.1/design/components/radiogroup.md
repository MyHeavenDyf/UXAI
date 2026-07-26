# RadioGroup 单选框使用规范

用于从少量互斥选项中选择一项。

## 使用规则

- 必须设置当前 `value` 和 `options`；有安全默认值时提供默认选中项。
- 普通表单选择使用 `optionType=default`；短选项的模式切换或强调选择使用 `optionType=button`。
- 选项短且数量少时使用 `orientation=horizontal`；标签长或需要说明时使用 `orientation=vertical`。
- 常规页面使用 `size=medium`；同组 RadioGroup 尺寸一致。
- 单选组必须有组标题或上下文，选项文案保持同一维度。

## Don't

- 不要用于多选；使用 CheckboxGroup。
- 不要用于长列表；使用 Select。
- 不要用 `optionType=button` 模拟 Tabs、Steps 或主操作。
- 不要使用开发组件不存在的属性或枚举值。
