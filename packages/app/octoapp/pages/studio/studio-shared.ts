import type { StudioAsset, StudioCapability, StudioGenerationResult, StudioImage, StudioMode } from "./types"

export const SKIP_PART_TYPES = new Set(["patch", "step-start", "step-finish"])
export const SUPPORTED_STUDIO_CAPABILITIES = new Set<StudioCapability>([
  "image.generate",
  "video.generate",
  "image.upscale",
  "image.cutout",
  "image.inpaint",
  "image.outpaint",
])
export const STUDIO_GENERATION_CREATE_TIMEOUT_MS = 30_000
export const STUDIO_GENERATION_STATUS_INTERVAL_MS = 7_500

export type StudioPendingResult = StudioGenerationResult & {
  sourceImage?: string
}

export type StudioHDMode = "restoration_8k" | "restoration" | "super_resolution"
export type StudioInpaintMode = "qwen_image_edit" | "erase"
export type StudioVideoDuration = "5" | "10"
export type StudioVideoQualityMode = "std" | "pro"
export type StudioVideoFrameSlot = "first" | "last"

export const STUDIO_HD_MODES = [
  { label: "8k超清", value: "restoration_8k" },
  { label: "4k清晰", value: "restoration" },
  { label: "2k性能", value: "super_resolution" },
] satisfies { label: string; value: StudioHDMode }[]

export const STUDIO_VIDEO_ASPECT_RATIOS = ["1:1", "9:16", "16:9"] as const

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
  const account = recordValue(JSON.parse(localStorage.getItem("uiplusUser") || "{}"), "account")
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

export function studioGenerationTitle(capability: StudioCapability | undefined, status: "running" | "succeeded" | "failed") {
  const label = capability === "video.generate" ? "视频生成" : "图片生成"
  if (status === "failed") return `${label}失败`
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
