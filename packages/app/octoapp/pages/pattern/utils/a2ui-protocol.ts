export type A2UIElement = {
  id: string
  component: string
  props?: Record<string, unknown>
  children?: string[] | { path: string; componentId: string }
}

export type A2UIDocument = {
  state?: Record<string, unknown>
  rootId: string
  elements: A2UIElement[]
}

export type ComponentCatalog = "desktop" | "mobile"

export const COMPONENT_DESCRIPTIONS: Record<string, string> = {
  Icon: "MUST be use Lucide icon name",
  BarChart: "Compare values across discrete categories",
  LineChart: "Show continuous data changes over time",
  PieChart: "Show parts-to-whole percentages, Pie chart or doughnut chart showing data proportions.",
  GaugeChart: "Display one current value against a target or range",
  RadarChart: "Evaluate entities across 3+ attribute dimensions",
  ProcessChart: "Rank top items (e.g., Top 5) by percentages, ratios",
  HillChart: "Rank top items (e.g., Top 5) by absolute values",
  FunnelChart: "Show numerical changes (increasing or decreasing) across a multi-stage process",
  BubbleChart: "Plot 3 dimensions (X, Y, size) to identify correlations, clusters, and relative magnitudes",
  ScatterChart: "Plot 2 dimensions (X, Y) to identify trends, correlations, or outliers",
  BulletChart: "Compare a single metric against status background zones",
  AssembleBubbleChart: "Axis-free center-packed bubbles showing weight or tag popularity",
  JadeJueChart: "Compare independent percentages for top 3-6 items via concentric rings",
  CircleProcessChart: "A circular chart showing percentage progress toward a goal,Multiple data percentages shown as segments on one progress ring.",
}

export const DESKTOP_COMPONENTS = [
  "Button", "Icon",
  "Tabs", "TabItem", "Steps", "StepItem", "Breadcrumb", "Dropdown", "Menu",
  "Input", "InputNumber", "TextArea", "Select", "Checkbox", "CheckboxGroup",
  "RadioGroup", "Switch", "Slider", "Rate", "DatePicker", "TimePicker",
  "Table", "TableRow", "Tag", "Badge", "Collapse", "CollapseItem",
  "Timeline", "TimelineItem", "Divider", "Carousel", "Segmented", "Tree",
  "Progress",
  "LineChart", "BarChart", "PieChart", "RadarChart", "GaugeChart",
  "ProcessChart", "BubbleChart", "AssembleBubbleChart", "BulletChart",
  "FunnelChart", "HillChart", "JadeJueChart", "ScatterChart", "CircleProcessChart",
  "PatGauge", "PatStackedBar",
] as const

export const MOBILE_COMPONENTS = [
  "Button", "Icon",
  "Tabs", "TabItem",
  "CheckboxGroup", "RadioGroup", "Field", "Search", "Rate",
  "Tag", "Badge",
] as const

export const COMPONENT_CHILDREN: Record<string, string[]> = {
  Tabs: ["TabItem"],
  Steps: ["StepItem"],
  Table: ["TableRow"],
  Collapse: ["CollapseItem"],
  Timeline: ["TimelineItem"],
}

export const A2UI_JSON_PROTOCOL = `
# A2UI JSON Protocol

## 1. Global Structure

The JSON is a single object containing three top-level keys: \`state\`, \`rootId\`, and \`elements\`.

| Key | Type | Purpose |
| :--- | :--- | :--- |
| \`state\` | Object | Defines dynamic data for two-way bindings. |
| \`rootId\` | String | The ID of the outermost container element. |
| \`elements\` | Array | A flat list of elements defining the complete UI. |

**CRITICAL CONSTRAINT:** Output sequence MUST strictly be: \`state\` -> \`rootId\` -> \`elements\`. Validate output against the A2UI Structure Schema below.

## 2. Elements Array Structure

\`elements\` is defined as a **flat list** with ID references, supporting both HTML5 tags + A2UI Components + Tailwind classes:

\`\`\`json
"elements": [
  { "id": "mainCardContainer", "component": "div", "props": { "className": "flex flex-col gap-4 p-6 bg-white rounded-xl shadow-sm" }, "children": ["mainCardTitle", "mainCardBtn"] },
  { "id": "mainCardTitle", "component": "span", "props": { "className": "text-lg font-bold", "value": "Title text" } },
  { "id": "mainCardBtn", "component": "Button", "props": { "className": "w-full", "type": "primary", "value": "Confirm" } }
]
\`\`\`

**ELEMENTS CRITICAL CONSTRAINTS:**
- **Parent First:** Parent components MUST be output before their children.
- **Flat Array:** DO NOT nest element objects. Reference component by ID in \`children\`.
- **Unique IDs:** Every element MUST possess a globally unique \`id\`. Never omit \`id\`.
- **ID Naming Convention:** MUST follow \`[Zone][Module][Type]\` three-segment camelCase pattern.
  - Bad: \`btn1\`, \`actionBtnItem\` (missing zone), \`div3\` (no semantics).
  - Good: \`headerNavBtn\`, \`sidebarSearchInput\`, \`mainMetricCard\`, \`mainTableIdCell\`.
- **No Missing Elements:** Every ID referenced in \`children\` MUST be defined in the \`elements\` array.
- **Complete Rendering:** Fully resolve the UI tree to all absolute bottom leaf nodes.

## 3. Data Binding

Data assignment is categorized into **Static Literals** and **Dynamic Pointers**:

1. **Static Literals:** Fixed UI text. Do not reference \`state\`.
   - \`{"value": "Confirm your itinerary"}\`

2. **Dynamic Pointers:** Use \`path\` object pointing to state data. Follow JSON Pointers (RFC 6901).
   - \`{"value": { "path": "/emailValue" }}\` — Binds to \`state\` data.
   - \`{"children": { "path": "/employeeList", "componentId": "listItem" }}\` — Loops an array.
   - \`{"value": { "path": "profile/name" }}\` — Relative path inside a loop (omit leading slash).
   - \`{"content": { "componentId": "tabItemContent" }}\` — Slot binding.

**DATA BINDING CRITICAL CONSTRAINTS:**
- **Children Rule:** The \`children\` array MUST ONLY contain element \`id\` references. NEVER raw text strings.
- **Text Assignment:** HTML5 element raw text MUST be assigned via \`props\` (e.g., for a \`span\`, use \`props: { "value": "Next" }\`).
- **Mixed Siblings (Text + Elements):** When raw text and elements share the same parent, you MUST wrap the text in a \`<span>\` to generate an ID reference.
  - Bad: \`<a>Text<icon/></a>\` (Raw text cannot generate an ID for \`children\`)
  - Good: \`<a><span>Text</span><icon/></a>\` (Wrapping with \`span\` generates an ID for \`children\`)
- **Pure Text Rule:** DO NOT wrap text if the parent contains ONLY text. Use \`props: { "value": "..." }\` instead.
- **Semantic Keys:** Data keys in \`state\` must have clear semantic meaning (Good: \`hotel_name\`, Bad: \`val1\`).
- **State Referential Integrity:** Every referenced \`path\` MUST exist in the \`state\` object.

## 4. Loop Generation

**Syntax:** \`{"children": { "path": "/employeeList", "componentId": "card_employee" }}\`
- \`path\`: Points to the data array in \`state\`.
- \`componentId\`: The template component ID for each array item.

**LOOP CRITICAL CONSTRAINTS:**
- **No Forced Loops:** ONLY use loops for list data with identical structures.
- **Handle Irregular Information:** For uneven or irregular structures, DO NOT force a loop. Unroll components sequentially using Static Literals instead.

**Anti-Forced Loop Example:**
- Context: Travel Itinerary (Day 1: Morning, Afternoon. Day 2: Morning, Noon, Afternoon).
- Bad: Forcing this uneven data into a nested state array just to loop it.
- Good: Rendering Day 1 and Day 2 explicitly as sequential UI components without loops.

## 5. Slot Syntax & Component Composition

Same loop syntax applies to: Tabs/TabItem, Steps/StepItem, Table/TableRow, Collapse/CollapseItem, Timeline/TimelineItem.

**Identical Structures:** \`"component": "Steps", "children": { "path": "/stateArray", "componentId": "StepItem_id" }\`
- \`path\`: Points to the data array in state.
- \`componentId\`: Cross-reference ID of the template.

**Irregular Structures:** \`"component": "Tabs", "children": ["tabItem_user", "tabItem_product", "tabItem_server"]\`
- Child items require distinct, non-uniform internal structures.

**Slot Syntax:** \`"props": { "key": { "path": "id" }, "label": { "path": "name" }, "content": { "componentId": "div_id" } }\`
- \`key\` / \`label\` / \`icon\`: Relative data bindings from the current array item.
- \`content\`: Slot binding. MUST use \`{ "componentId": "elementId" }\` to reference the complex structural node.

------

# A2UI STRUCTURE SCHEMA
\`\`\`json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "required": ["state", "elements", "rootId"],
  "additionalProperties": false,
  "properties": {
    "state": { "type": "object", "additionalProperties": true },
    "rootId": { "type": "string" },
    "elements": {
      "type": "array", "minItems": 1,
      "items": {
        "type": "object",
        "required": ["id", "component"],
        "properties": {
          "id": { "type": "string" },
          "component": { "type": "string" },
          "props": { "type": "object", "additionalProperties": true },
          "children": {
            "oneOf": [
              { "type": "array", "items": { "type": "string" } },
              {
                "type": "object",
                "required": ["componentId", "path"],
                "additionalProperties": false,
                "properties": {
                  "componentId": { "type": "string" },
                  "path": { "type": "string" }
                }
              }
            ]
          }
        }
      }
    }
  }
}
\`\`\`

# HTML5 NATIVE ELEMENT SCHEMA
HTML5 elements use \`component\` matching pattern \`^[a-z]+[1-6]?$\` (lowercase tags: div, span, p, h1-h6, img, a, section).
Key props:
- \`className\`: Tailwind CSS classes.
- \`value\`: Text content (string or \`{path}\` object for dynamic binding).
- \`src\`: Source URL for img (string or \`{path}\` object).
- \`href\`: Hyperlink for a tags (string or \`{path}\` object).
- \`target\`: Where to open link. Enum: "_blank" | "_self" | "_parent" | "_top".
- \`alt\`: Alternative text for img tags.
- \`title\`: Extra information about an element, usually shown as a tooltip on hover.
`

