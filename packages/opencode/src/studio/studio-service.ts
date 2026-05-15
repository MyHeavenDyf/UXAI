import type { StudioCapability } from "./image-provider"
import { executeJimengImageGenerate, summarizeJimengOutput } from "@/tool/jimeng_image_generate"

export type StudioGenerationRequest = {
  capability: StudioCapability
  prompt: string
  styleModel?: string
  aspectRatio?: string
  count?: number
  referenceImages?: string[]
  sourceImage?: string
  extra?: Record<string, unknown>
}

export type StudioGenerationResult = {
  id: string
  status: "succeeded"
  capability: StudioCapability
  prompt: string
  provider: "jimeng" | "internel"
  model: string
  aspectRatio: string
  images: { id: string; url: string; thumbnailUrl?: string; remoteUrl?: string; width?: number; height?: number }[]
  request?: unknown
  response?: unknown
  rawBody?: string
  createdAt: number
  completedAt: number
}

export async function createGeneration(input: StudioGenerationRequest): Promise<StudioGenerationResult> {
  const createdAt = Date.now()
  console.log("[studio.service] create generation", {
    capability: input.capability,
    prompt: input.prompt,
    styleModel: input.styleModel,
    aspectRatio: input.aspectRatio,
    count: input.count,
    referenceImageCount: input.referenceImages?.length ?? 0,
    hasSourceImage: Boolean(input.sourceImage),
  })
  const output = await executeJimengImageGenerate({
    capability: input.capability,
    prompt: input.prompt,
    styleModel: input.styleModel,
    aspectRatio: input.aspectRatio,
    count: input.count,
    referenceImages: input.referenceImages,
    sourceImage: input.sourceImage,
    extra: input.extra,
  })

  console.log("[studio.service] generation tool result", {
    provider: output.provider,
    model: output.model,
    statusCode: output.statusCode,
    imageCount: output.images.length,
  })

  if (output.images.length === 0) {
    throw new Error(
      [
        "Jimeng image generation returned no image URLs.",
        `request=${JSON.stringify(output.request)}`,
        `response=${JSON.stringify(summarizeJimengOutput(output.raw, output.rawBody))}`,
      ].join("\n"),
    )
  }

  return {
    id: `studio_gen_${createdAt}`,
    status: "succeeded",
    capability: input.capability,
    prompt: input.prompt,
    provider: output.provider,
    model: output.model,
    aspectRatio: input.aspectRatio ?? "3:4",
    images: output.images.map((image, index) => ({
      id: `studio_img_${createdAt}_${index}`,
      url: image.url,
      thumbnailUrl: image.url,
      remoteUrl: image.url,
      width: image.width,
      height: image.height,
    })),
    request: output.request,
    response: summarizeJimengOutput(output.raw, output.rawBody),
    createdAt,
    completedAt: Date.now(),
  }
}
