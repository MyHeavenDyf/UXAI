# StackedBar | 状态分布堆叠条形图

### Example: Basic Stacked Bar
- 四个状态数值，自动计算比例渲染

```json
{
  "id": "stackedBar",
  "component": "PatStackedBar",
  "props": {
    "normal": 45,
    "warning": 20,
    "danger": 25,
    "error": 10
  }
}
```

### Example: With DataBinding
- 绑定 state 中的动态数据

```json
{
  "id": "stackedBarHealth",
  "component": "PatStackedBar",
  "props": {
    "normal": { "path": "/healthStatus/normal" },
    "warning": { "path": "/healthStatus/warning" },
    "danger": { "path": "/healthStatus/danger" },
    "error": { "path": "/healthStatus/error" }
  }
}
```
