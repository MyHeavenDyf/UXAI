import { For, Show } from "solid-js"
import { boardMedia, type BoardCard, type BoardResults } from "./studio-board-state"
import { styleModelLabel } from "../data"

export function StudioBoardResults(props: {
  card: BoardCard
  cards: BoardCard[]
  results: BoardResults
  inspectGenerationID: string
  suppressedFailureIDs: string[]
  blocked: boolean
  mediaURL: (value?: string) => string | undefined
  onClose: () => void
  onInspect: (generationID: string) => void
  onPreview: (reference: NonNullable<BoardCard["preview"]>) => void
  onCover: (reference: NonNullable<BoardCard["cover"]>) => void
}) {
  return (
    <aside class="studio-board-results" aria-label="卡片生成结果">
      <header>
        <strong>{props.card.title} · 全部结果</strong>
        <button type="button" onClick={() => props.onClose()}>
          关闭
        </button>
      </header>
      <Show when={boardMedia(props.card, props.results).length} fallback={<p>暂无成功结果</p>}>
        <For each={boardMedia(props.card, props.results)}>
          {(ref) => (
            <figure>
              <Show
                when={props.card.kind === "video"}
                fallback={
                  <img src={props.mediaURL(ref.media.thumbnailUrl ?? ref.media.url)} alt="生成结果" loading="lazy" />
                }
              >
                <video src={props.mediaURL(ref.media.url)} controls preload="none" />
              </Show>
              <figcaption>
                <button type="button" onClick={() => props.onInspect(ref.generationID)}>
                  本次输入
                </button>
                <button
                  type="button"
                  disabled={props.blocked}
                  onClick={() => props.onPreview({ generationID: ref.generationID, mediaID: ref.mediaID })}
                >
                  预览
                </button>
                <button
                  type="button"
                  disabled={props.blocked}
                  onClick={() => props.onCover({ generationID: ref.generationID, mediaID: ref.mediaID })}
                >
                  {props.card.cover?.generationID === ref.generationID && props.card.cover?.mediaID === ref.mediaID
                    ? "当前封面"
                    : "设为封面"}
                </button>
              </figcaption>
            </figure>
          )}
        </For>
      </Show>
      <Show
        when={
          props.card.taskLinks.find(
            (link) =>
              link.visible &&
              link.generationID === (props.inspectGenerationID || props.card.currentGenerationID) &&
              !props.suppressedFailureIDs.includes(link.generationID),
          )?.snapshot
        }
      >
        {(snapshot) => (
          <details open>
            <summary>本次生成输入</summary>
            <p>{snapshot().prompt}</p>
            <p>
              {styleModelLabel(snapshot().settings.styleModel)} ·{" "}
              {snapshot().settings.isCustom
                ? `${snapshot().settings.width}×${snapshot().settings.height}`
                : snapshot().settings.aspectRatio}{" "}
              · {snapshot().settings.count}
              {props.card.kind === "video" ? " 份" : " 张"}
            </p>
            <Show when={props.card.kind === "video"}>
              <p>
                {snapshot().settings.duration} 秒 · {snapshot().settings.quality.toUpperCase()}
              </p>
            </Show>
            <div class="studio-board-references">
              <For each={snapshot().references}>
                {(ref) => (
                  <div class="studio-board-reference">
                    <img src={props.mediaURL(ref.image)} alt={ref.title} />
                    <span>
                      {ref.title}
                      {!ref.sourceID.startsWith("upload:") && !props.cards.some((card) => card.id === ref.sourceID)
                        ? " · 来源已移除"
                        : ""}
                    </span>
                  </div>
                )}
              </For>
            </div>
          </details>
        )}
      </Show>
    </aside>
  )
}
