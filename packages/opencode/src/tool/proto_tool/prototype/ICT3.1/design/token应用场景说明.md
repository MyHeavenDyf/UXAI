"extend": {
  "colors": {
    // ---- 核心品牌色组 ---- 
    // 当用户要求生成“主按钮(CTA)”、“高亮链接”、“选中的 Tab 页”时，AI 会调用此 Token。
    "primary": "#0067D1",
    // 用于上述主按钮内部的文字或图标，确保对比度（如 bg-primary text-on-primary）。
    "on-primary": "#FFFFFF",
    // 当需要生成“轻量级高亮区块”（如选中的列表项底色、品牌宣传卡片的浅色背景）时。
    "primary-container": "#E6F2FD",
    // 用于浅蓝色高亮区块内的文字，确保可读性。
    "on-primary-container": "#191919",
    // 生成不论亮暗模式都不变色的纯品牌色区块（如顶部的全宽导航栏 Header）。
    "primary-fixed": "#0067D1",
    // 生成固定区块的按下/悬浮加深状态。
    "primary-fixed-dim": "#004EA8", 
    // 固定区块上的主要文本。
    "on-primary-fixed": "#FFFFFF", 
    // 固定区块上的次要文本
    "on-primary-fixed-variant": "#F3F3F3", 

    // ---- 背景色组 ----
    // 生成整个网页的 body 背景。
    "surface": "#F3F3F3",
    // 生成与主内容区区分的暗色区块。
    "surface-dim": "#DFDFDF",
    // 生成悬浮在背景上的白色卡片（Card）、内容容器面板。
    "surface-bright": "#FFFFFF",
    // 生成大部分标准的正文、主标题文字（text-on-surface）。
    "on-surface": "#191919",
    // 生成次要的交互容器，如搜索输入框的底色（bg-surface-variant）。
    "surface-variant": "#F3F3F3",
    // 生成次要文本，如占位符（Placeholder）、日期、副标题。
    "on-surface-variant": "#777777",
    
    // ---- 基于空间Z层的进一步背景色组细分, 需配合提示词指导 ----
    // 底垫 - 如页面body
    "surface-container-lowest": "#F3F3F3",
    // 次底层容器 - 如毛玻璃容器
    "surface-container-low": "#FFFFFF", 
    // 中级背景  - 常规容器，如卡片
    "surface-container": "#FFFFFF", 
    // 次级上层 - 如浮动菜单面板
    "surface-container-high": "#FFFFFF", 
    // 最上层 - 如层级最高的模态弹窗
    "surface-container-highest": "#FFFFFF", 

    // ---- 用于构建深色组件 ----
    // 当用户要求“生成一个黑色的 Toast 提示”、“深色的 Tooltip 文字提示”时。
    "inverse-surface": "#191919",
    // 黑色 Toast 里面的主要白字。
    "inverse-on-surface": "#FFFFFF", 
    // 黑色 Toast 里面的次要白字。
    "inverse-on-surface-variant": "#C9C9C9", 
    // 黑色 上的品牌色
    "inverse-primary": "#0067D1", 

    // ---- 语义状态色组 (GenUI 核心意图识别区) ----
    // GenUI 场景：用户提示包含“报错”、“删除确认”、“失败”等负面意图时使用。
    "error": "#E02128", 
    "on-error": "#FFFFFF", 
    // 报错的 Alert 提示框底色。
    "error-container": "#FEE7E8", 
     // 报错提示框里的文字。
    "on-error-container": "#191919",

    // 用户提示包含“成功”、“完成”、“通过”等积极意图时使用。
    // 绿色的对勾图标、成功徽标（Badge）。
    "success": "#09AA71", 
    "on-success": "#FFFFFF",
    // 成功的 Alert 提示框底色。
    "success-container": "#E7FBF2", 
    "on-success-container": "#191919",

    // 用户提示包含“严重警告”、“资源耗尽”、“不可逆操作”等紧急意图时使用。
    // 橙色/紧急警报徽标。
    "critical": "#F4840C",  
    "on-critical": "#FFFFFF",
    "critical-container": "#FEF5E8",
    "on-critical-container": "#191919",

    // 用户提示包含“注意”、“说明”、“免责”等中等警告意图时使用。
    // 黄色警告图标。
    "warning": "#FCC800",
    "on-warning": "#FFFFFF",
    // 警告 Alert 提示框底色。
    "warning-container": "#FEFCE0", 
    "on-warning-container": "#191919",

    // 用户提示包含“提示”、“新消息”、“系统通知”等中立意图时使用。
    "info": "#0067D1",
    "on-info": "#FFFFFF",
    // 通知类 Alert 提示框底色。
    "info-container": "#E6F2FD", 
    "on-info-container": "#191919"
  },
  "spacing": {
    // 水平排列元素时的极小间距（如：按钮里的 Icon 和文字之间，Flex row 的 gap）。
    'inline': '0.5rem',
    // 垂直堆叠元素时的标准间距（如：表单的 Label 和 Input 之间，Flex col 的 gap）。
    'stack': '0.75rem',
    // 生成网格布局（Grid）时，卡片与卡片之间的标准栏间距（Grid Gap）。
    'gutter': '1rem', 
    // 生成一个卡片（Card）或面板时，内部内容距离边框的默认内边距（Padding）。
    'inset': '1.5rem',
    // 生成落地页（Landing Page）时，大区块（Hero区、特性区、定价区）之间的超大垂直间距。
    'section': '3rem', 
    // 生成页面最外层容器时，距离屏幕左右边缘的安全留白。
    'page': '4rem'    
  },
  "boxShadow": {
    // 基础值设定 - 初级阴影
    'sm': '1px 1px 6px 0 rgba(0, 0, 0, 0.08)',
    // 基础值设定 - 按钮或卡片的悬浮（Hover）状态，使其看起来被“拿起来”了。
    'md': '0 4px 12px 0px rgba(0, 0, 0, 0.16)',
    // 基础值设定 - 生成下拉菜单（Dropdown）或相对定位的浮动面板。
    'lg': '0 8px 24px 0px rgba(0, 0, 0, 0.16)',
    // 基础值设定 - 生成屏幕居中的超大模态弹窗（Modal Dialog）。
    'xl': '0 16px 48px 0px rgba(0, 0, 0, 0.16)',
    // 语义化调用，当用户明确要求“生成一个卡片”时，AI 直接使用此阴影。
    'card': '1px 1px 6px 0 rgba(0, 0, 0, 0.08)',     
    // 语义化调用，当用户要求“生成一个 Popover 气泡/工具提示”时，AI 直接使用此阴影。
    'popover': '0 8px 24px 0px rgba(0, 0, 0, 0.16)', 
    // 语义化调用，当用户要求“生成一个确认弹窗”时，AI 直接使用此阴影。
    'modal': '0 16px 48px 0px rgba(0, 0, 0, 0.16)'  
  },
  "borderColor": {
    // 基础值设定 - 生成标准输入框（Input）、卡片（Card）的默认描边。
    'base': '#C9C9C9',    
    // 语义化调用，生成列表间的分割线（hr）、表格内部的网格线。
    'divider': '#F3F3F3',  
    // 语义化调用，输入框被点击激活（Focus）、单选框被选中（Checked）时的品牌色描边。
    'selected': '#0067D1',  
    // 语义化调用，表单未通过校验时，输入框变红的描边。
    'error': '#E02128',   
  },
  "borderRadius": {
    // 基础值设定 - 生成需要直角拼接的 UI，如贴边的全宽横幅。
    'none': '0px',
    // 基础值设定 - 生成极小的 UI 控件，如复选框（Checkbox）。
    'sm': '2px', 
    // 基础值设定 - 基础圆角，通常用于输入框（Input）或小标签（Tag）。
    'md': '4px',
    // 基础值设定 - 大圆角，用于图片遮罩或部分按钮。
    'lg': '6px',
    // 基础值设定 - 超大圆角，用于现代风格的卡片组件。
    'xl': '8px',
    // 基础值设定 - 生成“药丸形状”的标签（Pill Badge）或完全正圆的用户头像（Avatar）。
    'full': '9999px',
    // 语义化调用，生成红点、未读数等角标标识。
    'badge': '4px',    
    // 语义化调用，生成按钮（Button）、切换器（Toggle）等动作触发器。
    'action': '4px',  
    // 语义化调用，生成数据看板的块级容器或文章卡片容器。
    'container': '8px',
    // 语义化调用，生成浮层（Tooltip/Popover/Modal）的圆角。
    'overlay': '8px'  
  },
  "outlineColor": {
    // 无障碍场景下，生成的聚焦发光外圈颜色。
    'brand': '#0067D1',
    // 无障碍场景下，错误状态下的聚焦外圈。
    'error': '#E02128'
  },
  "outlineWidth": {
    // 无障碍场景下，外圈的粗细（如 focus-visible:outline-focus）。
    'focus': '1px',
  },
  "outlineOffset": {
    // 无障碍场景下，让外圈不要紧贴组件边缘，留出2px的呼吸感空间。
    'gap': '2px',
  },
  // 字号与行高协同 -- 进一步设定需配合提示词
  "fontSize": {
    // 生成时间戳、底部免责声明、表格附加信息。
    "sm": ["12px", { "lineHeight": "1.6" }],
    // 生成文章正文、表格里的普通数据文字。
    "md": ["14px", { "lineHeight": "1.5" }],
    // 生成表单字段标题（Label）、按钮文字。
    "lg": ["16px", { "lineHeight": "1.5" }],
    // 生成常规卡片的标题（Card Title）。
    "xl": ["18px", { "lineHeight": "1.5" }],
    // 生成侧边栏模块标题、次级内容块标题（H3）。
    "2xl": ["20px", { "lineHeight": "1.4" }],
    // 生成模态弹窗主标题、页面内部区块主标题（H2）。
    "3xl": ["24px", { "lineHeight": "1.4" }],
    "4xl": ["28px", { "lineHeight": "1.4" }],
    // 以下通常用于生成落地页（Landing Page）头部的巨大英雄标语（Hero Text / H1）。
    "5xl": ["36px", { "lineHeight": "1.4" }],
    "6xl": ["48px", { "lineHeight": "1.3" }],
    "7xl": ["60px", { "lineHeight": "1.3" }],
    "8xl": ["72px", { "lineHeight": "1.2" }],
    "9xl": ["96px", { "lineHeight": "1.2" }]
  }
}