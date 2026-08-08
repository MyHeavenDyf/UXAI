import { getDesktopApi } from "../lib/electron-api"
import JSZip from "jszip"
import {
  collectReferencedFiles,
  dirname,
  basename,
  joinPath,
} from "./references"
import { observedUrlsToAbsPaths } from "./resource-tracker"
import { resolveHtmlContent } from "./html-assets-zip"

export function getNextAvailableFileName(baseName: string, existingNames: string[]): string {
  if (!existingNames.includes(baseName)) {
    return baseName
  }
  
  const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`^${escapeRegex(baseName)}\\((\\d+)\\)$`)
  let maxNum = 0
  
  for (const name of existingNames) {
    const match = name.match(regex)
    if (match) {
      const num = parseInt(match[1], 10)
      if (num > maxNum) maxNum = num
    }
  }
  
  return `${baseName}(${maxNum + 1})`
}

export interface FileComment {
  id: string
  filePath: string
  elementId: string
  selector: string
  contentSignature?: string
  nativeId?: string
  label: string
  text: string
  position: { x: number; y: number; w: number; h: number }
  htmlHint: string
  note: string
  attachments?: CommentAttachment[]
  createdAt: number
  updatedAt: number
  commenterName?: string
  commenterAccount?: string
  commenterAvatar?: string
}

export interface CommentAttachment {
  id: string
  filename: string
  mime: string
  size: number
  filePath: string
  uploadedAt: number
}

export interface ArchiveComment {
  id: string
  note: string
  selector: string
  time: number
  attachments: Array<{ fileName: string; id: string }>
  account: string
  userName: string
}

export interface CreateArchiveZipOptions {
  comments: FileComment[]
  screenshotBlob: Blob
  htmlContent: string
  htmlFileName: string
  htmlFilePath: string
  sessionId: string
  projectDir: string
  /** 来自 resource-tracker 的 local:// URL 列表（实际加载过的资源） */
  observedUrls?: string[]
}

