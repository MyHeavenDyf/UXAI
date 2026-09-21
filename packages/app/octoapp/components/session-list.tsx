import { Show, For, Index, Match, Switch, createEffect, createSignal, onCleanup, type JSX } from "solid-js"

export function ScrollableText(props: { text: string; hovered: boolean }) {
  const [isTruncated, setIsTruncated] = createSignal(false)
  const [overflow, setOverflow] = createSignal(0)
  const [isReadyToScroll, setIsReadyToScroll] = createSignal(false)
  let scrollDelayTimer: ReturnType<typeof setTimeout> | undefined
  let containerRef: HTMLDivElement | undefined
  let textRef: HTMLSpanElement | undefined
  let containerObserver: ResizeObserver | undefined
  let textObserver: ResizeObserver | undefined

  const checkTruncation = () => {
    if (containerRef && textRef) {
      const newOverflow = Math.max(0, textRef.offsetWidth - containerRef.clientWidth)
      setIsTruncated(newOverflow > 0)
      setOverflow(newOverflow)
    }
  }

  createEffect(() => {
    void props.text
    requestAnimationFrame(() => checkTruncation())
  })

  createEffect(() => {
    if (props.hovered && isTruncated()) {
      clearTimeout(scrollDelayTimer)
      setIsReadyToScroll(false)
      scrollDelayTimer = setTimeout(() => setIsReadyToScroll(true), 300)
    } else {
      clearTimeout(scrollDelayTimer)
      setIsReadyToScroll(false)
    }
  })

  onCleanup(() => {
    containerObserver?.disconnect()
    textObserver?.disconnect()
    clearTimeout(scrollDelayTimer)
  })

  const shouldScroll = () => props.hovered && isTruncated() && isReadyToScroll()

  return (
    <div
      ref={(el) => {
        containerRef = el
        containerObserver?.disconnect()
        containerObserver = new ResizeObserver(() => checkTruncation())
        containerObserver.observe(el)
        requestAnimationFrame(() => checkTruncation())
      }}
      class="flex-1 min-w-0"
      style={{
        overflow: "hidden",
        "white-space": "nowrap",
        "text-overflow": "clip",
        "mask-image": "linear-gradient(to right, #000 calc(100% - 36px), transparent)",
        "-webkit-mask-image": "linear-gradient(to right, #000 calc(100% - 36px), transparent)",
        "mask-size": "100% 100%",
        "-webkit-mask-size": "100% 100%",
        "mask-repeat": "no-repeat",
        "-webkit-mask-repeat": "no-repeat",
      }}
    >
      <span
        ref={(el) => {
          textRef = el
          textObserver?.disconnect()
          textObserver = new ResizeObserver(() => checkTruncation())
          textObserver.observe(el)
          requestAnimationFrame(() => checkTruncation())
        }}
        style={{
          display: "inline-block",
          "white-space": "nowrap",
          width: "max-content",
          transform: shouldScroll()
            ? `translateX(-${overflow()}px)`
            : "translateX(0)",
          transition: shouldScroll()
            ? `transform ${Math.max(overflow() / 40, 2)}s linear`
            : "transform 0.3s ease",
        }}
      >
        {props.text}
      </span>
    </div>
  )
}
import { Spinner } from "@opencode-ai/ui/spinner"
import { Icon } from "@opencode-ai/ui/icon"
import { sessionTitle } from "@/utils/session-title"
import { useNotification } from "@/context/notification"
import { usePermission } from "@/context/permission"
import { sessionPermissionRequest } from "@/pages/session/composer/session-request-tree"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { useGlobalSync } from "@/context/global-sync"

