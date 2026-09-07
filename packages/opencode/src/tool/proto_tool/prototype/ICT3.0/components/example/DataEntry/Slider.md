# Slider | 滑动输入条

### Example: Basic Slider

```json
{
  "id": "SliderMaxMin",
  "component": "Slider",
  "props": {
    "value": { "path": "/sliderVal" },
    "min": 0,
    "max": 100,
    "step": 5
  }
}
```

### Example: Slider with range (dual thumb)

```json
{
  "state": {
    "dualValue": [20, 80]
  },
  "rootId": "sliderDual",
  "elements": [
    {
      "id": "sliderDual",
      "component": "Slider",
      "props": {
        "value": { "path": "/dualValue" },
        "min": 0,
        "max": 100,
        "range": true
      }
    }
  ]
}
```

### Example: Slider with orientation (vertical)

```json
{
  "id": "sliderVertical",
  "component": "Slider",
  "props": {
    "value": { "path": "/verticalValue" },
    "min": 0,
    "max": 100,
    "orientation": "vertical"
  }
}
```

### Example: Slider with input

```json
{
  "id": "sliderInput",
  "component": "Slider",
  "props": {
    "value": { "path": "/inputValue" },
    "min": 0,
    "max": 100,
    "input": true
  }
}
```

### Example: Slider with marks

```json
{
  "id": "sliderMarks",
  "component": "Slider",
  "props": {
    "value": { "path": "/markValue" },
    "min": 0,
    "max": 100,
    "marks": {
      "0": "0",
      "25": "25",
      "50": "50",
      "75": "75",
      "100": "100"
    }
  }
}
```