export type DesktopApi = {
  exportZip?: (opts: {
    defaultName: string
    files?: { path: string; content: string }[]
    sourceDir?: string
    comment?: string
  }) => Promise<string | null>
  exportProjectZip?: (opts: {
    sourceDir: string
    defaultName: string
    ignore?: string[]
    injectFiles?: { path: string; content: string }[]
    copyDirs?: { from: string; to: string }[]
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
  getDesignSystems?: () => Promise<string[]>
  downloadHuiCode?: (input: { planner: Record<string, unknown>; mergedA2UI: Record<string, unknown> }[]) => Promise<{ files: { path: string; content: string }[] }>
  tailwindToCss?: (className: string) => Promise<Record<string, string>>
  // 3D workspace（Step 6）— 仅 Electron 暴露，非 Electron 环境为 undefined
  materializeWorkspace?: (templateDir: string, workspaceDir: string, componentsSrcDir: string) => Promise<{ ok: true }>
  overlayWorkspaceFiles?: (workspaceDir: string, files: { path: string; content: string }[]) => Promise<{ ok: true }>
  startWorkspaceDev?: (workspaceDir: string, port: number) => Promise<{ ok: true; url: string } | { ok: false; error: string }>
  stopWorkspaceDev?: () => Promise<{ ok: true }>
  deletePathRecursive?: (path: string) => Promise<{ ok: true }>
}

export function getDesktopApi(): DesktopApi | undefined {
  return (window as unknown as { api?: DesktopApi }).api
}