// ── Session status indicators (shared between Octo and Make) ──
function SessionStatusIndicator(props: { session: Session }) {
  const globalSync = useGlobalSync()
  const notification = useNotification()
  const permission = usePermission()

  const [sessionStore] = globalSync.child(props.session.directory)
  const isWorking = () => {
    const status = sessionStore.session_status[props.session.id]
    return status !== undefined && status.type !== "idle"
  }
  const unseenCount = () => notification.session.unseenCount(props.session.id)
  const hasError = () => notification.session.unseenHasError(props.session.id)
  const hasPermissions = () =>
    !!sessionPermissionRequest(sessionStore.session, sessionStore.permission, props.session.id, (item) =>
      !permission.autoResponds(item, props.session.directory),
    )

  return (
    <Show when={isWorking() || hasPermissions() || hasError() || unseenCount() > 0}>
      <div class="shrink-0 size-6 flex items-center justify-center absolute left-[12px]">
        <Switch>
          <Match when={isWorking()}>
            <Spinner class="size-[15px]" />
          </Match>
          <Match when={hasPermissions()}>
            <div class="size-1.5 rounded-full bg-surface-warning-strong" />
          </Match>
          <Match when={hasError()}>
            <div class="size-1.5 rounded-full bg-text-diff-delete-base" />
          </Match>
          <Match when={unseenCount() > 0}>
            <div class="size-1.5 rounded-full bg-text-interactive-base" />
          </Match>
        </Switch>
      </div>
    </Show>
  )
}

// ── Individual session item ──
export type SessionListItemProps = {
  session: Session
  isActive: boolean
  onClick?: () => void
  onContextMenu?: (e: MouseEvent) => void
  /** Action (three-dots) click handler. When provided, shows an ellipsis button on hover. */
  onActionClick?: (e: MouseEvent) => void
  /** Additional class for the button */
  class?: string
  /** Additional class when context menu is targeting this item */
  isContextTarget?: boolean
  /** When true, hover background applies even on the active (selected) item, overriding the active bg */
  hoverOnActive?: boolean
  /** Ref callback for scroll-into-view */
  ref?: (el: HTMLElement) => void
  /** Rename state: pass the ID of the session being renamed */
  renamingId?: string | null
  /** Current rename draft text */
  renameDraft?: string
  /** Callback when rename input value changes */
  onRenameInput?: (value: string) => void
  /** Callback when rename is saved (Enter or blur) */
  onRenameSave?: () => void
  /** Callback when rename is cancelled (Escape) */
  onRenameCancel?: () => void
  /** Whether this item is draggable */
  draggable?: boolean
  /** Whether this item is currently being dragged */
  isDragging?: boolean
  /** Whether this item is the current drop target */
  isDropTarget?: boolean
  /** Drop indicator position */
  dropIndicator?: "before" | "after" | null
  /** DnD event handlers */
  onDragStart?: (e: DragEvent) => void
  onDragEnd?: (e: DragEvent) => void
  onDragOver?: (e: DragEvent) => void
  onDragLeave?: (e: DragEvent) => void
  onDrop?: (e: DragEvent) => void
}

