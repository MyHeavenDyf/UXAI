import { createEffect, createUniqueId, onCleanup, Show } from "solid-js"

export function StudioBoardTools(props: {
  tool: "select" | "pan"
  open: boolean
  disabled: boolean
  videoDisabled: boolean
  videoHint: string
  onToggle: () => void
  onSelect: (tool: "select" | "pan") => void
  onImage: () => void
  onVideo: () => void
}) {
  const id = createUniqueId()
  let root!: HTMLDivElement
  let trigger!: HTMLButtonElement
  let menu!: HTMLDivElement
  createEffect(() => {
    if (!props.open) return
    const dismiss = (event: Event) => {
      if (event.target instanceof Node && !root.contains(event.target)) props.onToggle()
    }
    document.addEventListener("pointerdown", dismiss, true)
    document.addEventListener("focusin", dismiss, true)
    onCleanup(() => {
      document.removeEventListener("pointerdown", dismiss, true)
      document.removeEventListener("focusin", dismiss, true)
    })
  })
  return (
    <div ref={root} class="studio-board-tools" role="toolbar" aria-label="画布工具">
      <button
        ref={trigger}
        type="button"
        class="studio-board-tool-current"
        aria-label="操作工具"
        title={props.tool === "select" ? "选择（V）" : "平移画布（H）"}
        aria-haspopup="menu"
        aria-expanded={props.open}
        aria-controls={id}
        disabled={props.disabled}
        onClick={() => {
          props.onToggle()
          if (props.open) queueMicrotask(() => menu.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus())
        }}
      >
        <img src={`/studio/board-tool-${props.tool}.svg`} alt="" draggable={false} />
      </button>
      <button
        type="button"
        aria-label="新建图片卡片"
        title="新建图片卡片"
        disabled={props.disabled}
        onClick={props.onImage}
      >
        <img src="/studio/board-tool-image.svg" alt="" draggable={false} />
      </button>
      <button
        type="button"
        aria-label="新建视频卡片"
        title={props.videoHint}
        disabled={props.disabled || props.videoDisabled}
        onClick={props.onVideo}
      >
        <img src="/studio/board-tool-video.svg" alt="" draggable={false} />
      </button>
      <button type="button" aria-label="素材库" title="素材库（即将推出）" disabled>
        <img src="/studio/board-tool-assets.svg" alt="" draggable={false} />
      </button>
      <button type="button" aria-label="上传素材" title="上传素材（即将推出）" disabled>
        <img src="/studio/board-tool-upload.svg" alt="" draggable={false} />
      </button>
      <Show when={props.open}>
        <div
          ref={menu}
          id={id}
          role="menu"
          aria-label="操作工具选项"
          class="studio-board-tool-menu"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault()
              event.stopPropagation()
              props.onToggle()
              trigger.focus()
              return
            }
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return
            event.preventDefault()
            const buttons = Array.from(menu.querySelectorAll<HTMLButtonElement>("button"))
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
            buttons[
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? buttons.length - 1
                  : (index + (event.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length
            ]?.focus()
          }}
        >
          {(["select", "pan"] as const).map((tool) => (
            <button
              type="button"
              role="menuitemradio"
              aria-checked={props.tool === tool}
              onClick={() => {
                props.onSelect(tool)
                trigger.focus()
              }}
            >
              <span>
                <img src={`/studio/board-tool-${tool}.svg`} alt="" draggable={false} />
                {tool === "select" ? "选择" : "平移画布"}
              </span>
              <kbd>{tool === "select" ? "V" : "H"}</kbd>
            </button>
          ))}
        </div>
      </Show>
    </div>
  )
}
