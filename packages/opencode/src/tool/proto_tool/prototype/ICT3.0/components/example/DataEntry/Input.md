# Input | 输入框

### Example: Basic Input

```json
{
  "id": "inputBasic",
  "component": "Input",
  "props": {
    "value": { "path": "/inputVal" },
    "placeholder": "请输入内容"
  }
}
```

### Example: Input with size

```json
{
  "state": {
    "largeInput": ""
  },
  "rootId": "inputLarge",
  "elements": [
    {
      "id": "inputLarge",
      "component": "Input",
      "props": {
        "value": { "path": "/largeInput" },
        "placeholder": "大号输入框",
        "size": "large"
      }
    }
  ]
}
```

### Example: Input with maxLength

```json
{
  "state": {
    "limitedInput": ""
  },
  "rootId": "inputMaxLength",
  "elements": [
    {
      "id": "inputMaxLength",
      "component": "Input",
      "props": {
        "value": { "path": "/limitedInput" },
        "placeholder": "最多输入10个字符",
        "maxLength": 10
      }
    }
  ]
}
```

### Example: Input with prefix/suffix icon

```json
{
  "id": "inputWithPrefix",
  "component": "Input",
  "props": {
    "value": { "path": "/username" },
    "placeholder": "请输入用户名",
    "prefix": "user"
  }
},
{
  "id": "inputWithSuffix",
  "component": "Input",
  "props": {
    "value": { "path": "/email" },
    "placeholder": "请输入邮箱",
    "suffix": "mail"
  }
}
```

### Example: Input with password

```json
{
  "state": {
    "password": ""
  },
  "rootId": "inputPassword",
  "elements": [
    {
      "id": "inputPassword",
      "component": "Input",
      "props": {
        "value": { "path": "/password" },
        "placeholder": "请输入密码",
        "password": true
      }
    }
  ]
}
```

### Example: Input with className

```json
{
  "state": {
    "styledInput": ""
  },
  "rootId": "inputStyled",
  "elements": [
    {
      "id": "inputStyled",
      "component": "Input",
      "props": {
        "value": { "path": "/styledInput" },
        "placeholder": "自定义样式",
        "className": "w-64 bg-blue-50 border-blue-300"
      }
    }
  ]
}
```