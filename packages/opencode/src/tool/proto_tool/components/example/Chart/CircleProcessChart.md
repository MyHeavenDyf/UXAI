# CircleProcessChart | 圆环进度图

### Example: Basic CircleProcess Chart
- Use `data` prop with `value` and `name` fields

```json
{
  "id": "circleProcessChart",
  "component": "CircleProcessChart",
  "props": {
    "option": {
      "data": [{ "value": 71, "name": "Utilization rate" }]
    },
    "className": "h-16 w-full"
  }
}
```

### Optional Props (add to `option`)
- `"color": ["#2070F3"]` — custom CircleProcess color
