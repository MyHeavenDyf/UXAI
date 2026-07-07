export type DesktopApi = {
  setTitlebar?: (theme: { mode: "light" | "dark" }) => Promise<void>
  openPath?: (path: string, app?: string) => Promise<unknown>
  showItemInFolder?: (path: string) => void
  saveFilePicker?: (opts?: { title?: string; defaultPath?: string }) => Promise<string | null>
  downloadResource?: (url: string, destPath: string) => Promise<void>
  downloadResourceToTemp?: (url: string, namespace: string, filename: string) => Promise<string>
  writeFileBuffer?: (path: string, buffer: ArrayBuffer) => Promise<void>
  readFileBuffer?: (path: string) => Promise<ArrayBuffer | null>
  capturePreviewRect?: (rect: { x: number; y: number; width: number; height: number }) => Promise<string | null>
  /** 下载完成后的保存路径回调(主进程仅观察默认保存对话框的结果) */
  onDownloadSavePath?: (cb: (info: {
    url: string
    filename: string
    path: string | null
    state: "completed" | "cancelled" | "interrupted"
  }) => void) => () => void
}

export function getDesktopApi(): DesktopApi | undefined {
  return (window as unknown as { api?: DesktopApi }).api
}