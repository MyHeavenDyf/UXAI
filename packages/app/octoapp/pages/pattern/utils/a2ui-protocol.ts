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
  Icon: "MUST use Lucide icon name",
  BarChart: "Compare values across discrete categories",
  LineChart: "Show continuous data changes over time",
  PieChart: "Show parts-to-whole percentages",
  GaugeChart: "Display one current value against a target or range",
  RadarChart: "Evaluate entities across 3+ attribute dimensions",
  ProcessChart: "Rank top items (e.g., Top 5) by percentages, ratios",
  HillChart: "Rank top items (e.g., Top 5) by absolute values",
  FunnelChart: "Show numerical changes across a multi-stage process",
  BubbleChart: "Plot 3 dimensions (X, Y, size) to identify correlations and clusters",
  ScatterChart: "Plot 2 dimensions (X, Y) to identify trends, correlations, or outliers",
  BulletChart: "Compare a single metric against status background zones",
  AssembleBubbleChart: "Axis-free center-packed bubbles showing weight or tag popularity",
  JadeJueChart: "Compare independent percentages for top 3-6 items via concentric rings",
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
  "FunnelChart", "HillChart", "JadeJueChart", "ScatterChart",
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
`

export const DESKTOP_DESIGN_SYSTEM = `
# Design System (1920x1080)

## 1. Design Tokens (Tailwind extend)

### Colors
- primary: #0067D1, on-primary: #FFFFFF
- primary-container: #E6F2FD
- surface: #F3F3F3, surface-bright: #FFFFFF
- surface-container-lowest: #F3F3F3 (page background)
- surface-container-low: rgba(255,255,255,0.5)
- surface-container: rgba(255,255,255,0.65)
- surface-container-high: rgba(255,255,255,0.8)
- surface-container-highest: #FFFFFF (primary containers)
- surface-variant: #F3F3F3 (inner sub-regions)
- on-surface: #191919, on-surface-variant: #777777
- error: #E02128, success: #09AA71, critical: #F4840C, warning: #FCC800, info: #0067D1
- divider: #F3F3F3

### Spacing
- section: 1rem (gap between modules/cards)
- page: 2rem (outer container padding)

### Shadows
- shadow-sm / shadow-card: 1px 1px 6px 0 rgba(0,0,0,0.08)
- shadow-md: 0 4px 12px 0 rgba(0,0,0,0.16)

### Border Radius
- container: 8px (rounded-xl), action: 4px (rounded-md), badge: 4px

## 2. Elevation & Depth
- **Level 0 (Canvas):** bg-surface-container-lowest, no shadow. Page background only.
- **Level 1 (Active Containers):** bg-surface-container-highest + shadow-sm. Primary cards, tables, navigation.
- **Level 2 (Inner Sub-regions):** bg-surface-variant. Inside Level 1 cards for visual separation.
- **Mutual Exclusion:** NEVER combine shadow with structural border. If it floats, it is borderless.
- **No Accent Strips:** NO left-border colored accent strips on cards. Use bg-*-container instead.

## 3. Component Rules

### KPI Cards & Data Blocks
- No borders. Use surface-container-highest. rounded-xl corners.
- Internal separation: use border-divider or surface-variant background inset.
- Titles MUST use text-lg. MUST have cardTitle field in data.

### Buttons
- Set state color via color prop: default | primary | danger.
- Do NOT set color/background in className.
- In Table: use type=link form for text buttons.
- Prefer right-aligned placement in containers.
- Only use size: small inside Tables. Forbidden elsewhere.
- Side-by-side buttons MUST share identical structures.

### Tables
- MUST be inside surface-container-highest. NEVER directly on surface-container-lowest.
- Built-in pagination — do NOT create separate pagination elements.
- Must have bottom margin when pagination is not explicitly controlled.
- Never put Badge in Table.
- Content MUST use text-md.

### Navigation (Side/Header)
- Side nav and header nav MUST use Menu component, NOT Tabs.
- Header: surface-container-highest background, 3rem height.

