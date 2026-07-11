# Button | 按钮

### Example: Button value path and color

```json
{
	"state": {
		"username": "xiaowang"
	},
	"rootId": "buttonUserName",
	"elements": [
		{
			"id": "buttonUserName",
			"component": "Button",
			"props": {
				"value": {
					"path": "/username"
				},
				"color": "primary"
			}
		}
	]
}
```

### Example: Button icon

```json
 {
	"id": "searchIconButton",
	"component": "Button",
	"props": {
		"icon": "search"
	}
},
```

### Example: Button value with icon

```json
{
	"id": "addUserButton",
	"component": "Button",
	"props": {
		"value": "添加用户",
		"icon": "user-plus",
		"iconPlacement": "start"
	}
}
```


### Example: Link Button 

```json
 {
	"id": "linkButton",
	"component": "Button",
	"props": {
		"value": "添加用户",
		"types": "link"
	}
}
```