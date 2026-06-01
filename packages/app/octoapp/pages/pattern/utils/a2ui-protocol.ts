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

The JSON is a single object containing three top-level keys: state, rootId, and elements.

| Key | Type | Purpose |
| state | Object | Defines dynamic data for two-way bindings. |
| rootId | String | The ID of the outermost container element. |
| elements | Array | A flat list of elements defining the complete UI. |

## 2. Elements Array Structure

elements is defined as a flat list with ID references, supporting both HTML5 tags + A2UI Components + Tailwind classes:

elements: [
  { "id": "mainCard", "component": "div", "props": { "className": "flex flex-col gap-4 p-6 bg-white rounded-xl shadow-sm" }, "children": ["mainTitle", "mainBtn"] },
  { "id": "mainTitle", "component": "span", "props": { "className": "text-lg font-bold", "value": "Title" } },
  { "id": "mainBtn", "component": "Button", "props": { "className": "w-full", "type": "primary", "value": "Confirm" } }
]

## 3. Data Binding

1. Static Literals: Fixed UI text. e.g. {"value": "Confirm"}
2. Dynamic Pointers: Use path object pointing to state data.
   - {"value": { "path": "/emailValue" }} - Binds to state data.
   - {"children": { "path": "/employeeList", "componentId": "listItem" }} - Loops an array.
   - {"value": { "path": "profile/name" }} - Relative path inside a loop.
   - {"content": { "componentId": "tabItemContent" }} - Slot binding.

## 4. Loop Generation

Syntax: {"children": { "path": "/employeeList", "componentId": "card_employee" }}
- path: Points to the data array in state.
- componentId: The template component ID for each array item.
- ONLY use loops for list data with identical structures.
- For uneven data, unroll sequentially using Static Literals.

## 5. Slot Syntax (Tabs/Steps/Table/Collapse/Timeline)

Identical Structures: "component": "Steps", "children": { "path": "/stateArray", "componentId": "StepItem_id" }
Irregular Structures: "component": "Tabs", "children": ["tabItem_user", "tabItem_product"]

## 6. Constraints

- Output sequence MUST strictly be: state -> rootId -> elements.
- Parent components MUST be output before their children.
- Every ID referenced in children MUST be defined in the elements array.
- ID Naming: [Zone][Module][Type] three-segment camelCase (e.g. headerNavBtn).
- HTML5 element text MUST use props.value.
- Inline style is FORBIDDEN. Use ONLY Tailwind classes in className.
- Every path in elements must exist in the state object.
`

export const DESKTOP_DESIGN_SYSTEM = `
# Desktop Design System (1920x1080)

