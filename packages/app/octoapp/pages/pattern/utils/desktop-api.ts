export type DesktopApi = {
  exportZip?: (opts: {
    defaultName: string
    files?: { name: string; content: string }[]
    sourceDir?: string
    comment?: string
  }) => Promise<string | null>
  importZip?: () => Promise<{ name: string; content: string }[] | null>
  getPreviewDistDir?: () => Promise<string>
  writeFileBuffer?: (path: string, buffer: ArrayBuffer) => Promise<void>
  readFileBuffer?: (path: string) => Promise<ArrayBuffer | null>
  deleteFile?: (path: string) => Promise<void>
  runPixsoBuild?: (input: string) => Promise<string>
  writeClipboardText?: (text: string) => Promise<void>
  getPatternIndex?: (category: string) => Promise<Record<string, unknown> | null>
  getPatternFile?: (category: string, filename: string) => Promise<string | null>
}

export function getDesktopApi(): DesktopApi | undefined {
  return (window as unknown as { api?: DesktopApi }).api
}
