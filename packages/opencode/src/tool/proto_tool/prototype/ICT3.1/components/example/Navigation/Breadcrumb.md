# Breadcrumb | 面包屑

### Example: Breadcrumb basic

```json
{
  "id": "breadcrumbBasic",
  "component": "Breadcrumb",
  "props": {
    "items": [
      { "title": "首页" },
      { "title": "商品列表" },
      { "title": "详情页" }
    ]
  }
}
```

### Example: Breadcrumb with separator

```json
{
  "id": "breadcrumbSeparator",
  "component": "Breadcrumb",
  "props": {
    "separator": "/",
    "items": [
      { "title": "首页" },
      { "title": "订单管理" },
      { "title": "订单详情" }
    ]
  }
}
```

### Example: Breadcrumb with icons

```json
{
  "id": "breadcrumbWithIcon",
  "component": "Breadcrumb",
  "props": {
    "items": [
      { "title": { "componentId": "homeIcon" }},
      { "title": "产品中心" },
      { "title": "当前页面" }
    ]
  }
},
{
  "id": "homeIcon",
  "component": "Icon",
  "props": { "name": "house" }
}
```

### Example: Breadcrumb replaces the current item with the separator

```json
{
  "id": "breadcrumbWithIcon",
  "component": "Breadcrumb",
  "props": {
    "items": [
      { "title": "位置"},
      { "type": "separator", "separator": ":" },
      { "title": "应用中心" },
      { "title": "应用A" }
    ]
  }
}
```