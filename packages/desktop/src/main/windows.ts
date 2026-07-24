import windowState from "electron-window-state"
import { app, BrowserWindow, net, nativeImage, nativeTheme, protocol, shell } from "electron"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import {
  injectSandboxShim,
  injectEditBridgeStyle,
  injectEditBridge,
  injectInspectStyleBridge,
  injectPickerBridge,
  injectCommentBridge,
} from "@opencode-ai/core/bridge-scripts"
import { annotateElementsWithIds } from "./bridge-scripts/annotate-node"
import type { TitlebarTheme } from "../preload/types"
import { isApiPath, mockEnabled, handleMockApi } from "./mock"
import { insightDebugLog } from "./logging"

const root = dirname(fileURLToPath(import.meta.url))
const rendererRoot = join(root, "../renderer")
const rendererProtocol = "oc"
const rendererHost = "renderer"
const clipboardWritePermission = "clipboard-sanitized-write"
const apiBaseUrl = import.meta.env.VITE_OCTO_BASE_URL || process.env.VITE_OCTO_BASE_URL || "https://octo.hdesign.huawei.com"
const webRequestAuthUrlPatterns = getWebRequestAuthUrlPatterns()

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
  win.setTitleBarOverlay(titlebarOverlayHidden.has(win) ? { ...o, height: 0 } : o)
}

