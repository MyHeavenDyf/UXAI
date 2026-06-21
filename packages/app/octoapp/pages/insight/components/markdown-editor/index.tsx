import { createSignal, onCleanup, onMount, createEffect, Show } from "solid-js"
import type { JSX } from "solid-js"
import Vditor from "vditor"
import "vditor/dist/index.css"
import { showToast } from "@opencode-ai/ui/toast"
import { useTheme } from "@opencode-ai/ui/theme/context"
import type { ResultTab } from "../result-viewer/tab-store"
import { getDesktopApi } from "../../lib/electron-api"
import { defaultFilename, ensureMarkdownExt } from "../../utils/local-file"
import { interceptExternalLink } from "../../utils/external-link"
import { tracker } from "@/utils/tracker"
import { usePlatform } from "@/context/platform"

// 无边框窗口(titleBarStyle:"hidden")macOS 在左上画红绿灯,留出避让宽度(与 _shell/topbar 一致)
const TRAFFIC_LIGHT_INSET = 80

// Vditor 资源本地化:运行时按 `cdn + "/dist/js/..."` 拉懒加载资源(katex/mermaid/echarts…),
// 指向本地 publicDir(vite.js copyVditorAssets 拷到 /vendor/vditor/dist),零公网 CDN、断网可用。
// 见 docs/specs/ui/insight-markdown-editor.md §6.2。
const VDITOR_LOCAL_CDN = "/vendor/vditor"

// 裁剪工具栏:保留较完整能力(标题/格式/列表/引用/表格/代码/撤销/大纲/预览)。
// 去掉:
//   - upload / record:与自有附件体系冲突;
//   - fullscreen:已是全屏 overlay 且进全屏后无可见退出入口,冗余;
//   - content-theme / code-theme:换肤项,与「跟随 app 明暗」冲突,徒增困惑;
//   - export:Vditor 自带导出的 PDF 走 window.print() 会弹系统打印框(非静默存盘),
//            改由顶栏自建「导出」只给 Markdown/HTML(见 ExportMenu);PDF 后续再做(spec §6.3)。
//   - edit-mode(所见即所得/即时渲染/分屏):固定用分屏(sv),纯预览用工具栏最后的「预览」👁 切换即可,
//            三选项里「所见即所得」「即时渲染」对本场景区分意义不大,去掉减少困惑(spec §6.3)。
// 公式/流程图/图表/脑图是预览渲染特性(写 $$ / ```mermaid 即出图,资源走本地 cdn),无需工具栏按钮。见 §6.3。
const TRIMMED_TOOLBAR = [
  "emoji", "headings", "bold", "italic", "strike", "link",
  "|", "list", "ordered-list", "check", "outdent", "indent",
  "|", "quote", "line", "code", "inline-code", "insert-before", "insert-after",
  "|", "table",
  "|", "undo", "redo",
  "|", "outline", "preview",
]

const SAVE_DEBOUNCE_MS = 1000

type SaveState = "idle" | "saving" | "saved" | "error"

