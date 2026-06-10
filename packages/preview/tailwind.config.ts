import type { Config } from 'tailwindcss'

export default {
  content: [
    './index.html',
    './src/**/*.{vue,js,ts,jsx,tsx}',
    './src/jsonStorage/*.json',
    '../test-project/test/**/*.json'
  ],
  theme: {
    "extend": {
      "colors": {
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
        "surface-variant": "rgba(192,192,192,0.2)",
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
        "divider": "#F3F3F3"
      },
      "spacing": {
        'inline': '0.5rem',
        'stack': '0.75rem',
        'gutter': '1rem', 
        'inset': '1.5rem',
        'section': '1rem', 
        'page': '2rem'    
      },
      "boxShadow": {
        'sm': '1px 1px 6px 0 rgba(0, 0, 0, 0.08)',
        'md': '0 4px 12px 0px rgba(0, 0, 0, 0.16)',
        'lg': '0 8px 24px 0px rgba(0, 0, 0, 0.16)',
        'xl': '0 16px 48px 0px rgba(0, 0, 0, 0.16)',
        'card': '1px 1px 6px 0 rgba(0, 0, 0, 0.08)',     // 贴地微浮：数据卡片、白底区块
        'popover': '0 8px 24px 0px rgba(0, 0, 0, 0.16)', // 中层悬浮：下拉菜单、Tooltip、日历选择器
        'modal': '0 16px 48px 0px rgba(0, 0, 0, 0.16)'   // 居中模态框、侧边抽屉
      },
      "borderColor": {
        'base': '#C9C9C9',      // Input常态、内部无阴影的次级区块、扁平Tag的外框
        'divider': '#F3F3F3',   // 分割线、内部结构线
        'selected': '#0067D1',  // 组件或者容器选中态
        'error': '#E02128',     // 表单校验未通过、破坏性弹窗的警戒边界
      },
      "borderRadius": {
        'none': '0px',
        'sm': '2px', 
        'md': '4px',
        'lg': '6px',
        'xl': '8px',
        'full': '9999px',
        'badge': '4px',    // 用于 Tag、Tooltip 等微小辅助信息
        'action': '4px',   // 用于 Button、Input、Select 等可点击交互控件
        'container': '8px',// 用于 Card、Accordion 等内容承载面板
        'overlay': '8px'   // 用于 Modal、Drawer、Dropdown 等全局悬浮层
      },
      "outlineColor": {
        'brand': '#0067D1',
        'error': '#E02128'
      },
      "outlineWidth": {
        'focus': '1px',
      },
      "outlineOffset": {
        'gap': '2px',
      },
      "fontSize": {
        "xs": ["10px", { "lineHeight": "1.8" }],
        "sm": ["12px", { "lineHeight": "1.6" }],
        "md": ["14px", { "lineHeight": "1.5" }],
        "lg": ["16px", { "lineHeight": "1.5" }],
        "xl": ["18px", { "lineHeight": "1.5" }],
        "2xl": ["20px", { "lineHeight": "1.4" }],
        "3xl": ["24px", { "lineHeight": "1.4" }],
        "4xl": ["28px", { "lineHeight": "1.4" }],
        "5xl": ["36px", { "lineHeight": "1.4" }],
        "6xl": ["48px", { "lineHeight": "1.3" }],
        "7xl": ["60px", { "lineHeight": "1.3" }],
        "8xl": ["72px", { "lineHeight": "1.2" }],
        "9xl": ["96px", { "lineHeight": "1.2" }]
      }
    }
  },
} satisfies Config