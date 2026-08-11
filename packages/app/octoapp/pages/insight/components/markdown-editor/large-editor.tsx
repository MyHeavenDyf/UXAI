// 大 markdown 编辑器(CM6):> MARKDOWN_LARGE_THRESHOLD 的 md 走这里,与 Vditor 编辑器(MarkdownEditor)
// 按阈值分流(见 result-viewer 的 editingTab 渲染)。CM6 按行视口渲染,5MB 编辑/滚动瞬响,
// 不像 Vditor sv 把全文喂给 Lute + 全量 DOM。代价:纯源码编辑(无实时富预览面板 / 格式化工具栏),
// markdown 语法高亮由 lezer(markdown 语言)提供。保存/关闭/快捷键等外壳与 Vditor 编辑器同款。
//
// 注:外壳(topbar/save/keyboard/SaveIndicator)与 markdown-editor/index.tsx 镜像,有意隔离不抽公共
// shell,以免改动波及已上线的 Vditor 编辑器路径。采纳后可抽 MarkdownEditorShell 统一两路。
import { createSignal, onCleanup, onMount, createEffect, Show } from "solid-js"
import type { JSX } from "solid-js"
import { basicSetup, EditorView } from "codemirror"
import { Compartment } from "@codemirror/state"
import { markdown, markdownLanguage } from "@codemirror/lang-markdown"
import { oneDark } from "@codemirror/theme-one-dark"
import { showToast } from "@opencode-ai/ui/toast"
import { useTheme } from "@opencode-ai/ui/theme/context"
import type { ResultTab } from "../result-viewer/tab-store"
import { getDesktopApi } from "../../lib/electron-api"
import { defaultFilename, ensureMarkdownExt } from "../../utils/local-file"
import { ensureLocalMarkdownFile } from "../../utils/local-resource"
import { usePlatform } from "@/context/platform"
import { useParams } from "@solidjs/router"

const TRAFFIC_LIGHT_INSET = 80
const WINDOWS_CONTROLS_INSET = 138
const SAVE_DEBOUNCE_MS = 1000

