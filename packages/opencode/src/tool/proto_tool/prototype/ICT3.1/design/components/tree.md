# Tree 结构树使用规范

用于浏览和选择具有父子关系的层级数据。

## 使用规则

- 必须设置 `options`，每个节点必须包含唯一 `options.key` 和 `options.title`；子节点使用 `options.children`。
- 只有图标帮助识别节点类型时设置 `options.icon`。
- 允许多选时使用 `checkable=true`；初始展开和选中项分别使用 `defaultExpandedKeys`、`defaultSelectedKeys`。
- Tree 用于组织、资源、设备和文件目录；页面导航使用 Menu。
- 展开图标只控制展开，点击节点用于选中或进入详情，不混淆两种行为。

## 布局

- 层级缩进稳定，图标和操作不能造成文本错位；长节点名截断并提供 Tooltip 或详情。
- 节点很多时在 Tree 外提供搜索或分组；左侧 Tree 与右侧详情保持清晰分隔。

## Don't

- 不要用 Tree 替代普通 Select、主导航或表格。
- 不要隐藏层级关系或路径上下文。
- 不要在节点内放复杂表单、图表或多行说明。
- 不要写 API 未提供的搜索、编辑、异步加载属性。
