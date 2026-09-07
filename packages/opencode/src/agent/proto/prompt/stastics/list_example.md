{
	"state": {
		"news": [
			{ "id": 1, "imgSrc": "https://picsum.photos/id/101/200/200", "title": "产品更新", "desc": "新版本功能介绍", "time": "10:30" },
			{ "id": 2, "imgSrc": "https://picsum.photos/id/102/200/200", "title": "活动通知", "desc": "本周活动预告", "time": "09:15" },
			{ "id": 3, "imgSrc": "https://picsum.photos/id/103/200/200", "title": "数据统计", "desc": "上月数据报告", "time": "昨天" }
		]
	},
	"rootId": "mainListContainer",
	"elements": [
		{ "id": "mainListContainer", "component": "div", "props": { "className": "flex flex-col gap-3 p-4" }, "children": ["mainListLoop"] },
		{ "id": "mainListLoop", "component": "div", "props": { "className": "flex flex-col" }, "children": { "path": "/news", "componentId": "mainListItem" } },
		{ "id": "mainListItem", "component": "div", "props": { "className": "flex gap-3 p-3 bg-white rounded-lg border border-slate-200 hover:shadow-sm transition-shadow" }, "children": ["mainListItemImg", "mainListItemContent"] },
		{ "id": "mainListItemImg", "component": "div", "props": { "className": "w-16 h-16 shrink-0 rounded-lg overflow-hidden" }, "children": ["mainListItemImage"] },
		{ "id": "mainListItemImage", "component": "img", "props": { "src": { "path": "imgSrc" }, "className": "w-full h-full object-cover" } },
		{ "id": "mainListItemContent", "component": "div", "props": { "className": "flex-1 min-w-0 flex flex-col justify-center" }, "children": ["mainListItemTitle", "mainListItemDesc", "mainListItemTime"] },
		{ "id": "mainListItemTitle", "component": "span", "props": { "value": { "path": "title" }, "className": "text-sm font-semibold text-slate-800" } },
		{ "id": "mainListItemDesc", "component": "span", "props": { "value": { "path": "desc" }, "className": "text-xs text-slate-500 mt-1" } },
		{ "id": "mainListItemTime", "component": "span", "props": { "value": { "path": "time" }, "className": "text-xs text-slate-400 mt-2" } }
	]
}