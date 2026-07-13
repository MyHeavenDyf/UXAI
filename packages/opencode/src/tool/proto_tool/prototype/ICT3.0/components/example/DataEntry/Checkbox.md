# Checkbox | 多选框

### Example: Checkbox basic

```json
{
	"state": {
		"checked": true,
		"checkboxLabel": "红色" 
	},
	"rootId": "colorPickerSection",
	"elements": [
		{
			"id": "colorPickerSection",
			"component": "Checkbox",
			"props": {
				"checked": {
					"path": "/checked"
				},
				"label": {
					"path": "/checkboxLabel"
				}
			}
		}
	]
}
```
### Example: Checkbox children

```json
{
	"state": {
		"checked": true
	},
	"rootId": "colorPickerSection",
	"elements": [
		{
			"id": "colorPickerSection",
			"component": "Checkbox",
			"props": {
				"checked": {
					"path": "/checked"
				}
			},
			"children": ["preText", "linkText", "lastText"]
		},
		{
			"id": "preText",
			"component": "span",
			"props": {
				"value": "规范详情:"
			}
		},
		{
			"id": "linkText",
			"component": "a",
			"props": {
				"value": "点击查看"
			}
		},
		{
			"id": "lastText",
			"component": "span",
			"props": {
				"value": "必读"
			}
		}
	]
}
```