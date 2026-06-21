# Select | 下拉选择器

### Example: Basic Select

```json
{
  "id": "selectBasic",
  "component": "Select",
  "props": {
    "value": { "path": "/selectedValue" },
    "placeholder": "请选择城市",
    "options": [
      { "label": "红色", "value": "red" },
      { "label": "黄色", "value": "yellow" },
      { "label": "蓝色", "value": "blue" }
    ]
  }
}
```

### Example: Select with size

```json
{
  "id": "selectLarge",
  "component": "Select",
  "props": {
    "value": { "path": "/largeSelect" },
    "size": "large",
    "options": [
      { "label": "大号选项1", "value": "option1" },
      { "label": "大号选项2", "value": "option2" }
    ]
  }
}
```

### Example: Select with showSearch

```json
{
  "id": "selectSearch",
  "component": "Select",
  "props": {
    "value": { "path": "/searchValue" },
    "placeholder": "搜索选项...",
    "showSearch": true,
    "options": [
      { "label": "北京市", "value": "beijing" },
      { "label": "上海市", "value": "shanghai" },
      { "label": "广州市", "value": "guangzhou" },
      { "label": "深圳市", "value": "shenzhen" },
      { "label": "杭州市", "value": "hangzhou" },
      { "label": "成都市", "value": "chengdu" }
    ]
  }
}

```

### Example: Select with mode (multiple)

```json
{
  "id": "selectMultiple",
  "component": "Select",
  "props": {
    "value": { "path": "/multiValues" },
    "placeholder": "请选择多个",
    "mode": "multiple",
    "className": "w-64 bg-blue-50",
    "options": [
      { "label": "红色", "value": "red" },
      { "label": "黄色", "value": "yellow" },
      { "label": "蓝色", "value": "blue" },
      { "label": "绿色", "value": "green" }
    ]
  }
}

```