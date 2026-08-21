# Prototype 埋点清单

> 数据源：第 1 套 UI tracker（`packages/app/octoapp/utils/tracker.ts`）
> 统一 `module: "prototype"`，请求 `POST {VITE_OCTO_REPORT_BASE_URL}/record/logger/{page|interaction}`
> 基础字段：`account`、`uid`、`browserName/Version`、`os`、`platform`、`project:"octo-agent"`、`path`(当前 URL)
> 共 **19 处**：1 个 page + 18 个 interaction（其中 `new-session` 在两处触发）

## 一、页面曝光（tracker.page）

| 事件名 | 触发时机 | 文件:行 |
| --- | --- | --- |
| `pattern-page` | 进入 prototype 页面 `onMount` | `pages/pattern/index.tsx:90` |

## 二、交互埋点（tracker.interaction）

### 1. 会话管理

| 事件名 | 触发时机 | 文件:行 | extend |
| --- | --- | --- | --- |
| `new-session` | 侧边栏「新建会话」按钮创建 session 成功 | `pages/pattern/modules/sidebar/sidebar.tsx:196` | — |
| `new-session` | 输入框首次发送、当前无 session 时新建并跳转 | `pages/pattern/index.tsx:673` | — |
| `import-session` | 侧边栏从文件导入会话完成 | `pages/pattern/modules/sidebar/sidebar.tsx:251` | — |
| `rename-session` | 保存重命名后的会话标题 | `pages/pattern/modules/chat/index.tsx:159` | — |
| `delete-session` | 删除会话成功（`deleteSession`） | `pages/pattern/index.tsx:115` | — |

### 2. 生成与编辑

| 事件名 | 触发时机 | 文件:行 | extend |
| --- | --- | --- | --- |
| `create-page` | 首次创建页面，进入阶段 1（意图扩展 + 布局规划） | `pages/pattern/index.tsx:797` | — |
| `modify-page` | AI 修改整页（已有 modules，调用 `modify_json_ai`） | `pages/pattern/index.tsx:757` | — |
| `modify-element` | 元素级快速修改（`runQuickModify`） | `pages/pattern/index.tsx:497` | — |
| `stop-generation` | 中止生成（`halt`，abort 根 + 子 session） | `pages/pattern/index.tsx:976` | — |

### 3. 版本与导出

| 事件名 | 触发时机 | 文件:行 | extend |
| --- | --- | --- | --- |
| `select-version` | 回退到指定历史版本（`handleSelectVersion`） | `pages/pattern/index.tsx:1079` | `{ versionId }` |
| `download-result` | 下载页面代码（`handleDownload`，重跑 replanner 后下载） | `pages/pattern/index.tsx:1104` | — |
| `share-result` | 分享，打包 intent/planner/modules/preview 为 ZIP | `pages/pattern/index.tsx:1144` | — |
| `live-preview` | 实时预览（`handleLivePreview`） | `pages/pattern/index.tsx:1165` | — |
| `pixso-preview` | Pixso 预览（`handlePixsoPreview`） | `pages/pattern/index.tsx:1173` | — |
| `code-to-html` | 页面捕获转 HTML（`handleCodeToHtml`） | `pages/pattern/index.tsx:1181` | — |

### 4. 输入与配置

| 事件名 | 触发时机 | 文件:行 | extend |
| --- | --- | --- | --- |
| `add-attachment` | 添加附件（文件选择/拖拽），仅 `toAdd.length > 0` 时上报 | `pages/pattern/index.tsx:1039` | `{ count }` |
| `select-design-system` | 选择设计系统（下拉项 onClick） | `pages/pattern/modules/chat/design-system-picker.tsx:84` | `{ designSystem }` |
| `select-model` | 模型选择面板确认选择（`onModelClose` cause="select"） | `pages/pattern/index.tsx:1209` | `{ modelId, provider }` |

## 三、备注

- 所有埋点均为「静默失败」：tracker 内部 catch 后只 `console.warn`，不影响业务流程。
- `path` 字段由 tracker 自动取 `window.location.href`，无需调用方传入。
- `extend` 为 JSON 字符串，tracker 会自动并入 `version`（来自 `localStorage.appInfo.version`）。
- `new-session` 在「侧边栏新建」与「首次发送新建」两条路径都会上报，统计去重时需注意。
