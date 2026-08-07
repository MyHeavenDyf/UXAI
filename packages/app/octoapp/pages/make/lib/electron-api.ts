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
  statFile?: (path: string) => Promise<{ size: number } | null>
  listDirectory?: (path: string) => Promise<Array<{ path: string; type: 'file' | 'directory'; size?: number }>>
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
}

export function getDesktopApi(): DesktopApi | undefined {
  return (window as unknown as { api?: DesktopApi }).api
}

export function getArtifactFilename(filePath: string): string {
  if (!filePath) return ''
  return filePath.split(/[/\\]/).pop() || ''
}