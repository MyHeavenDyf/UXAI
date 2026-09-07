# Tree

### Example: Tree with data binding options

```json
{
  "state": {
    "expandedKeys": ["workspace"],
    "treeOptions": [
      {
        "title": "工作空间",
        "key": "workspace",
        "icon": "folder",
        "children": [
          {
            "title": "项目管理",
            "key": "workspace-project",
            "icon": "folder-kanban"
          },
          {
            "title": "成员管理",
            "key": "workspace-member",
            "icon": "users"
          }
        ]
      },
      {
        "title": "系统设置",
        "key": "system",
        "icon": "settings",
        "children": [
          {
            "title": "权限配置",
            "key": "system-permission",
            "icon": "shield-check"
          }
        ]
      }
    ]
  },
  "rootId": "workspaceTree",
  "elements": [
    {
      "id": "workspaceTree",
      "component": "Tree",
      "props": {
        "checkable": true,
        "defaultExpandedKeys": { "path": "/expandedKeys" },
        "defaultSelectedKeys": { "path": "/selectedKeys" },
        "options": { "path": "/treeOptions" },
        "className": "rounded-lg border p-3"
      }
    }
  ]
}
```

### Example: Tree with static options

```json
{
  "id": "fileTree",
  "component": "Tree",
  "props": {
    "checkable": false,
    "defaultExpandedKeys": ["src"],
    "defaultSelectedKeys": ["src-components"],
    "options": [
      {
        "title": "src",
        "key": "src",
        "icon": "folder",
        "children": [
          {
            "title": "components",
            "key": "src-components",
            "icon": "folder",
            "children": [
              {
                "title": "Button.tsx",
                "key": "src-components-button",
                "icon": "file-code"
              },
              {
                "title": "Table.tsx",
                "key": "src-components-table",
                "icon": "file-code"
              }
            ]
          },
          {
            "title": "pages",
            "key": "src-pages",
            "icon": "folder"
          }
        ]
      },
      {
        "title": "package.json",
        "key": "package-json",
        "icon": "file-json"
      }
    ],
    "className": "w-full"
  }
}
```
