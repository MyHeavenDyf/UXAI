# Octo Agent UI Design

本文档是 Octo Agent 产品级 UI 设计规范，用于约束当前项目 UI 层面的视觉、布局、组件、交互、内容和工程实现方式。文档面向长期演进，不绑定单一设计文件或单个页面快照。

参考基线采用业界成熟设计系统的通用结构：Principles -> Foundations/Tokens -> Components -> Patterns -> Accessibility -> Implementation -> Review。主要对齐对象包括 Atlassian Design System、Google Material Design、IBM Carbon Design System、NN/g 可用性原则。

## 1. 文档目的与适用范围

本文档约束 Octo Agent 当前 UI 层实现，尤其是 `packages/app` 和 `packages/ui` 中与主工作台、会话、输入、导航、侧栏相关的界面。

适用范围：

- Chat / Cowork / Studio 顶部模式切换。
- 左侧会话导航、历史记录、新对话、设置入口。
- Chat 首页空状态、欢迎区、Prompt 输入框、模型选择、发送入口。
- 搜索入口、用户头像、Logo、品牌识别元素。
- 基于当前视觉语言新增的同类页面、同类面板和同类组件状态。

不适用范围：

- 终端渲染、代码 Diff 内容区、Markdown 语法高亮等已有强业务组件，除非它们需要与 Octo Agent 顶层框架统一。
- 营销官网、文档站、外部品牌落地页。
- 与主工作台无直接关系的复杂业务流程，除非后续被纳入 Octo Agent 通用产品体验。

## 2. 设计原则

### 2.1 工作台优先

Octo Agent 是面向 AI 协作和任务执行的工作界面，不是营销型首页。首屏应直接呈现可操作区域，避免大面积宣传式内容、装饰性卡片和非必要插画。

### 2.2 低干扰

界面默认保持白底、低对比灰、轻边框、少阴影。强调色只用于当前选中、输入聚焦、可执行主操作和关键反馈。

### 2.3 信息密度适中

导航、历史列表、输入区应紧凑但不拥挤。主区域保持足够留白，用来突出用户当前任务和输入焦点。

### 2.4 状态明确

所有可交互元素必须有明确的 hover、active、selected、focus 和 disabled 状态。状态变化应靠颜色、边框、背景或轻微阴影表达，不依赖大幅动效。

### 2.5 设计和代码同源

产品视觉规范定义体验目标，项目 token 和组件定义实现边界。实现时优先落到 `@opencode-ai/ui` 已有 token、CSS variables、Tailwind v4 theme 和 Solid 组件习惯，而不是逐像素硬编码一次性样式。

## 3. 产品体验定位

Octo Agent 的界面气质是「轻量、清晰、可持续使用的 AI 工作台」。

关键词：

- 清爽：白色主画布、浅灰分隔、少量蓝色强调。
- 专注：中心输入区是首要注意力区域。
- 可信：布局稳定、状态可预期、不会用强装饰抢占任务注意力。
- 效率：顶部模式切换、侧栏历史、搜索和输入都在固定位置，降低重复操作成本。
- AI 感：通过轻量渐变、柔和发光和圆形空状态资产表达智能感，但不能让界面变成视觉展示页。

## 4. 信息架构与页面骨架

Octo Agent 主工作台以桌面端 Chat 首页空状态为基础形态，标准桌面设计基准为 `1922 x 1080`。

页面骨架：

- 顶部全局栏：高度 `64px`，承载窗口控制、Logo、模式切换、搜索、用户头像。
- 左侧 Chat 侧栏：宽度 `296px`，从顶部栏下方开始，承载当前模块标题、新对话、历史记录、底部设置。
- 主内容区：占据剩余宽度，白色背景，承载空状态欢迎区和 Prompt 输入框。
- 中央欢迎区：居中布局，包含 AI 视觉资产、标题和辅助文案。
- Prompt 输入框：位于欢迎区下方，固定宽度 `660px`，高度 `130px`，是首屏主操作区。

结构层级：

```text
App Shell
  Top Bar
    Brand Area
    Mode Switcher
    Search + User
  Body
    Sidebar
      Current Section
      New Chat
      History
      Settings
    Main
      Empty State
      Prompt Composer
```

