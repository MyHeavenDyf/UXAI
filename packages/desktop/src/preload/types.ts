export type InitStep = { phase: "server_waiting" } | { phase: "sqlite_waiting" } | { phase: "done" }

export type ServerReadyData = {
  url: string
  username: string | null
  password: string | null
}

export type SqliteMigrationProgress = { type: "InProgress"; value: number } | { type: "Done" }

export type WslConfig = { enabled: boolean }
// jk-j60099994-replace-with-types-1-start
// jk-j60099994-replace-with-types-1-end
export type LinuxDisplayBackend = "wayland" | "auto"
export type TitlebarTheme = {
  mode: "light" | "dark"
}

export type WindowConfig = {
  updaterEnabled: boolean
}

export type DownloadSavePathInfo = {
  url: string
  filename: string
  path: string | null
  state: "completed" | "cancelled" | "interrupted"
}

// jk-j60099994-replace-with-60062650-preload-types-1-start
export type SkillConfigEntry = { description?: string; import?: boolean; type?: string }
// jk-j60099994-replace-with-60062650-preload-types-1-end
export type SkillsConfig = Record<string, SkillConfigEntry>

export type SkillConfig = {
  skill?: Record<string, SkillConfigEntry>
  agent?: Record<string, string[]>
}

export type SkillContentResponse =
  | { success: true; name: string; content: string; baseDir: string; files: string }
  | { success: false; error: string }

