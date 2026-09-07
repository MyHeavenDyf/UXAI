# ICT 基础设施通用 UI 规范 3.1.1

## 核心生成规则

- 默认画布为 1920 x 1080，除非用户明确指定其他尺寸。
- 优先使用 `references/design_system.md` 中的 ICT token 和 Tailwind class，不要随意发明颜色或样式。
- 页面画布使用 `bg-surface-container-lowest`。
- 主要卡片、表格、导航、抽屉等容器使用 `bg-surface-container-highest`，并搭配 `shadow-sm` 或 `shadow-card`。
- 有阴影的浮层/卡片不要再叠加结构性边框。
- 内部分割线使用 `border-divider`；`border-base` 只用于输入框等扁平、无海拔外壳。
- 卡片、表格、图表、按钮、图标、状态和排版需要保持统一。
- 页面需要支持常见桌面宽度，并在窄屏、长文案、键盘操作和屏幕阅读器场景下保持可用。
- 避免营销页式构图、概念稿效果、强光效、高饱和渐变、赛博感、重玻璃拟态和干扰信息的装饰。


本文件是 ICT 基础设施通用 UI 规范 3.1.1 的核心规则来源，覆盖画布、token、层级、间距、字体、表格、图表、图片和图标约束。

## 品牌色使用

具体色值和 token 在 `references/design_system.md` 与 `references/foundations.md` 中定义。这里说明品牌层面的使用意图。

## 图标

图标应实用、一致、易识别。

应该：

- 用于导航锚点、工具操作、状态反馈、文件/模块/类别识别和指标锚点。
- 保持描边、圆角、填充和容器逻辑一致。
- 遵循 `references/design_system.md` 中的图标尺寸、形态、颜色规则。
- 只有图标承载语义时才使用语义色。

不要：

- 在同一页面混用无关图标族。
- Icon 组件已有容器时，手动画图标背景。
- 对不熟悉或高风险操作使用无说明的纯图标。
- 使用不能提升识别或扫描效率的装饰图标。

应该：

- 用品牌蓝表达主操作、选中导航、焦点态、重要链接和关键信息锚点。
- 用中性表面作为企业级页面主体。
- 用语义色表达状态、校验、警告、成功和错误。
- 多色只用于图表、分类或受控的视觉系统。

不要：

- 无功能原因地大面积使用高饱和品牌色背景。
- 把霓虹蓝/紫光效作为默认科技感。
- 已有 token 时仍使用任意自定义颜色。
- 只靠颜色传达关键含义。
- 让强调色抢走主操作或语义状态的权重。

## 0. 画布

- 默认画布：1920 x 1080。
- 整体审美、品牌质量和企业 UI 判断遵循 `references/brand_guide.md`。

## 1. Tailwind Token 使用契约

使用基于 ICT 基础设施通用 UI 规范 3.1.1 扩展的 Tailwind token。页面、组件实例、业务模块和局部样式必须使用 design token 与组件 props，不得在消费端硬编码视觉值。

### Token Do / Don't

必须：

- 使用 design token 和组件 props 表达颜色、间距、字体、圆角、阴影、边框、状态和层级。
- 背景 token 搭配对应的 `on-*` 文本 token。
- 软状态背景使用语义 container token。
- 状态图标、标签和关键状态标记使用语义基础 token。
- 同类模块保持间距、圆角、阴影、字体和颜色一致。

禁止：

- 在页面、组件实例和业务模块中硬编码 `Hex`、`RGB`、`HSL`、`rgba` 等颜色值。
- 使用 `p-[...]`、`m-[...]`、`gap-[...]`、`rounded-[...]`、`text-[...]`、`leading-[...]` 等任意值写法绕过 token。
- 组件已有 color/type/size 等 props 时，用 `className` 覆盖组件颜色。
- 只靠颜色表达关键含义。
- 在同类组件中混用无关的层级、圆角或排版风格。
- 添加破坏 token 层级或组件规则的视觉丰富度。

例外：

- 只有 design token 定义文件、主题配置或规范文档中的 token 表可以出现底层色值和数值。
- 业务页面和组件使用侧只能引用 token 名称或组件 props，不直接复制 token 底层值。

### Colors

颜色使用规则：

