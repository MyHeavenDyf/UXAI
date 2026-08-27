# Dropdown | 下拉菜单

### Example: Dropdown basic

```json
{
  "id": "menuDropdown",
  "component": "Dropdown",
  "props": {
    "menu": [
      { "label": "菜单项一", "key": "item1", "icon": "user" },
      { "label": "菜单项二", "key": "item2", "icon": "settings" },
      { "label": "菜单项三", "key": "item3", "icon": "delete" }
    ]
  },
  "children": ["menuButton"]
},
{
  "id": "menuButton",
  "component": "div",
  "props": { "className": "p-4", "value": "菜单" }
}
```

### Example: Dropdown with trigger

```json
{
  "id": "dropdownClick",
  "component": "Dropdown",
  "props": {
    "trigger": ["click"],
    "menu": [
      { "label": "复制", "key": "copy" },
      { "label": "粘贴", "key": "paste" },
      { "label": "剪切", "key": "cut" }
    ]
  },
  "children": ["operations"]
},
{
  "id": "operations",
  "component": "div",
  "props": { "className": "p-4", "value": "菜单" }
}
```

### Example: Dropdown with placement

```json
{
  "id": "dropdownBottomLeft",
  "component": "Dropdown",
  "props": {
    "placement": "bottomLeft",
    "menu": [
      { "label": "左下角菜单位置", "key": "1" }
    ]
  },
  "children": ["dropdownPosition"]
},
{
  "id": "dropdownPosition",
  "component": "div",
  "props": { "className": "p-4", "value": "左下角" }
}
```

### Example: Dropdown with nested submenu

```json
{
  "id": "submenuDropdown",
  "component": "Dropdown",
  "props": {
    "trigger": ["click"],
    "menu": [
      {
        "label": "文件",
        "key": "file",
        "icon": "file",
        "children": [
          { "label": "新建", "key": "new", "icon": "file-plus" },
          { "label": "打开", "key": "open", "icon": "folder-open" },
          {
            "label": "最近打开",
            "key": "recent",
            "icon": "history",
            "children": [
              { "label": "需求文档.docx", "key": "doc1" },
              { "label": "设计稿.fig", "key": "doc2" },
              { "label": "接口规范.md", "key": "doc3" }
            ]
          }
        ]
      },
      { "label": "编辑", "key": "edit", "icon": "edit" },
      { "label": "视图", "key": "view", "icon": "eye" }
    ]
  },
  "children": ["submenuButton"]
},
{
  "id": "submenuButton",
  "component": "div",
  "props": { "className": "p-4", "value": "菜单" }
}
```
