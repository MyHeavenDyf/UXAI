# PieChart | 饼图

The chart already includes a legend and does not require an additional one.

### Example: Basic Pie Chart (Donut)
- Pie chart requires `name` and `value` fields in data

```json
{
  "id": "pieChart",
  "component": "PieChart",
  "props": {
    "option": {
      "data": [
        { "value": 100, "name": "VPC" },
        { "value": 90, "name": "IM" },
        { "value": 49, "name": "EIP" }
      ]
    },
    "className": "h-16 w-full"
  }
}
```

### Optional Props (add to `option`)
- `"color": ["#2070F3", "#63b430", "#715afb"]` — custom slice colors
- `"label": { "show": true }` — show/hide slice labels
- `"title": { "text": "160", "subText": "总数" }` — center text overlay