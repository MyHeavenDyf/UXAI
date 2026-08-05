# Modal

### Example: A detail modal triggered by a button. `open` / `onClose` bind to the same shared boolean state, the body is a single wrapper node passed to `children`, and the footer is rendered via a SlotNode.

```json
{
  "state": {
    "isDetailModalOpen": false
  },
  "rootId": "demoRoot",
  "elements": [
    {
      "id": "demoRoot",
      "component": "div",
      "props": { "className": "p-inset" },
      "children": ["openBtn", "detailModal"]
    },
    {
      "id": "openBtn",
      "component": "Button",
      "props": {
        "value": "查看详情",
        "color": "primary",
        "onClick": {
          "action": "setState",
          "args": { "path": "/isDetailModalOpen", "value": true }
        }
      }
    },
    {
      "id": "detailModal",
      "component": "Modal",
      "props": {
        "open": { "path": "/isDetailModalOpen" },
        "title": "订单详情",
        "mask": true,
        "footer": { "componentId": "modalFooter" },
        "onClose": {
          "action": "setState",
          "args": { "path": "/isDetailModalOpen", "value": false }
        }
      },
      "children": ["modalBody"]
    },
    {
      "id": "modalBody",
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
      "id": "modalFooter",
      "component": "div",
      "props": { "className": "flex justify-end gap-inline" },
      "children": ["cancelBtn", "confirmBtn"]
    },
    {
      "id": "cancelBtn",
      "component": "Button",
      "props": {
        "value": "关闭",
        "onClick": {
          "action": "setState",
          "args": { "path": "/isDetailModalOpen", "value": false }
        }
      }
    },
    {
      "id": "confirmBtn",
      "component": "Button",
      "props": {
        "value": "确认",
        "color": "primary",
        "onClick": {
          "action": "setState",
          "args": { "path": "/isDetailModalOpen", "value": false }
        }
      }
    }
  ]
}
```

### Example: Modal element only, no footer (`footer` omitted). Body content is still a single wrapper node.

```json
{
  "id": "deleteModal",
  "component": "Modal",
  "props": {
    "open": { "path": "/isDeleteModalOpen" },
    "title": "确认删除",
    "mask": true,
    "onClose": {
      "action": "setState",
      "args": { "path": "/isDeleteModalOpen", "value": false }
    }
  },
  "children": ["deleteBody"]
},
{
  "id": "deleteBody",
  "component": "span",
  "props": { "className": "text-sm text-on-surface", "value": "删除后不可恢复，确定要继续吗？" }
}
```
