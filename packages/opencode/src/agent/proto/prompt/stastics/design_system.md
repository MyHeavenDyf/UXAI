# Design System

## 1. Design Token
所有页面元素使用Tailwind，并且在前端Tailwind extend中实现了如下扩展，你可以使用下列属性：

```json
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
    "surface-dim": "#FFFFFF",
    "surface-bright": "#FFFFFF",
    "on-surface": "#191919",
    "surface-variant": "rgba(192,192,192,0.2)",
    "on-surface-variant": "#777777",
    "surface-container-lowest": "#F3F3F3",
    "surface-container-low": "#FFFFFF",
    "surface-container": "#FFFFFF",
    "surface-container-high": "#FFFFFF",
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
    "content-placeholder": "#939393",
    "content-disabled": "#C9C9C9",
    "content-inverse-disabled": "#C9C9C9",
    "interactive-link": "#0067D1",
    "interactive-link-hover": "#004EA8",
    "interactive-link-active": "#003D83",
    "interactive-link-visited": "#715AFB",
    "interactive-link-disabled": "#C9C9C9",
    "scrim": "rgba(0, 0, 0, 0.4)",
    "outline": "#C9C9C9",
    "outline-variant": "#DFDFDF",
    "divider": "#DFDFDF",
    "focus-ring": "#0067D1",
    "base": "#C9C9C9",
    "selected": "#0067D1"
  },
  "spacing": {
    "inline": "0.5rem",
    "stack": "0.75rem",
    "gutter": "1rem",
    "inset": "1.5rem",
    "section": "1rem",
    "page": "2rem"
  },
  "boxShadow": {
    "sm": "0px 1px 6px 0 rgba(0, 0, 0, 0.08)",
    "base": "0 4px 12px 0 rgba(0, 0, 0, 0.16)",
    "md": "0 8px 24px rgba(0, 0, 0, 0.08)",
    "lg": "0 8px 24px 0 rgba(0, 0, 0, 0.16)",
    "xl": "0 16px 48px 0 rgba(0, 0, 0, 0.16)",
    "card": "1px 1px 6px 0 rgba(0, 0, 0, 0.08)",
    "popover": "0 8px 24px 0px rgba(0, 0, 0, 0.16)",
    "modal": "0 16px 48px 0px rgba(0, 0, 0, 0.16)"
  },
  "borderRadius": {
    "none": "0px",
    "xs": "2px",
    "base": "4px",
    "md": "6px",
    "lg": "8px",
    "xl": "12px",
    "full": "9999px",
    "badge": "4px",
    "action": "4px",
    "container": "8px",
    "overlay": "8px"
  },
  "outlineWidth": {
    "focus": "1px"
  },
  "outlineOffset": {
    "gap": "2px"
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
  },
  "fontFamily": {
    "sans": ["HarmonyOS Sans", "Microsoft YaHei", "Arial", "PingFang SC", "San Francisco", "sans-serif"]
  }
}
```

### 使用原则

- 语义优先：品牌、交互、文本、边框及 error / warning / critical / success / info 状态必须使用对应语义 Token，不得用其他颜色替代。
- 非语义色只用于不传达状态或操作含义的视觉丰富场景，如数据分类、图表序列、插图和装饰性背景；从项目已有色板 Token 中选择，控制数量并保持同类内容映射一致。
- 语义与装饰发生冲突时，以语义为准；不得为了丰富视觉改变状态含义或文字可读性。
- 图表使用项目 `chart-*` 序列色，不自行指定硬编码颜色；同一数据类别保持颜色映射一致。
- 图片渐变、插图和装饰背景使用项目已有色板 Token，不写 hex；文字和图标仍按其功能选择语义色，`inverse` 仅用于深色背景。
- 页面默认使用亮色体系，尤其不要自动生成深色侧边导航。

## 2. Elevation & Depth

We achieve spatial hierarchy through a precise combination of **Tonal Layering** and **Ambient Shadows**, avoiding heavy traditional borders.

### 2.1 The Layering Principle (Stacking Order)
Depth is established by stacking architectural tiers from back to front:
- **Level 0 (The Canvas):** Use `bg-surface-container-lowest` with no shadows. This is the absolute bottom layer (the page background).
- **Level 1 (Active Containers):** Use `bg-surface-container-highest` paired with `shadow-sm` (or `shadow-card`). Reserved for primary content containers: Data Cards, Tables, Navigations, and Drawers to make them "pop" forward.
- **Level 2 (Inner Sub-regions):** Use `bg-surface-variant`. Apply this *inside* Level 1 cards to visually separate internal functional blocks (e.g., inner lists, or nested form areas).

### 2.2 Text & Contrast Pairings
Always pair backgrounds with their strict `on-*` text tokens to maintain premium readability:
- On `surface-container-*` backgrounds ➔ Use `text-on-surface`.
- On `surface-variant` backgrounds ➔ Use `text-on-surface-variant`.

### 2.3 Semantic States (Status Indicator Layering)
To indicate semantic states (error, warning, success, info), apply the respective `bg-*-container` tokens as background tints.
**Crucially:** Always pair them with the corresponding `text-on-*-container` tokens (and use the base `*` token for icons if needed).

### 2.4 Strict UI Constraints (CRITICAL)
- **Mutual Exclusion:** NEVER combine a shadow with a structural border. If a container floats, it is borderless.
- **No Accent Strips:** Strictly NO left-border colored accent strips on cards or alerts. Use like `bg-error-container` instead.

## 3. Layout

### Content Container / Card

- Card 是布局容器，不是开发组件；使用 `div` 或 `section`。
- 使用 `bg-surface-container-highest rounded-container shadow-card`；有阴影时不加结构性边框。
- 避免无意义嵌套；同类 Card 保持一致结构。主操作放在页面或区域操作区，Footer 只放次要操作。

### Header Navigation

- 高度 `3rem`，使用 `bg-surface-container-highest`，产品标识、一级导航、全局工具和用户区位置保持稳定。
- 只承载全局导航；页面筛选、批量操作和主操作放在页面内容区。

### Side Navigation

- 默认使用亮色 `bg-surface-container-highest`；展开宽度 `15.5rem`，折叠宽度 `3rem`。
- 折叠态保留图标、Tooltip 和当前选中状态；仅在真实信息架构需要时使用多级导航。

## 4. Global Constraints

- 页面背景使用 `surface-container-lowest`；主要内容容器使用 `surface-container-highest`。
- 浮层使用对应 shadow；有 shadow 的容器不再添加结构性 border。
- 内部分割线使用 `divider`，扁平无阴影外壳才使用 `outline`。
- 模块间距使用 `section`，页面外层内边距使用 `page`。