export const DESKTOP_DESIGN_SYSTEM = `
# Design System (1920x1080)

## 0. 设计原则
页面采用1920*1080的宽度。

## 1. Design Token
所有页面元素使用Tailwind，并且在前端Tailwind extend中实现了如下扩展，你可以使用下列属性：
\`\`\`json
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

      "divider": "#F3F3F3"
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
      "sm": "1px 1px 6px 0 rgba(0, 0, 0, 0.08)",
      "md": "0 4px 12px 0px rgba(0, 0, 0, 0.16)",
      "lg": "0 8px 24px 0px rgba(0, 0, 0, 0.16)",
      "xl": "0 16px 48px 0px rgba(0, 0, 0, 0.16)",
      "card": "1px 1px 6px 0 rgba(0, 0, 0, 0.08)",
      "popover": "0 8px 24px 0px rgba(0, 0, 0, 0.16)",
      "modal": "0 16px 48px 0px rgba(0, 0, 0, 0.16)"
    },
    "borderColor": {
      "base": "#C9C9C9",
      "divider": "#F3F3F3",
      "selected": "#0067D1",
      "error": "#E02128"
    },
    "borderRadius": {
      "none": "0px",
      "sm": "2px",
      "md": "4px",
      "lg": "6px",
      "xl": "8px",
      "full": "9999px",
      "badge": "4px",
      "action": "4px",
      "container": "8px",
      "overlay": "8px"
    },
    "outlineColor": {
      "brand": "#0067D1",
      "error": "#E02128"
    },
    "outlineWidth": {
      "focus": "1px"
    },
    "outlineOffset": {
      "gap": "2px"
    },
    "fontSize": {
      "sm": "12px",
      "md": "14px",
      "lg": "16px",
      "xl": "18px",
      "2xl": "20px",
      "3xl": "24px",
      "4xl": "28px",
      "5xl": "36px",
      "6xl": "48px",
      "7xl": "60px",
      "8xl": "72px",
      "9xl": "96px"
    }
  }
\`\`\`

## 2. Elevation & Depth

We achieve spatial hierarchy through a precise combination of **Tonal Layering** and **Ambient Shadows**, avoiding heavy traditional borders.

### 2.1 The Layering Principle (Stacking Order)
Depth is established by stacking architectural tiers from back to front:
- **Level 0 (The Canvas):** Use \`bg-surface-container-lowest\` with no shadows. This is the absolute bottom layer (the page background).
- **Level 1 (Active Containers):** Use \`bg-surface-container-highest\` paired with \`shadow-sm\` (or \`shadow-card\`). Reserved for primary content containers: Data Cards, Tables, Navigations, and Drawers to make them "pop" forward.
- **Level 2 (Inner Sub-regions):** Use \`bg-surface-variant\`. Apply this *inside* Level 1 cards to visually separate internal functional blocks.

### 2.2 Text & Contrast Pairings
Always pair backgrounds with their strict \`on-*\` text tokens to maintain premium readability:
- On \`surface-container-*\` backgrounds → Use \`text-on-surface\`.
- On \`surface-variant\` backgrounds → Use \`text-on-surface-variant\`.

### 2.3 Semantic States (Status Indicator Layering)
To indicate semantic states (error, warning, success, info), apply the respective \`bg-*-container\` tokens as background tints.
**Crucially:** Always pair them with the corresponding \`text-on-*-container\` tokens (and use the base \`*\` token for icons if needed).

### 2.4 Strict UI Constraints (CRITICAL)
- **Mutual Exclusion:** NEVER combine a shadow with a structural border. If a container floats, it is borderless.
- **No Accent Strips:** Strictly NO left-border colored accent strips on cards or alerts. Use like \`bg-error-container\` instead.

## 3. Spacing & Gap
- 模块和Card之间的间距使用\`spacing -> section\`
- 页面最外层容器需要内边距时使用\`spacing -> page\`

## 4. Components

### KPI Cards & Data Blocks
- **Style:** No borders. Use \`surface-container-highest\`.
- **Layout:** Use \`rounded-xl\` (8px) corners.
- **Internal Separation:** To separate primary metrics from secondary data, use subtle divider lines (\`border-divider\`) OR wrap secondary metrics within a \`surface-variant\` background inset.

### Buttons
- **状态色:** 通过color属性 \`default | primary | danger\` 给按钮设定状态色.
- **约束:**
  - 不要在classname中设定色值背景色和文字色.
  - 在Table内时，当按钮包含文本内容时，必须使用\`types=link\`形态
  - 按钮在容器内优先靠右摆放
  - 按钮仅在Table内使用size: small，其他场景禁止使用small尺寸.
  - **Structural Parity**: Side-by-side buttons must share identical structures (All-Text, All-Icon, or All-Icon+Text). Mixing structures within a single row is prohibited to maintain visual parity.

### Tables
- Table必须在\`surface-container-highest\`内，不可以直接放在\`surface-container-lowest\`中。
- Table默认具有分页功能，在不显性控制分页器时，必须给Table组件添加下边距。
- Never put Badge in Table。
- **Column Width (CRITICAL):**
  - 仅当列设置了 \`fixed: "start"\` 或 \`fixed: "end"\`（即冻结列）时才设置 \`width\`，其余列不设 width 让表格自适应分配宽度撑满容器。
  - 仅长文本列（如描述、URL、名称）才设置 \`minWidth\`，短内容列（如状态、标签、操作、图标）不设 minWidth。
  - 禁止给所有列都加 width。

### Side Navigation
- **Surface:** Use \`surface-container-highest\` as the base background.
- **Size:** Use 15.5rem for the default width. use 3rem for the collapsed bar width.

### Header Navigation
- **Surface:** Use \`surface-container-highest\` as the base background.
- **Size:** Use 3rem as height.

### 边框和分割线
- border-base 的使用限制：border-base 仅可用于扁平、无海拔 (无 shadow) 的元素外壳。例如：默认表单输入框、卡片内部嵌套的次级扁平区块、空状态占位图。
- 内部线降噪：任何容器内部的分割线、列表项之间的界线，必须使用最低视觉噪音的 border-divider，严禁使用 border-base。

## Charts
- 所有图表组件默认携带图例、单位、坐标轴功能，不要生成这些元素的UI，只要把数据传给图表组件.
- 图表的高度一定要能够占满对应的父容器，否则大量的留白非常丑陋.
- 为方便可读性，必须将图表数据Key名转换为中文.
- **Constraints:**
  - 严禁使用\`color\`属性！

## IMAGE
- 将图片资源路径用的渐变色gradient=hex_start,hex_end的两个颜色改成本设计规范中的相关颜色

## Text
- *Color:*
  - 除了上述 on-*-container 中设定的文字颜色外，我们鼓励根据语义场景使用状态色(primary | success | warning | critical | error | info | inverse)，让页面看起更有情感表达和重点
- *Size:*
  - Card Title: Must use \`text-lg\`.
  - Table Content: Must use \`text-md\`.

## Iconography
Encourage the proactive use of icons to establish visual anchors. Icon shape is strictly determined by its Tailwind size.
- **Size & Shape Sync:**
  - At or below w-6 Must use \`outline|fill\`.
  - Above w-6 Must use \`circle|square\`.
- **Shape (\`<Icon shape />\`):**
  - \`outline\`: Standard UI, inline text, card titles, inputs, secondary navigation, tables, unselected states.
  - \`fill\`: active states, feedback, destructive actions.
  - \`circle\`: Primarily for global status (Success/Error), empty states.
  - \`square\`: Primarily for data metrics, module entries, dashboard grid anchors, file types.
- **Color (\`<Icon color />\`):**
  - default | primary | success | warning | error | inverse (Assign via UI semantics).
- **Constraints:**
  - **NO Background shape**: \`<Icon/>\` component automatically generates its own internal container block. **DO NOT** manually wrap the icon inside any background shape.
  - **Size & Shape Sync:** At or below w-6 Must use \`outline|fill\`. Above w-6 Must use \`circle|square\`.
  - inverse \`color\` Must used on dark background
`

