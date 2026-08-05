# Drawer

### Example: A detail drawer triggered by a button, sliding in from the right. `open` / `onClose` bind to the same shared boolean state, the body is a single wrapper node passed to `children`, and the footer is rendered via a SlotNode.

```json
{
  "state": {
    "isDetailDrawerOpen": false
  },
  "rootId": "demoRoot",
  "elements": [
    {
      "id": "demoRoot",
      "component": "div",
      "props": { "className": "p-inset" },
      "children": ["openBtn", "detailDrawer"]
    },
    {
      "id": "openBtn",
      "component": "Button",
      "props": {
        "value": "查看详情",
        "color": "primary",
        "onClick": {
          "action": "setState",
          "args": { "path": "/isDetailDrawerOpen", "value": true }
        }
      }
    },
    {
      "id": "detailDrawer",
      "component": "Drawer",
      "props": {
        "open": { "path": "/isDetailDrawerOpen" },
        "placement": "right",
        "title": "订单详情",
        "mask": true,
        "footer": { "componentId": "drawerFooter" },
        "onClose": {
          "action": "setState",
          "args": { "path": "/isDetailDrawerOpen", "value": false }
        }
      },
      "children": ["drawerBody"]
    },
    {
      "id": "drawerBody",
      "component": "div",
      "props": { "className": "flex flex-col gap-inline" },
      "children": ["bodyLabel", "bodyText"]
    },
    {
      "id": "bodyLabel",
      "component": "span",
      "props": { "className": "text-sm text-on-surface-variant", "value": "物流状态" }
    },
    {
      "id": "bodyText",
      "component": "span",
      "props": { "className": "text-sm text-on-surface", "value": "订单 SO-20260802-0042 已发货，预计明日送达。" }
    },
    {
      "id": "drawerFooter",
      "component": "div",
      "props": { "className": "flex justify-end gap-inline" },
      "children": ["cancelBtn", "applyBtn"]
    },
    {
      "id": "cancelBtn",
      "component": "Button",
      "props": {
        "value": "关闭",
        "onClick": {
          "action": "setState",
          "args": { "path": "/isDetailDrawerOpen", "value": false }
        }
      }
    },
    {
      "id": "applyBtn",
      "component": "Button",
      "props": {
        "value": "确认",
        "color": "primary",
        "onClick": {
          "action": "setState",
          "args": { "path": "/isDetailDrawerOpen", "value": false }
        }
      }
    }
  ]
}
```

### Example: Drawer element only, no footer (`footer` omitted). Body content is still a single wrapper node.

```json
{
  "id": "filterDrawer",
  "component": "Drawer",
  "props": {
    "open": { "path": "/isFilterDrawerOpen" },
    "placement": "left",
    "title": "筛选条件",
    "mask": true,
    "onClose": {
      "action": "setState",
      "args": { "path": "/isFilterDrawerOpen", "value": false }
    }
  },
  "children": ["filterBody"]
},
{
  "id": "filterBody",
  "component": "span",
  "props": { "className": "text-sm text-on-surface", "value": "在此放置筛选表单内容。" }
}
```
