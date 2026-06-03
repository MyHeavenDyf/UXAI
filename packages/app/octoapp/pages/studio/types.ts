export type StudioCapability =
  | "image.generate"
  | "video.generate"
  | "image.upscale"
  | "image.cutout"
  | "image.inpaint"
  | "image.outpaint"
  | "image.fusion"

export type StudioAspectRatio = "1:1" | "2:3" | "3:4" | "9:16" | "3:2" | "4:3" | "16:9"
export type StudioImageTool = "jimeng" | "internel"

export type StudioGenerationStatus = "idle" | "submitting" | "running" | "succeeded" | "failed"

export type StudioImage = {
  id: string
  url: string
  thumbnailUrl?: string
  width?: number
  height?: number
  remoteUrl?: string
  localPath?: string
}

export type StudioGenerationRequest = {
  capability: StudioCapability
  prompt: string
  styleModel: string
  aspectRatio: StudioAspectRatio
  count: 1 | 2 | 3 | 4
  imageTool: StudioImageTool
  referenceImages: string[]
  sourceImage?: string
  extra?: Record<string, unknown>
}

export type StudioGenerationResult = {
  id: string
  status: Exclude<StudioGenerationStatus, "idle" | "submitting">
  capability: StudioCapability
  prompt: string
  provider: "mock" | "jimeng" | "internel"
  toolAction?: "generate_image" | "super_resolution" | "cutout" | "inpainting" | "outpainting"
  taskId?: string
  model: string
  aspectRatio: StudioAspectRatio
  images: StudioImage[]
  createdAt: number
  completedAt?: number
  error?: string
  request?: unknown
  response?: unknown
  rawBody?: string
}

export type StudioAsset = {
  id: string
  name: string
  mime: string
  dataUrl: string
}

export type StudioMode = "preview" | "hd" | "inpaint" | "outpaint"