export const MOBILE_DESIGN_SYSTEM = `
# Mobile Design System

## Component Rules
- Section padding: 3rem, Page padding: 4rem
- Larger touch targets (min 44px)
- Simplified component set (12 components)

## Color Tokens
- Same palette as Desktop but with larger spacing
- Charts: restricted color array
`

export const CARD_EXAMPLE = `{
  "state": { "title": "今日任务", "description": "完成项目报告并提交", "status": "进行中", "progress": 65 },
  "rootId": "mainCardContainer",
  "elements": [
    { "id": "mainCardContainer", "component": "div", "props": { "className": "p-4 bg-white rounded-lg shadow-sm border border-slate-200" }, "children": ["mainCardHeader", "mainCardBody", "mainCardFooter"] },
    { "id": "mainCardHeader", "component": "div", "props": { "className": "flex justify-between items-center mb-3" }, "children": ["mainCardTitle", "mainCardTag"] },
    { "id": "mainCardTitle", "component": "span", "props": { "value": { "path": "/title" }, "className": "text-base font-semibold text-slate-800" } },
    { "id": "mainCardTag", "component": "Tag", "props": { "value": { "path": "/status" }, "color": "blue" } },
    { "id": "mainCardBody", "component": "div", "props": { "className": "mb-3" }, "children": ["mainCardDesc"] },
    { "id": "mainCardDesc", "component": "span", "props": { "value": { "path": "/description" }, "className": "text-sm text-slate-500" } },
    { "id": "mainCardFooter", "component": "div", "props": { "className": "flex items-center gap-2" }, "children": ["mainCardProgress", "mainCardProgressText"] },
    { "id": "mainCardProgress", "component": "Progress", "props": { "percent": { "path": "/progress" }, "showInfo": false, "strokeColor": "#3b82f6" } },
    { "id": "mainCardProgressText", "component": "span", "props": { "value": { "path": "/progress" }, "className": "text-xs text-slate-400 ml-auto" } },
    { "id": "mainCardBtn", "component": "Button", "props": { "value": "查看详情", "type": "primary", "size": "small", "className": "mt-3" } }
  ]
}`

export const LIST_EXAMPLE = `{
  "state": {
    "news": [
      { "id": 1, "imgSrc": "https://picsum.photos/id/101/200/200", "title": "产品更新", "desc": "新版本功能介绍", "time": "10:30" },
      { "id": 2, "imgSrc": "https://picsum.photos/id/102/200/200", "title": "活动通知", "desc": "本周活动预告", "time": "09:15" },
      { "id": 3, "imgSrc": "https://picsum.photos/id/103/200/200", "title": "数据统计", "desc": "上月数据报告", "time": "昨天" }
    ]
  },
  "rootId": "mainListContainer",
  "elements": [
    { "id": "mainListContainer", "component": "div", "props": { "className": "flex flex-col gap-3 p-4" }, "children": ["mainListLoop"] },
    { "id": "mainListLoop", "component": "div", "props": { "className": "flex flex-col" }, "children": { "path": "/news", "componentId": "mainListItem" } },
    { "id": "mainListItem", "component": "div", "props": { "className": "flex gap-3 p-3 bg-white rounded-lg border border-slate-200 hover:shadow-sm transition-shadow" }, "children": ["mainListItemImg", "mainListItemContent"] },
    { "id": "mainListItemImg", "component": "div", "props": { "className": "w-16 h-16 shrink-0 rounded-lg overflow-hidden" }, "children": ["mainListItemImage"] },
    { "id": "mainListItemImage", "component": "img", "props": { "src": { "path": "imgSrc" }, "className": "w-full h-full object-cover" } },
    { "id": "mainListItemContent", "component": "div", "props": { "className": "flex-1 min-w-0 flex flex-col justify-center" }, "children": ["mainListItemTitle", "mainListItemDesc", "mainListItemTime"] },
    { "id": "mainListItemTitle", "component": "span", "props": { "value": { "path": "title" }, "className": "text-sm font-semibold text-slate-800" } },
    { "id": "mainListItemDesc", "component": "span", "props": { "value": { "path": "desc" }, "className": "text-xs text-slate-500 mt-1" } },
    { "id": "mainListItemTime", "component": "span", "props": { "value": { "path": "time" }, "className": "text-xs text-slate-400 mt-2" } }
  ]
}`

