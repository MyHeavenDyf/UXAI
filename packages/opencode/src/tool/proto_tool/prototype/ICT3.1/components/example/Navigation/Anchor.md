# Anchor | 锚点 示例

## Example: Anchor basic

```json
{
  "id": "anchorBasic",
  "component": "Anchor",
  "props": {
    "offsetTop": 0,
    "items": [
      { "key": "1", "href": "#anchor-1", "title": "基础用法" },
      { "key": "2", "href": "#anchor-2", "title": "高级用法" },
      { "key": "3", "href": "#anchor-3", "title": "API 说明" }
    ]
  }
}
```

## Example: Anchor with nested children

```json
{
  "id": "anchorNested",
  "component": "Anchor",
  "props": {
    "offsetTop": 0,
    "items": [
      {
        "key": "1",
        "href": "#anchor-1",
        "title": "基础用法",
        "children": [
          { "key": "1-1", "href": "#anchor-1-1", "title": "安装" },
          { "key": "1-2", "href": "#anchor-1-2", "title": "引入" }
        ]
      },
      { "key": "2", "href": "#anchor-2", "title": "高级用法" },
      { "key": "3", "href": "#anchor-3", "title": "API 说明" }
    ]
  }
}
```

## Example: Anchor items bound to state

```json
{
  "state": {
    "anchorItems": [
      { "key": "1", "href": "#anchor-1", "title": "基础用法" },
      { "key": "2", "href": "#anchor-2", "title": "高级用法" },
      { "key": "3", "href": "#anchor-3", "title": "API 说明" }
    ]
  },
  "rootId": "anchorBound",
  "elements": [
    {
      "id": "anchorBound",
      "component": "Anchor",
      "props": {
        "offsetTop": 0,
        "items": { "path": "/anchorItems" }
      }
    }
  ]
}
```
