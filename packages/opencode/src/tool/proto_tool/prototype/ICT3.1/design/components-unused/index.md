# ICT 组件规范目录

本目录定义 ICT 基础设施通用 UI 规范 3.1.1 的组件使用规则。生成或审查 UI 时，先阅读本文件，再按涉及组件读取对应组件文件。

## 全局组件规则

### 使用优先级

1. 必须使用组件 props 控制类型、颜色、尺寸、状态和行为。
2. 必须使用 `design_system.md` 中的 token；禁止任意色值、任意间距、任意字号、任意阴影或任意圆角。
3. 组件已有状态时，不要用局部 class 覆盖状态样式。
4. 同一页面中同类组件的结构、对齐、间距、状态表达必须一致。

### 状态完整性

按组件需要提供以下状态：

- 默认态
- 悬停态
- 点击/激活态
- 聚焦态
- 禁用态
- 加载态
- 选中态
- 错误/警告/成功/信息态
- 空状态

### 文案原则

- 组件文案要短、清楚、可执行。
- 操作按钮文案使用动词或动宾结构，如“保存”“新建任务”“删除规则”。
- 状态文案使用明确状态，如“已启用”“待处理”“异常”。
- 不要用模糊文案，如“确定”“处理一下”“更多内容”，除非上下文已经足够明确。
- 文案过长时优先改写，其次截断，最后才使用 Tooltip。

### 禁止项

- 不要把组件当装饰元素使用。
- 不要在同一组件组中混用不同视觉结构。
- 不要为局部场景发明新的组件样式。
- 不要隐藏必要标签、状态、校验、单位、上下文。
- 不要让组件文本撑破容器或导致布局跳动。

## 组件文件

- [Button 按钮](./button.md)
- [Input 输入框](./input.md)
- [Search 搜索框](./search.md)
- [Link 文字链接](./link.md)
- [Dropdown 下拉菜单](./dropdown.md)
- [Header Navigation 顶部导航](./header_navigation.md)
- [Side Navigation 侧边导航](./side_navigation.md)
- [Breadcrumb 面包屑](./breadcrumb.md)
- [Tabs 页签](./tabs.md)
- [Pagination 分页器](./pagination.md)
- [Cascader 级联选择器](./cascader.md)
- [Filter 筛选](./filter.md)
- [Form 表单](./form.md)
- [Radio 单选框](./radio.md)
- [Checkbox 复选框](./checkbox.md)
- [Switch 开关](./switch.md)
- [Numeric 计数器](./numeric.md)
- [Table 表格](./table.md)
- [Card 卡片](./card.md)
- [Drawer 抽屉](./drawer.md)
- [Dialog 对话框](./dialog.md)
- [Alert 公告提示](./alert.md)
- [Tag 标签](./tag.md)
- [Badge 徽标](./badge.md)
- [Tree 结构树](./tree.md)
- [Timeline 时间轴](./timeline.md)
- [Charts 图表](./charts.md)
