import { getDesktopApi } from "../lib/electron-api"
import JSZip from "jszip"
import {
  collectReferencedFiles,
  dirname,
  basename,
  joinPath,
  relativeTo,
  resolvePath,
  findCommonAncestor,
} from "./references"
import type { DesktopApi } from "../lib/electron-api"
import { observedUrlsToAbsPaths } from "./resource-tracker"
import { readHtmlFromDisk } from "./html-assets-zip"

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
  /** 归档时塞进 src/ 的文件列表；为空则 src/ 留空 */
  srcFiles?: { path: string; content: string | Uint8Array }[] | null
  /** 额外整体打包进 preview/ 的本地目录（绝对路径，递归列出）。
   *  用于绕过静态解析局限（如打包器转换 new URL 形式、运行时动态注入 css），
   *  把 HTML 引用但 regex 抓不到的本地资源目录（如 prototype 的 assets symlink）一并带走。
   *  不参与引用资源的 NCA 根级镜像：目录在 htmlDir 外时按 basename 别名到
   *  preview/<basename>/（previewdist 回退路径依赖此约定对上 ./previewdist/ 引用）。 */
  previewExtraDirs?: string[]
  /** 额外显式打包的文件（相对 htmlDir 的相对路径，可带 ./ ../ 前缀）。
   *  用于绕过静态解析 + 运行时信号都抓不到的引用（如混合 prototype 的 a2ui-data/*.json /
   *  *.data.js 以 dataPath: './...' JS 字面量引用），由调用方显式列出。
   *  放置随子类型分两路：prototype 直接补进 preview/（同旧逻辑）；
   *  非 prototype 随引用资源走 NCA 镜像——htmlDir 内落 preview/，跨父级落 ZIP 根级。 */
  previewExtraRels?: string[]
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

/** 列出目录下所有文件（绝对路径）。
 *  list-directory IPC 已递归 walk，返回的 path 是相对 dir 的相对路径，这里拼回绝对。 */
async function listDirFiles(
  listDirectory: NonNullable<DesktopApi["listDirectory"]>,
  dir: string,
): Promise<string[]> {
  const entries = await listDirectory(dir)
  return entries
    .filter(e => e.type === "file")
    .map(e => joinPath(dir, e.path.replace(/\\/g, "/")))
}

/** buildArchiveZipBase 的产出：供各入口补充子类型专属内容（引用资源打包需要 HTML 内容与读盘能力）。 */
export interface ArchiveScaffold {
  /** 磁盘原始 HTML（readHtmlFromDisk 读出，与 preview/index.html 内容一致） */
  htmlContent: string
  /** 桌面端读盘能力；无 Electron API 时为 undefined（引用资源打包跳过） */
  readFileBuffer?: (path: string) => Promise<ArrayBuffer | null>
}

/** 组装归档 ZIP 的共享骨架：data/ src/ preview/ 目录、srcFiles、评论、截图、
 *  preview/index.html、previewExtraDirs、评论附件。子类型专属内容（prototype 的
 *  components.json / 各自的引用资源打包）由入口（createArchiveZip /
 *  createPrototypeArchiveZip）在调用前后补充。 */
