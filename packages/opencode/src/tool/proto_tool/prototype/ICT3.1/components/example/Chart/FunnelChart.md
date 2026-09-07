# FunnelChart | 漏斗图

The chart already includes a legend and does not require an additional one.

### Example: Basic Funnel Chart
- Data uses `name` and `value` fields, sorted by value descending by default

```json
{
  "id": "funnelChart",
  "component": "FunnelChart",
  "props": {
    "option": {
      "data": [
        { "value": 100, "name": "Show" },
        { "value": 80, "name": "Click" },
        { "value": 60, "name": "Visit" },
        { "value": 30, "name": "Order" }
      ]
    },
    "className": "h-16 w-full"
  }
}
```

### Optional Props (add to `option`)
- `"sort": "ascending"` — sort direction (values: `"descending"`, `"ascending"`, `"none"`, default: `"descending"`)
- `"direction": "horizontal"` — horizontal funnel orientation
- `"color": ["#2070F3", "#63b430", "#715afb", "#2db8ca"]` — custom slice colors
