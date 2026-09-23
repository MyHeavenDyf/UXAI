import type { Session } from "@opencode-ai/sdk/v2/client"
import { useLocation, useNavigate } from "@solidjs/router"
import { createEffect, createMemo, createSignal, onCleanup, Show, For } from "solid-js"
import { Portal } from "solid-js/web"
import { Icon } from "@opencode-ai/ui/icon"
import { showToast } from "@opencode-ai/ui/toast"
import { ScrollableText } from "@/components/session-list"
import type { SidebarGroup } from "@/components/agent-sidebar"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useGlobalSDK } from "@/context/global-sdk"
import { useServer } from "@/context/server"
import { sessionTitle } from "@/utils/session-title"
import trashPng from "@/pages/_shell/icons/trash.png"
import pinPng from "@/pages/_shell/icons/pin.png"
import folderBadgePlusPng from "@/pages/_shell/icons/folder_badge_plus.png"
import arrowRightFolderCirclePng from "@/pages/_shell/icons/arrow_right_folder_circle.png"
import squareAndPencilPng from "@/pages/_shell/icons/square_and_pencil.png"
import folderLineClosePng from "@/pages/_shell/icons/Folder_line_close.png"
import checkmarkPng from "@/pages/_shell/icons/checkmark.png"

export type SessionGroupMapping = Record<string, { groupId: string; position: number }>

export type SessionContextMenuProps = {
  show: boolean
  x: number
  y: number
  session: Session | null
  hasMessages: boolean
  groups?: SidebarGroup[]
  sessionGroupMapping?: SessionGroupMapping
  onClose: () => void
  onRename: (session: Session) => void
  onTogglePin: (session: Session) => void
  onDelete: (session: Session) => void
  onMoveToGroup?: (session: Session, groupId: string) => void
  onRemoveFromGroup?: (session: Session) => void
  onCreateGroupForSession?: (session: Session) => void
  /** Custom backdrop right-click handler. Used by the sidebar to re-target the
   *  menu to another session on right-click. Defaults to closing the menu. */
  onContextMenuBackdrop?: (e: MouseEvent) => void
  /** Trigger element to anchor the menu to (e.g. the kebab button). When provided,
   *  the menu follows the element on window resize instead of staying at the
   *  click-point coordinates. */
  triggerEl?: () => HTMLElement | undefined
}

/**
 * Shared session context menu used by the sidebar (right-click / row 3-dot) and
 * the design page header kebab. Purely presentational: positioning + the
 * "移动到分组" submenu are self-contained; all actions delegate to callbacks.
 */
