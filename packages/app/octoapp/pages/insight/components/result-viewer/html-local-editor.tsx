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
import { applyHtmlEditMessage } from "../../utils/html-edit-source"
import { HUI_COLOR_TOKENS } from "../../../make/components/model-edit-items/icon-data/hui-color-tokens"
import type { AssetFile } from "../../../make/components/addon-menu/asset-library"
import { importProductAsset } from "../../utils/product-asset-import"
import { getDesktopApi } from "../../lib/electron-api"
import "./html-local-editor.css"
import { useHtmlReview } from "./html-review"

export function HtmlLocalEditor(props: { content: string; onReady?: () => void }) {
  const review = useHtmlReview()!
  let original = props.content
  const lifetime = new AbortController()
  onCleanup(() => lifetime.abort())
  const downloadAsset = async (file: AssetFile) => {
    if (state.importing || review.editDisabled()) return ""
    setState("importing", true)
    try {
      const directory = review.directory()
      if (!directory) throw new Error("请先选择项目")
      const result = await importProductAsset(file, {
        directory, sessionId: review.sessionId(), api: getDesktopApi() ?? {},
        baseUrl: import.meta.env.VITE_OCTO_BASE_URL || "", signal: lifetime.signal,
      })
      lifetime.signal.throwIfAborted()
      return result.root
    } catch (error) {
      if (!lifetime.signal.aborted) showToast({ title: error instanceof Error ? error.message : "资产导入失败", variant: "error" })
      return ""
    } finally {
      setState("importing", false)
    }
  }
  const [state, setState] = createStore({ target: null as ModelEditElement | null, url: "", revision: 0, importing: false })
  let frame: HTMLIFrameElement | undefined
  let source = annotateElementsWithIdsBrowser(stripCodeFence(original))
  const send = (data: unknown) => {
    try {
      source = applyHtmlEditMessage(source, data)
      frame?.contentWindow?.postMessage(data, "*")
    } catch (error) {
      showToast({ title: error instanceof Error ? error.message : "修改失败", variant: "error" })
    }
  }
  createEffect(() => {
    state.revision
    source = annotateElementsWithIdsBrowser(stripCodeFence(original))
    const html = injectEditBridgeStyle(injectModelEditBridge(injectEditBridge(injectInspectStyleBridge(source))))
    const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }))
    setState("url", url)
    onCleanup(() => URL.revokeObjectURL(url))
  })
  const receive = (event: MessageEvent) => {
    if (event.source !== frame?.contentWindow || review.state.busy || state.importing) return
    if (event.data?.type !== "od:model-edit-selected") return
    const target = event.data.target
    if (!target || typeof target.dataOdId !== "string" || typeof target.tagName !== "string") return
    setState("target", target)
  }
  window.addEventListener("message", receive)
  onCleanup(() => window.removeEventListener("message", receive))
  const snapshot = () => Promise.resolve(source)
  const context = createMemo((): ModelEditContext | undefined => state.target ? {
    dom: state.target, type: state.target.elementKind, filePath: review.path() ?? "",
    postMessageToIframe: send, getIframeSnapshot: snapshot,
    onContentChange: content => review.saveEdit(content, original),
    onRefreshNeeded: () => {}, cleanBridgeContent, applyPatch: applyManualEditPatch,
    wrapHtmlContent: html => html, custom: {},
  } : undefined)
  const save = async (remove = false) => {
    const ctx = context()
    if (!ctx || review.editDisabled() || state.importing) return false
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
  return <div class="insight-html-local-editor relative w-full h-full">
    <iframe ref={frame} src={state.url} sandbox="allow-scripts" title="HTML 局部修改"
      style={{ width: "100%", height: "100%", border: "none", background: "white", display: "block" }}
      onLoad={() => { send({ type: "od:model-edit-mode", enabled: true }); props.onReady?.() }} />
    <Show when={state.target}>{target => <ModelEditPanel element={target()}
      config={getDefaultNativeConfig(target().elementKind, target().isLayoutContainer)}
      panelData={readNativeDefaults(target().elementKind, target())}
      panelTitle={target().tagName} panelInfo={target().htmlHint} filePath={review.path() ?? ""}
      context={context()} onChange={directModelEditConfig.onChange} disabled={review.editDisabled() || state.importing}
      colors={HUI_COLOR_TOKENS} productId={review.productId()} onDownloadProductAsset={downloadAsset}
      assetConfig={{
        ...directModelEditConfig.assetConfig,
        onConfirm: async args => {
          try {
            lifetime.signal.throwIfAborted()
            const prompt = await directModelEditConfig.assetConfig!.onConfirm(args)
            await review.replaceAsset(prompt, cleanBridgeContent(await snapshot()), original, content => {
              // 文件已落盘，即使发送失败也要使用新基线继续编辑或重试。
              original = content
            })
          } catch (error) {
            if (!lifetime.signal.aborted) showToast({ title: error instanceof Error ? error.message : "资产替换失败", variant: "error" })
          }
          // Insight 自己发送指令，不触发 Design 的全局发送事件。
          return ""
        },
      }}
      onSave={() => save()} onDelete={() => save(true)}
      onExit={() => { setState("target", null); setState("revision", value => value + 1) }} />}</Show>
  </div>
}
