/**
 * HTML + 引用资源 ZIP 打包（保留目录结构）。
 *
 * 用于 ActionBar 下载按钮：HTML 类型时产出含所有被引用资源的 ZIP。
 *
 * ZIP 结构：
 *  - 若所有引用都在 htmlDir 内：HTML 放根目录，引用文件保留相对路径
 *    （如 `index.html` + `images/foo.png` + `css/main.css`）
 *  - 若引用跨到父级目录（如 `../sibling/x.png`）：以最近公共祖先为根，
 *    HTML 与各文件按相对该根的路径摆放，确保解压后相对引用仍能正常解析
 *
 * 引用识别：静态解析（collectReferencedFiles）∪ 网络信号（observedUrls）取并集。
 */

import JSZip from "jszip"
import { getDesktopApi } from "../lib/electron-api"
import {
  collectReferencedFiles,
  dirname,
  basename,
  findCommonAncestor,
  joinPath,
  relativeTo,
} from "./references"
import { observedUrlsToAbsPaths } from "./resource-tracker"
import { cleanBridgeContent } from "./bridge-cleaner"

/**
 * 从磁盘读原始 HTML 文件内容（不含桥脚本注入）。
 * 失败时回退到调用方提供的 htmlContent。
 */
export async function readHtmlFromDisk(
  htmlFilePath: string,
  fallback: string,
  readFileBuffer: (p: string) => Promise<ArrayBuffer | null>
): Promise<string> {
  if (!htmlFilePath) return fallback
  try {
    const buf = await readFileBuffer(htmlFilePath)
    if (!buf) return fallback
    return new TextDecoder("utf-8", { fatal: false }).decode(buf)
  } catch {
    return fallback
  }
}

/**
 * @deprecated 使用 readHtmlFromDisk。
 * 旧的"tab.content 非空则用 tab.content"逻辑会让 ZIP 内 HTML 与磁盘文件不一致
 * （tab.content 可能是 LLM 生成版本、extractDownloadContent 剥围栏后的版本，
 * 或用户在 iframe 内编辑过但未保存的版本）。新代码应直接读盘。
 */
export async function resolveHtmlContent(
  htmlContent: string,
  htmlFilePath: string,
  readFileBuffer: (p: string) => Promise<ArrayBuffer | null>
): Promise<string> {
  if (htmlContent && htmlContent.trim()) return htmlContent
  return readHtmlFromDisk(htmlFilePath, htmlContent, readFileBuffer)
}

export interface CreateHtmlAssetsZipOptions {
  htmlContent: string
  htmlFilePath: string
  htmlFileNameInZip: string
  /** 来自 resource-tracker 的 local:// URL 列表（实际加载过的资源） */
  observedUrls?: string[]
}

