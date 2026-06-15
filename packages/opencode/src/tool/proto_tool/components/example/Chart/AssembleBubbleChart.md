# AssembleBubbleChart | 组装气泡图

The chart already includes a legend and does not require an additional one.

### Example: Basic Assemble Bubble Chart
- Data is an array of objects with bubble metadata
- Each item contains `name`, `value`, and category info

```json
{
  "id": "assembleBubbleChart",
  "component": "AssembleBubbleChart",
  "props": {
    "option": {
      "data": [
        { "type": "亚洲", "value": 960, "label": "中国", "showLabel": true },
        { "type": "欧洲", "value": 150, "label": "德国", "showLabel": true },
        { "type": "非洲", "value": 100, "label": "南非" },
      ]
    },
    "className": "h-16 w-full"
  }
}
```

### Optional Props (add to `option`)
- `"color": ["#2070F3", "#63b430", "#715afb"]` — custom bubble colors


### Example: Nested Assemble Bubble Chart

```json
{
  "id": "assembleBubbleChart",
  "component": "AssembleBubbleChart",
  "props": {
    "option": {
      "data": [
        {
          "type": "VPCC", "value": 100, "label": "VPCC",
          "children": [
            { "value": 28, "label": "UK", "showLabel": true },
            { "value": 20, "label": "Denmark" },
          ]
        },
        {
          "type": "EIP", "value": 100, "label": "EIP",
          "children": [
            { "value": 23, "label": "Angola", "showLabel": true },
            { "value": 23, "label": "Libya" },
          ]
        },
      ]
    },
    "className": "h-16 w-full"
  }
}