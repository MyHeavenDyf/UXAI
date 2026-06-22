import windowState from "electron-window-state"
import { app, BrowserWindow, net, nativeImage, nativeTheme, protocol, shell } from "electron"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import type { TitlebarTheme } from "../preload/types"
import { isApiPath, mockEnabled, handleMockApi } from "./mock"
import { insightDebugLog } from "./logging"

const root = dirname(fileURLToPath(import.meta.url))
const rendererRoot = join(root, "../renderer")
const rendererProtocol = "oc"
const rendererHost = "renderer"
const clipboardWritePermission = "clipboard-sanitized-write"

protocol.registerSchemesAsPrivileged([
  {
    scheme: rendererProtocol,
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
    },
  },
  {
    scheme: "local",
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
])

let backgroundColor: string | undefined
const titlebarThemes = new WeakMap<BrowserWindow, Partial<TitlebarTheme>>()
const titlebarHeight = 40
const titlebarOverlayHidden = new WeakSet<BrowserWindow>()

export function setBackgroundColor(color: string) {
  backgroundColor = color
}

export function getBackgroundColor(): string | undefined {
  return backgroundColor
}

function iconsDir() {
  return app.isPackaged ? join(process.resourcesPath, "icons") : join(root, "../../resources/icons")
}

function iconPath() {
  const ext = process.platform === "win32" ? "ico" : "png"
  return join(iconsDir(), `icon.${ext}`)
}

function tone() {
  return nativeTheme.shouldUseDarkColors ? "dark" : "light"
}

function overlay(theme: Partial<TitlebarTheme> = {}, zoom = 1) {
  const mode = theme.mode ?? tone()
  return {
    color: "#00000000",
    symbolColor: mode === "dark" ? "white" : "black",
    height: Math.max(titlebarHeight, Math.round(titlebarHeight * zoom)),
  }
}

export function setTitlebar(win: BrowserWindow, theme: Partial<TitlebarTheme> = {}) {
  titlebarThemes.set(win, theme)
  updateTitlebar(win)
}

export function updateTitlebar(win: BrowserWindow) {
  if (process.platform !== "win32") return
  const o = overlay(titlebarThemes.get(win), win.webContents.getZoomFactor())
  win.setTitleBarOverlay(titlebarOverlayHidden.has(win) ? { color: "#000000", symbolColor: "#00000000", height: 0 } : o)
}

export function setTitlebarOverlayHidden(win: BrowserWindow, hidden: boolean) {
  if (hidden) {
    titlebarOverlayHidden.add(win)
  } else {
    titlebarOverlayHidden.delete(win)
  }
  updateTitlebar(win)
}

export function setWindowMaximized(win: BrowserWindow, maximized: boolean) {
  if (maximized) {
    win.maximize()
  } else {
    win.unmaximize()
  }
}

let fullscreenOverlay: BrowserWindow | null = null

function overlayHTML(imageUrl: string) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{
    width:100vw;height:100vh;
    background:rgba(0,0,0,0.92);
    display:flex;align-items:center;justify-content:center;
    overflow:hidden;
    user-select:none;-webkit-user-select:none;
    cursor:pointer;
  }
  .close{
    position:fixed;top:24px;right:24px;
    width:40px;height:40px;border-radius:50%;
    background:rgba(255,255,255,0.08);border:none;
    cursor:pointer;z-index:10;
    display:flex;align-items:center;justify-content:center;
    color:rgba(255,255,255,0.8);
    transition:background 140ms;
  }
  .close:hover{background:rgba(255,255,255,0.16)}
  img{max-width:90vw;max-height:90vh;object-fit:contain;cursor:default}
</style>
</head>
<body>
  <button class="close" onclick="window.__closeOverlay?.()" aria-label="关闭全屏">
    <svg viewBox="0 0 24 24" width="24" height="24">
      <path d="M18 6L6 18M6 6l12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
  </button>
  <img src="${imageUrl.replace(/"/g, '&quot;')}" onclick="event.stopPropagation()">
  <script>
    window.__closeOverlay = () => window.api?.hideFullscreenOverlay?.()
    document.body.addEventListener('click', () => window.__closeOverlay?.())
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); window.__closeOverlay?.() }
    })
  </script>
