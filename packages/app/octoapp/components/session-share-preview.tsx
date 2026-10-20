import type { Session } from "@opencode-ai/sdk/v2/client"
import { createMemo, For, onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobalSDK } from "@/context/global-sdk"
import {
  previewLayout,
  previewMessageContent,
  previewMarkdown,
  SHARE_PREVIEW_LIMIT,
  type SharePreviewMessage,
} from "./session-share-preview-utils"

function PreviewMessage(props: { message: SharePreviewMessage; top: number; resize: (height: number) => void }) {
  const content = createMemo(() => previewMessageContent(props.message))
  const [state, setState] = createStore({ expanded: false })
  let root!: HTMLElement
  onMount(() => {
    const observer = new ResizeObserver(() => props.resize(root.getBoundingClientRect().height))
    observer.observe(root)
    onCleanup(() => observer.disconnect())
  })
  return (
    <article
      ref={root}
      class="share-preview-message"
      classList={{ "is-user": props.message.role === "user" }}
      style={{ top: `${props.top}px` }}
    >
      <div class="share-preview-role">{props.message.role === "user" ? "用户" : "Octo Agent"}</div>
      <Show when={content().files.length}>
        <div class="share-preview-files">
          <For each={content().files}>{(file) => <span title={file.name}>▧ {file.name}</span>}</For>
        </div>
      </Show>
      <Show when={content().text}>
        <Show
          when={props.message.role === "assistant" && (state.expanded || content().text.length <= 360)}
          fallback={
            <p class="share-preview-text">
              {state.expanded ? content().text : content().text.slice(0, 360)}
              {!state.expanded && content().text.length > 360 ? "…" : ""}
            </p>
          }
        >
          <div class="share-preview-markdown" innerHTML={previewMarkdown(content().text)} />
        </Show>
        <Show when={content().text.length > 360 || state.expanded}>
          <button
            type="button"
            class="share-preview-text-action"
            onClick={() => setState("expanded", (value) => !value)}
          >
            {state.expanded ? "收起" : "展开正文"}
          </button>
        </Show>
      </Show>
      <Show when={props.message.truncated}>
        <p class="share-preview-muted">超长内容已精简，完整记录以分享文件为准</p>
      </Show>
    </article>
  )
}

