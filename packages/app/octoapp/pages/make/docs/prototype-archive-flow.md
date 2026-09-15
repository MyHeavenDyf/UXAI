# Prototype 归档数据流转逻辑

归档入口在 `components/result-viewer/html-renderer.tsx` 的 `handleArchiveConfirm`，由归档对话框「确认」触发。prototype 子类型通过 `subtype-handlers/prototype.tsx` 的 `buildArchiveSrc` 钩子向归档 ZIP 注入代码产物。最终压缩包由 `utils/archive-utils.ts` 的 `createArchiveZip` 统一组装。

涉及文件：

- `components/result-viewer/html-renderer.tsx:353` — `handleArchiveConfirm` 主编排
- `subtype-handlers/prototype.tsx:302` — `buildArchiveSrc`（prototype 代码包构建）
- `subtype-handlers/prototype.tsx:30` — `buildPrototypeCodeFiles`（下载/归档共用代码生成入口）
- `utils/archive-utils.ts:175` — `createArchiveZip`（压缩包构建）
- `utils/html-assets-zip.ts:29` — `readHtmlFromDisk`
- `utils/prototype-utils/a2ui.ts:168` — `loadA2uiDocs`（A2UI 数据加载）
- `utils/resource-tracker.ts:152` — `observedUrlsToAbsPaths`
- `lib/electron-api.ts` — desktop IPC 接口（`downloadHuiCode` / `exportZip` / `getUploadsDir` / `listDirectory` / `readFileBuffer`）

---

## 1. 归档主流程（handleArchiveConfirm）

`html-renderer.tsx:353` 起，按顺序：

1. **建任务**：`TaskStore.add` 注册 `archive-<ts>` 任务，状态 `in_progress`。
2. **埋点**：`tracker.interaction` 记录 `confirm-archive`（含 `isLoggedIn` / `isOverwrite` / `spaceType`）。
3. **隐藏归档对话框 overlay**，等两帧 `requestAnimationFrame`（保证截图不覆盖弹窗），调 `capturePageScreenshot(iframeRef)` 得 `screenshotBlob`，再恢复 overlay。
4. **读 HTML**：优先用 `api.readFileBuffer(props.filePath)` 从磁盘读原始字节，`decodeHtmlBytes` 解码；读不到回退 `props.content`。再 `extractHtmlContent` 剥外壳。这保证 ZIP 内 HTML 与磁盘文件一致（避免 tab.content 是 LLM 生成/未保存版本）。
5. **构造 SubtypeHandlerContext**（`html-renderer.tsx:438`）：含 `tab`、`sdk`、`sync`、`modelKey`、`sessionId`、`sdkDirectory`、`observedUrlsGetter`（绑 iframe 的 `resourceTracker.getPaths`）等。
6. **调 subtype 钩子 `buildArchiveSrc(ctx)`**（见第 2 节）。返回 `{ files }` 则赋给 `srcFiles`；prototype 返回 `null` 或抛错时 toast「代码包生成失败，已跳过 src/」并继续（src/ 留空）。
7. **prototype 专属**：`previewExtraDirs = [joinPath(htmlDir, "assets")]`（`html-renderer.tsx:478`）。assets 是指向 ict-coder 安装位置的 symlink，`list-directory` 走 `readdirSync` 跟随 symlink 能列出真实内容。
8. **`createArchiveZip({...})`** 组装 ZIP Blob（见第 3 节）。
9. **分支落地**：
   - 已登录：`createDeliverable` → `uploadCover`（封面）→ `uploadVersion`（ZIP）；覆盖模式跳过 create，直接 `uploadCover(existingDeliverableId)` + `uploadVersion(existingDocId)`。成功 toast「归档成功」并展示路径。
   - 未登录：`URL.createObjectURL(zipBlob)` + `<a download>` 触发浏览器下载 `archive.zip`。

---

## 2. buildArchiveSrc（prototype 代码包构建）

`prototype.tsx:302`。归档路径与「下载」按钮共享 `buildPrototypeCodeFiles`，但归档额外生成两份 targetLib 并把它们并列塞进 `src/`。

### 2.1 buildPrototypeCodeFiles 内部（`prototype.tsx:30`）

