export type AssetsConfigUser = {
  isRemember?: boolean
  designSpec?: string
  placeholder?: string
  sessionJson?: string
}

export type AssetsConfig = {
  user?: AssetsConfigUser
}

/**
 * 代码 manifest 节点（结构对齐 desktop/excode 的 manifest-builder.ts；octoapp 跨包
 * 不便直接 import excode 类型，故就地结构化声明，IPC 透传时按结构匹配）。
 * 设计平台「框选节点 → 定位产物文件」用：tree 是 src 目录树，content 是路径→文件内容。
 */
export interface ManifestNode {
  label: string
  value: string
  nodes?: string[]
  children?: ManifestNode[]
}

/** 代码 manifest：tree（src 目录树）+ content（路径→文件内容） */
export interface CodeManifest {
  tree: ManifestNode[]
  content: Record<string, string>
}

/**
 * fastui 卡片的目标(SPEC-DES-008 §3.7):工作区(= sdk.directory)+ 会话 id + 产物名。
 * 工程在哪由主进程查(先会话范围、再工作区范围),渲染进程不拼路径 —— 普通 / 代码工作区布局不同。
 */
export type FastuiTarget = { workspaceDir: string; sessionId: string; name?: string }

export type DesktopApi = {
  setTitlebar?: (theme: { mode: "light" | "dark" }) => Promise<void>
  openPath?: (path: string, app?: string) => Promise<unknown>
  /**
   * fastui 预览(SPEC-DES-004):卡片只记产物,点击时当场给地址 —— 服务活着且应答就复用,
   * 否则当场挑端口起服务。产物名缺省用于老卡片(对话里只有一个工程时才能确定)。
   */
  fastuiPreviewOpen?: (
    target: FastuiTarget,
  ) => Promise<{ ok: true; port: number; reused: boolean } | { ok: false; error: string; logTail?: string }>
  /** 「重新编译」:结束当前服务并当场重起 */
  fastuiPreviewRestart?: (
    target: FastuiTarget,
  ) => Promise<{ ok: true; port: number; reused: boolean } | { ok: false; error: string; logTail?: string }>
  /** 这个(会话, 产物名)有没有 fastui 工程 —— 导出按钮与老卡片转换的判据,与预览同一个查找函数 */
  fastuiResolve?: (target: FastuiTarget) => Promise<{ ok: true; projectDir: string; name: string } | { ok: false; error: string }>
  /** 文件属于哪个 fastui 工程(往上找工程标记,不出工作区),SPEC-DES-008 §3.8 */
  fastuiProjectOf?: (
    target: FastuiTarget & { filePath: string },
  ) => Promise<{ ok: true; name: string; projectDir: string } | { ok: false }>
  /**
   * fastui 导出代码包(SPEC-DES-001 §8.6.2):主进程调 skill 的 export-zip.mjs,
   * 打一个跳过依赖链接、带 UTF-8 文件名 flag 的干净交付包。
   */
  fastuiExportZip?: (
    target: FastuiTarget,
  ) => Promise<{ ok: true; zipPath: string; bytes: number; fileCount: number } | { ok: false; error: string }>
  showItemInFolder?: (path: string) => void
  saveFilePicker?: (opts?: { title?: string; defaultPath?: string }) => Promise<string | null>
  downloadResource?: (url: string, destPath: string) => Promise<void>
  downloadResourceToTemp?: (url: string, namespace: string, filename: string) => Promise<string>
  writeFileBuffer?: (path: string, buffer: ArrayBuffer) => Promise<void>
  readFileBuffer?: (path: string) => Promise<ArrayBuffer | null>
  /** 原子重命名（同文件系统内）。用于"写临时文件 → rename 到目标"原子落盘。 */
  renameFile?: (srcPath: string, destPath: string) => Promise<void>
  statFile?: (path: string) => Promise<{ size: number; mtimeMs: number } | null>
  listDirectory?: (path: string) => Promise<Array<{ path: string; type: 'file' | 'directory'; size?: number }>>
  copyFileTo?: (srcPath: string, destPath: string) => Promise<void>
  deleteFile?: (path: string) => Promise<void>
  fileExists?: (path: string) => Promise<boolean>
  /** 目录存在性预检:仅当路径是存在的目录时返回 true(与 fileExists 对称) */
  dirExists?: (path: string) => Promise<boolean>
  capturePreviewRect?: (rect: { x: number; y: number; width: number; height: number }) => Promise<string | null>
  getPathForFile?: (file: File) => string
  /** 拷贝源文件进 <baseDir>/.octo/tmps/（预会话落地区，撞名加后缀）；返回落地路径 */
  copyFileToWorktree?: (srcPath: string, baseDir: string, filename: string) => Promise<string>
  /** copyFileToWorktree 的字节版：剪贴板内存 blob 无源路径，把字节写进同一落点；返回落地路径 */
  writeFileToWorktree?: (buffer: ArrayBuffer, baseDir: string, filename: string) => Promise<string>
  /** 发送时把 .octo/tmps/ 里的附件 rename 进 <baseDir>/.octo/<sessionId>/uploads/ */
  movePendingUploadToSession?: (srcPath: string, baseDir: string, sessionId: string) => Promise<string>
  /** design-files 面板「上传」：把本地文件拷进 <baseDir>/.octo/<sessionId>/uploads/[<subPath>/]；返回落地绝对路径 */
  copyFileToSessionUploads?: (srcPath: string, baseDir: string, sessionId: string, subPath: string, filename: string) => Promise<string>
  /** 代码类型工作区(统一文件树)：把本地文件拷进 <baseDir>/<relDir>/（项目相对目录，空串=项目根）；返回落地绝对路径 */
  copyFileToProjectDir?: (srcPath: string, baseDir: string, relDir: string, filename: string) => Promise<string>
  /** 代码类型工作区：内存 blob 直接写进 <baseDir>/<relDir>/（同 copyFileToProjectDir 落点）；返回落地绝对路径 */
  writeFileToProjectDir?: (buffer: ArrayBuffer, baseDir: string, relDir: string, filename: string) => Promise<string>
  openLink?: (url: string) => void
  // jk-j60099994-replace-with-60062650-octoapp-make-electron-api-1-start
  // jk-j60099994-replace-with-60062650-octoapp-make-electron-api-1-end
  onDownloadSavePath?: (cb: (info: {
    url: string
    filename: string
    path: string | null
    state: "completed" | "cancelled" | "interrupted"
  }) => void) => () => void
  getAssetsConfig?: () => Promise<Record<string, unknown>>
  /** 导出 HUI 代码（经 IPC 调主进程 downloadHuiCode） */
  downloadHuiCode?: (input: { planner: Record<string, unknown>; mergedA2UI: Record<string, unknown> }[], options?: { targetLib?: string }) => Promise<{ files: { path: string; content: string }[]; manifest: CodeManifest }>
  /** 导出 ZIP 压缩包 */
  exportZip?: (opts: { defaultName: string; files?: { path: string; content: string }[]; sourceDir?: string; destFolder?: string; sourceDirs?: { dir: string; destFolder: string }[]; comment?: string }) => Promise<string | null>
  /** 获取上传资源根目录 */
  getUploadsDir?: () => Promise<string | null>
  /** 获取 previewdist 目录（A2UI 运行时：HTML/JS/CSS/字体）。
   *  开发态为 packages/previewdist，安装态为 resources/previewdist。
   *  prototype 归档用此拿真实路径列 assets 子目录，避免 symlink 导致 listDirectory 不跟随。 */
  getPreviewDistDir?: () => Promise<string>
  /** 把图片写到 prototype.html 同级 uploads 目录，返回相对 URL（uploads/<hash>.<ext>，iframe 经 local:// 解析） */
  savePrototypeImage?: (buffer: ArrayBuffer, dir: string) => Promise<string>
  // jk-j60099994-replace-with-yjt-pixso-electron-api-1-start
  // jk-j60099994-replace-with-yjt-pixso-electron-api-1-end
}

export function getDesktopApi(): DesktopApi | undefined {
  return (window as unknown as { api?: DesktopApi }).api
}

export function getArtifactFilename(filePath: string): string {
  if (!filePath) return ''
  return filePath.split(/[/\\]/).pop() || ''
}