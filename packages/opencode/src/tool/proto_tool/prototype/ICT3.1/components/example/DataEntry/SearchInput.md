# SearchInput | 搜索输入框 示例

## Example: Basic SearchInput

```json
{
  "state": { "searchValue": "" },
  "rootId": "searchInputBasic",
  "elements": [
    {
      "id": "searchInputBasic",
      "component": "SearchInput",
      "props": {
        "value": { "path": "/searchValue" },
        "placeholder": "请输入搜索关键词",
        "popItems": [
          { "text": "选项一", "value": "1" },
          { "text": "选项二", "value": "2" },
          { "text": "选项三", "value": "3" }
        ]
      }
    }
  ]
}
```

## Example: SearchInput with popItems bound to state

```json
{
  "state": {
    "searchValue": "",
    "searchPopItems": [
      { "text": "China", "value": 1 },
      { "text": "UK", "value": 2 },
      { "text": "USA", "value": 3 }
    ]
  },
  "rootId": "searchInputBound",
  "elements": [
    {
      "id": "searchInputBound",
      "component": "SearchInput",
      "props": {
        "value": { "path": "/searchValue" },
        "placeholder": "请输入搜索关键词",
        "popItems": { "path": "/searchPopItems" }
      }
    }
  ]
}
```

## Example: Disabled SearchInput

```json
{
  "state": { "searchValue": "" },
  "rootId": "searchInputDisabled",
  "elements": [
    {
      "id": "searchInputDisabled",
      "component": "SearchInput",
      "props": {
        "value": { "path": "/searchValue" },
        "placeholder": "禁用状态",
        "disabled": true,
        "popItems": [
          { "text": "选项一", "value": "1" },
          { "text": "选项二", "value": "2" }
        ]
      }
    }
  ]
}
```