export const TABS_EXAMPLE = `{
  "state": {
    "activeTab": "tab1",
    "rbacConfig": [
      { "key": "tab1", "name": "用户管理", "icon": "user", "content": "这是用户管理面板" },
      { "key": "tab2", "name": "角色管理", "icon": "team", "content": "这是角色管理面板" },
      { "key": "tab3", "name": "权限管理", "icon": "safety", "content": "这是权限管理面板" }
    ]
  },
  "rootId": "mainTabsContainer",
  "elements": [
    { "id": "mainTabsContainer", "component": "Tabs", "props": { "activeKey": { "path": "/activeTab" } }, "children": { "path": "/rbacConfig",  "componentId": "mainTabsItem" }},
    { "id": "mainTabsItem", "component": "TabItem", "props": { "key": { "path": "key" }, "label": { "path": "name" }, "icon": { "path": "icon" }, "content": { "componentId": "mainTabsContent" } }},
    { "id": "mainTabsContent", "component": "div", "props": { "className": "p-4", "value": { "path": "content" } } }
  ]
}`

export const FORM_EXAMPLE = `{
  "state": { "username": "", "country": "", "hobbies": [], "notification": true, "birthday": "" },
  "rootId": "mainFormContainer",
  "elements": [
    { "id": "mainFormContainer", "component": "div", "props": { "className": "p-6 max-w-lg mx-auto bg-white rounded-xl" }, "children": ["mainFormTitle", "mainFormContent", "mainFormBtn"] },
    { "id": "mainFormTitle", "component": "h2", "props": { "value": "用户信息收集", "className": "text-xl font-bold text-slate-800 mb-6" } },
    { "id": "mainFormContent", "component": "div", "props": { "className": "flex flex-col gap-5" }, "children": ["mainFormUsernameField", "mainFormBirthdayField", "mainFormCountryField", "mainFormHobbiesField", "mainFormNotificationField"] },
    { "id": "mainFormUsernameField", "component": "div", "props": { "className": "flex flex-col gap-2" }, "children": ["mainFormUsernameLabel", "mainFormUsernameInput"] },
    { "id": "mainFormUsernameLabel", "component": "span", "props": { "value": "用户名", "className": "text-sm font-medium text-slate-700" } },
    { "id": "mainFormUsernameInput", "component": "Input", "props": { "value": { "path": "/username" }, "placeholder": "请输入用户名", "prefix": "User", "className": "w-full" } },
    { "id": "mainFormBirthdayField", "component": "div", "props": { "className": "flex flex-col gap-2" }, "children": ["mainFormBirthdayLabel", "mainFormBirthdayPicker"] },
    { "id": "mainFormBirthdayLabel", "component": "span", "props": { "value": "生日", "className": "text-sm font-medium text-slate-700" } },
    { "id": "mainFormBirthdayPicker", "component": "DatePicker", "props": { "value": { "path": "/birthday" }, "placeholder": "选择日期", "picker": "date", "className": "w-full" } },
    { "id": "mainFormCountryField", "component": "div", "props": { "className": "flex flex-col gap-2" }, "children": ["mainFormCountryLabel", "mainFormCountrySelect"] },
    { "id": "mainFormCountryLabel", "component": "span", "props": { "value": "国家", "className": "text-sm font-medium text-slate-700" } },
    { "id": "mainFormCountrySelect", "component": "Select", "props": { "value": { "path": "/country" }, "placeholder": "请选择国家", "options": [{ "label": "中国", "value": "cn" }, { "label": "美国", "value": "us" }, { "label": "日本", "value": "jp" }, { "label": "英国", "value": "uk" }], "className": "w-full" } },
    { "id": "mainFormHobbiesField", "component": "div", "props": { "className": "flex flex-col gap-2" }, "children": ["mainFormHobbiesLabel", "mainFormHobbiesCheckbox"] },
    { "id": "mainFormHobbiesLabel", "component": "span", "props": { "value": "爱好", "className": "text-sm font-medium text-slate-700" } },
    { "id": "mainFormHobbiesCheckbox", "component": "CheckboxGroup", "props": { "value": { "path": "/hobbies" }, "options": [{ "label": "阅读", "value": "reading" }, { "label": "运动", "value": "sports" }, { "label": "音乐", "value": "music" }, { "label": "旅行", "value": "travel" }] } },
    { "id": "mainFormNotificationField", "component": "div", "props": { "className": "flex items-center justify-between" }, "children": ["mainFormNotificationLabel", "mainFormNotificationSwitch"] },
    { "id": "mainFormNotificationLabel", "component": "span", "props": { "value": "接收通知", "className": "text-sm font-medium text-slate-700" } },
    { "id": "mainFormNotificationSwitch", "component": "Switch", "props": { "value": { "path": "/notification" }, "checkedChildren": "开", "unCheckedChildren": "关" } },
    { "id": "mainFormBtn", "component": "Button", "props": { "value": "提交", "type": "primary", "className": "w-full mt-6" } }
  ]
}`

export const HTML_EXAMPLE = `{
  "state": {
    "pageTitle": "移动端应用演示",
    "heroTitle": "欢迎回来",
    "heroDesc": "针对移动端优化的响应式 H5 页面。",
    "features": [
      { "icon": "smartphone", "label": "全响应式" },
      { "icon": "flash", "label": "极速加载" },
      { "icon": "flash", "label": "原生质感" },
      { "icon": "lock", "label": "安全稳定" }
    ],
    "actionText": "立即开始体验"
  },
  "rootId": "mainAppContainer",
  "elements": [
    {"id":"mainAppContainer","component":"div","props":{"className":"flex flex-col min-h-screen bg-gray-50"},"children":["headerAppTitle","mainContentArea"]},
    {"id":"headerAppTitle","component":"h1","props":{"className":"bg-white p-4 text-center font-bold border-b","value":{"path":"/pageTitle"}}},
    {"id":"mainContentArea","component":"div","props":{"className":"flex-1 p-4"},"children":["mainHeroCard","mainFeatureList","mainActionBtn"]},
    {"id":"mainHeroCard","component":"div","props":{"className":"bg-blue-600 text-white p-6 rounded-2xl mb-4"},"children":["mainHeroTitle","mainHeroDesc"]},
    {"id":"mainHeroTitle","component":"h2","props":{"className":"text-xl font-bold","value":{"path":"/heroTitle"}}},
    {"id":"mainHeroDesc","component":"p","props":{"className":"text-xs opacity-80","value":{"path":"/heroDesc"}}},
    {"id":"mainFeatureList","component":"div","props":{"className":"flex flex-col gap-2 mb-4"},"children":{"path":"/features","componentId":"mainFeatureRow"}},
    {"id":"mainFeatureRow","component":"div","props":{"className":"bg-white p-3 rounded-lg flex items-center gap-3 shadow-sm"},"children":["mainFeatureIcon","mainFeatureLabel"]},
    {"id":"mainFeatureIcon","component":"Icon","props":{"name":{"path":"icon"}}},
    {"id":"mainFeatureLabel","component":"span","props":{"className":"text-sm","value":{"path":"label"}}},
    {"id":"mainActionBtn","component":"Button","props":{"className":"w-full bg-blue-600 text-white p-4 rounded-xl font-bold","value":{"path":"/actionText"}}}
  ]
}`

