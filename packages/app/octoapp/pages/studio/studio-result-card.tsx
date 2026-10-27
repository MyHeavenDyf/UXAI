import { For, Show } from "solid-js"
import { tracker } from "@/utils/tracker"
import { STUDIO_CAPABILITIES, capabilityLabel } from "./data"
import { studioResultCardStatus } from "./studio-shared"
import type { StudioAspectRatio, StudioCapability, StudioGenerationResult, StudioGenerationStatus } from "./types"
import type { StudioTurnData } from "./turns"
import { StudioMediaThumbnail } from "./studio-media-thumbnail"

const PORTRAIT_RATIOS: StudioAspectRatio[] = ["2:3", "3:4", "9:16"]
const LANDSCAPE_RATIOS: StudioAspectRatio[] = ["16:9", "3:2", "4:3", "21:9"]

type StudioResultCardProps = {
  turn: StudioTurnData
  fallbackCapability?: StudioCapability
  busy: boolean
  actionBusy: boolean
  cancelling: boolean
  rebooting: boolean
  refreshing: boolean
  onCancelGeneration: (generationID: string) => void
  onEditGeneration: (result: StudioGenerationResult) => void
  onRebootGeneration: (generationID: string) => void
  onRefreshGeneration: (generationID: string) => void
  onSelectImage: (input: { resultID: string; imageID: string }) => void
}

