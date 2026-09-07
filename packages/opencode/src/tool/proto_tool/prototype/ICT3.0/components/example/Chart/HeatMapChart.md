# HeatMapChart | 热力图 

The chart already includes a legend and does not require an additional one.

### Example: Rectangular HeatMap Chart
- Use `type: "RectangularHeatMapChart"` for calendar HeatMap Chart

```json
{
  "id": "heatMapChart",
  "component": "HeatMapChart",
  "props": {
    "option": {
      "type": "RectangularHeatMapChart",
      "color": ["#F43146"],
      "rectangleSize": 8,
      "yAxisName": "手机市场占比%",
      "data": [
          [11, 10, 10, "Australia"],
          [30, 20, 21, "Canada"],
          [40, 60, 29, "China"],
          [50, 5, 30, "Cuba"],
          [55, 10, 31, "Finland"]
      ]
    }
  }
}
```

### Example: Calendar HeatMap Chart
- Use `type: "CalendarHeatMapChart"` for calendar HeatMap Chart

```json
{
  "id": "calendarHeatMapChart",
  "component": "HeatMapChart",
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

### Optional Props (add to `option`)
- `"color": ["#2070F3", "#63b430", "#715afb"]` — custom heatMap colors