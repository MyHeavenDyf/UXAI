import { createEffect, createMemo, onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { showToast } from "@opencode-ai/ui/toast"
import { annotateElementsWithIdsBrowser, injectEditBridge, injectEditBridgeStyle, injectInspectStyleBridge, injectModelEditBridge } from "@opencode-ai/core/bridge-scripts"
import { ModelEditPanel } from "../../../make/components/result-viewer/model-edit-panel"
import { getDefaultNativeConfig, readNativeDefaults } from "../../../make/components/model-edit-items/registry"
import type { ModelEditContext, ModelEditElement, OnChangeArgs } from "../../../make/components/model-edit-items/types"
import { directModelEditConfig } from "../../../make/subtype-handlers/default"
import { cleanBridgeContent } from "../../../make/utils/bridge-cleaner"
import { applyManualEditPatch, normalizeManualEditInspectorColor } from "../../../make/edit-mode/source-patches"
import { stripCodeFence } from "../../utils/detect"
import { applyHtmlAppearanceEdit, applyHtmlEditMessage, borderEditKeys, prepareHtmlDeletion } from "../../utils/html-edit-source"
import { HUI_COLOR_TOKENS } from "../../../make/components/model-edit-items/icon-data/hui-color-tokens"
import type { AssetFile } from "../../../make/components/addon-menu/asset-library"
import { importProductAsset } from "../../utils/product-asset-import"
import { getDesktopApi } from "../../lib/electron-api"
import { attachPanelDrag } from "../../utils/panel-drag"
import "./html-local-editor.css"
import { useHtmlReview } from "./html-review"

const directStyleGroups = new Set(["od_effects", "od_bgImage", "od_padding", "od_margin", "od_size", "od_layout"])

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
  const [state, setState] = createStore({
    target: null as (ModelEditElement & { documentSelector?: string }) | null, url: "", revision: 0, importing: false,
  })
  let frame: HTMLIFrameElement | undefined
  let source = annotateElementsWithIdsBrowser(stripCodeFence(original))
  const failedStyles = new Map<string, string>()
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
    failedStyles.clear()
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
  const change = (args: OnChangeArgs) => {
    const border = args.key === "od_border"
    const direct = directStyleGroups.has(args.key)
    if (!direct && !border && args.key !== "od_appearance") return directModelEditConfig.onChange?.(args)
    if (args.value === args.prev) return
    const errorKey = `${args.dom.dataOdId}:${args.key}`
    try {
      const readStyles = (value: unknown): Record<string, unknown> => {
        if (!direct) return JSON.parse(value as string)
        let styles = {}
        directModelEditConfig.onChange?.({
          ...args, value,
          postMessageToIframe: message => { styles = (message as { styles: Record<string, string> }).styles },
        })
        return styles
      }
      const current = readStyles(args.value)
      const previous = readStyles(args.prev ?? (args.key === "od_effects" ? "[]" : args.key === "od_bgImage" ? "" : "{}"))
      const changes = (direct ? Object.keys(current) : border ? borderEditKeys : ["backgroundColor"]).flatMap(key => {
        const value = current[key]
        return typeof value === "string" && value !== previous[key] ? [[key, value] as const] : []
      })
      if (!changes.length) {
        if (!border && !direct) return directModelEditConfig.onChange?.(args)
        return
      }
      const styles = Object.fromEntries(changes)
      if (args.key === "od_layout" && styles.flexDirection !== undefined) {
        styles.display = styles.flexDirection ? args.dom.styles.display === "inline-flex" ? "inline-flex" : "flex" : "block"
      }
      const result = applyHtmlAppearanceEdit(source, args.dom, styles)
      failedStyles.delete(errorKey)
      source = result.source
      frame?.contentWindow?.postMessage({
        type: "od:edit-preview-style", id: args.dom.dataOdId, styles: result.styles,
        important: result.important, version: Date.now(),
      }, "*")
    } catch (error) {
      const title = error instanceof Error ? error.message : "修改样式失败"
      failedStyles.set(errorKey, title)
      if (args.key !== "od_bgImage") showToast({ title, variant: "error" })
    }
  }
  const save = async (remove = false) => {
    const ctx = context()
    if (!ctx || review.editDisabled() || state.importing) return false
    try {
      const styleError = failedStyles.values().next().value
      if (!remove && styleError) throw new Error(styleError)
      const html = await snapshot()
      const result = remove ? prepareHtmlDeletion(html, ctx.dom, ctx.filePath) : { kind: "source" as const, source: html }
      if (result.kind === "agent") {
        await review.editWithAgent(result.prompt, cleanBridgeContent(html), original, content => { original = content }, "html-element-delete")
        showToast({ title: "已请求 Agent 修改生成代码以删除该元素，请等待处理" })
        return true
      }
      await review.saveEdit(cleanBridgeContent(result.source), original)
      return true
    } catch (error) {
      showToast({ title: error instanceof Error ? error.message : "保存失败", variant: "error" })
      return false
    }
  }
  const draggablePanel = (host: HTMLDivElement) => {
    onMount(() => {
      const detach = attachPanelDrag(host, () => review.editDisabled() || state.importing)
      onCleanup(detach)
    })
  }
  return <div class="insight-html-local-editor relative w-full h-full">
    <iframe ref={frame} src={state.url} sandbox="allow-scripts" title="HTML 局部修改"
      style={{ width: "100%", height: "100%", border: "none", background: "white", display: "block" }}
      onLoad={() => { send({ type: "od:model-edit-mode", enabled: true, includeDocumentSelector: true }); props.onReady?.() }} />
    <Show when={state.target}>{target => <div ref={draggablePanel} class="insight-property-panel"><ModelEditPanel element={target()}
      config={getDefaultNativeConfig(target().elementKind, target().isLayoutContainer)}
      panelData={readNativeDefaults(target().elementKind, {
        ...target(),
        styles: {
          ...target().styles,
          backgroundColor: normalizeManualEditInspectorColor(target().styles.backgroundColor ?? "", true),
          borderColor: normalizeManualEditInspectorColor(target().styles.borderColor ?? "", true),
          flexDirection: target().styles.display && !["flex", "inline-flex"].includes(target().styles.display)
            ? "" : target().styles.flexDirection,
        },
      })}
      panelTitle={target().tagName} panelInfo={target().htmlHint} filePath={review.path() ?? ""}
      context={context()} onChange={change} disabled={review.editDisabled() || state.importing}
      colors={HUI_COLOR_TOKENS} productId={review.productId()} onDownloadProductAsset={downloadAsset}
      assetConfig={{
        ...directModelEditConfig.assetConfig,
        onConfirm: async args => {
          try {
            lifetime.signal.throwIfAborted()
            const prompt = await directModelEditConfig.assetConfig!.onConfirm(args)
            await review.editWithAgent(prompt, cleanBridgeContent(await snapshot()), original, content => {
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
      onExit={() => { setState("target", null); setState("revision", value => value + 1) }} /></div>}</Show>
  </div>
}