function componentCatalogList(catalog: ComponentCatalog): string {
  const components = catalog === "desktop" ? DESKTOP_COMPONENTS : MOBILE_COMPONENTS
  const categories: Record<string, string[]> = {
    General: [],
    Navigation: [],
    DataEntry: [],
    DataDisplay: [],
    Response: [],
    Chart: [],
    Custom: [],
  }
  const navSet = new Set(["Tabs", "TabItem", "Steps", "StepItem", "Breadcrumb", "Dropdown", "Menu"])
  const entrySet = new Set(["Input", "InputNumber", "TextArea", "Select", "Checkbox", "CheckboxGroup", "RadioGroup", "Switch", "Slider", "Rate", "DatePicker", "TimePicker", "Field", "Search"])
  const displaySet = new Set(["Table", "TableRow", "Tag", "Badge", "Collapse", "CollapseItem", "Timeline", "TimelineItem", "Divider", "Carousel", "Segmented", "Tree"])
  const chartSet = new Set(["LineChart", "BarChart", "PieChart", "RadarChart", "GaugeChart", "ProcessChart", "BubbleChart", "AssembleBubbleChart", "BulletChart", "FunnelChart", "HillChart", "JadeJueChart", "ScatterChart", "CircleProcessChart"])
  const customSet = new Set(["PatGauge", "PatStackedBar"])
  for (const comp of components) {
    if (comp === "Button" || comp === "Icon") categories.General.push(comp)
    else if (navSet.has(comp)) categories.Navigation.push(comp)
    else if (entrySet.has(comp)) categories.DataEntry.push(comp)
    else if (displaySet.has(comp)) categories.DataDisplay.push(comp)
    else if (comp === "Progress") categories.Response.push(comp)
    else if (chartSet.has(comp)) categories.Chart.push(comp)
    else if (customSet.has(comp)) categories.Custom.push(comp)
  }
  const lines: string[] = ["# A2UI Components Catalog"]
  for (const [cat, comps] of Object.entries(categories)) {
    if (comps.length === 0) continue
    const formatted = comps.map((c) => {
      const desc = COMPONENT_DESCRIPTIONS[c]
      return desc ? `\`${c}\`(${desc})` : `\`${c}\``
    })
    lines.push(`  - **${cat}:** ${formatted.join(", ")}`)
  }
  return lines.join("\n")
}

