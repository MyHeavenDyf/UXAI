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

export type SkillConfigEntry = { description?: string; import?: boolean; type?: string }
export type SkillsConfig = Record<string, SkillConfigEntry>

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
  showItemInFolder: (path: string) => void
  downloadResource: (url: string, destPath: string) => Promise<void>
  downloadResourceToTemp: (url: string, namespace: string, filename: string, baseDir?: string) => Promise<string>
  readClipboardImage: () => Promise<{ buffer: ArrayBuffer; width: number; height: number } | null>
  showNotification: (title: string, body?: string) => void
  getWindowFocused: () => Promise<boolean>
  setWindowFocus: () => Promise<void>
  showWindow: () => Promise<void>
  relaunch: () => void
  getZoomFactor: () => Promise<number>
  setZoomFactor: (factor: number) => Promise<void>
  setTitlebar: (theme: TitlebarTheme) => Promise<void>
  loadingWindowComplete: () => void
  runUpdater: (alertOnFail: boolean) => Promise<void>
  checkUpdate: () => Promise<{ updateAvailable: boolean; version?: string }>
  installUpdate: () => Promise<void>
  setBackgroundColor: (color: string) => Promise<void>
  // jk-j60099994-replace-with-types-2-start
  // jk-j60099994-replace-with-types-2-end
  getSkillsConfig: () => Promise<SkillsConfig>
  setSkillsConfig: (config: SkillsConfig) => Promise<void>
  addSkill: (sourcePath: string) => Promise<{ success: boolean; skillName?: string; error?: string }>
  openSkillFolder: () => Promise<void>
  htmlToPdf: (html: string) => Promise<ArrayBuffer>
  writeFileBuffer: (path: string, buffer: ArrayBuffer) => Promise<void>
  readFileBuffer: (path: string) => Promise<ArrayBuffer | null>
  deleteFile: (path: string) => Promise<void>
  writeClipboardText: (text: string) => Promise<void>
  capturePreviewRect: (rect: { x: number; y: number; width: number; height: number }) => Promise<string | null>
  tailwindToCss: (className: string) => Promise<Record<string, string>>
  cssToTailwind: (cssObject: Record<string, unknown>) => Promise<string>
  getPreviewDistDir: () => Promise<string>
  getPatternIndex: (category: string) => Promise<Record<string, unknown> | null>
  getPatternFile: (category: string, filename: string) => Promise<string | null>
  runPixsoBuild: (input: string) => Promise<string>
  exportZip: (opts: {
    defaultName: string
    files?: { name: string; content: string }[]
    sourceDir?: string
    comment?: string
  }) => Promise<string | null>
  importZip: () => Promise<{ name: string; content: string }[] | null>
}
