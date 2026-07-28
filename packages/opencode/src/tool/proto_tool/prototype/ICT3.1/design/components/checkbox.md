# Checkbox 复选框使用规范

用于独立条件确认或从一组选项中选择零到多项。

## 使用规则

- 单个条件使用 Checkbox，通过 `checked` 表示选中状态，并使用 `label` 明确描述条件。
- 多选使用 CheckboxGroup，必须设置 `value` 和 `options`。
- 不可选择时使用 `disabled=true`，保留可读标签。
- 单个 Checkbox 适合同意、附加条件或独立确认；CheckboxGroup 适合筛选、权限和多条件配置。
- Table 行选择使用 Table 的 `rowSelection`，不要手动画 Checkbox 列。

## 布局

- 选项短且数量少时横向排列；文案长或选项多时纵向排列并保持对齐。
- Checkbox 与标签作为同一点击目标，标签不换成模糊的“是/否”。

## Don't

- 不要用于互斥选择；使用 RadioGroup。
- 不要用于立即生效的开关；使用 Switch。
- 不要写开发 API 未提供的半选属性。