</body>
</html>`
}

export function showFullscreenOverlay(parent: BrowserWindow, imageUrl: string, onClose: () => void) {
  hideFullscreenOverlay()
  const bounds = parent.getBounds()
  fullscreenOverlay = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    show: false,
    parent,
    webPreferences: {
      preload: join(root, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  const html = overlayHTML(imageUrl)
  void fullscreenOverlay.loadURL(`data:text/html;base64,${Buffer.from(html).toString("base64")}`)
  fullscreenOverlay.once("ready-to-show", () => fullscreenOverlay?.show())
  fullscreenOverlay.on("closed", () => {
    fullscreenOverlay = null
    onClose()
  })
  // 跟随父窗口移动/缩放
  const syncBounds = () => {
    if (fullscreenOverlay && !fullscreenOverlay.isDestroyed()) {
      const b = parent.getBounds()
      fullscreenOverlay.setBounds(b)
    }
  }
  parent.on("move", syncBounds)
  parent.on("resize", syncBounds)
  fullscreenOverlay.once("closed", () => {
    parent.off("move", syncBounds)
    parent.off("resize", syncBounds)
  })
}

export function hideFullscreenOverlay() {
  if (fullscreenOverlay && !fullscreenOverlay.isDestroyed()) {
    fullscreenOverlay.close()
  }
  fullscreenOverlay = null
}

export function setDockIcon() {
  if (process.platform !== "darwin") return
  const icon = nativeImage.createFromPath(join(iconsDir(), "dock.png"))
  if (!icon.isEmpty()) app.dock?.setIcon(icon)
}

export function createMainWindow() {
  const state = windowState({
    defaultWidth: 1280,
    defaultHeight: 800,
  })

  const mode = tone()
  const win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 1024,
    minHeight: 576,
    show: false,
    title: "Octo AI",
    icon: iconPath(),
    backgroundColor,
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hidden" as const,
          trafficLightPosition: { x: 12, y: 14 },
        }
      : {}),
    ...(process.platform === "win32"
      ? {
          frame: false,
          titleBarStyle: "hidden" as const,
          titleBarOverlay: overlay({ mode }),
        }
      : {}),
    webPreferences: {
      preload: join(root, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  allowClipboardWrite(win)

  // 任何 target="_blank" / window.open 都强制走系统默认浏览器。
  // 不拦截会创建一个新的 BrowserWindow，渲染进程协议不匹配外部 URL，
  // 用户点击 /insight webfetch 这种外部链接时会让整个应用卡死/崩溃。
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url)
    }
    return { action: "deny" }
  })

  win.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
    const { requestHeaders } = details
    upsertKeyValue(requestHeaders, "Access-Control-Allow-Origin", ["*"])
    callback({ requestHeaders })
  })

  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const { responseHeaders = {} } = details
    upsertKeyValue(responseHeaders, "Access-Control-Allow-Origin", ["*"])
    upsertKeyValue(responseHeaders, "Access-Control-Allow-Headers", ["*"])
    callback({ responseHeaders })
  })

  state.manage(win)
  loadWindow(win, "index.html")
  wireZoom(win)

  win.once("ready-to-show", () => {
    win.show()
  })

  win.webContents.on("before-input-event", (_event, input) => {
    if (input.key === "F12" && input.type === "keyDown") {
      if (win.webContents.isDevToolsOpened()) {
        win.webContents.closeDevTools()
      } else {
        win.webContents.openDevTools()
      }
    }
  })

  // SPEC-INS-011 阶段3:把 renderer console 全量转发到 electron-log 文件(userData/logs,5MB 滚动),
  // 作"绝对不漏"兜底——偶现/崩溃前/结构化没捕获到的日志也落盘。level: 0=verbose 1=info 2=warning 3=error
  win.webContents.on("console-message", (_event, level: number, message: string) => {
    const fn = level >= 3 ? insightDebugLog.error : level === 2 ? insightDebugLog.warn : insightDebugLog.info
    fn(`[renderer] ${message}`)
  })

  return win
}

export function createLoadingWindow() {
  const mode = tone()
  const win = new BrowserWindow({
    width: 640,
    height: 480,
    resizable: false,
    center: true,
    show: true,
    icon: iconPath(),
    backgroundColor,
    ...(process.platform === "darwin" ? { titleBarStyle: "hidden" as const } : {}),
    ...(process.platform === "win32"
      ? {
          frame: false,
          titleBarStyle: "hidden" as const,
          titleBarOverlay: overlay({ mode }),
        }
      : {}),
    webPreferences: {
      preload: join(root, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  allowClipboardWrite(win)

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url)
    }
    return { action: "deny" }
  })

  loadWindow(win, "loading.html")

  return win
}

export function registerRendererProtocol() {
  if (protocol.isProtocolHandled(rendererProtocol)) return

  protocol.handle(rendererProtocol, (request) => {
    const url = new URL(request.url)
    if (url.host !== rendererHost) {
      return new Response("Not found", { status: 404 })
    }

    if (isApiPath(url.pathname)) {
      if (mockEnabled()) {
        const mockResponse = handleMockApi(url.pathname, url.search)
        if (mockResponse) return mockResponse
      }
      const realUrl = `https://octo.hdesign.huawei.com${url.pathname}${url.search}`
      return net.fetch(realUrl, {
        method: request.method,
        headers: Object.fromEntries(request.headers.entries()),
      })
    }

    const file = resolve(rendererRoot, `.${decodeURIComponent(url.pathname)}`)
    const rel = relative(rendererRoot, file)
    if (rel.startsWith("..") || isAbsolute(rel)) {
      return new Response("Not found", { status: 404 })
    }

    return net.fetch(pathToFileURL(file).toString())
  })
}