export function transformCommentsForArchive(comments: FileComment[]): ArchiveComment[] {
  return comments.map(c => ({
    id: c.id,
    note: c.note,
    selector: c.selector,
    time: c.updatedAt,
    account: c.commenterAccount || "",
    userName: c.commenterName || "",
    attachments: (c.attachments || []).map(a => {
      const ext = a.filename.match(/\.[^.]*$/)?.[0] || ""
      return {
        fileName: a.filename,
        id: `${a.id}${ext}`
      }
    })
  }))
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
      ctx.fillText("Screenshot placeholder", 20, 20)
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

export async function createArchiveZip(options: CreateArchiveZipOptions): Promise<Blob> {
  const zip = new JSZip()

  zip.folder("data")
  zip.folder("src")
  zip.folder("preview")

  const archiveComments = transformCommentsForArchive(options.comments)
  zip.file("data/comments.json", JSON.stringify(archiveComments, null, 2))

  const screenshotBytes = await blobToUint8Array(options.screenshotBlob)
  zip.file("data/screenshot.jpg", screenshotBytes)

  const api = getDesktopApi()

  // 本地文件场景 tab.content 可能为空 → 从磁盘读原始 HTML
  const htmlContent = options.htmlFilePath && api?.readFileBuffer
    ? await resolveHtmlContent(options.htmlContent, options.htmlFilePath, (p) => api.readFileBuffer!(p))
    : options.htmlContent

  zip.file("preview/index.html", htmlContent)

  // 引用资源：静态解析 ∪ 网络信号
  if (api?.readFileBuffer && options.htmlFilePath) {
    const htmlDir = dirname(options.htmlFilePath).replace(/\\/g, "/")
    const htmlFileName = basename(options.htmlFilePath)

    // 静态解析（返回绝对路径集合）
    const staticAbsPaths = await collectReferencedFiles({
      rootContent: htmlContent,
      rootType: "html",
      rootAbsPath: options.htmlFilePath,
      readFileBuffer: (p) => api.readFileBuffer!(p),
    })
    const observedAbsPaths = observedUrlsToAbsPaths(options.observedUrls || [])

    // 归档视图约定 HTML 在 preview/index.html，所以不支持跨父级引用：
    // 仅保留 htmlDir 内的引用文件，跨父级的 `..` 引用会被丢弃。
    const referencedRel = new Set<string>()
    for (const abs of [...staticAbsPaths, ...observedAbsPaths]) {
      const norm = abs.replace(/\\/g, "/")
      const lower = norm.toLowerCase()
      if (lower === htmlDir.toLowerCase()) continue
      if (!lower.startsWith(htmlDir.toLowerCase() + "/")) continue
      const rel = norm.slice(htmlDir.length + 1)
      if (rel && rel !== htmlFileName && rel !== options.htmlFileName) {
        referencedRel.add(rel)
      }
    }

    for (const relPath of referencedRel) {
      try {
        const absolutePath = joinPath(htmlDir, relPath)
        const buffer = await api.readFileBuffer(absolutePath)
        if (buffer) {
          zip.file(`preview/${relPath}`, new Uint8Array(buffer))
        }
      } catch (err) {
        console.warn(`[Archive] Failed to read referenced file:`, relPath, err)
      }
    }
  }

  // 处理评论附件
  if (api?.readFileBuffer && options.projectDir) {
    for (const comment of options.comments) {
      if (comment.attachments && comment.attachments.length > 0) {
        zip.folder(`data/${comment.id}`)
        for (const attachment of comment.attachments) {
          try {
            const absolutePath = joinPath(options.projectDir, attachment.filePath)
            const buffer = await api.readFileBuffer(absolutePath)
            if (buffer) {
              const ext = attachment.filename.match(/\.[^.]*$/)?.[0] || ""
              zip.file(`data/${comment.id}/${attachment.id}${ext}`, new Uint8Array(buffer))
            }
          } catch (err) {
            console.warn(`[Archive] Failed to read attachment:`, attachment.filePath, err)
          }
        }
      }
    }
  }

  return await zip.generateAsync({ type: "blob" })
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

export const getArchiveBaseUrl = () => import.meta.env.VITE_OCTO_BASE_URL || ""

const getArchiveAuthHeaders = () => ({
  "Content-Type": "application/json"
})

export interface CreateDeliverableResult {
  deliverableId: number
  uniqueId: string
}

export async function createDeliverable(teamId: number, fileName: string): Promise<CreateDeliverableResult> {
  const res = await fetch(`${getArchiveBaseUrl()}/main/rest.root/octoAgentServer/designAgent/createDeliverable`, {
    method: "POST",
    headers: {
      ...getArchiveAuthHeaders()
    },
    body: JSON.stringify({
      teamId,
      typeId: 41,
      fileName: fileName.replace(/\.html?$/i, "")
    })
  })
  
  if (!res.ok) {
    throw new Error(`createDeliverable failed: ${res.status}`)
  }
  
  const data = await res.json()
  if (data?.errorCode === 401) {
    throw new Error("无该文件夹权限")
  }
  if (!data?.content) {
    throw new Error("createDeliverable returned no content")
  }
  
  return {
    deliverableId: data.content.deliverableId || data.content.id,
    uniqueId: data.content.uniqueId || data.content.docId
  }
}

export async function uploadCover(deliverableId: number, file: Blob): Promise<void> {
  const formData = new FormData()
  formData.append("uploadFile", file, "screenshot.jpg")
  formData.append("deliverableId", String(deliverableId))
  
  const res = await fetch(`${getArchiveBaseUrl()}/main/rest.root/workflow/deliverable/uploadCover`, {
    method: "POST",
    headers: {},
    body: formData
  })
  
  if (!res.ok) {
    throw new Error(`uploadCover failed: ${res.status}`)
  }
}

export async function uploadVersion(uniqueId: string, file: Blob): Promise<{ success: boolean }> {
  const formData = new FormData()
  formData.append("file", file, "archive.zip")
  formData.append("uniqueId", uniqueId)
  formData.append("fileSource", 'Design')
  
  const res = await fetch(`${getArchiveBaseUrl()}/main/rest.root/octoAgentServer/designAgent/uploadVersion`, {
    method: "POST",
    headers: {},
    body: formData
  })
  
  if (!res.ok) {
    throw new Error(`uploadVersion failed: ${res.status}`)
  }
  
  const data = await res.json()
  return { success: data?.success ?? false }
}