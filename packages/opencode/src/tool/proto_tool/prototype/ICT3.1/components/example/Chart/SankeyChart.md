# SankeyChart | 桑基图

The chart already includes a legend and does not require an additional one.

### Example: Basic Sankey Chart
```json
{
  "id": "sankeyChart",
  "component": "SankeyChart",
  "props": {
    "option": {
      "sortType": "unset",
      "data": {
        "nodes": [
          { "name": "香菜", "value": 49 },
          { "name": "蒜泥", "value": 18.5 },
          { "name": "小米辣", "value": 15 },
          { "name": "其他配料", "value": 21.5 },
          { "name": "蘸料组合A", "value": 45 },
          { "name": "蘸料组合B", "value": 40 },
          { "name": "其他组合", "value": 19 }, 
          { "name": "火锅蘸料", "value": 104 }
        ],
        "links": [
          { "source": "香菜", "target": "蘸料组合A", "value": 38.5 },
          { "source": "蒜泥", "target": "蘸料组合A", "value": 6.5 },
          { "source": "蘸料组合A", "target": "火锅蘸料", "value": 45 },
          { "source": "香菜", "target": "蘸料组合B", "value": 10.5 },
          { "source": "蒜泥", "target": "蘸料组合B", "value": 12 },
          { "source": "小米辣", "target": "蘸料组合B", "value": 12.5 },
          { "source": "其他配料", "target": "蘸料组合B", "value": 5 }, 
          { "source": "蘸料组合B", "target": "火锅蘸料", "value": 40 },
          { "source": "小米辣", "target": "其他组合", "value": 2.5 },
          { "source": "其他配料", "target": "其他组合", "value": 16.5 },
          { "source": "其他组合", "target": "火锅蘸料", "value": 19 }
        ]
      }
    },
    "className": "h-16 w-full"
  }
}
```

### Optional Props (add to `option`)
- `"color": ["#2070F3", "#63b430", "#715afb"]` — custom sankey colors