import { For, Show } from "solid-js"

export function StudioBoardMediaToolbar(props: {
  kind: "image" | "video"
  anchor: { left: number; top: number }
  hidden: boolean
  onDownload: () => void
  upscaleActive: boolean
  upscaleBlocked: boolean
  onUpscale: () => void
  cutoutActive: boolean
  cutoutBlocked: boolean
  onCutout: () => void
  inpaintActive: boolean
  inpaintBlocked: boolean
  onInpaint: () => void
}) {
  return (
    <div
      class="studio-board-media-toolbar"
      data-kind={props.kind}
      role="group"
      aria-label={props.kind === "video" ? "视频操作" : "图片操作"}
      hidden={props.hidden}
      style={{ left: `${props.anchor.left}px`, top: `${props.anchor.top}px` }}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <For
        each={[
          { label: "再次生成", icon: "regenerate", separated: true },
          { label: "视频生成", icon: "video", separated: true },
          { label: "变清晰", icon: "upscale" },
          { label: "抠图", icon: "cutout" },
          { label: "智能重绘", icon: "redraw" },
          { label: "扩图", icon: "expand", separated: true },
          { label: "下载", icon: "download" },
        ].filter((action) => props.kind === "image" || action.icon === "regenerate" || action.icon === "download")}
      >
        {(action) => (
          <>
            <button
              type="button"
              class="studio-board-image-action"
              classList={{
                "studio-board-image-action-generate": action.icon === "regenerate" || action.icon === "video",
                active:
                  (action.icon === "upscale" && props.upscaleActive) ||
                  (action.icon === "cutout" && props.cutoutActive) ||
                  (action.icon === "redraw" && props.inpaintActive),
              }}
              aria-pressed={
                action.icon === "upscale" ? props.upscaleActive : action.icon === "cutout" ? props.cutoutActive
                  : action.icon === "redraw" ? props.inpaintActive : undefined
              }
              disabled={
                (action.icon === "upscale" && props.upscaleBlocked) ||
                (action.icon === "cutout" && props.cutoutBlocked) ||
                (action.icon === "redraw" && props.inpaintBlocked)
              }
              onClick={
                action.icon === "download" ? props.onDownload
                  : action.icon === "upscale" ? props.onUpscale
                  : action.icon === "cutout" ? props.onCutout
                  : action.icon === "redraw" ? props.onInpaint
                  : undefined
              }
            >
              <span
                class="studio-board-image-action-icon"
                style={{ "--action-icon": `url("/studio/board-image-actions/${action.icon}.svg")` }}
                aria-hidden="true"
              >
                <img src={`/studio/board-image-actions/${action.icon}.svg`} alt="" draggable={false} />
              </span>
              <span>{action.label}</span>
            </button>
            <Show when={action.separated}>
              <span class="studio-board-image-action-divider" aria-hidden="true" />
            </Show>
          </>
        )}
      </For>
    </div>
  )
}
