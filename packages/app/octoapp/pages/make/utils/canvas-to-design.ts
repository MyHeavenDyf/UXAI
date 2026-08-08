import JSZip from "jszip"
import { getDesktopApi } from "../lib/electron-api"
import {
  collectReferencedFiles,
  dirname,
  basename,
  joinPath,
} from "./references"
import { observedUrlsToAbsPaths } from "./resource-tracker"
import { resolveHtmlContent } from "./html-assets-zip"

export interface CreateC2DZipOptions {
  htmlContent: string
  htmlFilePath: string
  tabTitle: string
  /** 来自 resource-tracker 的 local:// URL 列表（实际加载过的资源） */
  observedUrls?: string[]
}

export async function createC2DZip(options: CreateC2DZipOptions): Promise<Blob> {
  const outerZip = new JSZip()

  const api = getDesktopApi()

  // 本地文件场景 tab.content 可能为空 → 从磁盘读原始 HTML
  const htmlContent = options.htmlFilePath && api?.readFileBuffer
    ? await resolveHtmlContent(options.htmlContent, options.htmlFilePath, (p) => api.readFileBuffer!(p))
    : options.htmlContent

  const htmlZip = new JSZip()
  htmlZip.file("index.html", htmlContent)

  if (options.htmlFilePath && api?.readFileBuffer) {
    const htmlDir = dirname(options.htmlFilePath).replace(/\\/g, "/")
    const htmlBase = basename(options.htmlFilePath)

    // 静态解析（返回绝对路径集合）
    const staticAbsPaths = await collectReferencedFiles({
      rootContent: htmlContent,
      rootType: "html",
      rootAbsPath: options.htmlFilePath,
      readFileBuffer: (p) => api.readFileBuffer!(p),
    })

    // 网络信号 → 绝对路径
    const observedAbsPaths = observedUrlsToAbsPaths(options.observedUrls || [])

    // C2D 的 html.zip 视图约定 HTML 在根目录，所以不支持跨父级引用：
    // 仅保留 htmlDir 内的引用文件，跨父级的 `..` 引用会被丢弃。
    const referencedRel = new Set<string>()
    for (const abs of [...staticAbsPaths, ...observedAbsPaths]) {
      const norm = abs.replace(/\\/g, "/")
      const lower = norm.toLowerCase()
      if (lower === htmlDir.toLowerCase()) continue
      if (!lower.startsWith(htmlDir.toLowerCase() + "/")) continue
      const rel = norm.slice(htmlDir.length + 1)
      if (rel && rel !== htmlBase && rel !== "index.html") {
        referencedRel.add(rel)
      }
    }

    for (const relPath of referencedRel) {
      try {
        const absolutePath = joinPath(htmlDir, relPath)
        const buffer = await api.readFileBuffer(absolutePath)
        if (buffer) {
          htmlZip.file(relPath, new Uint8Array(buffer))
        }
      } catch (err) {
        console.warn(`[C2D] Failed to read referenced file:`, relPath, err)
      }
    }
  }

  const htmlZipBlob = await htmlZip.generateAsync({ type: "blob" })
  const htmlZipBytes = await htmlZipBlob.arrayBuffer()
  outerZip.folder("data")?.file("html.zip", new Uint8Array(htmlZipBytes))

  const manifest = {
    name: "octo-c2d",
    version: "1.0.0",
    frames: [{
      name: options.tabTitle,
      filePath: "./data/html.zip"
    }]
  }
  outerZip.file("octo-c2d.json", JSON.stringify(manifest, null, 2))

  return await outerZip.generateAsync({ type: "blob" })
}
