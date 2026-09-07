# BulletChart | 子弹图

The chart already includes a legend and does not require an additional one.

### Example: Basic Bullet Chart
- Data uses ranges, measures, and target values for comparison
- `yAxisTitle` is the Y-axis visible label (required)

```json
{
  "id": "bulletChart",
  "component": "BulletChart",
  "props": {
    "option": {
      "data": [
        { "Month": "Jan", "Score": 400 },
        { "Month": "Feb", "Score": 800}
      ],
      "yAxisTitle": "Amount",
      "markLine": {
        "name": "info",
        "data": "600"
      }
    },
    "className": "h-16 w-full"
  }
}
```

### Optional Props (add to `option`)
- `"direction": "horizontal"` — horizontal bullet orientation
- `"color": ["#2070F3", "#63b430"]` — custom bullet colors