### Charts
- Built-in legends, units, axes — do NOT generate these UI elements.
- Charts MUST fill parent container height to avoid whitespace.
- Data key names MUST be in Chinese for readability.
- FORBIDDEN to use color property!
- Multiple data series encouraged for large charts.
- Line/bar chart data MUST show realistic fluctuation.

### Icons
- Proactively use icons as visual anchors.
- Size <= w-6: use outline|fill shape. Size > w-6: use circle|square shape.
- outline: standard UI, tables, unselected states. fill: active, destructive.
- circle: global status (success/error). square: metrics, module entries.
- DO NOT manually wrap icon inside background shape.

### Borders & Dividers
- border-base ONLY on flat, no-shadow element shells (inputs, inner nested blocks).
- Internal divider lines MUST use border-divider. FORBIDDEN border-base inside containers.

### Images
- When using fpoimg.com placeholder URLs, use design system colors for gradients (primary, accent, etc.), NOT gray/white.

### Text
- Card Title: text-lg. Table Content: text-md.
- Encourage semantic state colors (primary | success | warning | critical | error | info) for emphasis.
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
    { "id": "mainTabsContent", "component": "div", "props": { "className": "p-4", "value": { "path": "content" } }}
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
    { "id": "mainFormCountrySelect", "component": "Select", "props": { "value": { "path": "/country" }, "placeholder": "请选择国家", "options": [{ "label": "中国", "value": "cn" }, { "label": "美国", "value": "us" }, { "label": "日本", "value": "jp" }], "className": "w-full" } },
    { "id": "mainFormHobbiesField", "component": "div", "props": { "className": "flex flex-col gap-2" }, "children": ["mainFormHobbiesLabel", "mainFormHobbiesCheckbox"] },
    { "id": "mainFormHobbiesLabel", "component": "span", "props": { "value": "爱好", "className": "text-sm font-medium text-slate-700" } },
    { "id": "mainFormHobbiesCheckbox", "component": "CheckboxGroup", "props": { "value": { "path": "/hobbies" }, "options": [{ "label": "阅读", "value": "reading" }, { "label": "运动", "value": "sports" }, { "label": "音乐", "value": "music" }] } },
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
    { "id": "mainAppContainer", "component": "div", "props": { "className": "flex flex-col min-h-screen bg-gray-50" }, "children": ["headerAppTitle", "mainContentArea"] },
    { "id": "headerAppTitle", "component": "h1", "props": { "className": "bg-white p-4 text-center font-bold border-b", "value": { "path": "/pageTitle" } } },
    { "id": "mainContentArea", "component": "div", "props": { "className": "flex-1 p-4" }, "children": ["mainHeroCard", "mainFeatureList", "mainActionBtn"] },
    { "id": "mainHeroCard", "component": "div", "props": { "className": "bg-blue-600 text-white p-6 rounded-2xl mb-4" }, "children": ["mainHeroTitle", "mainHeroDesc"] },
    { "id": "mainHeroTitle", "component": "h2", "props": { "className": "text-xl font-bold", "value": { "path": "/heroTitle" } } },
    { "id": "mainHeroDesc", "component": "p", "props": { "className": "text-xs opacity-80", "value": { "path": "/heroDesc" } } },
    { "id": "mainFeatureList", "component": "div", "props": { "className": "flex flex-col gap-2 mb-4" }, "children": { "path": "/features", "componentId": "mainFeatureRow" } },
    { "id": "mainFeatureRow", "component": "div", "props": { "className": "bg-white p-3 rounded-lg flex items-center gap-3 shadow-sm" }, "children": ["mainFeatureIcon", "mainFeatureLabel"] },
    { "id": "mainFeatureIcon", "component": "Icon", "props": { "name": { "path": "icon" } } },
    { "id": "mainFeatureLabel", "component": "span", "props": { "className": "text-sm", "value": { "path": "label" } } },
    { "id": "mainActionBtn", "component": "Button", "props": { "className": "w-full bg-blue-600 text-white p-4 rounded-xl font-bold", "value": { "path": "/actionText" } } }
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
  }
  const navSet = new Set(["Tabs", "TabItem", "Steps", "StepItem", "Breadcrumb", "Dropdown", "Menu"])
  const entrySet = new Set(["Input", "InputNumber", "TextArea", "Select", "Checkbox", "CheckboxGroup", "RadioGroup", "Switch", "Slider", "Rate", "DatePicker", "TimePicker", "Field", "Search"])
  const displaySet = new Set(["Table", "TableRow", "Tag", "Badge", "Collapse", "CollapseItem", "Timeline", "TimelineItem", "Divider", "Carousel", "Segmented", "Tree"])
  const chartSet = new Set(["LineChart", "BarChart", "PieChart", "RadarChart", "GaugeChart", "ProcessChart", "BubbleChart", "AssembleBubbleChart", "BulletChart", "FunnelChart", "HillChart", "JadeJueChart", "ScatterChart"])
  for (const comp of components) {
    if (comp === "Button" || comp === "Icon") categories.General.push(comp)
    else if (navSet.has(comp)) categories.Navigation.push(comp)
    else if (entrySet.has(comp)) categories.DataEntry.push(comp)
    else if (displaySet.has(comp)) categories.DataDisplay.push(comp)
    else if (comp === "Progress") categories.Response.push(comp)
    else if (chartSet.has(comp)) categories.Chart.push(comp)
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

const COMPONENT_USAGE_GUIDE = `
# Component Usage Guide
- Side navigation menus MUST use \`Menu\` component, NOT \`Tabs\`.
- Header navigation menus MUST use \`Menu\` component, NOT \`Tabs\`.
- Card top-right multi-select/toggle SHOULD use \`Segmented\`.
- Table pagination is built-in — do NOT create separate pagination elements.
- TopN chart selection rules:
  - Multi-series data → use \`BarChart\`
  - Center text requirement → use \`JadeJueChart\`
  - Percentage/ratio values → use \`ProcessChart\` (data: [{"name":"A","value":45}])
  - Absolute values → use \`HillChart\` (data: [{"name":"A","value":1250}])
`

export function detectCatalog(query: string): ComponentCatalog {
  const mobileKeywords = /\b(mobile|app|ios|android|phone|h5)\b/i
  return mobileKeywords.test(query) ? "mobile" : "desktop"
}

export function buildPatternPrompt(opts: {
  query: string
  catalog: ComponentCatalog
  designSystemPrompt?: string
}): string {
  const catalogLabel = opts.catalog === "desktop" ? "Desktop (43 components)" : "Mobile (12 components)"
  const components = componentCatalogList(opts.catalog)
  const designSystem = opts.catalog === "desktop" ? DESKTOP_DESIGN_SYSTEM : MOBILE_DESIGN_SYSTEM

  const parts = [
    `[Pattern Mode: A2UI Generative UI]`,
    `Component Catalog: ${catalogLabel}`,
    ``,
    components,
    ``,
    COMPONENT_USAGE_GUIDE,
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
    `- ID naming: [Zone][Module][Type] camelCase (e.g. ptnHeaderNavBtn). Element ids MUST begin with "ptn" prefix except root.`,
    `- Inline style FORBIDDEN. Use ONLY Tailwind className`,
    `- Output ONLY valid JSON. No markdown, no code blocks, no explanations.`,
    `- Every referenced path MUST exist in state object`,
    `- MUST use ALL items in every array AND ALL keys from the data`,
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
    `## Examples`,
    `### Card`,
    CARD_EXAMPLE,
    `### List/Loop`,
    LIST_EXAMPLE,
    `### Tabs/Slot`,
    TABS_EXAMPLE,
    `### Form/Multi-Component`,
    FORM_EXAMPLE,
    `### HTML5 Native + Icon + Loop`,
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
