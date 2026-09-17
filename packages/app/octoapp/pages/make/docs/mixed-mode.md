# 混合页（Mixed-Mode）功能开发说明

> 本文档描述「混合页」相关四块功能的实现：宿主元素框选、多 doc 持久化、历史记录、代码导出。供后续开发者参考。

## 1. 背景：两种页面模式

| 模式 | 数据布局 | prototype.html | iframe 内 A2UI 实例数 |
|---|---|---|---|
| **纯 A2UI 页** | `<protoDir>/data.js`（`window.__A2UI_DATA__ = ...`） | 直接 `#app` 挂载 bundle，无 `PreviewRenderer` 实例化 | 1 |
| **混合页** | `<protoDir>/a2ui-data/<folder>/<name>.json`(+`.data.js` 孪生) | 手写 HTML + `new PreviewRenderer({ container, dataPath })` 实例化（≥1 个） | ≥1 |

混合页里 A2UI 节点与宿主 HTML 共存于一个 iframe 文档。

## 2. 跨仓库架构

功能横跨两个仓库：

- **UXAI / `packages/previewpc`**：iframe 侧 dom-picker 运行时（`dom-picker-core/runtime.js`）、拖拽桥（`src/utils/drag-bridge.js`）、A2UI 渲染器（`src/renderer/render/ComponentNode.vue`、`src/views/PreviewPage.vue`）。构建产物 `packages/previewdist/assets/index.js`。
- **UXAI1 / `packages/app/octoapp/pages/make`**：父侧（electron/SolidJS），消息路由、面板 UI、持久化、历史、代码导出。

**部署链**（手动）：改 UXAI 侧 → `cd packages/previewpc && bun run build` → 拷 `assets/index.js` 到 `UXAI1/packages/previewdist/assets/` 与会话输出目录 `.../outputs/previewdist/assets/` → bump `prototype.html` 的 `?v=` 硬刷新。UXAI1 侧改完跑 `cd packages/app && bun typecheck`（`tsgo -b`）；dev 态热重载，打包态需重装 `packages/app`。

---

## 3. 功能一：宿主元素框选（A2UI vs 普通元素判别）

### 判据：`dom-picker-component` 属性

A2UI 渲染的元素一律带 `dom-picker-component`（值=组件类型），由 `ComponentNode.vue` 写入（原生标签分支 `bindProps` 与注册组件分支均设）。宿主元素没有。

### `resolveMarkedTarget`（`runtime.js`）四步优先级

```
1. closest([data-dom-picker-source]) → a2ui   // 编译期源码标记，本项目 nodeTransform 未接入，不命中
2. closest([dom-picker-component])   → a2ui   // ★主判据：有此属性即 A2UI
3. resolveHostTarget(target)         → host   // 否则命中指针下最里层 target（跳过 html/body/head）
4. resolveVueComponentSource 兜底     → a2ui
```

- 第 3 步 `resolveHostTarget`：直接取 `event.target`（选到最里层，行内元素也选得到本身，不吸附父块）；生成唯一 CSS 选择器（`buildHostSelector`：优先 `#id`，逐层 `tag.class`/`tag:nth-of-type(k)` 直到 `querySelectorAll` 唯一，兜底全路径）。
- 结果带 `kind: 'a2ui' | 'host'` 与 `selector`（host 时为 CSS 选择器）。

### 颜色与消息

- overlay 着色：`applyOverlayColor(overlay, kind)` —— a2ui 蓝 `#007bff` / host 橙 `#fa8c16`。
- `handleClick`/`handleContextMenu` 的 postMessage payload 增 `kind` + `selector`；host 时 `id` 字段写同一选择器串（保持 `id` 链路不破）。
- `selectParent`（右键「选择父容器」）走 `resolveMarkedTarget(parent)`，kind 自动判定。

### 父侧分流（UXAI1）

