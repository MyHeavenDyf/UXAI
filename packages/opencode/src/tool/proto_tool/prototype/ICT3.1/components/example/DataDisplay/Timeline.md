# Timeline

## Usage constraints for child node ids

- Each child node id must be owned by exactly one parent component and one child or slot position.
- Do not reuse the same node id in multiple `children` arrays or multiple `{ "componentId": "..." }` slot/template references.
- Do not reuse a loop template `componentId` as another static child or as another parent's template.
- If two structures look similar, create separate child nodes such as `projectOverviewPanel` and `userOverviewPanel` instead of sharing `overviewPanel`.
- Component-specific keys such as `props.key` can reuse the same semantic value in different components, but the node `id` must still be unique per usage.

### Example: Demonstrating the Component Composition between Timeline and TimelineItem, featuring Slot Syntax for flexible content distribution within individual items.

```json
{
	"state": {
		"progression": [
			{ "date": "2024-02-01", "projectInfo": "项目上线仪式", "icon": "rocket" },
			{ "date": "2023-12-15", "projectInfo": "完成核心功能开发", "icon": "code" }
			{ "date": "2023-12-01", "projectInfo": "项目启动会", "icon": "play" }
		]
	},
	"rootId": "projectShowcase",
	"elements": [
		{
			"id": "projectShowcase",
			"component": "Timeline",
			"props": { "orientation": "vertical" },
			"children": { "path": "/progression", "componentId": "projectStatus" }
		},
		{
			"id": "projectStatus",
			"component": "TimelineItem",
			"props": { "title": { "path": "date" }, "content": { "componentId": "progressInformation" }, "icon": { "path": "icon" } }
		},
		{
			"id": "progressInformation",
			"component": "div",
			"props": { "className": "p-4", "value": { "path": "projectInfo" } }
		}
	]
}
```

### Example: Applicable to asymmetric attribute structures, not applicable to loops, and tiles all items.Slot Syntax (`componentId`) works in static tiling mode too, enabling complex component composition.

```json
{
    "id": "order",
    "component": "Timeline",
    "props": { "orientation": "vertical" },
    "children": ["orderProgression1", "orderProgression2", "orderProgression3"]
},
{.
    "id": "orderProgression1",
    "component": "TimelineItem",
    "props": { "title": "2024-01-11 10:00","content": { "componentId": "information" }, "icon": "store" }
},
{
    "id": "orderProgression2",
    "component": "TimelineItem",
    "props": { "title": "2024-01-13 18:45","content": "已到达【北京朝阳区配送站】" }
},
{
    "id": "orderProgression3",
    "component": "TimelineItem",
    "props": { "title": "2024-01-15 14:30","content": "已签收，感谢您的购买", "icon": "check-circle" }
},
{
    "id": "information",
    "component": "span",
    "props": { "className": "font-semibold", "value": "商家已发货" }
}
```
