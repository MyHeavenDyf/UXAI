# TimePicker | 时间选择器

### Example: Basic TimePicker

```json
{
  "id": "timePickerBasic",
  "component": "TimePicker",
  "props": {
    "value": { "path": "/timeVal" },
    "placeholder": "请选择时间"
  }
}
```

### Example: TimePicker with range (true)

```json
{
  "id": "timePickerRange",
  "component": "TimePicker",
  "props": {
    "value": { "path": "/timeRange" },
    "placeholder": ["开始时间", "结束时间"],
    "range": true
  }
}

```

### Example: TimePicker with size 

```json
{
  "id": "timePickerLarge",
  "component": "TimePicker",
  "props": {
    "value": { "path": "/largeTime" },
    "placeholder": "大号时间选择器",
    "size": "large"
  }
}
```

### Example: TimePicker with format

```json
{
  "id": "timePickerFormat",
  "component": "TimePicker",
  "props": {
    "value": { "path": "/formattedTime" },
    "placeholder": "HH:mm:ss",
    "format": "HH:mm:ss",
    "hourStep": 1,
    "minuteStep": 15,
    "secondStep": 30,
    "className": "w-48 bg-blue-50"
  }
}
```
