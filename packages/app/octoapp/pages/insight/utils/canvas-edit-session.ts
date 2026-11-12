import type { PixsoAction, UploadZipOptions } from "@/utils/useZipTransport"
import type { ResultTab, TabViewMode } from "../components/result-viewer/tab-store"
import type { DesktopApi } from "../lib/electron-api"
import { canvasDisabledReason, createCanvasOptions } from "./canvas-edit"
import type { CanvasTransport } from "./canvas-transport"
import { beginInsightOperation, trackInsight } from "./interaction-tracking"

type Context = {
  key: string
  tab: ResultTab
  mode: TabViewMode
  sessionId?: string
  directory: string
  loggedIn: boolean
  transport: CanvasTransport
  api?: DesktopApi
  loadState?: "loading" | "error" | "ready"
}
type State = { busy: boolean; open: boolean; actions: PixsoAction[] }

/** 异步操作绑定发起时的文件及会话；视图失效不会改变回传文件的归属。 */
export function createCanvasEditSession(config: {
  context: () => Context
  changed: (state: State) => void
  notify: (title: string, error?: boolean) => void
  onFilesRefresh?: (sessionId: string, directory: string) => void | Promise<void>
}) {
  let state: State = { busy: false, open: false, actions: [] }
  let options: UploadZipOptions | undefined
  let preparedKey = ""
  let revision = 0
  const update = (patch: Partial<State>) => { state = { ...state, ...patch }; config.changed(state) }
  const current = (key: string, version: number) => revision === version && config.context().key === key
  const reset = () => { revision++; options = undefined; update({ busy: false, open: false, actions: [] }) }
  return {
    reset,
    close: () => update({ open: false }),
    async prepare() {
      if (state.busy) return
      if (state.open) { update({ open: false }); return }
      const context = { ...config.context() }
      if (canvasDisabledReason(context.tab, context.mode, context.sessionId, context.transport.available, context.loadState)) return
      if (!context.loggedIn) { config.notify("请先登录"); return }
      const version = ++revision
      const fields = { sessionId: context.sessionId, tabType: "html", source: context.tab.source, fromAttachment: !!context.tab.fromAttachment, viewMode: context.mode }
      trackInsight("canvas-edit-open", fields)
      const finish = beginInsightOperation("canvas-edit", { ...fields, action: "prepare" })
      update({ busy: true, open: false, actions: [] })
      options = undefined
      let stage = "source"
      try {
        const prepared = await createCanvasOptions({
          tab: context.tab,
          sessionId: context.sessionId!,
          directory: context.directory,
          api: context.api,
          notify: config.notify,
          onFilesRefresh: () => config.onFilesRefresh?.(context.sessionId!, context.directory),
        })
        if (!current(context.key, version)) { finish("cancelled", { reason: "view-changed" }); return }
        stage = "transport"
        const result = await context.transport.prepare(prepared)
        if (!current(context.key, version)) { finish("cancelled", { reason: "view-changed" }); return }
        if (!result.actions.length) {
          // 与 Design 一致，空菜单不作为接口失败提示；也不推断画布已打开。
          finish("unconfirmed", { reason: "no-actions" })
          return
        }
        options = prepared
        preparedKey = context.key
        update({ actions: result.actions, open: true })
        finish("success", { evidence: "actions-ready" })
      } catch (error) {
        if (!current(context.key, version)) { finish("cancelled", { reason: "view-changed" }); return }
        const cancelled = error instanceof Error && error.name === "AbortError"
        finish(cancelled ? "cancelled" : "failure", { reason: stage })
        if (!cancelled) config.notify(stage === "source" && error instanceof Error ? error.message : "画布服务连接失败，请重试", true)
      } finally {
        if (current(context.key, version)) update({ busy: false })
      }
    },
    async run(action: PixsoAction) {
      if (state.busy || !state.open || !options || !state.actions.includes(action)) return
      const context = { ...config.context() }
      if (context.key !== preparedKey || !context.transport.available || !context.loggedIn) { reset(); return }
      const prepared = options
      const version = revision
      const finish = beginInsightOperation("canvas-edit", { sessionId: prepared.config.sessionId, action: context.transport.actionId(action) })
      update({ busy: true, open: false })
      try {
        const result = await action.fn(prepared)
        const evidence = context.transport.result?.(action, result)
        if ("success" in result && !result.success) {
          finish("failure", { reason: "action-result" })
          if (current(context.key, version)) config.notify("无法完成画布操作，请重试", true)
          return
        }
        finish(evidence?.status === "success" && !evidence.evidence ? "unconfirmed" : evidence?.status ?? "unconfirmed", { evidence: evidence?.evidence, reason: evidence ? undefined : "no-receipt" })
        if (evidence?.status === "failure" && current(context.key, version)) config.notify("无法完成画布操作，请重试", true)
      } catch (error) {
        const cancelled = error instanceof Error && error.name === "AbortError"
        finish(cancelled ? "cancelled" : "failure", { reason: "action" })
        if (!cancelled && current(context.key, version)) config.notify("无法完成画布操作，请重试", true)
      } finally {
        if (current(context.key, version)) { options = undefined; update({ busy: false, actions: [] }) }
      }
    },
  }
}
