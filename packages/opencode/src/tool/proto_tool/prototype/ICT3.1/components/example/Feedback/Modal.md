# Modal

### Example: A detail modal triggered by a button. `open` / `onClose` bind to the same shared boolean state, the body is a single wrapper node passed to `children`, and the footer is rendered via a SlotNode.

```json
{
  "state": {
    "isDetailModalOpen": false
  },
  "rootId": "entryContainer",
  "elements": [
    {
      "id": "entryContainer",
      "component": "div",
      "props": { "className": "p-6" },
      "children": ["openDetailBtn"]
    },
    {
      "id": "openDetailBtn",
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
      "id": "orderDetailModal",
      "component": "Modal",
      "props": {
        "open": { "path": "/isDetailModalOpen" },
        "title": "订单详情",
        "mask": true,
        "footer": { "componentId": "orderDetailModalFooter" },
        "onClose": {
          "action": "setState",
          "args": { "path": "/isDetailModalOpen", "value": false }
        }
      },
      "children": ["orderDetailModalBody"]
    },
    {
      "id": "orderDetailModalBody",
      "component": "div",
      "props": { "className": "flex flex-col gap-2" },
      "children": ["orderDetailModalLabel", "orderDetailModalValue"]
    },
    {
      "id": "orderDetailModalLabel",
      "component": "span",
      "props": { "className": "text-sm text-slate-400", "value": "物流状态" }
    },
    {
      "id": "orderDetailModalValue",
      "component": "span",
      "props": { "className": "text-sm text-slate-600", "value": "订单 SO-20260802-0042 已发货，预计明日送达。" }
    },
    {
      "id": "orderDetailModalFooter",
      "component": "div",
      "props": { "className": "flex justify-end gap-2" },
      "children": ["orderDetailModalCancelBtn", "orderDetailModalConfirmBtn"]
    },
    {
      "id": "orderDetailModalCancelBtn",
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
      "id": "orderDetailModalConfirmBtn",
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
  "id": "confirmDeleteModal",
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
  "children": ["confirmDeleteModalBody"]
},
{
  "id": "confirmDeleteModalBody",
  "component": "span",
  "props": { "className": "text-sm text-slate-600", "value": "删除后不可恢复，确定要继续吗？" }
}
```
