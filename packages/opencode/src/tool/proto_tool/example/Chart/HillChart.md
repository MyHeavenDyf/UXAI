# HillChart | 山丘图

The chart already includes a legend and does not require an additional one.

### Example: Basic Hill Chart
- Data is an array of objects representing hill/area distribution

```json
{
  "id": "hillChart",
  "component": "HillChart",
  "props": {
    "option": {
      "data": [
        { "name": "Group A", "value": 40 },
        { "name": "Group B", "value": 25 },
        { "name": "Group C", "value": 35 }
      ]
    },
    "className": "h-16 w-full"
  }
}
```

### Optional Props (add to `option`)
- `"color": ["#2070F3", "#63b430", "#715afb"]` — custom hill colors
