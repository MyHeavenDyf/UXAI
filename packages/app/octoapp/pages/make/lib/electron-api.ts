export type DesktopApi = {
  setTitlebar?: (theme: { mode: "light" | "dark" }) => Promise<void>
  openPath?: (path: string, app?: string) => Promise<unknown>
  showItemInFolder?: (path: string) => void
  saveFilePicker?: (opts?: { title?: string; defaultPath?: string }) => Promise<string | null>
  downloadResource?: (url: string, destPath: string) => Promise<void>
  downloadResourceToTemp?: (url: string, namespace: string, filename: string) => Promise<string>
  writeFileBuffer?: (path: string, buffer: ArrayBuffer) => Promise<void>
  capturePreviewRect?: (rect: { x: number; y: number; width: number; height: number }) => Promise<string | null>
}

export function getDesktopApi(): DesktopApi | undefined {
  return (window as unknown as { api?: DesktopApi }).api
}