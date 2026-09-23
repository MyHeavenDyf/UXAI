import { createEffect, createSignal, onCleanup, Show, type JSX } from "solid-js"
import { useProjectDir } from "@/hooks/use-project-dir"
import { useServer } from "@/context/server"
import { isVideoMedia } from "./studio-shared"
import { formatStudioThumbnailDuration, originalMediaSrc, thumbnailMediaSrc } from "./studio-media"
import { queueStudioImageThumbnail, queueStudioVideoThumbnail } from "./studio-thumbnail-generation"
import type { StudioImage } from "./types"

const mediaThumbnailStatuses = new Map<string, string>()

export function StudioMediaThumbnail(props: {
  image: StudioImage
  class?: string
  duration?: string
  durationBadge?: "result" | "file-manager"
  generationID?: string
  mediaIndex?: number
  onClick?: (event: MouseEvent) => void
}): JSX.Element {
  const server = useServer()
  const projectDir = useProjectDir({ mode: "config" })
  const [failed, setFailed] = createSignal(false)
  const [generatedThumbnail, setGeneratedThumbnail] = createSignal<string>()
  const [thumbnailFailed, setThumbnailFailed] = createSignal(false)
  const [actualDuration, setActualDuration] = createSignal<number>()
  let thumbnailAttempted = false
  const source = () => generatedThumbnail() ?? thumbnailMediaSrc(props.image)
  const videoSource = () => thumbnailFailed() ? undefined : source()
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

  const duration = () => actualDuration() ?? props.image.duration ?? props.duration

  const showThumbnail = (url: string) => {
    const loader = new Image()
    loader.onload = () => {
      setThumbnailFailed(false)
      setGeneratedThumbnail(url)
    }
    loader.onerror = () => {
      console.error("[studio.thumbnail] thumbnail preload failed", {
        generationID: props.generationID,
        mediaIndex: props.mediaIndex,
        thumbnailUrl: url,
      })
    }
    loader.src = url
  }

  const captureThumbnail = () => {
    if (
      thumbnailAttempted ||
      !props.generationID ||
      props.mediaIndex === undefined ||
      props.image.thumbnailStatus === "ready"
    ) return
    const current = server.current
    const directory = projectDir()
    if (!current || !directory) return
    thumbnailAttempted = true
    const queue = isVideoMedia(props.image) ? queueStudioVideoThumbnail : queueStudioImageThumbnail
    void queue({
      sdkUrl: current.http.url,
      username: current.http.username,
      password: current.http.password,
      directory,
      generationID: props.generationID,
      mediaIndex: props.mediaIndex,
      source: originalMediaSrc(props.image),
    }).then((url) => {
      if (!url) return
      showThumbnail(url)
    }).catch((error) => {
      console.error("[studio.thumbnail] media task failed; keeping original", {
        kind: isVideoMedia(props.image) ? "video" : "image",
        generationID: props.generationID,
        mediaIndex: props.mediaIndex,
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }

  createEffect(() => {
    if (isVideoMedia(props.image)) return
    captureThumbnail()
  })

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
              setThumbnailFailed(true)
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
                captureThumbnail()
                const video = event.currentTarget
                if (!Number.isFinite(video.duration) || video.duration <= 0) return
                setActualDuration(video.duration)
                video.currentTime = Math.min(1, Math.max(0, video.duration * 0.1))
              }}
              onLoadedData={(event) => {
                if (!event.currentTarget.seeking) captureThumbnail()
              }}
              onSeeked={captureThumbnail}
              onClick={props.onClick}
            />
          }
        >
          {media()}
        </Show>
        <Show when={props.durationBadge === "result" && formatStudioThumbnailDuration(duration())}>
          {(value) => (
            <span class="studio-file-manager-media-video-badge studio-result-video-duration-badge">
              <span class="studio-file-manager-media-video-badge-text">{value()}</span>
            </span>
          )}
        </Show>
        <Show when={props.durationBadge === "file-manager"}>
          <span class="studio-file-manager-media-video-badge">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <rect x="0.5" y="2.5" width="9" height="9" rx="1.5" stroke="white" stroke-width="1" fill="none" />
              <path
                d="M13 4.5L13 9.5Q13 10.5 12.5 10.4L10 8.5L10 5.5L12.5 3.6Q13 3.5 13 4.5Z"
                stroke="white"
                stroke-width="1"
                fill="none"
                stroke-linejoin="round"
              />
            </svg>
            <Show when={duration()}>
              <span class="studio-file-manager-media-video-badge-text">{Math.floor(Number(duration()))}s</span>
            </Show>
          </span>
        </Show>
      </span>
    </Show>
  )
}
