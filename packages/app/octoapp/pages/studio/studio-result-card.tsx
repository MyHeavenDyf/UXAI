import { For, Show } from "solid-js"
import { capabilityLabel } from "./data"
import type { StudioCapability, StudioGenerationStatus, StudioImage } from "./types"
import type { StudioTurnData } from "./turns"

type StudioResultCardProps = {
  turn: StudioTurnData
  fallbackCapability?: StudioCapability
  busy: boolean
  onSelectImage: (input: { resultID: string; imageID: string }) => void
}

function isVideo(image: StudioImage) {
  return image.kind === "video" || /^data:video\//i.test(image.url) || /\.(mp4|mov|webm)(?:[?#]|$)/i.test(image.url)
}

function StudioMediaPreview(props: { image: StudioImage }) {
  return (
    <Show when={isVideo(props.image)} fallback={
      <img src={props.image.thumbnailUrl ?? props.image.url} class="studio-result-thumb-media" alt="" />
    }>
      <video
        src={props.image.remoteUrl ?? props.image.url}
        class="studio-result-thumb-media"
        muted
        playsinline
        preload="metadata"
      />
    </Show>
  )
}

function formatTime(value: number) {
  return new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
}

export function StudioResultCard(props: StudioResultCardProps) {
  const capability = () => props.turn.result?.capability ?? props.fallbackCapability ?? "image.generate"
  const status = (): StudioGenerationStatus => {
    if (props.turn.toolError || props.turn.result?.error) return "failed"
    if (props.turn.result?.images.length) return "succeeded"
    if (props.turn.result?.status) return props.turn.result.status
    if (props.busy || props.turn.toolRunning) return "running"
    return "failed"
  }
  const progress = () => Math.round(Math.min(100, Math.max(0, props.turn.result?.progress ?? 0)))
  const generating = () => status() === "queued" || status() === "running"
  const mediaLabel = () => capability() === "video.generate" ? "视频生成" : "图片生成"
  const statusLabel = () => {
    if (status() === "queued") {
      return props.turn.result?.order === undefined ? "排队中" : `排队中，前方 ${props.turn.result.order} 人`
    }
    if (status() === "running") return "生成中"
    if (status() === "succeeded") return "生成完成"
    return "生成失败"
  }

  return (
    <div
      class="studio-result-card"
      classList={{
        generating: generating(),
        complete: status() === "succeeded",
        failed: status() === "failed",
      }}
    >
      <Show when={generating()} fallback={
        <>
          <div class="studio-result-badge">
            <span class="studio-result-badge-icon" />
            {capabilityLabel(capability())}
          </div>
          <div class="studio-result-title">{props.turn.toolTitle ?? statusLabel()}</div>
          <div class="studio-result-meta">创建时间：{formatTime(props.turn.createdAt)}</div>
          <Show when={props.turn.toolError ?? props.turn.result?.error}>
            {(error) => <div class="studio-result-error">{error()}</div>}
          </Show>
          <div class="studio-result-grid">
            <For each={props.turn.result?.images ?? []}>
              {(image) => (
                <button
                  type="button"
                  onClick={() => props.turn.result && props.onSelectImage({ resultID: props.turn.result.id, imageID: image.id })}
                  class="studio-result-thumb"
                >
                  <StudioMediaPreview image={image} />
                </button>
              )}
            </For>
          </div>
        </>
      }>
        <div class="studio-result-progress-header">
          <div class="studio-result-progress-title">
            <span class="studio-result-progress-icon" />
            <span>{mediaLabel()}</span>
          </div>
          <span class="studio-result-progress-status">{statusLabel()}</span>
          <div
            class="studio-result-progress-track"
            role="progressbar"
            aria-label={`${mediaLabel()}${statusLabel()}`}
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={progress()}
          >
            <div class="studio-result-progress-fill" style={{ width: `${progress()}%` }} />
          </div>
          <span class="studio-result-progress-percent">{progress()}%</span>
          <button type="button" class="studio-result-cancel" disabled>
            取消生成
          </button>
        </div>
        <div class="studio-result-progress-preview" />
      </Show>
    </div>
  )
}
