import { createEffect, createSignal, onCleanup, Show, type JSX } from "solid-js"
import { useProjectDir } from "@/hooks/use-project-dir"
import { useServer } from "@/context/server"
import { authTokenFromCredentials } from "@/utils/server"
import { directoryHeader } from "@/utils/headers"
import { isVideoMedia } from "./studio-shared"
import { originalMediaSrc, resolveStudioMediaUrl, thumbnailMediaSrc } from "./studio-media"
import type { StudioImage } from "./types"

const videoPosterTasks = new Map<string, Promise<string | undefined>>()
const videoPosterResults = new Map<string, string>()
const mediaThumbnailStatuses = new Map<string, string>()
let videoPosterSequence = Promise.resolve()

function videoPosterIdle() {
  return new Promise<void>((resolve) => {
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(() => resolve(), { timeout: 1_000 })
      return
    }
    window.setTimeout(resolve, 0)
  })
}

function queueVideoPoster(run: () => Promise<string | undefined>) {
  const task = videoPosterSequence
    .then(videoPosterIdle)
    .then(run)
  videoPosterSequence = task.then(
    () => undefined,
    () => undefined,
  )
  return task
}

function videoFrameContent(video: HTMLVideoElement) {
  return new Promise<string>((resolve, reject) => {
    if (!video.videoWidth || !video.videoHeight) {
      reject(new Error("Studio video dimensions are unavailable."))
      return
    }
    const displayScale = Math.min(420 / video.videoWidth, 210 / video.videoHeight)
    const scale = Math.min(1, displayScale * 1.5, 768 / Math.max(video.videoWidth, video.videoHeight))
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
    const context = canvas.getContext("2d")
    if (!context) {
      reject(new Error("Studio video poster canvas is unavailable."))
      return
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Studio video poster encoding failed."))
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        const value = typeof reader.result === "string" ? reader.result.split(",")[1] : undefined
        if (value) resolve(value)
        else reject(new Error("Studio video poster encoding returned no data."))
      }
      reader.onerror = () => reject(reader.error ?? new Error("Studio video poster could not be read."))
      reader.readAsDataURL(blob)
    }, "image/webp", 0.8)
  })
}

function videoPosterContent(source: string) {
  return new Promise<string>((resolve, reject) => {
    const video = document.createElement("video")
    let target = 0
    let encoding = false
    let settled = false
    let timeout = 0
    const cleanup = () => {
      window.clearTimeout(timeout)
      video.onloadedmetadata = null
      video.onloadeddata = null
      video.onseeked = null
      video.onerror = null
      video.removeAttribute("src")
      video.load()
    }
    const finish = () => {
      if (settled || encoding || !video.videoWidth || !video.videoHeight) return
      encoding = true
      void videoFrameContent(video).then(
        (content) => {
          if (settled) return
          settled = true
          cleanup()
          resolve(content)
        },
        (error) => {
          if (settled) return
          settled = true
          cleanup()
          reject(error)
        },
      )
    }
    video.crossOrigin = "anonymous"
    video.muted = true
    video.preload = "auto"
    video.onloadedmetadata = () => {
      target = Number.isFinite(video.duration) && video.duration > 0
        ? Math.min(1, Math.max(0, video.duration * 0.1))
        : 0
      if (target === 0) {
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) finish()
        return
      }
      video.currentTime = target
    }
    video.onloadeddata = () => {
      if (!video.seeking && (target === 0 || Math.abs(video.currentTime - target) < 0.1)) finish()
    }
    video.onseeked = finish
    video.onerror = () => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error("Studio video poster source could not be loaded."))
    }
    timeout = window.setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error("Studio video poster capture timed out."))
    }, 15_000)
    video.src = source
    video.load()
  })
}

