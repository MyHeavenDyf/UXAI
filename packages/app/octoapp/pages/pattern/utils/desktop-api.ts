export type DesktopApi = {
  exportZip?: (opts: {
    defaultName: string
    files?: { path: string; content: string }[]
    sourceDir?: string
    destFolder?: string
    comment?: string
  }) => Promise<string | null>
  importZip?: () => Promise<{ name: string; content: string }[] | null>
  getPreviewDistDir?: () => Promise<string>
  writeFileBuffer?: (path: string, buffer: ArrayBuffer) => Promise<void>
  readFileBuffer?: (path: string) => Promise<ArrayBuffer | null>
  listDirectory?: (path: string) => Promise<Array<{ path: string; type: 'file' | 'directory'; size?: number }>>
  deleteFile?: (path: string) => Promise<void>
  runPixsoBuild?: (input: string) => Promise<string>
  writeClipboardText?: (text: string) => Promise<void>
  getPatternIndex?: (category: string, theme?: string) => Promise<Record<string, unknown> | null>
  getPatternFile?: (category: string, filename: string, theme?: string) => Promise<string | null>
  getPatternPreview?: (category: string, filename: string, theme?: string) => Promise<string | null>
  getPatternAssets?: (category: string, folderName: string, theme?: string) => Promise<{ filename: string; buffer: ArrayBuffer }[]>
  saveUploadImage?: (buffer: ArrayBuffer, sessionId: string) => Promise<string>
  getUploadsDir?: () => Promise<string | null>
  getDesignSystems?: () => Promise<string[]>
  downloadHuiCode?: (input: { planner: Record<string, unknown>; mergedA2UI: Record<string, unknown> }[], options?: { targetLib?: string }) => Promise<{ files: { path: string; content: string }[] }>
  tailwindToCss?: (className: string) => Promise<Record<string, string>>
  saveFilePicker?: (opts?: { title?: string; defaultPath?: string }) => Promise<string | null>
  openLink?: (url: string) => void
  codeToHtml?: (opts: { url: string; theme?: "light" | "dark"; waitForMs?: number }) => Promise<{ html: string; resourceCount: number }>
  capturePreviewPage?: (opts: { pageJson: unknown; waitForMs?: number }) => Promise<string | null>
}

export function getDesktopApi(): DesktopApi | undefined {
  return (window as unknown as { api?: DesktopApi }).api
}