## 5. Layout 与响应式规范

### 5.1 桌面基础布局

桌面优先尺寸基准：

| 区域 | 规范 |
| --- | --- |
| Top Bar | 高 `64px`，左右 padding `24px` |
| Sidebar | 宽 `296px`，padding `12px` |
| Sidebar item | 高 `36px` 或 `44px`，水平 padding `12px` |
| Main | 占剩余空间，内容水平居中 |
| Empty visual | 宽约 `270px`，欢迎区整体宽 `280px` |
| Prompt Composer | 宽 `660px`，高 `130px`，padding `16px 20px` |
| Search | 宽 `246px`，高 `32px` |
| Mode Switcher | 高 `28px`，内部 item 高 `24px` |

### 5.2 间距系统

实现应优先使用项目 `--spacing: 0.25rem` 派生的 Tailwind 间距。

常用间距：

| 基准值 | Tailwind 建议 | 用途 |
| --- | --- | --- |
| `2px` | `p-0.5` | segmented control 外层 padding |
| `4px` | `gap-1` / `p-1` | 列表组内间距、模型胶囊内部 |
| `8px` | `gap-2` / `px-2` | 小控件、图标与文字 |
| `12px` | `gap-3` / `p-3` | 侧栏 item、侧栏容器 |
| `16px` | `gap-4` / `px-4` | 顶栏搜索、输入框内边距 |
| `24px` | `gap-6` / `px-6` | 顶栏左右、主块间距 |

### 5.3 响应式策略

宽屏和桌面：

- 保持顶部栏和左侧栏固定。
- 主内容区水平居中。
- Prompt 输入框优先保持 `660px` 宽度。

中等宽度：

- Prompt 输入框宽度改为 `min(660px, calc(100vw - sidebar - 96px))`。
- 顶部搜索可收缩到图标按钮或隐藏占位文案。
- Mode Switcher 保持居中，但允许轻微偏移以避免与右侧搜索冲突。

窄屏：

- Sidebar 进入抽屉或折叠态，默认只保留当前页面主内容。
- Top Bar 中 Logo、Mode Switcher、User 保留，搜索降级为图标入口。
- Prompt Composer 宽度为 `calc(100vw - 32px)`，高度可增至 `auto`，最小高度不低于 `112px`。

## 6. Design Tokens

### 6.1 Token 使用原则

新增 UI 不应直接复制参考视觉值中的全部 hex 和 rgba。实现顺序：

1. 先查找 `packages/ui/src/styles/theme.css` 和 `packages/ui/src/styles/tailwind/colors.css` 是否已有语义 token。
2. 能表达语义时，使用 `var(--text-strong)`、`var(--border-weak-base)`、`var(--surface-interactive-base)` 等变量。
3. 只有产品特有的品牌强调效果，如输入框紫蓝边框和阴影，可定义局部组件变量。
4. 不为单一页面创建过多全局 token；只有复用超过两个场景时再提升为全局 token。

### 6.2 视觉基准到项目 Token 映射

| 视觉基准值 | 语义 | 项目建议 |
| --- | --- | --- |
| `#ffffff` | 主背景、顶栏背景 | `var(--surface-strong)` 或 `bg-surface-strong` |
| `#191919` | 主文本 | `var(--text-strong)` 或 `text-text-strong` |
| `#6e737a` | 次级文本、placeholder | `var(--text-base)` 或 `text-text-base`，必要时局部调整 |
| `rgba(0,0,0,0.08)` | 轻分隔线 | `var(--border-weak-base)` |
| `rgba(25,25,25,0.04)` | 侧栏选中/按钮浅背景 | `var(--surface-base)` |
| `#f2f2f2` / `#f3f3f3` | 搜索、segmented 背景 | `var(--background-weak)` 或 `var(--surface-base)` |
| `#0a59f7` | 产品主蓝 | `var(--text-interactive-base)` / `var(--border-selected)` |
| `#b055ca` | 输入框紫色边框 | `--octo-composer-border-accent` 局部变量 |
| `rgba(10,89,247,0.8)` | 输入框蓝色发光 | `--octo-composer-glow` 局部变量 |