export async function createHtmlAssetsZip(options: CreateHtmlAssetsZipOptions): Promise<Blob> {
  const zip = new JSZip()
  const api = getDesktopApi()

  // 无 filePath 或无文件读 API：只能放 HTML 进 ZIP
  if (!options.htmlFilePath || !api?.readFileBuffer) {
    zip.file(options.htmlFileNameInZip, options.htmlContent)
    return await zip.generateAsync({ type: "blob" })
  }

  // 始终从磁盘读原始 HTML：保证 ZIP 内 HTML 与磁盘文件字节级一致，
  // 不受 tab.content / extractDownloadContent / 未保存编辑影响。
  // 静态解析也用同一份磁盘内容，确保引用识别与实际打包一致。
  const htmlContent = await readHtmlFromDisk(
    options.htmlFilePath,
    options.htmlContent,
    (p) => api.readFileBuffer!(p)
  )

  // 静态解析：HTML → CSS/JS 递归，返回绝对路径集合
  const staticAbsPaths = await collectReferencedFiles({
    rootContent: htmlContent,
    rootType: "html",
    rootAbsPath: options.htmlFilePath,
    readFileBuffer: (p) => api.readFileBuffer!(p),
  })

  // 网络信号 → 绝对路径
  const observedAbsPaths = observedUrlsToAbsPaths(options.observedUrls || [])

  // 并集（剔除 HTML 自身）
  const htmlAbsNorm = options.htmlFilePath.replace(/\\/g, "/")
  const htmlDirAbs = dirname(htmlAbsNorm)
  const allAbs = new Set<string>([...staticAbsPaths, ...observedAbsPaths])
  allAbs.delete(htmlAbsNorm)

  // 计算最近公共祖先：至少包含 htmlDir（HTML 自身目录），确保 NCA 是目录而非文件路径。
  // 否则当 allAbs 为空时，NCA 会退化成 htmlAbsNorm（文件路径），relativeTo 全部返回空。
  const nca = findCommonAncestor([htmlDirAbs, ...allAbs])

  // HTML 在 ZIP 内的位置：相对 NCA。若 NCA == htmlDir，relativeTo 返回 basename，
  // 此时允许用调用方传入的友好文件名；否则保留原 basename（路径结构需要）。
  let htmlZipPath: string
  if (nca === htmlDirAbs || nca === "") {
    htmlZipPath = options.htmlFileNameInZip
  } else {
    htmlZipPath = relativeTo(nca, htmlAbsNorm) || options.htmlFileNameInZip
  }
  zip.file(htmlZipPath, htmlContent)

  // 引用文件：按相对 NCA 的路径摆放
  for (const abs of allAbs) {
    const entryPath = relativeTo(nca, abs)
    if (!entryPath) continue  // 不在 NCA 下（理论上不会发生，因为 NCA 是公共祖先）
    try {
      const buf = await api.readFileBuffer(abs)
      if (buf) zip.file(entryPath, new Uint8Array(buf))
    } catch (err) {
      console.warn(`[HtmlAssetsZip] Failed to read referenced file:`, abs, err)
    }
  }

  return await zip.generateAsync({ type: "blob" })
}

export interface CreateIndexHtmlZipOptions {
  /** 入口 HTML 内容（调用方权威内容——自动归档在产物生成完成时触发，不读盘，规避同名旧文件） */
  htmlContent: string
  htmlFilePath: string
  /** 来自 resource-tracker 的 local:// URL 列表（实际加载过的资源）；自动流程无 iframe 传空 */
  observedUrls?: string[]
  /** 可选的文件快照读取器；未提供时沿用桌面端读取及容错行为。 */
  readFileBuffer?: (path: string) => Promise<ArrayBuffer | null>
}

/**
 * C2D 风格扁平 ZIP：index.html 固定在根目录 + htmlDir 内引用资源按相对路径摆放。
 *
 * 视图约定入口 HTML 必须在 ZIP 根，
 * htmlDir 内名为 index.html 的引用文件被丢弃（避免与入口撞名）。
 *
 */
export async function createIndexHtmlZip(options: CreateIndexHtmlZipOptions): Promise<Blob> {
  const zip = new JSZip()
  const api = getDesktopApi()
  const readFileBuffer =
    options.readFileBuffer ?? (api?.readFileBuffer ? (path: string) => api.readFileBuffer!(path) : undefined)

  zip.file("index.html", options.htmlContent)

  if (!options.htmlFilePath || !readFileBuffer) return await zip.generateAsync({ type: "blob" })

  const htmlDir = dirname(options.htmlFilePath).replace(/\\/g, "/")
  const htmlBase = basename(options.htmlFilePath)

  const staticAbsPaths = await collectReferencedFiles({
    rootContent: options.htmlContent,
    rootType: "html",
    rootAbsPath: options.htmlFilePath,
    readFileBuffer,
  })
  const observedAbsPaths = observedUrlsToAbsPaths(options.observedUrls || [])

  // 仅保留 htmlDir 内引用（跨父级丢弃）；排除入口自身与名为 index.html 的撞名文件
  const referencedRel = new Set<string>()
  for (const abs of [...staticAbsPaths, ...observedAbsPaths]) {
    const norm = abs.replace(/\\/g, "/")
    const lower = norm.toLowerCase()
    if (lower === htmlDir.toLowerCase()) continue
    if (!lower.startsWith(htmlDir.toLowerCase() + "/")) continue
    const rel = norm.slice(htmlDir.length + 1)
    if (rel && rel !== htmlBase && rel !== "index.html") referencedRel.add(rel)
  }

  for (const relPath of referencedRel) {
    try {
      const absolutePath = joinPath(htmlDir, relPath)
      const buffer = await readFileBuffer(absolutePath)
      if (buffer) zip.file(relPath, new Uint8Array(buffer))
    } catch (err) {
      console.warn(`[IndexHtmlZip] Failed to read referenced file:`, relPath, err)
    }
  }

  return await zip.generateAsync({ type: "blob" })
}

