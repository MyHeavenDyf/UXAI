# Popover | 气泡卡片 示例

## Example: Popover basic

```json
{
  "id": "infoPopover",
  "component": "Popover",
  "props": {
    "title": "提示",
    "content": { "componentId": "infoContent" }
  },
  "children": ["infoTrigger"]
},
{
  "id": "infoTrigger",
  "component": "div",
  "props": { "className": "p-2", "value": "悬停查看" }
},
{
  "id": "infoContent",
  "component": "span",
  "props": { "className": "text-sm", "value": "这是一段弹出内容。" }
}
```

## Example: Popover with trigger and placement

```json
{
  "id": "confirmPopover",
  "component": "Popover",
  "props": {
    "title": "确认删除",
    "placement": "topRight",
    "trigger": ["click"],
    "content": { "componentId": "confirmContent" }
  },
  "children": ["deleteBtn"]
},
{
  "id": "deleteBtn",
  "component": "Button",
  "props": { "value": "删除", "types": "danger" }
},
{
  "id": "confirmContent",
  "component": "div",
  "props": { "className": "flex flex-col gap-2 p-2" },
  "children": ["confirmText", "confirmActions"]
},
{
  "id": "confirmText",
  "component": "span",
  "props": { "value": "此操作不可撤销，是否继续？", "className": "text-sm" }
},
{
  "id": "confirmActions",
  "component": "div",
  "props": { "className": "flex gap-2" },
  "children": ["confirmYes", "confirmNo"]
},
{
  "id": "confirmYes",
  "component": "Button",
  "props": { "value": "确定", "types": "danger" }
},
{
  "id": "confirmNo",
  "component": "Button",
  "props": { "value": "取消" }
}
```

### Example: Popover with DataBinding title

```json
{
  "id": "userPopover",
  "component": "Popover",
  "props": {
    "title": { "path": "/currentUser" },
    "placement": "bottom",
    "content": { "componentId": "userContent" }
  },
  "children": ["userTrigger"]
},
{
  "id": "userTrigger",
  "component": "div",
  "props": { "className": "p-2", "value": "用户信息" }
},
{
  "id": "userContent",
  "component": "span",
  "props": { "value": { "path": "/userDetail" }, "className": "text-sm" }
}
```
