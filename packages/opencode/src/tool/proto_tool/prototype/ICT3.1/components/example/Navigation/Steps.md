# Steps

### Steps Example: Demonstrating the Component Composition between Steps and StepItem, featuring Slot Syntax for flexible content distribution within individual items.

```json
{
	"state": {
		"currentStep": 1,
		"personalInfo": [
			{ "message": "基本信息", "information": "填写个人基本信息", "status": "finish","icon": "user" },
			{ "message": "教育经历", "information": "填写教育背景", "status": "process","icon": "graduation-cap" }
			{ "message": "工作经历", "information": "填写工作经历", "status": "wait","icon": "briefcase" }
			{ "message": "技能证书", "information": "上传技能证书", "status": "wait","icon": "award" }
		]
	},
	"rootId": "resume",
	"elements": [
		{
			"id": "resume",
			"component": "Steps",
			"props": { "current": { "path": "/currentStep" }, "types": "dot", "className": "mb-6" },
			"children": { "path": "/personalInfo", "componentId": "resumeStep" }
		},
		{
			"id": "resumeStep",
			"component": "StepItem",
			"props": { "title": { "path": "message" }, "content": { "componentId": "personalResume" }, "status": { "path": "status" }, "icon": { "path": "icon" } }
		},
		{
			"id": "personalResume",
			"component": "div",
			"props": { "className": "p-4", "value": { "path": "information" } }
		}
	]
}
```

### Example: Applicable to asymmetric attribute structures, not applicable to loops, and tiles all items.Slot Syntax (`componentId`) works in static tiling mode too, enabling complex component composition.

```json

{
	"id": "order",
	"component": "Steps",
	"props": { "current": 2,"types": "default","className": "mb-6" },
    "children": ["orderProgression1", "orderProgression2", "orderProgression3"]
},
{
	"id": "orderProgression1",
	"component": "StepItem",
	"props": { "title": "已下单","content": { "componentId": "information" },"status": "finish","icon": "shopping-cart" }
},
{
	"id": "orderProgression2",
	"component": "StepItem",
	"props": { "title": "已付款","content": "等待商家确认","icon": "credit-card" }
},
{
	"id": "orderProgression3",
	"component": "StepItem",
	"props": { "title": "已发货","status": "wait","icon": "package-plus" }
},
{
    "id": "information",
    "component": "span",
    "props": { "className": "font-semibold", "value": "订单已成功提交" }
}

```
