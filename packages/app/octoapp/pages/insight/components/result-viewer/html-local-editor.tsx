import { createEffect, createMemo, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { showToast } from "@opencode-ai/ui/toast"
import { annotateElementsWithIdsBrowser, injectEditBridge, injectEditBridgeStyle, injectInspectStyleBridge, injectModelEditBridge } from "@opencode-ai/core/bridge-scripts"
import { ModelEditPanel } from "../../../make/components/result-viewer/model-edit-panel"
import { getDefaultNativeConfig, readNativeDefaults } from "../../../make/components/model-edit-items/registry"
import type { ModelEditContext, ModelEditElement } from "../../../make/components/model-edit-items/types"
import { directModelEditConfig } from "../../../make/subtype-handlers/default"
import { cleanBridgeContent } from "../../../make/utils/bridge-cleaner"
import { applyManualEditPatch } from "../../../make/edit-mode/source-patches"
import { stripCodeFence } from "../../utils/detect"
import { useHtmlReview } from "./html-review"

export function HtmlLocalEditor(props: { content: string; onReady?: () => void }) {
  const review = useHtmlReview()!
  const original = props.content
  const [state, setState] = createStore({ target: null as ModelEditElement | null, url: "", revision: 0 })
  let frame: HTMLIFrameElement | undefined
  const send = (data: unknown) => frame?.contentWindow?.postMessage(data, "*")
  createEffect(() => {
    state.revision
    const html = injectEditBridgeStyle(injectModelEditBridge(injectEditBridge(injectInspectStyleBridge(annotateElementsWithIdsBrowser(stripCodeFence(original))))))
    const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }))
    setState("url", url)
    onCleanup(() => URL.revokeObjectURL(url))
  })
  const receive = (event: MessageEvent) => {
    if (event.source !== frame?.contentWindow || review.state.busy) return
    if (event.data?.type !== "od:model-edit-selected") return
    const target = event.data.target
    if (!target || typeof target.dataOdId !== "string" || typeof target.tagName !== "string") return
    setState("target", target)
  }
  window.addEventListener("message", receive)
  onCleanup(() => window.removeEventListener("message", receive))
  const pending = new Set<() => void>()
  onCleanup(() => pending.forEach(cancel => cancel()))
  const snapshot = () => new Promise<string>((resolve, reject) => {
    const source = frame?.contentWindow
    const finish = () => { clearTimeout(timer); window.removeEventListener("message", listener); pending.delete(cancel) }
    const cancel = () => { finish(); reject(new Error("编辑预览已关闭")) }
    const listener = (event: MessageEvent) => {
      if (event.source !== source || event.data?.type !== "od:html-snapshot" || typeof event.data.html !== "string") return
      finish()
      resolve(event.data.html)
    }
    const timer = setTimeout(() => { finish(); reject(new Error("读取页面内容超时，请重试")) }, 5000)
    pending.add(cancel)
    window.addEventListener("message", listener)
    send({ type: "od:get-html-snapshot" })
  })
  const context = createMemo((): ModelEditContext | undefined => state.target ? {
    dom: state.target, type: state.target.elementKind, filePath: review.path() ?? "",
    postMessageToIframe: send, getIframeSnapshot: snapshot,
    onContentChange: content => review.saveEdit(content, original),
    onRefreshNeeded: () => {}, cleanBridgeContent, applyPatch: applyManualEditPatch,
    wrapHtmlContent: html => html, custom: {},
  } : undefined)
  const save = async (remove = false) => {
    const ctx = context()
    if (!ctx || review.editDisabled()) return false
    try {
      const html = await snapshot()
      const result = remove ? applyManualEditPatch(html, { id: ctx.dom.dataOdId, kind: "remove-element" }) : { ok: true, source: html }
      if (!result.ok) throw new Error("无法定位要删除的元素，请重新选择")
      await review.saveEdit(cleanBridgeContent(result.source), original)
      return true
    } catch (error) {
      showToast({ title: error instanceof Error ? error.message : "保存失败", variant: "error" })
      return false
    }
  }
  return <div class="relative w-full h-full">
    <iframe ref={frame} src={state.url} sandbox="allow-scripts" title="HTML 局部修改"
      style={{ width: "100%", height: "100%", border: "none", background: "white", display: "block" }}
      onLoad={() => { send({ type: "od:model-edit-mode", enabled: true }); props.onReady?.() }} />
    <Show when={state.target}>{target => <ModelEditPanel element={target()}
      config={getDefaultNativeConfig(target().elementKind, target().isLayoutContainer)}
      panelData={readNativeDefaults(target().elementKind, target())}
      panelTitle={target().tagName} panelInfo={target().htmlHint} filePath={review.path() ?? ""}
      context={context()} onChange={directModelEditConfig.onChange} disabled={review.editDisabled()}
      onSave={() => save()} onDelete={() => save(true)}
      onExit={() => { setState("target", null); setState("revision", value => value + 1) }} />}</Show>
  </div>
}