- 所有 UI 颜色必须引用颜色 token 或组件语义 props。
- 背景、文字、图标、边框、状态、图表和数据高亮都不得在消费端硬编码色值。
- 禁止为了局部视觉效果新增一次性色值；确需新增时，先沉淀为 token，再在规范中登记用途。
- 语义状态必须使用 `error`、`success`、`warning`、`critical`、`info` 及其 container/on-container token。
- 文本必须使用与背景匹配的 `on-*` token，避免手动猜测对比度。

```json
{
  "primary": "#0067D1",
  "on-primary": "#FFFFFF",
  "primary-container": "#E6F2FD",
  "on-primary-container": "#191919",
  "primary-fixed": "#0067D1",
  "primary-fixed-dim": "#004EA8",
  "on-primary-fixed": "#FFFFFF",
  "on-primary-fixed-variant": "#F3F3F3",
  "surface": "#F3F3F3",
  "surface-dim": "#DFDFDF",
  "surface-bright": "#FFFFFF",
  "on-surface": "#191919",
  "surface-variant": "#F3F3F3",
  "on-surface-variant": "#777777",
  "surface-container-lowest": "#F3F3F3",
  "surface-container-low": "rgba(255,255,255,0.5)",
  "surface-container": "rgba(255,255,255,0.65)",
  "surface-container-high": "rgba(255,255,255,0.8)",
  "surface-container-highest": "#FFFFFF",
  "inverse-surface": "#191919",
  "inverse-on-surface": "#FFFFFF",
  "inverse-on-surface-variant": "#C9C9C9",
  "inverse-primary": "#0067D1",
  "error": "#E02128",
  "on-error": "#FFFFFF",
  "error-container": "#FEE7E8",
  "on-error-container": "#191919",
  "success": "#09AA71",
  "on-success": "#FFFFFF",
  "success-container": "#E7FBF2",
  "on-success-container": "#191919",
  "critical": "#F4840C",
  "on-critical": "#FFFFFF",
  "critical-container": "#FEF5E8",
  "on-critical-container": "#191919",
  "warning": "#FCC800",
  "on-warning": "#FFFFFF",
  "warning-container": "#FEFCE0",
  "on-warning-container": "#191919",
  "info": "#0067D1",
  "on-info": "#FFFFFF",
  "info-container": "#E6F2FD",
  "on-info-container": "#191919",
  "divider": "#F3F3F3",
  "accent-1": "#8B5CF6",
  "on-accent-1": "#FFFFFF",
  "accent-1-container": "#EDE9FE",
  "on-accent-1-container": "#4C1D95",
  "accent-2": "#F43F5E",
  "on-accent-2": "#FFFFFF",
  "accent-2-container": "#FFE4E6",
  "on-accent-2-container": "#9F1239",
  "accent-3": "#F59E0B",
  "on-accent-3": "#FFFFFF",
  "accent-3-container": "#FEF3C7",
  "on-accent-3-container": "#92400E",
  "accent-4": "#06B6D4",
  "on-accent-4": "#FFFFFF",
  "accent-4-container": "#CFFAFE",
  "on-accent-4-container": "#164E63",
  "accent-5": "#6366F1",
  "on-accent-5": "#FFFFFF",
  "accent-5-container": "#E0E7FF",
  "on-accent-5-container": "#3730A3"
}
```

### Spacing

- `inline`: `0.5rem`
- `stack`: `0.75rem`
- `gutter`: `1rem`
- `inset`: `1.5rem`
- `section`: `1rem`
- `page`: `2rem`

间距使用规则：

- `padding`、`margin`、`gap` 必须使用 spacing token，不得自定义任意数值。
- `inline`：用于图标与文字、按钮内部元素、小型内联元素之间的间距。
- `stack`：用于表单字段、标题与说明、列表项内部的垂直间距。
- `gutter`：用于表格工具区、筛选项、按钮组、卡片内部较紧凑的横向间距。
- `inset`：用于 Card、Drawer、Dialog、表单区块等容器内部 padding。
- `section`：用于模块、Card、表格、图表和功能区之间的间距。
- `page`：用于页面最外层容器 padding。
- 禁止使用 `p-[...]`、`px-[...]`、`m-[...]`、`mt-[...]`、`gap-[...]` 等任意值。
- 同一页面同类区块的 spacing 层级必须一致，不能随机混用多个相近数值。

### Shadow

