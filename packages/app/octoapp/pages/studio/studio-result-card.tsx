import { For, Show } from "solid-js"
import { STUDIO_CAPABILITIES, capabilityLabel } from "./data"
import { isVideoMedia } from "./studio-shared"
import type { StudioAspectRatio, StudioCapability, StudioGenerationStatus, StudioImage } from "./types"
import type { StudioTurnData } from "./turns"

const PORTRAIT_RATIOS: StudioAspectRatio[] = ["2:3", "3:4", "9:16"]
const LANDSCAPE_RATIOS: StudioAspectRatio[] = ["16:9", "3:2", "4:3"]

type StudioResultCardProps = {
  turn: StudioTurnData
  fallbackCapability?: StudioCapability
  busy: boolean
  cancelling: boolean
  onCancelGeneration: (generationID: string) => void
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
  const cancellable = () => generating() && props.turn.result?.id.startsWith("studio_gen")
  const progress = () => {
    if (status() === "succeeded") return 100
    return Math.round(Math.min(100, Math.max(0, props.turn.result?.progress ?? 0)))
  }
  const mediaLabel = () => capabilityLabel(capability())
  const createdAt = () => {
    if (!props.turn.createdAt) return ""
    return new Date(props.turn.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
  }
  const isPortrait = () => {
    const img = props.turn.result?.images?.[0]
    if (!img) return false
    if (img.width && img.height) return img.height > img.width
    return PORTRAIT_RATIOS.includes(props.turn.result?.aspectRatio ?? "1:1")
  }
  const isLandscape = () => {
    const img = props.turn.result?.images?.[0]
    if (!img) return false
    if (img.width && img.height) return img.width > img.height
    return LANDSCAPE_RATIOS.includes(props.turn.result?.aspectRatio ?? "1:1")
  }
  const isSinglePortrait = () => isPortrait() && (props.turn.result?.images.length ?? 0) === 1
  const isSingleLandscape = () => isLandscape() && (props.turn.result?.images.length ?? 0) === 1
  const isMultiPortrait = () => isPortrait() && (props.turn.result?.images.length ?? 0) > 1
  const isMultiLandscape = () => isLandscape() && (props.turn.result?.images.length ?? 0) > 1 && (props.turn.result?.images.length ?? 0) < 4
  const isMultiLandscape4 = () => isLandscape() && (props.turn.result?.images.length ?? 0) === 4
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
            <Show when={cancellable()}>
              <button
                type="button"
                class="studio-result-cancel"
                disabled={props.cancelling}
                onClick={() => props.turn.result && props.onCancelGeneration(props.turn.result.id)}
              >
                {props.cancelling ? "取消中..." : "取消生成"}
              </button>
            </Show>
          </>
        </Show>
      </div>
      <Show when={createdAt()}>
        <div class="studio-result-meta">创建时间：{createdAt()}</div>
      </Show>
      <div class="studio-result-progress-preview">
        <Show when={status() === "failed"}>
          <div class="studio-result-error">
            {props.turn.toolError ?? props.turn.result?.error ?? "生成失败"}
          </div>
        </Show>
        <Show when={status() === "succeeded" && props.turn.result?.images.length}>
          <div class="studio-result-grid" classList={{ "single-portrait": isSinglePortrait(), "single-landscape": isSingleLandscape(), "multi-portrait": isMultiPortrait(), "multi-landscape": isMultiLandscape(), "multi-landscape-4": isMultiLandscape4() }}>
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
