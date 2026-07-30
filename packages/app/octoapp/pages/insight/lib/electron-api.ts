// Insight 内部用的桌面端 API 类型(Electron preload 暴露的 window.api 子集)。
// 不做全局 Window.api 接口增强 — 上游 app.tsx 已声明 Window.api,
// 接口合并会因 setTitlebar 之外字段不一致而 TS2717 报错。
// 走 helper 强转的方式取 api,类型安全在 helper 内闭环。
// 真实实现见 packages/desktop/src/preload/index.ts;内网壳对接清单见 octo-agent 文档仓 docs/intranet-handoff.md §4。

export type DesktopApi = {
  setTitlebar?: (theme: { mode: "light" | "dark" }) => Promise<void>
  openPath?: (path: string, app?: string) => Promise<unknown>
  /** 在系统文件管理器中定位;文件不存在(被改名/移走)时返回 { ok: false, reason: "not-found" },约定永不 throw */
  showItemInFolder?: (path: string) => Promise<{ ok: boolean; reason?: "not-found" }>
  saveFilePicker?: (opts?: { title?: string; defaultPath?: string }) => Promise<string | null>
  downloadResource?: (url: string, destPath: string) => Promise<void>
  /** office「下载」:解析资源 URI 已落地的本地副本路径(不拉网络);命中且文件在→绝对路径,否则 null */
  resolveMaterializedPath?: (namespace: string, baseDir?: string, sessionId?: string) => Promise<string | null>
  /** office「下载」:把本地副本原样拷到用户选定路径(fs.copyFile,走复制不读+写) */
  copyFileTo?: (srcPath: string, destPath: string) => Promise<void>
  /** 覆盖写本地二进制文件(文件管理面板「下载」:saveFilePicker 选路径后落盘) */
  writeFileBuffer?: (path: string, buffer: ArrayBuffer) => Promise<void>
  downloadResourceToTemp?: (
    url: string,
    namespace: string,
    filename: string,
    baseDir?: string,
    sessionId?: string,
  ) => Promise<string>
  /** SPEC-INS-014 v2(会话隔离):拷贝源文件进 <baseDir>/.octo/tmps/(预会话落地区,撞名加后缀);返回落地路径 */
  copyFileToWorktree?: (srcPath: string, baseDir: string, filename: string) => Promise<string>
  /** SPEC-INS-014 §4.1.2(v2 新增):发送时把 .octo/tmps/ 里的附件 rename 进 <baseDir>/.octo/<sessionId>/uploads/ */
  movePendingUploadToSession?: (srcPath: string, baseDir: string, sessionId: string) => Promise<string>
  /** 取拖拽/选取 File 的真实本地路径(Electron webUtils.getPathForFile;非桌面端为 undefined) */
  getPathForFile?: (file: File) => string
  /** 覆盖写本地文本文件(markdown 编辑器自动保存;主进程校验路径白名单) */
  writeFile?: (path: string, content: string) => Promise<void>
  /** 读本地文件为二进制(uri markdown 卡读「本地工作副本」回显改动);文件不存在返回 null */
  readFileBuffer?: (path: string) => Promise<ArrayBuffer | null>
  /** 轻量存在性预检:只 stat 不读盘,仅当路径是存在的普通文件时返回 true(打开卡片前判断文件是否已被删) */
  fileExists?: (path: string) => Promise<boolean>
  /** 用系统默认浏览器打开外链(shell.openExternal);避免在 Electron webview 内导航后无法返回 */
  openLink?: (url: string) => void
  /** SPEC-INS-023:读技能 SKILL.md 正文(@技能 注入用);命中→{success:true,content},否则 {success:false,error} */
  getSkillContent?: (skillName: string) => Promise<
    | { success: true; name: string; content: string; baseDir: string; files: string }
    | { success: false; error: string }
  >
  writeClipboardText?: (text: string) => Promise<void>
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