- `shadow-sm`: `1px 1px 6px 0 rgba(0, 0, 0, 0.08)`
- `shadow-md`: `0 4px 12px 0px rgba(0, 0, 0, 0.16)`
- `shadow-lg`: `0 8px 24px 0px rgba(0, 0, 0, 0.16)`
- `shadow-xl`: `0 16px 48px 0px rgba(0, 0, 0, 0.16)`
- `shadow-card`: 同 `shadow-sm`
- `shadow-popover`: 同 `shadow-lg`
- `shadow-modal`: 同 `shadow-xl`

### Radius

- `rounded-sm`: 2px
- `rounded-md`: 4px
- `rounded-lg`: 6px
- `rounded-xl`: 8px
- `rounded-badge`: 4px
- `rounded-action`: 4px
- `rounded-container`: 8px
- `rounded-overlay`: 8px

圆角使用规则：

- `border-radius` 必须使用 radius token，不得自定义任意圆角值。
- 小型控件和紧凑元素使用 `rounded-sm` 或 `rounded-md`。
- Button、Input、Search、Select、Checkbox、Tag 等默认操作和表单控件使用组件映射的 action/control 圆角。
- Card、Dialog、Drawer、Popover、Tooltip、Overlay 等容器使用 `rounded-xl`、`rounded-container` 或 `rounded-overlay`。
- Switch、进度条、胶囊型标签等需要完全圆角时使用 `rounded-full`。
- 禁止把所有组件统一改成大圆角；圆角必须匹配组件尺寸、密度和功能。

### Border Color

- `border-base`: `#C9C9C9`
- `border-divider`: `#F3F3F3`
- `border-selected`: `#0067D1`
- `border-error`: `#E02128`

### Outline

- `outline-brand`: `#0067D1`
- `outline-error`: `#E02128`
- `outline-focus`: `1px`
- `outline-offset-gap`: `2px`

### Font Size

- `text-sm`: 12px / 1.6
- `text-md`: 14px / 1.5
- `text-lg`: 16px / 1.5
- `text-xl`: 18px / 1.5
- `text-2xl`: 20px / 1.4
- `text-3xl`: 24px / 1.4
- `text-4xl`: 28px / 1.4
- `text-5xl`: 36px / 1.4
- `text-6xl`: 48px / 1.3
- `text-7xl`: 60px / 1.3
- `text-8xl`: 72px / 1.2
- `text-9xl`: 96px / 1.2

字体使用规则：

- `font-size` 和 `line-height` 必须使用 typography token，不得自定义任意字号或行高。
- `font-weight` 必须使用规范角色定义：正文/表格默认 Regular，标题/激活导航/关键指标使用 Medium，避免随意使用 Bold。
- 中文主字体使用 HarmonyOS Sans SC；运行环境未加载时使用系统 fallback。
- 卡片标题必须使用 `text-lg`。表格内容必须使用 `text-md`。
- 页面级标题、模块标题、表格内容、表单标签、Caption、KPI 数字必须按信息层级选择 token，不得用视觉喜好临时放大或缩小。
- 禁止使用 viewport width 缩放字体，字距保持 `0`。

字体角色：

- Display：强展示型信息，如工作台关键数字、全局概览主指标、空状态主标题；企业后台中克制使用。
- Headline：标题类信息，如页面标题、区域标题、卡片标题、抽屉标题、对话框标题、表单分组标题。
- Body：正文类信息，如说明文字、表格单元格、表单标签、字段值、普通组件文字。
- Caption：辅助类信息，如元信息、注释、帮助文本、图表单位、字段说明和低强调状态说明。

标题层级规则：

- Headline 在页面、抽屉、对话框、卡片、表单和详情区中必须保持一致的多层级标题规则。
- 多层级标题字号按层级依次使用 `text-2xl` 20px、`text-xl` 18px（可选，建议三级以上使用）、`text-lg` 16px、`text-md` 14px。
- 页面、Drawer、Dialog 一级标题优先使用 `text-2xl`。
- 卡片标题、模块标题、表单分组标题优先使用 `text-lg`。
- 紧凑区域小标题或表格/列表内小标题可使用 `text-md`。
- 同级标题在同一页面中必须保持相同字号、字重和间距，不得局部跳级。
- 页签类标题必须按层级选择匹配的 Tabs 类型和字号，详见 `references/components/tabs.md`。

## 2. 层级与深度

通过色调层级和轻量环境阴影建立空间关系，不使用重边框制造层级。

