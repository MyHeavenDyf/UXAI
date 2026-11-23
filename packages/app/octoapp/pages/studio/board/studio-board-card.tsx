import { createMemo, Show } from "solid-js"
import {
  boardCover,
  boardFailed,
  boardMedia,
  boardRebootable,
  type BoardCard,
  type BoardResults,
} from "./studio-board-state"
import type { BoardOperation } from "./studio-board-operations"
import { studioGenerationModelUnavailableMessage } from "../studio-shared"

export function StudioBoardCardView(props: {
  card: BoardCard
  results: BoardResults
  operation?: BoardOperation
  selected: boolean
  locked: boolean
  editingBlocked: boolean
  historyPreview: boolean
  failureSuppressed: boolean
  rebootBlocked: boolean
  mediaURL: (value?: string) => string | undefined
  onOperate: (action: "cancel" | "reboot") => void
  onRefresh: () => void
  onRemove: () => void
  onResults: () => void
  onPlay: (video: HTMLVideoElement) => void
}) {
  const current = () => props.results[props.card.currentGenerationID ?? ""]
  const unavailableModelMessage = () => {
    const result = current()
    return result && studioGenerationModelUnavailableMessage(result)
  }
  const hasFailure = () => !props.operation && !props.failureSuppressed && boardFailed(current())
  const showFailure = () => !props.historyPreview && hasFailure()
  const shownMedia = createMemo(() => {
    const items = boardMedia(props.card, props.results)
    return (
      items.find(
        (item) => item.generationID === props.card.preview?.generationID && item.mediaID === props.card.preview.mediaID,
      )?.media ?? boardCover(props.card, props.results)
    )
  })
  return (
    <article
      class="studio-board-card"
      classList={{ selected: props.selected }}
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
          {props.card.kind === "image" ? "▧" : "▷"} {props.card.title}
        </span>
        <Show
          when={props.locked}
          fallback={
            <Show when={hasFailure() && boardRebootable(current())}>
              <button
                type="button"
                disabled={props.rebootBlocked}
                on:click={(event) => {
                  event.stopPropagation()
                  void props.onOperate("reboot")
                }}
              >
                重新生成
              </button>
            </Show>
          }
        >
          <span class="studio-board-card-status">
            {props.operation
              ? ({
                  creating: "提交中",
                  uploading: "上传中",
                  cancelling: "取消中",
                  rebooting: "重新生成中",
                  unknown: "核对中",
                }[props.operation] ?? "处理中")
              : current()?.status === "abnormal"
                ? "状态异常"
                : current()?.status === "creating"
                  ? "创建中"
                  : `${current()?.progress ?? 0}%`}
          </span>
          <Show when={!props.operation && current()?.status !== "abnormal"}>
            <button
              type="button"
              on:click={(event) => {
                event.stopPropagation()
                void props.onOperate("cancel")
              }}
            >
              取消生成
            </button>
          </Show>
          <Show when={props.operation === "unknown" || current()?.status === "abnormal"}>
            <button
              type="button"
              on:click={(event) => {
                event.stopPropagation()
                void props.onRefresh()
              }}
            >
              刷新状态
            </button>
          </Show>
        </Show>
        <button
          type="button"
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
      <div class="studio-board-card-media">
        <Show
          when={!props.locked && !showFailure()}
          fallback={
            <div class="studio-board-card-placeholder" classList={{ failure: showFailure() }}>
              <Show
                when={showFailure()}
                fallback={
                  <>
                    <span class="studio-board-spinner" />
                    <span>
                      {props.operation === "unknown"
                        ? "请求结果待核对"
                        : current()?.status === "abnormal"
                          ? "任务状态异常，请刷新核对"
                          : "正在生成"}
                    </span>
                  </>
                }
              >
                <strong>生成失败</strong>
                <span>
                  {unavailableModelMessage() || (String(current()?.rawStatus) === "4" ? "用户取消生成" : current()?.error || "生成失败，请稍后重试")}
                </span>
                <Show when={!boardRebootable(current())}>
                  <small>请在输入区发送新任务</small>
                </Show>
              </Show>
            </div>
          }
        >
          <Show
            when={shownMedia()}
            fallback={
              <div class="studio-board-card-placeholder">
                <span class="studio-board-empty-symbol">{props.card.kind === "image" ? "▧" : "▷"}</span>
                <span>让想法成为画面</span>
                <small>选中卡片，输入你的创意</small>
              </div>
            }
          >
            {(image) => (
              <Show
                when={props.card.kind === "video"}
                fallback={
                  <img
                    src={props.mediaURL(image().thumbnailUrl ?? image().url)}
                    alt={props.card.title}
                    draggable={false}
                  />
                }
              >
                <video
                  src={props.mediaURL(image().url)}
                  poster={props.mediaURL(image().thumbnailUrl)}
                  controls
                  preload="none"
                  onPlay={(event) => props.onPlay(event.currentTarget)}
                />
              </Show>
            )}
          </Show>
        </Show>
      </div>
      <footer>
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
