import { execFile, execSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync, readdirSync, statSync, globSync, createWriteStream } from "node:fs"
// lstat 用 fs/promises 版(异步,handler 本就 async):避免把 lstatSync 加到上面那条被 jk 标记
// 包裹的 fs import 行上 —— 内网合并时该行常冲突,曾把我们加的 lstatSync 吃掉致 ReferenceError。
import { mkdir, readFile, writeFile, lstat, stat, unlink, rm, copyFile, rename } from "node:fs/promises"
import { dirname, extname, join, basename, resolve as resolvePath, sep } from "node:path"
import { homedir, tmpdir } from "node:os"
import { pathToFileURL } from "node:url"
import archiver from "archiver"
import { BrowserWindow, Notification, app, clipboard, dialog, ipcMain, shell, net } from "electron"
import type { IpcMainEvent, IpcMainInvokeEvent } from "electron"
import log from "electron-log/main.js"

// jk-j60099994-replace-with-60062650-main-skills-ipc-1-start
// jk-j60099994-replace-with-60062650-main-skills-ipc-1-end

// jk-j60099994-replace-with-ipc-1-start
// jk-j60099994-replace-with-ipc-1-end

app.commandLine.appendSwitch("ignore-certificate-errors")
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"


import type {
  InitStep,
  ServerReadyData,
  SqliteMigrationProgress,
  TitlebarTheme,
  WindowConfig,
  WslConfig,
} from "../preload/types"
import { getStore } from "./store"
import { setTitlebar, setTitlebarOverlayHidden, updateTitlebar } from "./windows"
import { downloadHuiCode, type HuiCodeInput } from "../excode/index"
import { convertTailwindToCSS } from "./tailwind-to-css"
import { convertCssToTailwind } from "./tailwind-from-css"
import { previewDistDir, getUploadsDir, setUploadsDir } from "./preview-server"
import { pipelineRequest } from "../network/pipelineRequest"
import { codeToHtml } from "./page-capture"
import { landingName } from "./landing-name"

const pickerFilters = (ext?: string[]) => {
  if (!ext || ext.length === 0) return undefined
  return [{ name: "Files", extensions: ext }]
}

// 判断图片类型
function detectImageExt(buf: Buffer): string {
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return "png"
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return "jpg"
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "gif"
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return "webp"
  if (buf[0] === 0x42 && buf[1] === 0x4D) return "bmp"
  const head = buf.slice(0, 5).toString("utf-8").toLowerCase()
  if (head.startsWith("<svg") || head.startsWith("<?xml")) return "svg"
  return "png"
}

// ── SPEC-INS-014 Insight 本地工作目录布局(worktree)共享工具 ────────────────
// uploads(附件拷贝,v2 由 sources 改名)与 outputs(产物落地)用同一套文件名规则:landingName + 撞名加后缀。
// v2(会话隔离):outputs 从一开始按 <sessionId> 分桶;uploads 分两段——
//   预会话落地区 .octo/tmps/(扁平,不属于任何会话)→ 发送时 rename 进 .octo/<sessionId>/uploads/。
// (全局约定:所有本地落点收进 .octo 根,不再有 agent 命名层——会话归属哪个 agent 可由 sessionId 反查。)
// spec docs/specs/infra/insight-worktree-layout.md §2-4。

// 文件名规则见 ./landing-name.ts(SPEC-INS-026 §4.1 唯一清洗入口)。旧的 sanitizeWorktreeName
// (空格/括号→`_`、主名截 100)已废除:那条约束源自「文件名随 basename 进 S3 URL」,而文件名已退出 URL。

// 撞名加后缀(spec §3.3):目标已存在就 `name (2).ext`(操作系统下载器习惯),不覆盖。
function collisionFreePath(dir: string, filename: string): string {
  if (!existsSync(join(dir, filename))) return join(dir, filename)
  const dot = filename.lastIndexOf(".")
  const stem = dot > 0 ? filename.slice(0, dot) : filename
  const ext = dot > 0 ? filename.slice(dot) : ""
  let n = 2
  while (existsSync(join(dir, `${stem} (${n})${ext}`))) n++
  return join(dir, `${stem} (${n})${ext}`)
}

// 首次写入时确保目录存在,并在「这次才创建」时打 ensure-dir(spec §6)。
async function ensureWorktreeDir(dir: string): Promise<void> {
  const created = !existsSync(dir)
  await mkdir(dir, { recursive: true })
  if (created) console.log("[octo:worktree] ensure-dir", { dir, created: true })
}

// 会话目录名清洗(v2 会话隔离新增):纯 allow-list([A-Za-z0-9_-]),session id 来自路由参数,
// 渲染进程不是安全边界 —— 防御性拒绝路径穿越(.. / 分隔符)。spec §3.1。
function sanitizeSessionSegment(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_-]/g, "_")
  return cleaned || "session"
}

// write-file 白名单用(v2 会话隔离新增):判断路径是否落在 .octo/<sessionId>/{uploads,outputs} 下。
// sessionId 段可变,不能用固定子串匹配,按路径分段比对—— .octo 之后第一段是会话段、第二段必须是
// uploads/outputs(这样 .octo/<sessionId>/comments/... 等其它命名空间的第二段不是 uploads/outputs,天然不放行)。
function isInsightSessionWorktreePath(resolved: string): boolean {
  const segs = resolved.split(sep)
  const i = segs.lastIndexOf(".octo")
  return i !== -1 && i + 2 < segs.length && (segs[i + 2] === "uploads" || segs[i + 2] === "outputs")
}

// 网络错误可读化:fetch 把真实原因(DNS / TLS / 代理 / 连接被拒)藏在 error.cause 链里,
// IPC 序列化只保留顶层 message("fetch failed")——展开整条 cause 链拼进 message,
// 让渲染端错误提示与 main.log 都能看到可定位的原因,而不是四个字母查到死。
function describeNetworkError(err: unknown): string {
  const parts: string[] = []
  for (let cur: unknown = err; cur instanceof Error; cur = cur.cause) parts.push(cur.message)
  return parts.length > 0 ? parts.join(" ← ") : String(err)
}

// 产物落地幂等(spec §2/§4.2):幂等键 = **资源 URI(namespace)**——同一资源被多张卡引用、
// 或跨重启重开旧会话再触发 eager 落盘时,都复用首次落地的那一份(含用户改动),绝不 re-fetch/覆盖。
// **必须按 URI 记身份、不能按文件名**:文件名 ≠ 身份,两个不同 URI 都叫 report.md 不能 alias 成同一份
// (故撞名仍走 collisionFreePath 各留一份)。
//
// 幂等落在**磁盘持久清单** .octo/<sessionId>/outputs/.materialized.json(dotfile,服务端 listFiles 过滤,
// 不进文件管理;随会话目录生命周期,天然活过重启/重装)——这是修 #90 的关键:旧实现只有下面的进程内
// Map、跨重启即清空,重开旧会话查不到 → 撞名重落 `xxx (2)`,每装一次多一份。
// (业界同款:npm cacache / pip / MCP 缓存代理都用「跨重启存活的 逻辑键→已落地条目 清单」。)
//
// 下面这张内存 Map 仅作进程内快路径(免每次 materialize 读一次 JSON),键 = `${outputsDir}::${URI}`
// ——**带 outputsDir 前缀**是必须的:Map 是模块级跨会话共享,只按 URI 记会让同一 URI 在会话 A/B 间串场
// (B 命中 A 的落点)。带 dir 后它与「本会话持久清单」答案一致,纯缓存、无跨会话 alias。
const materializedByNamespace = new Map<string, string>()

