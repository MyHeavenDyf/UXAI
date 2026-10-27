import { createContext, createEffect, createMemo, onCleanup, Show, useContext, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { useParams } from "@solidjs/router"
import { useSDK } from "@/context/sdk"
import { useProjectDir } from "@/hooks/use-project-dir"
import { showToast } from "@opencode-ai/ui/toast"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { HistoryPanel } from "../../../make/components/result-viewer/history-panel"
import type { VersionEntry } from "../../../make/utils/history-store"
import { getDesktopApi } from "../../lib/electron-api"
import { createHtmlHistory } from "../../utils/html-history"
import { createHtmlComments } from "../../utils/html-comments"
import { tabLocalPath, type ResultTab } from "./tab-store"

function createReview(props: { tab: ResultTab | null; tabs: ResultTab[]; refreshKey: number; working?: boolean; onRestore: () => void }) {
  const params = useParams()
  const sdk = useSDK()
  const directory = useProjectDir()
  const [state, setState] = createStore({
    commenting: false, busy: false, entries: [] as VersionEntry[], current: null as string | null,
  })
  const path = createMemo(() => props.tab ? tabLocalPath(props.tab) : undefined)
  const key = createMemo(() => JSON.stringify([directory(), params.id, props.tab?.id, path()]))
  const eligible = createMemo(() => props.tab?.type === "html" && !!path() && !!params.id && !!directory())
  const otherPaths = createMemo(() => [...new Set(props.tabs.filter(tab => tab.type === "html").flatMap(tab => {
    const local = tabLocalPath(tab)
    return local && local !== path() ? [local] : []
  }))].join("\n"))
  const comments = createMemo(() => eligible() ? createHtmlComments({
    url: sdk.url, directory: directory()!, sessionId: params.id!, filePath: path()!,
  }) : undefined)
  const history = createMemo(() => {
    const api = getDesktopApi()
    return eligible() && api?.readFileBuffer && api.writeFileBuffer && api.listDirectory && api.dirExists
      ? createHtmlHistory(path()!, api) : undefined
  })
  let disposed = false
  let wasWorking = false
  onCleanup(() => { disposed = true })
  createEffect(() => {
    key()
    setState({ commenting: false, entries: [], current: null, busy: false })
  })
  createEffect(() => {
    if (props.tab?.viewMode === "source") setState("commenting", false)
  })
  createEffect(() => {
    props.refreshKey
    const other = otherPaths()
    const store = history()
    const scope = key()
    if (props.working) { wasWorking = true; return }
    const actor = wasWorking ? "agent" : "user"
    wasWorking = false
    const api = getDesktopApi()
    if (params.id && directory() && api?.readFileBuffer && api.writeFileBuffer && api.listDirectory && api.dirExists) {
      void Promise.all(other.split("\n").filter(Boolean).map(file => createHtmlHistory(file, api).record(actor))).catch(() => {
        if (!disposed && key() === scope) showToast({ title: "部分 HTML 历史版本记录失败，请打开文件后重试", variant: "error" })
      })
    }
    if (!store) return
    let cancelled = false
    onCleanup(() => { cancelled = true })
    void store.record(actor).then(async entry => {
      const entries = await store.list()
      if (!cancelled && !disposed && key() === scope) setState({ entries, current: entry.id })
    }).catch(() => {
      if (!cancelled && !disposed && key() === scope) showToast({ title: "历史版本记录失败，请点击历史重试", variant: "error" })
    })
  })
  const run = async (task: () => Promise<void>) => {
    if (state.busy) return
    const scope = key()
    setState("busy", true)
    try {
      await task()
    } catch (error) {
      if (!disposed && key() === scope) showToast({ title: error instanceof Error ? error.message : "历史版本操作失败", variant: "error" })
    } finally {
      if (!disposed && key() === scope) setState("busy", false)
    }
  }
  return {
    state, key, path, comments, history,
    disabled: () => !eligible() ? "请先将 HTML 保存到本地并进入会话" : props.tab?.viewMode === "source" ? "请切换到预览视图" : "",
    toggle: () => {
      if (!localStorage.getItem("uiplusToken")) { showToast({ title: "请先登录" }); return }
      setState("commenting", value => !value)
    },
    refresh: () => run(async () => {
      const scope = key()
      const store = history()
      if (!store) return
      const entry = await store.record("user")
      const entries = await store.list()
      if (!disposed && scope === key()) setState({ entries, current: entry.id })
    }),
    restore: (entry: VersionEntry) => run(async () => {
      const scope = key()
      const store = history()
      if (!store || props.working) return
      await store.restore(entry.id)
      const entries = await store.list()
      if (disposed || scope !== key()) return
      setState({ entries, current: entry.id, commenting: false })
      props.onRestore()
      showToast({ title: "已恢复历史版本，恢复前的内容已保留" })
    }),
  }
}

const ReviewContext = createContext<ReturnType<typeof createReview>>()
export const useHtmlReview = () => useContext(ReviewContext)

// #124 开放 HTML 标注与历史版本，入口沿用各自工具栏的按钮样式。
const htmlReviewEnabled = true

export function HtmlReviewProvider(props: {
  tab: ResultTab | null; tabs: ResultTab[]; refreshKey: number; working?: boolean; onRestore: () => void; children: JSX.Element
}) {
  const review = htmlReviewEnabled ? createReview(props) : undefined
  return <ReviewContext.Provider value={review}>{props.children}</ReviewContext.Provider>
}

export function HtmlReviewActions(props: { tab: ResultTab; working?: boolean; loadState?: "loading" | "error" | "ready" }) {
  const review = useHtmlReview()
  const [state, setState] = createStore({
    open: false, anchor: null as DOMRect | null,
  })
  let button: HTMLButtonElement | undefined
  const buttonClass = () => props.tab.fromAttachment
    ? "octo-action-btn disabled:opacity-40 disabled:cursor-not-allowed"
    : "flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors octo-btn-action disabled:opacity-40 disabled:cursor-not-allowed"
  const iconSize = () => props.tab.fromAttachment ? 16 : 14
  const disabled = () => review?.disabled() || (props.loadState === "loading" ? "HTML 内容加载中" : props.loadState === "error" ? "请先重新加载 HTML" : "")
  createEffect(() => { review?.key(); props.tab.viewMode; setState("open", false) })
  return <Show when={props.tab.type === "html" && review}>
    <Tooltip value={disabled() || "标注"} placement="top">
      <button type="button" class={buttonClass()} disabled={!!disabled()}
        classList={{ "opacity-40": !!disabled(), "octo-viewport-btn-active": review?.state.commenting }}
        style={review?.state.commenting ? { color: "#0a59f7", background: "rgba(10,89,247,0.08)" } : undefined}
        aria-pressed={review?.state.commenting} onClick={() => review?.toggle()}>
        <svg aria-hidden="true" viewBox="0 0 20 20" width={iconSize()} height={iconSize()} fill="none"><path d="M2 18V10a8 8 0 1 1 8 8H2Z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round" /></svg><span>标注</span>
      </button>
    </Tooltip>
    <Tooltip value={!review?.history() ? "历史版本需要本地 HTML 和桌面端支持" : "历史版本"} placement="top">
      <button ref={button} type="button" class={buttonClass()}
        disabled={!review?.history() || review?.state.busy || props.working}
        classList={{ "opacity-40": !review?.history() || review?.state.busy || props.working }}
        aria-label="历史版本" aria-expanded={state.open}
        onClick={() => {
          setState({ open: !state.open, anchor: button?.getBoundingClientRect() ?? null })
          if (state.open) void review?.refresh()
        }}>
        <svg aria-hidden="true" viewBox="0 0 16 16" width={iconSize()} height={iconSize()} fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6" /><path d="M8 5v3l2 2" stroke-linecap="round" stroke-linejoin="round" /></svg><span>{review?.state.busy ? "处理中..." : "历史版本"}</span>
      </button>
    </Tooltip>
    <Show when={state.open && state.anchor}>
      <HistoryPanel anchorRect={state.anchor!} entries={review!.state.entries} currentId={review!.state.current}
        onClose={() => setState("open", false)} ignoreRef={() => button}
        onSwitch={entry => {
          setState("open", false)
          void review?.restore(entry)
        }} />
    </Show>
  </Show>
}
