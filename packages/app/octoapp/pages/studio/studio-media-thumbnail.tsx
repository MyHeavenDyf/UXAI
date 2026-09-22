import { createEffect, createSignal, onCleanup, Show, type JSX } from "solid-js"
import { isVideoMedia } from "./studio-shared"
import { originalMediaSrc, thumbnailMediaSrc } from "./studio-media"
import type { StudioImage } from "./types"

export function StudioMediaThumbnail(props: {
  image: StudioImage
  class?: string
  duration?: string
  onClick?: (event: MouseEvent) => void
}): JSX.Element {
  const [failed, setFailed] = createSignal(false)
  const source = () => thumbnailMediaSrc(props.image)
  const [displayedSource, setDisplayedSource] = createSignal(source())
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
            const original = originalMediaSrc(props.image)
            if (!isVideoMedia(props.image) && displayedSource() !== original) {
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
        {media()}
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
