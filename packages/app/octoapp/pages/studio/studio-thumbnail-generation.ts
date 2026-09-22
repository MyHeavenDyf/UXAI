import { authTokenFromCredentials } from "@/utils/server"
import { directoryHeader } from "@/utils/headers"
import { resolveStudioMediaUrl } from "./studio-media"

const MAX_CSS_WIDTH = 420
const MAX_CSS_HEIGHT = 210
export const STUDIO_THUMBNAIL_TARGET_DPR = 1.5
const ABSOLUTE_MAX_EDGE = 768
const MAX_ATTEMPTS = 3

type StudioThumbnailQueueInput = {
  sdkUrl: string
  username?: string
  password?: string
  directory: string
  generationID: string
  mediaIndex: number
  source: string
}

const tasks = new Map<string, Promise<string | undefined>>()
const results = new Map<string, string>()
const controllers = new Map<string, AbortController>()
let sequence = Promise.resolve()

export function studioThumbnailDimensions(sourceWidth: number, sourceHeight: number) {
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error("Thumbnail source dimensions are invalid.")
  }
  const displayScale = Math.min(MAX_CSS_WIDTH / sourceWidth, MAX_CSS_HEIGHT / sourceHeight)
  const scale = Math.min(
    1,
    displayScale * STUDIO_THUMBNAIL_TARGET_DPR,
    ABSOLUTE_MAX_EDGE / Math.max(sourceWidth, sourceHeight),
  )
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  }
}

function taskKey(input: StudioThumbnailQueueInput) {
  return `${input.sdkUrl}:${input.directory}:${input.generationID}:${input.mediaIndex}`
}

function scopeKey(input: Pick<StudioThumbnailQueueInput, "sdkUrl" | "directory">) {
  return `${input.sdkUrl}:${input.directory}:`
}

function authHeaders(input: StudioThumbnailQueueInput) {
  const headers: Record<string, string> = { ...directoryHeader(input.directory) }
  if (!input.password) return headers
  headers.Authorization = `Basic ${authTokenFromCredentials({
    username: input.username,
    password: input.password,
  })}`
  return headers
}

function idle(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const abort = () => reject(signal.reason)
    signal.addEventListener("abort", abort, { once: true })
    const done = () => {
      signal.removeEventListener("abort", abort)
      if (signal.aborted) reject(signal.reason)
      else resolve()
    }
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(done, { timeout: 1_000 })
      return
    }
    window.setTimeout(done, 0)
  })
}

function abortableDelay(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", abort)
      resolve()
    }, milliseconds)
    const abort = () => {
      window.clearTimeout(timer)
      reject(signal.reason)
    }
    signal.addEventListener("abort", abort, { once: true })
  })
}

function blobContent(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result.split(",")[1] : undefined
      if (value) resolve(value)
      else reject(new Error("Studio thumbnail encoding returned no data."))
    }
    reader.onerror = () => reject(reader.error ?? new Error("Studio thumbnail could not be read."))
    reader.readAsDataURL(blob)
  })
}

function canvasContent(source: CanvasImageSource, sourceWidth: number, sourceHeight: number) {
  return new Promise<string>((resolve, reject) => {
    const size = studioThumbnailDimensions(sourceWidth, sourceHeight)
    const canvas = document.createElement("canvas")
    canvas.width = size.width
    canvas.height = size.height
    const context = canvas.getContext("2d")
    if (!context) {
      reject(new Error("Studio thumbnail canvas is unavailable."))
      return
    }
    context.drawImage(source, 0, 0, size.width, size.height)
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Studio thumbnail encoding failed."))
          return
        }
        void blobContent(blob).then(resolve, reject)
      },
      "image/webp",
      0.8,
    )
  })
}

async function imageContent(input: StudioThumbnailQueueInput, signal: AbortSignal) {
  const response = await fetch(
    new URL(
      `/studio/generations/${encodeURIComponent(input.generationID)}/media/${input.mediaIndex}/thumbnail-source`,
      input.sdkUrl,
    ),
    { headers: authHeaders(input), signal },
  )
  if (!response.ok) throw new Error(`Studio thumbnail source failed with status ${response.status}.`)
  const blob = await response.blob()
  console.info("[studio.thumbnail] image source loaded", {
    generationID: input.generationID,
    mediaIndex: input.mediaIndex,
    bytes: blob.size,
  })
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" })
    try {
      return await canvasContent(bitmap, bitmap.width, bitmap.height)
    } finally {
      bitmap.close()
    }
  }
  const url = URL.createObjectURL(blob)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error("Studio thumbnail source could not be decoded."))
      element.src = url
    })
    return await canvasContent(image, image.naturalWidth, image.naturalHeight)
  } finally {
    URL.revokeObjectURL(url)
  }
}