## Color Tokens (Tailwind)
- primary: blue-600 (#2563eb)
- surface: white, slate-50, slate-100
- text: slate-800 (primary), slate-500 (secondary), slate-400 (tertiary)

## Elevation Rules
- Level 0: bg-surface-container-lowest (page background)
- Level 1: bg-surface-container-highest + shadow-sm (primary containers)
- Level 2: bg-surface-variant (inner sub-regions)

## Component Rules
- Buttons: Use color/type props, no className color override
- Tables: Must be in surface-container-highest
- Charts: No color property in desktop
- Section padding: 2rem, Page padding: 3rem
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
  "state": { "title": "Task", "description": "Complete report", "status": "In Progress", "progress": 65 },
  "rootId": "mainCard",
  "elements": [
    { "id": "mainCard", "component": "div", "props": { "className": "p-4 bg-white rounded-lg shadow-sm border border-slate-200" }, "children": ["mainHeader", "mainBody", "mainFooter"] },
    { "id": "mainHeader", "component": "div", "props": { "className": "flex justify-between items-center mb-3" }, "children": ["mainTitle", "mainTag"] },
    { "id": "mainTitle", "component": "span", "props": { "value": { "path": "/title" }, "className": "text-base font-semibold text-slate-800" } },
    { "id": "mainTag", "component": "Tag", "props": { "value": { "path": "/status" }, "color": "blue" } },
    { "id": "mainBody", "component": "div", "props": { "className": "mb-3" }, "children": ["mainDesc"] },
    { "id": "mainDesc", "component": "span", "props": { "value": { "path": "/description" }, "className": "text-sm text-slate-500" } },
    { "id": "mainFooter", "component": "div", "props": { "className": "flex items-center gap-2" }, "children": ["mainProgress", "mainProgressText"] },
    { "id": "mainProgress", "component": "Progress", "props": { "percent": { "path": "/progress" }, "showInfo": false, "strokeColor": "#3b82f6" } },
    { "id": "mainProgressText", "component": "span", "props": { "value": { "path": "/progress" }, "className": "text-xs text-slate-400 ml-auto" } }
  ]
}`

export const LIST_EXAMPLE = `{
  "state": {
    "news": [
      { "id": 1, "imgSrc": "https://picsum.photos/id/101/200/200", "title": "Update", "desc": "New features", "time": "10:30" },
      { "id": 2, "imgSrc": "https://picsum.photos/id/102/200/200", "title": "Event", "desc": "Weekly preview", "time": "09:15" }
    ]
  },
  "rootId": "mainList",
  "elements": [
    { "id": "mainList", "component": "div", "props": { "className": "flex flex-col gap-3 p-4" }, "children": ["mainListLoop"] },
    { "id": "mainListLoop", "component": "div", "props": { "className": "flex flex-col" }, "children": { "path": "/news", "componentId": "listItem" } },
    { "id": "listItem", "component": "div", "props": { "className": "flex gap-3 p-3 bg-white rounded-lg border border-slate-200" }, "children": ["listItemImg", "listItemContent"] },
    { "id": "listItemImg", "component": "img", "props": { "src": { "path": "imgSrc" }, "className": "w-16 h-16 rounded-lg object-cover" } },
    { "id": "listItemContent", "component": "div", "props": { "className": "flex-1 min-w-0 flex flex-col justify-center" }, "children": ["listItemTitle", "listItemDesc"] },
    { "id": "listItemTitle", "component": "span", "props": { "value": { "path": "title" }, "className": "text-sm font-semibold text-slate-800" } },
    { "id": "listItemDesc", "component": "span", "props": { "value": { "path": "desc" }, "className": "text-xs text-slate-500" } }
  ]
}`

export const TABS_EXAMPLE = `{
  "state": {
    "activeTab": "tab1",
    "rbacConfig": [
      { "key": "tab1", "name": "Users", "icon": "user", "content": "User management" },
      { "key": "tab2", "name": "Roles", "icon": "team", "content": "Role management" }
    ]
  },
  "rootId": "mainTabs",
  "elements": [
    { "id": "mainTabs", "component": "Tabs", "props": { "activeKey": { "path": "/activeTab" } }, "children": { "path": "/rbacConfig", "componentId": "tabsItem" }},
    { "id": "tabsItem", "component": "TabItem", "props": { "key": { "path": "key" }, "label": { "path": "name" }, "content": { "componentId": "tabsContent" } }},
    { "id": "tabsContent", "component": "div", "props": { "className": "p-4", "value": { "path": "content" } }}
  ]
}`

export const FORM_EXAMPLE = `{
  "state": { "username": "", "email": "" },
  "rootId": "mainForm",
  "elements": [
    { "id": "mainForm", "component": "div", "props": { "className": "p-6 bg-white rounded-xl" }, "children": ["formTitle", "formFields"] },
    { "id": "formTitle", "component": "h2", "props": { "value": "User Info", "className": "text-xl font-bold text-slate-800 mb-6" } },
    { "id": "formFields", "component": "div", "props": { "className": "flex flex-col gap-4" }, "children": ["usernameInput", "emailInput"] },
    { "id": "usernameInput", "component": "Input", "props": { "value": { "path": "/username" }, "placeholder": "Username", "label": "Username" } },
    { "id": "emailInput", "component": "Input", "props": { "value": { "path": "/email" }, "placeholder": "Email", "label": "Email" } }
  ]
}`

function componentCatalogList(catalog: ComponentCatalog): string {
  const components = catalog === "desktop" ? DESKTOP_COMPONENTS : MOBILE_COMPONENTS
  return components.join(", ")
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
  const catalogLabel = opts.catalog === "desktop" ? "Desktop (43 components)" : "Mobile (12 components)"
  const components = componentCatalogList(opts.catalog)
  const designSystem = opts.catalog === "desktop" ? DESKTOP_DESIGN_SYSTEM : MOBILE_DESIGN_SYSTEM

  const parts = [
    `[Pattern Mode: A2UI Generative UI]`,
    `Component Catalog: ${catalogLabel}`,
    `Available Components: ${components}`,
    ``,
    `You MUST output valid A2UI JSON Protocol format:`,
    `{ "state": {...}, "rootId": "...", "elements": [...] }`,
    ``,
    `Key rules:`,
    `- All elements in a flat "elements" array, nesting via "children" ID references`,
    `- Data binding: props.value = { "path": "/fieldName" }`,
    `- Loop: children = { "path": "/array", "componentId": "templateId" }`,
    `- Slot: content = { "componentId": "slotElementId" }`,
    `- HTML5 native elements: div, span, p, h1-h6, img, a, section (with className for Tailwind)`,
    `- Use realistic mock data with semantic key names`,
    `- Use Lucide icons, randomuser.me avatars, fpoimg.com placeholders`,
    `- Chart data keys should start/end with "Chart"`,
    `- Every referenced path MUST exist in state object`,
    `- Output ONLY valid JSON. No markdown, no code blocks, no explanations.`,
    `- rootId MUST be "pattern_root"`,
    `- FIRST element must be the root element`,
    `- Parent MUST appear before children in elements array`,
    `- ID naming: [Zone][Module][Type] camelCase (e.g. headerNavBtn)`,
    `- Inline style FORBIDDEN. Use ONLY Tailwind className`,
    `- MUST use ALL items in every array AND ALL keys from the data`,
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
    `### Form/Two-way Binding`,
    FORM_EXAMPLE,
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