export type ElectronAPI = {
  killSidecar: () => Promise<void>
  installCli: () => Promise<string>
  awaitInitialization: (onStep: (step: InitStep) => void) => Promise<ServerReadyData>
  getWindowConfig: () => Promise<WindowConfig>
  consumeInitialDeepLinks: () => Promise<string[]>
  getDefaultServerUrl: () => Promise<string | null>
  setDefaultServerUrl: (url: string | null) => Promise<void>
  getWslConfig: () => Promise<WslConfig>
  setWslConfig: (config: WslConfig) => Promise<void>
  getDisplayBackend: () => Promise<LinuxDisplayBackend | null>
  setDisplayBackend: (backend: LinuxDisplayBackend | null) => Promise<void>
  parseMarkdownCommand: (markdown: string) => Promise<string>
  checkAppExists: (appName: string) => Promise<boolean>
  wslPath: (path: string, mode: "windows" | "linux" | null) => Promise<string>
  resolveAppPath: (appName: string) => Promise<string | null>
  storeGet: (name: string, key: string) => Promise<string | null>
  storeSet: (name: string, key: string, value: string) => Promise<void>
  storeDelete: (name: string, key: string) => Promise<void>
  storeClear: (name: string) => Promise<void>
  storeKeys: (name: string) => Promise<string[]>
  storeLength: (name: string) => Promise<number>

  getWindowCount: () => Promise<number>
  onSqliteMigrationProgress: (cb: (progress: SqliteMigrationProgress) => void) => () => void
  onMenuCommand: (cb: (id: string) => void) => () => void
  onDeepLink: (cb: (urls: string[]) => void) => () => void
  /** 下载完成后的保存路径回调(主进程仅观察默认保存对话框的结果) */
  onDownloadSavePath: (cb: (info: DownloadSavePathInfo) => void) => () => void

  openDirectoryPicker: (opts?: {
    multiple?: boolean
    title?: string
    defaultPath?: string
  }) => Promise<string | string[] | null>
  openFilePicker: (opts?: {
    multiple?: boolean
    title?: string
    defaultPath?: string
    accept?: string[]
    extensions?: string[]
  }) => Promise<string | string[] | null>
  saveFilePicker: (opts?: { title?: string; defaultPath?: string }) => Promise<string | null>
  openLink: (url: string) => void
  openPath: (path: string, app?: string) => Promise<void>
  /** 在系统文件管理器中定位;文件不存在时返回 { ok: false, reason: "not-found" } 而非 throw */
  showItemInFolder: (path: string) => Promise<{ ok: boolean; reason?: "not-found" }>
  downloadResource: (url: string, destPath: string) => Promise<void>
  /** office「下载」:解析资源 URI 已落地的本地副本路径(不拉网络);命中且文件在→绝对路径,否则 null */
  resolveMaterializedPath: (namespace: string, baseDir?: string, sessionId?: string) => Promise<string | null>
  /** office「下载」:把本地副本原样拷到用户选定路径(fs.copyFile,走复制不读+写) */
  copyFileTo: (srcPath: string, destPath: string) => Promise<void>
  downloadResourceToTemp: (
    url: string,
    namespace: string,
    filename: string,
    baseDir?: string,
    sessionId?: string,
  ) => Promise<string>
  /** SPEC-INS-014 v2(会话隔离):拷贝源文件进 <baseDir>/.octo/tmps/(预会话落地区,撞名加后缀);返回落地路径 */
  copyFileToWorktree: (srcPath: string, baseDir: string, filename: string) => Promise<string>
  /** SPEC-INS-014 §4.1.2(v2 新增):发送时把 .octo/tmps/ 里的附件 rename 进 <baseDir>/.octo/<sessionId>/uploads/ */
  movePendingUploadToSession: (srcPath: string, baseDir: string, sessionId: string) => Promise<string>
  /** Electron 32+ 取拖拽/选取 File 的真实本地路径(File.path 已移除,改用 webUtils.getPathForFile) */
  getPathForFile: (file: File) => string
  readClipboardImage: () => Promise<{ buffer: ArrayBuffer; width: number; height: number } | null>
  showNotification: (title: string, body?: string) => void
  getWindowFocused: () => Promise<boolean>
  setWindowFocus: () => Promise<void>
  showWindow: () => Promise<void>
  relaunch: () => void
  getZoomFactor: () => Promise<number>
  setZoomFactor: (factor: number) => Promise<void>
  setTitlebar: (theme: TitlebarTheme) => Promise<void>
  setTitlebarOverlayHidden: (hidden: boolean) => Promise<void>
  loadingWindowComplete: () => void
  runUpdater: (alertOnFail: boolean) => Promise<void>
  checkUpdate: () => Promise<{ updateAvailable: boolean; version?: string }>
  installUpdate: () => Promise<void>
  setBackgroundColor: (color: string) => Promise<void>
  // jk-j60099994-replace-with-types-2-start
  // jk-j60099994-replace-with-types-2-end
  getSkillsConfig: () => Promise<SkillsConfig>
  setSkillsConfig: (config: SkillsConfig) => Promise<void>
  getSkillConfig: () => Promise<SkillConfig>
  getSkillContent: (skillName: string) => Promise<SkillContentResponse>
  addSkill: (sourcePath: string) => Promise<{ success: boolean; skillName?: string; error?: string }>
  ensureSkillConfig: () => Promise<void>
  openSkillFolder: () => Promise<void>
  // jk-j60099994-replace-with-60062650-preload-types-2-start
  // jk-j60099994-replace-with-60062650-preload-types-2-end
  htmlToPdf: (html: string) => Promise<ArrayBuffer>
  writeFileBuffer: (path: string, buffer: ArrayBuffer) => Promise<void>
  /** save image to uploads dir, returns URL path like /history/sessionId/uploads/hash.ext */
  saveUploadImage: (buffer: ArrayBuffer, sessionId: string) => Promise<string>
  getUploadsDir: () => Promise<string | null>
  setUploadsDir: (dir: string) => Promise<void>
  /** insight markdown 编辑器自动保存:覆盖写本地文本文件(主进程校验路径在 .octo/<sessionId>/{uploads,outputs}、旧 .octo/downloads 或临时目录下) */
  writeFile: (path: string, content: string) => Promise<void>
  readFileBuffer: (path: string) => Promise<ArrayBuffer | null>
  /** 轻量存在性预检：只 stat 不读盘，仅当路径是存在的普通文件时返回 true(不存在/目录/无权限均为 false) */
  fileExists: (path: string) => Promise<boolean>
  deleteFile: (path: string) => Promise<void>
  writeClipboardText: (text: string) => Promise<void>
  capturePreviewRect: (rect: { x: number; y: number; width: number; height: number }) => Promise<string | null>
  capturePreviewPage: (opts: { pageJson: unknown; waitForMs?: number }) => Promise<string | null>
  tailwindToCss: (className: string) => Promise<Record<string, string>>
  cssToTailwind: (cssObject: Record<string, unknown>) => Promise<string>
  getPreviewDistDir: () => Promise<string>
  getPatternIndex: (category: string, theme?: string) => Promise<Record<string, unknown> | null>
  getPatternFile: (category: string, filename: string, theme?: string) => Promise<string | null>
  getPatternPreview: (category: string, filename: string, theme?: string) => Promise<string | null>
  getPatternAssets: (category: string, folderName: string, theme?: string) => Promise<{ filename: string; buffer: ArrayBuffer }[]>
  getDesignSystems: () => Promise<string[]>
  downloadHuiCode: (input: { planner: Record<string, unknown>; mergedA2UI: Record<string, unknown> }[], options?: { targetLib?: string }) => Promise<{ files: { path: string; content: string }[] }>
  runPixsoBuild: (input: string) => Promise<string>
  exportZip: (opts: { defaultName: string; files?: { path: string; content: string }[]; sourceDir?: string; destFolder?: string; comment?: string }) => Promise<string | null>
  importZip: () => Promise<{ name: string; content: string }[] | null>
  codeToHtml: (opts: { url: string; theme?: "light" | "dark"; waitForMs?: number }) => Promise<{ html: string; resourceCount: number }>
  listDirectory: (path: string) => Promise<Array<{ path: string; type: 'file' | 'directory'; size?: number }>>
  // Pipeline API IPC bridge 类型定义
  pipelineRequest: (url: string, method: string, uiplusToken: string, body?: any, headers?: Record<string, string>) => Promise<any>

  /** 配置 W3 代理: 测试连通性后写入 ~/.config/octo/octo.json */
  configureProxy: (account: string, password: string) => Promise<{
    success: boolean
    curlUrl: string
    error?: string
  }>
}
