import { createSignal, onCleanup, Show } from "solid-js"
import type { JSX } from "solid-js"
import { Portal } from "solid-js/web"
import { showToast } from "@opencode-ai/ui/toast"
import { onPrototypeCtxMenu, onPrototypeClosePanels, sendToPrototypeIframe, type PrototypeCtxMenuData } from "../../utils/prototype-utils"

const MENU_WIDTH = 160
const MENU_HEIGHT = 72

const itemBase: JSX.CSSProperties = {
  padding: "8px 12px",
  "font-size": "13px",
  cursor: "pointer",
  color: "var(--octo-text-primary, #191919)",
}

export function PrototypeCtxMenu(): JSX.Element {
  const [menu, setMenu] = createSignal<PrototypeCtxMenuData | null>(null)
  const close = () => setMenu(null)

  const unsubscribe = onPrototypeCtxMenu((data) => {
    const x = Math.max(8, Math.min(data.x, window.innerWidth - MENU_WIDTH - 8))
    const y = Math.max(8, Math.min(data.y, window.innerHeight - MENU_HEIGHT - 8))
    setMenu({ ...data, x, y })
  })
  onCleanup(unsubscribe)
  const unsubClose = onPrototypeClosePanels(() => close())
  onCleanup(unsubClose)

  const handleSelectParent = () => {
    sendToPrototypeIframe({ type: "od:dom-picker-select-parent" })
    close()
  }

  const handleCopyName = () => {
    const id = menu()?.id ?? ""
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(id).then(() => showToast({ title: "已复制" })).catch(() => {})
    }
    close()
  }

  const onDocClick = (e: MouseEvent) => {
    if (!(e.target as HTMLElement).closest(".prototype-ctx-menu")) close()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close()
  }
  window.addEventListener("click", onDocClick, true)
  window.addEventListener("keydown", onKey)
  onCleanup(() => {
    window.removeEventListener("click", onDocClick, true)
    window.removeEventListener("keydown", onKey)
  })

  return (
    <Show when={menu()}>
      {(m) => (
        <Portal mount={document.body}>
          <div
            class="prototype-ctx-menu"
            style={{
              position: "fixed",
              "z-index": "99999",
              left: `${m().x}px`,
              top: `${m().y}px`,
              width: `${MENU_WIDTH}px`,
              background: "#ffffff",
              border: "1px solid var(--octo-border-default, #E5E7EB)",
              "border-radius": "8px",
              "box-shadow": "var(--octo-shadow-md, 0 4px 16px rgba(0,0,0,0.08))",
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={itemBase}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--octo-surface-hover, #F5F5F5)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              onClick={handleSelectParent}
            >
              选择父容器
            </div>
            <div
              style={{ ...itemBase, "border-top": "1px solid var(--octo-border-default, #E5E7EB)" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--octo-surface-hover, #F5F5F5)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              onClick={handleCopyName}
            >
              复制名称
            </div>
          </div>
        </Portal>
      )}
    </Show>
  )
}
