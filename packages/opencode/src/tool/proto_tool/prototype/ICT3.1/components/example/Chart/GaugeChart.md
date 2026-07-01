# GaugeChart | 仪表盘

### Example: Basic Gauge Chart
- Use `data` prop with `value` and `name` fields

```json
{
  "id": "gaugeChart",
  "component": "GaugeChart",
  "props": {
    "option": {
      "data": [{ "value": 71, "name": "Utilization rate" }]
    },
    "className": "h-16 w-full"
  }
}
```

### Optional Props (add to `option`)
- `"color": ["#2070F3"]` — custom gauge color
- `"pointer": true` — show gauge pointer needle
- `"min": 0, "max": 100, "splitNumber": 4` — custom range and divisions
- `"markLine": 88` — threshold value (gauge turns red when exceeded)
- `"splitColor": [[0.25, "#0d9458"], [0.5, "#eeba18"], [0.75, "#ec6f1a"], [1, "#f43146"]]` — multi-color ranges