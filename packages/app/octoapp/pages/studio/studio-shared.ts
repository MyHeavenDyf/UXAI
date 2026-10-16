import type { StudioAsset, StudioCapability, StudioGenerationResult, StudioGenerationStatus, StudioImage, StudioInputImage, StudioMode } from "./types"
import { styleModelId } from "./data"

export const SKIP_PART_TYPES = new Set(["patch", "step-start", "step-finish"])
export const SUPPORTED_STUDIO_CAPABILITIES = new Set<StudioCapability>([
  "image.generate",
  "video.generate",
  "image.upscale",
  "image.cutout",
  "image.inpaint",
  "image.outpaint",
])
export const STUDIO_GENERATION_CREATE_TIMEOUT_MS = 130_000
export const STUDIO_GENERATION_CANCEL_TIMEOUT_MS = 20_000
export const STUDIO_GENERATION_REBOOT_TIMEOUT_MS = 30_000
export const STUDIO_GENERATION_REFRESH_TIMEOUT_MS = 35_000
export const STUDIO_GENERATION_STATUS_INTERVAL_MS = 7_500

export function isStudioGenerationStatusRegression(
  current: StudioGenerationResult["status"],
  next: StudioGenerationResult["status"],
) {
  return (
    current === "create_failed" ||
    current === "failed" ||
    current === "abnormal" ||
    current === "succeeded"
  ) && (next === "queued" || next === "running")
}

export function isStudioGenerationFailure(status: StudioGenerationResult["status"]) {
  return status === "create_failed" || status === "failed"
}

export function studioResultCardStatus(input: {
  result?: Pick<StudioGenerationResult, "status" | "images" | "error">
  toolError?: string
  busy: boolean
  toolRunning: boolean
}): StudioGenerationStatus {
  const generationStatus = input.result?.status
  if (generationStatus === "create_failed" || generationStatus === "failed") return generationStatus
  if (generationStatus === "abnormal") return generationStatus
  if (generationStatus === "queued" || generationStatus === "running") return generationStatus
  if (generationStatus === "succeeded" || input.result?.images.length) return "succeeded"
  if (input.toolError || input.result?.error) return "failed"
  if (input.busy || input.toolRunning) return "running"
  return "failed"
}

export type StudioPendingResult = StudioGenerationResult & {
  displayPrompt?: string
  sourceImage?: string
  inputImages?: StudioInputImage[]
}

export type StudioHDMode = "restoration_8k" | "restoration" | "super_resolution"
export type StudioInpaintMode = "qwen_image_edit" | "erase"
export type StudioVideoDuration = string
export type StudioVideoQualityMode = "480" | "720" | "1080" | "4k"
export const STUDIO_VIDEO_RESOLUTION: Record<StudioVideoQualityMode, string> = {
  "480": "480p",
  "720": "720p",
  "1080": "1080p",
  "4k": "4k",
}
export const STUDIO_VIDEO_MODE: Record<StudioVideoQualityMode, "std" | "pro"> = {
  "480": "std",
  "720": "pro",
  "1080": "pro",
  "4k": "pro",
}
export const STUDIO_VIDEO_RESOLUTION_KEY: Record<string, StudioVideoQualityMode> = {
  "480p": "480",
  "720p": "720",
  "1080p": "1080",
  "4k": "4k",
}
export type StudioVideoFrameSlot = "first" | "last"
export type StudioVideoMode = "all-reference" | "first-last-frame" | "ultra-long"

export const STUDIO_HD_MODES = [
  { label: "8k超清", value: "restoration_8k" },
  { label: "4k清晰", value: "restoration" },
  { label: "2k性能", value: "super_resolution" },
] satisfies { label: string; value: StudioHDMode }[]

export const STUDIO_VIDEO_ASPECT_RATIOS = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] as const

export const STUDIO_VIDEO_MODES = [
  { label: "全能参考", value: "all-reference" },
  { label: "首尾帧", value: "first-last-frame" },
  { label: "超长视频", value: "ultra-long" },
] satisfies { label: string; value: StudioVideoMode }[]