export interface CreatePartialAssetsZipOptions {
  /** 选中元素的 outerHTML（来自 iframe live DOM，经 od:get-element-html 拉取） */
  fragmentHtml: string
  /** 完整页面 HTML（iframe live 快照优先）：提取 <head> 样式随片段打包；为空则片段无页面样式 */
  pageHtml?: string
  /** 原页面文件路径：片段内相对引用按此目录解析；为空则不做资源收集 */
  htmlFilePath: string
  /** 片段文件在 ZIP 内的名字（含 .html） */
  fileNameInZip: string
}

/**
 * 提取页面 <head> 中的样式元素（<style> 块 + <link rel=stylesheet>）。
 * 调用方需先过 cleanBridgeContent 剥桥注入（<style data-od-...>）；
 */
export function extractHeadStyles(html: string): string {
  if (!html) return ""
  const doc = new DOMParser().parseFromString(html, "text/html")
  const els = doc.head.querySelectorAll('style, link[rel~="stylesheet"]')
  return Array.from(els, (el) => el.outerHTML).join("\n")
}

/**
 * 局部保存 ZIP：最小 HTML 文档包裹选中元素 outerHTML + 页面 <head> 样式。
 */
export async function createPartialAssetsZip(options: CreatePartialAssetsZipOptions): Promise<Blob> {
  const zip = new JSZip()
  const api = getDesktopApi()

  const fragmentHtml = cleanBridgeContent(options.fragmentHtml)
  const headStyles = extractHeadStyles(cleanBridgeContent(options.pageHtml || ""))
  const doc = `<!DOCTYPE html>\n<html>\n<head><meta charset="utf-8">\n${headStyles}\n</head>\n<body>\n${fragmentHtml}\n</body>\n</html>`
  // 局部名称来自用户输入
  const safeFileName =
    options.fileNameInZip
      .replace(/[\\/:*?"<>|#%]/g, "~")
      .replace(/~{2,}/g, "~")
      .replace(/^[~\s]+/, "")
      .trim() || "untitled.html"
  zip.file(safeFileName, doc)

  if (!options.htmlFilePath || !api?.readFileBuffer) {
    return await zip.generateAsync({ type: "blob" })
  }

  const htmlDir = dirname(options.htmlFilePath.replace(/\\/g, "/"))
  const refs = await collectReferencedFiles({
    rootContent: doc,
    rootType: "html",
    rootAbsPath: options.htmlFilePath,
    readFileBuffer: (p) => api.readFileBuffer!(p),
  })

  const allAbs = [...refs]
  const nca = findCommonAncestor([htmlDir, ...allAbs])
  for (const abs of allAbs) {
    const entryPath = relativeTo(nca, abs)
    if (!entryPath) continue
    try {
      const buf = await api.readFileBuffer(abs)
      if (buf) zip.file(entryPath, new Uint8Array(buf))
    } catch (err) {
      console.warn(`[PartialAssetsZip] Failed to read referenced file:`, abs, err)
    }
  }

  return await zip.generateAsync({ type: "blob" })
}
