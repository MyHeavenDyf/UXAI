# RadioGroup | 单选组

### Example: RadioGroup basic

```json
{
	"state": {
		"payValue": "monthly",
		"payOptions": [
			{
				"label": "按周",
				"value": "weekly"
			},
			{
				"label": "按月",
				"value": "monthly"
			},
			{
				"label": "按年",
				"value": "yearly"
			}
		]
	},
	"rootId": "payment",
	"elements": [
		{
			"id": "payment",
			"component": "RadioGroup",
			"props": {
				"value": {
					"path": "/payValue"
				},
				"options": {
					"path": "/payOptions"
				}
			}
		}
	]
}
```

### Example: RadioGroup button

```json
{
	"id": "fruit",
	"component": "RadioGroup",
	"props": {
		"options": [
			{
				"label": "苹果",
				"value": "Apple"
			},
			{
				"label": "梨子",
				"value": "Pear"
			},
			{
				"label": "橘子",
				"value": "Orange"
			}
		],
		"value": "Orange",
		"optionType": "button",
		"size": "large"
	}
}
```
