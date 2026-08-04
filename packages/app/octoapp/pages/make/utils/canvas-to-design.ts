import JSZip from "jszip"
import { getDesktopApi } from "../lib/electron-api"
import {
  collectReferencedFiles,
  dirname,
  basename,
  joinPath,
} from "./references"
import { filterObservedUrlsToRelative } from "./resource-tracker"

export interface CreateC2DZipOptions {
  htmlContent: string
  htmlFilePath: string
  tabTitle: string
  /** 来自 resource-tracker 的 local:// URL 列表（实际加载过的资源） */
  observedUrls?: string[]
}

export async function createC2DZip(options: CreateC2DZipOptions): Promise<Blob> {
  const outerZip = new JSZip()

  const htmlZip = new JSZip()
  htmlZip.file("index.html", options.htmlContent)

  const api = getDesktopApi()
  if (options.htmlFilePath && api?.listDirectory && api?.readFileBuffer) {
    const htmlDir = dirname(options.htmlFilePath)
    const htmlBase = basename(options.htmlFilePath)

    // 静态解析
    const staticRefs = await collectReferencedFiles({
      rootContent: options.htmlContent,
      rootType: "html",
      htmlDir,
      readFileBuffer: (p) => api.readFileBuffer!(p),
    })

    // 网络信号
    const observedRelative = filterObservedUrlsToRelative(options.observedUrls || [], htmlDir)

    const referenced = new Set<string>([...staticRefs, ...observedRelative])

    try {
      const files = await api.listDirectory(htmlDir)
      for (const file of files) {
        if (file.type !== "file") continue
        // Windows 下 listDirectory 返回的 path 用反斜杠，统一成正斜杠再比对
        const relPath = file.path.replace(/\\/g, "/")
        if (relPath === htmlBase || relPath === "index.html") continue
        if (!referenced.has(relPath)) continue
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
    } catch (err) {
      console.warn("[C2D] Failed to list directory:", err)
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
