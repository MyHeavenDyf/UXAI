# LineChart | 折线图

The chart already includes a legend and does not require an additional one.

### Example: Basic Line Chart
- Use `xAxis.data` to specify the field name for X-axis
- `yAxisTitle` is the Y-axis visible label (required)

```json
{
  "id": "lineChart",
  "component": "LineChart",
  "props": {
    "option": {
      "data": [
        { "Month": "Jan", "Train": 84, "Bus": 56 },
        { "Month": "Feb", "Train": 55, "Bus": 39 }
      ],
      "xAxis": { "data": "Month" },
      "yAxisTitle": "Percentage(%)"
    },
    "className": "h-16 w-full"
  }
}
```

### Optional Props (add to `option`)
- `"smooth": true` — smooth curve display
- `"step": true` — step line display
- `"stack": true` — stacked lines
- `"color": ["#2070F3", "#63b430"]` — custom line colors
- `"markLine": { "top": 38, "bottom": 20 }` — threshold reference lines
- `"xAxis": { "data": "Month", "name": "Time" }` — X-axis with display name