const MATERIALIZED_MANIFEST = ".materialized.json"
type MaterializedEntry = { file: string; fetchedAt: number }

// 读某会话 outputs 的持久幂等清单(URI → {落地文件名, 时间})。缺文件/坏 JSON → 空表(退化为重新落盘)。
function readMaterializedManifest(outputsDir: string): Record<string, MaterializedEntry> {
  try {
    const parsed = JSON.parse(readFileSync(join(outputsDir, MATERIALIZED_MANIFEST), "utf-8"))
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, MaterializedEntry>) : {}
  } catch {
    return {}
  }
}

// 记一条 URI→文件名 到清单(读改写)。失败仅告警:内存 Map 仍在,只是这次跨重启幂等失效,不阻断落盘。
function recordMaterialized(outputsDir: string, namespace: string, file: string): void {
  try {
    const map = readMaterializedManifest(outputsDir)
    map[namespace] = { file, fetchedAt: Date.now() }
    writeFileSync(join(outputsDir, MATERIALIZED_MANIFEST), JSON.stringify(map, null, 2), "utf-8")
  } catch (err) {
    log.warn("[octo:worktree] materialize-manifest write failed", { outputsDir, err })
  }
}

type Deps = {
  killSidecar: () => Promise<void> | void
  awaitInitialization: (sendStep: (step: InitStep) => void) => Promise<ServerReadyData>
  getWindowConfig: () => Promise<WindowConfig> | WindowConfig
  consumeInitialDeepLinks: () => Promise<string[]> | string[]
  getDefaultServerUrl: () => Promise<string | null> | string | null
  setDefaultServerUrl: (url: string | null) => Promise<void> | void
  getWslConfig: () => Promise<WslConfig>
  setWslConfig: (config: WslConfig) => Promise<void> | void
  getDisplayBackend: () => Promise<string | null>
  setDisplayBackend: (backend: string | null) => Promise<void> | void
  parseMarkdown: (markdown: string) => Promise<string> | string
  checkAppExists: (appName: string) => Promise<boolean> | boolean
  wslPath: (path: string, mode: "windows" | "linux" | null) => Promise<string>
  resolveAppPath: (appName: string) => Promise<string | null>
  loadingWindowComplete: () => void
  runUpdater: (alertOnFail: boolean) => Promise<void> | void
  checkUpdate: () => Promise<{ updateAvailable: boolean; version?: string }>
  installUpdate: () => Promise<void> | void
  setBackgroundColor: (color: string) => void
  // jk-j60099994-replace-with-ipc-2-start
  // jk-j60099994-replace-with-ipc-2-end
  // jk-j60099994-replace-with-60062650-main-skills-ipc-6-start
  // jk-j60099994-replace-with-60062650-main-skills-ipc-6-end
}

function addZipComment(zipPath: string, comment: string) {
  const buf = readFileSync(zipPath)
  const eocdSig = Buffer.from([0x50, 0x4b, 0x05, 0x06])
  const eocdOffset = buf.lastIndexOf(eocdSig)
  if (eocdOffset === -1) return

  const eocd = Buffer.from(buf.subarray(eocdOffset, eocdOffset + 22))
  const commentBuf = Buffer.from(comment, "utf-8")
  eocd.writeUInt16LE(commentBuf.length, 20)

  writeFileSync(zipPath, Buffer.concat([buf.subarray(0, eocdOffset), eocd, commentBuf]))
}

function readZipComment(zipPath: string): string {
  const buf = readFileSync(zipPath)
  const eocdSig = Buffer.from([0x50, 0x4b, 0x05, 0x06])
  const eocdOffset = buf.lastIndexOf(eocdSig)
  if (eocdOffset === -1) return ""
  const commentLen = buf.readUInt16LE(eocdOffset + 20)
  if (commentLen === 0) return ""
  return buf.subarray(eocdOffset + 22, eocdOffset + 22 + commentLen).toString("utf-8")
}