export function StudioMediaThumbnail(props: {
  image: StudioImage
  class?: string
  duration?: string
  generationID?: string
  mediaIndex?: number
  onClick?: (event: MouseEvent) => void
}): JSX.Element {
  const server = useServer()
  const projectDir = useProjectDir({ mode: "config" })
  const [failed, setFailed] = createSignal(false)
  const [videoPoster, setVideoPoster] = createSignal<string>()
  const [videoPosterFailed, setVideoPosterFailed] = createSignal(false)
  let videoPosterAttempted = false
  const source = () => videoPoster() ?? thumbnailMediaSrc(props.image)
  const videoSource = () => videoPosterFailed() ? undefined : source()
  const [displayedSource, setDisplayedSource] = createSignal(source())
  createEffect(() => {
    if (!props.generationID || props.mediaIndex === undefined) return
    const status = props.image.thumbnailStatus ?? "missing"
    const key = `${server.current?.http.url ?? "unknown"}:${projectDir()}:${props.generationID}:${props.mediaIndex}`
    if (mediaThumbnailStatuses.get(key) === status) return
    mediaThumbnailStatuses.set(key, status)
    const details = {
      kind: isVideoMedia(props.image) ? "video" : "image",
      generationID: props.generationID,
      mediaIndex: props.mediaIndex,
      status,
      thumbnailUrl: props.image.thumbnailUrl,
    }
    if (status === "failed") {
      console.error("[studio.thumbnail] media state changed", details)
      return
    }
    console.info("[studio.thumbnail] media state changed", details)
  })
  createEffect(() => {
    const next = source()
    if (!next) {
      setDisplayedSource(undefined)
      setFailed(false)
      return
    }
    if (!displayedSource()) {
      setDisplayedSource(next)
      setFailed(false)
      return
    }
    if (displayedSource() === next) return
    const loader = new Image()
    const apply = () => {
      setDisplayedSource(next)
      setFailed(false)
    }
    loader.onload = apply
    loader.src = next
    onCleanup(() => {
      loader.onload = null
      loader.onerror = null
    })
  })
  const duration = () => {
    if (props.image.duration && Number.isFinite(props.image.duration)) return String(Math.floor(props.image.duration))
    return props.duration
  }
  const showVideoPoster = (url: string) => {
    const loader = new Image()
    loader.onload = () => {
      setVideoPosterFailed(false)
      setVideoPoster(url)
    }
    loader.onerror = () => {
      console.error("[studio.thumbnail] video poster preload failed", {
        generationID: props.generationID,
        mediaIndex: props.mediaIndex,
        thumbnailUrl: url,
      })
    }
    loader.src = url
  }
  const captureVideoPoster = () => {
    if (
      videoPosterAttempted ||
      !props.generationID ||
      props.mediaIndex === undefined ||
      props.image.thumbnailStatus === "ready"
    ) return
    const current = server.current
    const directory = projectDir()
    if (!current || !directory) return
    videoPosterAttempted = true
    const key = `${current.http.url}:${directory}:${props.generationID}:${props.mediaIndex}`
    const saved = videoPosterResults.get(key)
    if (saved) {
      showVideoPoster(saved)
      return
    }
    const existing = videoPosterTasks.get(key)
    const task = existing ??
      queueVideoPoster(() => {
        console.info("[studio.thumbnail] video poster capture started", {
          generationID: props.generationID,
          mediaIndex: props.mediaIndex,
        })
        return videoPosterContent(originalMediaSrc(props.image)).then(async (content) => {
          console.info("[studio.thumbnail] video poster captured; submitting", {
            generationID: props.generationID,
            mediaIndex: props.mediaIndex,
            encodedBytes: Math.floor(content.length * 0.75),
          })
          const headers: Record<string, string> = {
            "content-type": "application/json",
            ...directoryHeader(directory),
          }
          if (current.http.password) {
            headers.Authorization = `Basic ${authTokenFromCredentials({
              username: current.http.username,
              password: current.http.password,
            })}`
          }
          const response = await fetch(
            new URL(`/studio/generations/${encodeURIComponent(props.generationID!)}/video-poster`, current.http.url),
            {
              method: "POST",
              headers,
              body: JSON.stringify({ mediaIndex: props.mediaIndex, content }),
            },
          )
          if (!response.ok) throw new Error(`Studio video poster save failed with status ${response.status}.`)
          const result = await response.json() as { thumbnailUrl?: string }
          const url = resolveStudioMediaUrl({ value: result.thumbnailUrl, sdkUrl: current.http.url, directory })
          if (!url) throw new Error("Studio video poster save returned no usable thumbnail URL.")
          console.info("[studio.thumbnail] video poster saved", {
            generationID: props.generationID,
            mediaIndex: props.mediaIndex,
            thumbnailUrl: url,
          })
          return url
        })
      }).catch((error) => {
        console.error("[studio.thumbnail] video poster failed; keeping original video", {
          generationID: props.generationID,
          mediaIndex: props.mediaIndex,
          error: error instanceof Error ? error.message : String(error),
        })
        return undefined
      })
    if (!existing) {
      console.info("[studio.thumbnail] video poster queued", {
        generationID: props.generationID,
        mediaIndex: props.mediaIndex,
      })
      videoPosterTasks.set(key, task)
      void task
        .then((url) => {
          if (url) videoPosterResults.set(key, url)
        })
        .finally(() => {
          if (videoPosterTasks.get(key) === task) videoPosterTasks.delete(key)
        })
    } else {
      console.info("[studio.thumbnail] video poster reused queued task", {
        generationID: props.generationID,
        mediaIndex: props.mediaIndex,
      })
    }
    void task.then((url) => {
      if (!url) return
      showVideoPoster(url)
    })
  }
  const media = () => (
    <Show
      when={!failed() ? displayedSource() : undefined}
      fallback={
        <span
          class={`studio-media-thumbnail-placeholder ${props.class ?? ""}`}
          classList={{ video: isVideoMedia(props.image), failed: props.image.thumbnailStatus === "failed" }}
          aria-label={isVideoMedia(props.image) ? "视频缩略图" : "图片缩略图"}
        >
          <Show when={isVideoMedia(props.image)} fallback={<span class="studio-media-thumbnail-image-icon" />}>
            <span class="studio-media-thumbnail-video-icon" />
          </Show>
        </span>
      }
    >
      {(src) => (
        <img
          src={src()}
          class={props.class}
          alt=""
          loading="lazy"
          decoding="async"
          onClick={props.onClick}
          onError={() => {
            if (isVideoMedia(props.image)) {
              setVideoPosterFailed(true)
              setFailed(false)
              return
            }
            const original = originalMediaSrc(props.image)
            if (displayedSource() !== original) {
              setDisplayedSource(original)
              setFailed(false)
              return
            }
            setFailed(true)
          }}
          onDragStart={(event) => {
            event.dataTransfer?.setData("application/x-octo-studio-image", originalMediaSrc(props.image))
            if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy"
          }}
        />
      )}
    </Show>
  )
  return (
    <Show when={isVideoMedia(props.image)} fallback={media()}>
      <span class="studio-result-thumb-video">
        <Show
          when={videoSource()}
          fallback={
            <video
              src={originalMediaSrc(props.image)}
              class={props.class}
              muted
              playsinline
              preload="metadata"
              onLoadedMetadata={(event) => {
                captureVideoPoster()
                const video = event.currentTarget
                if (!Number.isFinite(video.duration) || video.duration <= 0) return
                video.currentTime = Math.min(1, Math.max(0, video.duration * 0.1))
              }}
              onLoadedData={(event) => {
                if (!event.currentTarget.seeking) captureVideoPoster()
              }}
              onSeeked={captureVideoPoster}
              onClick={props.onClick}
            />
          }
        >
          {media()}
        </Show>
        <span class="studio-file-manager-media-video-badge">
          <span class="studio-media-thumbnail-video-icon small" />
          <Show when={duration()}>
            <span class="studio-file-manager-media-video-badge-text">{duration()}s</span>
          </Show>
        </span>
      </span>
    </Show>
  )
}
