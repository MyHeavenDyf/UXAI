import { createEffect, createSignal, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { Icon } from "@opencode-ai/ui/icon"
import type { MakeGroup } from "@/hooks/use-make-groups"
import trashPng from "@/pages/_shell/icons/trash.png"
import squareAndPencilPng from "@/pages/_shell/icons/square_and_pencil.png"

export type GroupContextMenuProps = {
  show: boolean
  x: number
  y: number
  group: MakeGroup | null
  onClose: () => void
  onNewSession: (group: MakeGroup) => void
  onRename: (group: MakeGroup) => void
  onRemove: (group: MakeGroup) => void
  /** Custom backdrop right-click handler. Used by the sidebar to re-target the
   *  menu to another group on right-click. Defaults to closing the menu. */
  onContextMenuBackdrop?: (e: MouseEvent) => void
}

/**
 * Cursor-positioned context menu for a conversation group, mirroring the
 * session context menu so the menu opens at the click point instead of being
 * anchored to the right-side kebab button. Purely presentational; all actions
 * delegate to callbacks.
 */
export function GroupContextMenu(props: GroupContextMenuProps) {
  const [menuStyle, setMenuStyle] = createSignal<{ left: string; top: string; visibility: "visible" | "hidden" }>({
    left: "0px",
    top: "0px",
    visibility: "hidden",
  })
  const [contextMenuRef, setContextMenuRef] = createSignal<HTMLDivElement | undefined>(undefined)

  createEffect(() => {
    if (!(props.show && props.group)) return
    const x = props.x
    const y = props.y
    // Hide while (re)positioning so a retarget never flashes at the old spot.
    setMenuStyle({ left: "0px", top: "0px", visibility: "hidden" })
    requestAnimationFrame(() => {
      const menu = contextMenuRef()
      if (!menu) return
      const menuHeight = menu.offsetHeight
      const menuWidth = menu.offsetWidth
      const viewportHeight = window.innerHeight
      const viewportWidth = window.innerWidth
      const minMargin = 24

      let top = y
      let left = x
      if (top + menuHeight > viewportHeight - minMargin) {
        top = Math.max(0, viewportHeight - menuHeight - minMargin)
      }
      if (left + menuWidth > viewportWidth - minMargin) {
        left = Math.max(0, viewportWidth - menuWidth - minMargin)
      }
      if (left < 0) left = 0
      if (top < 0) top = 0
      setMenuStyle({ left: `${left}px`, top: `${top}px`, visibility: "visible" })
    })
  })

  return (
    <Show when={props.show && props.group}>
      <Portal>
        <div
          class="fixed inset-0 z-50"
          onContextMenu={(e) => {
            e.preventDefault()
            if (props.onContextMenuBackdrop) { props.onContextMenuBackdrop(e); return }
            props.onClose()
          }}
          onClick={props.onClose}
          onKeyDown={(e) => { if (e.key === "Escape") props.onClose() }}
          tabIndex={-1}
          ref={(el) => { requestAnimationFrame(() => el?.focus()) }}
        >
          <div
            ref={setContextMenuRef}
            data-component="dropdown-menu-content"
            data-context-menu
            style={{
              position: "absolute",
              left: menuStyle().left,
              top: menuStyle().top,
              visibility: menuStyle().visibility,
              width: "175px",
              "min-height": "116px",
              padding: "4px",
              display: "flex",
              "flex-direction": "column",
              gap: "4px",
              overflow: "visible",
              "background-color": "#fff",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              data-slot="dropdown-menu-item"
              class="flex items-center gap-2"
              onClick={() => {
                const g = props.group
                if (!g) return
                props.onClose()
                props.onNewSession(g)
              }}
            >
              <Icon name="plus" size="small" style={{ width: "14px", height: "14px", "flex-shrink": "0", color: "rgba(0,0,0,0.6)" }} />
              <span data-slot="dropdown-menu-item-label">新建对话</span>
            </button>
            <button
              data-slot="dropdown-menu-item"
              class="flex items-center gap-2"
              onClick={() => {
                const g = props.group
                if (!g) return
                props.onClose()
                props.onRename(g)
              }}
            >
              <img src={squareAndPencilPng} style={{ width: "14px", height: "14px", "flex-shrink": "0" }} alt="" draggable={false} />
              <span data-slot="dropdown-menu-item-label">重命名</span>
            </button>
            <button
              data-slot="dropdown-menu-item"
              class="flex items-center gap-2"
              onClick={() => {
                const g = props.group
                if (!g) return
                props.onClose()
                props.onRemove(g)
              }}
            >
              <img src={trashPng} style={{ width: "14px", height: "14px", "flex-shrink": "0" }} alt="" draggable={false} />
              <span data-slot="dropdown-menu-item-label">移除对话分组</span>
            </button>
          </div>
        </div>
      </Portal>
    </Show>
  )
}