// 进编辑器先把 uri 产物落到本地(复用 downloadResourceToTemp,幂等:已落地直接复用),
// 拿到可写本地路径。path 源(write 产物)文件已在磁盘,直接用 filePath。
// 见 §3.1 / §3.2。返回 { path, persistent }:persistent=false 表示落在 OS 临时目录(可能丢失)。
async function ensureLocalFile(
  tab: ResultTab,
  projectDir: string,
): Promise<{ path: string; persistent: boolean }> {
  if (tab.source === "path" && tab.filePath) {
    return { path: tab.filePath, persistent: true }
  }
  if (tab.source === "uri" && tab.uri) {
    const api = getDesktopApi()
    if (typeof api?.downloadResourceToTemp !== "function") {
      throw new Error("缺少 window.api.downloadResourceToTemp,无法定位本地文件")
    }
    const filename = ensureMarkdownExt(defaultFilename(tab))
    const baseDir = projectDir || undefined
    const localPath = await api.downloadResourceToTemp!(tab.uri, tab.id, filename, baseDir)
    return { path: localPath, persistent: !!baseDir }
  }
  throw new Error("该卡片无可编辑的本地文件(inline 内容)")
}

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// 渲染后的 HTML 包成可独立打开的整页(vditor-reset 让样式接近预览)。
function buildHtmlDoc(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="zh">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head>
<body class="vditor-reset">
${bodyHtml}
</body>
</html>`
}

export function MarkdownEditor(props: {
  tab: ResultTab
  projectDir: string
  /** 关闭编辑器,把最新内容回写 tab(供「预览/代码」显示编辑后内容) */
  onClose: (latestContent: string) => void
}): JSX.Element {
  const theme = useTheme()
  const isDark = () => theme.mode() === "dark"
  const platform = usePlatform()
  const isMac = () => platform.platform === "desktop" && platform.os === "macos"

  let editorEl: HTMLDivElement | undefined
  let vditor: Vditor | undefined
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let targetPath: string | null = null
  // 编辑器初值:用 tab 已 fetch 的内容(与本地文件一致,省一次读盘)。§3.2。
  // 不再做「还原初始内容」(要回到原始版本重新从 MCP 下载即可),故无需单独快照。
  const initialContent = props.tab.content ?? ""
  // 最近一次拿到的编辑器内容(关闭时回写 tab + flush 未保存)
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
    console.log("[octo:mdedit] save-start", { path: targetPath, bytes: value.length })
    try {
      await api.writeFile!(targetPath, value)
      console.log("[octo:mdedit] save-ok", { path: targetPath, bytes: value.length })
      setSaveState("saved")
      setSaveError("")
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error("[octo:mdedit] save-failed", { path: targetPath, err: msg })
      setSaveState("error")
      setSaveError(msg)
      // 内存内容不丢:下次输入或手动重试再写(§4.2)
      showToast({ title: "保存失败", description: msg, variant: "error" })
    }
  }

  function scheduleSave(value: string) {
    latestValue = value
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = undefined
      void doSave(value)
    }, SAVE_DEBOUNCE_MS)
  }

  // 立即写盘(关闭前 flush / Cmd+S 手动保存),绕过防抖
  function flushSave() {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = undefined
    }
    const value = vditor?.getValue() ?? latestValue
    latestValue = value
    void doSave(value)
  }

  // 导出菜单(自建,取代 Vditor 自带 export):只给 Markdown / HTML。
  // PDF 暂不做(Vditor 自带 PDF 走 window.print 弹打印框;后续若做走 html-to-pdf IPC 静默存盘,见 spec §6.3)。
  const [exportOpen, setExportOpen] = createSignal(false)
  let exportRef: HTMLDivElement | undefined
  const onDocClickExport = (e: MouseEvent) => {
    if (exportRef && !exportRef.contains(e.target as Node)) setExportOpen(false)
  }
  document.addEventListener("click", onDocClickExport)
  onCleanup(() => document.removeEventListener("click", onDocClickExport))

  function exportBase(): string {
    return fileName().replace(/\.[^.]+$/, "") || "document"
  }
  function doExport(format: "md" | "html") {
    setExportOpen(false)
    tracker.interaction({ module: "insight", name: "md-edit-export", extend: JSON.stringify({ format }) })
    if (format === "md") {
      const md = vditor?.getValue() ?? latestValue
      downloadBlob(md, `${exportBase()}.md`, "text/markdown;charset=utf-8")
      return
    }
    const body = vditor?.getHTML() ?? ""
    downloadBlob(buildHtmlDoc(exportBase(), body), `${exportBase()}.html`, "text/html;charset=utf-8")
  }

  function handleClose() {
    // 关闭前 flush 未保存的最后一次编辑,内容不丢
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = undefined
      void doSave(latestValue)
    }
    console.log("[octo:mdedit] close", { path: targetPath })
    props.onClose(latestValue)
  }

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
    // 预览里的外链点击 → 系统浏览器(§6.5,与卡片预览共用 interceptExternalLink)
    editorEl?.addEventListener("click", interceptExternalLink, true)
    void (async () => {
      try {
        const { path, persistent: isPersistent } = await ensureLocalFile(props.tab, props.projectDir)
        targetPath = path
        setPersistent(isPersistent)
        console.log("[octo:mdedit] open", { tabId: props.tab.id, source: props.tab.source, path, persistent: isPersistent })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error("[octo:mdedit] open-failed", { tabId: props.tab.id, err: msg })
        setInitError(msg)
        // 仍允许在内存里编辑(不硬禁),但保存会因 targetPath 为空而提示
      }
      if (!editorEl) return
      vditor = new Vditor(editorEl, {
        mode: "sv",
        value: initialContent,
        theme: isDark() ? "dark" : "classic",
        cdn: VDITOR_LOCAL_CDN,
        cache: { enable: false }, // 自管落盘,关掉 Vditor 的 localStorage 缓存
        toolbar: TRIMMED_TOOLBAR,
        toolbarConfig: { pin: true },
        preview: {
          // 去掉预览面板顶部的设备/平台切换栏(Desktop/Tablet/Mobile-Wechat/知乎/刷新)——
          // 写作场景用不到,留着干扰。actions:[] 即清空。
          actions: [],
          theme: { current: isDark() ? "dark" : "light", path: `${VDITOR_LOCAL_CDN}/dist/css/content-theme` },
          hljs: { style: isDark() ? "native" : "github" },
        },
        input: (val) => scheduleSave(val),
        after: () => setReady(true),
      })
    })()
  })

  // 主题跟随 octo 明暗(§6.4)
  createEffect(() => {
    const dark = isDark()
    if (!ready() || !vditor) return
    vditor.setTheme(dark ? "dark" : "classic", dark ? "dark" : "light", dark ? "native" : "github")
  })

  onCleanup(() => {
    document.removeEventListener("keydown", onKeyDown)
    editorEl?.removeEventListener("click", interceptExternalLink, true)
    // 销毁前 flush 一次:防抖未触发就关闭也不丢最后编辑
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = undefined
      void doSave(latestValue)
    }
    vditor?.destroy()
    vditor = undefined
  })

  return (
    <div
      class="fixed inset-0 z-[1000] flex flex-col"
      style={{ background: "var(--octo-surface-page)" }}
    >
      {/* 顶栏:文件名 + 保存状态 + 关闭。
          无边框窗口:顶栏作拖拽区(可拖动窗口),mac 左侧避让红绿灯;按钮/交互元素设 no-drag,
          否则在拖拽区上点击会被 Electron 吞掉(这是关闭按钮"点了没反应"的根因)。 */}
      <div
        class="flex items-center gap-3 shrink-0"
        style={{
          height: "44px",
          "padding-left": isMac() ? `${TRAFFIC_LIGHT_INSET}px` : "16px",
          "padding-right": "12px",
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
        <div class="relative" ref={(el) => (exportRef = el)} style={{ "-webkit-app-region": "no-drag" }}>
          <button
            type="button"
            onClick={() => setExportOpen((v) => !v)}
            class="flex items-center gap-1 px-2.5 py-1 text-xs rounded transition-colors hover:bg-[var(--octo-surface-hover,#f1f1f1)]"
            style={{ border: "1px solid var(--octo-border-default)", color: "var(--octo-text-secondary)" }}
            title="导出为文件"
          >
            导出
            <svg viewBox="0 0 12 12" width="10" height="10" fill="none" aria-hidden="true">
              <path d="M3 4.5l3 3 3-3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
          <Show when={exportOpen()}>
            <div
              class="absolute right-0 mt-1 py-1 min-w-[150px] z-10 rounded shadow-md"
              style={{ background: "var(--octo-surface-page)", border: "1px solid var(--octo-border-default)", top: "100%" }}
            >
              <button
                type="button"
                class="block w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--octo-brand-a5,#f1f1f1)]"
                style={{ color: "var(--octo-text-primary)" }}
                onClick={() => doExport("md")}
              >
                Markdown (.md)
              </button>
              <button
                type="button"
                class="block w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--octo-brand-a5,#f1f1f1)]"
                style={{ color: "var(--octo-text-primary)" }}
                onClick={() => doExport("html")}
              >
                HTML (.html)
              </button>
            </div>
          </Show>
        </div>
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

      {/* 主体:Vditor sv 分屏 */}
      <div class="flex-1 min-h-0 octo-md-editor-host" ref={(el) => (editorEl = el)} />
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