export function setTitlebarOverlayHidden(win: BrowserWindow, hidden: boolean) {
  if (hidden) {
    titlebarOverlayHidden.add(win)
  } else {
    titlebarOverlayHidden.delete(win)
  }
  updateTitlebar(win)
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
    minWidth: 600,
    minHeight: 576,
    show: false,
    title: "Octo Agent",
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
      webviewTag: true,
      webSecurity: false
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

  win.webContents.session.webRequest.onBeforeSendHeaders({ urls: webRequestAuthUrlPatterns }, (details, callback) => {
    const requestHeaders = details.requestHeaders
    upsertKeyValue(requestHeaders, "Access-Control-Allow-Origin", ["*"])
    if (details.webContentsId !== win.webContents.id || !shouldInjectWebRequestAuth(details.resourceType)) {
      callback({ requestHeaders })
      return
    }
    upsertKeyValue(requestHeaders, "X-OCTO-AGENT", "1")
    void localStorageAuth(win).then(
      (auth) => {
        if (auth.uiplusToken) {
          upsertKeyValue(requestHeaders, "uiplustoken", auth.uiplusToken)
        } else {
          deleteKey(requestHeaders, "uiplustoken")
        }
        if (auth.uiplusCookie) {
          upsertKeyValue(requestHeaders, "Cookie", auth.uiplusCookie)
        } else {
          deleteKey(requestHeaders, "Cookie")
        }
        callback({ requestHeaders })
      },
      () => callback({ requestHeaders }),
    )
  })

  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = details.responseHeaders ?? {}
    if (details.webContentsId === win.webContents.id && shouldInjectWebRequestAuth(details.resourceType)) {
      void writeLocalStorageAuth(win, responseAuth(responseHeaders)).then(undefined, () => {})
    }
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
      webviewTag: true,
      webSecurity: false
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
      // baseUrl 从 VITE_OCTO_BASE_URL 读取, 支持内网 beta/prod 不同域名; 原硬编码只指向公网默认域名
      const realUrl = `${apiBaseUrl}${url.pathname}${url.search}`
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
      pdf: "application/pdf",
      mp4: "video/mp4",
      webm: "video/webm",
      mp3: "audio/mpeg",
      wav: "audio/wav",
    }
    const mimeType = mimeTypes[ext || ""] || "application/octet-stream"

    try {
      const content = await readFile(absolutePath)
      
      // Inject bridge scripts for HTML files
      if (mimeType === "text/html" || mimeType === "text/htm") {
        let htmlStr = new TextDecoder().decode(content)
        
        // Inject bridge scripts in order (same as srcdoc-builder.ts)
        htmlStr = injectSandboxShim(htmlStr)
        htmlStr = annotateElementsWithIds(htmlStr)
        htmlStr = injectEditBridgeStyle(htmlStr)
        htmlStr = injectEditBridge(htmlStr)
        htmlStr = injectInspectStyleBridge(htmlStr)
        htmlStr = injectPickerBridge(htmlStr)
        htmlStr = injectCommentBridge(htmlStr)
        
        return new Response(new TextEncoder().encode(htmlStr), {
          headers: {
            "Content-Type": mimeType,
            "Access-Control-Allow-Origin": "*",
          },
        })
      }
      
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

function getWebRequestAuthUrlPatterns() {
  const configured = String(process.env.OCTO_AUTH_INJECT_URLS || import.meta.env.VITE_OCTO_AUTH_INJECT_URLS || "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
  if (configured.length > 0) return configured
  if (!URL.canParse(apiBaseUrl)) return ["http://*/*", "https://*/*"]
  return [`http://*.${new URL(apiBaseUrl).host.split('.').slice(1).join('.')}/*`, `https://*.${new URL(apiBaseUrl).host.split('.').slice(1).join('.')}/*`]
}

function shouldInjectWebRequestAuth(resourceType: string) {
  return resourceType === "xhr" || resourceType === "other" || resourceType === "webSocket"
}

async function localStorageAuth(win: BrowserWindow) {
  const value = await win.webContents.executeJavaScript(
    `({
      uiplusToken: localStorage.getItem("uiplusToken"),
      uiplusCookie: localStorage.getItem("uiplusCookie"),
    })`,
    true,
  )
  if (!isLocalStorageAuth(value)) return { uiplusToken: null, uiplusCookie: null }
  return {
    uiplusToken: value.uiplusToken?.trim() || null,
    uiplusCookie: value.uiplusCookie?.trim() || null,
  }
}

function isLocalStorageAuth(value: unknown): value is { uiplusToken?: string | null; uiplusCookie?: string | null } {
  if (!value || typeof value !== "object") return false
  const auth = value as Record<string, unknown>
  return (
    (typeof auth.uiplusToken === "string" || auth.uiplusToken === null || auth.uiplusToken === undefined) &&
    (typeof auth.uiplusCookie === "string" || auth.uiplusCookie === null || auth.uiplusCookie === undefined)
  )
}

function responseAuth(headers: Record<string, string | string[]>) {
  return {
    uiplusToken: firstHeaderValue(headers, "uiplusToken")?.trim() || null,
    uiplusCookie: cookieHeaderValue(headers, "set-cookie"),
  }
}

async function writeLocalStorageAuth(win: BrowserWindow, auth: { uiplusToken: string | null; uiplusCookie: string | null }) {
  if (!auth.uiplusToken && !auth.uiplusCookie) return
  await win.webContents.executeJavaScript(
    `{
      ${auth.uiplusToken ? `localStorage.setItem("uiplusToken", ${JSON.stringify(auth.uiplusToken)});` : ""}
      ${(auth.uiplusCookie && auth.uiplusCookie.indexOf("ucd.designcloud") !== -1) ? `localStorage.setItem("uiplusCookie", ${JSON.stringify(auth.uiplusCookie)});` : ""}
    }`,
    true,
  )
}

function firstHeaderValue(headers: Record<string, string | string[]>, name: string) {
  return headerValues(headers, name)[0] ?? null
}

function cookieHeaderValue(headers: Record<string, string | string[]>, name: string) {
  return headerValues(headers, name)
    .flatMap((item) => item.split(/,(?=\s*[^;,\s]+=)/))
    .map((item) => item.split(";")[0]?.trim())
    .filter((item) => item)
    .join("; ")
}

function headerValues(headers: Record<string, string | string[]>, name: string) {
  const key = Object.keys(headers).find((item) => item.toLowerCase() === name.toLowerCase())
  if (!key) return []
  return (Array.isArray(headers[key]) ? headers[key] : [headers[key]])
    .flatMap((item) => expandHeaderValue(item))
}

function expandHeaderValue(value: string) {
  const trimmed = value.trim()
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return [value]
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (!Array.isArray(parsed)) return [value]
    return parsed.filter((item): item is string => typeof item === "string")
  } catch {
    return [value]
  }
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

function deleteKey(obj: Record<string, any>, keyToDelete: string) {
  const keyToDeleteLower = keyToDelete.toLowerCase()
  Object.keys(obj)
    .filter((key) => key.toLowerCase() === keyToDeleteLower)
    .forEach((key) => delete obj[key])
}
