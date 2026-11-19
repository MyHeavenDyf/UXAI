import { createMemo, onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { showToast } from "@opencode-ai/ui/toast"
import { ModelEditPanel } from "../../../make/components/result-viewer/model-edit-panel"
import { ModelEditAreaDialog } from "../../../make/components/result-viewer/model-edit-area-dialog"
import { getDefaultNativeConfig, readNativeDefaults } from "../../../make/components/model-edit-items/registry"
import type { ModelEditContext, ModelEditElement, OnChangeArgs } from "../../../make/components/model-edit-items/types"
import { directModelEditConfig } from "../../../make/subtype-handlers/default"
import { cleanBridgeContent } from "../../../make/utils/bridge-cleaner"
import { applyManualEditPatch, normalizeManualEditInspectorColor } from "../../../make/edit-mode/source-patches"
import { applyHtmlAppearanceEdit, applyHtmlEditMessage, borderEditKeys, prepareHtmlDeletion } from "../../utils/html-edit-source"
import { HUI_COLOR_TOKENS } from "../../../make/components/model-edit-items/icon-data/hui-color-tokens"
import type { AssetFile } from "../../../make/components/addon-menu/asset-library"
import { importProductAsset } from "../../utils/product-asset-import"
import { getDesktopApi } from "../../lib/electron-api"
import type { EditPreviewCommit } from "../../utils/html-edit-preview"
import { attachPanelDrag } from "../../utils/panel-drag"
import "./html-local-editor.css"
import { useHtmlReview } from "./html-review"

const directStyleGroups = new Set(["od_effects", "od_bgImage", "od_padding", "od_margin", "od_size", "od_layout"])

export function HtmlLocalEditor(props: { content: string; source: string; frame: HTMLIFrameElement; onRetainPreview: (content: string, source: string) => void }) {
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
    target: null as (ModelEditElement & { documentSelector?: string }) | null, importing: false,
  })
  let source = props.source
  let baseline = source
  const links = new Map<string, string>()
  const dynamicIds = new Set<string>()
  const failedStyles = new Map<string, string>()
  const send = (data: unknown) => {
    try {
      source = applyHtmlEditMessage(source, data)
      const message = data as { id?: string; styles?: { href?: string } }
      if (message.id && message.styles?.href !== undefined) {
        links.set(message.id, message.styles.href)
        return
      }
      props.frame.contentWindow?.postMessage(data, "*")
    } catch (error) {
      showToast({ title: error instanceof Error ? error.message : "修改失败", variant: "error" })
    }
  }
  const reset = () => {
    source = baseline
    failedStyles.clear()
    links.clear()
    dynamicIds.clear()
    setState("target", null)
    send({ type: "od:insight-reset-edit" })
    send({ type: "od:model-edit-clear" })
  }
  onCleanup(() => send({ type: "od:insight-reset-edit" }))
  const receive = (event: MessageEvent) => {
    if (event.source !== props.frame.contentWindow || review.state.busy || state.importing) return
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
      if (result.important) dynamicIds.add(args.dom.dataOdId)
      props.frame.contentWindow?.postMessage({
        type: "od:edit-preview-style", id: args.dom.dataOdId, styles: result.styles,
        important: result.important, version: Date.now(),
      }, "*")
    } catch (error) {
      const title = error instanceof Error ? error.message : "修改样式失败"
      failedStyles.set(errorKey, title)
      if (args.key !== "od_bgImage") showToast({ title, variant: "error" })
    }
  }
  const commitPreview = (savedSource: string, removeId?: string) => {
    const doc = new DOMParser().parseFromString(savedSource, "text/html")
    const attributes = ["data-insight-fill-overrides", "data-insight-border-overrides", "data-insight-style-overrides"]
    const overrides = dynamicIds.size ? Array.from(doc.head.querySelectorAll(attributes.map(name => `style[${name}]`).join(","))).flatMap(node => {
      const attribute = attributes.find(name => node.hasAttribute(name))
      return attribute ? [[attribute, node.textContent ?? ""] as [string, string]] : []
    }) : []
    const commit: EditPreviewCommit = { requestId: crypto.randomUUID(), removeId, links: [...links], dynamicIds: [...dynamicIds], overrides }
    return new Promise<boolean>(resolve => {
      const frame = props.frame.contentWindow
      if (!frame || lifetime.signal.aborted) { resolve(false); return }
      const done = (ok: boolean) => {
        clearTimeout(timer)
        window.removeEventListener("message", receive)
        lifetime.signal.removeEventListener("abort", abort)
        resolve(ok)
      }
      const abort = () => done(false)
      const receive = (event: MessageEvent) => {
        if (event.source === frame && event.data?.type === "od:insight-commit-result" && event.data.requestId === commit.requestId) {
          done(event.data.ok === true)
        }
      }
      const timer = setTimeout(abort, 1000)
      window.addEventListener("message", receive)
      lifetime.signal.addEventListener("abort", abort, { once: true })
      frame.postMessage({ type: "od:insight-commit-edit", commit }, "*")
    })
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
        await review.editWithAgent(result.prompt, cleanBridgeContent(html), original, content => { original = content; baseline = source; void commitPreview(source) }, "html-element-delete")
        showToast({ title: "已请求 Agent 修改生成代码以删除该元素，请等待处理" })
        return true
      }
      const content = cleanBridgeContent(result.source)
      await review.saveEdit(content, original, async () => {
        if (!await commitPreview(result.source, remove ? ctx.dom.dataOdId : undefined)) return false
        props.onRetainPreview(content, result.source)
        return true
      })
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
  return (
    <Show when={state.target}>{target => <><div ref={draggablePanel} class="insight-property-panel"><ModelEditPanel element={target()}
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
              baseline = source
              void commitPreview(source)
            })
          } catch (error) {
            if (!lifetime.signal.aborted) showToast({ title: error instanceof Error ? error.message : "资产替换失败", variant: "error" })
          }
          // Insight 自己发送指令，不触发 Design 的全局发送事件。
          return ""
        },
      }}
      onSave={() => save()} onDelete={() => save(true)}
      onExit={reset} /></div>
      <ModelEditAreaDialog
        element={target()}
        iframeRef={props.frame}
        filePath={review.path() ?? ""}
        tabTitle=""
        disabled={review.editDisabled() || state.importing}
        onClose={reset}
        onConfirmPrompt={async text => {
          const selected = target()
          const filePath = review.path()
          const selector = selected.documentSelector || selected.selector
          if (!filePath || !selector) {
            showToast({ title: "无法定位选中区域，请重新选择元素", variant: "error" })
            return
          }
          const prompt = [
            `请修改 HTML 文件 ${filePath} 中用户选中的区域，并保留其他区域。`,
            `元素定位信息：${JSON.stringify({ selector, tagName: selected.tagName, text: selected.text })}`,
            `用户要求：${text}`,
          ].join("\n")
          try {
            await review.editWithAgent(prompt, source === baseline ? original : cleanBridgeContent(source), original, content => {
              original = content
              baseline = source
              void commitPreview(source)
            }, "html-area-edit")
          } catch (error) {
            if (!lifetime.signal.aborted) showToast({ title: error instanceof Error ? error.message : "发送区域修改指令失败", variant: "error" })
          }
        }}
      />
    </>}</Show>
  )
}