1. **取/建 session**：`getSessionById(tabId)` 命中则复用，否则 `createSession`。
2. **加载 A2UI 数据** `loadA2uiDocs(session, ctx)`（`a2ui.ts:168`）：
   - 新模型：解析 `prototype.html` 的 `dataPath` 字面量 → `a2ui-data/<folder>/<name>.json`（+ `.data.js` 孪生）。
   - 回退：旧 `<protoDir>/data.js`。
   - 命中缓存按 `(jsonPath, stat.size)`，size 变了丢弃重读。
3. **判别混合模式**：`isMixed = entries.some(e => e.jsonPath.includes("a2ui-data"))`。
4. **desktop API 校验**：无 `downloadHuiCode` → toast「当前环境不支持代码导出」，返回 `null`（软失败）。
5. **planner 生成**（`prototype.tsx:69`）：
   - 外部传入（`opts.planner`）则复用 —— 归档先生成 react 拿到 planner，再传给 ui 复用，省一次 LLM 调用。
   - 纯 A2UI 页且未提供 → 调 `proto_replanner`（需 `sdk`/`modelKey`/`sessionId`）。
   - 混合模式 → **跳过 replanner**，planner 用 `opts.planner ?? {slots:[]}`。
   - replanner 跑完用 `ctx.sdk.client.session.update` 把临时子 session **归档**（`time.archived`），避免被 `discoverChildSessions` 发现。
6. **调 `downloadHuiCode`**（IPC 转主进程）：
   - 混合：`jsonInput = entries.map(e => ({ planner, mergedA2UI: e.doc }))`（多节点 → 一份合并代码）。
   - 纯页：`jsonInput = [{ planner, mergedA2UI: entries[0].doc }]`。
   - 返回 `{ files: { path, content }[] }`。
7. **uploads 目录**：
   - `uploadsDir = api.getUploadsDir()` —— pattern 侧根目录。
   - `makeUploadsDir` —— prototype.html 同级 `uploads/`（属性编辑器上传图片落点，由 `save-prototype-image` IPC 写入）。

### 2.2 buildArchiveSrc 组装（`prototype.tsx:302`）

1. `reactResult = buildPrototypeCodeFiles(ctx, 'eview-react', { silent: true })`；`null` → 整体返回 `null`（主流程跳过 src/）。
2. `uiResult = buildPrototypeCodeFiles(ctx, 'eview-ui', { silent: true, planner: reactResult.planner })`；`null` → toast「eview-ui 代码包生成失败，已跳过 eview-ui」但继续。
3. **两包并列子目录**：`out.push({ path: 'eview-react/<f.path>', content })`，ui 同理（`prototype.tsx:313-315`）—— 避免根级文件冲突。
4. **uploads 资源**（`prototype.tsx:319-345`）：
   - `fullUploadsPath = uploadsDir && sessionId ? '${uploadsDir}/${sessionId}/uploads' : null`。
   - `uploadDirs = [fullUploadsPath?, makeUploadsDir?]`。
   - `libs = uiResult ? ['eview-react','eview-ui'] : ['eview-react']`。
   - 对每个 uploadDir：`listAllFiles` 递归列绝对路径 → `readFileBuffer` 读字节 → 每个文件写入 **每个 lib** 的 `public/assets/<rel>`（codegen 已把 `uploads/...` 和 `/uploads/...` 改写为 `/assets/...`）。
5. 返回 `{ files: out }`（路径形如 `eview-react/src/...`、`eview-react/public/assets/...`）。

> 对比下载按钮 `handleDownload`（`prototype.tsx:242`）：下载只生成单 targetLib，且通过 `desktopApi.exportZip`（带 `sourceDirs` 映射）落盘；归档则两包全做，内存里拼 `out` 数组交给 `createArchiveZip` 平铺进 `src/`。

---

## 3. 压缩包构建流程（createArchiveZip，重点）

`archive-utils.ts:175`。用 `JSZip` 在内存组装，`zip.generateAsync({ type: "blob" })` 产出 Blob。

### 3.1 ZIP 目录结构

```
archive.zip
├── data/
│   ├── comments.json              # 标注（transformCommentsForArchive 后）
│   ├── screenshot.jpg            # capturePageScreenshot 产出
│   └── <commentId>/              # 每条带附件的评论一个子目录
│       └── <attachmentId><ext>   # 附件二进制
├── src/                          # subtype 代码包（prototype 时两包并列）
│   ├── eview-react/<f.path>      #   eview-react 代码 + public/assets
│   └── eview-ui/<f.path>         #   eview-ui 代码 + public/assets
└── preview/
    ├── index.html                # 磁盘原始 HTML（剥桥脚本注入）
    └── <relPath>                 # 静态解析 ∪ 网络信号 收集的引用资源
```

