import { createEffect, createMemo, on, Show } from "solid-js"
import { createStore } from "solid-js/store"
import {
  boardDisplayedMedia,
  boardFailed,
  boardMedia,
  boardRebootable,
  boardCardSize,
  type BoardCard,
  type BoardResults,
} from "./studio-board-state"
import type { BoardOperation } from "./studio-board-operations"
import { studioGenerationFailureMessage, studioGenerationProgress, studioGenerationQueueLabel } from "../studio-shared"
import { StudioVideoPlayer } from "../studio-video-player"
import { StudioInpaintCanvas, type StudioInpaintDrawing } from "../studio-inpaint-canvas"
import { StudioOutpaintStage, type StudioOutpaint } from "../studio-outpaint-stage"

export function StudioBoardCardView(props: {
  card: BoardCard
  results: BoardResults
  operation?: BoardOperation
  selected: boolean
  locked: boolean
  editingBlocked: boolean
  historyCover: boolean
  failureSuppressed: boolean
  rebootBlocked: boolean
  mediaURL: (value?: string) => string | undefined
  onOperate: (action: "cancel" | "reboot") => void
  onRefresh: () => void
  onRemove: () => void
  onResults: () => void
  onPlay: (video: HTMLVideoElement) => void
  onSize?: (size: { width: number; height: number }) => void
  playerMount?: () => HTMLElement
  submissionError?: string
  onRetry?: () => void
  inpaint?: StudioInpaintDrawing
  outpaint?: StudioOutpaint
  outpaintSource?: string
  zoom?: number
}) {
  const current = () => props.results[props.card.currentGenerationID ?? ""]
  const hasFailure = () => !props.operation && (!!props.submissionError || (!props.failureSuppressed && boardFailed(current())))
  const showFailure = () => !props.historyCover && hasFailure()
  const needsRefresh = () => props.operation === "unknown" || (!props.operation && current()?.status === "abnormal")
  const cancellable = () => !props.operation && ["creating", "queued", "running"].includes(current()?.status ?? "")
  const operationLabel = () =>
    props.operation &&
    {
      creating: "提交中",
      uploading: "上传中",
      cancelling: "取消中",
      rebooting: "重新生成中",
      unknown: "核对中",
    }[props.operation]
  const statusLabel = () => {
    if (props.operation === "cancelling") return
    if (props.operation) return operationLabel()
    if (current()?.status === "queued") return studioGenerationQueueLabel(current()?.order)
    if (current()?.status === "running" && Number.isFinite(current()?.progress))
      return `${studioGenerationProgress(current()?.progress)}%`
    if (current()?.status === "creating") return "创建中"
    if (needsRefresh()) return "状态异常"
  }
  const shownMedia = createMemo(() => boardDisplayedMedia(props.card, props.results))
  const source = () => props.mediaURL(shownMedia()?.url)
  const dimensions = new Map<string, { width: number; height: number }>()
  const [media, setMedia] = createStore({ width: 300, height: 300 })
  const size = createMemo(() => props.outpaint?.state.ready
    ? { width: props.outpaint.rect().width + 4, height: props.outpaint.rect().height + 30 }
    : boardCardSize(media.width, media.height))
  let element!: HTMLElement
  function measure(width: number, height: number) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return
    const src = source()
    if (!src) return
    dimensions.set(src, { width, height })
    setMedia({ width, height })
  }
  createEffect(
    on(
      () => [source(), shownMedia()?.width, shownMedia()?.height] as const,
      ([src, width, height]) => {
        const cached = src && dimensions.get(src)
        if (cached) {
          setMedia(cached)
          return
        }
        if (width && height && Number.isFinite(width) && Number.isFinite(height)) setMedia({ width, height })
      },
    ),
  )
  createEffect(() => props.onSize?.(size()))
  return (
    <article
      ref={element!}
      class="studio-board-card"
      style={{
        width: `${size().width}px`,
        height: `${size().height}px`,
        "--studio-board-media-height": `${size().height - 30}px`,
      }}
      classList={{
        selected: props.selected,
        "studio-board-card-image": props.card.kind === "image",
        "studio-board-card-video": props.card.kind === "video",
        inpainting: !!props.inpaint,
        outpainting: !!props.outpaint,
      }}
      aria-label={props.card.title}
      on:pointerdown={(event) => {
        if (event.target instanceof Element && event.target.closest("button, video, input")) event.stopPropagation()
      }}
      on:mousedown={(event) => {
        if (event.target instanceof Element && event.target.closest("button, video, input")) event.stopPropagation()
      }}
    >
      <header>
        <span class="studio-board-card-title">
          <span class="studio-board-card-icon" aria-hidden="true" />
          {props.card.title}
        </span>
        <button
          type="button"
          class="studio-board-card-remove"
          aria-label={`移除${props.card.title}`}
          disabled={props.editingBlocked}
          on:click={(event) => {
            event.stopPropagation()
            props.onRemove()
          }}
        >
          ×
        </button>
      </header>
      <div class="studio-board-card-media" classList={{ "has-status": props.locked || showFailure() }}>
        <Show when={props.locked || props.submissionError || (hasFailure() && boardRebootable(current()))}>
          <div class="studio-board-card-task-actions">
            <Show when={statusLabel()}>
              <span class="studio-board-card-status" role="status">
                {statusLabel()}
              </span>
            </Show>
            <Show when={cancellable() || props.operation === "cancelling"}>
              <button
                type="button"
                aria-label="取消生成"
                disabled={props.operation === "cancelling"}
                on:click={(event) => {
                  event.stopPropagation()
                  props.onOperate("cancel")
                }}
              >
                {props.operation === "cancelling" ? "取消中…" : "取消任务"}
              </button>
            </Show>
            <Show when={needsRefresh()}>
              <button
                type="button"
                on:click={(event) => {
                  event.stopPropagation()
                  props.onRefresh()
                }}
              >
                刷新状态
              </button>
            </Show>
            <Show when={hasFailure() && boardRebootable(current())}>
              <button
                type="button"
                disabled={props.rebootBlocked}
                on:click={(event) => {
                  event.stopPropagation()
                  props.onOperate("reboot")
                }}
              >
                重新生成
              </button>
            </Show>
            <Show when={props.submissionError && !props.locked}>
              <button
                type="button"
                on:click={(event) => {
                  event.stopPropagation()
                  props.onRetry?.()
                }}
              >
                重新提交
              </button>
            </Show>
          </div>
        </Show>
        <Show when={props.outpaint && props.outpaintSource} fallback={<Show
          when={!props.locked && !showFailure()}
          fallback={
            <div
              class="studio-board-card-placeholder studio-board-card-task"
              classList={{ failure: showFailure(), abnormal: needsRefresh() }}
            >
              <Show
                when={showFailure()}
                fallback={
                  <>
                    <span
                      class="studio-board-card-icon studio-board-card-empty-icon"
                      classList={{ "studio-board-card-error-icon": needsRefresh() }}
                      aria-hidden="true"
                    />
                    <span class="studio-board-card-task-title" role="status">
                      {needsRefresh() ? "请求结果待核对" : props.operation ? `${operationLabel()}…` : "正在创作中…"}
                    </span>
                    <Show when={needsRefresh()}>
                      <span class="studio-board-card-task-reason">任务状态待确认，请刷新状态</span>
                    </Show>
                  </>
                }
              >
                <span class="studio-board-card-error-icon" aria-hidden="true" />
                <strong class="studio-board-card-task-title">生成失败</strong>
                <span
                  class="studio-board-card-task-reason"
                  onWheel={(event) => event.stopPropagation()}
                  on:pointerdown={(event) => event.stopPropagation()}
                  on:mousedown={(event) => event.stopPropagation()}
                >
                  {props.submissionError ?? studioGenerationFailureMessage(current())}
                </span>
              </Show>
            </div>
          }
        >
          <Show
            when={shownMedia()}
            fallback={
              <div class="studio-board-card-placeholder">
                <span class="studio-board-card-icon studio-board-card-empty-icon" aria-hidden="true" />
              </div>
            }
          >
            {(image) => (
              <Show
                when={props.card.kind === "video"}
                fallback={
                  <img
                    src={source()}
                    alt={props.card.title}
                    draggable={false}
                    onLoad={(event) => {
                      if (
                        event.currentTarget.currentSrc &&
                        event.currentTarget.currentSrc !== event.currentTarget.src
                      )
                        return
                      measure(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)
                    }}
                  />
                }
              >
                <StudioVideoPlayer
                  src={source() ?? ""}
                  poster={props.mediaURL(image().thumbnailUrl)}
                  inline
                  mount={props.playerMount ?? (() => element.ownerDocument.body)}
                  onMetadata={(value) => measure(value.width, value.height)}
                  onPlay={props.onPlay}
                />
              </Show>
            )}
          </Show>
        </Show>}>
          <StudioOutpaintStage editor={props.outpaint!} source={props.outpaintSource!} board zoom={props.zoom} />
        </Show>
        <Show when={props.inpaint}>
          {(drawing) => <StudioInpaintCanvas drawing={drawing()} />}
        </Show>
      </div>
      <footer classList={{ empty: (props.locked || showFailure()) && !boardMedia(props.card, props.results).length }}>
        <span>{props.card.kind === "image" ? "图片卡片" : "视频卡片"}</span>
        <button
          type="button"
          on:click={(event) => {
            event.stopPropagation()
            props.onResults()
          }}
        >
          查看结果 {boardMedia(props.card, props.results).length}
        </button>
      </footer>
    </article>
  )
}
