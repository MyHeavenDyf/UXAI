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
  images: { url: string; width?: number; height?: number }[]
  request?: unknown
  statusCode?: number
  rawBody?: string
  raw: unknown
}

export type ImageGenerationProvider = {
  generate: (input: ImageGenerateInput) => Promise<ImageGenerateOutput>
  edit: (input: ImageGenerateInput) => Promise<ImageGenerateOutput>
}
