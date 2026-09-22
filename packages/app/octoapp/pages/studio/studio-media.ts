import { getArtifactRelativePath, getArtifactServeUrl } from "../make/utils/artifact-file-api"
import type { StudioImage } from "./types"

export function originalMediaSrc(image: StudioImage) {
  return image.remoteUrl ?? image.url
}

export function resolveStudioMediaUrl(input: { value?: string; sdkUrl: string; directory: string }): string | undefined {
  if (!input.value) return undefined
  if (/^(https?:|data:|blob:)/i.test(input.value)) return input.value
  const artifact = getArtifactRelativePath(input.value)
  if (!artifact) return undefined
  return getArtifactServeUrl(input.sdkUrl, input.directory, artifact.sessionId, artifact.relativePath)
}

export function isStudioThumbnailUrl(value?: string) {
  if (!value) return false
  const artifact = getArtifactRelativePath(value)
  if (artifact) return artifact.relativePath.replaceAll("\\", "/").startsWith("thumbnails/")
  try {
    const url = new URL(value)
    return url.pathname.endsWith("/artifact/serve") && (url.searchParams.get("path") ?? "").startsWith("thumbnails/")
  } catch {
    return false
  }
}

export function thumbnailMediaSrc(image: StudioImage): string | undefined {
  if (image.thumbnailStatus === "ready" && isStudioThumbnailUrl(image.thumbnailUrl)) return image.thumbnailUrl
  if (image.kind !== "video") return originalMediaSrc(image)
  return undefined
}
