# JadeJueChart | 玉玦图

The chart already includes a legend and does not require an additional one.

### Example: Basic JadeJue Chart
- Data is an array of objects representing jade jue segments

```json
{
  "id": "jadeJueChart",
  "component": "JadeJueChart",
  "props": {
    "option": {
      "data": [
        { "name": "Category A", "value": 45 },
        { "name": "Category B", "value": 30 },
        { "name": "Category C", "value": 25 }
      ]
    },
    "className": "h-16 w-full"
  }
}
```

### Optional Props (add to `option`)
- `"color": ["#2070F3", "#63b430", "#715afb"]` — custom segment colors
