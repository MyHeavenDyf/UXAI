import { createEffect, createMemo, For, on, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { sessionThumbnailUsesVideoElement, type ThumbnailMap } from "../session-thumbnail"
import { boardErrorMessage } from "./studio-board-api"

export type BoardSessionPage = {
  sessions: Session[]
  nextCursor?: string
}

export function StudioBoardHeader(props: {
  title?: string
  sessionID?: string
  status: string
  pending: boolean
  failed: boolean
  disabled: boolean
  thumbnails?: ThumbnailMap
  mediaURL: (value?: string) => string | undefined
  loadSessions?: (cursor?: string) => Promise<BoardSessionPage>
  loadThumbnails?: (sessions: BoardSessionPage["sessions"]) => void
  onRename: (title: string) => Promise<void>
  onSelect?: (id?: string) => void
  onExit: () => void
  onSave: () => void
}) {
  const [state, setState] = createStore({
    title: props.title ?? "未命名画布",
    draft: "",
    editing: false,
    renaming: false,
    open: false,
    loading: false,
    sessions: [] as BoardSessionPage["sessions"],
    cursor: undefined as string | undefined,
    retryCursor: undefined as string | undefined,
    renameError: "",
    listError: "",
  })
  let root!: HTMLDivElement
  let menu!: HTMLDivElement
  let trigger!: HTMLButtonElement
  let token = 0
  const rows = createMemo(() =>
    props.sessionID && !state.sessions.some((item) => item.id === props.sessionID)
      ? [{ id: props.sessionID, title: state.title }, ...state.sessions]
      : state.sessions,
  )
  createEffect(
    on(
      () => props.title,
      (title) => {
        if (title !== undefined) setState("title", title)
      },
    ),
  )
  onCleanup(() => token++)

  async function load(cursor?: string) {
    if (!props.loadSessions || state.loading) return
    const current = ++token
    setState({ loading: true, listError: "", retryCursor: cursor })
    await props
      .loadSessions(cursor)
      .then((page) => {
        if (current !== token) return
        setState({
          sessions: cursor
            ? [...state.sessions, ...page.sessions.filter((item) => !state.sessions.some((old) => old.id === item.id))]
            : page.sessions,
          cursor: page.nextCursor,
        })
        props.loadThumbnails?.(page.sessions)
      })
      .catch((error: unknown) => {
        if (current === token) setState("listError", boardErrorMessage(error, "画布列表加载失败"))
      })
    if (current === token) setState("loading", false)
  }

  function rename() {
    if (!state.editing || state.renaming) return
    const title = state.draft.trim()
    if (!title || title === state.title) {
      setState({ editing: false, renameError: "" })
      return
    }
    setState({ renaming: true, renameError: "" })
    void props
      .onRename(title)
      .then(() => {
        setState({ title, editing: false })
        setState("sessions", (item) => item.id === props.sessionID, "title", title)
      })
      .catch((error: unknown) => {
        setState("renameError", boardErrorMessage(error, "画布名称保存失败"))
      })
      .finally(() => setState("renaming", false))
  }

  createEffect(() => {
    if (!state.open) return
    const dismiss = (event: Event) => {
      if (event.target instanceof Node && !root.contains(event.target)) setState("open", false)
    }
    document.addEventListener("pointerdown", dismiss, true)
    document.addEventListener("focusin", dismiss, true)
    onCleanup(() => {
      document.removeEventListener("pointerdown", dismiss, true)
      document.removeEventListener("focusin", dismiss, true)
    })
  })

  return (
    <div ref={root!} class="studio-board-header-left">
      <button
        type="button"
        class="studio-board-exit"
        aria-label="退出画布"
        title="退出画布"
        disabled={props.disabled}
        onClick={props.onExit}
      >
        <img src="/studio/chevron_down.svg" alt="" />
      </button>
      <div class="studio-board-heading">
        <Show
          when={state.editing}
          fallback={
            <button
              type="button"
              class="studio-board-name"
              title={state.title}
              aria-label={`重命名画布：${state.title}`}
              disabled={props.disabled}
              onClick={() => setState({ editing: true, draft: state.title, open: false, renameError: "" })}
            >
              {state.title}
            </button>
          }
        >
          <input
            ref={(element) =>
              queueMicrotask(() => {
                element.focus()
                element.select()
              })
            }
            class="studio-board-name-input"
            aria-label="画布名称"
            value={state.draft}
            disabled={state.renaming}
            style={{
              width: `${Math.max(
                5,
                Array.from(state.draft).reduce((length, char) => length + (char.charCodeAt(0) > 255 ? 2 : 1), 0),
              )}ch`,
            }}
            onInput={(event) => setState("draft", event.currentTarget.value)}
            onBlur={rename}
            onKeyDown={(event) => {
              if (event.isComposing) return
              if (event.key === "Enter") {
                event.preventDefault()
                event.stopPropagation()
                event.currentTarget.blur()
              }
              if (event.key === "Escape") {
                event.preventDefault()
                event.stopPropagation()
                setState({ editing: false, renameError: "" })
              }
            }}
          />
        </Show>
        <button
          ref={trigger!}
          type="button"
          class="studio-board-switch"
          aria-label="切换画布"
          aria-haspopup="menu"
          aria-expanded={state.open}
          disabled={props.disabled || !props.onSelect || !props.loadSessions}
          onClick={() => {
            const open = !state.open
            setState("open", open)
            if (open) void load()
          }}
        >
          <img src="/studio/chevron_down.svg" alt="" />
        </button>
      </div>
      <button
        type="button"
        class="studio-board-cloud"
        classList={{
          pending: props.pending || state.renaming || (state.editing && state.draft.trim() !== state.title),
          failed: props.failed || !!state.renameError,
        }}
        aria-label="保存画布"
        title={state.renameError || (state.renaming ? "正在保存画布名称" : props.status)}
        disabled={props.disabled || state.renaming}
        onClick={() => {
          setState("open", false)
          props.onSave()
        }}
      >
        <span aria-hidden="true" />
      </button>
      <Show when={state.renameError && !state.open}>
        <p class="studio-board-heading-error" role="alert">
          {state.renameError}
        </p>
      </Show>
      <Show when={state.open}>
        <div
          ref={menu!}
          class="studio-board-session-menu"
          role="menu"
          aria-label="切换画布"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault()
              event.stopPropagation()
              setState("open", false)
              trigger.focus()
              return
            }
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return
            const items = Array.from(menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"))
            if (!items.length) return
            event.preventDefault()
            const index = items.findIndex((item) => item === document.activeElement)
            items[
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? items.length - 1
                  : (index + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length
            ].focus()
          }}
        >
          <Show when={rows().length}>
            <ScrollView
              class="studio-board-session-list"
              style={{ height: `${Math.min(236, rows().length * 40 - 4)}px` }}
            >
              <For each={rows()}>
                {(session) => {
                  const entry = () => props.thumbnails?.[session.id]
                  const source = () => props.mediaURL(entry()?.url)
                  const title = () => (session.id === props.sessionID ? state.title : session.title)
                  return (
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={session.id === props.sessionID}
                      class="studio-board-session-row"
                      title={title()}
                      onClick={() => {
                        setState("open", false)
                        props.onSelect?.(session.id)
                      }}
                    >
                      <span class="studio-board-session-thumb">
                        <Show
                          when={source()}
                          fallback={<span class="studio-board-session-placeholder" aria-hidden="true" />}
                        >
                          <Show
                            when={sessionThumbnailUsesVideoElement(entry())}
                            fallback={<img src={source()} alt="" />}
                          >
                            <video src={source()} muted playsinline preload="metadata" />
                          </Show>
                        </Show>
                      </span>
                      <span class="studio-board-session-title">{title()}</span>
                      <Show when={session.id === props.sessionID}>
                        <img class="studio-board-session-check" src="/studio/checkmark.svg" alt="当前画布" />
                      </Show>
                    </button>
                  )
                }}
              </For>
            </ScrollView>
          </Show>
          <Show when={state.loading}>
            <p class="studio-board-session-message" role="status">
              正在加载画布…
            </p>
          </Show>
          <Show when={state.listError}>
            <button type="button" class="studio-board-session-message" onClick={() => void load(state.retryCursor)}>
              加载失败，点击重试
            </button>
          </Show>
          <Show when={state.cursor && !state.loading && !state.listError}>
            <button type="button" class="studio-board-session-message" onClick={() => void load(state.cursor)}>
              加载更多
            </button>
          </Show>
          <div class="studio-board-session-divider" />
          <button
            type="button"
            role="menuitem"
            class="studio-board-session-new"
            onClick={() => {
              setState("open", false)
              props.onSelect?.()
            }}
          >
            <span>新建画布</span>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="1" stroke-linecap="round" />
            </svg>
          </button>
        </div>
      </Show>
    </div>
  )
}
