/**
 * HTML + 引用资源 ZIP 打包（扁平结构）。
 *
 * 用于 ActionBar 下载按钮：HTML 类型时产出含所有被引用资源的 ZIP。
 *
 * ZIP 结构：根目录放 HTML 原文件名，引用文件保留相对路径（如 styles/main.css）。
 *
 * 引用识别：静态解析（collectReferencedFiles）∪ 网络信号（observedUrls）取并集。
 */

import JSZip from "jszip"
import { getDesktopApi } from "../lib/electron-api"
import {
  collectReferencedFiles,
  dirname,
  basename,
  joinPath,
} from "./references"
import { filterObservedUrlsToRelative } from "./resource-tracker"

export interface CreateHtmlAssetsZipOptions {
  htmlContent: string
  htmlFilePath: string
  htmlFileNameInZip: string
  /** 来自 resource-tracker 的 local:// URL 列表（实际加载过的资源） */
  observedUrls?: string[]
}

export async function createHtmlAssetsZip(options: CreateHtmlAssetsZipOptions): Promise<Blob> {
  const zip = new JSZip()
  zip.file(options.htmlFileNameInZip, options.htmlContent)

  const api = getDesktopApi()
  if (!options.htmlFilePath || !api?.listDirectory || !api?.readFileBuffer) {
    return await zip.generateAsync({ type: "blob" })
  }

  const htmlDir = dirname(options.htmlFilePath)
  const htmlBase = basename(options.htmlFilePath)

  // 静态解析：HTML → CSS/JS 递归
  const staticRefs = await collectReferencedFiles({
    rootContent: options.htmlContent,
    rootType: "html",
    htmlDir,
    readFileBuffer: (p) => api.readFileBuffer!(p),
  })

  // 网络信号 → 同目录相对路径
  const observedRelative = filterObservedUrlsToRelative(options.observedUrls || [], htmlDir)

  // 并集
  const referenced = new Set<string>([...staticRefs, ...observedRelative])

  // 过滤同目录文件，仅打包被引用的
  const files = await api.listDirectory(htmlDir)
  for (const file of files) {
    if (file.type !== "file") continue
    // Windows 下 listDirectory 返回的 path 用反斜杠，统一成正斜杠再比对
    const relPath = file.path.replace(/\\/g, "/")
    if (relPath === htmlBase || relPath === options.htmlFileNameInZip) continue
    if (!referenced.has(relPath)) continue
    try {
      const abs = joinPath(htmlDir, relPath)
      const buf = await api.readFileBuffer(abs)
      if (buf) zip.file(relPath, new Uint8Array(buf))
    } catch (err) {
      console.warn(`[HtmlAssetsZip] Failed to read referenced file:`, relPath, err)
    }
  }

  return await zip.generateAsync({ type: "blob" })
}
