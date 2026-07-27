# Table 表格使用规范

用于密集、可比较、基于行的企业数据。

## 使用规则

- 必须设置唯一 `rowKey`、`dataSource` 和 `columns`；每列必须设置 `columns.title` 与 `columns.dataIndex`。
- 数字右对齐，短状态可居中，其余默认左对齐，通过 `columns.align=left | center | right` 设置。
- 仅冻结列设置 `columns.fixed=start | end` 和 `columns.width`；长文本列可设置 `columns.minWidth`，不要给所有列固定宽度。
- 需要列筛选或排序时使用 `columns.filters`、`columns.sort=true`，不要手画控件。
- 默认保留组件分页；仅需显示全部行时设置 `pagination=false`。
- 批量选择使用 `rowSelection.type=checkbox | radio`；展开行使用 `expandable.expandedRowKeys` 和 TableRow 的 `expandedRowRender`。
- 行内操作使用 `Button types=link`；状态使用文本、图标或 Tag，不使用 Badge。

## 布局

- Table 放在 `bg-surface-container-highest` 内，长文本截断并通过 Tooltip 或详情展示，保持行高一致。
- 选中行后在表格工具区显示已选数量和可执行操作。

## Don't

- 不要手动画分页、复选列、排序或筛选。
- 不要把标准表格行做成 Card。
- 不要用固定宽度破坏表格自适应。
- 不要使用开发组件不存在的属性或枚举值。