`message-handler.ts` 透传 `kind`/`selector` 到 `dispatchPrototypeQuickFix`/`CtxMenu`；UI 据此分流：

| | a2ui | host |
|---|---|---|
| mask 框色 | 蓝 | 橙（`prototype-property-editor.tsx` `maskStyle`） |
| 属性编辑器 | 开 | **不开**（`show` gated `kind!=='host'`） |
| 「下载Pattern」菜单项 | 显示 | 隐藏（`prototype-ctx-menu.tsx`） |
| 复制名称 | 复制 elementId | 复制 selector |
| prompt 标注 | `[选中A2UI元素: <id>]` | `[选中页面元素: <selector>]`（`make/index.tsx`） |
| 改动落地 | `applyPrototypeModify` 改 A2UI JSON | picker-dialog → 文本 → AI（不走 A2UI modify） |

### 宿主禁拖

`drag-bridge.js` `draggable()`/`onDown` 的冻结分支：要求目标命中 `[dom-picker-component]` 或位于 `.preview-a2ui-app` 内才可拖；宿主元素冻结后不可拖（避免向 A2UI reorder 通道发非法 id）。

### 关键文件

- `UXAI/packages/previewpc/dom-picker/dom-picker-core/runtime.js`：`resolveMarkedTarget` / `resolveHostTarget` / `buildHostSelector` / `applyOverlayColor` / `handleClick` / `handleContextMenu`。
- `UXAI/packages/previewpc/src/utils/drag-bridge.js`：`isA2uiContext` / `draggable` / `onDown`。
- `UXAI1/.../make/utils/prototype-utils/types.ts`：`PrototypeQuickFixData`/`PrototypeCtxMenuData`/`PrototypePickerData` 的 `kind`/`selector` 字段。
- `UXAI1/.../make/utils/prototype-utils/message-handler.ts`：`quick-fix`/`context-menu` 透传 `kind`。
- `UXAI1/.../make/components/result-viewer/prototype-property-editor.tsx`：mask 着色 + host 跳过属性编辑器 + submit/append 带 kind。
- `UXAI1/.../make/components/result-viewer/prototype-ctx-menu.tsx`：host 复制选择器 + 隐藏下载Pattern。
- `UXAI1/.../make/index.tsx`：prompt 按 kind 区分标注。

---

## 4. 功能二：多 doc 持久化（a2ui-data/*）

旧模型：`session.a2ui` 单 doc，读写 `<protoDir>/data.js`。新模型：`session.a2uiDocs: A2uiDocEntry[]` 多 doc 注册表。

### `A2uiDocEntry`（`types.ts`）

```
{ doc, loadSize, jsonPath, dataJsPath, rootId, persistTimer, persistPending }
```
- `jsonPath`：裸 JSON 持久化目标（旧页即 `data.js` 本身）。
- `dataJsPath`：`.data.js` 孪生（file:// 用），无则 null。
- `rootId`：实例标识（= `doc.rootId`），用于 `od:a2ui-update`/`state-snapshot` 路由。

### 发现：解析 prototype.html 的 `dataPath`（`a2ui.ts` `discoverA2uiNodes`）

正则 `/dataPath\s*:\s*['"]([^'"]+)['"]/g` 扫 `prototype.html` → 每条解析成绝对路径对：
- `.json` dataPath → `jsonPath` = 该 .json，孪生 `.data.js` 经 `statFile` 确认存在则记 `dataJsPath`。
- `.data.js` dataPath → `dataJsPath` = 该文件，`jsonPath` = 同名 `.json`。

**只用 `readFileBuffer`/`statFile`，不依赖 `dirExists`/`listDirectory`**（后者部分桌面端未实现，曾导致发现失败）。无 dataPath → 回退 `<protoDir>/data.js` 单 entry（纯页兼容）。

### 加载与脏检（`loadA2uiDocs`）