export function SessionContextMenu(props: SessionContextMenuProps) {
  const language = useLanguage()
  const location = useLocation()
  const navigate = useNavigate()
  const platform = usePlatform()
  const globalSDK = useGlobalSDK()
  const server = useServer()
  const [menuStyle, setMenuStyle] = createSignal<{ left: string; top: string; visibility: "visible" | "hidden" }>({
    left: "0px",
    top: "0px",
    visibility: "hidden",
  })
  const [contextMenuRef, setContextMenuRef] = createSignal<HTMLDivElement | undefined>(undefined)

  const [showGroupSubmenu, setShowGroupSubmenu] = createSignal(false)
  const [portableAction, setPortableAction] = createSignal<"import" | "export">()
  const [hoveredGroupId, setHoveredGroupId] = createSignal<string | null>(null)
  const [submenuVertical, setSubmenuVertical] = createSignal<"down" | "up">("down")
  let submenuHideTimer: ReturnType<typeof setTimeout> | undefined
  const showSubmenuNow = () => { clearTimeout(submenuHideTimer); setShowGroupSubmenu(true) }
  const scheduleHideSubmenu = () => { clearTimeout(submenuHideTimer); submenuHideTimer = setTimeout(() => setShowGroupSubmenu(false), 200) }

  const portableSupported = createMemo(
    () =>
      platform.platform === "desktop" &&
      server.isLocal() &&
      !!platform.openFilePickerDialog &&
      !!platform.saveFilePickerDialog,
  )

  const portableError = (cause: unknown) => {
    showToast({
      variant: "error",
      title: language.t("session.portable.failed"),
      description: cause instanceof Error ? cause.message : String(cause),
    })
  }

  const exportSession = async () => {
    const session = props.session
    if (!session || portableAction() || !platform.saveFilePickerDialog) return
    props.onClose()
    const name = (sessionTitle(session.title) ?? "session")
      .replace(/[<>:"/\\|?*]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
    const output = await platform
      .saveFilePickerDialog({
        title: language.t("session.portable.export.picker"),
        defaultPath: `${name || "session"}.octosession`,
      })
      .catch((cause) => {
        portableError(cause)
        return null
      })
    if (!output) return

    setPortableAction("export")
    await globalSDK
      .createClient({ directory: session.directory, throwOnError: true })
      .session
      .portableExport({ sessionID: session.id, path: output })
      .then((result) => {
        const data = result.data!
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("session.portable.export.success"),
          description: language.t("session.portable.summary", { sessions: data.sessions, files: data.files }),
        })
      })
      .catch(portableError)
      .finally(() => setPortableAction())
  }

  const importSession = async () => {
    const session = props.session
    if (!session || portableAction() || !platform.openFilePickerDialog) return
    props.onClose()
    const selected = await platform
      .openFilePickerDialog({
        title: language.t("session.portable.import.picker"),
        extensions: ["octosession"],
        accept: ["application/zip", "application/octet-stream"],
      })
      .catch((cause) => {
        portableError(cause)
        return null
      })
    const input = Array.isArray(selected) ? selected[0] : selected
    if (!input) return

    setPortableAction("import")
    await globalSDK
      .createClient({ directory: session.directory, throwOnError: true })
      .session
      .portableImport({ path: input })
      .then((result) => {
        const data = result.data!
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("session.portable.import.success"),
          description: language.t("session.portable.summary", { sessions: data.sessions, files: data.files }),
        })
        const route = location.pathname.startsWith("/make")
          ? "/make"
          : location.pathname.startsWith("/insight")
            ? "/insight"
            : undefined
        if (route) navigate(`${route}/${data.sessionID}`)
      })
      .catch(portableError)
      .finally(() => setPortableAction())
  }

  // Reset submenu state when the menu closes so it doesn't reappear on next open.
  createEffect(() => {
    if (!props.show) {
      clearTimeout(submenuHideTimer)
      setShowGroupSubmenu(false)
    }
  })

  const submenuSide = createMemo<"right" | "left">(() => {
    if (!showGroupSubmenu()) return "right"
    const menuLeft = parseFloat(menuStyle().left) || 0
    return menuLeft + 175 * 2 + 24 > window.innerWidth ? "left" : "right"
  })

  createEffect(() => {
    if (!showGroupSubmenu()) { setSubmenuVertical("down"); return }
    requestAnimationFrame(() => {
      const menu = contextMenuRef()
      if (!menu) return
      const trigger = menu.querySelector<HTMLButtonElement>('[data-submenu-trigger]')
      if (!trigger) return
      const triggerRect = trigger.getBoundingClientRect()
      const viewportHeight = window.innerHeight
      const minMargin = 24
      const submenuMaxHeight = 200
      setSubmenuVertical(triggerRect.top + submenuMaxHeight > viewportHeight - minMargin ? "up" : "down")
    })
  })

  createEffect(() => {
    if (!(props.show && props.session)) return

    const position = () => {
      requestAnimationFrame(() => {
        const menu = contextMenuRef()
        if (!menu) return
        const menuHeight = menu.offsetHeight
        const menuWidth = menu.offsetWidth
        const viewportHeight = window.innerHeight
        const viewportWidth = window.innerWidth
        const minMargin = 24

        const trigger = props.triggerEl?.()
        let top: number
        let left: number
        if (trigger) {
          const rect = trigger.getBoundingClientRect()
          top = rect.bottom + 4
          left = rect.right - menuWidth
        } else {
          top = props.y
          left = props.x
        }
        if (top + menuHeight > viewportHeight - minMargin) {
          top = Math.max(0, viewportHeight - menuHeight - minMargin)
        }
        if (left + menuWidth > viewportWidth - minMargin) {
          left = Math.max(0, viewportWidth - menuWidth - minMargin)
        }
        if (left < 0) left = 0
        if (top < 0) top = 0
        setMenuStyle({
          left: `${left}px`,
          top: `${top}px`,
          visibility: "visible",
        })
      })
    }

    position()

    if (props.triggerEl) {
      window.addEventListener("resize", position)
      onCleanup(() => window.removeEventListener("resize", position))
    }
  })

  return (
    <Show when={props.show && props.session}>
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
            style={{
              position: "absolute",
              left: menuStyle().left,
              top: menuStyle().top,
              visibility: menuStyle().visibility,
              width: "175px",
              padding: "4px",
              display: "flex",
              "flex-direction": "column",
              gap: "4px",
              overflow: "visible",
              "background-color": "#fff",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <Show when={props.hasMessages}>
              <button
                data-slot="dropdown-menu-item"
                class="flex items-center gap-2"
                onClick={() => {
                  const s = props.session
                  if (!s) return
                  props.onRename(s)
                }}
              >
                <img src={squareAndPencilPng} style={{ width: "14px", height: "14px", "flex-shrink": "0" }} alt="" draggable={false} />
                <span data-slot="dropdown-menu-item-label">重命名</span>
              </button>
            </Show>
            <button
              data-slot="dropdown-menu-item"
              class="flex items-center gap-2"
              onClick={() => {
                const s = props.session
                if (!s) return
                props.onTogglePin(s)
              }}
            >
              <img src={pinPng} style={{ width: "14px", height: "14px", "flex-shrink": "0" }} alt="" draggable={false} />
              <span data-slot="dropdown-menu-item-label">{props.session && props.session.pinned ? "取消置顶聊天" : "置顶"}</span>
            </button>
            <Show when={portableSupported()}>
              <div style={{ height: "1px", background: "rgba(0,0,0,0.08)", margin: "2px 0" }} />
              <button
                data-slot="dropdown-menu-item"
                class="flex items-center gap-2"
                disabled={!!portableAction()}
                onClick={() => void exportSession()}
              >
                <Icon name="download" size="small" style={{ width: "14px", height: "14px", "flex-shrink": "0" }} />
                <span data-slot="dropdown-menu-item-label">{language.t("session.portable.export")}</span>
              </button>
              <button
                data-slot="dropdown-menu-item"
                class="flex items-center gap-2"
                disabled={!!portableAction()}
                onClick={() => void importSession()}
              >
                <Icon name="upload" size="small" style={{ width: "14px", height: "14px", "flex-shrink": "0" }} />
                <span data-slot="dropdown-menu-item-label">{language.t("session.portable.import")}</span>
              </button>
              <div style={{ height: "1px", background: "rgba(0,0,0,0.08)", margin: "2px 0" }} />
            </Show>
            <button
              data-slot="dropdown-menu-item"
              class="flex items-center gap-2"
              onClick={() => {
                const s = props.session
                if (!s) return
                props.onDelete(s)
              }}
            >
              <img src={trashPng} style={{ width: "14px", height: "14px", "flex-shrink": "0" }} alt="" draggable={false} />
              <span data-slot="dropdown-menu-item-label">删除</span>
            </button>
            <Show when={props.groups}>
              <div style={{ height: "1px", background: "rgba(0,0,0,0.08)", margin: "2px 0" }} />
              <div
                class="relative"
                onMouseEnter={showSubmenuNow}
                onMouseLeave={scheduleHideSubmenu}
              >
                <button
                  data-slot="dropdown-menu-item"
                  data-submenu-trigger
                  class="flex items-center gap-2 w-full"
                  style={{ "justify-content": "space-between" }}
                  onMouseEnter={showSubmenuNow}
                >
                  <span class="flex items-center gap-2">
                    <img src={arrowRightFolderCirclePng} style={{ width: "14px", height: "14px", "flex-shrink": "0" }} alt="" draggable={false} />
                    <span data-slot="dropdown-menu-item-label">移动到分组</span>
                  </span>
                  <Icon name="chevron-right" size="small" style={{ width: "14px", height: "14px", color: "rgba(0,0,0,0.4)" }} />
                </button>
                <Show when={showGroupSubmenu()}>
                  <div
                    data-component="dropdown-menu-content"
                    class="absolute"
                    style={{
                      position: "absolute",
                      ...(submenuSide() === "right"
                        ? { left: "calc(100% + 4px)" }
                        : { right: "calc(100% + 4px)" }),
                      ...(submenuVertical() === "down"
                        ? { top: "-4px" }
                        : { bottom: "-4px" }),
                      width: "175px",
                      "max-height": "200px",
                      "min-height": "40px",
                      padding: "4px 2px 4px 4px",
                      display: "flex",
                      "flex-direction": "column",
                      gap: "4px",
                      overflow: "auto",
                      "background-color": "#fff",
                    }}
                    onMouseEnter={showSubmenuNow}
                    onMouseLeave={scheduleHideSubmenu}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div class="submenu-scroll" style={{ "overflow-y": "auto", "min-height": "0" }}>
                      <Show
                        when={props.groups!.length}
                        fallback={
                          <div class="flex items-center text-[14px] leading-[20px]" style={{ height: "36px", "padding-left": "8px", color: "#777777", "flex-shrink": "0" }}>
                            暂无可移动的分组
                          </div>
                        }
                      >
                        <For each={props.groups}>
                          {(group) => (
                            <button
                              data-slot="dropdown-menu-item"
                              class="flex items-center gap-2"
                              style={{ height: "36px", "flex-shrink": "0" }}
                              onMouseEnter={() => setHoveredGroupId(group.id)}
                              onMouseLeave={() => setHoveredGroupId(null)}
                              onClick={() => {
                                const s = props.session
                                if (!s) return
                                props.onMoveToGroup?.(s, group.id)
                              }}
                            >
                              <img src={folderLineClosePng} style={{ width: "14px", height: "14px", "flex-shrink": "0" }} alt="" draggable={false} />
                              <ScrollableText text={group.name} hovered={hoveredGroupId() === group.id} />
                              <Show when={props.session && props.sessionGroupMapping?.[props.session.id]?.groupId === group.id}>
                                <img src={checkmarkPng} style={{ width: "14px", height: "14px", "flex-shrink": "0" }} alt="" draggable={false} />
                              </Show>
                            </button>
                          )}
                        </For>
                      </Show>
                    </div>
                    <div style={{ height: "1px", background: "rgba(0,0,0,0.08)", margin: "2px 0", "flex-shrink": "0" }} />
                    <button
                      data-slot="dropdown-menu-item"
                      class="flex items-center gap-2"
                      style={{ height: "36px", "flex-shrink": "0" }}
                      onClick={() => {
                        const s = props.session
                        if (!s) return
                        props.onCreateGroupForSession?.(s)
                      }}
                    >
                      <img src={folderLineClosePng} style={{ width: "14px", height: "14px", "flex-shrink": "0" }} alt="" draggable={false} />
                      <span data-slot="dropdown-menu-item-label">新建分组</span>
                    </button>
                  </div>
                </Show>
              </div>
            </Show>
            <Show when={props.session && props.sessionGroupMapping?.[props.session.id] && !props.session.pinned}>
              <button
                data-slot="dropdown-menu-item"
                class="flex items-center gap-2"
                onClick={() => {
                  const s = props.session
                  if (!s) return
                  props.onRemoveFromGroup?.(s)
                }}
              >
                <img src={folderBadgePlusPng} style={{ width: "14px", height: "14px", "flex-shrink": "0" }} alt="" draggable={false} />
                <span data-slot="dropdown-menu-item-label">移出此分组</span>
              </button>
            </Show>
          </div>
        </div>
      </Portal>
    </Show>
  )
}
