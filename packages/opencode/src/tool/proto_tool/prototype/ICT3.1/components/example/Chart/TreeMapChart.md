# TreeMapChart | 矩形树图

The chart already includes a legend and does not require an additional one.

### Example: Basic TreeMap Chart

```json
{
  "id": "barChart",
  "component": "BarChart",
  "props": {
    "option": {
      "data": [
        { "value": 120, "name": "Access" },
        { 
          "value": 180, 
          "name": "Node", 
          "children": [
            {
              "value": 76, 
              "name": "NodeA", 
              "children": [
                { "value": 12, "name": "NodeA1" }, 
                {"value": 28, "name": "NodeA2"}, 
                {"value": 20, "name": "NodeA3"}, 
                {"value": 16, "name": "NodeA4"}
              ]
            }, 
            {
              "value": 90, 
              "name": "NodeB", 
              "children": [
                {"value": 25, "name": "NodeB1"}, 
                {"value": 15, "name": "NodeB2"}, 
                {"value": 20, "name": "NodeB3"}, 
                {"value": 30, "name": "NodeB4"}
              ]
            }, 
            {"value": 14, "name": "NodeC"}
          ] 
        },
        { 
          "value": 200, 
          "name": "Plugs", 
          "children": [
            {
              "value": 50, 
              "name": "PlugsA", 
              "children": [
                {"value": 24, "name": "PlugsA1"}, 
                {"value": 16, "name": "PlugsA2"}, 
                {"value": 10, "name": "PlugsA3"}
              ]
            }, 
            {
              "value": 30, 
              "name": "PlugsB", 
              "children": [
                {"value": 18, "name": "PlugsB1"}, 
                {"value": 7, "name": "PlugsB2"}, 
                {"value": 5, "name": "PlugsB3"}
              ]
            }, 
            {"value": 100, "name": "PlugsC"}, 
            {"value": 20, "name": "PlugsD"}
          ] 
        },
        { 
          "value": 120, 
          "name": "ConfigA", 
          "children": [
            {"value": 80, "name": "ConfigA1"}, 
            {"value": 10, "name": "ConfigA2"}, 
            {"value": 30, "name": "ConfigA3"}
          ]
        }
      ]
    },
    "className": "h-16 w-full"
  }
}
```

### Optional Props (add to `option`)
- `"color": ["#2070F3", "#63b430", "#715afb"]` — custom treeMap colors

