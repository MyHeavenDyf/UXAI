# TextArea | 文本域

### Example: Basic TextArea

```json
{
  "state": {
    "textValue": ""
  },
  "rootId": "textareaBasic",
  "elements": [
    {
      "id": "textareaBasic",
      "component": "TextArea",
      "props": {
        "value": { "path": "/textValue" },
        "placeholder": "请输入内容..."
      }
    }
  ]
}
```




### Example: TextArea with size (small)

```json
{
  "state": {
    "smallText": ""
  },
  "rootId": "textareaSmall",
  "elements": [
    {
      "id": "textareaSmall",
      "component": "TextArea",
      "props": {
        "value": { "path": "/smallText" },
        "placeholder": "小号文本域",
        "size": "small"
      }
    }
  ]
}
```

### Example: TextArea with maxLength and autoSize

```json
{
  "state": {
    "limitedText": ""
  },
  "rootId": "textareaMaxLength",
  "elements": [
    {
      "id": "textareaMaxLength",
      "component": "TextArea",
      "props": {
        "value": { "path": "/limitedText" },
        "placeholder": "最多输入200个字符",
        "maxLength": 200,
        "autoSize": true
      }
    }
  ]
}
```


### Example: TextArea with prefix/suffix

```json
{
    "id": "textareaWithPrefix",
    "component": "TextArea",
    "props": { "value": { "path": "/withPrefix" }, "placeholder": "带前缀", "prefix": "edit" }
},
{
    "id": "textareaWithSuffix",
    "component": "TextArea",
    "props": { "value": { "path": "/withSuffix" }, "placeholder": "带后缀", "suffix": "info-circle" }
}
```