export function SessionSharePreview(props: { session: Session }) {
  const globalSDK = useGlobalSDK()
  const client = globalSDK.createClient({ directory: props.session.directory })
  const [state, setState] = createStore({
    messages: [] as SharePreviewMessage[],
    heights: {} as Record<string, number>,
    before: undefined as string | undefined,
    loading: false,
    loaded: false,
    error: "",
    running: false,
    changed: false,
    top: 0,
    viewport: 280,
    contentHeight: 0,
    trimmed: false,
  })
  let viewport!: HTMLDivElement
  let content!: HTMLDivElement
  let controller: AbortController | undefined
  let retryBefore: string | undefined
  let disposed = false
  const layout = createMemo(() => previewLayout(state.messages, state.heights, state.top, state.viewport))

  const load = async (before?: string) => {
    if (state.loading) return
    retryBefore = before
    controller = new AbortController()
    const signal = controller.signal
    const anchor = before
      ? layout().visible.find((message) => layout().offsets[message.id] >= state.top)?.id
      : undefined
    const anchorTop = anchor ? layout().offsets[anchor] - state.top : 0
    setState({ loading: true, error: "" })
    await client.session
      .sharePreview(
        { sessionID: props.session.id, limit: 20, before },
        { signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) },
      )
      .then((response) => {
        if (disposed || signal.aborted) return
        if (!response.data) throw new Error("无法加载聊天预览")
        const messages = before ? [...response.data.messages, ...state.messages] : response.data.messages
        const unique = [...new Map(messages.map((message) => [message.id, message])).values()]
        setState({
          messages: unique.slice(0, SHARE_PREVIEW_LIMIT),
          before: response.data.before,
          running: response.data.running,
          loaded: true,
          changed: before ? state.changed : false,
          trimmed: before ? state.trimmed || unique.length > SHARE_PREVIEW_LIMIT : false,
          heights: Object.fromEntries(
            unique
              .slice(0, SHARE_PREVIEW_LIMIT)
              .flatMap((message) => (state.heights[message.id] ? [[message.id, state.heights[message.id]]] : [])),
          ),
        })
        viewport.scrollTop =
          anchor && layout().offsets[anchor] !== undefined ? Math.max(0, layout().offsets[anchor] - anchorTop) : 0
        setState("top", viewport.scrollTop)
      })
      .catch((error: unknown) => {
        if (!disposed && !signal.aborted)
          setState("error", error instanceof Error ? error.message : "无法加载聊天预览，请重试")
      })
      .finally(() => {
        if (!disposed && !signal.aborted) setState("loading", false)
      })
  }

  onMount(() => {
    const observer = new ResizeObserver(() =>
      setState({ viewport: viewport.clientHeight, contentHeight: content.scrollHeight, top: viewport.scrollTop }),
    )
    observer.observe(viewport)
    observer.observe(content)
    void load()
    onCleanup(() => observer.disconnect())
  })
  const unsubscribe = globalSDK.event.listen((event) => {
    if (event.name !== props.session.directory || !state.loaded) return
    const details = event.details
    if (
      (details.type === "session.updated" && details.properties.info.id === props.session.id) ||
      (details.type === "session.status" && details.properties.sessionID === props.session.id) ||
      (details.type === "message.updated" && details.properties.info.sessionID === props.session.id)
    ) {
      setState("changed", true)
    }
  })
  onCleanup(() => {
    disposed = true
    controller?.abort()
    unsubscribe()
  })

  return (
    <div class="session-share-preview-live">
      <div class="share-preview-toolbar">
        <span>
          {state.changed ? "对话有更新，可刷新预览" : state.running ? "对话仍在生成，分享以生成时为准" : "聊天记录预览"}
        </span>
        <button type="button" disabled={state.loading} onClick={() => void load()}>
          {state.trimmed ? "回到最新" : "刷新"}
        </button>
      </div>
      <div
        class="share-preview-viewport"
        classList={{ "has-more": state.contentHeight - state.top > state.viewport + 2 }}
      >
        <div
          ref={viewport}
          class="session-share-preview"
          tabindex="0"
          role="region"
          aria-label="聊天记录预览"
          aria-busy={state.loading}
          onScroll={() => setState("top", viewport.scrollTop)}
        >
          <div ref={content}>
            <div class="share-preview-pages">
              <Show when={state.before}>
                <button type="button" disabled={state.loading} onClick={() => void load(state.before)}>
                  加载更早记录
                </button>
              </Show>
              <Show when={state.loading}>
                <p class="share-preview-muted" role="status">
                  正在加载…
                </p>
              </Show>
              <Show when={state.error}>
                <p class="session-share-error" role="alert">
                  {state.error}
                </p>
                <button type="button" disabled={state.loading} onClick={() => void load(retryBefore)}>
                  重试
                </button>
              </Show>
              <Show when={state.loaded && !state.messages.length && !state.loading && !state.error}>
                <p class="share-preview-muted">
                  {state.before ? "本页暂无可展示正文，可加载更早记录" : "暂无可展示的聊天记录"}
                </p>
              </Show>
            </div>
            <div class="share-preview-window" style={{ height: `${layout().height}px` }}>
              <For each={layout().visible}>
                {(message) => (
                  <PreviewMessage
                    message={message}
                    top={layout().offsets[message.id]}
                    resize={(height) => {
                      if (Math.abs((state.heights[message.id] ?? 144) - height) < 1) return
                      const above = layout().offsets[message.id] < state.top
                      const delta = height - (state.heights[message.id] ?? 144)
                      setState("heights", message.id, height)
                      if (above) {
                        viewport.scrollTop += delta
                        setState("top", viewport.scrollTop)
                      }
                    }}
                  />
                )}
              </For>
            </div>
          </div>
        </div>
      </div>
      <p class="share-preview-muted">仅预览正文和附件名称，不执行产物；工具详情及完整产物仍包含在分享文件中。</p>
    </div>
  )
}