export function registerLocalProtocol() {
  if (protocol.isProtocolHandled("local")) return

  protocol.handle("local", async (request) => {
    const url = new URL(request.url)
    const host = url.host
    const pathname = decodeURIComponent(url.pathname)

    let filePath = pathname
    if (host && /^[A-Za-z]$/.test(host)) {
      // Windows: C:/Users/... → C:\Users\...
      filePath = `${host}:${pathname}`
    } else if (host) {
      // MacOS/Linux: local://Users/... → /Users/...
      filePath = `/${host}${pathname}`
    }

    if (!filePath || filePath.includes("..")) {
      return new Response("Invalid path", { status: 400 })
    }

    let absolutePath: string
    if (process.platform === "win32") {
      absolutePath = filePath.replace(/^[\/\\]+/, "").replace(/\//g, "\\")
    } else {
      // MacOS/Linux: normalize multiple leading slashes to single /
      absolutePath = filePath.replace(/^\/+/, "/")
    }

    if (!existsSync(absolutePath)) {
      return new Response("File not found", { status: 404 })
    }

    const ext = absolutePath.toLowerCase().split(".").pop()
    const mimeTypes: Record<string, string> = {
      html: "text/html",
      htm: "text/html",
      css: "text/css",
      js: "application/javascript",
      json: "application/json",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      svg: "image/svg+xml",
      ico: "image/x-icon",
      woff: "font/woff",
      woff2: "font/woff2",
      ttf: "font/ttf",
      eot: "application/vnd.ms-fontobject",
    }
    const mimeType = mimeTypes[ext || ""] || "application/octet-stream"

    try {
      const content = await readFile(absolutePath)
      return new Response(content, {
        headers: {
          "Content-Type": mimeType,
          "Access-Control-Allow-Origin": "*",
        },
      })
    } catch (err) {
      return new Response(`Read error: ${err}`, { status: 500 })
    }
  })
}

function loadWindow(win: BrowserWindow, html: string) {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    const url = new URL(html, devUrl)
    void win.loadURL(url.toString())
    return
  }

  void win.loadURL(`${rendererProtocol}://${rendererHost}/${html}`)
}

function allowClipboardWrite(win: BrowserWindow) {
  win.webContents.session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(
      permission === clipboardWritePermission &&
        isTrustedRendererUrl(details.requestingUrl) &&
        webContents.id === win.webContents.id,
    )
  })
  win.webContents.session.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    if (permission !== clipboardWritePermission) return false
    if (webContents && webContents.id !== win.webContents.id) return false
    return isTrustedRendererUrl(details.requestingUrl) || isTrustedRendererUrl(requestingOrigin)
  })
}

function isTrustedRendererUrl(value?: string) {
  if (!value || !URL.canParse(value)) return false
  const url = new URL(value)
  if (url.protocol === `${rendererProtocol}:` && url.host === rendererHost) return true
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (!devUrl || !URL.canParse(devUrl)) return false
  return url.origin === new URL(devUrl).origin
}

function wireZoom(win: BrowserWindow) {
  win.webContents.setZoomFactor(1)
  win.webContents.on("zoom-changed", () => {
    win.webContents.setZoomFactor(1)
    updateTitlebar(win)
  })
}

function upsertKeyValue(obj: Record<string, any>, keyToChange: string, value: any) {
  const keyToChangeLower = keyToChange.toLowerCase()
  for (const key of Object.keys(obj)) {
    if (key.toLowerCase() === keyToChangeLower) {
      // Reassign old key
      obj[key] = value
      // Done
      return
    }
  }
  // Insert at end instead
  obj[keyToChange] = value
}
