# CategoryInput | 分类输入 示例

## Example: Basic CategoryInput

```json
{
  "state": {
    "inputValue": "",
    "category": 1,
    "categoryOptions": [
      { "text": "China", "value": 1 },
      { "text": "UK", "value": 2 },
      { "text": "USA", "value": 3 }
    ]
  },
  "rootId": "categoryInputBasic",
  "elements": [
    {
      "id": "categoryInputBasic",
      "component": "CategoryInput",
      "props": {
        "categoryOptions": { "path": "/categoryOptions" },
        "category": { "path": "/category" },
        "value": { "path": "/inputValue" },
        "placeholder": "请输入内容"
      }
    }
  ]
}
```

## Example: CategoryInput with inputPosition

```json
{
  "state": {
    "inputValue": 100,
    "category": 2,
    "categoryOptions": [
      { "text": "China", "value": 1 },
      { "text": "UK", "value": 2 },
      { "text": "USA", "value": 3 }
    ]
  },
  "rootId": "categoryInputFormat",
  "elements": [
    {
      "id": "categoryInputFormat",
      "component": "CategoryInput",
      "props": {
        "categoryOptions": { "path": "/categoryOptions" },
        "category": { "path": "/category" },
        "value": { "path": "/inputValue" },
        "placeholder": "请输入数值",
        "inputPosition": "right"
      }
    }
  ]
}
```

## Example: Disabled CategoryInput

```json
{
  "state": {
    "inputValue": "示例值",
    "category": 1,
    "categoryOptions": [
      { "text": "China", "value": 1 },
      { "text": "UK", "value": 2 },
      { "text": "USA", "value": 3 }
    ]
  },
  "rootId": "categoryInputDisabled",
  "elements": [
    {
      "id": "categoryInputDisabled",
      "component": "CategoryInput",
      "props": {
        "categoryOptions": { "path": "/categoryOptions" },
        "category": { "path": "/category" },
        "value": { "path": "/inputValue" },
        "disabled": true
      }
    }
  ]
}
```
