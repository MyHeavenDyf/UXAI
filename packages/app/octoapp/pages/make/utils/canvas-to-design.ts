import JSZip from "jszip"
import { getDesktopApi } from "../lib/electron-api"

function checkHasRelativeRefs(html: string): boolean {
  const attrRegex = /(?:href|src)=["'](?!https?:|data:|#|[\/\\])[^"']+["']/i
  const cssRegex = /url\(["']?(?!https?:|data:|#)[^"')]+["']?\)/i
  return attrRegex.test(html) || cssRegex.test(html)
}

function dirname(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const idx = normalized.lastIndexOf('/')
  return idx >= 0 ? normalized.slice(0, idx) : path
}

function basename(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const idx = normalized.lastIndexOf('/')
  return idx >= 0 ? normalized.slice(idx + 1) : path
}

function joinPath(base: string, relative: string): string {
  const normalizedBase = base.replace(/\\/g, "/")
  const normalizedRelative = relative.replace(/\\/g, "/")

  if (normalizedRelative.startsWith(normalizedBase)) {
    return normalizedRelative
  }

  if (normalizedBase.endsWith("/")) {
    return normalizedBase + normalizedRelative
  }
  return normalizedBase + "/" + normalizedRelative
}

export interface CreateC2DZipOptions {
  htmlContent: string
  htmlFilePath: string
  tabTitle: string
}

export async function createC2DZip(options: CreateC2DZipOptions): Promise<Blob> {
  const outerZip = new JSZip()

  const htmlZip = new JSZip()
  htmlZip.file("index.html", options.htmlContent)

  const hasRelativeRefs = checkHasRelativeRefs(options.htmlContent)
  if (hasRelativeRefs && options.htmlFilePath) {
    const htmlDir = dirname(options.htmlFilePath)
    const api = getDesktopApi()

    if (api?.listDirectory && api?.readFileBuffer) {
      try {
        const files = await api.listDirectory(htmlDir)
        const htmlFileName = basename(options.htmlFilePath)

        for (const file of files) {
          if (file.type === 'file' && file.path !== htmlFileName) {
            try {
              const absolutePath = joinPath(htmlDir, file.path)
              const buffer = await api.readFileBuffer(absolutePath)
              if (buffer) {
                htmlZip.file(file.path, new Uint8Array(buffer))
              }
            } catch (err) {
              console.warn(`[C2D] Failed to read sibling file:`, file.path, err)
            }
          }
        }
      } catch (err) {
        console.warn('[C2D] Failed to list directory:', err)
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