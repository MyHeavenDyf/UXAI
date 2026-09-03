# RadioGroup | 单选组 示例

## Example: RadioGroup basic

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