### 6.3 圆角

项目全局圆角来自 `--radius-xs` 到 `--radius-xl`：

| 圆角 | 用途 |
| --- | --- |
| `4px` / `--radius-sm` | 小菜单项、列表状态 |
| `6px` / `--radius-md` | 标准按钮、输入、浮层内部项 |
| `8px` / `--radius-lg` | 侧栏选中项、较大列表块 |
| `10px` / `--radius-xl` | 弹层、重点面板 |
| `12px` | Prompt Composer 等品牌强调输入容器，可用局部样式 |
| `999px` | 胶囊、segmented control、头像 |

默认不要把普通页面 section 做成大圆角卡片。

### 6.4 阴影

默认界面少用阴影。阴影只用于：

- Prompt Composer 聚焦和强调态。
- 浮层、菜单、弹窗。
- 拖拽、悬浮、临时层级。

普通侧栏 item、顶部栏、搜索框不使用明显投影。

## 7. 色彩系统

### 7.1 视觉基调

界面以白色、浅灰、低透明黑作为基础。蓝色是主交互色，紫蓝渐变只用于 AI 输入聚焦和品牌化强调。

色彩使用比例建议：

- 白色和近白背景：约 `80%+`。
- 灰阶文字、边框、控件背景：约 `15%`。
- 蓝色和紫色强调：不超过 `5%`。

### 7.2 文本颜色

| 层级 | 用途 | 推荐 |
| --- | --- | --- |
| Primary | 标题、当前项、用户可读主内容 | `var(--text-strong)` |
| Secondary | 辅助文案、placeholder、历史标题默认态 | `var(--text-base)` |
| Tertiary | 弱提示、禁用信息、元信息 | `var(--text-weak)` |
| Interactive | 当前模式、可点击强调 | `var(--text-interactive-base)` |

### 7.3 背景与边框

| 场景 | 规范 |
| --- | --- |
| App 主背景 | 白色或 `surface-strong`，不使用深色大面积背景 |
| Top Bar | 白色，底部分隔线 `1px` |
| Sidebar | 白到浅蓝渐变，可作为模块识别背景 |
| Search | 浅灰胶囊背景，无强边框 |
| Segmented Control | 外层浅灰，选中项白底 |
| Prompt Composer | 白底，紫色描边，蓝色发光阴影 |

### 7.4 渐变

左侧栏背景：

```css
linear-gradient(166deg, #ffffff 0%, #fdfeff 48%, #e9f5ff 99%)
```

使用规则：

- 仅用于一级侧栏或同等级背景。
- 不扩展为大面积页面背景。
- 不和其他强渐变叠加。

输入框强调：

```css
border: 1.2px solid #b055ca;
box-shadow: 0 4px 8px rgba(10, 89, 247, 0.8);
```

实现时应降噪处理，避免在实际 UI 中过亮：

```css
--octo-composer-border-accent: #b055ca;
--octo-composer-glow: rgba(10, 89, 247, 0.32);
```

## 8. 字体与排版

产品视觉基准使用接近 HarmonyOS Sans 的现代无衬线气质。当前项目支持用户配置字体，并在 `packages/ui/src/styles/theme.css` 中通过 `--font-family-sans` 和 `--font-family-mono` 管理。因此实现不强制引入 HarmonyOS Sans。

### 8.1 字体

| 字体角色 | 推荐 |
| --- | --- |
| UI Sans | `var(--font-family-sans)` |
| Code / Terminal | `var(--font-family-mono)` |
| Logo / 图片文字 | 使用资产，不用运行时字体模拟 |

### 8.2 字号

| 场景 | 视觉基准 | 项目建议 |
| --- | --- | --- |
| Top Bar tab | `14px` | `text-base` |
| Sidebar section title | `16px` bold | `text-lg font-medium` 或组件标题样式 |
| Sidebar item | `14px` | `text-base` |
| Empty title | `24px` semibold | 页面中心标题可局部使用 `24px` |
| Empty subtitle | `14px` | `text-base text-text-base` |
| Model pill | `12px` | `text-sm` |