export function SessionListItem(props: SessionListItemProps) {
  const notification = useNotification()
  const isRenaming = () => props.renamingId === props.session.id
  const title = () => sessionTitle(props.session.title) || "无标题"

  const [isTruncated, setIsTruncated] = createSignal(false)
  const [isHovered, setIsHovered] = createSignal(false)
  const [overflow, setOverflow] = createSignal(0)
  const [isReadyToScroll, setIsReadyToScroll] = createSignal(false)
  let scrollDelayTimer: ReturnType<typeof setTimeout> | undefined
  let titleRef: HTMLDivElement | undefined
  let textRef: HTMLSpanElement | undefined
  let titleResizeObserver: ResizeObserver | undefined
  let textResizeObserver: ResizeObserver | undefined
  const checkTruncation = () => {
    if (titleRef && textRef) {
      const newOverflow = Math.max(0, textRef.offsetWidth - titleRef.clientWidth)
      setIsTruncated(newOverflow > 0)
      setOverflow(newOverflow)
    }
  }
  createEffect(() => {
    void title()
    requestAnimationFrame(() => checkTruncation())
  })
  onCleanup(() => {
    titleResizeObserver?.disconnect()
    textResizeObserver?.disconnect()
  })


  return (
    <Show
      when={!isRenaming()}
      fallback={
        <div
          class="w-full rounded-[8px] flex items-center"
          style={{ height: "36px", padding: "0 24px 0 40px" }}
        >
          <input
            value={props.renameDraft ?? ""}
            onInput={(e) => props.onRenameInput?.(e.currentTarget.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === "Enter") { e.preventDefault(); props.onRenameSave?.() }
              if (e.key === "Escape") { e.preventDefault(); props.onRenameCancel?.() }
            }}
            onBlur={() => props.onRenameSave?.()}
            class="w-full text-[12px] leading-[20px]"
            style={{
              color: props.isActive ? "#0A59F7" : "rgba(0,0,0,0.9)",
              border: "1px solid #0a59f7",
              "border-radius": "6px",
              padding: "4px",
              background: "transparent",
              outline: "none",
            }}
            ref={(el) => { requestAnimationFrame(() => el?.focus()) }}
          />
        </div>
      }
    >
      <div
        data-session-id={props.session.id}
        ref={(el) => {
          if (props.draggable) el.setAttribute("draggable", "true")
          props.ref?.(el)
        }}
        role="button"
        tabindex="0"
        onClick={() => {
          props.onClick?.()
          notification.session.markViewed(props.session.id)
        }}
        onContextMenu={(e) => { e.preventDefault(); props.onContextMenu?.(e) }}
        onMouseEnter={() => {
          setIsHovered(true)
          clearTimeout(scrollDelayTimer)
          setIsReadyToScroll(false)
          if (isTruncated()) {
            scrollDelayTimer = setTimeout(() => setIsReadyToScroll(true), 300)
          }
        }}
        onMouseLeave={() => {
          setIsHovered(false)
          clearTimeout(scrollDelayTimer)
          setIsReadyToScroll(false)
        }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); props.onClick?.(); notification.session.markViewed(props.session.id) } }}
        draggable={props.draggable}
        onDragStart={props.onDragStart}
        onDragEnd={props.onDragEnd}
        onDragOver={props.onDragOver}
        onDragLeave={props.onDragLeave}
        onDrop={props.onDrop}
        class="group w-full text-left rounded-[8px] text-[12px] leading-[20px] transition-colors flex items-center relative"
        style={{
          height: "36px",
          padding: "0 24px 0 40px",
          color: props.isActive ? "#0A59F7" : undefined,
          "-webkit-user-drag": props.draggable ? "element" : undefined,
        }}
        classList={{
          "bg-[rgba(10,89,247,0.08)]": props.isActive,
          "hover:bg-surface-base-hover": (!props.isActive || props.hoverOnActive) && !props.isContextTarget,
          "bg-[rgba(0,0,0,0.06)]": props.isContextTarget,
          "opacity-40": props.isDragging,
          "cursor-grabbing": props.isDragging,
        }}
      >
        <Show when={props.isDropTarget && props.dropIndicator}>
          <div
            class="absolute left-[8px] right-[8px] pointer-events-none"
            style={{
              height: "2px",
              background: "#0A59F7",
              "border-radius": "1px",
              "z-index": "10",
              top: props.dropIndicator === "before" ? "0" : undefined,
              bottom: props.dropIndicator === "after" ? "0" : undefined,
            }}
          />
        </Show>
        <Show when={props.isActive && !(props.hoverOnActive && isHovered())}>
          <span
            class="absolute right-[12px] top-1/2 rounded-full pointer-events-none"
            style={{
              height: "28px",
              width: "4px",
              background: "#0A59F7",
              transform: "translateY(-50%)",
            }}
          />
        </Show>
        <SessionStatusIndicator session={props.session} />
        <div
          ref={(el) => {
            titleRef = el
            titleResizeObserver?.disconnect()
            titleResizeObserver = new ResizeObserver(() => checkTruncation())
            titleResizeObserver.observe(el)
            requestAnimationFrame(() => checkTruncation())
          }}
          class="flex-1 min-w-0"
          style={{
            overflow: "hidden",
            "white-space": "nowrap",
            "text-overflow": "clip",
            "mask-image": "linear-gradient(to right, #000 calc(100% - 36px), transparent)",
            "-webkit-mask-image": "linear-gradient(to right, #000 calc(100% - 36px), transparent)",
            "mask-size": "100% 100%",
            "-webkit-mask-size": "100% 100%",
            "mask-repeat": "no-repeat",
            "-webkit-mask-repeat": "no-repeat",
          }}
        >
          <span
            ref={(el) => {
              textRef = el
              textResizeObserver?.disconnect()
              textResizeObserver = new ResizeObserver(() => checkTruncation())
              textResizeObserver.observe(el)
              requestAnimationFrame(() => checkTruncation())
            }}
            style={{
              display: "inline-block",
              "white-space": "nowrap",
              width: "max-content",
              transform: isHovered() && isTruncated() && isReadyToScroll()
                ? `translateX(-${overflow()}px)`
                : "translateX(0)",
              transition: isHovered() && isTruncated() && isReadyToScroll()
                ? `transform ${Math.max(overflow() / 40, 2)}s linear`
                : "transform 0.3s ease",
            }}
          >
            {title()}
          </span>
        </div>
        <Show when={props.onActionClick}>
          <div
            class="absolute right-[4px] top-1/2 -translate-y-1/2 flex items-center justify-center hover:bg-[rgba(0,0,0,0.06)]"
            style={{
              width: "20px",
              height: "20px",
              "border-radius": "4px",
              cursor: "pointer",
              opacity: isHovered() ? 1 : 0,
              transition: isHovered() ? "opacity 150ms" : "opacity 0ms",
              "pointer-events": isHovered() ? "auto" : "none",
            }}
            onClick={(e) => { if (!isHovered()) return; e.stopPropagation(); e.preventDefault(); props.onActionClick?.(e) }}
          >
            <Icon name="ellipsis" size="small" style={{ color: "rgba(0,0,0,0.6)", transform: "rotate(90deg)" }} />
          </div>
        </Show>
      </div>
    </Show>
  )
}