逐 entry：`statFile(jsonPath).size === loadSize` 则复用缓存，否则重读。`readA2uiFile` 自动识别并剥离 `window.__A2UI_DATA__`/`__A2UI_FILE_DATA__` 包装（裸 .json / .data.js 孪生 / 旧 data.js 三态通吃，`parseA2uiJson` 三层兜底解析）。

### 元素/实例路由

- `findDocByElementId(entries, elementId)`：跨所有 doc 找 `elements` 含 `baseId`（`:N` 循环后缀已剥离）的 entry。
- `findDocByRootId(entries, rootId)`：按 rootId 定位；空 rootId 回退首个 entry（旧 iframe 兼容）。

### 提交与持久化（`commitA2uiDoc` / `persistA2uiDoc` / `schedulePersistA2uiDoc`）

- `commitA2uiDoc(session, entry, doc)`：更新 entry.doc/rootId → `postMessageToIframe({type:'od:a2ui-update', payload: doc})` → 排程写盘。
- `persistA2uiDoc`：**格式分流**
  - 旧 `data.js`（`dataJsPath==null && basename(jsonPath)==='data.js'`）→ 写 `window.__A2UI_DATA__ = <JSON>;\n`
  - 否则 `jsonPath` 写裸 `JSON.stringify(doc)`；`dataJsPath` 存在则再写 `window.__A2UI_FILE_DATA__ = <JSON>;\n`。
  - 每文件独立 stat 脏检（size 不符→中止+toast+清缓存）+ 临时文件 `renameFile` 原子写。写后 `dispatchA2uiPersisted(tab.filePath)`。
- `schedulePersistA2uiDoc`：600ms 防抖，按 entry 独立计时。

### 多实例消息路由（iframe 侧 `PreviewPage.vue`）

混合页多节点 = 多个 `PreviewPage.vue` 实例，各自监听 `window` 的 `od:a2ui-update`。广播会让所有实例应用同一 doc → 串扰。修复：
- `od:a2ui-update`：仅当 `payload.rootId === currentContent.rootId` 才应用（currentContent 未就绪或 payload 无 rootId 时回退为应用，兼容旧单实例/首次加载）。
- `od:a2ui-state-request`：响应的 `od:a2ui-state-snapshot` 带回 `rootId`，父侧 `findDocByRootId` 路由到对应 doc。

### 关键文件

- `UXAI1/.../make/utils/prototype-utils/a2ui.ts`：`loadA2uiDocs`/`loadA2uiData`(兼容合并)/`discoverA2uiNodes`/`readA2uiFile`/`findDocByElementId`/`findDocByRootId`/`buildSiblingMap`(多doc合并)/`commitA2uiDoc`/`persistA2uiDoc`/`schedulePersistA2uiDoc`/`getA2uiDataRelativePaths`。
- `UXAI1/.../make/utils/prototype-utils/modify.ts`：`applyPrototypeModify`/`applyPrototypeReorder` 按 `findDocByElementId` 定位 entry。
- `UXAI1/.../make/utils/prototype-utils/message-handler.ts`：`A2UI_STATE_CHANGE`(按 elementId/rootId)、`od:a2ui-state-snapshot`(按 rootId)、`od:a2ui-ready`(重载 loadA2uiDocs)。
- `UXAI1/.../make/utils/prototype-utils/session.ts`：`createSession`(a2uiDocs:[])、`disposeSession`(逐 entry flush)、`invalidatePrototypeCache`。
- `UXAI/packages/previewpc/src/views/PreviewPage.vue`：rootId 过滤。

---

## 5. 功能三：混合模式历史记录

旧：`prototype.tsx` `onHistoryTrigger` 硬编码 `['./data.js']`，`applyVersionFiles` 只恢复 `./data.js` —— 混合页 `data.js` 不存在，历史完全失效。

### 修复

