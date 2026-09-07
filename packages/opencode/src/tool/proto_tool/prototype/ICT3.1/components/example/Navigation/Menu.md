# Menu

### Example: Menu with data binding items

```json
{
  "state": {
    "selectedMenuKeys": ["dashboard"],
    "openMenuKeys": ["workspace"],
    "menuItems": [
      {
        "title": "仪表盘",
        "key": "dashboard",
        "icon": "layout-dashboard"
      },
      {
        "title": "工作台",
        "key": "workspace",
        "icon": "briefcase"
      },
      {
        "title": "报表中心",
        "key": "reports",
        "icon": "chart-column"
      },
      {
        "title": "系统设置",
        "key": "settings",
        "icon": "settings",
        "children": [
          {
            "title": "权限配置",
            "key": "system-permission",
            "icon": "shield-check"
          }
        ]
      }
    ]
  },
  "rootId": "sideMenu",
  "elements": [
    {
      "id": "sideMenu",
      "component": "Menu",
      "props": {
        "mode": "vertical",
        "inlineCollapsed": false,
        "selectedKeys": { "path": "/selectedMenuKeys" },
        "openKeys": { "path": "/openMenuKeys" },
        "items": { "path": "/menuItems" },
        "className": "h-full w-64"
      }
    }
  ]
}
```


### Example: Menu horizontal static

```json
{
  "id": "topMenu",
  "component": "Menu",
  "props": {
    "mode": "horizontal",
    "selectedKeys": ["product"],
    "items": [
      {
        "title": "产品",
        "key": "product",
        "icon": "package"
      },
      {
        "title": "解决方案",
        "key": "solution",
        "icon": "sparkles"
      },
      {
        "title": "文档",
        "key": "docs",
        "icon": "book-open"
      },
      {
        "title": "控制台",
        "key": "console",
        "icon": "monitor"
      }
    ],
    "className": "w-full"
  }
}
```
