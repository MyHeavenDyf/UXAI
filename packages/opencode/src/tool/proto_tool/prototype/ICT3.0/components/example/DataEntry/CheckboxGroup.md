# CheckboxGroup | 复选框组

### Example: CheckboxGroup basic

```json
{
	"state": {
		"checkboxValue": ["yellow", "blue"],
		"checkboxOptions": [
			{
				"label": "红色",
				"value": "red"
			},
			{
				"label": "黄色",
				"value": "yellow"
			},
			{
				"label": "蓝色",
				"value": "blue"
			}
		]
	},
	"rootId": "colorPickerSection",
	"elements": [
		{
			"id": "colorPickerSection",
			"component": "CheckboxGroup",
			"props": {
				"value": {
					"path": "/checkboxValue"
				},
				"options": {
					"path": "/checkboxOptions"
				}
			}
		}
	]
}
```
