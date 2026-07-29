# A2UI Components Catalog
  - **General:** `Button`(按钮), `Icon`(图标：MUST be use Lucide icon name)
  - **Navigation:** `Tabs`(页签), `TabItem`(页签项), `Steps`(步骤条), `StepItem`(步骤项), `Breadcrumb`(面包屑), `Dropdown`(下拉菜单), `Menu`(菜单), `Pagination`(分页器)
  - **DataEntry:** `Checkbox`(复选框), `CheckboxGroup`(复选框组), `RadioGroup`(单选框组), `Select`(选择器), `Slider`(滑动条), `Switch`(开关), `Input`(输入框), `InputNumber`(计数器), `TextArea`(文本域), `TimePicker`(时间选择器), `DatePicker`(日期选择器), `Rate`(评分)
  - **DataDisplay:** `Tag`(标签), `Table`(表格), `TableRow`(表格行), `Collapse`(折叠面板), `CollapseItem`(折叠面板项), `Timeline`(时间轴), `TimelineItem`(时间轴项), `Divider`(分割线), `Badge`(徽标), `Carousel`(走马灯), `Segmented`(分段器), `Tree`(结构树)
  - **Response:** `Progress`(进度条)
  - **Chart:**
    `LineChart`(折线图：Show trends over time),
    `BarChart`(条形图：Compare discrete categories),
    `PieChart`(饼图：Show parts-to-whole proportions),
    `RadarChart`(雷达图：Compare 3+ attribute dimensions),
    `GaugeChart`(仪表盘：Show one value against a target or range),
    `ProcessChart`(进度排名图：Rank percentage or ratio values),
    `BubbleChart`(气泡图：Show correlations, clusters, and magnitude across X, Y, and size),
    `AssembleBubbleChart`(聚合气泡图：Show weight or popularity with center-packed bubbles),
    `BulletChart`(子弹图：Compare one metric across status ranges),
    `FunnelChart`(漏斗图：Show value changes across process stages),
    `HillChart`(山丘排名图：Rank absolute values),
    `ScatterChart`(散点图：Show trends, correlations, or outliers across X and Y),
    `JadeJueChart`(玉玦图),
    `CircleProcessChart`(环形进度图：Show progress or multiple percentages in a ring),
    `TreeMapChart`(矩形树图：Show hierarchy and proportions),
    `HeatMapChart`(热力图：Show values or patterns in a 2D matrix),
    `SankeyChart`(桑基图：Show flow and distribution across stages or categories),
    `BarLineChart`(柱线组合图：Compare multi-scale metrics with bars and lines)

## 全局选择规则

- 顶部导航和侧边导航必须使用 `Menu`，不得使用 `Tabs`，也不得在导航项中放置 `Checkbox`、`RadioGroup` 或 `Tag`。
- 卡片右上角的少量互斥视图切换使用 `Segmented`；同级内容分区才使用 `Tabs`。
- 表格行选择使用 Table 的 `rowSelection`，不得手动画 Checkbox 列。
- 关键词搜索使用 `Input` 并设置搜索图标，不创建不存在的 Search 组件。
- 只调用当前运行环境真实提供的组件；没有独立规范文件的组件不得臆造 props。

## TopN 图表

- 多系列比较优先使用 `BarChart`。
- 百分比或比率排名在运行环境提供时使用 `ProcessChart`，否则使用横向 `BarChart`。数据格式：`[{"name": "A", "value": 45}, {"name": "B", "value": 80}]`
- 绝对值排名在运行环境提供时使用 `HillChart`，否则使用横向 `BarChart`。数据格式：`[{"name": "A", "value": 1250}, {"name": "B", "value": 840}]`

图表的实际可用类型和属性以当前运行环境及 `components/charts.md` 为准。
