import JSZip from "jszip"
import type { UploadZipOptions } from "@/utils/useZipTransport"
import { createC2DZip } from "../../make/utils/canvas-to-design"
import { collectReferencedFiles, dirname, extractReferences } from "../../make/utils/references"
import { tabLocalPath, type ResultTab, type TabViewMode } from "../components/result-viewer/tab-store"
import { getDesktopApi, type DesktopApi } from "../lib/electron-api"
import { stripCodeFence } from "./detect"
import { beginInsightOperation } from "./interaction-tracking"

type Notice = (title: string, error?: boolean) => void
type CanvasOrigin = {
  tab: ResultTab
  sessionId: string
  directory: string
  api?: DesktopApi
  notify: Notice
  onFilesRefresh?: () => void | Promise<void>
}

export function canvasDisabledReason(tab: ResultTab, mode: TabViewMode, sessionId: string | undefined, available: boolean, loadState?: "loading" | "error" | "ready") {
  if (tab.type !== "html") return "仅 HTML 支持画布编辑"
  if (mode === "source") return "请切换到预览视图后再使用画布编辑"
  if (loadState === "error") return "HTML 读取失败，请在结果区重试"
  if (loadState === "loading") return "HTML 内容加载中"
  if (typeof tab.content !== "string") return "HTML 内容加载中"
  if (!stripCodeFence(tab.content)) return "HTML 内容为空"
  if (!sessionId) return "请进入会话后再使用画布编辑"
  if (!available) return "当前环境暂不支持画布编辑"
  return ""
}

function absolutePath(value: string) {
  const path = value.replace(/\\/g, "/")
  if (!/^(?:[a-z]:\/|\/)/i.test(path)) throw new Error("无法确定本地文件目录")
  const prefix = path.startsWith("//") ? "//" : path.startsWith("/") ? "/" : ""
  return prefix + path.split("/").filter(Boolean).reduce<string[]>((parts, part) => {
    if (part === ".") return parts
    if (part === "..") {
      parts.pop()
      return parts
    }
    parts.push(part)
    return parts
  }, []).join("/")
}

function within(directory: string, file: string) {
  const base = absolutePath(directory).replace(/\/$/, "")
  const path = absolutePath(file)
  return /^[a-z]:|^\/\//i.test(base)
    ? path.toLowerCase().startsWith(`${base.toLowerCase()}/`)
    : path.startsWith(`${base}/`)
}

