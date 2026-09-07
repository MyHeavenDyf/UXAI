# table 表格使用规范

## Props

- `rowKey`: string
- `columns`: array（`{ title, dataIndex, align, fixed, sort, width, minWidth, filters }`）
- `dataSource`: DataBinding
- `pagination`: boolean
- `rowSelection`: `{ type: checkbox | radio, selectedRowKeys }`
- `expandable`: `{ expandedRowKeys }`
- `rowClassName`: string

TableRow 子组件：

- `expandedRowRender`: SlotNode（展开行内容模板）

### 用途

用于密集、可比较、基于行的企业数据。

### 容器

- 必须放在 `bg-surface-container-highest` 内。
- 不要直接放在页面最低层画布上。
- 表格内容使用 `text-md`。
- 默认有分页；分页未显式控制时需要保留下方间距。

### 列宽

- 只有冻结列可设置 `width`。
- 长文本列可设置 `minWidth`。
- 状态、标签、操作、图标等短列不要设置 `minWidth`。
- 不要给所有列固定宽度。

### 操作

- 行内文字操作使用 `Button types=link`。
- 操作列保持紧凑和一致。
- 批量操作与选择状态保持关联。
- 表格顶部可包含搜索、筛选、刷新、导出、新建和批量操作，但操作区不能压过数据主体。
- 行选择用于批量操作；选中后需要显示已选数量和可执行操作。
- 排序、筛选、列设置、展开行、树形层级、固定列等能力优先使用 Table 组件能力。
- 长文本列使用截断、Tooltip 或详情抽屉；不要把行高撑得不一致。
- 状态信息在表格内使用文本、图标或 Tag，不使用 Badge。

### Do

- 表格放在 `bg-surface-container-highest` 内，内容使用 `text-md`。
- 只有冻结列设置 `width`，长文本列设置 `minWidth`。
- 行内文字操作使用 `Button types=link`。
- 行内状态使用文本、图标或 Tag，不使用 Badge。
- 长文本列使用截断、Tooltip 或详情抽屉保持行高一致。
- 排序、筛选、列设置、展开行优先使用 Table 组件能力。
- 行选择用于批量操作，选中后显示已选数量和可执行操作。

### Don't

- 不要在 Table 内使用 Badge。
- 不要把标准表格行做成卡片。
- 不要手动画组件已有的分页。
- 不要用固定宽度破坏自适应。
