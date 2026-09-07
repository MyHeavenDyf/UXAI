{
	"state": { "title": "今日任务", "description": "完成项目报告并提交", "status": "进行中", "progress": 65 },
	"rootId": "mainCardContainer",
	"elements": [
		{ "id": "mainCardContainer", "component": "div", "props": { "className": "p-4 bg-white rounded-lg shadow-sm border border-slate-200" }, "children": ["mainCardHeader", "mainCardBody", "mainCardFooter"] },
		{ "id": "mainCardHeader", "component": "div", "props": { "className": "flex justify-between items-center mb-3" }, "children": ["mainCardTitle", "mainCardTag"] },
		{ "id": "mainCardTitle", "component": "span", "props": { "value": { "path": "/title" }, "className": "text-base font-semibold text-slate-800" } },
		{ "id": "mainCardTag", "component": "Tag", "props": { "value": { "path": "/status" }, "color": "blue" } },
		{ "id": "mainCardBody", "component": "div", "props": { "className": "mb-3" }, "children": ["mainCardDesc"] },
		{ "id": "mainCardDesc", "component": "span", "props": { "value": { "path": "/description" }, "className": "text-sm text-slate-500" } },
		{ "id": "mainCardFooter", "component": "div", "props": { "className": "flex items-center gap-2" }, "children": ["mainCardProgress", "mainCardProgressText"] },
		{ "id": "mainCardProgress", "component": "Progress", "props": { "percent": { "path": "/progress" }, "showInfo": false, "strokeColor": "#3b82f6" } },
		{ "id": "mainCardProgressText", "component": "span", "props": { "value": { "path": "/progress" }, "className": "text-xs text-slate-400 ml-auto" } },
		{ "id": "mainCardBtn", "component": "Button", "props": { "value": "查看详情", "type": "primary", "size": "small", "className": "mt-3" } }
	]
}