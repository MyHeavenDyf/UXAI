# Charts 图表使用规范

用于趋势、比较、组成和进度概览；仅使用开发属性表中已有的图表组件。

## 使用规则

- 类别比较使用 BarChart；组成或占比使用 PieChart；单值达成率使用 PatGauge；状态构成使用 PatStackedBar；任务进度使用 Progress。
- BarChart 必须设置 `option.data`、`option.xAxis.data` 和描述性的 `option.yAxisTitle`；横向柱状图使用 `option.direction=horizontal`，堆叠比较使用 `option.stack=true`。
- BarChart 仅在需要阈值时设置 `option.markLine.top` 或 `option.markLine.bottom`。
- PieChart 必须设置 `option.data` 和中心标题 `option.title.text`；需要补充说明时使用 `option.title.subtext`，图例位置使用 `option.legendPosition=centerRight | bottomCenter`。
- PieChart 仅在扇区需要直接标注时设置 `option.label.show=true`。
- PatGauge 使用 `value` 表示当前值，只有最大值不是组件默认值时才设置 `max`。
- PatStackedBar 必须提供 `normal / warning / danger / error`；Progress 必须提供 `percent`，状态使用 `normal | active | success | exception`。
- 沿用组件默认图表色；除非用户明确要求且符合 Token 规范，不设置 `option.color` 或 `strokeColor`。

## 布局

- 图表填满父容器，并提供标题、时间范围或数据口径。
- 多图表组合时主图占最大面积，辅助图保持一致高度；无数据或异常时显示区域内状态，不留空白画布。

## Don't

- 不要手动画图例、坐标轴、单位或进度组件。
- 不要调用开发属性表中不存在的图表类型或属性。
- 不要用饼图比较大量类别或细微差异。
