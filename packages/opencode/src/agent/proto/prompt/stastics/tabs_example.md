{
  "state": {
    "activeTab": "tab1",
    "rbacConfig": [
      { "key": "tab1", "name": "用户管理", "icon": "user", "content": "这是用户管理面板" },
      { "key": "tab2", "name": "角色管理", "icon": "team", "content": "这是角色管理面板" },
      { "key": "tab3", "name": "权限管理", "icon": "safety", "content": "这是权限管理面板" }
    ]
  },
  "rootId": "mainTabsContainer",
  "elements": [
    { "id": "mainTabsContainer", "component": "Tabs", "props": { "activeKey": { "path": "/activeTab" } }, "children": { "path": "/rbacConfig",  "componentId": "mainTabsItem" }},
    { "id": "mainTabsItem", "component": "TabItem", "props": { "key": { "path": "key" }, "label": { "path": "name" }, "icon": { "path": "icon" }, "content": { "componentId": "mainTabsContent" } }},
    { "id": "mainTabsContent", "component": "div", "props": { "className": "p-4", "value": { "path": "content" } }}
  ]
}