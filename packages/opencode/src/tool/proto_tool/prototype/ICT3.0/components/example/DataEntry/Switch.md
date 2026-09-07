# Switch | 开关

### Example: Switch basic

```json
{
  "id": "switchBasic",
  "component": "Switch",
  "props": {
    "value": false
  }
}
```

### Example: Switch with text

```json
{
  "id": "switchBasic",
  "component": "Switch",
  "props": {
    "value": { "path": "/switchVal" },
    "checkedChildren": "开启",
    "unCheckedChildren": "关闭"
  }
}
```

### Example: Switch with icons

```json
{
  "id": "switchWithIcon",
  "component": "Switch",
  "props": {
    "value": { "path": "/wifiSwitch" },
    "checkedChildrenIcon": "wifi",
    "unCheckedChildrenIcon": "close"
  }
}
```

### Example: Switch size

```json
{
    "id": "switchSmall",
    "component": "Switch",
    "props": { "value": { "path": "/small" }, "size": "small" }
}
```
