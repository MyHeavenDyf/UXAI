export type AssetsConfigUser = {
  isRemember?: boolean
  designSpec?: string
  placeholder?: string
  sessionJson?: string
}

export type AssetsConfig = {
  user?: AssetsConfigUser
}

export type DesktopApi = {
  setTitlebar?: (theme: { mode: "light" | "dark" }) => Promise<void>
  openPath?: (path: string, app?: string) => Promise<unknown>
  showItemInFolder?: (path: string) => void
  saveFilePicker?: (opts?: { title?: string; defaultPath?: string }) => Promise<string | null>
  downloadResource?: (url: string, destPath: string) => Promise<void>
  downloadResourceToTemp?: (url: string, namespace: string, filename: string) => Promise<string>
  writeFileBuffer?: (path: string, buffer: ArrayBuffer) => Promise<void>
  readFileBuffer?: (path: string) => Promise<ArrayBuffer | null>
  /** 原子重命名（同文件系统内）。用于"写临时文件 → rename 到目标"原子落盘。 */
  renameFile?: (srcPath: string, destPath: string) => Promise<void>
  statFile?: (path: string) => Promise<{ size: number } | null>
  listDirectory?: (path: string) => Promise<Array<{ path: string; type: 'file' | 'directory'; size?: number }>>
  copyFileTo?: (srcPath: string, destPath: string) => Promise<void>
  deleteFile?: (path: string) => Promise<void>
  fileExists?: (path: string) => Promise<boolean>
  capturePreviewRect?: (rect: { x: number; y: number; width: number; height: number }) => Promise<string | null>
  getPathForFile?: (file: File) => string
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
  downloadHuiCode?: (input: { planner: Record<string, unknown>; mergedA2UI: Record<string, unknown> }[], options?: { targetLib?: string }) => Promise<{ files: { path: string; content: string }[] }>
  /** 导出 ZIP 压缩包 */
  exportZip?: (opts: { defaultName: string; files?: { path: string; content: string }[]; sourceDir?: string; destFolder?: string; sourceDirs?: { dir: string; destFolder: string }[]; comment?: string }) => Promise<string | null>
  /** 获取上传资源根目录 */
  getUploadsDir?: () => Promise<string | null>
  /** 把图片写到 prototype.html 同级 uploads 目录，返回相对 URL（uploads/<hash>.<ext>，iframe 经 local:// 解析） */
  savePrototypeImage?: (buffer: ArrayBuffer, dir: string) => Promise<string>
}

export function getDesktopApi(): DesktopApi | undefined {
  return (window as unknown as { api?: DesktopApi }).api
}

export function getArtifactFilename(filePath: string): string {
  if (!filePath) return ''
  return filePath.split(/[/\\]/).pop() || ''
}