### 8.3 行高

- `12px` 文本使用 `18px` 行高。
- `14px` 文本使用 `20px` 行高，顶部 tab 可使用紧凑行高。
- `16px` 标题使用 `24px` 行高。
- `24px` 标题使用 `36px` 行高。

### 8.4 文案长度

- Sidebar item 单行显示，超长省略。
- Search placeholder 不超过 16 个中文字符或 32 个英文字符。
- Empty subtitle 不超过一行，避免解释性段落。
- Prompt placeholder 可以稍长，但必须保持输入区首行可读。

## 9. 图标与品牌资产

### 9.1 图标尺寸

| 场景 | 尺寸 |
| --- | --- |
| 顶部 tab 图标 | `16px` |
| 侧栏图标 | `16px` |
| 搜索图标 | `16px` |
| 添加附件 | `20px` |
| 发送按钮 | `24px` |
| 用户头像 | `28px` |

### 9.2 使用规则

- 图标和文字间距默认 `8px`，侧栏标题和列表项可用 `12px`。
- 图标按钮必须有可访问名称。
- 不新增图标包。优先使用项目已有图标系统或产品资产。
- 图标颜色继承当前文本状态，除非品牌图标或头像资产本身带颜色。

### 9.3 Logo

顶部 Logo 区域由窗口控制点和 Octo AI 标识组成。Logo 不应被压缩变形，不应被放进卡片，不应被替换成纯文本。

## 10. 核心组件规范

### 10.1 Top Bar

结构：

- 左侧：窗口控制点 + Octo AI Logo。
- 中间：Chat / Cowork / Studio segmented control。
- 右侧：搜索框 + 用户头像。

规范：

- 高度固定 `64px`。
- 底部分隔线 `1px`。
- 左右 padding `24px`。
- 中间模式切换在桌面保持视觉居中。
- 右侧搜索在空间不足时优先收缩或折叠。

### 10.2 Segmented Control

结构：

- 外层容器：浅灰背景、圆形胶囊、padding `2px`。
- Item：高 `24px`，左右 padding `16px`，gap `8px`。
- Selected：白底、蓝色图标和文字。
- Unselected：透明背景、弱文本。

状态：

| 状态 | 视觉 |
| --- | --- |
| Default | 透明背景，`text-base` |
| Hover | 浅灰背景或文字加深 |
| Selected | 白底，`text-interactive-base` |
| Focus | 可见 focus ring，不能只靠颜色 |

### 10.3 Search

结构：

- 胶囊容器 `246 x 32px`。
- 左侧 `16px` 搜索图标。
- placeholder：`搜索Assets Hub`。

规范：

- 背景浅灰。
- 无明显边框。
- 文字使用次级色。
- 可聚焦后显示边框或 ring。

### 10.4 Sidebar

结构：

- 宽 `296px`。
- 内部 padding `12px`。
- 顶部内容与底部设置之间使用空间分配。

背景：

- 使用白到浅蓝渐变。
- 右侧用 `1px` 分隔线。

内容层级：

- 当前模块标题：Chat，图标 + `16px` bold。
- 新对话：高 `44px`，浅灰选中块。
- 历史记录标签：弱文本。
- 历史项：单行文字，默认无背景。
- 设置：固定在底部。

### 10.5 Sidebar Item

尺寸：

- 默认高 `36px`。
- 新对话高 `44px`。
- 圆角 `8px`。
- 水平 padding `12px`。

状态：

| 状态 | 视觉 |
| --- | --- |
| Default | 透明背景，主文本 |
| Hover | 浅灰背景 |
| Selected | `rgba(25,25,25,0.04)` 或 token 等价背景 |
| Disabled | 降低透明度，禁用 pointer |

文本：

- 单行省略。
- 不换行撑高。
- 历史标题不加粗。

### 10.6 Empty State

结构：

- 顶部 AI 视觉资产，约 `270 x 239px`。
- 标题 `Octo Agent`。
- 副文案 `有任何想法您都可以通过下方输入框输入`。

规范：