const COMPONENT_API_REFERENCE = `
# Component API Reference (STRICT — only use documented props)

## General

### Button
\`\`\`
{
  "component": "Button",
  "props": {
    "value": string | { "path": "/field" },       // button text (REQUIRED)
    "color": "default" | "primary" | "danger" | "success" | "warning" | "info",  // color/type mapping
    "types": "default" | "link",                   // "link" = text-style link button
    "size": "large" | "medium" | "small",
    "icon": "lucide-icon-name",                    // Lucide icon name
    "iconPlacement": "start" | "end",
    "shape": "default" | "circle" | "round",
    "className": "tailwind-classes"
  }
}
\`\`\`
**CRITICAL**: Use \`type\` for visual style. Example: \`"type": "primary"\`.

### Icon
\`\`\`
{
  "component": "Icon",
  "props": {
    "name": string | { "path": "/field" },         // Lucide icon name (REQUIRED)
    "shape": "outline" | "fill" | "square" | "circle",
    "color": "default" | "primary" | "success" | "warning" | "error" | "inverse" | "#hex",
    "className": "tailwind-classes"
  }
}
\`\`\`

## Navigation

### Menu
\`\`\`
{
  "component": "Menu",
  "props": {
    "items": { "path": "/navArray" } | [{ "key": "home", "title": "首页", "icon": "home" }],
    "mode": "vertical" | "horizontal",
    "selectedKeys": { "path": "/activeKey" },
    "openKeys": { "path": "/openKeys" },
    "inlineCollapsed": false,
    "className": "tailwind-classes"
  }
}
\`\`\`
**Menu items data shape**: \`{ key: string, title: string, icon?: string, children?: [...] }\`
**CRITICAL**: Side nav and header nav MUST use Menu, NOT Tabs.

### Tabs / TabItem (loop or explicit)
\`\`\`
// Loop mode (identical tab structures):
{ "component": "Tabs", "props": { "activeKey": { "path": "/activeTab" }, "types": "line" | "card" | "editable-card", "tabPlacement": "top" | "bottom" | "start" | "end", "size": "large" | "medium" | "small",
  "children": { "path": "/tabData", "componentId": "tabItemTpl" } }
{ "id": "tabItemTpl", "component": "TabItem", "props": { "key": { "path": "key" }, "label": { "path": "name" }, "icon": { "path": "icon" }, "content": { "componentId": "tabContentDiv" } } }

// Explicit mode (different tab content):
{ "component": "Tabs", "props": { ... }, "children": ["tab1", "tab2"] }
\`\`\`

### Steps / StepItem
\`\`\`
{ "component": "Steps", "props": { "current": 2, "orientation": "horizontal" | "vertical", "status": "wait" | "process" | "finish" | "error", "types": "default" | "dot" | "inline" | "navigation" | "panel", "variant": "filled" | "outlined", "size": "large" | "medium" | "small",
  "children": { "path": "/stepsData", "componentId": "stepItemTpl" } }
{ "id": "stepItemTpl", "component": "StepItem", "props": { "title": { "path": "title" }, "content": { "path": "desc" }, "icon": { "path": "icon" }, "status": { "path": "status" } } }
\`\`\`

### Breadcrumb
\`\`\`
{ "component": "Breadcrumb", "props": { "items": [{ "title": "Home" }, { "title": "Products" }], "separator": "/" } }
\`\`\`

### Dropdown
\`\`\`
{ "component": "Dropdown", "props": { "menu": [{ "label": "Edit", "key": "edit", "icon": "pencil" }], "trigger": "click" | "hover" | "contextMenu", "placement": "bottom" | "bottomLeft" | "bottomRight" | "top" | "topLeft" | "topRight",
  "children": ["triggerBtnId"] }
\`\`\`

## Data Entry

### Input
\`\`\`
{ "component": "Input", "props": { "value": { "path": "/field" }, "placeholder": "请输入", "prefix": "lucide-icon", "suffix": "lucide-icon", "size": "large" | "medium" | "small", "maxLength": 50, "password": "true" } }
\`\`\`

### InputNumber
\`\`\`
{ "component": "InputNumber", "props": { "value": { "path": "/field" }, "placeholder": "0", "min": 0, "max": 100, "step": 1, "size": "large" | "medium" | "small" } }
\`\`\`

### TextArea
\`\`\`
{ "component": "TextArea", "props": { "value": { "path": "/field" }, "placeholder": "请输入", "autoSize": true } }
\`\`\`

### Select
\`\`\`
{ "component": "Select", "props": { "value": { "path": "/field" }, "options": [{ "label": "中国", "value": "cn" }], "placeholder": "请选择", "showSearch": true, "mode": "" | "multiple", "size": "large" | "medium" | "small" } }
\`\`\`

### CheckboxGroup
\`\`\`
{ "component": "CheckboxGroup", "props": { "value": { "path": "/field" }, "options": [{ "label": "阅读", "value": "reading" }] } }
\`\`\`

### RadioGroup
\`\`\`
{ "component": "RadioGroup", "props": { "value": { "path": "/field" }, "options": [{ "label": "A", "value": "a" }], "orientation": "horizontal" | "vertical", "optionType": "default" | "button" } }
\`\`\`

### Switch
\`\`\`
{ "component": "Switch", "props": { "value": { "path": "/field" }, "checkedChildren": "开", "unCheckedChildren": "关", "checkedChildrenIcon": "lucide-icon", "unCheckedChildrenIcon": "lucide-icon", "size": "medium" | "small" } }
\`\`\`

### Slider
\`\`\`
{ "component": "Slider", "props": { "value": 50, "min": 0, "max": 100, "step": 1, "range": false } }
\`\`\`

### Rate
\`\`\`
{ "component": "Rate", "props": { "count": 5, "value": { "path": "/rating" }, "allowClear": true, "disabled": false, "size": "large" | "medium" | "small" } }
\`\`\`

### DatePicker
\`\`\`
{ "component": "DatePicker", "props": { "value": { "path": "/date" }, "placeholder": "选择日期", "picker": "date" | "week" | "month" | "quarter" | "year", "format": "YYYY-MM-DD" } }
\`\`\`

### TimePicker
\`\`\`
{ "component": "TimePicker", "props": { "value": { "path": "/time" }, "placeholder": "选择时间", "format": "HH:mm:ss" } }
\`\`\`

## Data Display

### Table (with built-in pagination)
\`\`\`
{
  "component": "Table",
  "props": {
    "rowKey": "id",                                // REQUIRED: unique row key field name
    "columns": [                                    // REQUIRED: column definitions
      { "title": "名称", "dataIndex": "name", "align": "left" | "center" | "right", "sort": true, "width": 120 }
    ],
    "dataSource": { "path": "/tableData" },         // REQUIRED: data array binding
    "pagination": true,
    "rowSelection": { "type": "checkbox" | "radio", "selectedRowKeys": { "path": "/selectedKeys" } },
    "className": "tailwind-classes"
  },
  "children": { "path": "/tableData", "componentId": "tableRowTpl" }
}
{ "id": "tableRowTpl", "component": "TableRow", "children": ["cell1", "cell2", ...] }
\`\`\`
**CRITICAL**: \`rowKey\`, \`columns\`, and \`dataSource\` are REQUIRED. Pagination is built-in — do NOT create separate pagination elements.

### Tag
\`\`\`
{ "component": "Tag", "props": { "value": "热销", "color": "success" | "processing" | "error" | "default" | "warning" | "#hex", "variant": "filled" | "solid" | "outlined", "icon": "lucide-icon", "closable": false, "closeIcon": "lucide-icon", "size": "large" | "medium" | "small" } }
\`\`\`

### Badge
\`\`\`
{ "component": "Badge", "props": { "count": { "path": "/count" } | 5, "status": "success" | "processing" | "default" | "error" | "warning", "dot": true, "color": "#hex", "offset": [10, -5], "overflowCount": 99, "showZero": false },
  "children": ["childElementId"] }
\`\`\`
**CRITICAL**: Use \`count\` for badge value (NOT \`text\`).

### Collapse / CollapseItem
\`\`\`
{ "component": "Collapse", "props": { "activeKey": { "path": "/activeKey" }, "accordion": false, "expandIcon": "lucide-icon", "expandIconPlacement": "start" | "end", "size": "large" | "medium" | "small",
  "children": { "path": "/collapseData", "componentId": "collapseItemTpl" } }
{ "id": "collapseItemTpl", "component": "CollapseItem", "props": { "key": { "path": "key" }, "label": { "path": "title" }, "content": { "path": "desc" }, "extra": "lucide-icon" } }
\`\`\`

### Timeline / TimelineItem
\`\`\`
{ "component": "Timeline", "props": { "mode": "start" | "alternate" | "end", "orientation": "horizontal" | "vertical", "variant": "filled" | "outlined",
  "children": { "path": "/timelineData", "componentId": "timelineItemTpl" } }
{ "id": "timelineItemTpl", "component": "TimelineItem", "props": { "title": { "path": "year" }, "content": { "path": "event" }, "color": { "path": "color" }, "icon": { "path": "icon" }, "placement": "start" | "end" } }
\`\`\`

### Divider
\`\`\`
{ "component": "Divider", "props": { "orientation": "horizontal" | "vertical", "variant": "dashed" | "dotted" | "solid", "titlePlacement": "start" | "end" | "center", "value": "section title", "size": "large" | "medium" | "small" } }
\`\`\`

### Carousel
\`\`\`
{ "component": "Carousel", "props": { "arrows": true, "adaptiveHeight": false, "dotPlacement": "bottom" | "top" | "start" | "end", "className": "tailwind-classes" },
  "children": ["slide1Id", "slide2Id"] }
\`\`\`
**CRITICAL**: Carousel does NOT have \`autoplay\` or \`dots\` props. Only use documented props.

### Segmented
\`\`\`
{ "component": "Segmented", "props": { "value": { "path": "/activeTab" }, "options": [{ "label": "日", "value": "day", "icon": "lucide-icon" }], "block": false, "orientation": "horizontal" | "vertical", "size": "large" | "medium" | "small" } }
\`\`\`
Card top-right multi-select/toggle SHOULD use Segmented.

### Tree
\`\`\`
{ "component": "Tree", "props": { "options": { "path": "/treeData" }, "checkable": false, "defaultExpandedKeys": ["1"], "defaultSelectedKeys": ["1"] } }
// Tree data shape: { title: string, key: string, icon?: string, children?: [...] }
\`\`\`

### Progress
\`\`\`
{ "component": "Progress", "props": { "percent": { "path": "/progress" }, "status": "success" | "exception" | "normal" | "active", "showInfo": true, "strokeColor": "#hex", "size": "medium" | "small" } }
\`\`\`

## Charts (ALL charts use \`option\` prop pattern)

### LineChart
\`\`\`
{
  "component": "LineChart",
  "props": {
    "option": {
      "data": { "path": "/chartData" },                // REQUIRED
      "xAxis": { "data": "month", "name": "月份" },    // REQUIRED: X-axis field name mapping
      "yAxisTitle": "销售额",                           // REQUIRED: Y-axis label
      "smooth": true,                                    // optional: smooth curve
      "step": false,                                     // optional: step line
      "markLine": { "top": 5000, "bottom": 1000 },      // optional: threshold reference lines
      "color": ["#5470c6", "#91cc75", ...]               // optional: custom color palette
    },
    "className": "tailwind-classes"
  }
}
\`\`\`
**LineChart data:** \`[{ "month": "1月", "sales": 4200, "target": 4500 }]\` (multi-key = multi-series)

### BarChart
\`\`\`
{
  "component": "BarChart",
  "props": {
    "option": {
      "data": { "path": "/chartData" },                // REQUIRED
      "xAxis": { "data": "category", "name": "类别" }, // REQUIRED: X-axis field name mapping
      "yAxisTitle": "数量",                             // REQUIRED: Y-axis label
      "direction": "vertical",                           // optional: "vertical" | "horizontal"
      "stack": false,                                    // optional: stack bars
      "markLine": { "top": 5000, "bottom": 1000 },      // optional: threshold reference lines
      "color": ["#5470c6", "#91cc75", ...]               // optional: custom color palette
    },
    "className": "tailwind-classes"
  }
}
\`\`\`

### PieChart
\`\`\`
{
  "component": "PieChart",
  "props": {
    "option": {
      "data": { "path": "/chartData" },                // REQUIRED: [{ "name": "A", "value": 28 }]
      "title": { "text": "Distribution", "subtext": "Q1" }, // REQUIRED: center text
      "label": { "show": true },                         // optional: show labels
      "color": ["#5470c6", "#91cc75", ...]               // optional: custom color palette
    },
    "className": "tailwind-classes"
  }
}
\`\`\`

### RadarChart
\`\`\`
{
  "component": "RadarChart",
  "props": {
    "option": {
      "data": { "path": "/chartData" },                // REQUIRED
      "area": { "show": true },                         // optional: fill area
      "markLine": { ... },                               // optional: reference lines
      "color": ["#5470c6", ...]                          // optional: custom color palette
    },
    "className": "tailwind-classes"
  }
}
\`\`\`
**RadarChart data:** \`[{ "name": "产品A", "value": [95, 70, 88] }]\` + \`"radarIndicators": [{ "name": "维度1", "max": 100 }]\` in state

### GaugeChart
\`\`\`
{
  "component": "GaugeChart",
  "props": {
    "option": {
      "data": { "path": "/gaugeValue" },               // REQUIRED: single numeric value
      "text": { "offset": [0, 0], "formatter": "%" },   // optional: center text config
      "splitColor": [[0.25, "#0d9458"], [0.5, "#eeba18"]], // optional: color ranges [threshold, color]
      "color": ["#5470c6"]                               // optional: custom color palette
    },
    "className": "tailwind-classes"
  }
}
\`\`\`

### ProcessChart
\`\`\`
{
  "component": "ProcessChart",
  "props": {
    "option": {
      "data": { "path": "/chartData" },                // REQUIRED: [{ "name": "A", "value": 45 }]
      "name": "ProcessBarChart",                         // optional: chart variant name
      "unit": "%",                                       // optional: unit label
      "color": ["#5470c6", ...]                          // optional: custom color palette
    },
    "className": "tailwind-classes"
  }
}
\`\`\`

### HillChart
\`\`\`
{
  "component": "HillChart",
  "props": {
    "option": {
      "data": { "path": "/chartData" },                // REQUIRED: [{ "name": "A", "value": 1250 }]
      "color": ["#5470c6", ...]                          // optional: custom color palette
    },
    "className": "tailwind-classes"
  }
}
\`\`\`

### FunnelChart
\`\`\`
{
  "component": "FunnelChart",
  "props": {
    "option": {
      "data": { "path": "/chartData" },                // REQUIRED
      "sort": "descending",                              // optional: "descending" | "ascending" | "none"
      "direction": "vertical",                           // optional
      "color": ["#5470c6", ...]                          // optional: custom color palette
    },
    "className": "tailwind-classes"
  }
}
\`\`\`

### BubbleChart
\`\`\`
{
  "component": "BubbleChart",
  "props": {
    "option": {
      "data": { "path": "/chartData" },                // REQUIRED
      "yAxisTitle": "Y轴",                              // optional
      "color": ["#5470c6", ...]                          // optional: custom color palette
    },
    "className": "tailwind-classes"
  }
}
\`\`\`

### ScatterChart
\`\`\`
{
  "component": "ScatterChart",
  "props": {
    "option": {
      "data": { "path": "/chartData" },                // REQUIRED
      "yAxisTitle": "Y轴",                              // optional
      "markPoint": { ... },                              // optional: mark points
      "color": ["#5470c6", ...]                          // optional: custom color palette
    },
    "className": "tailwind-classes"
  }
}
\`\`\`

### AssembleBubbleChart
\`\`\`
{
  "component": "AssembleBubbleChart",
  "props": {
    "option": {
      "data": { "path": "/chartData" },                // REQUIRED
      "color": ["#5470c6", ...]                          // optional: custom color palette
    },
    "className": "tailwind-classes"
  }
}
\`\`\`

### BulletChart
\`\`\`
{
  "component": "BulletChart",
  "props": {
    "option": {
      "data": { "path": "/chartData" },                // REQUIRED
      "xAxis": { "data": "category" },                  // REQUIRED: X-axis field name
      "yAxisTitle": "值",                               // REQUIRED: Y-axis label
      "direction": "horizontal",                         // optional
      "markLine": { "data": [...], "name": "target" },  // optional
      "color": ["#5470c6", ...]                          // optional: custom color palette
    },
    "className": "tailwind-classes"
  }
}
\`\`\`

### JadeJueChart
\`\`\`
{
  "component": "JadeJueChart",
  "props": {
    "option": {
      "data": { "path": "/chartData" },                // REQUIRED: [{ "name": "A", "value": 85 }] (percentage)
      "title": { "text": "Completion", "subtext": "Rate" }, // optional: center text
      "color": ["#5470c6", ...]                          // optional: custom color palette
    },
    "className": "tailwind-classes"
  }
}
\`\`\`

### CircleProcessChart
\`\`\`
{
  "component": "CircleProcessChart",
  "props": {
    "option": {
      "data": { "path": "/circleData" },               // REQUIRED: [{ "value": 71, "name": "Utilization" }]
      "title": { "text": "CPU", "subtext": "使用率" },  // optional: center text
      "color": ["#2070F3"]                               // optional: custom colors
    },
    "className": "tailwind-classes"                      // MUST include w- and h- classes
  }
}
\`\`\`

## Custom Components

### PatGauge
\`\`\`
{
  "component": "PatGauge",
  "props": {
    "value": 72,                                        // REQUIRED: current value (number or {path})
    "max": 100,                                          // optional: max value (default 100)
    "className": "tailwind-classes"
  }
}
\`\`\`
A semi-circle gauge with gradient arc, tick marks, glowing indicator, and animated percentage display.

### PatStackedBar
\`\`\`
{
  "component": "PatStackedBar",
  "props": {
    "normal": 45,                                       // REQUIRED: normal count (green)
    "warning": 12,                                      // REQUIRED: warning count (yellow)
    "danger": 5,                                        // REQUIRED: danger count (orange)
    "error": 2,                                         // REQUIRED: error count (red)
    "className": "tailwind-classes"
  }
}
\`\`\`
Horizontal stacked bar chart with fixed colors: normal(green), warning(yellow), danger(orange), error(red).

## TopN Chart Selection Rules
- **Multi-Series Data (Highest Priority):** MUST use BarChart
- **Percentage / Ratio Values:** Use ProcessChart. Data: [{"name": "A", "value": 45}, {"name": "B", "value": 80}]
- **Absolute Values:** Use HillChart. Data: [{"name": "A", "value": 1250}, {"name": "B", "value": 840}]

**CRITICAL**: Charts MUST use \`option.data\` pattern. FORBIDDEN to use \`color\` as a top-level prop on charts. Charts have built-in legends, units, axes — do NOT generate UI elements for these.
`