export async function buildArchiveZipBase(options: CreateArchiveZipOptions, zip: JSZip): Promise<ArchiveScaffold> {
  zip.folder("data")
  zip.folder("src")
  zip.folder("preview")

  // 塞入 subtype 提供的源码文件（平铺到 src/，不再嵌套 zip）
  if (options.srcFiles) {
    for (const f of options.srcFiles) {
      zip.file(`src/${f.path}`, f.content)
    }
  }

  const archiveComments = transformCommentsForArchive(options.comments)
  zip.file("data/comments.json", JSON.stringify(archiveComments, null, 2))

  const screenshotBytes = await blobToUint8Array(options.screenshotBlob)
  zip.file("data/screenshot.jpg", screenshotBytes)

  const api = getDesktopApi()

  // 始终从磁盘读原始 HTML，保证 ZIP 内 HTML 与磁盘一致
  const htmlContent = options.htmlFilePath && api?.readFileBuffer
    ? await readHtmlFromDisk(options.htmlFilePath, options.htmlContent, (p) => api.readFileBuffer!(p))
    : options.htmlContent

  zip.file("preview/index.html", htmlContent)

  // 额外本地目录整体打包进 preview/（绕过静态解析局限，如 prototype 的 assets symlink；
  // 非 prototype 页也可能引用 ./previewdist/，故留在共享骨架，不走各入口的引用打包）
  if (options.previewExtraDirs?.length && api?.listDirectory && api?.readFileBuffer && options.htmlFilePath) {
    const htmlDir = dirname(options.htmlFilePath).replace(/\\/g, "/")
    for (const dir of options.previewExtraDirs) {
      const dirNorm = dir.replace(/\\/g, "/")
      const destPrefix = relativeTo(htmlDir, dirNorm) || basename(dirNorm)
      try {
        const allFiles = await listDirFiles(api.listDirectory, dirNorm)
        for (const absPath of allFiles) {
          const absNorm = absPath.replace(/\\/g, "/")
          const rel = absNorm.slice(dirNorm.length).replace(/^[\\/]+/, "")
          const buffer = await api.readFileBuffer(absPath)
          if (buffer) zip.file(`preview/${destPrefix}/${rel}`, new Uint8Array(buffer))
        }
      } catch (err) {
        console.warn(`[Archive] previewExtraDir failed:`, dir, err)
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

  return {
    htmlContent,
    readFileBuffer: api?.readFileBuffer ? (p: string) => api.readFileBuffer!(p) : undefined,
  }
}

/** 归档引用资源打包*/
async function packNcaReferences(
  zip: JSZip,
  options: CreateArchiveZipOptions,
  htmlContent: string,
  readFileBuffer: (path: string) => Promise<ArrayBuffer | null>,
): Promise<void> {
  const htmlDir = dirname(options.htmlFilePath).replace(/\\/g, "/")

  // 静态解析（返回绝对路径集合，已规范化无 `..` 段；CSS/JS 按各自目录递归解析）
  const staticAbsPaths = await collectReferencedFiles({
    rootContent: htmlContent,
    rootType: "html",
    rootAbsPath: options.htmlFilePath,
    readFileBuffer,
  })
  const observedAbsPaths = observedUrlsToAbsPaths(options.observedUrls || [])

  const allAbs = new Set<string>([...staticAbsPaths, ...observedAbsPaths])

  // 显式补充文件：static 正则抓不到 dataPath 等 JS 字面量引用，observedUrls 时序
  // 不稳定，按调用方给出的相对路径确定性补入（支持 ./ ../ 与绝对形态）。
  if (options.previewExtraRels?.length) {
    for (const rel of options.previewExtraRels) {
      const abs = resolvePath(htmlDir, rel.replace(/\\/g, "/").replace(/^\.?\//, ""))
      if (abs) allAbs.add(abs)
    }
  }

  // 跨盘引用（如 local:///E:/... 直引）会让 NCA 退化成空（C: 与 E: 无公共祖先），
  // 届时所有 relativeTo 返回空、引用被整体丢弃——先剔除跨盘文件（软失败），
  // 保证同盘引用正常镜像。
  const driveOf = (p: string) => (p.startsWith("/") ? "/" : p.slice(0, 2)).toLowerCase()
  const htmlDrive = driveOf(htmlDir)
  const crossDrive = [...allAbs].filter(abs => driveOf(abs) !== htmlDrive)
  if (crossDrive.length) console.warn(`[Archive] Dropped cross-drive references:`, crossDrive)

  // 剔除 HTML 自身（磁盘路径 / htmlFileName 别名两种形态）与跨盘文件
  const htmlDirLower = htmlDir.toLowerCase()
  const htmlAbsLower = options.htmlFilePath.replace(/\\/g, "/").toLowerCase()
  const htmlFileLower = joinPath(htmlDir, options.htmlFileName).toLowerCase()
  const referenced = [...allAbs].filter(abs => {
    const lower = abs.toLowerCase()
    return driveOf(abs) === htmlDrive
      && lower !== htmlDirLower
      && lower !== htmlAbsLower
      && lower !== htmlFileLower
  })

  // NCA：至少包含 htmlDir，保证是目录而非文件路径
  const nca = findCommonAncestor([htmlDir, ...referenced])
  const htmlRelToNca = relativeTo(nca, htmlDir)

  for (const abs of referenced) {
    const relToNca = relativeTo(nca, abs)
    if (!relToNca) continue

    const inHtmlDir = htmlRelToNca === ""
      || relToNca.toLowerCase().startsWith(htmlRelToNca.toLowerCase() + "/")

    let zipPath: string
    if (inHtmlDir) {
      zipPath = `preview/${htmlRelToNca === "" ? relToNca : relToNca.slice(htmlRelToNca.length + 1)}`
      // 源 HTML 改名归档（xxx.html → index.html）时，htmlDir 内恰有名为 index.html 的
      // 引用文件会撞上归档 HTML 固定槽位：归档 HTML 必须保留，引用文件转 _conflict/。
      if (zipPath.toLowerCase() === "preview/index.html") {
        console.warn(`[Archive] Referenced file collides with preview/index.html, renamed:`, abs)
        zipPath = `_conflict/${zipPath}`
      }
    } else {
      // 跨父级文件落 ZIP 根级；与根级固定目录（data/ src/ preview/）前缀冲突时加
      // _conflict/ 前缀保留内容：引用会 404，但解压后可人工找回，归档结构不被破坏。
      const reserved = ["data/", "src/", "preview/"].some(d => relToNca.toLowerCase().startsWith(d))
      if (reserved) console.warn(`[Archive] Referenced file collides with reserved dir, renamed:`, relToNca)
      zipPath = reserved ? `_conflict/${relToNca}` : relToNca
    }

    try {
      const buffer = await readFileBuffer(abs)
      if (buffer) zip.file(zipPath, new Uint8Array(buffer))
    } catch (err) {
      console.warn(`[Archive] Failed to read referenced file:`, abs, err)
    }
  }
}

/** 归档 ZIP 构建入口。*/
export async function createArchiveZip(options: CreateArchiveZipOptions): Promise<Blob> {
  const zip = new JSZip()
  const scaffold = await buildArchiveZipBase(options, zip)

  if (scaffold.readFileBuffer && options.htmlFilePath) {
    await packNcaReferences(zip, options, scaffold.htmlContent, scaffold.readFileBuffer)
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