- 整体宽 `280px`。
- 居中于主内容区。
- 视觉资产不应被替换成抽象 SVG 装饰，除非来自同一设计语言资产库。
- 标题和副文案之间间距 `8px`。
- Empty State 不承载操作按钮，主操作在 Prompt Composer。

### 10.7 Prompt Composer

结构：

- 外层输入容器。
- 顶部输入文本区域。
- 左下附件按钮。
- 左下模型选择胶囊。
- 右下发送按钮。

尺寸：

- 桌面宽 `660px`。
- 高 `130px`。
- 圆角 `12px`。
- padding `16px 20px`。

视觉：

- 白底。
- 紫色边框。
- 聚焦或默认强调可显示蓝色发光，但实际强度应保持克制，避免影响长时间使用。

行为：

- placeholder 位于左上。
- 发送按钮固定右下。
- 模型选择固定左下，紧随附件按钮之后。
- 输入内容增多时，文本区域内部滚动或容器适度增高，不允许底部 controls 被覆盖。

### 10.8 Model Pill

结构：

- 胶囊背景 `#f3f3f3` 或 token 等价。
- 文本 `MiniMax 2.5`。
- 右侧下箭头。

规范：

- 高约 `26px`。
- padding `4px 8px`。
- gap `4px`。
- 字号 `12px`。
- 点击打开模型选择菜单。

### 10.9 Send Button

规范：

- 视觉尺寸 `24px`。
- 位于 Composer 右下。
- 可用蓝色圆形或图标资产表达主操作。
- 禁用态降低透明度，并不可点击。
- 发送中状态需阻止重复提交。

## 11. 组合模式 / 页面模式

### 11.1 App Shell 模式

App Shell 必须保持稳定：

- Top Bar 固定在顶部。
- Sidebar 固定在左侧。
- Main 区域独立滚动或内部管理滚动。
- 主内容不应穿透到顶栏或侧栏下方。

### 11.2 Chat 首页空状态

当没有当前对话或新对话为空时：

- 显示 Empty State。
- Prompt Composer 保持可输入。
- 历史列表仍可访问。
- 不显示空白解释页或 onboarding 卡片。

### 11.3 有会话内容状态

后续会话内容页应继承：

- 同样的 Top Bar 和 Sidebar。
- Composer 位于主内容底部或当前会话流程要求的位置。
- 消息内容区保持中等宽度，不要横向铺满整屏导致阅读困难。

### 11.4 搜索模式

搜索入口不应抢占主输入。打开后可作为顶部局部搜索、浮层搜索或全局命令面板，但必须保持返回路径清晰。

## 12. 交互状态与反馈

### 12.1 状态清单

每个可点击组件必须覆盖：

- Default。
- Hover。
- Active / Pressed。
- Focus visible。
- Selected。
- Disabled。
- Loading，若触发异步行为。

### 12.2 Focus

Focus 状态必须键盘可见。推荐使用项目已有 focus ring 或 shadow token，不允许只通过极浅背景表达。

### 12.3 Selected

Selected 表示当前上下文，例如当前顶部模式、当前会话、当前列表项。Selected 不等于 hover，不能只在 hover 时出现。

### 12.4 Loading

Loading 应局部发生：

- 发送消息时，发送按钮进入 loading 或 disabled。
- 搜索时，搜索框或结果区显示加载。
- 不用全屏 loading 覆盖整个工作台，除非应用初始化。

### 12.5 Error

错误反馈应靠近发生区域：

- 输入发送失败：Composer 附近提示。
- 模型不可用：Model Pill 或模型菜单提示。
- 搜索失败：搜索结果区提示。

## 13. 动效规范

动效原则：

- 快：常规过渡 `120ms - 200ms`。
- 克制：只用于状态变化、浮层出现、列表选择反馈。
- 可中断：用户快速操作时不阻塞。
- 可降级：尊重 `prefers-reduced-motion`。

推荐：

- Hover 背景渐变：`120ms`。
- Focus ring / shadow：`160ms`。
- Popover 出现：`160ms`，轻微透明度和位移。
- 列表选中：即时或 `120ms`。

避免：

- 大面积循环背景动画。
- 与输入焦点无关的发光动画。
- 页面切换时大幅缩放、旋转、弹跳。

