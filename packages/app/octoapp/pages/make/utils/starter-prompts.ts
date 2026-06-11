export type StarterPrompt = {
  title: string
  tag: string
  prompt: string
}

export const FEATURED_STARTERS: StarterPrompt[] = [
  {
    title: "产品落地页",
    tag: "HTML",
    prompt:
      "创建一个科技产品落地页：Hero 区域包含标题、副标题、CTA 按钮，中间展示 3 个核心功能卡片，底部是客户证言和联系方式。风格现代简洁，配色使用蓝色系渐变。",
  },
  {
    title: "数据仪表盘",
    tag: "HTML",
    prompt:
      "设计一个后台管理仪表盘：左侧导航栏（Dashboard、Analytics、Settings），右侧主要内容区域包含 4 个统计卡片、一个折线图、一个数据表格。响应式布局，支持暗色主题。",
  },
  {
    title: "作品画廊",
    tag: "HTML",
    prompt:
      "创建一个作品展示画廊：网格布局展示 9 个项目缩略图，每个项目有标题和标签，点击缩略图弹出详情卡片。使用 CSS Grid 实现瀑布流效果，hover 时卡片微微上浮。",
  },
  {
    title: "信息图表",
    tag: "SVG",
    prompt:
      "设计一个数据可视化信息图：中心是环形图展示市场份额，左侧是 3 个关键指标卡片，右侧是时间线趋势图。配色使用橙色、绿色、蓝色三色系统，图标风格扁平化。",
  },
  {
    title: "产品演示",
    tag: "Deck",
    prompt:
      "创建一个 5 页产品演示文稿：第 1 页封面，第 2-4 页展示核心功能，第 5 页总结与 CTA。每页包含标题、要点列表、配图占位符。使用深色背景 + 白色文字，强调科技感。",
  },
  {
    title: "API 文档",
    tag: "Markdown",
    prompt:
      "生成一份 REST API 文档：包含接口概述、认证方式、端点列表（GET /users, POST /users, PUT /users/:id, DELETE /users/:id）、请求/响应示例、错误码说明。使用表格格式，清晰易读。",
  },
  {
    title: "可折叠卡片",
    tag: "React",
    prompt:
      "创建一个可折叠卡片组件：卡片头部显示标题和展开/收起按钮，点击按钮切换内容区域的显示/隐藏，支持同时展开多个卡片。使用 React hooks，添加平滑的展开动画。",
  },
]