# Tag

### Example: Tag value path

```json
{
	"state": {
		"tagLabel": "magenta"
	},
	"rootId": "tagName",
	"elements": [
		{
			"id": "tagName",
			"component": "Tag",
			"props": {
				"value": {
					"path": "/tagLabel"
				},
				"color": "purple"
			}
		}
	]
}
```

### Example: Tag value with icon

```json
{
	"id": "infoIconTag",
	"component": "Tag",
	"props": {
		"value": "信息提示",
		"icon": "info",
		"color": "default",
	}
},
```

### Example: Tag close

```json
{
	"id": "tagClose",
	"component": "Tag",
	"props": {
		"value": "关闭标签",
		"closable": true,
		"closeIcon": "circle-x"
	}
}
```
