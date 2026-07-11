# DatePicker | 日期选择器

### Example: Basic DatePicker

```json
{
  "id": "datePickerBasic",
  "component": "DatePicker",
  "props": {
    "value": { "path": "/dateVal" },
    "placeholder": "请选择日期"
  }
}
```

### Example: DatePicker with range

```json
{
  "id": "datePickerRange",
  "component": "DatePicker",
  "props": {
    "value": { "path": "/dateRange" },
    "placeholder": ["开始日期", "结束日期"],
    "range": true
  }
}
```

### Example: DatePicker with picker types

```json
{
    "id": "datePickerDate",
    "component": "DatePicker",
    "props": { "value": { "path": "/date" }, "placeholder": "日期", "picker": "date" }
},
{
    "id": "datePickerWeek",
    "component": "DatePicker",
    "props": { "value": { "path": "/week" }, "placeholder": "周", "picker": "week" }
},
{
    "id": "datePickerMonth",
    "component": "DatePicker",
    "props": { "value": { "path": "/month" }, "placeholder": "月份", "picker": "month" }
},
{
    "id": "datePickerYear",
    "component": "DatePicker",
    "props": { "value": { "path": "/year" }, "placeholder": "年份", "picker": "year" }
}
```

### Example: DatePicker with size
```json
{
  "state": {
    "smallDate": ""
  },
  "rootId": "datePickerSmall",
  "elements": [
    {
      "id": "datePickerSmall",
      "component": "DatePicker",
      "props": {
        "value": { "path": "/smallDate" },
        "placeholder": "小号日期选择器",
        "size": "small"
      }
    }
  ]
}
```

### Example: DatePicker with format

```json
{
  "id": "datePickerFormat",
  "component": "DatePicker",
  "props": {
    "value": { "path": "/customDate" },
    "placeholder": "请选择日期",
    "format": "YYYY-MM-DD"
  }
}
```

### Example: DatePicker with className

```json
{
  "id": "datePickerStyled",
  "component": "DatePicker",
  "props": {
    "value": { "path": "/styledDate" },
    "placeholder": "自定义样式",
    "className": "w-48 bg-blue-50"
  }
}
```

### Example: DatePicker range with picker

```json
{
  "state": {
    "monthRange": []
  },
  "rootId": "datePickerMonthRange",
  "elements": [
    {
      "id": "datePickerMonthRange",
      "component": "DatePicker",
      "props": {
        "value": { "path": "/monthRange" },
        "placeholder": ["开始月份", "结束月份"],
        "range": true,
        "picker": "month"
      }
    }
  ]
}
```