// 浅色主题:背景透明跟随 app surface,光标/选区用 octo 变量。深色走 oneDark(自带配色)。
const lightTheme = EditorView.theme({
  "&": { "background-color": "transparent", color: "var(--octo-text-primary)" },
  ".cm-content": { caretColor: "var(--octo-brand)" },
  ".cm-cursor, .cm-dropCursor": { "border-left-color": "var(--octo-brand)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": { "background-color": "var(--octo-brand-a8)" },
})

// 结构主题:撑满高度 + 滚动容器 + 等宽字体 + 透明行号槽 + 去焦点描边 + 当前行高亮。
const baseTheme = EditorView.theme({
  "&": { height: "100%" },
  ".cm-scroller": { overflow: "auto", "font-family": "var(--octo-font-mono, ui-monospace, monospace)", "font-size": "13px" },
  ".cm-gutters": { "background-color": "transparent", border: "none", color: "var(--octo-text-secondary)" },
  "&.cm-focused": { outline: "none" },
  ".cm-activeLine": { "background-color": "var(--octo-surface-hover)" },
  ".cm-activeLineGutter": { "background-color": "transparent" },
})

type SaveState = "idle" | "saving" | "saved" | "error"

export function MarkdownEditorLarge(props: {
  tab: ResultTab
  projectDir: string
  onClose: (latestContent: string) => void
}): JSX.Element {
  const theme = useTheme()
  const isDark = () => theme.mode() === "dark"
  const platform = usePlatform()
  const params = useParams<{ id?: string }>()
  const isMac = () => platform.platform === "desktop" && platform.os === "macos"
  const isWindows = () => platform.platform === "desktop" && platform.os === "windows"

  let editorEl: HTMLDivElement | undefined
  let view: EditorView | undefined
  let themeCompartment: Compartment | undefined
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let targetPath: string | null = null
  // 卸载标志:onMount 的 async(ensureLocalMarkdownFile)await 后才建 view,期间若卸载,
  // 不建 view(否则建进已分离 DOM 且永不被 destroy → 泄漏)。
  let disposed = false
  // 编辑器初值:用 tab 已 fetch 的内容(与本地文件一致,省一次读盘)。
  const initialContent = props.tab.content ?? ""
  let latestValue = initialContent

  const [ready, setReady] = createSignal(false)
  const [saveState, setSaveState] = createSignal<SaveState>("idle")
  const [saveError, setSaveError] = createSignal("")
  const [persistent, setPersistent] = createSignal(true)
  const [initError, setInitError] = createSignal("")

  const fileName = () => ensureMarkdownExt(defaultFilename(props.tab))

  async function doSave(value: string) {
    if (!targetPath) return
    const api = getDesktopApi()
    if (typeof api?.writeFile !== "function") {
      setSaveState("error")
      setSaveError("缺少 window.api.writeFile")
      showToast({ title: "保存失败", description: "桌面端缺少 writeFile 能力,请联系开发团队补壳", variant: "error" })
      return
    }
    setSaveState("saving")
    console.log("[octo:mdedit-large] save-start", { path: targetPath, bytes: value.length })
    try {
      await api.writeFile(targetPath, value)
      console.log("[octo:mdedit-large] save-ok", { path: targetPath, bytes: value.length })
      setSaveState("saved")
      setSaveError("")
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error("[octo:mdedit-large] save-failed", { path: targetPath, err: msg })
      setSaveState("error")
      setSaveError(msg)
      showToast({ title: "保存失败", description: msg, variant: "error" })
    }
  }

  // 不在每次敲键时序列化全文(5MB doc.toString() 是 O(n),逐键跑会让输入卡顿)。
  // 只在防抖到点 / 关闭 flush 时序列化一次。
  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = undefined
      const value = view?.state.doc.toString() ?? latestValue
      latestValue = value
      void doSave(value)
    }, SAVE_DEBOUNCE_MS)
  }

  function flushSave() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = undefined }
    const value = view?.state.doc.toString() ?? latestValue
    latestValue = value
    void doSave(value)
  }

  function handleClose() {
    // 防抖未触发就关闭:latestValue 可能是旧值(敲键不即时序列化),关闭前从 view 取最新全文 flush 一次。
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = undefined
      latestValue = view?.state.doc.toString() ?? latestValue
      void doSave(latestValue)
    }
    console.log("[octo:mdedit-large] close", { path: targetPath })
    props.onClose(latestValue)
  }

  // Esc 关闭、Cmd/S 保存:挂在 document 上(CM6 默认 keymap 不绑 Cmd/S;Esc 在无补全时冒泡)。
  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault()
      handleClose()
      return
    }
    if ((e.metaKey || e.ctrlKey) && (e.key === "s" || e.key === "S")) {
      e.preventDefault()
      flushSave()
    }
  }

  onMount(() => {
    document.addEventListener("keydown", onKeyDown)
    void (async () => {
      try {
        const { path, persistent: isPersistent } = await ensureLocalMarkdownFile(props.tab, props.projectDir, params.id ?? "")
        targetPath = path
        setPersistent(isPersistent)
        console.log("[octo:mdedit-large] open", { tabId: props.tab.id, source: props.tab.source, path, persistent: isPersistent, bytes: initialContent.length })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error("[octo:mdedit-large] open-failed", { tabId: props.tab.id, err: msg })
        setInitError(msg)
      }
      if (!editorEl || disposed) return
      themeCompartment = new Compartment()
      view = new EditorView({
        doc: initialContent,
        parent: editorEl,
        extensions: [
          basicSetup,
          markdown({ base: markdownLanguage }),
          EditorView.lineWrapping,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) scheduleSave()
          }),
          themeCompartment.of(isDark() ? oneDark : lightTheme),
          baseTheme,
        ],
      })
      setReady(true)
    })()
  })

  // 主题跟随 octo 明暗(Compartment 原地换,保留 undo 历史 / 光标)。
  createEffect(() => {
    const dark = isDark()
    if (!ready() || !view || !themeCompartment) return
    view.dispatch({ effects: themeCompartment.reconfigure(dark ? oneDark : lightTheme) })
  })

  onCleanup(() => {
    disposed = true
    document.removeEventListener("keydown", onKeyDown)
    // 非 handleClose 触发的卸载(如切会话)也可能有未触发的防抖:同样从 view 取最新全文 flush。
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = undefined
      latestValue = view?.state.doc.toString() ?? latestValue
      void doSave(latestValue)
    }
    view?.destroy()
    view = undefined
  })

  return (
    <div class="fixed inset-0 z-[1000] flex flex-col" style={{ background: "var(--octo-surface-page)" }}>
      {/* 顶栏:文件名 + 保存状态 + 关闭。与 Vditor 编辑器同款(无边框窗口拖拽区 + 红绿灯避让)。 */}
      <div
        class="flex items-center gap-3 shrink-0"
        style={{
          height: "44px",
          "padding-left": isMac() ? `${TRAFFIC_LIGHT_INSET}px` : "16px",
          "padding-right": isWindows() ? `${WINDOWS_CONTROLS_INSET}px` : "12px",
          "border-bottom": "1px solid var(--octo-border-divider)",
          background: "var(--octo-surface-page)",
          "-webkit-app-region": "drag",
        }}
      >
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true" style={{ flex: "0 0 auto" }}>
          <path d="M11 2.5l2.5 2.5L6 12.5 3 13l.5-3L11 2.5z" stroke="var(--octo-text-secondary)" stroke-width="1.3" stroke-linejoin="round" />
        </svg>
        <span class="text-sm font-medium truncate" style={{ color: "var(--octo-text-primary)", "max-width": "40%" }}>
          {fileName()}
        </span>
        <SaveIndicator state={saveState()} error={saveError()} />
        <Show when={!persistent() && !initError()}>
          <span class="text-xs truncate" style={{ color: "var(--octo-warning, #b45309)" }}>
            未关联本地目录，编辑暂存临时目录、可能丢失，建议先关联目录
          </span>
        </Show>
        <Show when={initError()}>
          <span class="text-xs truncate" style={{ color: "var(--octo-danger, #dc2626)" }}>
            {initError()}（无法保存）
          </span>
        </Show>
        <div class="flex-1" />
        <button
          type="button"
          onClick={handleClose}
          class="flex items-center justify-center rounded transition-colors hover:bg-[var(--octo-surface-hover,#f1f1f1)]"
          style={{ width: "28px", height: "28px", color: "var(--octo-text-secondary)", "-webkit-app-region": "no-drag" }}
          aria-label="关闭编辑器（Esc）"
          title="关闭（Esc）"
        >
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          </svg>
        </button>
      </div>

      {/* 主体:CM6 编辑器。lineWrapping 折行,适合 markdown 散文;大文件按行虚拟化,只渲染可见行。 */}
      <div class="flex-1 min-h-0 octo-md-editor-host" ref={(el: HTMLDivElement) => (editorEl = el)} />
    </div>
  )
}

function SaveIndicator(props: { state: SaveState; error: string }): JSX.Element {
  const label = () => {
    switch (props.state) {
      case "saving": return "保存中…"
      case "saved": return "已保存"
      case "error": return "保存失败"
      default: return ""
    }
  }
  const color = () => {
    switch (props.state) {
      case "error": return "var(--octo-danger, #dc2626)"
      case "saved": return "var(--octo-success, #16a34a)"
      default: return "var(--octo-text-secondary)"
    }
  }
  return (
    <Show when={props.state !== "idle"}>
      <span class="text-xs shrink-0" style={{ color: color() }} title={props.error || undefined}>
        {label()}
      </span>
    </Show>
  )
}