// ── Session list ──
export type SessionListProps = {
  /** Array of sessions to display */
  sessions: Session[]
  /** Currently active session ID */
  activeSessionId?: string
  /** Whether data is still loading (shows skeleton) */
  loading?: boolean
  /** Whether data matches current directory (false = show skeleton) */
  stable?: boolean
  /** Text when no sessions */
  emptyText?: string
  /** Whether in onboarding state */
  isOnboarding?: boolean
  /** Click handler for session item */
  onSessionClick?: (session: Session) => void
  /** Right-click handler for session item */
  onSessionContextMenu?: (session: Session, e: MouseEvent) => void
  /** Action (three-dots) click handler for session items. When provided, shows an ellipsis button on hover. */
  onSessionActionClick?: (session: Session, e: MouseEvent) => void
  /** Whether there are more sessions to load */
  hasMore?: boolean
  /** Load more handler */
  onLoadMore?: () => void
  /** Whether loading more sessions */
  loadingMore?: boolean
  /** Custom render for each session item (for rename, etc.) */
  renderItem?: (session: Session) => JSX.Element
  /** Ref callback for session items (for scroll-into-view) */
  itemRef?: (session: Session, el: HTMLElement) => void
  /** Check if context menu is targeting this session */
  isContextTarget?: (session: Session) => boolean
  /** When true, hover background applies even on the active (selected) item, overriding the active bg */
  hoverOnActive?: boolean
  /** ID of the session currently being renamed */
  renamingId?: string | null
  /** Current rename draft text */
  renameDraft?: string
  /** Callback when rename input value changes */
  onRenameInput?: (value: string) => void
  /** Callback when rename is saved (Enter or blur) */
  onRenameSave?: () => void
  /** Callback when rename is cancelled (Escape) */
  onRenameCancel?: () => void
  /** DnD: whether items are draggable */
  itemsDraggable?: boolean
  /** DnD: ID of session being dragged */
  draggingSessionId?: string | null
  /** DnD: ID of session being hovered over */
  dragOverSessionId?: string | null
  /** DnD: drop position for hovered session */
  sessionDropPosition?: "before" | "after" | null
  /** DnD: drag start handler */
  onSessionDragStart?: (session: Session) => void
  /** DnD: drag end handler */
  onSessionDragEnd?: () => void
  /** DnD: drag over handler */
  onSessionDragOver?: (e: DragEvent, session: Session) => void
  /** DnD: drag leave handler */
  onSessionDragLeave?: (e: DragEvent, session: Session) => void
  /** DnD: drop handler */
  onSessionDrop?: (e: DragEvent, session: Session) => void
  /** DnD: drop on empty area handler */
  onEmptyDrop?: (e: DragEvent) => void
  /** When true, render the empty drop zone as plain text instead of the dashed placeholder box (still droppable) */
  plainEmptyDropZone?: boolean
  /** When true, use Index instead of For (fixes prepend flicker for pinned list) */
  useIndex?: boolean
}