export function registerIpcHandlers(deps: Deps) {
  ipcMain.handle("kill-sidecar", () => deps.killSidecar())
  ipcMain.handle("await-initialization", (event: IpcMainInvokeEvent) => {
    const send = (step: InitStep) => event.sender.send("init-step", step)
    return deps.awaitInitialization(send)
  })
  ipcMain.handle("get-window-config", () => deps.getWindowConfig())
  ipcMain.handle("consume-initial-deep-links", () => deps.consumeInitialDeepLinks())
  ipcMain.handle("get-default-server-url", () => deps.getDefaultServerUrl())
  ipcMain.handle("set-default-server-url", (_event: IpcMainInvokeEvent, url: string | null) =>
    deps.setDefaultServerUrl(url),
  )
  ipcMain.handle("get-wsl-config", () => deps.getWslConfig())
  ipcMain.handle("set-wsl-config", (_event: IpcMainInvokeEvent, config: WslConfig) => deps.setWslConfig(config))
  ipcMain.handle("get-display-backend", () => deps.getDisplayBackend())
  ipcMain.handle("set-display-backend", (_event: IpcMainInvokeEvent, backend: string | null) =>
    deps.setDisplayBackend(backend),
  )
  ipcMain.handle("parse-markdown", (_event: IpcMainInvokeEvent, markdown: string) => deps.parseMarkdown(markdown))
  ipcMain.handle("check-app-exists", (_event: IpcMainInvokeEvent, appName: string) => deps.checkAppExists(appName))
  ipcMain.handle("wsl-path", (_event: IpcMainInvokeEvent, path: string, mode: "windows" | "linux" | null) =>
    deps.wslPath(path, mode),
  )
  ipcMain.handle("resolve-app-path", (_event: IpcMainInvokeEvent, appName: string) => deps.resolveAppPath(appName))
  ipcMain.on("loading-window-complete", () => deps.loadingWindowComplete())
  ipcMain.handle("run-updater", (_event: IpcMainInvokeEvent, alertOnFail: boolean) => deps.runUpdater(alertOnFail))
  ipcMain.handle("check-update", () => deps.checkUpdate())
  ipcMain.handle("install-update", () => deps.installUpdate())
  ipcMain.handle("set-background-color", (_event: IpcMainInvokeEvent, color: string) => deps.setBackgroundColor(color))
  // jk-j60099994-replace-with-ipc-3-start
  // jk-j60099994-replace-with-ipc-3-end
  ipcMain.handle("store-get", (_event: IpcMainInvokeEvent, name: string, key: string) => {
    try {
      const store = getStore(name)
      const value = store.get(key)
      if (value === undefined || value === null) return null
      return typeof value === "string" ? value : JSON.stringify(value)
    } catch {
      return null
    }
  })
  ipcMain.handle("store-set", (_event: IpcMainInvokeEvent, name: string, key: string, value: string) => {
    getStore(name).set(key, value)
  })
  ipcMain.handle("store-delete", (_event: IpcMainInvokeEvent, name: string, key: string) => {
    getStore(name).delete(key)
  })
  ipcMain.handle("store-clear", (_event: IpcMainInvokeEvent, name: string) => {
    getStore(name).clear()
  })
  ipcMain.handle("store-keys", (_event: IpcMainInvokeEvent, name: string) => {
    const store = getStore(name)
    return Object.keys(store.store)
  })
  ipcMain.handle("store-length", (_event: IpcMainInvokeEvent, name: string) => {
    const store = getStore(name)
    return Object.keys(store.store).length
  })

  ipcMain.handle(
    "open-directory-picker",
    async (_event: IpcMainInvokeEvent, opts?: { multiple?: boolean; title?: string; defaultPath?: string }) => {
      const result = await dialog.showOpenDialog({
        properties: ["openDirectory", ...(opts?.multiple ? ["multiSelections" as const] : []), "createDirectory"],
        title: opts?.title ?? "Choose a folder",
        defaultPath: opts?.defaultPath,
      })
      if (result.canceled) return null
      return opts?.multiple ? result.filePaths : result.filePaths[0]
    },
  )

  ipcMain.handle(
    "open-file-picker",
    async (
      _event: IpcMainInvokeEvent,
      opts?: { multiple?: boolean; title?: string; defaultPath?: string; accept?: string[]; extensions?: string[] },
    ) => {
      const result = await dialog.showOpenDialog({
        properties: ["openFile", ...(opts?.multiple ? ["multiSelections" as const] : [])],
        title: opts?.title ?? "Choose a file",
        defaultPath: opts?.defaultPath,
        filters: pickerFilters(opts?.extensions),
      })
      if (result.canceled) return null
      return opts?.multiple ? result.filePaths : result.filePaths[0]
    },
  )

  ipcMain.handle(
    "save-file-picker",
    async (event: IpcMainInvokeEvent, opts?: { title?: string; defaultPath?: string }) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const dialogOpts = {
        title: opts?.title ?? "Save file",
        defaultPath: opts?.defaultPath,
      }
      const result = await (win ? dialog.showSaveDialog(win, dialogOpts) : dialog.showSaveDialog(dialogOpts))
      if (result.canceled) return null
      return result.filePath ?? null
    },
  )

  ipcMain.on("open-link", (_event: IpcMainEvent, url: string) => {
    void shell.openExternal(url)
  })

  ipcMain.handle("open-path", async (_event: IpcMainInvokeEvent, path: string, app?: string) => {
    if (!app) return shell.openPath(path)
    await new Promise<void>((resolve, reject) => {
      const [cmd, args] =
        process.platform === "darwin" ? (["open", ["-a", app, path]] as const) : ([app, [path]] as const)
      execFile(cmd, args, (err) => (err ? reject(err) : resolve()))
    })
  })

  // shell.showItemInFolder 返回 void,路径不存在时静默 no-op —— 用户从磁盘改名/移走文件后
  // 点「打开所在文件夹」会毫无反应。故这里先探路径再定位,把结果回传给渲染端。
  // 约定为「返回结果对象、永不 throw」(与 open-path 透传 shell.openPath 错误串同源):
  // 老调用方不 await 也拿不到 rejected promise,不会退化成 unhandled rejection。
  ipcMain.handle(
    "show-item-in-folder",
    async (_event: IpcMainInvokeEvent, path: string): Promise<{ ok: boolean; reason?: "not-found" }> => {
      try {
        await lstat(path)
      } catch {
        log.warn("[octo:path] show-item-in-folder target missing", { path })
        return { ok: false, reason: "not-found" }
      }
      shell.showItemInFolder(path)
      return { ok: true }
    },
  )

  ipcMain.handle("download-resource", async (_event: IpcMainInvokeEvent, url: string, destPath: string) => {
    // net.fetch 走 Chromium 网络栈(系统代理/PAC、系统证书),与渲染端/浏览器行为一致;
    // Node/undici fetch 只认启动时的环境变量代理,内网"浏览器可达、直连不通"的机器上必挂。
    const res = await net.fetch(url).catch((err: unknown) => {
      const reason = describeNetworkError(err)
      log.error("[octo:worktree] download-resource failed", { url, reason })
      throw new Error(`下载失败: ${reason} (${url})`)
    })
    if (!res.ok) {
      log.error("[octo:worktree] download-resource failed", { url, status: res.status, statusText: res.statusText })
      throw new Error(`下载失败: HTTP ${res.status} ${res.statusText} (${url})`)
    }
    const buf = Buffer.from(await res.arrayBuffer())
    await mkdir(dirname(destPath), { recursive: true })
    await writeFile(destPath, buf)
  })

  // office「下载」按钮(§下载走本地拷贝):解析某资源 URI 已落地的本地副本路径,**不拉网络**。
  // 命中(内存 Map 快路径 / 磁盘持久清单)且文件仍在 → 返回绝对路径;否则返回 null(调用方兜底 web 下载)。
  // 查找口径与 download-resource-to-temp 一致(键=资源 URI + outputsDir),只是去掉 fetch 分支。
  ipcMain.handle(
    "resolve-materialized-path",
    async (_event: IpcMainInvokeEvent, namespace: string, baseDir?: string, sessionId?: string) => {
      const persistent = !!(baseDir && baseDir.length > 0 && sessionId && sessionId.length > 0)
      const dir = persistent
        ? join(baseDir!, ".octo", sanitizeSessionSegment(sessionId!), "outputs")
        : join(app.getPath("temp"), "octo")
      const cacheKey = `${dir}::${namespace}`
      const cached = materializedByNamespace.get(cacheKey)
      if (cached && existsSync(cached)) return cached
      if (persistent) {
        const entry = readMaterializedManifest(dir)[namespace]
        if (entry?.file) {
          const abs = join(dir, entry.file)
          if (existsSync(abs)) {
            materializedByNamespace.set(cacheKey, abs) // 回填快路径
            return abs
          }
        }
      }
      return null
    },
  )

  // office「下载」按钮:把**已落地的本地副本**原样拷到用户选定的目标路径。走 fs.copyFile 磁盘级拷贝
  // (二进制原样、不读进内存再写),而非 readFileBuffer + writeFileBuffer 的「读+写」。与 download-resource
  // (走网络拉 S3)互补:调用方优先 resolve-materialized-path + 本拷贝,本地副本不存在时才兜底 download-resource。
  ipcMain.handle("copy-file-to", async (_event: IpcMainInvokeEvent, srcPath: string, destPath: string) => {
    await mkdir(dirname(destPath), { recursive: true })
    await copyFile(srcPath, destPath)
  })

  // SPEC-INS-014 §4.1:把用户选的源文件**拷贝**进 worktree 预会话落地区(<baseDir>/.octo/tmps/)。
  // 对本地路径而言这不是上传,是磁盘流式拷贝(100MB 也无压力);原样拷贝、绝不转格式。
  // S3 上传是另一件只为 MCP 服务的事(走 lib/upload.ts,发预置时 lazy 触发),与本拷贝解耦。
  // v2:没有 sessionId 时也落这里(§4.1.2 预会话落地区);发送时由 move-pending-upload-to-session 挪进真会话。
  ipcMain.handle(
    "copy-file-to-worktree",
    async (_event: IpcMainInvokeEvent, srcPath: string, baseDir: string, filename: string) => {
      // 布局 SOT = SPEC-INS-014 §2。`.octo`/`tmps` 与渲染端判据
      // (packages/app/octoapp/pages/insight/utils/worktree-layout.ts)受进程边界隔离、不共享常量;
      // 改这里的落点必须同步改渲染端 worktree-layout.ts 与 spec §2(v7 曾漏改渲染端 → PR #424)。
      const dir = join(baseDir, ".octo", "tmps")
      await ensureWorktreeDir(dir)
      // 拒绝类失败响亮报错(SPEC-INS-026 §4.1):含分隔符 / `..` 的名字不静默改名,直接抛回渲染端提示用户。
      let safeName: string
      try {
        safeName = landingName(filename)
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        log.error("[octo:worktree] upload-name-rejected", { srcPath, filename, reason })
        console.error("[octo:worktree] upload-name-rejected", { srcPath, filename, reason })
        throw err
      }
      const dest = collisionFreePath(dir, safeName)
      try {
        await copyFile(srcPath, dest)
        console.log("[octo:worktree] upload-copy ok", { srcPath, dest })
        return dest
      } catch (err) {
        // 拷贝失败不阻断 MCP 主流程(调用方 catch),本地能力线对该文件不可用。
        console.error("[octo:worktree] upload-copy failed", {
          srcPath,
          dest,
          reason: err instanceof Error ? err.message : String(err),
        })
        throw err
      }
    },
  )

  // SPEC-INS-014 §4.1.2(v2 新增):发送时把预会话落地区(.octo/tmps/)里的附件
  // rename 进真实会话目录(.octo/<sessionId>/uploads/)。同一文件系统内的原子操作,
  // 失败(源文件在拷贝完成后被删/移动,极少见)由调用方 catch、不阻断发送。
  ipcMain.handle(
    "move-pending-upload-to-session",
    async (_event: IpcMainInvokeEvent, srcPath: string, baseDir: string, sessionId: string) => {
      // 布局 SOT = SPEC-INS-014 §2;`.octo`/`uploads` 落点与渲染端判据须同步(见 copy-file-to-worktree 上方注释)。
      const dir = join(baseDir, ".octo", sanitizeSessionSegment(sessionId), "uploads")
      await ensureWorktreeDir(dir)
      const dest = collisionFreePath(dir, basename(srcPath))
      try {
        await rename(srcPath, dest)
        console.log("[octo:worktree] upload-move ok", { srcPath, dest, sessionId })
        return dest
      } catch (err) {
        console.error("[octo:worktree] upload-move failed", {
          srcPath,
          dest,
          sessionId,
          reason: err instanceof Error ? err.message : String(err),
        })
        throw err
      }
    },
  )

  ipcMain.handle(
    "download-resource-to-temp",
    async (
      _event: IpcMainInvokeEvent,
      url: string,
      namespace: string,
      filename: string,
      baseDir?: string,
      sessionId?: string,
    ) => {
      // 拒绝类失败响亮报错(SPEC-INS-026 §4.1):含分隔符 / `..` 的名字不静默改名。渲染端按
      // LANDING_NAME_REJECTED 前缀识别为「重试无用」,toast 提示并保留原链接供手动下载。
      let safeName: string
      try {
        safeName = landingName(filename)
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        log.error("[octo:worktree] materialize-rejected", { url, filename, sessionId, reason })
        console.error("[octo:worktree] materialize-rejected", { url, filename, sessionId, reason })
        throw err
      }
      // baseDir 与 sessionId 都提供时落 <baseDir>/.octo/<sessionId>/outputs/(用户可见、可管理、按会话隔离);
      // 缺一不可时 fallback 走 OS 临时目录(无项目场景 / 无会话 / 纯一次性预览,非持久)。
      const persistent = !!(baseDir && baseDir.length > 0 && sessionId && sessionId.length > 0)
      const dir = persistent
        ? join(baseDir!, ".octo", sanitizeSessionSegment(sessionId!), "outputs")
        : join(app.getPath("temp"), "octo")

      // 内存快路径的键带上 dir(已含 sessionId):Map 是模块级、跨会话共享,只按 URI 记会让「同一 URI 被
      // 会话 A、B 分别引用」时 B 命中 A 的落点、指向 A 的会话目录。带 dir 前缀后,Map 成为「本会话清单」的
      // 忠实缓存,与持久清单答案一致(纯提速、无跨会话 alias)。
      const cacheKey = `${dir}::${namespace}`

      // 幂等 ①:进程内快路径。命中且文件仍在 → 复用,绝不 re-fetch/覆盖。
      const cached = materializedByNamespace.get(cacheKey)
      if (cached && existsSync(cached)) {
        console.log("[octo:worktree] result-materialize", { filename: safeName, path: cached, sessionId, reused: true })
        return cached
      }

      await ensureWorktreeDir(dir)

      // 幂等 ②:磁盘持久清单(跨重启/重装存活,#90)。同样按 URI 命中、且落地文件仍在 → 复用并回填内存 Map。
      if (persistent) {
        const entry = readMaterializedManifest(dir)[namespace]
        if (entry?.file) {
          const abs = join(dir, entry.file)
          if (existsSync(abs)) {
            materializedByNamespace.set(cacheKey, abs)
            console.log("[octo:worktree] result-materialize", { filename: safeName, path: abs, sessionId, reused: true })
            return abs
          }
        }
      }

      // 未命中 → 落盘。撞名仍走 collisionFreePath(两个不同 URI 撞同名各留一份,不 alias),再把 URI→文件名 写回清单。
      const destPath = collisionFreePath(dir, safeName)
      // net.fetch 走 Chromium 网络栈,理由同 download-resource;失败落 main.log(electron-log),
      // 裸 console.log 进不了 main.log,内网远程排障只有这份文件可看。
      const res = await net.fetch(url).catch((err: unknown) => {
        const reason = describeNetworkError(err)
        log.error("[octo:worktree] result-materialize-failed", { url, filename: safeName, sessionId, reason })
        throw new Error(`下载失败: ${reason} (${url})`)
      })
      if (!res.ok) {
        log.error("[octo:worktree] result-materialize-failed", {
          url,
          filename: safeName,
          sessionId,
          status: res.status,
          statusText: res.statusText,
        })
        throw new Error(`下载失败: HTTP ${res.status} ${res.statusText} (${url})`)
      }
      const buf = Buffer.from(await res.arrayBuffer())
      await writeFile(destPath, buf)
      materializedByNamespace.set(cacheKey, destPath)
      if (persistent) recordMaterialized(dir, namespace, basename(destPath))
      console.log("[octo:worktree] result-materialize", { filename: safeName, path: destPath, sessionId, reused: false })
      return destPath
    },
  )

  ipcMain.handle("write-file-buffer", async (_event: IpcMainInvokeEvent, path: string, buffer: ArrayBuffer) => {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, Buffer.from(buffer))
  })

  ipcMain.handle("set-uploads-dir", async (_event: IpcMainInvokeEvent, dir: string) => {
    await mkdir(dir, { recursive: true })
    setUploadsDir(dir)
  })

  ipcMain.handle("get-uploads-dir", async () => getUploadsDir())

  ipcMain.handle("save-upload-image", async (_event: IpcMainInvokeEvent, buffer: ArrayBuffer, sessionId: string) => {
    const baseDir = getUploadsDir()
    if (!baseDir || !sessionId) throw new Error("base dir or session not set")
    const uploadsDir = join(baseDir, sessionId, "uploads")
    await mkdir(uploadsDir, { recursive: true })
    const buf = Buffer.from(buffer)
    const hash = createHash("sha256").update(buf).digest("hex").slice(0, 16)
    const ext = detectImageExt(buf)
    const filename = `${hash}.${ext}`
    const filePath = join(uploadsDir, filename)
    if (!existsSync(filePath)) await writeFile(filePath, buf)
    return `/history/${sessionId}/uploads/${filename}`
  })
  