- Level 0 画布：`bg-surface-container-lowest`，无阴影。
- Level 1 活跃容器：`bg-surface-container-highest`，搭配 `shadow-sm` 或 `shadow-card`。
- Level 2 内部区域：在 Level 1 容器内使用 `bg-surface-variant`。

文本搭配：

- `surface-container-*` 背景上使用 `text-on-surface`。
- `surface-variant` 背景上使用 `text-on-surface-variant`。
- 语义容器上使用对应的 `text-on-*-container`。

硬性约束：

- 不要在同一个浮层容器上同时使用结构性边框和阴影。
- 卡片和 Alert 禁止使用彩色左边条。
- 语义状态使用 `bg-error-container`、`bg-warning-container`、`bg-success-container`、`bg-info-container` 等容器背景表达。

## 3. 组件基础规则

### KPI 卡片与数据块

- 不使用边框。
- 使用 `bg-surface-container-highest`。
- 使用 `rounded-xl`。
- 次级指标使用 `border-divider` 或内部 `bg-surface-variant` 区域分隔。

### Buttons

- 状态色通过组件 props 设置：`default | primary | danger`。
- 不要在 `className` 中手动设置按钮背景色和文字色。
- 表格内带文字的操作按钮必须使用 `types=link`。
- `size=small/sm` 只允许在表格内部使用。
- 容器内按钮通常靠右。
- 并排按钮必须结构一致：全部文字、全部图标、或全部图标+文字。

### Tables

- Table 必须放在 `bg-surface-container-highest` 内，不要直接放在 `bg-surface-container-lowest` 上。
- Table 默认有分页；如果不显式控制分页器，需要保留下方间距。
- Table 内不要放 Badge。
- 只有 `fixed: "start"` 或 `fixed: "end"` 的冻结列才设置 `width`。
- 不要给所有列都设置 width。
- 长文本列可以设置 `minWidth`；短列不要设置 `minWidth`。

### Side Navigation

- 使用 `bg-surface-container-highest`。
- 默认宽度：`15.5rem`。
- 折叠宽度：`3rem`。

### Header Navigation

- 使用 `bg-surface-container-highest`。
- 高度：`3rem`。

### 边框与分割线

- `border-base` 只用于扁平、无海拔外壳，如默认输入框、嵌套次级扁平区域、空状态占位。
- 列表项、表格区域、卡片内部的分割线必须使用 `border-divider`。

## 4. Charts

- 图表组件默认提供图例、单位和坐标轴，不要手动画这些 UI。
- 把数据传给图表组件。
- 图表高度必须填满父容器，避免大面积留白。
- 图表数据 key 应转换为中文。
- 不要使用图表 `color` prop。

## 5. Images

当图片资源路径中有 `gradient=hex_start,hex_end` 时，将两个渐变色替换为本设计系统中的相关颜色。

## 6. Text

- 语义场景可以使用 `primary`、`success`、`warning`、`critical`、`error`、`info`、`inverse`。
- 保证可读性，不要把复杂纹理放在文字后面。

## 7. Iconography

主动使用图标作为视觉锚点，但图标必须服务于识别、状态或操作。

使用条件：

- 图标只用于导航锚点、工具操作、状态反馈、文件/模块/类别识别、数据指标锚点和空状态提示。
- 图标必须有明确业务含义，不能作为纯装饰、填空或视觉噪音。
- 图标按钮必须提供可理解的 tooltip 或 aria 名称。
- 图标和文字同时出现时，图标辅助识别，不能替代必要文字。

形态与尺寸：

- `w-6` 及以下使用 `outline` 或 `fill`。
- 大于 `w-6` 使用 `circle` 或 `square`。
- `outline`：常规 UI、内联文本、卡片标题、输入框、次级导航、表格、未选中状态。
- `fill`：激活态、反馈、破坏性操作。
- `circle`：全局成功/错误、空状态。
- `square`：数据指标、模块入口、Dashboard 锚点、文件类型。

颜色：

- 使用 `default | primary | success | warning | error | inverse`。
- 深色背景上使用 `inverse`。

约束：

- 不要手动给 `<Icon />` 包背景形状，Icon 组件会生成自己的内部容器。
- 图标形态必须和尺寸匹配。
- 同一导航、工具栏、表格操作列和状态区内图标风格必须一致。
- 禁止自绘临时图标、混用不同描边粗细、混用无关圆角或填充风格。
- 未经规范沉淀的图标不得作为系统级导航、状态或关键操作图标。


