# Carousel

### Example: Carousel with dynamic item rendering

```json
{
  "state": {
    "bannerList": [
      {
        "id": "banner1",
        "title": "智能数据分析",
        "description": "实时洞察业务趋势，辅助团队快速决策"
      },
      {
        "id": "banner2",
        "title": "自动化工作流",
        "description": "将重复流程自动化，提升整体协作效率"
      },
      {
        "id": "banner3",
        "title": "安全权限管理",
        "description": "统一管理用户、角色与资源访问策略"
      }
    ]
  },
  "rootId": "dashboardCarousel",
  "elements": [
    {
      "id": "dashboardCarousel",
      "component": "Carousel",
      "props": {
        "arrows": true,
        "adaptiveHeight": true,
        "dotPlacement": "bottom",
        "className": "w-full rounded-xl overflow-hidden"
      },
      "children": {
        "path": "/bannerList",
        "componentId": "bannerCard"
      }
    },
    {
      "id": "bannerCard",
      "component": "div",
      "props": {
        "className": "flex min-h-48 flex-col justify-center gap-3 rounded-xl bg-slate-900 p-8 text-white"
      },
      "children": ["bannerTitle", "bannerDescription"]
    },
    {
      "id": "bannerTitle",
      "component": "span",
      "props": {
        "className": "text-2xl font-semibold",
        "value": { "path": "title" }
      }
    },
    {
      "id": "bannerDescription",
      "component": "span",
      "props": {
        "className": "text-sm text-slate-300",
        "value": { "path": "description" }
      }
    }
  ]
}
```

### Example: Carousel with static items

```json
{
  "id": "productCarousel",
  "component": "Carousel",
  "props": {
    "arrows": true,
    "dotPlacement": "bottom",
    "className": "w-full"
  },
  "children": ["productSlide1", "productSlide2", "productSlide3"]
},
{
  "id": "productSlide1",
  "component": "div",
  "props": {
    "className": "rounded-lg bg-blue-50 p-6",
    "value": "产品能力：统一数据接入"
  }
},
{
  "id": "productSlide2",
  "component": "div",
  "props": {
    "className": "rounded-lg bg-emerald-50 p-6",
    "value": "产品能力：自动化任务编排"
  }
},
{
  "id": "productSlide3",
  "component": "div",
  "props": {
    "className": "rounded-lg bg-violet-50 p-6",
    "value": "产品能力：多角色协作管理"
  }
}
```
