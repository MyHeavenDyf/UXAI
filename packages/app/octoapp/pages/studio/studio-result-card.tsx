import { For, Show } from "solid-js"
import { STUDIO_CAPABILITIES, capabilityLabel } from "./data"
import { isVideoMedia } from "./studio-shared"
import type { StudioCapability, StudioGenerationStatus, StudioImage } from "./types"
import type { StudioTurnData } from "./turns"

type StudioResultCardProps = {
  turn: StudioTurnData
  fallbackCapability?: StudioCapability
  busy: boolean
  onSelectImage: (input: { resultID: string; imageID: string }) => void
}

function StudioMediaPreview(props: { image: StudioImage }) {
  return (
    <Show when={isVideoMedia(props.image)} fallback={
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

export function StudioResultCard(props: StudioResultCardProps) {
  const capability = () => props.turn.result?.capability ?? props.fallbackCapability ?? "image.generate"
  const capabilityIconClass = () => {
    const index = STUDIO_CAPABILITIES.findIndex((item) => item.id === capability())
    return index <= 0 ? "studio-capability-icon" : `studio-capability-icon studio-capability-icon-${index + 1}`
  }
  const status = (): StudioGenerationStatus => {
    if (props.turn.toolError || props.turn.result?.error) return "failed"
    if (props.turn.result?.images.length) return "succeeded"
    if (props.turn.result?.status) return props.turn.result.status
    if (props.busy || props.turn.toolRunning) return "running"
    return "failed"
  }
  const generating = () => status() === "queued" || status() === "running"
  const progress = () => {
    if (status() === "succeeded") return 100
    return Math.round(Math.min(100, Math.max(0, props.turn.result?.progress ?? 0)))
  }
  const mediaLabel = () => capabilityLabel(capability())
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
      <div class="studio-result-progress-header">
        <div class="studio-result-progress-title">
          <span class={`studio-result-progress-icon ${capabilityIconClass()}`} />
          <span>{mediaLabel()}</span>
        </div>
        <span class="studio-result-progress-status">{statusLabel()}</span>
        <Show when={generating()}>
          <>
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
          </>
        </Show>
      </div>
      <div class="studio-result-progress-preview">
        <Show when={status() === "failed"}>
          <div class="studio-result-error">
            {props.turn.toolError ?? props.turn.result?.error ?? "生成失败"}
          </div>
        </Show>
        <Show when={status() === "succeeded" && props.turn.result?.images.length}>
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
        </Show>
      </div>
    </div>
  )
}