function safeRelative(value: string) {
  const parts = value.replace(/\\/g, "/").split("/")
  if (!value || parts.some(part => !part || part === "." || part === ".." || /[:<>"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw new Error("画布回传包含无效文件路径")
  }
  return parts.join("/")
}

/** 校验后将同一份读取快照交给 Design 打包器，避免二次读取静默降级。 */
export async function createCanvasOptions(input: CanvasOrigin): Promise<UploadZipOptions> {
  const origin = { ...input, tab: { ...input.tab }, api: input.api ?? getDesktopApi() }
  if (!origin.sessionId) throw new Error("请进入会话后再使用画布编辑")
  const filePath = tabLocalPath(origin.tab)
  if (origin.tab.source === "path" && !filePath) throw new Error("无法读取 HTML，请刷新后重试")
  const root = filePath ? absolutePath(filePath) : ""
  const buffers = new Map<string, Promise<ArrayBuffer>>()
  const read = (path: string): Promise<ArrayBuffer> => {
    const key = absolutePath(path)
    if (root && key !== root && !within(dirname(root), key)) {
      return Promise.reject(new Error("页面引用了所在目录之外的资源，请整理到同一目录后重试"))
    }
    if (!buffers.has(key)) {
      buffers.set(key, Promise.resolve().then(async () => {
        const buffer = await origin.api?.readFileBuffer?.(key)
        if (!buffer) throw new Error("文件不可读")
        return buffer
      }))
    }
    return buffers.get(key)!
  }
  const html = root
    ? await read(root).then(buffer => new TextDecoder().decode(buffer), () => { throw new Error("无法读取 HTML，请刷新后重试") })
    : stripCodeFence(origin.tab.content ?? "")
  if (!html.trim()) throw new Error("HTML 内容为空")
  if (!root && extractReferences(html, "html").length) {
    throw new Error("请先将 HTML 及其资源保存到本地目录")
  }
  const referenced = root ? await collectReferencedFiles({ rootContent: html, rootType: "html", rootAbsPath: root, readFileBuffer: read }) : new Set<string>()
  for (const path of referenced) {
    if (!within(dirname(root), path)) throw new Error("页面引用了所在目录之外的资源，请整理到同一目录后重试")
    if (absolutePath(path) !== root && absolutePath(path).slice(dirname(root).length + 1).toLowerCase() === "index.html") {
      throw new Error("页面资源与画布入口 index.html 重名，请调整后重试")
    }
    await read(path).catch(() => { throw new Error("部分本地资源无法读取，请检查后重试") })
  }
  const options = {
    htmlContent: html,
    htmlFilePath: root,
    tabTitle: origin.tab.title || origin.tab.fileName || "Insight HTML",
    observedUrls: [],
    readFileBuffer: read,
  }
  let zip: Promise<Blob> | undefined
  return {
    config: { designName: options.tabTitle, sessionId: origin.sessionId },
    getZip: () => {
      if (!zip) origin.notify("生成ZIP文件...")
      zip ??= createC2DZip(options).catch(() => {
        zip = undefined
        throw new Error("HTML 打包失败，请重试")
      })
      return zip
    },
    downloadHtml: origin.directory && origin.api?.writeFileBuffer && origin.api.fileExists && origin.api.dirExists
      ? data => saveCanvasReturn(data, origin).then(() => {})
      : undefined,
  }
}

// 在同一应用内串行选择目标名并写入，防止并发回调互相覆盖。
const saves = new Map<string, Promise<unknown>>()

export function saveCanvasReturn(data: { filename: string; base64: string }, origin: CanvasOrigin) {
  const snapshot = { ...origin, tab: { ...origin.tab }, api: origin.api ?? getDesktopApi() }
  const key = `${snapshot.directory.replace(/\\/g, "/")}/${snapshot.sessionId}`.toLowerCase()
  const previous = saves.get(key) ?? Promise.resolve()
  const task = previous.catch(() => {}).then(() => writeCanvasReturn(data, snapshot))
  saves.set(key, task)
  // 清理失败任务时不产生未处理的 rejection。
  void task.finally(() => { if (saves.get(key) === task) saves.delete(key) }).catch(() => {})
  return task
}

async function writeCanvasReturn(data: { filename: string; base64: string }, origin: CanvasOrigin) {
  const format = /\.zip$/i.test(data.filename) ? "zip" : /\.html?$/i.test(data.filename) ? "html" : "other"
  const finish = beginInsightOperation("canvas-return-save", { sessionId: origin.sessionId, format })
  let written = 0
  try {
    if (!origin.directory || !origin.sessionId || !origin.api?.writeFileBuffer || !origin.api.fileExists || !origin.api.dirExists) {
      throw new Error("无法保存文件，请检查项目目录和桌面端能力")
    }
    const filename = safeRelative(data.filename)
    if (filename.includes("/")) throw new Error("画布回传包含无效文件路径")
    if (format === "other") throw new Error("不支持的画布回传格式")
    const directory = `${absolutePath(origin.directory).replace(/\/$/, "")}/.octo/${safeRelative(origin.sessionId)}/uploads`
    if (origin.sessionId.includes("/") || origin.sessionId.includes("\\")) throw new Error("无法保存文件，会话无效")
    if (!data.base64 || data.base64.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data.base64)) {
      throw new Error("画布回传文件数据无效")
    }
    const bytes = Uint8Array.from(atob(data.base64), char => char.charCodeAt(0))
    const entries = format === "zip"
      ? Object.values((await JSZip.loadAsync(bytes, { checkCRC32: true }).catch(() => { throw new Error("画布回传 ZIP 无法读取，请重新导出后重试") })).files).map(entry => ({
        name: safeRelative(((entry as typeof entry & { unsafeOriginalName?: string }).unsafeOriginalName ?? entry.name).replace(/\/$/, "")),
        directory: entry.dir,
        read: () => entry.async("arraybuffer"),
      }))
      : [{ name: filename, directory: false, read: () => Promise.resolve(bytes.buffer) }]
    const files = entries.filter(entry => !entry.directory)
    if (!files.length) throw new Error("画布回传压缩包中没有文件")
    const names = entries.map(entry => entry.name.toLowerCase())
    if (new Set(names).size !== names.length || files.some(file => names.some(name => name.startsWith(`${file.name.toLowerCase()}/`)))) {
      throw new Error("画布回传包含冲突的文件路径")
    }
    const base = safeRelative(format === "zip" ? filename.slice(0, -4) : filename.replace(/\.[^.]+$/, ""))
    const extension = format === "zip" ? "" : filename.slice(base.length)
    let index = 0
    let target = `${directory}/${base}${extension}`
    while (await origin.api.fileExists(target) || await origin.api.dirExists(target)) {
      index++
      target = `${directory}/${base} (${index})${extension}`
    }
    for (const file of files) {
      const destination = format === "zip" ? `${target}/${file.name}` : target
      if (!within(directory, destination)) throw new Error("画布回传包含无效文件路径")
      await origin.api.writeFileBuffer(destination, await file.read()).catch(() => { throw new Error("画布文件保存失败，请重试") })
      written++
    }
    finish("success", { count: written })
    origin.notify("已保存到会话文件")
    await Promise.resolve().then(() => origin.onFilesRefresh?.()).catch(() => origin.notify("文件已保存，但会话文件列表刷新失败，请手动刷新", true))
    return target
  } catch (error) {
    finish(written ? "partial" : "failure", { count: written, reason: "save" })
    const message = written ? "画布文件保存不完整，请重试；已写入的文件已保留" : error instanceof Error ? error.message : "画布文件保存失败，请重试"
    origin.notify(message, true)
    throw new Error(message)
  }
}
