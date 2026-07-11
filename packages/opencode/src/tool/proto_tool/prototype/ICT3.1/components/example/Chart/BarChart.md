# BarChart | 柱状图

The chart already includes a legend and does not require an additional one.

### Example: Basic Bar Chart
- Use `xAxis.data` to specify the field name for X-axis dimension
- `yAxisTitle` is the Y-axis visible label (required)

```json
{
  "id": "barChart",
  "component": "BarChart",
  "props": {
    "option": {
      "data": [
        { "Month": "Jan", "Domestic": 33, "Abroad": 20 },
        { "Month": "Feb", "Domestic": 27, "Abroad": 39 }
      ],
      "xAxis": { "data": "Month" },
      "yAxisTitle": "Percentage(%)"
    },
    "className": "h-16 w-full"
  }
}
```

### Optional Props (add to `option`)
- `"direction": "horizontal"` — horizontal bar orientation
- `"color": ["#2070F3", "#63b430"]` — custom bar colors
- `"markLine": { "top": 38 }` — threshold reference line

### Example: Double-sided Bar Chart
- Use `type: "double-sides"` for bidirectional bars

```json
{
  "id": "doubleSidesBarChart",
  "component": "BarChart",
  "props": {
    "option": {
      "type": "double-sides",
      "data": [
        { "Month": "Jan", "上行": 33, "下行": 37 },
        { "Month": "Feb", "上行": 27, "下行": 39 }
      ],
      "xAxis": { "data": "Month" },
      "yAxisTitle": "Percent(%)"
    },
    "className": "h-16 w-full"
  }
}
```

### Example: Stacked Bar Chart
- Use `type: "stack"` for stacked bars
- Use `stack` object to define custom stack groups (field name arrays)

```json
{
  "id": "stackBarChart",
  "component": "BarChart",
  "props": {
    "option": {
      "type": "stack",
      "stack": { "GroupA": ["A1", "A2"], "GroupB": ["B1"] },
      "data": [
        { "Time": "T1", "A1": 33, "A2": 5, "B1": 23 },
        { "Time": "T2", "A1": 27, "A2": 8, "B1": 28 }
      ],
      "xAxis": { "data": "Time" },
      "yAxisTitle": "Count"
    },
    "className": "h-16 w-full"
  }
}
```