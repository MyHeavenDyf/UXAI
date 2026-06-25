export type DesktopApi = {
  exportZip?: (opts: {
    defaultName: string
    files: { name: string; content: string }[]
  }) => Promise<string | null>
  getPreviewDistDir?: () => Promise<string>
  writeFileBuffer?: (path: string, buffer: ArrayBuffer) => Promise<void>
  runPixsoBuild?: (input: string) => Promise<string>
  writeClipboardText?: (text: string) => Promise<void>
}

export function getDesktopApi(): DesktopApi | undefined {
  return (window as unknown as { api?: DesktopApi }).api
}
