import JSZip from "jszip"

// 归档所需桌面端 API 子集(运行时即 window.api,真实实现见 packages/desktop/src/preload/index.ts)。
// insight 自包含:不依赖 make/lib/electron-api,这里按需声明最小接口。
type ArchiveDesktopApi = {
  capturePreviewRect?: (rect: { x: number; y: number; width: number; height: number }) => Promise<string | null>
  listDirectory?: (path: string) => Promise<Array<{ path: string; type: "file" | "directory"; size?: number }>>
  readFileBuffer?: (path: string) => Promise<ArrayBuffer | null>
}

function getDesktopApi(): ArchiveDesktopApi | undefined {
  return (window as unknown as { api?: ArchiveDesktopApi }).api
}

export interface CreateArchiveZipOptions {
  screenshotBlob: Blob
  htmlContent: string
  htmlFilePath: string
}

export async function capturePageScreenshot(iframe: HTMLIFrameElement): Promise<Blob> {
  const api = getDesktopApi()

  if (api?.capturePreviewRect) {
    const rect = iframe.getBoundingClientRect()
    const dataUrl = await api.capturePreviewRect({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height
    })
    if (dataUrl) {
      const res = await fetch(dataUrl)
      return await res.blob()
    }
  }

  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas")
    const ctx = canvas.getContext("2d")
    if (!ctx) {
      reject(new Error("Failed to get canvas context"))
      return
    }

    const rect = iframe.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)

    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, rect.width, rect.height)

    try {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob)
        } else {
          reject(new Error("Failed to create blob"))
        }
      }, "image/jpeg", 0.9)
    } catch (err) {
      reject(err)
    }
  })
}

async function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  const buffer = await blob.arrayBuffer()
  return new Uint8Array(buffer)
}

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

export async function createArchiveZip(options: CreateArchiveZipOptions): Promise<Blob> {
  const zip = new JSZip()

  zip.folder("data")
  zip.folder("src")
  zip.folder("preview")

  // insight 无评论系统,data/comments.json 恒为空数组(保留以对齐 Design 的 zip 结构)
  zip.file("data/comments.json", "[]")

  const screenshotBytes = await blobToUint8Array(options.screenshotBlob)
  zip.file("data/screenshot.jpg", screenshotBytes)

  zip.file("preview/index.html", options.htmlContent)

  const api = getDesktopApi()

  // 检查是否有相对路径引用，如果有则复制同目录下所有文件
  if (api?.listDirectory && api?.readFileBuffer && options.htmlFilePath) {
    const hasRelativeRefs = checkHasRelativeRefs(options.htmlContent)

    if (hasRelativeRefs) {
      const htmlDir = dirname(options.htmlFilePath)
      const htmlFileName = basename(options.htmlFilePath)

      try {
        const files = await api.listDirectory(htmlDir)

        for (const file of files) {
          if (file.type === 'file' && file.path !== htmlFileName) {
            try {
              const absolutePath = joinPath(htmlDir, file.path)
              const buffer = await api.readFileBuffer(absolutePath)
              if (buffer) {
                zip.file(`preview/${file.path}`, new Uint8Array(buffer))
              }
            } catch (err) {
              console.warn(`[Archive] Failed to read referenced file:`, file.path, err)
            }
          }
        }
      } catch (err) {
        console.warn('[Archive] Failed to list directory:', err)
      }
    }
  }

  return await zip.generateAsync({ type: "blob" })
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

export function downloadArchiveZip(zipBlob: Blob, fileName: string): void {
  const url = URL.createObjectURL(zipBlob)
  const a = document.createElement("a")
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function buildArchivePath(data: {
  spaceType: "project" | "personal"
  productName?: string
  versionDeliveryName?: string
  folderName?: string
}): string {
  const parts: string[] = []
  parts.push(data.spaceType === "project" ? "项目空间" : "个人工作台")
  if (data.productName) parts.push(data.productName)
  if (data.versionDeliveryName) parts.push(data.versionDeliveryName)
  if (data.folderName) parts.push(data.folderName)
  return parts.join(" - ")
}