### 3.2 写入顺序（与代码一致）

1. **预建空目录**：`zip.folder("data")` / `zip.folder("src")` / `zip.folder("preview")`。
2. **src/ 平铺**（`archive-utils.ts:183`）：遍历 `options.srcFiles`（即 `buildArchiveSrc` 返回的 `out`），`zip.file('src/' + f.path, f.content)`。注意 src/ 不再嵌套 zip，直接平铺，prototype 产物自带 `eview-react/`、`eview-ui/` 子目录前缀。
   - **代码 manifest**（`prototype.tsx buildArchiveSrc`）：把每个 lib 的 `result.manifest` 序列化成 `manifest/{lib}/tree.json` + `manifest/{lib}/content.json` 推进 `out`，与 `eview-react/`、`eview-ui/` 平级落到 `src/manifest/` 下、按组件库名称分子目录，供设计平台「框选节点 → 定位产物文件」。manifest 由 `downloadHuiCode` 在管线后置构建（不进 `outputFiles`），`buildPrototypeCodeFiles` 透传 `result.manifest`。
3. **data/comments.json**：`transformCommentsForArchive(comments)` → 精简为 `{ id, note, selector, time, account, userName, attachments:[{fileName,id}] }`，`JSON.stringify(..., null, 2)`。
4. **data/screenshot.jpg**：`blobToUint8Array(screenshotBlob)`。
5. **preview/index.html**（`archive-utils.ts:198`）：`readHtmlFromDisk(htmlFilePath, htmlContent, api.readFileBuffer)` —— 再次从磁盘读原始 HTML（与主流程第 4 步一致，双保险），剥桥脚本注入。
6. **preview/ 引用资源**（`archive-utils.ts:205-243`，仅当 `api.readFileBuffer && htmlFilePath`）：
   - `htmlDir = dirname(htmlFilePath)`，`htmlFileName = basename(htmlFilePath)`。
   - **静态解析**：`collectReferencedFiles({ rootContent: htmlContent, rootType: "html", rootAbsPath, readFileBuffer })` 返回绝对路径集合（递归解析 HTML/CSS 里的本地引用）。
   - **网络信号**：`observedUrlsToAbsPaths(options.observedUrls)` 把 `local://` URL 转回绝对路径（覆盖运行时动态注入、`new URL` 形式等 regex 抓不到的资源）。
   - **取并集 + 限定同目录**：归档视图约定 HTML 在 `preview/index.html`，不支持跨父级 `..` 引用，故只保留 `htmlDir` 内的相对路径，跨父级引用丢弃。
   - 逐个 `api.readFileBuffer(joinPath(htmlDir, rel))` → `zip.file('preview/' + rel, bytes)`。
7. **preview/ 额外目录**（`archive-utils.ts:246-263`）：`options.previewExtraDirs`（prototype 时为 `[htmlDir/assets]`）。对每个 dir：
   - `destPrefix = relativeTo(htmlDir, dir) || basename(dir)`（assets 在 htmlDir 下，destPrefix 即 `assets`）。
   - `listDirFiles(api.listDirectory, dir)` 递归列绝对路径。
   - 逐文件 `readFileBuffer` → `zip.file('preview/' + destPrefix + '/' + rel, bytes)`。
   - 这条路径专为 prototype 的 assets symlink 而设（绕过静态解析对 symlink 的局限）。
8. **评论附件**（`archive-utils.ts:266-284`）：遍历 `comments`，有 attachments 的 `zip.folder('data/<commentId>')`，每附件 `readFileBuffer(joinPath(projectDir, attachment.filePath))` → `zip.file('data/<commentId>/<attachmentId><ext>', bytes)`（ext 取自 `attachment.filename`）。
9. **`zip.generateAsync({ type: "blob" })`** 返回 Blob。

### 3.3 资源收集的两条腿

