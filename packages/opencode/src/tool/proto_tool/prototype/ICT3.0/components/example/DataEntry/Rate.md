# Rate | 评分

### Example: Rate basic

```json
{
	"state": {
		"judgement": 4,
		"total": 5
	},
	"rootId": "preferenceDegree",
	"elements": [
		{
			"id": "preferenceDegree",
			"component": "Rate",
			"props": {
				"value": {
					"path": "/judgement"
				},
				"count": {
					"path": "/total"
				},
				"size": "medium"
			}
		}
	]
}
```
