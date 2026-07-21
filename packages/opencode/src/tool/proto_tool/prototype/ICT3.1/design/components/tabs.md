# tabs 页签使用规范

## Props

- `activeKey`: string
- `types`: `line | card | editable-card`
- `tabPlacement`: `top | end | bottom | start`
- `size`: `large | medium | small`

TabItem 子组件：

- `key`: string
- `label`: string
- `icon`: string
- `content`: string | SlotNode

### 用途

用于同一上下文中同级内容切换。

### 类型

- Line Tabs：标准内容分区。
- Button/Segmented Tabs：紧凑模式切换。
- Card/Container Tabs：需要强分组的内容区域。

### 规则

- Tabs 靠近其控制内容。
- Active 状态在 tab 组内最强。
- Hover、disabled、overflow 状态明确。
- tab 过多时使用 overflow/dropdown。
- Line Tabs 用于同一页面内的内容分区。
- Button/Segmented Tabs 用于模式切换、视图切换或短选项组。
- Container Tabs 用于卡片或面板内部的强分组。
- 如果切换会改变页面主对象或跨模块跳转，应使用导航而不是 Tabs。

### 标题层级与字号

- 页签类标题必须按所在层级选择匹配的 Tabs 类型和字号大小。
- 页面主内容下的一级内容分区使用 Line Tabs，字号通常使用 `text-md` 或组件默认正文级字号，不得压过页面标题。
- 卡片、Drawer、Dialog 或局部面板内部的页签使用 Container Tabs 或紧凑 Line Tabs，字号不高于同容器标题层级。
- 模式切换、视图切换、周期切换等短选项使用 Button/Segmented Tabs，字号使用组件默认正文级字号。
- 当 Tabs 上方已有 `text-2xl` / `text-lg` 标题时，Tabs 文案不得再使用 Headline 级字号。
- 多层 Tabs 不应连续堆叠；需要更深层级时，改用侧边导航、筛选、分组标题或内容区块。

### 文案

- 标签文案短且可扫描。
- 不要使用句子式 tab 文案。
- 同一组 tab 的命名维度保持一致。

### Do

- Line Tabs 用于同一页面内的内容分区。
- Button/Segmented Tabs 用于模式切换、视图切换或短选项组。
- Container Tabs 用于卡片或面板内部的强分组。
- Active 状态在 tab 组内最强，Hover、disabled、overflow 状态明确。
- tab 过多时使用 overflow/dropdown。
- 标签文案短且可扫描，同一组 tab 的命名维度保持一致。
- 切换会改变页面主对象或跨模块跳转时使用导航而不是 Tabs。

### Don't

- 不要用 Tabs 表示步骤流程。
- 不要混合同级和非同级内容。
- tab 太多时改用侧边导航、筛选或分组。
