# BubbleChart | 气泡图

The chart already includes a legend and does not require an additional one.

### Example: Basic Bubble Chart
- Data uses `name`, `value` (bubble size), `xAxis`, `yAxis` fields
- `yAxisTitle` is the Y-axis visible label (required)

```json
{
  "id": "bubbleChart",
  "component": "BubbleChart",
  "props": {
    "option": {
      "data": {
        "1990": [
            [28604, 77, 17096866, "Australia", 1990],
            [31163, 77.4, 27662440, "Canada", 1990],
            [60001, 68, 1154605773, "China", 1990]
        ],
        "2000": [
            [19349, 69.6, 147568552, "Russia", 2000],
            [10670, 67.3, 53994606, "Turkey", 2000],
            [26424, 75.7, 57110117, "United Kingdom", 2000],
        ],
        "2015": [
            [44056, 81.8, 23968976, "Australia", 2015],
            [43294, 81.7, 35939927, "Canada", 2015],
            [13334, 76.9, 1376048943, "China", 2015]
        ]
      },
    },
    "className": "h-16 w-full"
  }
}
```

### Optional Props (add to `option`)
- `"color": ["#2070F3", "#63b430"]` — custom bubble colors
