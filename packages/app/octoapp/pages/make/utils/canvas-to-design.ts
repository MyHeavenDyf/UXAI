import JSZip from "jszip"
import { getDesktopApi } from "../lib/electron-api"
import { readHtmlFromDisk, createIndexHtmlZip } from "./html-assets-zip"

export interface CreateC2DZipOptions {
  htmlContent: string
  htmlFilePath: string
  tabTitle: string
  /** 来自 resource-tracker 的 local:// URL 列表（实际加载过的资源） */
  observedUrls?: string[]
  /** 可选的文件快照读取器；未提供时沿用桌面端读取及容错行为。 */
  readFileBuffer?: (path: string) => Promise<ArrayBuffer | null>
}

export async function createC2DZip(options: CreateC2DZipOptions): Promise<Blob> {
  const outerZip = new JSZip()

  const api = getDesktopApi()
  const readFileBuffer = options.readFileBuffer ?? (api?.readFileBuffer ? (path: string) => api.readFileBuffer!(path) : undefined)

  // 始终从磁盘读原始 HTML，保证 ZIP 内 HTML 与磁盘一致
  const htmlContent = options.htmlFilePath && readFileBuffer
    ? await readHtmlFromDisk(options.htmlFilePath, options.htmlContent, readFileBuffer)
    : options.htmlContent

  // 内层 html.zip：C2D 视图约定 index.html 在根 + htmlDir 内引用资源（跨父级丢弃），
  // 共享 createIndexHtmlZip 实现（自动归档上传同结构）
  const htmlZipBlob = await createIndexHtmlZip({
    htmlContent,
    htmlFilePath: options.htmlFilePath,
    observedUrls: options.observedUrls,
    readFileBuffer,
  })
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
