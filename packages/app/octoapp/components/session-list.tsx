import { Show, For, Match, Switch, createEffect, createSignal, onCleanup, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import { Spinner } from "@opencode-ai/ui/spinner"
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
  /** Additional class for the button */
  class?: string
  /** Additional class when context menu is targeting this item */
  isContextTarget?: boolean
  /** Ref callback for scroll-into-view */
  ref?: (el: HTMLButtonElement) => void
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
}

export function SessionListItem(props: SessionListItemProps) {
  const notification = useNotification()
  const isRenaming = () => props.renamingId === props.session.id
  const title = () => sessionTitle(props.session.title) || "无标题"

  const [isTruncated, setIsTruncated] = createSignal(false)
  let titleRef: HTMLSpanElement | undefined
  let titleResizeObserver: ResizeObserver | undefined
  const checkTruncation = () => {
    if (titleRef) setIsTruncated(titleRef.scrollWidth > titleRef.clientWidth)
  }
  createEffect(() => {
    void title()
    queueMicrotask(() => checkTruncation())
  })
  onCleanup(() => titleResizeObserver?.disconnect())

  const [showTooltip, setShowTooltip] = createSignal(false)
  let tooltipTimeout: ReturnType<typeof setTimeout> | undefined
  let tooltipRef!: HTMLDivElement
  const [tooltipStyle, setTooltipStyle] = createSignal<JSX.CSSProperties>({})
  const updateTooltipPos = () => {
    if (!titleRef) return
    const rect = titleRef.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const style: JSX.CSSProperties = { left: `${rect.left}px` }
    if (spaceBelow >= 130 || spaceBelow >= rect.top) {
      style.top = `${rect.bottom + 4}px`
    } else {
      style.bottom = `${window.innerHeight - rect.top + 4}px`
    }
    setTooltipStyle(style)
  }
  const enterTrigger = () => {
    if (!isTruncated()) return
    clearTimeout(tooltipTimeout)
    updateTooltipPos()
    tooltipTimeout = setTimeout(() => setShowTooltip(true), 500)
  }
  const leaveTrigger = () => {
    clearTimeout(tooltipTimeout)
    setShowTooltip(false)
  }
  const enterTooltip = () => clearTimeout(tooltipTimeout)
  const leaveTooltip = () => setShowTooltip(false)

  return (
    <Show
      when={!isRenaming()}
      fallback={
        <div
          class="w-full rounded-[8px] flex items-center"
          style={{ height: "36px", padding: "0 24px 0 44px" }}
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
      <button
        data-session-id={props.session.id}
        ref={props.ref}
        type="button"
        onClick={() => {
          props.onClick?.()
          notification.session.markViewed(props.session.id)
        }}
        onContextMenu={(e) => { e.preventDefault(); props.onContextMenu?.(e) }}
        onMouseEnter={enterTrigger}
        onMouseLeave={leaveTrigger}
        class="w-full text-left rounded-[8px] text-[12px] leading-[20px] transition-colors flex items-center relative"
        style={{
          height: "36px",
          padding: "0 24px 0 44px",
          color: props.isActive ? "#0A59F7" : undefined,
        }}
        classList={{
          "bg-[rgba(10,89,247,0.08)]": props.isActive,
          "hover:bg-surface-base-hover": !props.isActive && !props.isContextTarget,
          "bg-[rgba(0,0,0,0.06)]": props.isContextTarget,
        }}
      >
        <Show when={props.isActive}>
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
        <span
          ref={(el) => {
            titleRef = el
            titleResizeObserver?.disconnect()
            titleResizeObserver = new ResizeObserver(() => checkTruncation())
            titleResizeObserver.observe(el)
            queueMicrotask(() => checkTruncation())
          }}
          class="flex-1 min-w-0 truncate"
        >
          {title()}
        </span>
      </button>
      <Show when={showTooltip()}>
        <Portal>
          <div
            ref={tooltipRef!}
            style={tooltipStyle()}
            onMouseEnter={enterTooltip}
            onMouseLeave={leaveTooltip}
            class="studio-custom-tooltip fixed z-[1000]"
          >
            {title()}
          </div>
        </Portal>
      </Show>
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
  /** Whether there are more sessions to load */
  hasMore?: boolean
  /** Load more handler */
  onLoadMore?: () => void
  /** Whether loading more sessions */
  loadingMore?: boolean
  /** Custom render for each session item (for rename, etc.) */
  renderItem?: (session: Session) => JSX.Element
  /** Ref callback for session items (for scroll-into-view) */
  itemRef?: (session: Session, el: HTMLButtonElement) => void
  /** Check if context menu is targeting this session */
  isContextTarget?: (session: Session) => boolean
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
            <div class="px-[8px] py-[5px] text-[12px] leading-[20px]" style={{ color: "var(--octo-text-secondary, #777777)" }}>
              {props.isOnboarding ? "请先选择项目目录" : (props.emptyText ?? "暂无对话")}
            </div>
          }
        >
          <For each={props.sessions}>
            {(session) => {
              const customItem = props.renderItem?.(session)
              // If renderItem returns something (e.g. rename input), render it
              // Otherwise render SessionListItem with ref for scroll-into-view
              if (customItem) {
                return customItem
              }
              return (
                <SessionListItem
                  session={session}
                  isActive={props.activeSessionId === session.id}
                  onClick={() => props.onSessionClick?.(session)}
                  onContextMenu={props.onSessionContextMenu ? (e) => props.onSessionContextMenu!(session, e) : undefined}
                  isContextTarget={props.isContextTarget?.(session)}
                  ref={props.itemRef ? (el) => props.itemRef!(session, el) : undefined}
                  renamingId={props.renamingId}
                  renameDraft={props.renameDraft}
                  onRenameInput={props.onRenameInput}
                  onRenameSave={props.onRenameSave}
                  onRenameCancel={props.onRenameCancel}
                />
              )
            }}
          </For>
          <Show when={props.hasMore}>
            <button
              type="button"
              disabled={props.loadingMore}
              onClick={props.onLoadMore}
              class="w-full text-left rounded-[8px] text-[12px] leading-[20px] transition-colors flex items-center hover:bg-surface-base-hover disabled:opacity-60"
              style={{ height: "36px", padding: "0 24px 0 44px", color: "rgba(0,0,0,0.6)" }}
            >
              {props.loadingMore ? "加载中…" : "加载更多"}
            </button>
          </Show>
        </Show>
      </Show>
    </div>
  )
}
