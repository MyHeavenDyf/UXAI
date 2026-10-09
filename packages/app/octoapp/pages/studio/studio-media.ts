import { getArtifactRelativePath, getArtifactServeUrl } from "../make/utils/artifact-file-api"
import type { StudioImage } from "./types"

export function formatStudioThumbnailDuration(value?: number | string) {
  const duration = typeof value === "string" ? Number(value) : value
  if (duration === undefined || !Number.isFinite(duration) || duration < 0) return
  const seconds = Math.floor(duration)
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
}

export function originalMediaSrc(image: StudioImage) {
  return image.remoteUrl ?? image.url
}

function artifactServeReference(value: string) {
  try {
    const url = new URL(value)
    if (!url.pathname.endsWith("/artifact/serve")) return
    const sessionId = url.searchParams.get("sessionId")
    const relativePath = url.searchParams.get("path")
    if (!sessionId || !relativePath) return
    return { sessionId, relativePath }
  } catch {
    return
  }
}

export function resolveStudioMediaUrl(input: { value?: string; sdkUrl: string; directory: string }): string | undefined {
  if (!input.value) return undefined
  if (/^(https?:|data:|blob:)/i.test(input.value)) return input.value
  const artifact = getArtifactRelativePath(input.value)
  if (!artifact) return undefined
  return getArtifactServeUrl(input.sdkUrl, input.directory, artifact.sessionId, artifact.relativePath)
}

export function studioThumbnailStorageValue(value?: string) {
  if (!value) return undefined
  const artifact = getArtifactRelativePath(value) ?? artifactServeReference(value)
  if (!artifact || !artifact.relativePath.replaceAll("\\", "/").startsWith("thumbnails/")) return value
  return `.octo/${artifact.sessionId}/${artifact.relativePath.replaceAll("\\", "/")}`
}

export function resolveStudioThumbnailUrl(input: { value?: string; sdkUrl: string; directory: string }) {
  return resolveStudioMediaUrl({ ...input, value: studioThumbnailStorageValue(input.value) })
}

export function isStudioThumbnailUrl(value?: string) {
  if (!value) return false
  const artifact = getArtifactRelativePath(value)
  if (artifact) return artifact.relativePath.replaceAll("\\", "/").startsWith("thumbnails/")
  return artifactServeReference(value)?.relativePath.replaceAll("\\", "/").startsWith("thumbnails/") ?? false
}

export function thumbnailMediaSrc(image: StudioImage): string | undefined {
  if (image.thumbnailStatus === "ready" && isStudioThumbnailUrl(image.thumbnailUrl)) return image.thumbnailUrl
  if (image.kind !== "video") return originalMediaSrc(image)
  return undefined
}
