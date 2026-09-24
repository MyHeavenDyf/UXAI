import { createEffect, createMemo, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { AddonMenu, type MenuSelection } from "@/pages/make/components/addon-menu"
import { assetFileId, type AssetFile } from "@/pages/make/components/addon-menu/asset-library"
import type { ArtifactFile } from "@/pages/make/utils/artifact-file-api"
import { showToast } from "@opencode-ai/ui/toast"
import { tracker } from "@/utils/tracker"
import type { InsightEditorRef } from "./prosemirror-editor"
import type { MentionFiles, MentionSelection, MentionSkill } from "./mention-popover"
import type { McpSelection } from "../store/mcp-trigger"
import { fileKind } from "../utils/insight-file-api"
import { getDesktopApi } from "../lib/electron-api"
import { importProductAsset, type ImportedAsset } from "../utils/product-asset-import"
import { McpToolMenu } from "./mcp-tool-menu"
import "./insight-addon-menu.css"

type Pending = { selection: Extract<MenuSelection, { type: "file" }>; file?: AssetFile; error?: string; busy?: boolean }

/** 由父组件按项目/会话/产品 key 挂载，异步任务永远属于本输入实例。 */
export function InsightAddonMenu(props: {
  directory: string
  sessionId?: string
  productId?: number
  editor: () => InsightEditorRef | undefined
  skills: { platform: MentionSkill[]; custom: MentionSkill[] }
  skillsLoading: boolean
  loadSkills: () => void
  files: MentionFiles | null
  filesLoading: boolean
  selections: MentionSelection[]
  maxAttachments: boolean
  onAttachment: () => void
  onRefresh: () => void
  onPending: (pending: boolean) => void
  mcpSelection: McpSelection | null
  onMcpSelect: (selection: McpSelection) => void
  onMcpClear: () => void
}) {
  const [state, setState] = createStore<{ pending: Record<string, Pending> }>({ pending: {} })
  const results = new Map<string, ImportedAsset>()
  const tasks = new Map<string, AbortController>()
  const lifetime = new AbortController()
  createEffect(() => props.onPending(Object.keys(state.pending).length > 0))
  onCleanup(() => {
    lifetime.abort()
    tasks.forEach(task => task.abort())
    props.onPending(false)
  })
  const files = createMemo(() => {
    const map = (file: MentionFiles["generated"][number]): ArtifactFile => {
      const kind = fileKind(file.name)
      return { ...file, sessionId: props.sessionId ?? "", mime: "", kind: kind === "word" || kind === "ppt" || kind === "excel" ? "document" : kind === "json" ? "code" : kind === "other" ? "binary" : kind }
    }
    return props.files ? { generated: props.files.generated.map(map), uploaded: props.files.uploaded.map(map) } : null
  })
  const selections = () => [...props.selections, ...Object.values(state.pending).map(item => item.selection)]
  const deselect = (selection: MenuSelection) => {
    if (selection.type === "product-asset") return
    if (selection.type === "skill") return props.editor()?.removeMention(selection)
    const id = selection.id ?? selection.path
    tasks.get(id)?.abort()
    setState("pending", id, undefined!)
    props.selections.filter(item => item.type === "file" && (item.id === id || item.path === selection.path))
      .forEach(item => props.editor()?.removeMention(item))
  }
  const finish = (id: string) => {
    const result = results.get(id)
    if (lifetime.signal.aborted || !state.pending[id] || !result) return
    props.editor()?.insertMentions(result.files.map(file => ({ type: "file", ...file, id })))
    setState("pending", id, undefined!)
    props.onRefresh()
  }
  const download = async (file: AssetFile, _progress: (pct: number) => void, signal?: AbortSignal) => {
    const id = assetFileId(file)
    if (!state.pending[id]) return ""
    const task = new AbortController()
    tasks.set(id, task)
    const abort = () => task.abort()
    signal?.addEventListener("abort", abort, { once: true })
    if (signal?.aborted || lifetime.signal.aborted) task.abort()
    setState("pending", id, { file, busy: true, error: undefined })
    try {
      const result = results.get(id) ?? await importProductAsset(file, {
        directory: props.directory, sessionId: props.sessionId,
        baseUrl: import.meta.env.VITE_OCTO_BASE_URL || "", api: getDesktopApi() ?? {}, signal: task.signal,
      })
      task.signal.throwIfAborted()
      if (!state.pending[id] || lifetime.signal.aborted || tasks.get(id) !== task) return ""
      results.set(id, result)
      return result.root
    } catch (error) {
      if (state.pending[id] && !task.signal.aborted && tasks.get(id) === task) setState("pending", id, "error", error instanceof Error ? error.message : String(error))
      throw error
    } finally {
      signal?.removeEventListener("abort", abort)
      if (tasks.get(id) === task) {
        tasks.delete(id)
        if (state.pending[id]) setState("pending", id, "busy", false)
      }
    }
  }
  const retry = async (id: string) => {
    const item = state.pending[id]
    if (!item?.file || item.busy) return
    await download(item.file, () => {}).then(() => finish(id)).catch(() => {})
  }
  return <>
    <AddonMenu
      items={["skills", "productAssets", "designFiles", "addAttachment", "insightMcp"]}
      controlledFiles cancelOnDispose skillsLoading={props.skillsLoading} filesLoading={props.filesLoading}
      skillConfig={{ panel: { octo_make: props.skills.platform, common: props.skills.custom } }}
      onSkillsOpen={props.loadSkills} artifactFiles={files()} selections={selections()}
      onSelect={selection => { if (selection.type !== "product-asset") props.editor()?.insertMentions([selection]) }}
      onDeselect={deselect}
      onAssetSelect={selection => {
        if (selection.type !== "file") return
        setState("pending", selection.path, { selection: { ...selection, id: selection.path } })
      }}
      onAssetDeselect={deselect} productId={props.productId}
      productAssetsDisabledReason={!props.productId ? "请先选择关联产品的项目" : !getDesktopApi()?.writeFileBuffer || !getDesktopApi()?.movePendingUploadToSession ? "请在桌面端导入产品资产" : undefined}
      onDownloadProductAsset={download} onUpdateMentionPath={finish}
      onAssetDownloadError={() => showToast({ title: "部分资产未导入", description: "成功项已保留，请重试或移除未完成项。" })}
      onAddAttachment={props.onAttachment} maxAttachments={props.maxAttachments} trackerModule="insight"
      slots={[{
        key: "insightMcp",
        render: ctx => <McpToolMenu active={ctx.active()} onToggle={ctx.togglePanel} selection={props.mcpSelection}
          onOpen={() => tracker.interaction({ module: "insight", name: "mcp-chip-open" })}
          onSelect={selection => { ctx.closeMenu(); props.onMcpSelect(selection) }}
          onClear={() => { ctx.closeMenu(); props.onMcpClear(); props.editor()?.focus() }} />,
      }]}
    />
    <Show when={Object.keys(state.pending).length > 0}>
      <div class="insight-addon-pending" role="status">
        <For each={Object.keys(state.pending)}>{id =>
          <Show when={state.pending[id]}>{item => <div>
            <span>{item().selection.filename}：{item().error ?? (item().busy ? "导入中…" : "等待导入")}</span>
            <Show when={item().file && !item().busy}><button type="button" onClick={() => void retry(id)}>重试</button></Show>
            <button type="button" onClick={() => deselect(item().selection)}>移除</button>
          </div>}</Show>
        }</For>
      </div>
    </Show>
  </>
}