export function workspaceModeForCapability(capability: StudioCapability): Exclude<StudioMode, "preview"> | undefined {
  if (capability === "image.upscale") return "hd"
  if (capability === "image.cutout") return "cutout"
  if (capability === "image.inpaint") return "inpaint"
  if (capability === "image.outpaint") return "outpaint"
  return undefined
}

export function recordValue(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return (value as Record<string, unknown>)[key]
}

export function stringValue(value: unknown, key: string) {
  const next = recordValue(value, key)
  return typeof next === "string" ? next : undefined
}

export function uiplusUserAccount() {
  const account = recordValue(JSON.parse(localStorage.getItem("userInfo") || "{}"), "account")
  return typeof account === "string" ? account : undefined
}

export function studioResultTaskType(result: StudioGenerationResult) {
  return (
    result.task_type ??
    result.taskType ??
    stringValue(result.request, "task_type") ??
    stringValue(result.request, "taskType") ??
    stringValue(recordValue(result.request, "body"), "task_type") ??
    stringValue(recordValue(result.request, "body"), "taskType") ??
    stringValue(result.response, "task_type") ??
    stringValue(result.response, "taskType")
  )
}

export function isStudioEditResult(result: StudioGenerationResult) {
  const taskType = studioResultTaskType(result)
  if (taskType === "magnify" || taskType === "remove_bg" || taskType === "inpainting" || taskType === "outpainting") return true
  if (result.capability === "image.upscale" || result.capability === "image.cutout" || result.capability === "image.inpaint" || result.capability === "image.outpaint") return true
  return result.toolAction === "super_resolution" || result.toolAction === "cutout" || result.toolAction === "inpainting" || result.toolAction === "outpainting"
}

export function studioGenerationTitle(
  capability: StudioCapability | undefined,
  status: "running" | "succeeded" | "create_failed" | "failed" | "abnormal",
) {
  const label = capability === "video.generate" ? "视频生成" : "图片生成"
  if (status === "create_failed") return capability === "video.generate" ? "视频创建失败" : "图片创建失败"
  if (status === "failed") return `${label}失败`
  if (status === "abnormal") return `${label}状态异常`
  if (status === "succeeded") return `${label}完成`
  return `${label}中`
}

export function formatStudioGenerationError(response: Response, bodyText: string) {
  const parsed = bodyText
    ? (() => {
        try {
          return JSON.parse(bodyText) as {
            data?: { message?: string }
            error?: string
            message?: string
            issues?: unknown
          }
        } catch {
          return undefined
        }
      })()
    : undefined
  const message =
    parsed?.data?.message ??
    parsed?.error ??
    parsed?.message ??
    (parsed?.issues ? JSON.stringify(parsed.issues) : undefined) ??
    bodyText.trim()
  return [
    `Studio generation failed: ${response.status} ${response.statusText}`.trim(),
    message,
  ]
    .filter((item): item is string => Boolean(item))
    .join("\n")
}

export function createBlobUrlFromDataUrl(url: string) {
  const match = url.match(/^data:([^;,]+);base64,(.+)$/)
  if (!match) return url
  const mime = match[1]
  const binary = atob(match[2])
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }
  return URL.createObjectURL(new Blob([bytes], { type: mime }))
}

export function isVideoMedia(image?: StudioImage) {
  if (!image) return false
  if (image.kind) return image.kind === "video"
  return /^data:video\//i.test(image.url) || /\.(mp4|mov|webm)(?:[?#]|$)/i.test(image.url)
}

export function getImageOrientation(image?: StudioImage): "portrait" | "landscape" | "" {
  if (!image?.width || !image?.height) return ""
  if (image.width === image.height) return ""
  return image.height > image.width ? "portrait" : "landscape"
}

export function hasVideoFrameAssets(frames: { first?: StudioAsset; last?: StudioAsset }) {
  return Boolean(frames.first || frames.last)
}

