# BarLineChart | 折柱混合图

The chart already includes a legend and does not require an additional one.

### Example: BarLineChart
- Use `xAxis.data` to specify the field name for X-axis dimension
- `yAxis` is the Y-axis (required)

```json
{
  "id": "barLineChart",
  "component": "BarLineChart",
  "props": {
    "option": {
      "data": [
        { "Month": "Jan", "Domestic": 33, "Abroad": 27, "Exit": 23 },
        { "Month": "Feb", "Domestic": 27, "Abroad": 19, "Exit": 14 },
        { "Month": "Mar", "Domestic": 31, "Abroad": 20, "Exit": 10 },
        { "Month": "Apr", "Domestic": 32, "Abroad": 15, "Exit": 6 },
      ],
      "lineOption":{
        "dataName": ["Domestic"],
        "smooth": true
      },
      "barOption": {
        "dataName": ["Domestic","Abroad","Exit"],
        "label": {
          "show": true,
          "position": "top"
        }
      },
      "xAxis": {
        "data": "Month",
      },
      "yAxis": [
        {
          "position": "left",
          "dataName": ["Domestic"],
          "name": "单价",
          "unit": "元",
        },
        {
          "position": "right",
          "dataName": ["Abroad", "Exit"],
          "name": "百分比(%)",
          "unit": "%",
        }
      ]
    },
    "className": "h-16 w-full"
  }
}
```

### Optional Props (add to `option`)
- `"markLine": { "top": 38, topUse: ['Domestic'] }` — threshold reference line