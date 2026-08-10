window.__A2UI_DATA__ = {
  "state": {
    "brandName": "UXAI 管理平台",
    "userName": "管理员",
    "userAvatarUrl": "https://randomuser.me/api/portraits/men/67.jpg",
    "collapsed": false,
    "selectedKeys": ["single-sys"],
    "openKeys": ["system"],
    "searchValue": "",
    "menuItems": [
      { "title": "工作台", "key": "dashboard", "icon": "layout-dashboard" },
      {
        "title": "系统管理",
        "key": "system",
        "icon": "server",
        "children": [
          { "title": "单系统管理", "key": "single-sys" },
          { "title": "集群管理", "key": "cluster" }
        ]
      },
      { "title": "网络管理", "key": "network", "icon": "network" },
      { "title": "存储管理", "key": "storage", "icon": "database" },
      { "title": "安全管理", "key": "security", "icon": "shield" },
      { "title": "监控告警", "key": "monitor", "icon": "activity" }
    ],
    "breadcrumb": [
      { "title": "系统" },
      { "title": "单系统管理" },
      { "title": "内部规格管理" }
    ],
    "pageTitle": "内部规格管理",
    "pageDesc": "维护各子系统的配置项及其运行值与默认值",
    "filter": {
      "subsystem": "all",
      "configItem": ""
    },
    "subsystemOptions": [
      { "label": "全部子系统", "value": "all" },
      { "label": "通用配置", "value": "通用配置" },
      { "label": "网络管理", "value": "网络管理" },
      { "label": "存储管理", "value": "存储管理" },
      { "label": "安全管理", "value": "安全管理" },
      { "label": "性能监控", "value": "性能监控" }
    ],
    "modalOpen": false,
    "editForm": {
      "subsystem": "通用配置",
      "configItem": "会话超时(分钟)",
      "configValue": "30",
      "defaultValue": "30",
      "description": "用户登录会话超时时长"
    },
    "tableSelected": [],
    "tableData": [
      { "id": 1, "subsystem": "通用配置", "configItem": "系统名称", "configValue": "UXAI 管理平台", "defaultValue": "UXAI 管理平台", "description": "系统对外展示名称", "restart": { "text": "否", "color": "default" } },
      { "id": 2, "subsystem": "通用配置", "configItem": "默认语言", "configValue": "zh-CN", "defaultValue": "en", "description": "系统默认界面语言", "restart": { "text": "否", "color": "default" } },
      { "id": 3, "subsystem": "通用配置", "configItem": "会话超时(分钟)", "configValue": "30", "defaultValue": "30", "description": "用户登录会话超时时长", "restart": { "text": "是", "color": "success" } },
      { "id": 4, "subsystem": "网络管理", "configItem": "最大连接数", "configValue": "2000", "defaultValue": "1000", "description": "单节点最大并发连接数", "restart": { "text": "是", "color": "success" } },
      { "id": 5, "subsystem": "网络管理", "configItem": "心跳间隔(秒)", "configValue": "15", "defaultValue": "10", "description": "节点间心跳检测间隔", "restart": { "text": "否", "color": "default" } },
      { "id": 6, "subsystem": "网络管理", "configItem": "服务端口号", "configValue": "8080", "defaultValue": "8080", "description": "服务监听端口", "restart": { "text": "是", "color": "success" } },
      { "id": 7, "subsystem": "存储管理", "configItem": "存储引擎", "configValue": "rocksdb", "defaultValue": "rocksdb", "description": "底层存储引擎类型", "restart": { "text": "是", "color": "success" } },
      { "id": 8, "subsystem": "存储管理", "configItem": "数据目录", "configValue": "/data/uxai", "defaultValue": "/data/uxai", "description": "数据文件存储路径", "restart": { "text": "否", "color": "default" } },
      { "id": 9, "subsystem": "存储管理", "configItem": "压缩算法", "configValue": "snappy", "defaultValue": "none", "description": "数据压缩算法", "restart": { "text": "是", "color": "success" } },
      { "id": 10, "subsystem": "安全管理", "configItem": "密码最小长度", "configValue": "8", "defaultValue": "6", "description": "用户密码最小字符数", "restart": { "text": "否", "color": "default" } },
      { "id": 11, "subsystem": "安全管理", "configItem": "登录失败锁定", "configValue": "5", "defaultValue": "3", "description": "连续登录失败次数上限", "restart": { "text": "否", "color": "default" } },
      { "id": 12, "subsystem": "安全管理", "configItem": "TLS 加密", "configValue": "启用", "defaultValue": "禁用", "description": "是否启用传输层加密", "restart": { "text": "是", "color": "success" } },
      { "id": 13, "subsystem": "性能监控", "configItem": "采集间隔(秒)", "configValue": "60", "defaultValue": "30", "description": "指标数据采集周期", "restart": { "text": "否", "color": "default" } },
      { "id": 14, "subsystem": "性能监控", "configItem": "历史保留(天)", "configValue": "90", "defaultValue": "30", "description": "监控数据保留天数", "restart": { "text": "否", "color": "default" } }
    ]
  },
  "rootId": "appShell",
  "elements": [
    {
      "id": "appShell",
      "component": "div",
      "props": { "className": "flex h-screen w-full bg-surface-container-lowest overflow-hidden" },
      "children": ["sidebar", "mainArea"]
    },
    {
      "id": "sidebar",
      "component": "aside",
      "props": { "className": "w-60 shrink-0 bg-surface-container-highest shadow-sm flex flex-col" },
      "children": ["sidebarHeader", "sideMenu"]
    },
    {
      "id": "sidebarHeader",
      "component": "div",
      "props": { "className": "h-14 flex items-center gap-inline px-gutter border-b border-divider shrink-0" },
      "children": ["sidebarLogo", "sidebarBrand"]
    },
    {
      "id": "sidebarLogo",
      "component": "Icon",
      "props": { "name": "server", "color": "primary", "shape": "square", "className": "w-7 h-7" }
    },
    {
      "id": "sidebarBrand",
      "component": "span",
      "props": { "value": { "path": "/brandName" }, "className": "text-lg font-bold text-on-surface" }
    },
    {
      "id": "sideMenu",
      "component": "Menu",
      "props": {
        "mode": "vertical",
        "inlineCollapsed": { "path": "/collapsed" },
        "selectedKeys": { "path": "/selectedKeys" },
        "openKeys": { "path": "/openKeys" },
        "items": { "path": "/menuItems" },
        "className": "flex-1 overflow-y-auto border-none"
      }
    },
    {
      "id": "mainArea",
      "component": "div",
      "props": { "className": "flex-1 flex flex-col min-w-0" },
      "children": ["topHeader", "content"]
    },
    {
      "id": "topHeader",
      "component": "header",
      "props": { "className": "h-14 shrink-0 bg-surface-container-highest shadow-sm flex items-center justify-between px-page z-20" },
      "children": ["topLeft", "topRight"]
    },
    {
      "id": "topLeft",
      "component": "div",
      "props": { "className": "flex items-center gap-gutter h-full" },
      "children": ["topCrumb"]
    },
    {
      "id": "topCrumb",
      "component": "Breadcrumb",
      "props": { "items": { "path": "/breadcrumb" } }
    },
    {
      "id": "topRight",
      "component": "div",
      "props": { "className": "flex items-center gap-inline h-full" },
      "children": ["topSearch", "topDivider", "topBell", "topUser"]
    },
    {
      "id": "topSearch",
      "component": "Input",
      "props": { "value": { "path": "/searchValue" }, "placeholder": "搜索...", "prefix": "search", "className": "w-56" }
    },
    {
      "id": "topDivider",
      "component": "div",
      "props": { "className": "w-px h-5 bg-divider" }
    },
    {
      "id": "topBell",
      "component": "Icon",
      "props": { "name": "bell", "shape": "outline", "className": "w-5 h-5 text-on-surface-variant cursor-pointer" }
    },
    {
      "id": "topUser",
      "component": "div",
      "props": { "className": "flex items-center gap-inline" },
      "children": ["topAvatar", "topUserName"]
    },
    {
      "id": "topAvatar",
      "component": "img",
      "props": { "src": { "path": "/userAvatarUrl" }, "alt": "avatar", "className": "w-8 h-8 rounded-full object-cover" }
    },
    {
      "id": "topUserName",
      "component": "span",
      "props": { "value": { "path": "/userName" }, "className": "text-sm font-medium text-on-surface" }
    },
    {
      "id": "content",
      "component": "section",
      "props": { "className": "flex-1 overflow-auto p-page flex flex-col gap-section" },
      "children": ["pageHeader", "tableCard", "editModal"]
    },
    {
      "id": "pageHeader",
      "component": "div",
      "props": { "className": "flex items-start justify-between shrink-0" },
      "children": ["pageTitleArea", "pageActions"]
    },
    {
      "id": "pageTitleArea",
      "component": "div",
      "props": { "className": "flex flex-col gap-2" },
      "children": ["pageTitle", "pageDesc"]
    },
    {
      "id": "pageTitle",
      "component": "h1",
      "props": { "value": { "path": "/pageTitle" }, "className": "text-xl font-bold text-on-surface" }
    },
    {
      "id": "pageDesc",
      "component": "span",
      "props": { "value": { "path": "/pageDesc" }, "className": "text-sm text-on-surface-variant" }
    },
    {
      "id": "pageActions",
      "component": "div",
      "props": { "className": "flex items-center gap-inline" },
      "children": ["exportBtn", "newBtn"]
    },
    {
      "id": "exportBtn",
      "component": "Button",
      "props": { "value": "导出", "icon": "download", "iconPlacement": "start", "color": "default" }
    },
    {
      "id": "newBtn",
      "component": "Button",
      "props": { "value": "新建规格", "icon": "plus", "iconPlacement": "start", "color": "primary" }
    },
    {
      "id": "tableCard",
      "component": "div",
      "props": { "className": "bg-surface-container-highest rounded-container shadow-card p-inset flex flex-col gap-stack" },
      "children": ["cardHead", "filterBar", "specTable"]
    },
    {
      "id": "cardHead",
      "component": "div",
      "props": { "className": "flex items-center justify-between" },
      "children": ["cardTitleArea", "cardToolbar"]
    },
    {
      "id": "cardTitleArea",
      "component": "div",
      "props": { "className": "flex items-center gap-inline" },
      "children": ["cardTitle", "cardCount"]
    },
    {
      "id": "cardTitle",
      "component": "span",
      "props": { "value": "规格列表", "className": "text-base font-semibold text-on-surface" }
    },
    {
      "id": "cardCount",
      "component": "span",
      "props": { "value": "共 14 条", "className": "text-xs text-on-surface-variant bg-surface-container-lowest px-2 py-1 rounded" }
    },
    {
      "id": "cardToolbar",
      "component": "div",
      "props": { "className": "flex items-center gap-inline" },
      "children": ["refreshBtn"]
    },
    {
      "id": "refreshBtn",
      "component": "Button",
      "props": { "icon": "refresh-cw", "shape": "circle", "color": "default" }
    },
    {
      "id": "filterBar",
      "component": "div",
      "props": { "className": "flex items-center gap-gutter flex-wrap p-inset bg-surface-container-lowest rounded-container" },
      "children": ["filterSubsystemField", "filterConfigItemField", "filterActions"]
    },
    {
      "id": "filterSubsystemField",
      "component": "div",
      "props": { "className": "flex items-center gap-2" },
      "children": ["filterSubsystemLabel", "filterSubsystem"]
    },
    {
      "id": "filterSubsystemLabel",
      "component": "span",
      "props": { "value": "子系统", "className": "text-sm text-on-surface-variant whitespace-nowrap" }
    },
    {
      "id": "filterSubsystem",
      "component": "Select",
      "props": { "value": { "path": "/filter/subsystem" }, "options": { "path": "/subsystemOptions" }, "className": "w-44" }
    },
    {
      "id": "filterConfigItemField",
      "component": "div",
      "props": { "className": "flex items-center gap-2" },
      "children": ["filterConfigItemLabel", "filterConfigItem"]
    },
    {
      "id": "filterConfigItemLabel",
      "component": "span",
      "props": { "value": "配置项", "className": "text-sm text-on-surface-variant whitespace-nowrap" }
    },
    {
      "id": "filterConfigItem",
      "component": "Input",
      "props": { "value": { "path": "/filter/configItem" }, "placeholder": "请输入配置项名称", "prefix": "search", "className": "w-60" }
    },
    {
      "id": "filterActions",
      "component": "div",
      "props": { "className": "flex items-center gap-inline" },
      "children": ["filterBtn", "resetFilterBtn"]
    },
    {
      "id": "filterBtn",
      "component": "Button",
      "props": { "value": "查询", "icon": "search", "iconPlacement": "start", "color": "primary" }
    },
    {
      "id": "resetFilterBtn",
      "component": "Button",
      "props": { "value": "重置", "icon": "rotate-ccw", "iconPlacement": "start", "color": "default" }
    },
    {
      "id": "specTable",
      "component": "Table",
      "props": {
        "rowKey": "id",
        "dataSource": { "path": "/tableData" },
        "rowSelection": { "type": "checkbox", "selectedRowKeys": { "path": "/tableSelected" } },
        "pagination": true,
        "columns": [
          { "title": "子系统", "dataIndex": "subsystem", "minWidth": 120 },
          { "title": "配置项", "dataIndex": "configItem", "minWidth": 160 },
          { "title": "配置项值", "dataIndex": "configValue", "minWidth": 160 },
          { "title": "默认值", "dataIndex": "defaultValue", "minWidth": 120 },
          { "title": "描述", "dataIndex": "description", "minWidth": 240 },
          { "title": "重启微服务", "dataIndex": "restart" },
          { "title": "操作", "dataIndex": "actions" }
        ]
      },
      "children": { "path": "/tableData", "componentId": "specRow" }
    },
    {
      "id": "specRow",
      "component": "TableRow",
      "children": ["cSubsystem", "cConfigItem", "cConfigValue", "cDefaultValue", "cDescription", "cRestart", "cAction"]
    },
    {
      "id": "cSubsystem",
      "component": "span",
      "props": { "value": { "path": "subsystem" }, "className": "text-md text-on-surface" }
    },
    {
      "id": "cConfigItem",
      "component": "span",
      "props": { "value": { "path": "configItem" }, "className": "text-md text-on-surface font-medium" }
    },
    {
      "id": "cConfigValue",
      "component": "span",
      "props": { "value": { "path": "configValue" }, "className": "text-md text-primary font-semibold" }
    },
    {
      "id": "cDefaultValue",
      "component": "span",
      "props": { "value": { "path": "defaultValue" }, "className": "text-md text-on-surface-variant" }
    },
    {
      "id": "cDescription",
      "component": "span",
      "props": { "value": { "path": "description" }, "className": "text-md text-on-surface-variant" }
    },
    {
      "id": "cRestart",
      "component": "Tag",
      "props": { "value": { "path": "restart/text" }, "color": { "path": "restart/color" }, "variant": "filled" }
    },
    {
      "id": "cAction",
      "component": "div",
      "props": { "className": "flex items-center gap-inline" },
      "children": ["editBtn", "resetRowBtn"]
    },
    {
      "id": "editBtn",
      "component": "Button",
      "props": {
        "value": "修改",
        "types": "link",
        "size": "small",
        "color": "primary",
        "icon": "pencil",
        "onClick": { "action": "setState", "args": { "path": "/modalOpen", "value": true } }
      }
    },
    {
      "id": "resetRowBtn",
      "component": "Button",
      "props": { "value": "重置", "types": "link", "size": "small", "color": "default" }
    },
    {
      "id": "editModal",
      "component": "Modal",
      "props": {
        "open": { "path": "/modalOpen" },
        "onClose": { "action": "setState", "args": { "path": "/modalOpen", "value": false } },
        "title": "修改配置项",
        "footer": { "componentId": "modalFooter" }
      },
      "children": ["modalBody"]
    },
    {
      "id": "modalBody",
      "component": "div",
      "props": { "className": "flex flex-col gap-stack py-2" },
      "children": ["mSubRow", "mItemRow", "mValueRow", "mDefaultRow", "mDescRow"]
    },
    {
      "id": "mSubRow",
      "component": "div",
      "props": { "className": "flex flex-col gap-2" },
      "children": ["mSubLabel", "mSubValue"]
    },
    {
      "id": "mSubLabel",
      "component": "span",
      "props": { "value": "子系统", "className": "text-sm text-on-surface-variant" }
    },
    {
      "id": "mSubValue",
      "component": "Input",
      "props": { "value": { "path": "/editForm/subsystem" }, "disabled": true, "className": "w-full" }
    },
    {
      "id": "mItemRow",
      "component": "div",
      "props": { "className": "flex flex-col gap-2" },
      "children": ["mItemLabel", "mItemValue"]
    },
    {
      "id": "mItemLabel",
      "component": "span",
      "props": { "value": "配置项", "className": "text-sm text-on-surface-variant" }
    },
    {
      "id": "mItemValue",
      "component": "Input",
      "props": { "value": { "path": "/editForm/configItem" }, "disabled": true, "className": "w-full" }
    },
    {
      "id": "mValueRow",
      "component": "div",
      "props": { "className": "flex flex-col gap-2" },
      "children": ["mValueLabel", "mValueInput"]
    },
    {
      "id": "mValueLabel",
      "component": "span",
      "props": { "value": "配置项值 *", "className": "text-sm text-primary font-medium" }
    },
    {
      "id": "mValueInput",
      "component": "Input",
      "props": { "value": { "path": "/editForm/configValue" }, "placeholder": "请输入配置项值", "className": "w-full" }
    },
    {
      "id": "mDefaultRow",
      "component": "div",
      "props": { "className": "flex flex-col gap-2" },
      "children": ["mDefaultLabel", "mDefaultValue"]
    },
    {
      "id": "mDefaultLabel",
      "component": "span",
      "props": { "value": "默认值", "className": "text-sm text-on-surface-variant" }
    },
    {
      "id": "mDefaultValue",
      "component": "Input",
      "props": { "value": { "path": "/editForm/defaultValue" }, "disabled": true, "className": "w-full" }
    },
    {
      "id": "mDescRow",
      "component": "div",
      "props": { "className": "flex flex-col gap-2" },
      "children": ["mDescLabel", "mDescValue"]
    },
    {
      "id": "mDescLabel",
      "component": "span",
      "props": { "value": "描述", "className": "text-sm text-on-surface-variant" }
    },
    {
      "id": "mDescValue",
      "component": "TextArea",
      "props": { "value": { "path": "/editForm/description" }, "disabled": true, "autoSize": true, "className": "w-full" }
    },
    {
      "id": "modalFooter",
      "component": "div",
      "props": { "className": "flex items-center justify-end gap-inline w-full" },
      "children": ["modalCancelBtn", "modalSaveBtn"]
    },
    {
      "id": "modalCancelBtn",
      "component": "Button",
      "props": {
        "value": "取消",
        "color": "default",
        "onClick": { "action": "setState", "args": { "path": "/modalOpen", "value": false } }
      }
    },
    {
      "id": "modalSaveBtn",
      "component": "Button",
      "props": {
        "value": "保存",
        "icon": "check",
        "iconPlacement": "start",
        "color": "primary",
        "onClick": { "action": "setState", "args": { "path": "/modalOpen", "value": false } }
      }
    }
  ]
}
