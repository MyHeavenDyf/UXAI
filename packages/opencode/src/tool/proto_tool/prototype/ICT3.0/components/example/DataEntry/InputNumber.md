# InputNumber | 数字输入框

### Example: Basic InputNumber

```json
{
  "id": "inputNumberBasic",
  "component": "InputNumber",
  "props": {
    "value": { "path": "/numVal" },
    "placeholder": "请输入数字"
  }
}
```

### Example: InputNumber with range

```json
{
  "id": "inputNumberRange",
  "component": "InputNumber",
  "props": {
    "value": { "path": "/age" },
    "min": 0,
    "max": 100,
    "placeholder": "请输入年龄"
  }
}
```

### Example: InputNumber with step

```json
{
  "id": "inputNumberStep",
  "component": "InputNumber",
  "props": {
    "value": { "path": "/price" },
    "min": 0,
    "step": 0.1,
    "placeholder": "请输入价格",
    "className": "w-32 bg-blue-50"
  }
}
```

### Example: InputNumber with controls

```json
{
  "id": "inputNumberControls",
  "component": "InputNumber",
  "props": {
    "value": { "path": "/withControls" },
    "min": 0,
    "max": 100,
    "controls": true
  }
}
```

### Example: InputNumber with size

```json
{
  "id": "inputNumberLarge",
  "component": "InputNumber",
  "props": {
    "value": { "path": "/largeNumber" },
    "size": "large",
    "placeholder": "大号"
  }
}
```