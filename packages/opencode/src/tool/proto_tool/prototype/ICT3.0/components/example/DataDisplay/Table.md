# Table

### Table Example: Multi-Column Rendering

```json
{
  "state": {
    "tableList": [
      { "id": "01", "name": "Node-Alpha", "type": "Compute", "statusIcon": "circle-check" },
      { "id": "02", "name": "Node-Beta", "type": "Storage", "statusIcon": "circle-x" }
    ]
  },
  "rootId": "multi_col_table",
  "elements": [
    {
      "id": "multi_col_table",
      "component": "Table",
      "props": {
        "rowKey": "id",
        "dataSource": { "path": "/tableList" },
        "columns": [
          { "title": "Device Name", "dataIndex": "name" },
          { "title": "Type", "dataIndex": "type" },
          { "title": "Status", "dataIndex": "status" },
          { "title": "Action", "dataIndex": "action", "width": 120 }
        ]
      },
      "children": {
        "path": "/tableList",
        "componentId": "multi_col_row"
      }
    },
    {
      "id": "multi_col_row",
      "component": "TableRow",
      "children": [
        "name_cell_comp",
        "type_cell_comp",
        "status_cell_comp",
        "action_cell_comp"
      ]
    },
    {
      "id": "name_cell_comp",
      "component": "span",
      "props": {
        "value": { "path": "name" }
      }
    },
    {
      "id": "type_cell_comp",
      "component": "Tag",
      "props": {
        "value": { "path": "type" },
        "variant": "outlined"
      }
    },
    {
      "id": "status_cell_comp",
      "component": "Icon",
      "props": {
        "name": { "path": "statusIcon" },
        "shape": "circle"
      }
    },
    {
      "id": "action_cell_comp",
      "component": "Button",
      "props": {
        "value": "Detail",
        "size": "small"
      }
    }
  ]
}
```

### Table Example: Selection with Multi-Column

```json
{
  "state": {
    "selectedKeys": ["01"],
    "tableList": [
      { "id": "01", "name": "Node-Alpha", "type": "Compute", "statusIcon": "circle-check" },
      { "id": "02", "name": "Node-Beta", "type": "Storage", "statusIcon": "circle-x" }
    ]
  },
  "rootId": "selection_multi_table",
  "elements": [
    {
      "id": "selection_multi_table",
      "component": "Table",
      "props": {
        "rowKey": "id",
        "dataSource": { "path": "/tableList" },
        "rowSelection": {
          "type": "checkbox",
          "selectedRowKeys": { "path": "/selectedKeys" }
        },
        "columns": [
          { "title": "Name", "dataIndex": "name" },
          { "title": "Type", "dataIndex": "type" },
          { "title": "Status", "dataIndex": "status" }
        ]
      },
      "children": {
        "path": "/tableList",
        "componentId": "selection_multi_row"
      }
    },
    {
      "id": "selection_multi_row",
      "component": "TableRow",
      "children": [
        "name_display",
        "type_display",
        "status_display"
      ]
    },
    {
      "id": "name_display",
      "component": "span",
      "props": {
        "value": { "path": "name" }
      }
    },
    {
      "id": "type_display",
      "component": "Tag",
      "props": {
        "value": { "path": "type" },
        "variant": "outlined"
      }
    },
    {
      "id": "status_display",
      "component": "Icon",
      "props": {
        "name": { "path": "statusIcon" },
        "shape": "circle"
      }
    }
  ]
}
```

### Table Example: Expandable Row with Sub-Table

```json
{
  "state": {
    "expandedRowKeys": ["01", "03"],
    "tableList": [
      {
        "id": "01",
        "name": "Node-Alpha",
        "type": "Compute",
        "statusIcon": "circle-check",
        "subList": [
          { "id": "01-1", "task": "数据处理", "progress": "80%", "statusIcon": "circle-check" },
          { "id": "01-2", "task": "任务调度", "progress": "60%", "statusIcon": "circle-x" }
        ]
      },
      {
        "id": "02",
        "name": "Node-Beta",
        "type": "Storage",
        "statusIcon": "circle-x"
      },
      {
        "id": "03",
        "name": "Node-Gamma",
        "type": "Network",
        "statusIcon": "circle-check",
        "subList": [
          { "id": "03-1", "task": "流量转发", "progress": "95%", "statusIcon": "circle-check" }
        ]
      }
    ]
  },
  "rootId": "expandable_table",
  "elements": [
    {
      "id": "expandable_table",
      "component": "Table",
      "props": {
        "rowKey": "id",
        "dataSource": { "path": "/tableList" },
        "columns": [
          { "title": "Name", "dataIndex": "name" },
          { "title": "Type", "dataIndex": "type" },
          { "title": "Status", "dataIndex": "status" }
        ],
        "expandable": {
          "expandedRowKeys": { "path": "/expandedRowKeys" }
        }
      },
      "children": {
        "path": "/tableList",
        "componentId": "table_row"
      }
    },
    {
      "id": "table_row",
      "component": "TableRow",
      "props": {
        "expandedRowRender": { "componentId": "expanded_sub_table" }
      },
      "children": [
        "name_cell",
        "type_cell",
        "status_cell"
      ]
    },
    {
      "id": "name_cell",
      "component": "span",
      "props": { "value": { "path": "name" } }
    },
    {
      "id": "type_cell",
      "component": "Tag",
      "props": { "value": { "path": "type" }, "variant": "outlined" }
    },
    {
      "id": "status_cell",
      "component": "Icon",
      "props": { "name": { "path": "statusIcon" }, "shape": "circle" }
    },
    {
      "id": "expanded_sub_table",
      "component": "Table",
      "props": {
        "rowKey": "id",
        "dataSource": { "path": "subList" },
        "columns": [
          { "title": "Task", "dataIndex": "task" },
          { "title": "Progress", "dataIndex": "progress" },
          { "title": "Status", "dataIndex": "status" }
        ],
        "pagination": false
      },
      "children": {
        "path": "subList",
        "componentId": "sub_table_row"
      }
    },
    {
      "id": "sub_table_row",
      "component": "TableRow",
      "children": [
        "sub_task",
        "sub_progress",
        "sub_status"
      ]
    },
    {
      "id": "sub_task",
      "component": "span",
      "props": { "value": { "path": "task" } }
    },
    {
      "id": "sub_progress",
      "component": "span",
      "props": { "value": { "path": "progress" } }
    },
    {
      "id": "sub_status",
      "component": "Icon",
      "props": { "name": { "path": "statusIcon" }, "shape": "circle" }
    }
  ]
}
```