## 14. 内容设计规范

### 14.1 语气

文案应直接、简短、偏工具语气。避免营销化表达，避免过度拟人。

推荐：

- `新对话`
- `历史记录`
- `搜索 Assets Hub`
- `有任何想法您都可以通过下方输入框输入`

避免：

- `开启你的超凡 AI 灵感之旅`
- `让我们一起创造奇迹`
- `点击这里体验前所未有的智能生产力`

### 14.2 Placeholder

Prompt placeholder 应说明可输入的内容类型或当前任务方向。

规则：

- 使用一句话。
- 不超过 `28` 个中文字符为宜。
- 不放键盘快捷键说明。
- 不使用感叹号。

示例：

- `上传访谈逐字稿、访谈大纲、智能构建用户画像`
- `描述你的目标，Octo Agent 会帮你拆解任务`

### 14.3 导航文案

- 顶部模式使用英文短词：Chat、Cowork、Studio。
- 侧栏功能入口使用中文：新对话、历史记录、设置。
- 混排时保持空格，如 `搜索 Assets Hub`，除非产品命名要求无空格。

### 14.4 历史标题

历史标题来自用户内容或自动总结：

- 单行显示。
- 超长省略。
- 不展示时间戳，除非列表进入更完整历史管理视图。
- 不使用引号包裹。

## 15. 可访问性规范

### 15.1 键盘可达

必须支持键盘访问：

- Top Bar 模式切换。
- Search。
- User menu。
- Sidebar items。
- New Chat。
- Settings。
- Prompt input。
- Model selector。
- Attachment button。
- Send button。

Tab 顺序应按视觉阅读顺序：Top Bar -> Sidebar -> Main input，或在实际应用布局中保持用户预期。

### 15.2 语义

- 可点击元素使用 `button` 或具备等价语义。
- 输入区域使用 `textarea` 或内容编辑器时提供可访问名称。
- 图标按钮必须有 `aria-label`。
- 当前选中模式可使用 `aria-pressed`、`aria-current` 或 tabs 语义，取决于实现组件。

### 15.3 对比度

- 正文和关键操作文本需满足 WCAG AA 对比度。
- Placeholder 可弱化，但不能低到不可读。
- Focus ring 必须在白底和浅蓝侧栏背景上都可见。
- 蓝色强调不能只靠颜色传达状态，应配合背景、边框或语义属性。

### 15.4 Reduced Motion

对 `prefers-reduced-motion: reduce`：

- 禁用非必要位移动画。
- 保留即时状态变化。
- 不影响 hover、focus 和 selected 可见性。

## 16. 工程实现约束

### 16.1 技术栈

当前项目相关前端技术：

- Bun monorepo。
- `packages/app`：Solid + Vite。
- `packages/ui`：共享 UI 组件、CSS、theme、icons。
- Tailwind v4，通过 `@opencode-ai/ui/styles/tailwind` 引入。
- CSS variables 管理主题、字体、色彩和 radius。

### 16.2 实现优先级

实现顺序：

1. 复用 `packages/ui` 已有组件。
2. 使用现有 Tailwind token 类。
3. 使用现有 CSS variables。
4. 在具体组件中定义局部 CSS variables。
5. 最后才使用参考视觉值中的原始 hex / rgba。

### 16.3 Solid 约束

- 外部生成的 React / Tailwind 片段只能作为视觉参考，不能作为当前项目的最终实现形态。
- 组件实现应使用 Solid 写法。
- 遵循仓库风格：少 `let`、少不必要类型标注、避免 `any`、避免无必要 `try/catch`。
- 组件状态优先与现有 app 状态管理方式一致。

### 16.4 CSS 约束

- 不引入新的 Tailwind 依赖。
- 不新增全局 reset。
- 不为单个页面创建过多全局 class。
- 可复用组件样式放在 `packages/ui/src/components` 同类 CSS。
- App 特定布局样式可放在 `packages/app/src/index.css` 或相邻组件样式中。

### 16.5 资产约束

