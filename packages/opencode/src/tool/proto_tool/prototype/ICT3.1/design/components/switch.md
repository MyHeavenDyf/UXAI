# Switch 开关使用规范

用于立即生效的开/关设置。

## 使用规则

- 必须设置布尔 `value`；切换后立即生效，不需要额外提交。
- 文案已能说明两态时使用基础 Switch；需要在控件内强化两态时使用 `checkedChildren` 和 `unCheckedChildren`。
- 控件内文字保持简短，建议不超过 5 个字符；更完整的含义由外部 Label 说明。
- 只有图标能清楚表达两态时使用 `checkedChildrenIcon` 和 `unCheckedChildrenIcon`，图标名使用 Lucide kebab-case。
- 常规设置使用 `size=medium`；紧凑列表使用 `size=small`。
- 高风险或批量切换需要确认并说明影响范围；异步结果需要明确反馈。

## 布局

- 设置项 Label 和说明放在行首，Switch 放在行尾。

## Don't

- 不要用于需要提交按钮确认的设置。
- 不要用于超过两个状态的选择。
- 不要同时堆叠无必要的控件内文字和图标。
- 不要使用开发组件不存在的属性或枚举值。
