export type StudioCapability =
  | "image.generate"
  | "video.generate"
  | "image.upscale"
  | "image.cutout"
  | "image.inpaint"
  | "image.outpaint"
  | "image.fusion"

// 请求档位优先，合法结果档位兜底；旧 provider 的 std/pro 不能确定分辨率。
export function resolveStudioVideoQualityMode(input: unknown, fallback?: unknown) {
  const extra = input && typeof input === "object" && "extra" in input ? input.extra : undefined
  const resolution = extra && typeof extra === "object" && "resolution" in extra ? extra.resolution : undefined
  if (resolution === "480p") return "480"
  if (resolution === "720p") return "720"
  if (resolution === "1080p") return "1080"
  if (resolution === "4k") return "4k"
  if (fallback === "480" || fallback === "720" || fallback === "1080" || fallback === "4k") return fallback
}

export type ImageGenerateInput = {
  capability: StudioCapability
  prompt: string
  aspectRatio?: string
  count?: number
  styleModel?: string
  referenceImages?: string[]
  sourceImage?: string
  extra?: Record<string, unknown>
}

export type ImageGenerateOutput = {
  provider: "jimeng" | "internel"
  model: string
  capability?: StudioCapability
  toolAction?: "generate_image" | "generate_video" | "super_resolution" | "cutout" | "inpainting" | "outpainting"
  taskId?: string
  duration?: string
  images: { kind?: "image" | "video"; url: string; thumbnailUrl?: string; width?: number; height?: number; duration?: number }[]
  request?: unknown
  statusCode?: number
  rawBody?: string
  raw: unknown
}

export type ImageGenerationStatus = "queued" | "running" | "succeeded" | "failed"

export type ImageGenerationTask = {
  provider: "internel"
  model: string
  capability: StudioCapability
  toolAction: NonNullable<ImageGenerateOutput["toolAction"]>
  taskId: string
  input?: ImageGenerateInput
  request: unknown
}

export type ImageGenerationQuery = ImageGenerateOutput & {
  status: ImageGenerationStatus
  rawStatus: number | string
  progress: number
  order?: number
  error?: string
}

export type ImageGenerationProvider = {
  generate: (input: ImageGenerateInput) => Promise<ImageGenerateOutput>
  edit: (input: ImageGenerateInput) => Promise<ImageGenerateOutput>
}
