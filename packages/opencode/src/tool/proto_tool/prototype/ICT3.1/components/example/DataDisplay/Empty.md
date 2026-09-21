# Empty 示例

## Example: Default empty state

```json
{
  "rootId": "emptyDefault",
  "elements": [
    {
      "id": "emptyDefault",
      "component": "Empty"
    }
  ]
}
```

## Example: description / image as string literals

```json
{
  "rootId": "emptyString",
  "elements": [
    {
      "id": "emptyString",
      "component": "Empty",
      "props": {
        "description": "暂无订单数据",
        "image": "/images/empty.svg"
      }
    }
  ]
}
```

## Example: description / image as DataBinding

```json
{
  "state": {
    "emptyText": "未找到相关内容",
    "emptyImage": "/images/empty.svg"
  },
  "rootId": "emptyBinding",
  "elements": [
    {
      "id": "emptyBinding",
      "component": "Empty",
      "props": {
        "description": { "path": "/emptyText" },
        "image": { "path": "/emptyImage" }
      }
    }
  ]
}
```

## Example: description / image as SlotNode

```json
{
  "rootId": "emptySlot",
  "elements": [
    {
      "id": "emptySlot",
      "component": "Empty",
      "props": {
        "description": { "componentId": "emptyDescNode" },
        "image": { "componentId": "emptyImageNode" }
      }
    },
    {
      "id": "emptyDescNode",
      "component": "div",
      "props": {
        "className": "text-sm",
        "value": "暂无数据，请稍后再试"
      }
    },
    {
      "id": "emptyImageNode",
      "component": "Icon",
      "props": {
        "name": "inbox",
        "className": "w-12 h-12"
      }
    }
  ]
}
```
