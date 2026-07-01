# ProcessChart | 进度条

### Example: Basic Progress Bar
- Use `name: "ProcessBarChart"` for horizontal progress bar
- Data uses `name` and `value` fields

```json
{
  "id": "processChart",
  "component": "ProcessChart",
  "props": {
    "option": {
      "name": "ProcessBarChart",
      "data": [
        { "name": "UniEPMgr", "value": 80 },
        { "name": "SMLoglic", "value": 65 },
        { "name": "SSO", "value": 45 }
      ]
    },
    "className": "h-16 w-full"
  }
}
```

### Optional Props (add to `option`)
- `"color": ["#2070F3", "#63b430", "#715afb"]` — custom bar colors
- `"unit": "%"` — value suffix (e.g., `"%"`, `"MB"`, `"GB"`)

### Example: Stacked Progress Bar
- Use `name: "StackProcessBarChart"` for stacked horizontal progress bar
- Data uses `name` and `children` arrays (each child has `type` and `value`)

```json
{
  "id": "stackProcessChart",
  "component": "ProcessChart",
  "props": {
    "option": {
      "name": "StackProcessBarChart",
      "data": [
        {
          "name": "China",
          "children": [
            { "type": "Game", "value": 30 },
            { "type": "Move", "value": 20 }
          ]
        },
        {
          "name": "Mexico",
          "children": [
            { "type": "Game", "value": 12 },
            { "type": "Move", "value": 14 }
          ]
        }
      ]
    },
    "className": "h-16 w-full"
  }
}
```