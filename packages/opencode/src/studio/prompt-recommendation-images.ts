import { open, realpath } from "node:fs/promises"
import path from "node:path"
import { sniffAttachmentMime } from "@/util/media"
import { RecommendationError, type ExpansionInput } from "./prompt-recommendation-schema"

// Files are created by the existing artifact upload API; Studio only reads session-owned uploads.
export async function readRecommendationImages(images: { path: string }[], folder: string, signal?: AbortSignal) {
  if (!images.length) return []
  try {
    const root = await realpath(folder)
    let total = 0
    const result: ExpansionInput["images"] = []
    for (const image of images) {
      if (!path.isAbsolute(image.path)) throw new RecommendationError("INVALID_INPUT")
      const relative = path.relative(root, await realpath(image.path))
      if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
        throw new RecommendationError("INVALID_INPUT")
      const file = await open(path.join(root, relative), "r")
      const bytes = await (async () => {
        try {
          const info = await file.stat()
          if (!info.isFile() || info.size === 0 || info.size > 10 * 1024 * 1024 || total + info.size > 20 * 1024 * 1024)
            throw new RecommendationError("INVALID_INPUT")
          return await file.readFile({ signal })
        } finally {
          await file.close()
        }
      })()
      total += bytes.length
      if (!bytes.length || bytes.length > 10 * 1024 * 1024 || total > 20 * 1024 * 1024)
        throw new RecommendationError("INVALID_INPUT")
      const mime = sniffAttachmentMime(bytes, "")
      if (mime !== "image/png" && mime !== "image/jpeg" && mime !== "image/webp")
        throw new RecommendationError("INVALID_INPUT")
      result.push({ path: path.join(root, relative), mime, base64: bytes.toString("base64") })
    }
    return result
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof RecommendationError) throw error
    throw new RecommendationError("ATTACHMENT_READ_FAILED")
  }
}
