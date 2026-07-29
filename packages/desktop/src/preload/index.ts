import { contextBridge, ipcRenderer, webUtils } from "electron"
import type { DownloadSavePathInfo, ElectronAPI, InitStep, SqliteMigrationProgress } from "./types"

const api: ElectronAPI = {
  killSidecar: () => ipcRenderer.invoke("kill-sidecar"),
  installCli: () => ipcRenderer.invoke("install-cli"),
  awaitInitialization: (onStep) => {
    const handler = (_: unknown, step: InitStep) => onStep(step)
    ipcRenderer.on("init-step", handler)
    return ipcRenderer.invoke("await-initialization").finally(() => {
      ipcRenderer.removeListener("init-step", handler)
    })
  },
  getWindowConfig: () => ipcRenderer.invoke("get-window-config"),
  consumeInitialDeepLinks: () => ipcRenderer.invoke("consume-initial-deep-links"),
  getDefaultServerUrl: () => ipcRenderer.invoke("get-default-server-url"),
  setDefaultServerUrl: (url) => ipcRenderer.invoke("set-default-server-url", url),
  getWslConfig: () => ipcRenderer.invoke("get-wsl-config"),
  setWslConfig: (config) => ipcRenderer.invoke("set-wsl-config", config),
  getDisplayBackend: () => ipcRenderer.invoke("get-display-backend"),
  setDisplayBackend: (backend) => ipcRenderer.invoke("set-display-backend", backend),
  parseMarkdownCommand: (markdown) => ipcRenderer.invoke("parse-markdown", markdown),
  checkAppExists: (appName) => ipcRenderer.invoke("check-app-exists", appName),
  wslPath: (path, mode) => ipcRenderer.invoke("wsl-path", path, mode),
  resolveAppPath: (appName) => ipcRenderer.invoke("resolve-app-path", appName),
  storeGet: (name, key) => ipcRenderer.invoke("store-get", name, key),
  storeSet: (name, key, value) => ipcRenderer.invoke("store-set", name, key, value),
  storeDelete: (name, key) => ipcRenderer.invoke("store-delete", name, key),
  storeClear: (name) => ipcRenderer.invoke("store-clear", name),
  storeKeys: (name) => ipcRenderer.invoke("store-keys", name),
  storeLength: (name) => ipcRenderer.invoke("store-length", name),

  getWindowCount: () => ipcRenderer.invoke("get-window-count"),
  onSqliteMigrationProgress: (cb) => {
    const handler = (_: unknown, progress: SqliteMigrationProgress) => cb(progress)
    ipcRenderer.on("sqlite-migration-progress", handler)
    return () => ipcRenderer.removeListener("sqlite-migration-progress", handler)
  },
  onMenuCommand: (cb) => {
    const handler = (_: unknown, id: string) => cb(id)
    ipcRenderer.on("menu-command", handler)
    return () => ipcRenderer.removeListener("menu-command", handler)
  },
  onDeepLink: (cb) => {
    const handler = (_: unknown, urls: string[]) => cb(urls)
    ipcRenderer.on("deep-link", handler)
    return () => ipcRenderer.removeListener("deep-link", handler)
  },
  onDownloadSavePath: (cb) => {
    const handler = (_: unknown, info: DownloadSavePathInfo) => cb(info)
    ipcRenderer.on("download-save-path", handler)
    return () => ipcRenderer.removeListener("download-save-path", handler)
  },

  openDirectoryPicker: (opts) => ipcRenderer.invoke("open-directory-picker", opts),
  openFilePicker: (opts) => ipcRenderer.invoke("open-file-picker", opts),
  saveFilePicker: (opts) => ipcRenderer.invoke("save-file-picker", opts),
  openLink: (url) => ipcRenderer.send("open-link", url),
  openPath: (path, app) => ipcRenderer.invoke("open-path", path, app),
  showItemInFolder: (path) => ipcRenderer.invoke("show-item-in-folder", path),
  downloadResource: (url, destPath) => ipcRenderer.invoke("download-resource", url, destPath),
  // office「下载」按钮:解析资源已落地的本地副本(不拉网络,缺失返回 null)+ 把本地副本拷到用户选定路径(fs.copyFile)。
  resolveMaterializedPath: (namespace, baseDir, sessionId) =>
    ipcRenderer.invoke("resolve-materialized-path", namespace, baseDir, sessionId),
  copyFileTo: (srcPath, destPath) => ipcRenderer.invoke("copy-file-to", srcPath, destPath),
  downloadResourceToTemp: (url, namespace, filename, baseDir, sessionId) =>
    ipcRenderer.invoke("download-resource-to-temp", url, namespace, filename, baseDir, sessionId),
  // SPEC-INS-014 v2(会话隔离):把源文件拷贝进 <baseDir>/.octo/tmps/(预会话落地区,主进程 fs.copyFile);返回落地路径。
  copyFileToWorktree: (srcPath, baseDir, filename) =>
    ipcRenderer.invoke("copy-file-to-worktree", srcPath, baseDir, filename),
  // SPEC-INS-014 §4.1.2(v2 新增):发送时把 .octo/tmps/ 里的附件 rename 进 <baseDir>/.octo/<sessionId>/uploads/。
  movePendingUploadToSession: (srcPath, baseDir, sessionId) =>
    ipcRenderer.invoke("move-pending-upload-to-session", srcPath, baseDir, sessionId),
  // Electron 32+ 已移除 File.path —— 用 webUtils.getPathForFile 拿拖拽/选取文件的真实本地路径。
  // 这是 Electron 官方推荐的 preload 暴露法(File 对象在此同步解析)。
  getPathForFile: (file) => webUtils.getPathForFile(file),
  readClipboardImage: () => ipcRenderer.invoke("read-clipboard-image"),
  showNotification: (title, body) => ipcRenderer.send("show-notification", title, body),
  getWindowFocused: () => ipcRenderer.invoke("get-window-focused"),
  setWindowFocus: () => ipcRenderer.invoke("set-window-focus"),
  showWindow: () => ipcRenderer.invoke("show-window"),
  relaunch: () => ipcRenderer.send("relaunch"),
  getZoomFactor: () => ipcRenderer.invoke("get-zoom-factor"),
  setZoomFactor: (factor) => ipcRenderer.invoke("set-zoom-factor", factor),
  setTitlebar: (theme) => ipcRenderer.invoke("set-titlebar", theme),
  setTitlebarOverlayHidden: (hidden) => ipcRenderer.invoke("set-titlebar-overlay-hidden", hidden),
  loadingWindowComplete: () => ipcRenderer.send("loading-window-complete"),
  runUpdater: (alertOnFail) => ipcRenderer.invoke("run-updater", alertOnFail),
  checkUpdate: () => ipcRenderer.invoke("check-update"),
  installUpdate: () => ipcRenderer.invoke("install-update"),
  setBackgroundColor: (color: string) => ipcRenderer.invoke("set-background-color", color),
  getSkillsConfig: () => ipcRenderer.invoke("get-skills-config"),
  setSkillsConfig: (config) => ipcRenderer.invoke("set-skills-config", config),
  getSkillConfig: () => ipcRenderer.invoke("get-skill-config"),
  // jk-j60099994-replace-with-60062650-preload-index-1-start
  // jk-j60099994-replace-with-60062650-preload-index-1-end
  getSkillContent: (skillName) => ipcRenderer.invoke("get-skill-content", skillName),
  addSkill: (sourcePath) => ipcRenderer.invoke("add-skill", sourcePath),
  ensureSkillConfig: () => ipcRenderer.invoke("ensure-skill-config"),
  openSkillFolder: () => ipcRenderer.invoke("open-skill-folder"),
  htmlToPdf: (html) => ipcRenderer.invoke("html-to-pdf", html),
  writeFileBuffer: (path, buffer) => ipcRenderer.invoke("write-file-buffer", path, buffer),
  saveUploadImage: (buffer, sessionId) => ipcRenderer.invoke("save-upload-image", buffer, sessionId),
  getUploadsDir: () => ipcRenderer.invoke("get-uploads-dir"),
  setUploadsDir: (dir) => ipcRenderer.invoke("set-uploads-dir", dir),
  writeFile: (path, content) => ipcRenderer.invoke("write-file", path, content),
  readFileBuffer: (path) => ipcRenderer.invoke("read-file-buffer", path),
  fileExists: (path) => ipcRenderer.invoke("file-exists", path),
  deleteFile: (path) => ipcRenderer.invoke("delete-file", path),
  writeClipboardText: (text) => ipcRenderer.invoke("write-clipboard-text", text),
  capturePreviewRect: (rect) => ipcRenderer.invoke("capture-preview-rect", rect),
  capturePreviewPage: (opts) => ipcRenderer.invoke("capture-preview-page", opts),
  tailwindToCss: (className) => ipcRenderer.invoke("tailwind-to-css", className),
  cssToTailwind: (cssObject) => ipcRenderer.invoke("css-to-tailwind", cssObject),
  getPreviewDistDir: () => ipcRenderer.invoke("get-preview-dist-dir"),
  getPatternIndex: (category, theme) => ipcRenderer.invoke("get-pattern-index", category, theme),
  getPatternFile: (category, filename, theme) => ipcRenderer.invoke("get-pattern-file", category, filename, theme),
  getPatternPreview: (category, filename, theme) => ipcRenderer.invoke("get-pattern-preview", category, filename, theme),
  getPatternAssets: (category, folderName, theme) => ipcRenderer.invoke("get-pattern-assets", category, folderName, theme),
  getDesignSystems: () => ipcRenderer.invoke("get-design-systems"),
  downloadHuiCode: (jsonData, options?: { targetLib?: string }) => ipcRenderer.invoke("download-hui-code", jsonData, options),
  runPixsoBuild: (input) => ipcRenderer.invoke("run-pixso-build", input),
  exportZip: (opts) => ipcRenderer.invoke("export-zip", opts),
  importZip: () => ipcRenderer.invoke("import-zip"),
  codeToHtml: (opts) => ipcRenderer.invoke("capture-page", opts),
  listDirectory: (path) => ipcRenderer.invoke("list-directory", path),
  // Pipeline API IPC bridge — renderer 内网调用时通过此通道请求主进程 net.fetch(绕 CORS)
  pipelineRequest: (url, method, uiplusToken, body, headers) => ipcRenderer.invoke("pipeline-request", url, method, uiplusToken, body, headers),
  // jk-j60099994-replace-with-index-1-start
  // jk-j60099994-replace-with-index-1-end
  configureProxy: (account, password) => ipcRenderer.invoke("configure-proxy", account, password),
}

contextBridge.exposeInMainWorld("api", api)