function videoContent(source: string, signal: AbortSignal) {
  return new Promise<string>((resolve, reject) => {
    const video = document.createElement("video")
    let target = 0
    let encoding = false
    let settled = false
    const timeout = window.setTimeout(() => finish(new Error("Studio video poster capture timed out.")), 15_000)
    const cleanup = () => {
      window.clearTimeout(timeout)
      signal.removeEventListener("abort", abort)
      video.onloadedmetadata = null
      video.onloadeddata = null
      video.onseeked = null
      video.onerror = null
      video.removeAttribute("src")
      video.load()
    }
    const finish = (error?: unknown, content?: string) => {
      if (settled) return
      settled = true
      cleanup()
      if (error) reject(error)
      else if (content) resolve(content)
      else reject(new Error("Studio video poster encoding returned no data."))
    }
    const capture = () => {
      if (settled || encoding || !video.videoWidth || !video.videoHeight) return
      encoding = true
      void canvasContent(video, video.videoWidth, video.videoHeight).then(
        (content) => finish(undefined, content),
        (error) => finish(error),
      )
    }
    const abort = () => finish(signal.reason ?? new DOMException("Aborted", "AbortError"))
    signal.addEventListener("abort", abort, { once: true })
    video.crossOrigin = "anonymous"
    video.muted = true
    video.preload = "auto"
    video.onloadedmetadata = () => {
      target =
        Number.isFinite(video.duration) && video.duration > 0 ? Math.min(1, Math.max(0, video.duration * 0.1)) : 0
      if (target === 0) {
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) capture()
        return
      }
      video.currentTime = target
    }
    video.onloadeddata = () => {
      if (!video.seeking && (target === 0 || Math.abs(video.currentTime - target) < 0.1)) capture()
    }
    video.onseeked = capture
    video.onerror = () => finish(new Error("Studio video poster source could not be loaded."))
    video.src = source
    video.load()
  })
}

async function save(input: StudioThumbnailQueueInput, content: string, signal: AbortSignal) {
  console.info("[studio.thumbnail] media encoded", {
    generationID: input.generationID,
    mediaIndex: input.mediaIndex,
    encodedBytes: Math.floor(content.length * 0.75),
  })
  const response = await fetch(
    new URL(
      `/studio/generations/${encodeURIComponent(input.generationID)}/media/${input.mediaIndex}/thumbnail`,
      input.sdkUrl,
    ),
    {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders(input) },
      body: JSON.stringify({ content }),
      signal,
    },
  )
  if (!response.ok) throw new Error(`Studio thumbnail save failed with status ${response.status}.`)
  const result = (await response.json()) as { thumbnailUrl?: string }
  const url = resolveStudioMediaUrl({ value: result.thumbnailUrl, sdkUrl: input.sdkUrl, directory: input.directory })
  if (!url) throw new Error("Studio thumbnail save returned no usable thumbnail URL.")
  return url
}

function queue(input: StudioThumbnailQueueInput, kind: "image" | "video") {
  const key = taskKey(input)
  const saved = results.get(key)
  if (saved) return Promise.resolve(saved)
  const existing = tasks.get(key)
  if (existing) {
    console.info("[studio.thumbnail] reused queued task", {
      kind,
      generationID: input.generationID,
      mediaIndex: input.mediaIndex,
    })
    return existing
  }
  const controller = new AbortController()
  controllers.set(key, controller)
  const run = async () => {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        await idle(controller.signal)
        console.info("[studio.thumbnail] media generation started", {
          kind,
          generationID: input.generationID,
          mediaIndex: input.mediaIndex,
          attempt,
        })
        const content =
          kind === "image"
            ? await imageContent(input, controller.signal)
            : await videoContent(input.source, controller.signal)
        return await save(input, content, controller.signal)
      } catch (error) {
        if (controller.signal.aborted) {
          console.info("[studio.thumbnail] media generation aborted", {
            kind,
            generationID: input.generationID,
            mediaIndex: input.mediaIndex,
          })
          return undefined
        }
        if (attempt === MAX_ATTEMPTS) {
          console.error("[studio.thumbnail] media generation failed; keeping original", {
            kind,
            generationID: input.generationID,
            mediaIndex: input.mediaIndex,
            error: error instanceof Error ? error.message : String(error),
          })
          return undefined
        }
        console.warn("[studio.thumbnail] media generation will retry", {
          kind,
          generationID: input.generationID,
          mediaIndex: input.mediaIndex,
          attempt,
          error: error instanceof Error ? error.message : String(error),
        })
        await abortableDelay(Math.min(4_000, 500 * 2 ** attempt), controller.signal).catch(() => undefined)
        if (controller.signal.aborted) return undefined
      }
    }
    return undefined
  }
  const task = sequence.then(run, run)
  sequence = task.then(
    () => undefined,
    () => undefined,
  )
  tasks.set(key, task)
  console.info("[studio.thumbnail] media queued", {
    kind,
    generationID: input.generationID,
    mediaIndex: input.mediaIndex,
  })
  void task
    .then((url) => {
      if (url) results.set(key, url)
    })
    .finally(() => {
      if (tasks.get(key) === task) tasks.delete(key)
      if (controllers.get(key) === controller) controllers.delete(key)
    })
  return task
}

export function queueStudioImageThumbnail(input: StudioThumbnailQueueInput) {
  return queue(input, "image")
}

export function queueStudioVideoThumbnail(input: StudioThumbnailQueueInput) {
  return queue(input, "video")
}

export function stopStudioThumbnailQueue(input: Pick<StudioThumbnailQueueInput, "sdkUrl" | "directory">) {
  const prefix = scopeKey(input)
  Array.from(controllers.entries())
    .filter(([key]) => key.startsWith(prefix))
    .forEach(([, controller]) => controller.abort(new DOMException("Studio page closed", "AbortError")))
  Array.from(results.keys())
    .filter((key) => key.startsWith(prefix))
    .forEach((key) => results.delete(key))
}
