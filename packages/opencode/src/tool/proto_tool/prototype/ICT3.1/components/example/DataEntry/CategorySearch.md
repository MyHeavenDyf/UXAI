# CategorySearch | 分类搜索 示例

## Example: Basic CategorySearch

```json
{
  "state": {
    "searchValue": "",
    "category": 1,
    "categoryOptions": [
      { "text": "China", "value": 1 },
      { "text": "UK", "value": 2 },
      { "text": "USA", "value": 3 }
    ]
  },
  "rootId": "categorySearchBasic",
  "elements": [
    {
      "id": "categorySearchBasic",
      "component": "CategorySearch",
      "props": {
        "categoryOptions": { "path": "/categoryOptions" },
        "category": { "path": "/category" },
        "value": { "path": "/searchValue" }
      }
    }
  ]
}
```

## Example: CategorySearch with placeholder

```json
{
  "state": {
    "searchValue": "",
    "category": 1,
    "categoryOptions": [
      { "text": "China", "value": 1 },
      { "text": "UK", "value": 2 },
      { "text": "USA", "value": 3 }
    ]
  },
  "rootId": "categorySearchPlaceholder",
  "elements": [
    {
      "id": "categorySearchPlaceholder",
      "component": "CategorySearch",
      "props": {
        "categoryOptions": { "path": "/categoryOptions" },
        "category": { "path": "/category" },
        "value": { "path": "/searchValue" },
        "placeholder": "请输入搜索关键词"
      }
    }
  ]
}
```