- `onHistoryTrigger` 改 **async**，调 `getA2uiDataRelativePaths(ctx)`：混合页返回各 `.json`+`.data.js` 孪生相对路径；纯页回退 `['./data.js']`。
- `applyVersionFiles` 改为遍历 `files: VersionFile[]`，逐个 `copyFileTo(f.filePath, f.originalPath)`（恢复全部数据文件）+ `invalidatePrototypeCache`。
- 接口 `SubtypeHandler.onHistoryTrigger` 返回类型放宽为 `Promise<string[]|null> | string[]|null`；`default.ts`/`components.tsx` 同步改 async。
- `history-controller.ts`：`getTabFiles` 改 async；`getTabFileSetHash`/`findVersionByHash`/`trigger`/`switchVersion` 对 `onHistoryTrigger` 加 `await`。

### 流程

- **快照**：用户编辑 A2UI 节点 → `persistA2uiDoc` 写 a2ui-data → 派发 `prototype:a2ui-persisted` → `index.tsx` 监听 → `historyController.onUserEdit` → `onHistoryTrigger` 返回 a2ui-data 文件集 → `recordVersion` 把每个文件拷进版本目录。
- **恢复**：切版本 → `getVersionFiles` 按文件集匹配 → `applyVersionFiles` 各文件拷回原路径 → 失效缓存 → 下次 `loadA2uiDocs` 重读。

### 关键文件

- `UXAI1/.../make/subtype-handlers/prototype.tsx`：`onHistoryTrigger`/`applyVersionFiles`。
- `UXAI1/.../make/subtype-handlers/history-controller.ts`：`getTabFiles` async + 调用点 await。
- `UXAI1/.../make/subtype-handlers/types.ts`：接口签名。
- `UXAI1/.../make/utils/history-store.ts`：`recordVersion`/`getVersionFiles`（每 rel 一份，`VersionFile.originalPath` 供恢复）。

---

## 6. 功能四：混合模式代码导出

`buildPrototypeCodeFiles`（`prototype.tsx`）是「下载」按钮（`handleDownload`）与归档（`buildArchiveSrc`）共用的唯一代码生成入口。

### 改动

- 数据加载 `loadA2uiData`(单合并) → `loadA2uiDocs`(每节点 doc 一条 entry)。
- 模式判别 `isMixed = entries.some(e => e.jsonPath.includes('a2ui-data'))`。
- replanner 分流：`if (!isMixed && !planner) { 调 proto_replanner }` —— **混合模式跳过 replanner**，planner 用 `opts.planner ?? {}`。
- `downloadHuiCode` 调用：
  - 混合：`jsonInput = entries.map(e => ({ planner: planner ?? {}, mergedA2UI: e.doc }))` —— 每节点一条，接口已兼容多份数据 → 导出一份合并代码。
  - 纯页：`jsonInput = [{ planner, mergedA2UI: entries[0].doc }]`（原行为）。

### 行为矩阵

| 模式 | replanner | jsonInput | 产物 |
|---|---|---|---|
| 纯 A2UI | 未提供 planner 时跑 | 单条 | 一份代码 |
| 混合单节点 | 跳过 | 1 条（该节点 doc） | 一份代码 |
| 混合多节点 | 跳过 | N 条（每节点 doc） | 一份合并代码 |

归档路径 `buildArchiveSrc` 先后生成 eview-react 与 eview-ui 两包；混合模式下 react 返回 `planner: null`，ui 复用（仍 isMixed → 跳过 replanner）。纯页归档行为不变（react 跑 replanner，ui 复用 planner）。

### 关键文件

- `UXAI1/.../make/subtype-handlers/prototype.tsx`：`buildPrototypeCodeFiles` / `handleDownload` / `buildArchiveSrc`。
- `UXAI1/.../make/lib/electron-api.ts`：`downloadHuiCode` 签名（`input: {planner, mergedA2UI}[]`）。

---

## 7. 判别速查