export function buildIntentPrompt(opts: {
  query: string
  catalog: ComponentCatalog
}): string {
  const catalogLabel = opts.catalog === "desktop" ? "Desktop (46 components)" : "Mobile (12 components)"
  const components = componentCatalogList(opts.catalog)

  const parts = [
    `[Pattern Intent Expansion Mode]`,
    `Component Catalog: ${catalogLabel}`,
    ``,
    `# Available Components (for reference when describing elements)`,
    components,
    ``,
    `## Component Usage Guide`,
    `- Side Navigation: 侧边栏的菜单必须使用 \`Menu\` 组件，不要使用 \`Tab\` 组件`,
    `- Header Navigation: 头部导航的菜单必须使用 \`Menu\` 组件，不要使用 \`Tab\` 组件`,
    `- Card: 卡片右上角的多选/切换功能，优先使用 \`Segmented\``,
    ``,
    `## TopN Chart Selection Rules`,
    `- **Multi-Series Data (Highest Priority):** MUST use BarChart`,
    `- **Percentage / Ratio Values:** Use ProcessChart. Data: [{"name": "A", "value": 45}, {"name": "B", "value": 80}]`,
    `- **Absolute Values:** Use HillChart. Data: [{"name": "A", "value": 1250}, {"name": "B", "value": 840}]`,
    ``,
    `---`,
    ``,
    opts.query,
  ]
  return parts.join("\n")
}