/**
 * Shared session list component.
 *
 * Handles loading skeleton, empty state, session items with status indicators,
 * and optional "load more" pagination.
 *
 * ```tsx
 * <SessionList
 *   sessions={sessionList()}
 *   activeSessionId={activeSessionId()}
 *   stable={stable()}
 *   emptyText="暂无对话"
 *   onSessionClick={(s) => navigate(`/make/${s.id}`)}
 * />
 * ```
 */
export function SessionList(props: SessionListProps) {
  return (
    <div class="flex flex-col mb-[2px]">
      <Show
        when={props.stable ?? true}
        fallback={
          <div class="px-[8px] py-[6px]">
            <div class="h-[10px] w-[80px] rounded-[3px] animate-pulse" style={{ background: "rgba(0,0,0,0.08)" }} />
          </div>
        }
      >
        <Show
          when={props.sessions.length > 0}
          fallback={
            <Show
              when={props.itemsDraggable && !props.isOnboarding}
              fallback={
                <div class="pl-[40px] pr-[8px] py-[5px] text-[12px] leading-[20px]" style={{ color: "var(--octo-text-secondary, #777777)" }}>
                  {props.isOnboarding ? "请先选择项目目录" : (props.emptyText ?? "暂无对话")}
                </div>
              }
            >
              <div
                class={props.plainEmptyDropZone
                  ? "pl-[40px] pr-[8px] py-[5px] text-[12px] leading-[20px]"
                  : "flex items-center justify-center rounded-[8px] transition-colors"}
                style={props.plainEmptyDropZone
                  ? { color: "var(--octo-text-secondary, #777777)" }
                  : { height: "36px", border: "1px dashed rgba(10,89,247,0.25)", margin: "2px 0" }}
                onDragOver={(e) => {
                  if (props.draggingSessionId) {
                    e.preventDefault()
                    if (e.dataTransfer) e.dataTransfer.dropEffect = "move"
                  }
                }}
                onDrop={(e) => { e.preventDefault(); props.onEmptyDrop?.(e) }}
              >
                {props.plainEmptyDropZone
                  ? (props.emptyText ?? "暂无对话")
                  : <span class="text-[12px]" style={{ color: "rgba(0,0,0,0.35)" }}>拖拽到此处</span>
                }
              </div>
            </Show>
          }
        >
          <Show when={props.useIndex} fallback={
            <For each={props.sessions}>
              {(session) => {
                const customItem = props.renderItem?.(session)
                if (customItem) return customItem
                return (
                  <SessionListItem
                    session={session}
                    isActive={props.activeSessionId === session.id}
                    onClick={() => props.onSessionClick?.(session)}
                    onContextMenu={props.onSessionContextMenu ? (e) => props.onSessionContextMenu!(session, e) : undefined}
                    onActionClick={props.onSessionActionClick ? (e) => props.onSessionActionClick!(session, e) : undefined}
                    isContextTarget={props.isContextTarget?.(session)}
                    hoverOnActive={props.hoverOnActive}
                    ref={props.itemRef ? (el) => props.itemRef!(session, el) : undefined}
                    renamingId={props.renamingId}
                    renameDraft={props.renameDraft}
                    onRenameInput={props.onRenameInput}
                    onRenameSave={props.onRenameSave}
                    onRenameCancel={props.onRenameCancel}
                    draggable={props.itemsDraggable}
                    isDragging={props.draggingSessionId === session.id}
                    isDropTarget={props.dragOverSessionId === session.id}
                    dropIndicator={props.dragOverSessionId === session.id ? props.sessionDropPosition : null}
                    onDragStart={(e) => {
                      if (e.dataTransfer) {
                        e.dataTransfer.effectAllowed = "move"
                        e.dataTransfer.setData("application/x-session-id", session.id)
                        e.dataTransfer.setData("text/plain", session.id)
                      }
                      props.onSessionDragStart?.(session)
                    }}
                    onDragEnd={() => props.onSessionDragEnd?.()}
                    onDragOver={(e) => props.onSessionDragOver?.(e, session)}
                    onDragLeave={(e) => props.onSessionDragLeave?.(e, session)}
                    onDrop={(e) => props.onSessionDrop?.(e, session)}
                  />
                )
              }}
            </For>
          }>
            <Index each={props.sessions}>
              {(session) => {
                const customItem = props.renderItem?.(session())
                if (customItem) return customItem
                return (
                  <SessionListItem
                    session={session()}
                    isActive={props.activeSessionId === session().id}
                    onClick={() => props.onSessionClick?.(session())}
                    onContextMenu={props.onSessionContextMenu ? (e) => props.onSessionContextMenu!(session(), e) : undefined}
                    onActionClick={props.onSessionActionClick ? (e) => props.onSessionActionClick!(session(), e) : undefined}
                    isContextTarget={props.isContextTarget?.(session())}
                    hoverOnActive={props.hoverOnActive}
                    ref={props.itemRef ? (el) => props.itemRef!(session(), el) : undefined}
                    renamingId={props.renamingId}
                    renameDraft={props.renameDraft}
                    onRenameInput={props.onRenameInput}
                    onRenameSave={props.onRenameSave}
                    onRenameCancel={props.onRenameCancel}
                    draggable={props.itemsDraggable}
                    isDragging={props.draggingSessionId === session().id}
                    isDropTarget={props.dragOverSessionId === session().id}
                    dropIndicator={props.dragOverSessionId === session().id ? props.sessionDropPosition : null}
                    onDragStart={(e) => {
                      const s = session()
                      if (e.dataTransfer) {
                        e.dataTransfer.effectAllowed = "move"
                        e.dataTransfer.setData("application/x-session-id", s.id)
                        e.dataTransfer.setData("text/plain", s.id)
                      }
                      props.onSessionDragStart?.(s)
                    }}
                    onDragEnd={() => props.onSessionDragEnd?.()}
                    onDragOver={(e) => props.onSessionDragOver?.(e, session())}
                    onDragLeave={(e) => props.onSessionDragLeave?.(e, session())}
                    onDrop={(e) => props.onSessionDrop?.(e, session())}
                  />
                )
              }}
            </Index>
          </Show>
          <Show when={props.hasMore}>
            <button
              type="button"
              disabled={props.loadingMore}
              onClick={props.onLoadMore}
              class="w-full text-left rounded-[8px] text-[12px] leading-[20px] transition-colors flex items-center hover:bg-surface-base-hover disabled:opacity-60"
              style={{ height: "36px", padding: "0 24px 0 40px", color: "rgba(0,0,0,0.6)" }}
            >
              {props.loadingMore ? "加载中…" : "加载更多"}
            </button>
          </Show>
        </Show>
      </Show>
    </div>
  )
}
