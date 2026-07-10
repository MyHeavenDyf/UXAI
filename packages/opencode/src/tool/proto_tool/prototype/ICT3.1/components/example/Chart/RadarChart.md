# RadarChart | 雷达图

The chart already includes a legend and does not require an additional one.

### Example: Basic Radar Chart
- Use `data` prop with series name as key and dimension-value pairs as value
- Use `radarMax` to set the maximum value for the outermost circle

```json
{
  "id": "radarChart",
  "component": "RadarChart",
  "props": {
    "option": {
      "radarMax": 100,
      "data": {
        "Domestic": {
          "Equipment": 41,
          "VM": 91,
          "CSP": 81
        }
      }
    },
    "className": "h-16 w-full"
  }
}
```

### Optional Props (add to `option`)
- `"area": { "show": false }` — control radar area fill (default true)
- `"color": ["#2db8ca"]` — custom radar color
- `"markLine": 81` — threshold circle line
- `"radar": { "shape": "polygon" }` — polygon shape (default is circle)