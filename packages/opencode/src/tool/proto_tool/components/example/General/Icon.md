# Icon

### Example: Icon basic

```json
{
	"id": "iconProcess",
	"component": "Icon",
	"props": {
		"name": "circle-check",
		"color": "primary",
		"shape": "circle",
		"className": "w-6 h-6"
	}
}
```

### Example: Icon name path

```json
{
	"state": {
		"currentStatusIcon": "check"
	},
	"rootId": "iconStatus",
	"elements": [
		{
			"id": "iconStatus",
			"component": "Icon",
			"props": {
				"name": {
					"path": "/currentStatusIcon"
				},
				"color": "primary",
				"className": "w-6 h-6"
			}
		}
	]
}
```
