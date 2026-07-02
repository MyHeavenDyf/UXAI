# Dropdown | 下拉菜单

### Example: Dropdown basic

```json
{
  "id": "menuDropdown",
  "component": "Dropdown",
  "props": {
    "menu": [
      { "label": "菜单项一", "key": "item1", "icon": "user" },
      { "label": "菜单项二", "key": "item2", "icon": "setting" },
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
