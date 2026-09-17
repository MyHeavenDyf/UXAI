# Badge 示例

## Example: Badge basic

```json
{
	"state": {
		"favourableComment": 50
	},
	"rootId": "favourable",
	"elements": [
		{
			"id": "favourable",
			"component": "Badge",
			"props": {
				"count": {
					"path": "/favourableComment"
				},
				"overflowCount": 99
			},
			"children": ["goodReview"]
		},
		{
			"id": "goodReview",
			"component": "Button",
			"props": { "value": "好评数" }
		}
	]
}
```
