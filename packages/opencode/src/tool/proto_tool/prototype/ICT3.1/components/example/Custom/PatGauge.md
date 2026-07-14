# Gauge | 仪表盘

### Example: Basic Gauge
- 传入 value 和 max，自动渲染半圆仪表盘

```json
{
  "id": "gaugeCpu",
  "component": "PatGauge",
  "props": {
    "value": 72,
    "max": 100
  }
}
```

### Example: With DataBinding
- 绑定 state 中的动态数据

```json
{
  "id": "gaugeMemory",
  "component": "PatGauge",
  "props": {
    "value": { "path": "/memoryUsage" },
    "max": { "path": "/memoryTotal" }
  }
}
```