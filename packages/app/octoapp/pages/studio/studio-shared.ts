import type { StudioAsset, StudioCapability, StudioGenerationResult, StudioImage, StudioInputImage, StudioMode } from "./types"
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
export const STUDIO_GENERATION_STATUS_INTERVAL_MS = 7_500

export function isStudioGenerationStatusRegression(
  current: StudioGenerationResult["status"],
  next: StudioGenerationResult["status"],
) {
  return (
    current === "create_failed" ||
    current === "failed" ||
    current === "succeeded"
  ) && (next === "queued" || next === "running")
}

export function isStudioGenerationFailure(status: StudioGenerationResult["status"]) {
  return status === "create_failed" || status === "failed"
}

export type StudioPendingResult = StudioGenerationResult & {
  displayPrompt?: string
  sourceImage?: string
  inputImages?: StudioInputImage[]
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
  status: "running" | "succeeded" | "create_failed" | "failed",
) {
  const label = capability === "video.generate" ? "视频生成" : "图片生成"
  if (status === "create_failed") return capability === "video.generate" ? "视频创建失败" : "图片创建失败"
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