export function buildModulePrompt(opts: {
  userInput: string
  catalog: ComponentCatalog
  designSystemPrompt?: string
}): string {
  const catalogLabel = opts.catalog === "desktop" ? "Desktop (46 components)" : "Mobile (12 components)"
  const components = componentCatalogList(opts.catalog)
  const designSystem = opts.catalog === "desktop" ? DESKTOP_DESIGN_SYSTEM : MOBILE_DESIGN_SYSTEM

  const userInput = opts.userInput

  const parts = [
    `[Pattern Module Creation Mode]`,
    `Component Catalog: ${catalogLabel}`,
    ``,
    components,
    ``,
    COMPONENT_API_REFERENCE,
    ``,
    `You MUST output valid A2UI JSON Protocol format:`,
    `{ "state": {...}, "rootId": "pattern_root", "elements": [...] }`,
    ``,
    `Key rules:`,
    `- All elements in a flat "elements" array, nesting via "children" ID references`,
    `- Data binding: props.value = { "path": "/fieldName" }`,
    `- Loop: children = { "path": "/array", "componentId": "templateId" }`,
    `- Slot: content = { "componentId": "slotElementId" }`,
    `- HTML5 native elements: div, span, p, h1-h6, img, a, section (with className for Tailwind)`,
    `- rootId MUST be "pattern_root"`,
    `- FIRST element must be the root element`,
    `- Parent MUST appear before children in elements array`,
    `- ID naming: [Zone][Module][Type] camelCase. Element ids MUST begin with provided prefix except root.`,
    `- Inline style FORBIDDEN. Use ONLY Tailwind className`,
    `- Output ONLY valid JSON. No markdown, no code blocks, no explanations.`,
    `- Every referenced path MUST exist in state object`,
    `- MUST use ALL items in every array AND ALL keys from the data`,
    `- ONLY use props documented in the Component API Reference above. NEVER invent undocumented props.`,
    ``,
    A2UI_JSON_PROTOCOL,
    ``,
    `## Design System`,
    designSystem,
    ``,
    `# A2UI SYNTAX EXAMPLE`,
    `## ISOLATED INTERACTIVE CARD`,
    CARD_EXAMPLE,
    `## LOOP SYNTAX & LISTS`,
    LIST_EXAMPLE,
    `## SLOT SYNTAX & COMPONENT COMPOSITION`,
    TABS_EXAMPLE,
    `## TWO-WAY BINDING SYNTAX`,
    FORM_EXAMPLE,
    `## HTML5 Native Element`,
    HTML_EXAMPLE,
    ``,
  ]

  if (opts.designSystemPrompt) {
    parts.push(
      `## Custom Design System`,
      opts.designSystemPrompt,
      ``,
    )
  }

  parts.push(
    `---`,
    ``,
    `请为以下需求生成 A2UI JSON：`,
    ``,
    `【用户需求】: ========================`,
    userInput,
    ``,
    `【根节点 ID】: pattern_root`,
    `【模块内部元素 id 前缀】: ptn`,
    ``,
  )

  return parts.join("\n")
}

export function extractIntentJson(text: string): Record<string, unknown> | null {
  try {
    const trimmed = text.trim()
    const parsed = JSON.parse(trimmed)
    if (parsed && typeof parsed === "object" && parsed.id && parsed.data) return parsed
  } catch {
    try {
      if (text.includes("```json")) {
        const match = text.match(/```json\s*\n([\s\S]*?)\n?```/)
        if (match) {
          const parsed = JSON.parse(match[1].trim())
          if (parsed && typeof parsed === "object" && parsed.id && parsed.data) return parsed
        }
      }
      const match = text.match(/\{[\s\S]*"id"\s*:\s*"Pat[\s\S]*"data"\s*:\s*\{[\s\S]*\}\s*\}/)
      if (match) {
        const parsed = JSON.parse(match[0])
        if (parsed && parsed.id && parsed.data) return parsed
      }
    } catch {}
  }
  return null
}

export function detectCatalog(query: string): ComponentCatalog {
  const mobileKeywords = /\b(mobile|app|ios|android|phone|h5)\b/i
  return mobileKeywords.test(query) ? "mobile" : "desktop"
}

export function buildPatternPrompt(opts: {
  query: string
  catalog: ComponentCatalog
  designSystemPrompt?: string
}): string {
  const catalogLabel = opts.catalog === "desktop" ? "Desktop (46 components)" : "Mobile (12 components)"
  const components = componentCatalogList(opts.catalog)
  const designSystem = opts.catalog === "desktop" ? DESKTOP_DESIGN_SYSTEM : MOBILE_DESIGN_SYSTEM

  const parts = [
    `[Pattern Mode: A2UI Generative UI]`,
    `Component Catalog: ${catalogLabel}`,
    ``,
    components,
    ``,
    COMPONENT_API_REFERENCE,
    ``,
    `You MUST output valid A2UI JSON Protocol format:`,
    `{ "state": {...}, "rootId": "pattern_root", "elements": [...] }`,
    ``,
    `Key rules:`,
    `- All elements in a flat "elements" array, nesting via "children" ID references`,
    `- Data binding: props.value = { "path": "/fieldName" }`,
    `- Loop: children = { "path": "/array", "componentId": "templateId" }`,
    `- Slot: content = { "componentId": "slotElementId" }`,
    `- HTML5 native elements: div, span, p, h1-h6, img, a, section (with className for Tailwind)`,
    `- rootId MUST be "pattern_root"`,
    `- FIRST element must be the root element`,
    `- Parent MUST appear before children in elements array`,
    `- ID naming: [Zone][Module][Type] camelCase. Element ids MUST begin with "ptn" prefix except root.`,
    `- Inline style FORBIDDEN. Use ONLY Tailwind className`,
    `- Output ONLY valid JSON. No markdown, no code blocks, no explanations.`,
    `- Every referenced path MUST exist in state object`,
    `- MUST use ALL items in every array AND ALL keys from the data`,
    `- ONLY use props documented in the Component API Reference above. NEVER invent undocumented props.`,
    ``,
    `# Mock Data Rules`,
    `- Use realistic, rich mock data with highly semantic key names (Good: hotelName, trendIcon. Bad: value, desc)`,
    `- Icon/Image data keys MUST end with Icon/Image suffix (Good: scenicImage, trendIcon. Bad: scenic, trend)`,
    `- Chart data keys SHOULD start/end with "Chart"`,
    `- Chart data for line/bar charts MUST show realistic fluctuation, NOT monotonic`,
    `- Media URLs: Icons use Lucide names. Avatars: randomuser.me. Images: fpoimg.com with colored gradients`,
    `- Business metric cards/tables with titles MUST have cardTitle field in data`,
    `- Encourage proactively adding icons as visual anchors`,
    ``,
    A2UI_JSON_PROTOCOL,
    ``,
    `## Design System`,
    designSystem,
    ``,
    `# A2UI SYNTAX EXAMPLE`,
    `## ISOLATED INTERACTIVE CARD`,
    CARD_EXAMPLE,
    `## LOOP SYNTAX & LISTS`,
    LIST_EXAMPLE,
    `## SLOT SYNTAX & COMPONENT COMPOSITION`,
    TABS_EXAMPLE,
    `## TWO-WAY BINDING SYNTAX`,
    FORM_EXAMPLE,
    `## HTML5 Native Element`,
    HTML_EXAMPLE,
    ``,
  ]

  if (opts.designSystemPrompt) {
    parts.push(
      `## Custom Design System`,
      opts.designSystemPrompt,
      ``,
    )
  }

  parts.push(`---`, ``, opts.query)
  return parts.join("\n")
}

export function detectA2UIJson(text: string): A2UIDocument | null {
  try {
    const raw = text.includes("```json")
      ? text.match(/```json\s*\n([\s\S]*?)\n?```/)?.[1] ?? text
      : text
    const parsed = JSON.parse(raw.trim())
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.elements) && parsed.rootId) {
      return parsed as A2UIDocument
    }
  } catch {}
  return null
}
