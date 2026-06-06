export type StudioCapability =
  | "image.generate"
  | "video.generate"
  | "image.upscale"
  | "image.cutout"
  | "image.inpaint"
  | "image.outpaint"
  | "image.fusion"

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
  images: { kind?: "image" | "video"; url: string; thumbnailUrl?: string; width?: number; height?: number; duration?: number }[]
  request?: unknown
  statusCode?: number
  rawBody?: string
  raw: unknown
}

export type ImageGenerationProvider = {
  generate: (input: ImageGenerateInput) => Promise<ImageGenerateOutput>
  edit: (input: ImageGenerateInput) => Promise<ImageGenerateOutput>
}