// insight markdown 编辑器自动保存:把编辑后的文本覆盖写回本地产物文件。
  // 渲染进程不是安全边界 —— 主进程独立校验路径,避免被构造路径越权写系统文件。见 §5 / §7。
  // 两类合法目标:
  //   ① uri 产物:downloadResourceToTemp 落到 <projectDir>/.octo/<sessionId>/outputs/ 或 OS 临时目录(octo/);
  //   ② write 工具产物(路径 C):Agent 写到任意位置的文件(如 ~/Downloads/...),不在白名单内。
  // 因编辑器只会覆盖"它正在展示的、已落地的本地文件",白名单外只放行"已存在的普通文件"
  // (拒绝凭空新建任意系统文件;拒绝经符号链接越权)。
  ipcMain.handle("write-file", async (_event: IpcMainInvokeEvent, path: string, content: string) => {
    const resolved = resolvePath(path)
    const tempRoot = resolvePath(join(app.getPath("temp"), "octo"))
    // SPEC-INS-014 v2:产物/附件落点变成 .octo/<sessionId>/{uploads,outputs}(会话段可变,故按
    // 分段比对而非固定子串);旧 v1 扁平路径(insight/sources、insight/outputs)不再放行 ——
    // Insight tab 是纯内存 signal、不跨重启持久化,不存在"存活 tab 引用旧路径"的场景。
    const inWorktree = isInsightSessionWorktreePath(resolved)
    const inDownloads = resolved.includes(`${sep}.octo${sep}downloads${sep}`)
    const inTemp = resolved === tempRoot || resolved.startsWith(tempRoot + sep)
    if (!inWorktree && !inDownloads && !inTemp) {
      if (!existsSync(resolved)) {
        throw new Error(`拒绝写入(白名单外且文件不存在): ${path}`)
      }
      const lst = await lstat(resolved)
      if (lst.isSymbolicLink() || !lst.isFile()) {
        throw new Error(`拒绝写入(非普通文件或为符号链接): ${path}`)
      }
    }
    await mkdir(dirname(resolved), { recursive: true })
    await writeFile(resolved, content, "utf-8")
  })

  ipcMain.handle("read-file-buffer", async (_event: IpcMainInvokeEvent, path: string) => {
    try {
      const buf = await readFile(path)
      return buf.buffer
    } catch {
      return null
    }
  })

  ipcMain.handle("list-directory", async (_event: IpcMainInvokeEvent, dirPath: string) => {
    const results: Array<{ path: string; type: 'file' | 'directory'; size?: number }> = []

    if (!existsSync(dirPath)) return results

    function walk(currentPath: string, basePath: string) {
      const entries = readdirSync(currentPath, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = join(currentPath, entry.name)
        const relativePath = fullPath.slice(basePath.length).replace(/^[\/\\]/, '')

        if (entry.isDirectory()) {
          walk(fullPath, basePath)
        } else {
          const stat = statSync(fullPath)
          results.push({
            path: relativePath,
            type: 'file',
            size: stat.size
          })
        }
      }
    }

    walk(dirPath, dirPath)
    return results
  })

  // 轻量存在性检查：只 stat 不读盘，供打开前预检用（避免为判断"文件在不在"把整份文件读进内存）。
  // 语义与 read-file-buffer 对齐：仅当目标是一个存在的普通文件时返回 true，其余(不存在/是目录/无权限等)一律 false。
  ipcMain.handle("file-exists", async (_event: IpcMainInvokeEvent, path: string) => {
    try {
      return (await stat(path)).isFile()
    } catch {
      return false
    }
  })

  ipcMain.handle("delete-file", async (_event: IpcMainInvokeEvent, path: string) => {
    try {
      await unlink(path)
    } catch {
      // 文件不存在时忽略，不执行任何代码
    }
  })

  ipcMain.handle("read-clipboard-image", () => {
    const image = clipboard.readImage()
    if (image.isEmpty()) return null
    const buffer = image.toPNG().buffer
    const size = image.getSize()
    return { buffer, width: size.width, height: size.height }
  })

  // SPEC-INS-011:debug 工具 snapshot 用 —— 主进程写剪贴板(不受 renderer DevTools 缺用户手势限制)
  ipcMain.handle("write-clipboard-text", (_event: IpcMainInvokeEvent, text: string) => {
    clipboard.writeText(text)
  })

  ipcMain.on("show-notification", (_event: IpcMainEvent, title: string, body?: string) => {
    new Notification({ title, body }).show()
  })

  ipcMain.handle("get-window-count", () => BrowserWindow.getAllWindows().length)

  ipcMain.handle("get-window-focused", (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win?.isFocused() ?? false
  })

  ipcMain.handle("set-window-focus", (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.focus()
  })

  ipcMain.handle("show-window", (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.show()
  })

  ipcMain.on("relaunch", () => {
    app.relaunch()
    app.exit(0)
  })

  ipcMain.handle("get-zoom-factor", (event: IpcMainInvokeEvent) => event.sender.getZoomFactor())
  ipcMain.handle("set-zoom-factor", (event: IpcMainInvokeEvent, factor: number) => {
    event.sender.setZoomFactor(factor)
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    updateTitlebar(win)
  })
  ipcMain.handle("set-titlebar", (event: IpcMainInvokeEvent, theme: TitlebarTheme) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    setTitlebar(win, theme)
  })
  ipcMain.handle("set-titlebar-overlay-hidden", (event: IpcMainInvokeEvent, hidden: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    setTitlebarOverlayHidden(win, hidden)
  })

  // Use ~/.config/octo/ (xdg-basedir convention) instead of Electron userData
  const getOctoConfigPath = () => {
    const xdgConfig = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
    return join(xdgConfig, "octo")
  }
  const skillsConfigPath = join(getOctoConfigPath(), "skills.json")
  const skillConfigPath = join(getOctoConfigPath(), "skill_config.json")
  const assetsConfigPath = join(getOctoConfigPath(), "assets_config.json")

  /** 从 skills.json 同步生成 skill_config.json */
  function syncSkillConfig() {
    try {
      if (!existsSync(skillsConfigPath)) return
      const raw = JSON.parse(readFileSync(skillsConfigPath, "utf-8"))
      const skillEntries: Record<string, { description?: string; import?: boolean; type?: string }> = raw.skill ?? {}

      const skillMap: Record<string, { description?: string; import?: boolean; type?: string }> = {}
      const agentMap: Record<string, string[]> = { octo_insight: [], octo_make: [], octo_studio: [] }

      for (const [name, entry] of Object.entries(skillEntries)) {
        if (entry.import === false) continue
        skillMap[name] = { description: entry.description, import: entry.import, type: entry.type }
        const t = entry.type || "common"
        if (t === "common") {
          for (const key of Object.keys(agentMap)) {
            agentMap[key].push(name)
          }
        } else if (t in agentMap) {
          agentMap[t].push(name)
        }
      }

      writeFileSync(skillConfigPath, JSON.stringify({ skill: skillMap, agent: agentMap }, null, 2), "utf-8")
    } catch (err) {
      console.error("syncSkillConfig failed", err)
    }
  }

  // jk-j60099994-replace-with-60062650-main-skills-ipc-3-start
  // jk-j60099994-replace-with-60062650-main-skills-ipc-3-end

  ipcMain.handle("get-skills-config", () => {
    try {
      if (!existsSync(skillsConfigPath)) return {}
      return JSON.parse(readFileSync(skillsConfigPath, "utf-8"))
    } catch {
      return {}
    }
  })

  ipcMain.handle("set-skills-config", (_event: IpcMainInvokeEvent, config: Record<string, unknown>) => {
    try {
      mkdirSync(dirname(skillsConfigPath), { recursive: true })
      writeFileSync(skillsConfigPath, JSON.stringify(config, null, 2), "utf-8")
      syncSkillConfig()
    } catch (err) {
      console.error("set-skills-config failed", err)
      throw new Error(`Failed to save skills config: ${err instanceof Error ? err.message : String(err)}`)
    }
  })

  ipcMain.handle("get-skill-config", () => {
    try {
      if (!existsSync(skillConfigPath)) return {}
      return JSON.parse(readFileSync(skillConfigPath, "utf-8"))
    } catch {
      return {}
    }
  })

  ipcMain.handle("set-skill-config", (_event: IpcMainInvokeEvent, config: Record<string, unknown>) => {
    try {
      mkdirSync(dirname(skillConfigPath), { recursive: true })
      writeFileSync(skillConfigPath, JSON.stringify(config, null, 2), "utf-8")
    } catch (err) {
      console.error("set-skill-config failed", err)
      throw new Error(`Failed to save skill config: ${err instanceof Error ? err.message : String(err)}`)
    }
  })

  ipcMain.handle("get-assets-config", () => {
    try {
      if (!existsSync(assetsConfigPath)) return {}
      return JSON.parse(readFileSync(assetsConfigPath, "utf-8"))
    } catch {
      return {}
    }
  })

  ipcMain.handle("set-assets-config", (_event: IpcMainInvokeEvent, config: Record<string, unknown>) => {
    try {
      mkdirSync(dirname(assetsConfigPath), { recursive: true })
      writeFileSync(assetsConfigPath, JSON.stringify(config, null, 2), "utf-8")
    } catch (err) {
      console.error("set-assets-config failed", err)
      throw new Error(`Failed to save assets config: ${err instanceof Error ? err.message : String(err)}`)
    }
  })

  // jk-j60099994-replace-with-60062650-main-skills-ipc-4-start
  // jk-j60099994-replace-with-60062650-main-skills-ipc-4-end

  ipcMain.handle("get-skill-content", async (_event: IpcMainInvokeEvent, skillName: string) => {
    try {
      const skillDir = join(getOctoConfigPath(), "skill", skillName)
      const skillMdPath = join(skillDir, "SKILL.md")

      if (!existsSync(skillMdPath)) {
        return { success: false, error: "SKILL.md not found" }
      }

      const content = readFileSync(skillMdPath, "utf-8")

      const allFiles = globSync("**/*", { cwd: skillDir })
      const files = allFiles
        .filter(f => {
          const fullPath = join(skillDir, f)
          return existsSync(fullPath) && statSync(fullPath).isFile() && f !== "SKILL.md"
        })
        .slice(0, 10)
        .map(f => `<file>${join(skillDir, f)}</file>`)
        .join("\n")

      return {
        success: true,
        name: skillName,
        content: content.trim(),
        baseDir: pathToFileURL(skillDir).href,
        files,
      }
    } catch (err) {
      console.error("get-skill-content failed", err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle("add-skill", async (_event: IpcMainInvokeEvent, sourcePath: string) => {
    try {
      const octoSkillDir = join(getOctoConfigPath(), "skill")
      mkdirSync(octoSkillDir, { recursive: true })

      const skillName = basename(sourcePath)
      const destDir = join(octoSkillDir, skillName)

      if (existsSync(destDir)) {
        return { success: false, error: "同名 skill 已存在" }
      }

      cpSync(sourcePath, destDir, { recursive: true })

      // Update skills.json with type: "common"
      const skillMdPath = join(destDir, "SKILL.md")
      if (!existsSync(skillMdPath)) {
        return { success: false, error: "所选文件夹中未找到 SKILL.md" }
      }
      
      const config = existsSync(skillConfigPath)
        ? JSON.parse(readFileSync(skillConfigPath, "utf-8"))?.skill
        : {}
      const content = readFileSync(skillMdPath, "utf-8")
      const descMatch = content.match(/^---\s*\n.*?description:\s*(.+?)\s*\n.*?---/s)
      config[skillName] = {
        // jk-j60099994-replace-with-60062650-main-skills-ipc-5-start
        // jk-j60099994-replace-with-60062650-main-skills-ipc-5-end
        description: descMatch ? descMatch[1] : "",
        import: true,
        type: "common",
      }
      const configJson = existsSync(skillConfigPath)
        ? JSON.parse(readFileSync(skillConfigPath, "utf-8"))
        : {}
      configJson['skill'] = config
      mkdirSync(dirname(skillConfigPath), { recursive: true })
      writeFileSync(skillConfigPath, JSON.stringify(configJson, null, 2), "utf-8")
      // syncSkillConfig()

      return { success: true, skillName }
    } catch (err) {
      console.error("add-skill failed", err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle("ensure-skill-config", () => {
    if (!existsSync(skillsConfigPath)) return
    if (existsSync(skillConfigPath)) return
    // 根据 skills.json 构建 skill_config.json
    syncSkillConfig()
  })

  ipcMain.handle("open-skill-folder", async () => {
    const octoSkillDir = join(getOctoConfigPath(), "skill")
    if (existsSync(octoSkillDir)) {
      await shell.openPath(octoSkillDir)
    } else {
      mkdirSync(octoSkillDir, { recursive: true })
      await shell.openPath(octoSkillDir)
    }
  })

  ipcMain.handle("html-to-pdf", async (_event: IpcMainInvokeEvent, html: string) => {
    const win = new BrowserWindow({
      width: 1920,
      height: 1080,
      show: false,
      webPreferences: { offscreen: true },
    })
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    const pdfData = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: { width: 1920 * 0.264583, height: 1080 * 0.264583 },
    })
    win.destroy()
    return pdfData.buffer as ArrayBuffer
  })

  ipcMain.handle(
    "capture-preview-rect",
    async (event: IpcMainInvokeEvent, rect: { x: number; y: number; width: number; height: number }) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) return null
      const image = await win.webContents.capturePage(rect)
      if (image.isEmpty()) return null
      return image.toDataURL()
    },
  )

  // 离屏窗口截图:先把当前页面 JSON 写入 previewdist/data.js 的 window.__A2UI_DATA__,
  // 让隐藏窗口启动时直接渲染当前页面(顶层窗口走 __A2UI_DATA__ 路径,不走 postMessage),
  // 截完恢复 data.js。可见界面(含归档弹窗/批注)完全不动,避免遮罩污染与闪烁。
  ipcMain.handle(
    "capture-preview-page",
    async (_event: IpcMainInvokeEvent, opts: { pageJson: unknown; waitForMs?: number }) => {
      const dataJsPath = join(previewDistDir(), "data.js")
      let backup = ""
      try {
        backup = await readFile(dataJsPath, "utf8").catch(() => "")
        const pageJsonObj = typeof opts.pageJson === "string" ? JSON.parse(opts.pageJson) : opts.pageJson
        await writeFile(dataJsPath, `window.__A2UI_DATA__ = ${JSON.stringify(pageJsonObj)};`, "utf8")

        const win = new BrowserWindow({
          width: 1920,
          height: 1080,
          show: false,
          frame: false,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        })
        try {
          await new Promise<void>((resolve) => {
            let done = false
            const finish = () => { if (!done) { done = true; resolve() } }
            win.webContents.once("did-finish-load", finish)
            win.webContents.once("did-fail-load", finish)
            win.webContents.loadURL("http://127.0.0.1:51856").then(finish).catch(finish)
            setTimeout(finish, 15000)
          })
          // 等 runtime 渲染(含图标处理,必要时调用方可调大 waitForMs)
          await new Promise((r) => setTimeout(r, opts.waitForMs ?? 2000))
          const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1920, height: 1080 })
          if (image.isEmpty()) return null
          return image.toDataURL()
        } finally {
          if (!win.isDestroyed()) win.destroy()
        }
      } finally {
        // 回退 data.js,不影响可见 iframe 与后续启动
        await writeFile(dataJsPath, backup, "utf8").catch(() => {})
      }
    },
  )

  // 将 Tailwind 转换为 CSS - By WangQiang - 该注释请勿删除
  ipcMain.handle("tailwind-to-css", (_event: IpcMainInvokeEvent, className: string) => {
    return convertTailwindToCSS(className)
  })

  // 将 CSS 转换为 Tailwind - By WangQiang - 该注释请勿删除
  ipcMain.handle("css-to-tailwind", (_event: IpcMainInvokeEvent, cssObject: Record<string, unknown>) => {
    return convertCssToTailwind(cssObject)
  })

  // pattern 资源目录: ~/.config/octo/prototype/{theme}/pattern/{category}/
  const patternDir = (category: string, theme: string) => join(getOctoConfigPath(), "prototype", theme, "pattern", category)

  // 读取 pattern 资源目录下的 index.json 目录 - By WangQiang - 该注释请勿删除
  ipcMain.handle("get-pattern-index", (_event: IpcMainInvokeEvent, category: string, theme: string = "ICT3.1") => {
    const indexPath = join(patternDir(category, theme), "index.json")
    if (!existsSync(indexPath)) return null
    try {
      return JSON.parse(readFileSync(indexPath, "utf-8"))
    } catch {
      return null
    }
  })

  // 读取 pattern 资源目录下的具体 pattern 文件 - By WangQiang - 该注释请勿删除
  ipcMain.handle(
    "get-pattern-file",
    (_event: IpcMainInvokeEvent, category: string, filename: string, theme: string = "ICT3.1") => {
      const filePath = join(patternDir(category, theme), filename)
      if (!existsSync(filePath)) return null
      return readFileSync(filePath, "utf-8")
    },
  )

  // 读取 pattern 预览图片，返回 base64 data URL - By WangQiang - 该注释请勿删除
  const MIME_PREVIEW: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
  }
  ipcMain.handle(
    "get-pattern-preview",
    (_event: IpcMainInvokeEvent, category: string, filename: string, theme: string = "ICT3.1") => {
      const filePath = join(patternDir(category, theme), filename)
      if (!existsSync(filePath)) return null
      const buf = readFileSync(filePath)
      const ext = extname(filename).toLowerCase()
      const mime = MIME_PREVIEW[ext] ?? "image/png"
      return `data:${mime};base64,${buf.toString("base64")}`
    },
  )

  // 读取 pattern assets 目录下所有静态资源文件 - By WangQiang - 该注释请勿删除
  ipcMain.handle(
    "get-pattern-assets",
    (_event: IpcMainInvokeEvent, category: string, folderName: string, theme: string = "ICT3.1") => {
      const assetsDir = join(patternDir(category, theme), folderName, "assets")
      if (!existsSync(assetsDir)) return []
      return readdirSync(assetsDir, { withFileTypes: true })
        .filter((d) => d.isFile())
        .map((d) => ({
          filename: d.name,
          buffer: readFileSync(join(assetsDir, d.name)).buffer,
        }))
    },
  )

  // 列出已部署的设计系统目录名 - By WangQiang - 该注释请勿删除
  ipcMain.handle("get-design-systems", () => {
    const root = join(getOctoConfigPath(), "prototype")
    if (!existsSync(root)) return [] as string[]
    try {
      return readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory() && existsSync(join(root, d.name, "components")))
        .map((d) => d.name).sort()
    } catch {
      return [] as string[]
    }
  })

  // 导出 HUI 代码 - By WangQiang - 该注释请勿删除
  // 上层 options 只暴露 targetLib（选目标组件库 eview-react/eview-ui，可选）；
  // ipc 注入 templateDir（打包态 process.resourcesPath/hui-templates，按 lib 拆子目录由 resolveTemplateDir 拼）；
  // 二者合并后传给 downloadHuiCode 的 options。
  ipcMain.handle(
    "download-hui-code",
    (_event: IpcMainInvokeEvent, input: HuiCodeInput[], options?: { targetLib?: string }) => {
      const ipcOptions = app.isPackaged
        ? { templateDir: join(process.resourcesPath, "hui-templates") }
        : {}
      return downloadHuiCode(input, { ...ipcOptions, ...options })
    },
  )

  // 获取当前预览页面地址的文件路径 - By WangQiang - 该注释请勿删除
  ipcMain.handle("get-preview-dist-dir", () => previewDistDir())

  // 将页面转换为pixso转送码 - By WangQiang - 该注释请勿删除
  ipcMain.handle("run-pixso-build", async (_event: IpcMainInvokeEvent, input: string) => {
    const { pathToFileURL } = await import("node:url")
    const { existsSync } = await import("node:fs")
    const { join } = await import("node:path")

    const buildJsPath = app.isPackaged
      ? join(process.resourcesPath, "toPixso", "build.js")
      : "D:/Code/toPixso/build.js"

    if (!existsSync(buildJsPath)) {
      throw new Error(`build.js not found at ${buildJsPath}`)
    }

    try {
      const mod = await import(pathToFileURL(buildJsPath).href)
      const result = await mod.default(input)
      return result
    } catch (err) {
      console.error("[pixso] build failed:", err)
      throw err
    }
  })

  ipcMain.handle(
    "export-zip",
    async (
      event: IpcMainInvokeEvent,
      opts: {
        defaultName: string
        files?: { path: string; content: string }[]
        sourceDir?: string
        /** sourceDir 内容在 zip 内的落点（相对路径，默认 ""＝根，如 "assets"） */
        destFolder?: string
        comment?: string
      },
    ) => {
      // sourceDir 不存在时：有 files 就跳过 sourceDir 继续打代码；
      // 既无 files 又无可用 sourceDir → 无内容，取消。
      const sourceDirExists = opts.sourceDir ? existsSync(opts.sourceDir) : false
      if (!opts.files?.length && !sourceDirExists) return null

      const win = BrowserWindow.fromWebContents(event.sender)
      const dialogOpts = {
        title: "导出压缩包",
        defaultPath: opts.defaultName,
        filters: [{ name: "ZIP", extensions: ["zip"] }],
      }
      const result = win
        ? await dialog.showSaveDialog(win, dialogOpts)
        : await dialog.showSaveDialog(dialogOpts)
      if (result.canceled || !result.filePath) return null

      const destZip = result.filePath
      // sourceDir 在 zip 内的落点：相对路径，去前导/尾随 /；"" → 打到根（archive.directory 第二参 false）
      const destFolder = (opts.destFolder ?? "").replace(/^\/+/, "").replace(/\/+$/, "")

      // archiver 合并 files + sourceDir（落到 destFolder）成一个 zip，替换原 powershell/tar + tmp workDir。
      // 三种输入都支持：仅 files / 仅 sourceDir / files + sourceDir。
      await new Promise<void>((resolve, reject) => {
        const output = createWriteStream(destZip)
        const archive = archiver("zip", { zlib: { level: 9 } })
        output.on("close", () => resolve())
        output.on("error", (err) => reject(err))
        archive.on("error", (err) => reject(err))
        archive.pipe(output)

        // ① files：文本文件按 path 写入 zip
        if (opts.files) {
          for (const file of opts.files) {
            archive.append(Buffer.from(file.content, "utf-8"), { name: file.path })
          }
        }

        // ② sourceDir：目录内容整体写入 zip 的 destFolder 下（仅当目录存在）
        //    archive.directory(src, false) → 内容打到根；传字符串 → 打到该子目录
        if (opts.sourceDir && sourceDirExists) {
          archive.directory(opts.sourceDir, destFolder || false)
        }

        void archive.finalize()
      })

      if (opts.comment) addZipComment(destZip, opts.comment)

      return destZip
    },
  )

  ipcMain.handle("import-zip", async () => {
    const result = await dialog.showOpenDialog({
      title: "导入压缩包",
      filters: [{ name: "ZIP", extensions: ["zip"] }],
      properties: ["openFile"],
    })
    if (result.canceled || !result.filePaths[0]) return null

    const zipPath = result.filePaths[0]
    if (readZipComment(zipPath) !== "a2ui-pattern") return []

    const extractDir = join(tmpdir(), `octo-import-${Date.now()}`)
    await mkdir(extractDir, { recursive: true })

    try {
      await new Promise<void>((resolve, reject) => {
        if (process.platform === "win32") {
          execFile(
            "powershell",
            ["-NoProfile", "-Command", `Expand-Archive -Path '${zipPath}' -DestinationPath '${extractDir}' -Force`],
            (err) => (err ? reject(err) : resolve()),
          )
        } else {
          execFile("unzip", ["-o", zipPath, "-d", extractDir], (err) =>
            err ? reject(err) : resolve(),
          )
        }
      })

      return readdirSync(extractDir)
        .filter((f) => f.endsWith(".json"))
        .map((name) => ({ name, content: readFileSync(join(extractDir, name), "utf-8") }))
    } finally {
      await rm(extractDir, { recursive: true, force: true }).catch(() => { })
    }
  })
  // 页面资源捕获(CDP):创建隐藏窗口加载指定 URL,拦截全部网络响应,将所有资源(CSS/JS/图片/字体)内联为 data URI,生成单个自包含 HTML 文件。
  ipcMain.handle(
    "capture-page",
    async (
      _event: IpcMainInvokeEvent,
      opts: { url: string; theme?: "light" | "dark"; waitForMs?: number },
    ) => {
      return codeToHtml(opts)
    },
  )

  // Pipeline API IPC — renderer 通过 window.api.pipelineRequest 调用, 主进程用 net.fetch 请求真实接口(绕 CORS)
  ipcMain.handle("pipeline-request", (_event: IpcMainInvokeEvent, url: string, method: string, uiplusToken: string, body?: any, headers?: Record<string, string>) =>
    pipelineRequest(url, method, uiplusToken, body, headers))

  // Proxy 配置: curl 测试代理连通性, 成功后写入 ~/.config/octo/proxy_config.json
  ipcMain.handle("configure-proxy", async (_event: IpcMainInvokeEvent, account: string, password: string) => {
    const encodedPwd = encodeURIComponent(password)
      .replace(/['()!*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())
    const proxyUrl = `http://${account}:${encodedPwd}@proxyhk.huawei.com:8080`
    // http_proxy 和 https_proxy 都用同一个 http:// 代理地址
    const noProxy = "localhost,127.0.0.1,.local,.huawei.com,.inhuawei.com"
    const curlTarget = "https://ifconfig.me/ip"

    log.info("[configure-proxy] 开始配置代理")

    // 先注入环境变量，确保 curl 能走代理
    const prevEnv: Record<string, string | undefined> = {}
    for (const key of ["http_proxy", "https_proxy", "no_proxy", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY"]) {
      prevEnv[key] = process.env[key]
    }
    process.env["http_proxy"] = proxyUrl
    process.env["https_proxy"] = proxyUrl
    process.env["no_proxy"] = noProxy
    process.env["HTTP_PROXY"] = proxyUrl
    process.env["HTTPS_PROXY"] = proxyUrl
    process.env["NO_PROXY"] = noProxy

    log.info("[configure-proxy] 环境变量已注入")

    try {
      log.info("[configure-proxy] 执行 curl 测试连通性", { curlTarget, connectTimeout: 15, execTimeout: 20000 })

      // 代理验证：通过代理请求 ifconfig.me/ip，检查返回 IP 以 119. 开头
      const curlOutput = execSync(`curl -k -sS --connect-timeout 15 "${curlTarget}"`, {
        timeout: 20000,
        stdio: "pipe",
        encoding: "utf-8",
      }).toString().trim()

      if (!curlOutput.startsWith("119.")) {
        throw new Error(`代理返回的 IP 不是 119.x.x.x: ${curlOutput}`)
      }

      log.info("[configure-proxy] 代理验证通过", { ip: curlOutput })

      log.info("[configure-proxy] curl 测试通过, 写入配置文件")

      // 写入 ~/.config/octo/proxy_config.json（独立文件，避免影响 octo.json 的 schema 校验）
      const configDir = getOctoConfigPath()
      const configFile = join(configDir, "proxy_config.json")
      mkdirSync(configDir, { recursive: true })

      writeFileSync(configFile, JSON.stringify({
        http_proxy: proxyUrl,
        https_proxy: proxyUrl,
        no_proxy: noProxy,
      }, null, 2), "utf-8")
      log.info("[configure-proxy] 配置写入成功", { configFile })
      return { success: true, curlUrl: curlTarget }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      log.error("[configure-proxy] 配置失败", { error: errorMessage })
      return { success: false, curlUrl: curlTarget, error: errorMessage }
    } finally {
      // 恢复之前的环境变量
      for (const key of ["http_proxy", "https_proxy", "no_proxy", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY"] as const) {
        const val = prevEnv[key]
        if (val === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = val
        }
      }
    }
  })
}

export function sendSqliteMigrationProgress(win: BrowserWindow, progress: SqliteMigrationProgress) {
  win.webContents.send("sqlite-migration-progress", progress)
}

export function sendMenuCommand(win: BrowserWindow, id: string) {
  win.webContents.send("menu-command", id)
}

export function sendDeepLinks(win: BrowserWindow, urls: string[]) {
  win.webContents.send("deep-link", urls)
}