- 产品图片和 SVG 资产如果需要长期使用，应进入项目资产目录。
- 不依赖临时外部 asset URL。
- 品牌 Logo、AI 空状态视觉、头像等资产不得用近似占位图替代。

## 17. 设计到代码的映射规则

### 17.1 尺寸映射

可以精确保留：

- Top Bar `64px`。
- Sidebar `296px`。
- Prompt Composer `660 x 130px`。
- Search `246 x 32px`。
- Avatar `28px`。
- 常规图标 `16px`。

可以 token 化：

- padding、gap、radius、font-size。
- 边框颜色、文字颜色、浅背景。

### 17.2 视觉差异处理

当产品视觉基准与项目 token 冲突：

1. 如果影响品牌识别或核心交互，优先保持产品视觉一致。
2. 如果只是灰阶、弱背景、边框，优先使用项目 token。
3. 如果参考阴影过强，允许降低透明度以满足长时间使用舒适度。
4. 如果指定字体不可用，使用 `--font-family-sans`。
5. 如果所需图标不在项目资产中，优先导入产品资产，不安装新图标包。

### 17.3 命名建议

命名应表达职责：

- `AppTopBar`
- `ModeSwitcher`
- `SessionSidebar`
- `SessionHistoryItem`
- `ChatEmptyState`
- `PromptComposer`
- `ModelSelectorPill`

避免命名：

- `Frame92`
- `Group30096`
- `BlueThing`
- `NewDesignComponent`

## 18. Do / Don't

### 18.1 Do

- 使用稳定的 App Shell。
- 保持输入框为主操作焦点。
- 使用轻边框和低对比背景区分区域。
- 为所有图标按钮提供 label。
- 让历史列表单行省略。
- 让顶部模式切换具备明确 selected 状态。
- 用项目 token 实现产品视觉。

### 18.2 Don't

- 不把主界面改成营销 landing page。
- 不在页面 section 外层套大型浮动卡片。
- 不滥用强阴影、强渐变、发光背景。
- 不用大段说明文字占据首屏。
- 不把所有灰色都硬编码成参考视觉值。
- 不安装新的图标库来复刻几个图标。
- 不让输入框 controls 被输入内容覆盖。
- 不让窄屏出现文字挤压、按钮溢出或侧栏遮挡主操作。

## 19. UI Review Checklist

提交 UI 变更前检查：

- [ ] Top Bar 高度、布局和分隔线符合规范。
- [ ] Sidebar 宽度、渐变、列表 item 高度和底部设置位置符合规范。
- [ ] Main 区域空状态视觉居中，不出现营销化卡片。
- [ ] Prompt Composer 尺寸、边框、controls 位置符合规范。
- [ ] 搜索框、模式切换、模型胶囊的圆角和间距符合规范。
- [ ] 所有可点击元素有 hover、active、focus、disabled 状态。
- [ ] 键盘 Tab 顺序可用。
- [ ] 图标按钮有可访问名称。
- [ ] 文本不溢出、不遮挡、不因中英文混排破坏布局。
- [ ] 窄屏下 Sidebar、Top Bar、Composer 不互相覆盖。
- [ ] 使用项目 token 或局部变量，未大量硬编码颜色。
- [ ] 未新增不必要依赖。
- [ ] 产品资产已本地化或通过项目资产系统管理。
- [ ] 视觉实现和本规范保持一致，偏差有明确理由。

## 20. 行业最佳实践对照

| 实践来源 | 核心关注 | 本文档对应章节 |
| --- | --- | --- |
| Atlassian Design System | Foundations、tokens、spacing、grid、color、typography、accessibility、content | 2、5、6、7、8、14、15 |
| Google Material Design | color、type、shape、components、motion、responsive、accessibility | 5、7、8、10、12、13、15 |
| IBM Carbon Design System | foundations、components、patterns、component states、accessibility checklist | 6、10、11、12、15、19 |
| NN/g usability principles | visibility of status、match with user expectations、consistency、error prevention、recognition over recall | 2、4、12、14、15、19 |

本文档不直接复制任何第三方设计系统的视觉语言，只采用其信息组织和质量门槛，并以 Octo Agent 产品体验目标和当前项目技术栈为最终约束来源。
