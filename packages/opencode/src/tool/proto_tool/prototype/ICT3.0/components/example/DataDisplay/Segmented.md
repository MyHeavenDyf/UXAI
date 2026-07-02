# Segmented

### Example: Segmented with data binding options

```json
{
  "state": {
    "currentView": "overview",
    "viewOptions": [
      {
        "label": "概览",
        "value": "overview",
        "icon": "layout-dashboard"
      },
      {
        "label": "趋势",
        "value": "trend",
        "icon": "chart-line"
      },
      {
        "label": "配置",
        "value": "setting",
        "icon": "settings"
      }
    ]
  },
  "rootId": "viewSegmented",
  "elements": [
    {
      "id": "viewSegmented",
      "component": "Segmented",
      "props": {
        "value": { "path": "/currentView" },
        "options": { "path": "/viewOptions" },
        "block": true,
        "orientation": "horizontal",
        "size": "medium",
        "className": "w-full"
      }
    }
  ]
}
```

### Example: Segmented with static options

```json
{
  "id": "timeRangeSegmented",
  "component": "Segmented",
  "props": {
    "value": "7d",
    "options": [
      {
        "label": "近 7 天",
        "value": "7d"
      },
      {
        "label": "近 30 天",
        "value": "30d"
      },
      {
        "label": "近 90 天",
        "value": "90d"
      }
    ],
    "block": false,
    "orientation": "horizontal",
    "size": "small",
    "className": "w-fit"
  }
}
```

### Example: Segmented vertical

```json
{
  "id": "moduleSegmented",
  "component": "Segmented",
  "props": {
    "value": "account",
    "options": [
      {
        "label": "账号信息",
        "value": "account",
        "icon": "user"
      },
      {
        "label": "安全设置",
        "value": "security",
        "icon": "shield"
      },
      {
        "label": "通知偏好",
        "value": "notification",
        "icon": "bell"
      }
    ],
    "orientation": "vertical",
    "size": "medium",
    "className": "w-40"
  }
}
```