| 问题 | 判据 | 位置 |
|---|---|---|
| 元素是 A2UI 还是宿主？（运行时，元素级） | 有无 `dom-picker-component` 属性 | `runtime.js` `resolveMarkedTarget` 第 2/3 步 |
| 页面是混合还是纯？（持久化/导出，页面级） | `prototype.html` 有无 `dataPath` 字面量 / `a2ui-data` 是否存在 | `a2ui.ts` `discoverA2uiNodes` / `buildPrototypeCodeFiles` `isMixed` |
| 一条 quick-fix 消息属于哪种？ | `kind` 字段 | `message-handler.ts` 透传 |

---

## 8. 消息协议（iframe ↔ 父层）

父→iframe：
- `od:dom-picker-mode {enabled}` 开关 dom-picker
- `od:dom-picker-unfreeze` 解冻
- `od:dom-picker-select-parent` 选父容器
- `od:drag-mode {enabled, siblingMap}` 拖拽开关
- `od:a2ui-update {payload}` 重渲染（iframe 侧按 rootId 过滤）
- `od:a2ui-state-request` 请求 surface 运行时 state

iframe→父：
- `od:dom-picker-quick-fix {kind, id, selector, domPickerComponent, domPickerClass, elementProps, tagName, rect, clickX/Y}`
- `od:dom-picker-context-menu {kind, id, selector, ...}`
- `od:dom-picker-rect-update {id, rect}`
- `od:dom-picker-close-panels`
- `A2UI_STATE_CHANGE {elementId?, propName, value, path?}`（commitActivation 带 elementId；setState 仅 path）
- `od:a2ui-state-snapshot {state, rootId}`
- `od:a2ui-ready`
- `od:drag-reorder {elementId, targetSiblingId, position}`

父层事件总线（`events.ts`）：`prototype:quick-fix` / `prototype:ctx-menu` / `prototype:rect-update` / `prototype:close-panels` / `prototype:picker-submit` / `prototype:picker-append` / `prototype:a2ui-persisted`。

---

## 9. 测试

- `UXAI1/.../make/utils/prototype-utils/a2ui.test.ts`：22 用例（`bun test --preload ./happydom.ts ./octoapp/pages/make/utils/prototype-utils/a2ui.test.ts`）。覆盖 `buildSiblingMap`/`findDocByElementId`/`findDocByRootId`/`loadA2uiDocs`(发现/孪生/多节点/旧页/缓存)/`loadA2uiData`(合并)/`persistA2uiDoc`(格式/脏检/原子写)/`commitA2uiDoc`/`getA2uiDataRelativePaths`。内存 fake fs 测真实实现。
- iframe 侧 `buildHostSelector`/`resolveHostTarget` 未单测（previewpc 包无 test runner + 两函数未导出）；手动验证。

## 10. 已知限制 / 后续

- **`A2UI_STATE_CHANGE` 的 `setState`（仅 path，无 elementId）**：多节点下若 iframe 未带 rootId，会回退到首个 entry；`od:a2ui-state-snapshot`（进入编辑态的权威全量捕获）已按 rootId 正确路由，会修正增量误写。如需 `setState` 也精确路由，可给 `hooks.ts` 的 `setState` 消息补 `rootId`（需读 surface rootId）。
- **混合模式代码导出传 `planner: {}`**（空对象，类型要求非空）。若 codegen 侧实际需要某些 planner 字段才能产出有效代码，需补充。
- **版本恢复后 iframe 自动重载**：`applyVersionFiles` 只把文件拷回 + 失效缓存；iframe 是否自动重读 a2ui-data 取决于既有的文件监听/刷新机制（与纯页一致）。
- **`discoverA2uiNodes` 依赖 `dataPath` 字面量**：若 prototype.html 用非常规写法（如变量拼 dataPath）会漏发现；可补 `a2ui-data/` 目录扫描作二级兜底（需 `listDirectory`）。
- **`getTabFiles` 改 async** 后，新增 subtype handler 的 `onHistoryTrigger` 可返回 `Promise` 或同步数组（`await` 兼容两者）。
