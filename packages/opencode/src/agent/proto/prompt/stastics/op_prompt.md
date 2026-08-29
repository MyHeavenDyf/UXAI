# schema修改协议

使用 **element_id** 定位元素，用 **state path** 定位数据。不需要计算数组索引。
直接输出 `[]` 包围的JSON数组，每个元素是一条修改指令。

### op类型（共7种）

| op | 语义 | 必填字段 | 说明 |
|---|---|---|---|
| `data_add` | state新增 | `path` `value` | path指向已有数组→追加末尾；path指向不存在key→新增key-value |
| `data_replace` | state替换 | `path` `value` | path用`/`分隔层级，如`currentUser/nickName`、`menuItems/2/title`、`menuItems`(替换整个数组) |
| `data_remove` | state删除 | `path` | 删除path指向的key或数组项 |
| `element_add` | 新增元素 | `value` | value为完整元素定义{id,component,props?,children?}。仅加入elements数组，挂载由children_replace负责 |
| `element_remove` | 删除元素 | `element_id` | 自动从所有父节点children中脱离引用。默认同时删除子孙子树 |
| `props_replace` | 替换props | `element_id` `value` | value为完整props对象，包含=存在，不含=删除。可选附带`component`字段同时替换组件类型 |
| `children_replace` | 替换children | `element_id` `value` | value为静态ID数组`["a","b"]`或动态对象{"path":"/list","componentId":"item"} |
| `id_rename` | 重命名ID | `old_id` `new_id` | 自动级联更新所有children引用、rootId、componentId、slot绑定 |

### 核心原则

* **输出改完后的完整值**：props_replace和children_replace输出完整对象，不需要逐步增删
* **职责解耦**：element_add只负责加入数组，挂载由children_replace单独完成
* **安全删除**：element_remove自动从所有父节点children中脱离引用
* **级联重命名**：id_rename自动更新所有引用，包括rootId

### 示例1：样式与数据修改

输入JSON的state包含 `{brandName: "旧名称", currentUser: {nickName: "张建国"}, menuItems: [{...}, {...}]}`，elements包含id为mainCardContainer、mainCardTitle、mainMetricCard的元素。

修改需求：更新品牌名、追加菜单项、更新用户昵称、调整卡片样式、重排子元素顺序。

```json
[
  { "op": "data_replace", "path": "brandName", "value": "Enterprise Pro v2" },
  { "op": "data_add", "path": "menuItems", "value": { "title": "帮助中心", "icon": "help-circle", "isSub": false } },
  { "op": "data_replace", "path": "currentUser/nickName", "value": "李明" },
  { "op": "props_replace", "element_id": "mainMetricCard", "value": { "className": "bg-primary-container p-inset rounded-container shadow-sm", "value": { "path": "/metricLabel" } } },
  { "op": "children_replace", "element_id": "mainCardContainer", "value": ["mainCardHeader", "mainCardBody", "mainCardNewBtn", "mainCardFooter"] }
]
```

### 示例2：结构修改

修改需求：新增按钮并挂载、删除描述元素、重命名按钮ID、删除废弃state字段、替换组件类型、更新子元素列表。

```json
[
  { "op": "data_remove", "path": "deprecatedField" },
  { "op": "element_add", "value": { "id": "mainCardNewBtn", "component": "Button", "props": { "value": "查看详情", "type": "primary", "size": "small" } } },
  { "op": "element_remove", "element_id": "mainCardDesc" },
  { "op": "id_rename", "old_id": "mainCardBtn", "new_id": "mainCardActionBtn" },
  { "op": "props_replace", "element_id": "mainCardTag", "component": "Badge", "value": { "count": 5, "color": "red" } },
  { "op": "children_replace", "element_id": "mainCardBody", "value": ["mainCardNewDesc", "mainCardActionBtn"] }
]
```