| 来源 | 方法 | 覆盖场景 |
|---|---|---|
| 静态解析 | `collectReferencedFiles`（`references.ts`） | HTML/CSS 里写死的本地引用（`./`、相对/绝对路径） |
| 网络信号 | `observedUrlsToAbsPaths`（`resource-tracker.ts:152`） | iframe 实际加载过的 `local://` URL：打包器 `new URL` 转换、运行时动态注入 css 等 regex 抓不到的 |

两者取并集，再限定到 `htmlDir` 子树内（归档视图 HTML 固定在 `preview/index.html`）。prototype 额外用 `previewExtraDirs` 把 `assets/` symlink 整目录带走。

---

## 4. 数据流总览

```
┌───────────────────── html-renderer.tsx: handleArchiveConfirm ─────────────────────┐
│                                                                                    │
│  1. TaskStore.add + tracker.interaction                                            │
│  2. capturePageScreenshot(iframe) → screenshotBlob                                 │
│  3. api.readFileBuffer(filePath) → decodeHtmlBytes → extractHtmlContent            │
│  4. handler.buildArchiveSrc(ctx) ──────────────┐                                   │
│  5. previewExtraDirs = [htmlDir/assets]          │                                  │
│  6. createArchiveZip({...}) → zipBlob ◀──────── │ ──────────┐                     │
│  7. createDeliverable/uploadCover/uploadVersion  │           │                     │
│     或 URL.createObjectURL + <a download>        │           │                     │
└──────────────────────────────────────────────────┼───────────┼─────────────────────┘
                                                   │           │
                ┌── prototype.tsx: buildArchiveSrc ─┘           │
                │                                                ▼
                │  reactResult = buildPrototypeCodeFiles('eview-react')   createArchiveZip
                │  uiResult    = buildPrototypeCodeFiles('eview-ui',      (archive-utils.ts:175)
                │                          { planner: reactResult.planner })
                │  out = [eview-react/<f>, eview-ui/<f>, uploads→各 lib/public/assets]
                │  return { files: out }
                │
                └── prototype.tsx: buildPrototypeCodeFiles
                     │
                     ├─ loadA2uiDocs(session, ctx)          a2ui.ts:168
                     │     ├─ discoverA2uiNodes → a2ui-data/*.json(+.data.js)
                     │     └─ 回退 <protoDir>/data.js；缓存按 (jsonPath, stat.size)
                     ├─ isMixed = entries.some(jsonPath 含 'a2ui-data')
                     ├─ planner：opts.planner 复用 / 纯页调 proto_replanner / 混合跳过
                     │     └─ 临时子 session 完成后 session.update({ time.archived })
                     ├─ jsonInput：混合逐节点 / 纯页单条
                     ├─ api.downloadHuiCode(jsonInput, { targetLib }) → { files }
                     └─ uploadsDir = api.getUploadsDir()；makeUploadsDir = htmlDir/uploads
```

---

## 5. 关键设计点

- **下载与归档共享 `buildPrototypeCodeFiles`**：唯一代码生成入口，归档用 `silent:true` 抑制 toast，并复用 react 的 planner 给 ui 省 LLM 调用。
- **src/ 平铺而非嵌套 zip**：prototype 产物自带 `eview-react/`、`eview-ui/` 子目录前缀，避免根级文件冲突，也避免 ZIP-in-ZIP。
- **uploads 双源同步**：pattern 侧 `${uploadsDir}/${sessionId}/uploads` + make 侧 `${htmlDir}/uploads`，codegen 已把 `/uploads/...` 改写为 `/assets/...`，故都落到各包 `public/assets/`。
- **HTML 双保险**：主流程和 `createArchiveZip` 都从磁盘读原始 HTML，确保 ZIP 内 HTML 与磁盘一致（不混入 tab.content 的 LLM/未保存版本）。
- **资源收集 = 静态解析 ∪ 网络信号**，再限定到 `htmlDir` 子树；prototype 的 assets symlink 用 `previewExtraDirs` 整目录打包绕过 symlink 解析局限。
- **软失败**：`buildArchiveSrc` 返回 `null` 时主流程 toast 跳过 src/ 继续；`createArchiveZip` 内逐文件 `try/catch` + `console.warn`，单文件失败不阻断整体。
- **临时子 session 归档化**：`proto_replanner` 跑完把子 session 标记 `archived`，使 `session.list` 默认排除它，`discoverChildSessions` 不会再发现。
