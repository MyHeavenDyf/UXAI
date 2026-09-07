# Tabs

### Example: Demonstrating the Component Composition between Tabs and TabItem, featuring Slot Syntax for flexible content distribution within individual items.

```json
{
  "state": {
    "activeTab": "tab1",
    "rbacConfig": [
      { "id": "tab1", "label": "用户管理", "icon": "user", "content": "这是用户管理面板" },
      { "id": "tab2", "label": "角色管理", "icon": "team", "content": "这是角色管理面板" },
      { "id": "tab3", "label": "权限管理", "icon": "safety", "content": "这是权限管理面板" }
    ]
  },
  "rootId": "tabsContainer",
  "elements": [
    {
      "id": "tabsContainer",
      "component": "Tabs",
      "props": {
        "activeKey": { "path": "/activeTab" }
      },
      "children": {
        "path": "/rbacConfig",
        "componentId": "dynamicTabItem"
      }
    },
    {
      "id": "dynamicTabItem",
      "component": "TabItem",
      "props": {
        "key": { "path": "id" },
        "label": { "path": "label" },
        "icon": { "path": "icon" },
        "content": { "componentId": "tabContent" }
      }
    },
    {
      "id": "tabContent",
      "component": "div",
      "props": { "className": "p-4", "value": { "path": "content" } }
    }
  ]
}

```

### Example: Applicable to asymmetric attribute structures, not applicable to loops, and tiles all items. Slot Syntax (`componentId`) works in static tiling mode too, enabling complex component composition.

```json	
{
    "id": "design",
    "component": "Tabs",
    "props": { "activeKey": "ui" },
    "children": ["ui", "ux", "interaction"]
}, 
{
    "id": "ui",
    "component": "TabItem",
    "props": { "key": "ui", "label": "UI设计师", "icon": "building", "content": { "componentId": "uiContent" } }
},
{
    "id": "ux",
    "component": "TabItem",
    "props": { "key": "ux", "label": "UX设计师", "icon": "hand-platter", "content": { "componentId": "uxContent" } }
},
{
    "id": "interaction",
    "component": "TabItem",
    "props": { "key": "interaction", "label": "交互设计师", "content": "交互设计师专注于动态操作逻辑（点击、反馈）" }
},
{
    "id": "uiContent",
    "component": "div",
    "props": { "className": "flex flex-col gap-2 p-4" },
    "children": ["uiTitle", "uiDesc"]
},
{
    "id": "uiTitle",
    "component": "span",
    "props": { "className": "font-semibold text-slate-800", "value": "视觉美感专家" }
},
{
    "id": "uiDesc",
    "component": "span",
    "props": { "className": "text-sm text-slate-500", "value": "UI设计师专注视觉美感（布局、色彩、图标）" }
},
{
    "id": "uxContent",
    "component": "div",
    "props": { "className": "flex flex-col gap-2 p-4" },
    "children": ["uxTitle", "uxDesc"]
},
{
    "id": "uxTitle",
    "component": "span",
    "props": { "className": "font-semibold text-slate-800", "value": "用户体验策略师" }
},
{
    "id": "uxDesc",
    "component": "span",
    "props": { "className": "text-sm text-slate-500", "value": "UX设计师侧重用户体验策略（研究、流程、结构）" }
}

```