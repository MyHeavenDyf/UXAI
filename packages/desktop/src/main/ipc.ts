import { execFile } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync, readdirSync, statSync } from "node:fs"
// lstat 用 fs/promises 版(异步,handler 本就 async):避免把 lstatSync 加到上面那条被 jk 标记
// 包裹的 fs import 行上 —— 内网合并时该行常冲突,曾把我们加的 lstatSync 吃掉致 ReferenceError。
import { mkdir, readFile, writeFile, lstat, unlink, rm } from "node:fs/promises"
import { dirname, join, basename, resolve as resolvePath, sep } from "node:path"
import { homedir, tmpdir } from "node:os"
import { BrowserWindow, Notification, app, clipboard, dialog, ipcMain, shell } from "electron"
import type { IpcMainEvent, IpcMainInvokeEvent } from "electron"

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
import { convertTailwindToCSS } from "./tailwind-to-css"
import { convertCssToTailwind } from "./tailwind-from-css"
import { previewDistDir } from "./preview-server"
import { pipelineRequest } from "../network/pipelineRequest"

const pickerFilters = (ext?: string[]) => {
  if (!ext || ext.length === 0) return undefined
  return [{ name: "Files", extensions: ext }]
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

  ipcMain.on("show-item-in-folder", (_event: IpcMainEvent, path: string) => {
    shell.showItemInFolder(path)
  })

  ipcMain.handle("download-resource", async (_event: IpcMainInvokeEvent, url: string, destPath: string) => {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`下载失败: HTTP ${res.status} ${res.statusText} (${url})`)
    const buf = Buffer.from(await res.arrayBuffer())
    await mkdir(dirname(destPath), { recursive: true })
    await writeFile(destPath, buf)
  })

  ipcMain.handle(
    "download-resource-to-temp",
    async (
      _event: IpcMainInvokeEvent,
      url: string,
      namespace: string,
      filename: string,
      baseDir?: string,
    ) => {
      const safeNs = namespace.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "default"
      const safeName = filename.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").slice(0, 200) || "untitled"
      // baseDir 提供时:文件落到 <baseDir>/.octo/downloads/<ns>/<name>(用户选了项目目录后,
      // MCP 工具产物/"打开"/"在文件夹定位"全部进项目内,持久可查、可备份);
      // 不传时 fallback 老逻辑走 OS 临时目录(无项目场景或纯一次性预览)。
      const root =
        baseDir && baseDir.length > 0
          ? join(baseDir, ".octo", "downloads")
          : join(app.getPath("temp"), "octo")
      const destPath = join(root, safeNs, safeName)
      // 幂等:已落地的本地副本即用户的「工作文件」——存在就直接复用,绝不 re-fetch / 覆盖。
      // 否则「本地打开/编辑 → 改 → 关闭 → 再打开」会被重新下载的 MCP 原版盖掉用户改动
      // (本函数最初只服务 Office 只读临时预览,加了 .octo/downloads 持久化 + markdown 二次编辑后,
      //  覆盖语义就和编辑回写直接打架)。要拿原始版本走「另存为/下载原件」(download-resource 始终拉 url)。
      if (existsSync(destPath)) {
        console.log("[octo:office] reuse-existing", { destPath })
        return destPath
      }
      const res = await fetch(url)
      if (!res.ok) throw new Error(`下载失败: HTTP ${res.status} ${res.statusText} (${url})`)
      const buf = Buffer.from(await res.arrayBuffer())
      await mkdir(dirname(destPath), { recursive: true })
      try {
        await writeFile(destPath, buf)
      } catch (err) {
        // 文件正被本地应用(Word/Excel/WPS)独占打开时,覆盖写会抛 EBUSY/EPERM。
        // 此时已有本地副本 = 用户上次打开的那份,直接复用,让"打开/定位"正常完成而非报错。
        const code = err instanceof Error && "code" in err ? err.code : undefined
        if ((code === "EBUSY" || code === "EPERM") && existsSync(destPath)) {
          console.warn("[octo:office] reuse-locked", { destPath, code })
          return destPath
        }
        throw err
      }
      return destPath
    },
  )

  ipcMain.handle("write-file-buffer", async (_event: IpcMainInvokeEvent, path: string, buffer: ArrayBuffer) => {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, Buffer.from(buffer))
  })

  // insight markdown 编辑器自动保存:把编辑后的文本覆盖写回本地产物文件。
  // 渲染进程不是安全边界 —— 主进程独立校验路径,避免被构造路径越权写系统文件。见 §5 / §7。
  // 两类合法目标:
  //   ① uri 产物:downloadResourceToTemp 落到 <projectDir>/.octo/downloads/ 或 OS 临时目录(octo/);
  //   ② write 工具产物(路径 C):Agent 写到任意位置的文件(如 ~/Downloads/...),不在白名单内。
  // 因编辑器只会覆盖"它正在展示的、已落地的本地文件",白名单外只放行"已存在的普通文件"
  // (拒绝凭空新建任意系统文件;拒绝经符号链接越权)。
  ipcMain.handle("write-file", async (_event: IpcMainInvokeEvent, path: string, content: string) => {
    const resolved = resolvePath(path)
    const tempRoot = resolvePath(join(app.getPath("temp"), "octo"))
    const inDownloads = resolved.includes(`${sep}.octo${sep}downloads${sep}`)
    const inTemp = resolved === tempRoot || resolved.startsWith(tempRoot + sep)
    if (!inDownloads && !inTemp) {
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
    } catch (err) {
      console.error("set-skills-config failed", err)
      throw new Error(`Failed to save skills config: ${err instanceof Error ? err.message : String(err)}`)
    }
  })

  // jk-j60099994-replace-with-60062650-main-skills-ipc-4-start
  // jk-j60099994-replace-with-60062650-main-skills-ipc-4-end

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
      const config = existsSync(skillsConfigPath)
        ? JSON.parse(readFileSync(skillsConfigPath, "utf-8"))
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
      mkdirSync(dirname(skillsConfigPath), { recursive: true })
      writeFileSync(skillsConfigPath, JSON.stringify(config, null, 2), "utf-8")

      return { success: true, skillName }
    } catch (err) {
      console.error("add-skill failed", err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
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

  // 将 Tailwind 转换为 CSS - By WangQiang - 该注释请勿删除
  ipcMain.handle("tailwind-to-css", (_event: IpcMainInvokeEvent, className: string) => {
    return convertTailwindToCSS(className)
  })

  // 将 CSS 转换为 Tailwind - By WangQiang - 该注释请勿删除
  ipcMain.handle("css-to-tailwind", (_event: IpcMainInvokeEvent, cssObject: Record<string, unknown>) => {
    return convertCssToTailwind(cssObject)
  })

  // pattern 资源目录: ~/.config/octo/prototype/pattern/{category}/
  const patternDir = (category: string) => join(getOctoConfigPath(), "prototype", "pattern", category)

  // 读取 pattern 资源目录下的 index.json 目录 - By WangQiang - 该注释请勿删除
  ipcMain.handle("get-pattern-index", (_event: IpcMainInvokeEvent, category: string) => {
    const indexPath = join(patternDir(category), "index.json")
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
    (_event: IpcMainInvokeEvent, category: string, filename: string) => {
      const filePath = join(patternDir(category), filename)
      if (!existsSync(filePath)) return null
      return readFileSync(filePath, "utf-8")
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
        files?: { name: string; content: string }[]
        sourceDir?: string
        comment?: string
      },
    ) => {
      if (opts.sourceDir && !existsSync(opts.sourceDir)) return null

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
      const isDirect = !!opts.sourceDir
      const workDir = opts.sourceDir ?? join(tmpdir(), `octo-export-${Date.now()}`)

      if (!isDirect) {
        await mkdir(workDir, { recursive: true })
        for (const file of opts.files ?? []) {
          await writeFile(join(workDir, file.name), file.content, "utf-8")
        }
      }

      try {
        await new Promise<void>((resolve, reject) => {
          if (process.platform === "win32") {
            execFile(
              "powershell",
              [
                "-NoProfile",
                "-Command",
                `Compress-Archive -Path '${join(workDir, "*")}' -DestinationPath '${destZip}' -Force`,
              ],
              (err) => (err ? reject(err) : resolve()),
            )
          } else {
            const filePaths = readdirSync(workDir).map((f) => join(workDir, f))
            execFile("zip", ["-j", destZip].concat(filePaths), (err) =>
              err ? reject(err) : resolve(),
            )
          }
        })

        if (opts.comment) addZipComment(destZip, opts.comment)

        return destZip
      }       finally {
        if (!isDirect) await rm(workDir, { recursive: true, force: true }).catch(() => {})
      }
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
      await rm(extractDir, { recursive: true, force: true }).catch(() => {})
    }
  })
  // Pipeline API IPC — renderer 通过 window.api.pipelineRequest 调用, 主进程用 net.fetch 请求真实接口(绕 CORS)
  ipcMain.handle("pipeline-request", (_event: IpcMainInvokeEvent, url: string, method: string, uiplusToken: string, body?: any, headers?: Record<string, string>) =>
    pipelineRequest(url, method, uiplusToken, body, headers))
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