export function triggerBrowserDownload(url: string, filename: string) {
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.rel = "noopener"
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

function contentDispositionFilename(value?: string | null) {
  if (!value) return
  const encoded = value.match(/(?:^|;)\s*filename\*\s*=\s*([^;]+)/i)?.[1]?.trim()
  if (encoded) {
    const filename = encoded.replace(/^UTF-8''/i, "").replace(/^['"]|['"]$/g, "")
    try {
      return decodeURIComponent(filename)
    } catch {
      return filename
    }
  }
  return value.match(/(?:^|;)\s*filename\s*=\s*(?:"([^"]*)"|([^;]*))/i)?.slice(1).find(Boolean)?.trim()
}

function mediaExtension(mime?: string | null) {
  return {
    "image/avif": "avif",
    "image/gif": "gif",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/svg+xml": "svg",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
  }[mime?.split(";", 1)[0]?.trim().toLowerCase() ?? ""]
}

export function studioMediaDownloadFilename(input: {
  url: string
  contentDisposition?: string | null
  mime?: string | null
}) {
  const disposition = contentDispositionFilename(input.contentDisposition)
  const urlFilename = (() => {
    if (input.url.startsWith("data:")) return
    try {
      const filename = new URL(input.url).pathname.split("/").filter(Boolean).pop()
      if (!filename) return
      try {
        return decodeURIComponent(filename)
      } catch {
        return filename
      }
    } catch {
      return
    }
  })()
  const filename = (disposition ?? urlFilename ?? "download")
    .replaceAll("\\", "/")
    .split("/")
    .pop()
    ?.replace(/[\u0000-\u001f\u007f]/g, "")
    .trim() || "download"
  const extension = mediaExtension(input.mime)
  if (/\.[a-z0-9]{1,10}$/i.test(filename) || !extension) return filename
  return `${filename}.${extension}`
}

type StudioDesktopDownloadApi = {
  saveFilePicker?: (opts?: { defaultPath?: string }) => Promise<string | null>
  writeFileBuffer?: (path: string, buffer: ArrayBuffer) => Promise<void>
  fileExists?: (path: string) => Promise<boolean>
}

function studioDesktopDownloadApi(): StudioDesktopDownloadApi | undefined {
  return (window as unknown as { api?: StudioDesktopDownloadApi }).api
}

// 拉取待下载的媒体字节并解析出文件名；失败时仅返回兜底文件名，交由保存阶段回退为直链下载。
export async function prepareStudioMediaDownload(input: {
  source: string
  fallbackMime: string
  signal?: AbortSignal
}): Promise<{ label: string; blob?: Blob }> {
  const downloaded = await fetch(input.source, { signal: input.signal })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Download request failed: ${response.status}`)
      const blob = await response.blob()
      return {
        blob,
        label: studioMediaDownloadFilename({
          url: response.url || input.source,
          contentDisposition: response.headers.get("content-disposition"),
          mime: blob.type || response.headers.get("content-type") || input.fallbackMime,
        }),
      }
    })
    .catch((error) => {
      console.warn("[studio] media download fallback", error)
      return undefined
    })
  return {
    label: downloaded?.label ?? studioMediaDownloadFilename({ url: input.source, mime: input.fallbackMime }),
    blob: downloaded?.blob,
  }
}

export type StudioMediaSaveResult = { saved: boolean; fallback?: boolean; cancelled?: boolean }

// 与详情面板下载同一套落盘策略：桌面端走原生保存对话框，其余走浏览器下载。
// saved=true 表示字节已确认落盘（写盘或浏览器 blob 下载）；
// fallback=true 表示字节缺失只能回退直链下载，结果无法确认，调用方不得据此提示成功。
export async function saveStudioMediaDownload(input: {
  source: string
  label: string
  blob?: Blob
}): Promise<StudioMediaSaveResult> {
  if (!input.blob) {
    triggerBrowserDownload(input.source, input.label)
    return { saved: false, fallback: true }
  }
  try {
    const api = studioDesktopDownloadApi()
    if (api?.saveFilePicker && api.writeFileBuffer) {
      const filePath = await api.saveFilePicker({ defaultPath: input.label })
      if (!filePath) return { saved: false, cancelled: true }
      if (api.fileExists && await api.fileExists(filePath)) {
        const unique = await collisionFreeFilename(api, filePath)
        await api.writeFileBuffer(unique, await input.blob.arrayBuffer())
        return { saved: true }
      }
      await api.writeFileBuffer(filePath, await input.blob.arrayBuffer())
      return { saved: true }
    }
    browserDownloadBlob(input.blob, input.label)
    return { saved: true }
  } catch (error) {
    console.warn("[studio] media download fallback", error)
    triggerBrowserDownload(input.source, input.label)
    return { saved: false, fallback: true }
  }
}

function basenameSuffixes(label: string) {
  const dot = label.lastIndexOf(".")
  const base = dot > 0 ? label.slice(0, dot) : label
  const ext = dot > 0 ? label.slice(dot) : ""
  return { base, ext }
}

// 宿主提供 fileExists 时，对目标目录中已存在的同名文件加 (1)/(2) 后缀避让，
// 避免静默覆盖；不可用时返回原名（与旧行为一致）。迭代设上限，
// 宿主 fileExists 行为异常（恒为 true）时放弃避让返回原名，不做无限探测。
async function collisionFreeFilename(
  api: { fileExists?: (path: string) => Promise<boolean> },
  target: string,
): Promise<string> {
  if (!api.fileExists || !(await api.fileExists(target))) return target
  const separator = target.includes("\\") ? "\\" : "/"
  const end = target.lastIndexOf(separator)
  const directory = end >= 0 ? target.slice(0, end) : target
  const label = end >= 0 ? target.slice(end + 1) : target
  const { base, ext } = basenameSuffixes(label)
  for (let index = 1; index <= 1000; index++) {
    const candidate = `${directory}${separator}${base}(${index})${ext}`
    if (!(await api.fileExists(candidate))) return candidate
  }
  console.warn("[studio] gave up finding a collision-free filename", { target })
  return target
}

function browserDownloadBlob(blob: Blob, label: string) {
  const objectUrl = URL.createObjectURL(blob)
  triggerBrowserDownload(objectUrl, label)
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
}

function uniqueBatchFilename(label: string, used: Set<string>) {
  if (!used.has(label)) {
    used.add(label)
    return label
  }
  const { base, ext } = basenameSuffixes(label)
  let index = 1
  let candidate = `${base}(${index})${ext}`
  while (used.has(candidate)) {
    index += 1
    candidate = `${base}(${index})${ext}`
  }
  used.add(candidate)
  return candidate
}

// 批量落盘：与单个下载共用同一套桌面端「保存文件」对话框（saveFilePicker），
// 只弹一次，文件名输入框展示全部待下载文件（逗号分隔，重名加 (1)/(2) 后缀）；
// 以所选路径所在目录写入全部媒体。非桌面端或对话框宿主异常时退回逐条浏览器下载。
// saved 只统计已确认落盘的数量；fallback 统计只能回退直链下载、结果无法确认
// 的数量，调用方不得把 fallback 计入成功。
export async function batchSaveStudioMedia(input: {
  entries: { source: string; label: string; blob?: Blob }[]
}): Promise<{ saved: number; fallback: number; total: number; cancelled: boolean }> {
  const { entries } = input
  const total = entries.length
  const api = studioDesktopDownloadApi()
  if (api?.saveFilePicker && api.writeFileBuffer) {
    const used = new Set<string>()
    const labels = entries.map((entry) => uniqueBatchFilename(entry.label, used))
    // defaultPath 只是预填提示：多选时列出全部待下载文件，但 OS 对文件名长度
    // 有限制（约 255 字节），超长时截断避免对话框异常。
    const joined = labels.join(",")
    let pickerFailed = false
    const target = await api
      .saveFilePicker({ defaultPath: joined.length > 200 ? `${joined.slice(0, 197)}...` : joined })
      .catch((error: unknown) => {
        // 与单文件版同一韧性策略：宿主对话框异常时降级浏览器下载，不让整批 reject。
        console.warn("[studio] batch save dialog failed", error)
        pickerFailed = true
        return null
      })
    if (pickerFailed) {
      let saved = 0
      let fallback = 0
      for (const entry of entries) {
        if (entry.blob) {
          browserDownloadBlob(entry.blob, entry.label)
          saved += 1
        } else {
          triggerBrowserDownload(entry.source, entry.label)
          fallback += 1
        }
      }
      return { saved, fallback, total, cancelled: false }
    }
    if (!target) return { saved: 0, fallback: 0, total, cancelled: true }
    const separator = target.includes("\\") ? "\\" : "/"
    const end = target.lastIndexOf(separator)
    const directory = end >= 0 ? target.slice(0, end) : target
    let saved = 0
    let fallback = 0
    for (const [index, entry] of entries.entries()) {
      if (!entry.blob) {
        triggerBrowserDownload(entry.source, labels[index])
        fallback += 1
        continue
      }
      try {
        const outputPath = await collisionFreeFilename(api, `${directory}${separator}${labels[index]}`)
        await api.writeFileBuffer(outputPath, await entry.blob.arrayBuffer())
        saved += 1
      } catch (error) {
        console.warn("[studio] batch download write failed", error)
      }
    }
    return { saved, fallback, total, cancelled: false }
  }
  let saved = 0
  let fallback = 0
  for (const entry of entries) {
    if (entry.blob) {
      browserDownloadBlob(entry.blob, entry.label)
      saved += 1
    } else {
      triggerBrowserDownload(entry.source, entry.label)
      fallback += 1
    }
  }
  return { saved, fallback, total, cancelled: false }
}

export function getModelResolutionKey(styleModel: string): string {
  const id = styleModelId(styleModel) ?? styleModel
  if (id === "hdesign") return "hdesign"
  if (id === "seedream-5-lite") return "2k"
  if (id.includes("2k")) return "2k"
  if (id.includes("3k")) return "3k"
  if (id.includes("4k")) return "4k"
  return "default"
}

/** [width, height] per aspect ratio, keyed by resolution tier */
export const STUDIO_SIZE_MAP: Record<string, Record<string, [number, number]>> = {
  hdesign: { "1:1": [1280, 1280] },
  "2k":    { "1:1": [2048, 2048], "2:3": [1664, 2496], "3:4": [1728, 2304], "9:16": [1600, 2848] },
  "3k":    { "1:1": [3072, 3072], "2:3": [2496, 3744], "3:4": [2592, 3456], "9:16": [2304, 4096] },
  "4k":    { "1:1": [4096, 4096], "2:3": [3328, 4992], "3:4": [3520, 4704], "9:16": [3040, 5504] },
  default: { "1:1": [1024, 1024], "2:3": [800,  1200], "3:4": [768,  1024], "9:16": [720,  1280] },
}

/** Derive pixel dimensions from a style model + aspect-ratio pair. */
export function getDefaultDimensions(
  styleModel: string | undefined,
  aspectRatio: string | undefined,
): { width: number; height: number } | undefined {
  if (!aspectRatio) return
  const key = getModelResolutionKey(styleModel ?? "")
  const map = STUDIO_SIZE_MAP[key] ?? STUDIO_SIZE_MAP.default
  const exact = map[aspectRatio]
  if (exact) return { width: exact[0], height: exact[1] }
  const [w, h] = aspectRatio.split(":").map(Number)
  if (!w || !h || w === h) return
  // try inverse ratio
  const inverse = `${h}:${w}`
  const inv = map[inverse]
  if (inv) return { width: inv[1], height: inv[0] }
  // compute from 1:1 base
  const base = (map["1:1"] ?? STUDIO_SIZE_MAP.default["1:1"])[0]
  if (w > h) return { width: Math.round(base * w / h), height: base }
  return { width: base, height: Math.round(base * h / w) }
}
