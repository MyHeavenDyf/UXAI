// Insight 内部用的桌面端 API 类型(Electron preload 暴露的 window.api 子集)。
// 不做全局 Window.api 接口增强 — 上游 app.tsx 已声明 Window.api,
// 接口合并会因 setTitlebar 之外字段不一致而 TS2717 报错。
// 走 helper 强转的方式取 api,类型安全在 helper 内闭环。
// 真实实现见 packages/desktop-electron/src/preload/index.ts。

export type DesktopApi = {
  setTitlebar?: (theme: { mode: "light" | "dark" }) => Promise<void>
  openPath?: (path: string, app?: string) => Promise<unknown>
  showItemInFolder?: (path: string) => void
  saveFilePicker?: (opts?: { title?: string; defaultPath?: string }) => Promise<string | null>
  downloadResource?: (url: string, destPath: string) => Promise<void>
  downloadResourceToTemp?: (url: string, namespace: string, filename: string, baseDir?: string) => Promise<string>
  /** 覆盖写本地文本文件(markdown 编辑器自动保存;主进程校验路径白名单) */
  writeFile?: (path: string, content: string) => Promise<void>
  /** 读本地文件为二进制(uri markdown 卡读「本地工作副本」回显改动);文件不存在返回 null */
  readFileBuffer?: (path: string) => Promise<ArrayBuffer | null>
  /** 用系统默认浏览器打开外链(shell.openExternal);避免在 Electron webview 内导航后无法返回 */
  openLink?: (url: string) => void
  writeClipboardText?: (text: string) => Promise<void>
}

export function getDesktopApi(): DesktopApi | undefined {
  return (window as unknown as { api?: DesktopApi }).api
}