export function StudioResultCard(props: StudioResultCardProps) {
  const capability = () => props.turn.result?.capability ?? props.fallbackCapability ?? "image.generate"
  const capabilityIconClass = () => {
    const index = STUDIO_CAPABILITIES.findIndex((item) => item.id === capability())
    return index <= 0 ? "studio-capability-icon" : `studio-capability-icon studio-capability-icon-${index + 1}`
  }
  const status = (): StudioGenerationStatus => studioResultCardStatus({
    result: props.turn.result,
    toolError: props.turn.toolError,
    busy: props.busy,
    toolRunning: Boolean(props.turn.toolRunning),
  })
  const generating = () => status() === "creating" || status() === "queued" || status() === "running"
  const cancellable = () => generating() && props.turn.result?.id.startsWith("studio_gen")
  const editable = () =>
    Boolean(props.turn.result) &&
    !generating() &&
    (capability() === "image.generate" || capability() === "video.generate")
  const rebootable = () =>
    status() === "failed" &&
    props.turn.result?.provider === "internel" &&
    Boolean(props.turn.result?.taskId) &&
    Boolean(props.turn.result?.id.startsWith("studio_gen"))
  const refreshable = () =>
    status() === "abnormal" &&
    props.turn.result?.provider === "internel" &&
    Boolean(props.turn.result?.taskId) &&
    Boolean(props.turn.result?.id.startsWith("studio_gen"))
  const progress = () => {
    if (status() === "succeeded") return 100
    return Math.round(Math.min(100, Math.max(0, props.turn.result?.progress ?? 0)))
  }
  const mediaLabel = () => capabilityLabel(capability())
  const createdAt = () => {
    if (!props.turn.createdAt) return ""
    return new Date(props.turn.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
  }
  const is1x1 = () => {
    const img = props.turn.result?.images?.[0]
    if (img?.width && img?.height) return img.width === img.height
    return props.turn.result?.aspectRatio === "1:1"
  }
  const isPortrait = () => {
    const img = props.turn.result?.images?.[0]
    if (img?.width && img?.height) return img.height > img.width
    return PORTRAIT_RATIOS.includes(props.turn.result?.aspectRatio ?? "1:1")
  }
  const isLandscape = () => {
    const img = props.turn.result?.images?.[0]
    if (img?.width && img?.height) return img.width > img.height
    return LANDSCAPE_RATIOS.includes(props.turn.result?.aspectRatio ?? "1:1")
  }
  const isSinglePortrait = () => isPortrait() && (props.turn.result?.images.length ?? 0) === 1
  const isSingleLandscape = () => isLandscape() && (props.turn.result?.images.length ?? 0) === 1
  const isMultiPortrait = () => isPortrait() && (props.turn.result?.images.length ?? 0) > 1
  const isMultiLandscape = () => isLandscape() && (props.turn.result?.images.length ?? 0) > 1
  const isSingle1x1 = () => is1x1() && (props.turn.result?.images.length ?? 0) === 1
  const isMulti1x1 = () => is1x1() && (props.turn.result?.images.length ?? 0) > 1
  const statusLabel = () => {
    if (status() === "creating") return "创建中"
    if (status() === "queued") return "排队中"
    if (status() === "running") return "生成中"
    if (status() === "succeeded") return "生成完成"
    if (status() === "create_failed") return "创建失败"
    if (status() === "abnormal") return "状态异常"
    return "生成失败"
  }

  return (
    <div
      class="studio-result-card"
      classList={{
        generating: generating(),
        queued: status() === "queued",
        complete: status() === "succeeded",
        failed: status() === "failed" || status() === "create_failed",
        abnormal: status() === "abnormal",
      }}
    >
      <div class="studio-result-progress-header">
        <div class="studio-result-progress-left">
          <div class="studio-result-progress-title">
            <span class={`studio-result-progress-icon ${capabilityIconClass()}`} />
            <span>{mediaLabel()}</span>
          </div>
          <span class="studio-result-progress-status" classList={{ invisible: !statusLabel() }}>{statusLabel()}</span>
          <Show when={status() === "queued"}>
            <span class="studio-result-queue-count">当前排队{props.turn.result?.order || 1}人</span>
          </Show>
          <Show when={status() === "running"}>
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
            </>
          </Show>
        </div>
        <div class="studio-result-progress-actions">
          <Show when={generating() && cancellable()}>
            <button
              type="button"
              class="studio-result-action studio-result-cancel"
              disabled={props.cancelling}
              onClick={() => props.turn.result && props.onCancelGeneration(props.turn.result.id)}
            >
              {props.cancelling ? "取消中..." : "取消生成"}
            </button>
          </Show>
          <Show when={editable() && props.turn.result}>
            {(result) => (
              <button
                type="button"
                class="studio-result-action studio-result-edit"
                disabled={props.actionBusy || props.rebooting}
                onClick={() => props.onEditGeneration(result())}
              >
                重新编辑
              </button>
            )}
          </Show>
          <Show when={rebootable()}>
            <button
              type="button"
              class="studio-result-action studio-result-reboot"
              disabled={props.actionBusy || props.rebooting}
              onClick={() => {
                if (!props.turn.result) return
                tracker.interaction({ module: "studio", name: "reboot-generation", extend: JSON.stringify({ generationID: props.turn.result.id }) })
                props.onRebootGeneration(props.turn.result.id)
              }}
            >
              {props.rebooting ? "重新生成中..." : "重新生成"}
            </button>
          </Show>
          <Show when={refreshable()}>
            <button
              type="button"
              class="studio-result-action studio-result-refresh"
              disabled={props.actionBusy || props.refreshing}
              onClick={() => {
                if (!props.turn.result) return
                tracker.interaction({ module: "studio", name: "refresh-generation", extend: JSON.stringify({ generationID: props.turn.result.id }) })
                props.onRefreshGeneration(props.turn.result.id)
              }}
            >
              {props.refreshing ? "刷新中..." : "刷新状态"}
            </button>
          </Show>
        </div>
      </div>
      <Show when={createdAt()}>
        <div class="studio-result-meta">创建时间：{createdAt()}</div>
      </Show>
      <div class="studio-result-progress-preview">
        <Show when={status() === "failed" || status() === "create_failed" || status() === "abnormal"}>
          <div class="studio-result-error-box">
            <img class="studio-result-error-icon" src="/studio/studio-result-error.svg" />
            <div class="studio-result-error">
              {status() === "abnormal"
                ? "生成耗时较长，状态异常，请刷新状态"
                : props.turn.toolError ??
                  props.turn.result?.error ??
                  (status() === "create_failed" ? "任务创建失败，请检查网络或稍后再试" : "生成失败")}
            </div>
          </div>
        </Show>
        <Show when={status() === "succeeded" && props.turn.result?.images.length}>
          <div class="studio-result-grid" classList={{ "single-portrait": isSinglePortrait(), "single-landscape": isSingleLandscape(), "multi-portrait": isMultiPortrait(), "multi-landscape": isMultiLandscape(), "single-1x1": isSingle1x1(), "multi-1x1": isMulti1x1() }}>
            <For each={props.turn.result?.images ?? []}>
              {(image, mediaIndex) => (
                <button
                  type="button"
                  onClick={() => {
                    if (!props.turn.result) return
                    tracker.interaction({ module: "studio", name: "result-select-image", extend: JSON.stringify({ resultID: props.turn.result.id, imageID: image.id }) })
                    props.onSelectImage({ resultID: props.turn.result.id, imageID: image.id })
                  }}
                  class="studio-result-thumb"
                >
                  <StudioMediaThumbnail
                    image={image}
                    duration={props.turn.result?.duration}
                    durationBadge="result"
                    generationID={props.turn.result?.id}
                    mediaIndex={mediaIndex()}
                    class="studio-result-thumb-media"
                  />
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  )
}
