import type { JSX } from "solid-js"
import { Show, For, createSignal, createEffect, onCleanup } from "solid-js"
import { Portal } from "solid-js/web"
import type { ResultTab } from "./tab-store"
import type { ViewportPreset, PaletteId } from "./html-renderer"
import type { ArtifactExportKind } from "../insight-turn"
import { PALETTE_PRESETS } from "./html-renderer"
import { IconActionCopy, IconActionEdit, IconActionPreview, IconViewportDesktop, IconViewportTablet, IconViewportMobile, IconCanvasEdit, IconBoxSelectEdit, IconLocalModify, IconDownloadNew, IconDropdownChevron } from "../../icons"
import { IconRefresh as IconFileRefresh } from "../../icons/design-files-icons"
import { showToast } from "@opencode-ai/ui/toast"
import { getDesktopApi } from "../../lib/electron-api"
import { tracker } from "@/utils/tracker"

// Responsive breakpoints for action bar
const ACTION_BAR_COLLAPSE_WIDTH = 600
const ACTION_BAR_WRAP_WIDTH = 480

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text)
    .then(() => showToast({ title: "已复制" }))
    .catch(console.error)
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim() || "untitled"
}

function stripExtension(title: string, ext: string): string {
  const suffix = `.${ext}`
  if (title.toLowerCase().endsWith(suffix.toLowerCase())) {
    return title.slice(0, -suffix.length)
  }
  return title
}

async function downloadBlob(content: string | Uint8Array, filename: string, mimeType: string) {
  const blobPart: BlobPart = typeof content === "string" ? content : new Uint8Array(content.buffer as ArrayBuffer, content.byteOffset, content.byteLength)
  const blob = new Blob([blobPart], { type: mimeType })
  const api = getDesktopApi()

  if (api?.saveFilePicker && api?.writeFileBuffer) {
    const chosen = await api.saveFilePicker({ defaultPath: sanitizeFilename(filename) })
    if (!chosen) return
    const buffer = await blob.arrayBuffer()
    await api.writeFileBuffer(chosen, buffer)
    showToast({ title: "已下载" })
    return
  }

  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  showToast({ title: "已下载" })
}

function markdownTableToCSV(md: string): string {
  const lines = md.split("\n")
  const tableLines = lines.filter((l) => l.trim().startsWith("|"))
  return tableLines
    .filter((l) => !/^\|[\s\-:|]+\|$/.test(l.trim()))
    .map((l) =>
      l
        .trim()
        .slice(1, -1)
        .split("|")
        .map((cell) => `"${cell.trim().replace(/"/g, '""')}"`)
        .join(","),
    )
    .join("\n")
}

function extractDownloadContent(tab: ResultTab): string {
  if (tab.type === "table") return markdownTableToCSV(tab.content)

  const raw = tab.content

  if (tab.type === "svg") {
    const fenceMatch = raw.match(/```(?:xml|svg)?\s*\n([\s\S]*?)\n?```/i)
    if (fenceMatch) return fenceMatch[1].trim()
    const svgMatch = raw.match(/(<svg[\s>][\s\S]*<\/svg>)/i)
    if (svgMatch) return svgMatch[1]
    return raw.trim()
  }

  if (tab.type === "code-snippet") {
    const fenceMatch = raw.match(/```[\w]*\s*\n([\s\S]*?)\n?```/)
    if (fenceMatch) return fenceMatch[1].trim()
    return raw.trim()
  }

  if (tab.type === "html" || tab.type === "deck") {
    const fenceMatch = raw.match(/```html\s*\n([\s\S]*?)\n?```/i)
    if (fenceMatch) return fenceMatch[1].trim()
    return raw.trim()
  }

  return raw
}

function getCodeSnippetExt(content: string): string {
  const fenceMatch = content.match(/```(\w+)\s*\n/)
  if (fenceMatch) {
    const lang = fenceMatch[1].toLowerCase()
    const extMap: Record<string, string> = {
      typescript: "ts", ts: "ts", javascript: "js", js: "js",
      python: "py", py: "py", rust: "rs", go: "go", java: "java",
      css: "css", html: "html", json: "json", yaml: "yaml", yml: "yml",
      toml: "toml", sh: "sh", bash: "sh", sql: "sql",
      tsx: "tsx", jsx: "jsx", vue: "vue", svelte: "svelte",
    }
    return extMap[lang] || lang
  }
  return "txt"
}

function getDownloadInfo(tab: ResultTab): { filename: string; mime: string } {
  switch (tab.type) {
    case "html":
      return { filename: `${stripExtension(tab.title, "html")}.html`, mime: "text/html;charset=utf-8" }
    case "deck":
      return { filename: `${stripExtension(tab.title, "pdf")}.pdf`, mime: "application/pdf" }
    case "svg":
      return { filename: `${stripExtension(tab.title, "svg")}.svg`, mime: "image/svg+xml;charset=utf-8" }
    case "json":
      return { filename: `${stripExtension(tab.title, "json")}.json`, mime: "application/json;charset=utf-8" }
    case "table":
      return { filename: `${stripExtension(tab.title, "csv")}.csv`, mime: "text/csv;charset=utf-8" }
    case "code-snippet":
      const ext = getCodeSnippetExt(tab.content)
      return { filename: `${stripExtension(tab.title, ext)}.${ext}`, mime: "text/plain;charset=utf-8" }
    case "markdown":
    case "markdown-document":
      return { filename: `${stripExtension(tab.title, "md")}.md`, mime: "text/markdown;charset=utf-8" }
    default:
      return { filename: `${stripExtension(tab.title, "txt")}.txt`, mime: "text/plain;charset=utf-8" }
  }
}

const EXPORT_LABELS: Record<ArtifactExportKind, string> = {
  html: "HTML",
  pdf: "PDF",
  zip: "ZIP",
  pptx: "PPTX",
  svg: "SVG",
  md: "Markdown",
  txt: "Text",
  json: "JSON",
  csv: "CSV",
}

const EXPORT_MIME: Record<ArtifactExportKind, string> = {
  html: "text/html;charset=utf-8",
  pdf: "application/pdf",
  zip: "application/zip",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  svg: "image/svg+xml;charset=utf-8",
  md: "text/markdown;charset=utf-8",
  txt: "text/plain;charset=utf-8",
  json: "application/json;charset=utf-8",
  csv: "text/csv;charset=utf-8",
}

function getExportContent(tab: ResultTab, kind: ArtifactExportKind): { content: string | Uint8Array; filename: string } | null {
  const raw = extractDownloadContent(tab)
  const base = stripExtension(tab.title.replace(/[^a-zA-Z0-9一-鿿_-]/g, "_"), kind)
  switch (kind) {
    case "html":
      return { content: raw, filename: `${base}.html` }
    case "svg":
      return { content: raw, filename: `${base}.svg` }
    case "json":
      return { content: raw, filename: `${base}.json` }
    case "csv":
      return { content: markdownTableToCSV(tab.content), filename: `${base}.csv` }
    case "md":
      return { content: raw, filename: `${base}.md` }
    case "txt": {
      const ext = getCodeSnippetExt(tab.content)
      const stripped = stripExtension(tab.title.replace(/[^a-zA-Z0-9一-鿿_-]/g, "_"), ext)
      return { content: raw, filename: `${stripped}.${ext}` }
    }
    case "pdf":
      if (tab.type === "deck") {
        exportDeckAsPDF(tab.content, stripExtension(tab.title, "pdf"))
        return null
      }
      return { content: raw, filename: `${base}.html` }
    default:
      return null
  }
}

function exportDeckAsPDF(content: string, title: string) {
  const html = extractDownloadContent({ type: "deck", content } as ResultTab)
  const printHtml = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  @page { margin: 0; size: 1920px 1080px; }
  body { margin: 0; padding: 0; }
  .slide { page-break-after: always; width: 1920px; height: 1080px; box-sizing: border-box; overflow: hidden; }
  .slide:last-child { page-break-after: auto; }
</style>
</head>
<body>${html}</body>
</html>`

  const desktopApi = (window as unknown as { api?: { htmlToPdf?: (html: string) => Promise<ArrayBuffer> } }).api
  if (desktopApi?.htmlToPdf) {
    desktopApi.htmlToPdf(printHtml).then(async (buffer) => {
      await downloadBlob(new Uint8Array(buffer), `${title}.pdf`, "application/pdf")
    }).catch(console.error)
    return
  }

  const win = window.open("", "_blank")
  if (!win) return
  win.document.write(printHtml)
  win.document.close()
  win.onload = () => win.print()
}

const VIEWPORT_OPTIONS: { value: ViewportPreset; label: string; icon: JSX.Element }[] = [
  { value: "desktop", label: "桌面", icon: <IconViewportDesktop size={13} /> },
  { value: "tablet", label: "平板", icon: <IconViewportTablet size={13} /> },
  { value: "mobile", label: "手机", icon: <IconViewportMobile size={13} /> },
]

const MODE_OPTIONS: { value: "preview" | "edit"; label: string; icon: JSX.Element }[] = [
  { value: "preview", label: "预览", icon: <IconActionPreview size={13} /> },
  { value: "edit", label: "源码", icon: <IconActionEdit size={13} /> },
]

function Dropdown(props: {
  options: { value: string; label: string; icon: JSX.Element }[]
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}): JSX.Element {
  const [open, setOpen] = createSignal(false)
  let btnRef: HTMLButtonElement | undefined
  let menuRef: HTMLDivElement | undefined

  const currentOption = () => props.options.find((o) => o.value === props.value) ?? props.options[0]

  createEffect(() => {
    if (!open()) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (menuRef?.contains(target) || btnRef?.contains(target)) return
      setOpen(false)
    }
    const onBlur = () => setOpen(false)
    document.addEventListener("click", handler)
    window.addEventListener("blur", onBlur)
    onCleanup(() => {
      document.removeEventListener("click", handler)
      window.removeEventListener("blur", onBlur)
    })
  })

  return (
    <div class="octo-dropdown">
      <button
        ref={btnRef}
        type="button"
        class="octo-dropdown-trigger"
        classList={{ "octo-dropdown-disabled": props.disabled, "octo-dropdown-open": open() }}
        onClick={() => !props.disabled && setOpen(!open())}
      >
        <span>{currentOption().label}</span>
        <IconDropdownChevron size={16} style={{ transform: open() ? "rotate(-180deg)" : "rotate(0deg)", transition: "transform 0.15s ease" }} />
      </button>
      <Show when={open()}>
        <Portal mount={document.body}>
          {(() => {
            const rect = btnRef?.getBoundingClientRect()
            return (
              <div
                ref={menuRef}
                class="octo-dropdown-menu"
                style={{
                  top: `${(rect?.bottom ?? 0) + 4}px`,
                  left: `${rect?.left ?? 0}px`,
                }}
                onClick={(e) => {
                  const target = e.target as HTMLElement
                  if (!target.closest("button")) setOpen(false)
                }}
              >
                <For each={props.options}>
                  {(opt) => (
                    <button
                      type="button"
                      class={`octo-dropdown-item${opt.value === props.value ? " octo-dropdown-item-active" : ""}`}
                      onClick={() => {
                        if (opt.value === props.value) return
                        props.onChange(opt.value)
                        setOpen(false)
                      }}
                    >
                      <span>{opt.label}</span>
                    </button>
                  )}
                </For>
              </div>
            )
          })()}
        </Portal>
      </Show>
    </div>
  )
}

export function ActionBar(props: {
    tab: ResultTab
    mode?: "preview" | "edit"
    viewport?: ViewportPreset
    palette?: PaletteId | null
    inspecting?: boolean
    editing?: boolean
    drawing?: boolean
    commenting?: boolean
    archiving?: boolean
    focusMode?: boolean
    onRefresh?: () => void
    onModeChange?: () => void
    onViewportChange?: (vp: ViewportPreset) => void
    onPaletteChange?: (palette: PaletteId | null) => void
    onInspectToggle?: () => void
    onEditToggle?: () => void
    onDrawToggle?: () => void
    onCommentToggle?: () => void
    onArchiveToggle?: () => void
    onFocusModeToggle?: () => void
    onCanvasToDesign?: () => void
  }): JSX.Element {
  async function handleDownload() {
    tracker.interaction({ module: "design", name: "download-file", extend: JSON.stringify({ type: props.tab.type }) })
    if (props.tab.type === "deck") {
      exportDeckAsPDF(props.tab.content, props.tab.title)
      return
    }
    const info = getDownloadInfo(props.tab)
    const content = extractDownloadContent(props.tab)
    await downloadBlob(content, info.filename, info.mime)
  }

  const canToggleMode = () => props.tab.type === "html"
  const showViewport = () => props.tab.type === "html" && currentMode() === "preview"
  const showRefreshButton = () => true
  const shouldShowCopy = () =>
    props.tab.type === "table" ||
    props.tab.type === "markdown" ||
    props.tab.type === "markdown-document" ||
    props.tab.type === "json" ||
    props.tab.type === "text" ||
    props.tab.type === "code-snippet"

  const currentMode = () => props.mode ?? "preview"
  const currentViewport = () => props.viewport ?? "desktop"

  return (
    <div class="octo-action-bar">
      <div class="octo-action-bar-left">
        {props.onRefresh && (
          <button
            type="button"
            class="octo-action-btn octo-action-btn-refresh"
            onClick={props.onRefresh}
            title="刷新预览"
          >
            <IconFileRefresh size={16} />
          </button>
        )}
        {canToggleMode() && props.onModeChange && (
          <>
            <div class="shrink-0" style={{ width: "1px", height: "10px", "border-radius": "9px", background: "#c9c9c9", margin: "0 8px" }} />
            <Dropdown
              options={MODE_OPTIONS}
              value={currentMode()}
              onChange={() => props.onModeChange!()}
            />
          </>
        )}
        {showViewport() && props.onViewportChange && (
          <>
            <div class="shrink-0" style={{ width: "1px", height: "10px", "border-radius": "9px", background: "#c9c9c9", margin: "0 8px" }} />
            <Dropdown
              options={VIEWPORT_OPTIONS}
              value={currentViewport()}
              onChange={(v) => props.onViewportChange!(v as ViewportPreset)}
            />
          </>
        )}
      </div>
      <div class="octo-action-bar-right">
        {/* Collapsible buttons - can become icons */}
        <div class="octo-action-bar-collapsible">
          {showViewport() && props.onEditToggle && (
            <button
              type="button"
              class="octo-action-btn"
              classList={{ "octo-viewport-btn-active": !!props.editing }}
              onClick={props.onEditToggle}
              title="局部修改"
            >
              <IconLocalModify size={16} />
              <span>局部修改</span>
            </button>
          )}
          {showViewport() && props.onDrawToggle && (
            <button
              type="button"
              class="octo-action-btn"
              classList={{ "octo-viewport-btn-active": !!props.drawing }}
              onClick={props.onDrawToggle}
              title="框选编辑"
            >
              <IconBoxSelectEdit size={16} />
              <span>框选编辑</span>
            </button>
          )}
          {showViewport() && props.onCanvasToDesign && (
            <button
              type="button"
              class="octo-action-btn"
              onClick={props.onCanvasToDesign}
              title="画布编辑"
            >
              <IconCanvasEdit size={16} />
              <span>画布编辑</span>
            </button>
          )}
          <Show when={shouldShowCopy()}>
            <button type="button" class="octo-action-btn" onClick={() => {
              tracker.interaction({ module: "design", name: "copy-content", extend: JSON.stringify({ type: props.tab.type }) })
              copyToClipboard(props.tab.content)
            }} title="复制">
              <IconActionCopy size={13} />
              <span>复制</span>
            </button>
          </Show>
          <Show when={props.tab.type !== "local-file" && props.tab.type !== "html"}>
            <ExportButton tab={props.tab} onPrimaryDownload={handleDownload} />
          </Show>
          <Show when={props.tab.type === "html"}>
            <button type="button" class="octo-action-btn octo-action-btn-download" onClick={handleDownload} title="下载">
              <IconDownloadNew size={16} />
              <span>下载</span>
            </button>
          </Show>
        </div>

        {/* Fixed buttons - always stay as text */}
        <div class="octo-action-bar-fixed">
          {showViewport() && props.onPaletteChange && (
            <div class="flex items-center gap-[2px] mr-1 hidden">
              <button
                type="button"
                class="octo-viewport-btn"
                classList={{ "octo-viewport-btn-active": !props.palette }}
                onClick={() => props.onPaletteChange!(null)}
                title="默认配色"
              >
                <span style={{ "font-size": "11px", "font-weight": 600, color: "inherit" }}>A</span>
              </button>
              <For each={PALETTE_PRESETS}>
                {(p) => (
                  <button
                    type="button"
                    class="octo-viewport-btn"
                    classList={{ "octo-viewport-btn-active": props.palette === p.id }}
                    onClick={() => props.onPaletteChange!(props.palette === p.id ? null : p.id)}
                    title={p.label}
                  >
                    <span class="flex items-center gap-[1px]">
                      <For each={p.colors.slice(0, 2)}>
                        {(c) => <span style={{ width: "6px", height: "6px", "border-radius": "50%", background: c, display: "inline-block" }} />}
                      </For>
                    </span>
                  </button>
                )}
              </For>
            </div>
          )}
          {showViewport() && props.onCommentToggle && (
            <button
              type="button"
              class="octo-action-btn"
              classList={{ "octo-viewport-btn-active": !!props.commenting }}
              onClick={props.onCommentToggle}
              title="标注"
            >
              <svg viewBox="0 0 20 20" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M2 18L2 10C2 5.58172 5.58172 2 10 2C14.4183 2 18 5.58172 18 10C18 14.4183 14.4183 18 10 18L2 18Z" fill-rule="evenodd" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.25" />
              </svg>
              <span>标注</span>
            </button>
          )}
          {showViewport() && props.onArchiveToggle && (
            <button
              type="button"
              class="octo-action-btn octo-action-btn-archive"
              classList={{ "octo-action-btn-archive-active": !!props.archiving }}
              onClick={props.onArchiveToggle}
              title="归档"
            >
              <span>归档</span>
            </button>
          )}
          <Show when={props.tab.type !== "design-plan" && props.onFocusModeToggle}>
            <button
              type="button"
              class="octo-action-btn"
              classList={{ "octo-viewport-btn-active": !!props.focusMode }}
              onClick={props.onFocusModeToggle}
              title={props.focusMode ? "退出全屏" : "全屏"}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                <Show when={props.focusMode} fallback={
                  <>
                    <path d="M2 2h3.5M2 2v3.5" stroke-linecap="round" stroke-linejoin="round" />
                    <path d="M14 2h-3.5M14 2v3.5" stroke-linecap="round" stroke-linejoin="round" />
                    <path d="M2 14h3.5M2 14v-3.5" stroke-linecap="round" stroke-linejoin="round" />
                    <path d="M14 14h-3.5M14 14v-3.5" stroke-linecap="round" stroke-linejoin="round" />
                  </>
                }>
                  <path d="M6 2h2M6 2v2" stroke-linecap="round" stroke-linejoin="round" />
                  <path d="M8 2h2M10 2v2" stroke-linecap="round" stroke-linejoin="round" />
                  <path d="M6 14h2M6 14v-2" stroke-linecap="round" stroke-linejoin="round" />
                  <path d="M8 14h2M10 14v-2" stroke-linecap="round" stroke-linejoin="round" />
                </Show>
              </svg>
            </button>
          </Show>
        </div>
      </div>
    </div>
  )
}

function ExportButton(props: {
  tab: ResultTab
  onPrimaryDownload: () => Promise<void>
}): JSX.Element {
  const [open, setOpen] = createSignal(false)
  const exports = () => props.tab.exports
  let btnRef: HTMLButtonElement | undefined

  const hasMultiple = () => {
    const e = exports()
    return e && e.length > 1
  }

  const handleExport = async (kind: ArtifactExportKind) => {
    tracker.interaction({ module: "design", name: "export-file", extend: JSON.stringify({ type: props.tab.type, format: kind }) })
    const result = getExportContent(props.tab, kind)
    if (result) await downloadBlob(result.content, result.filename, EXPORT_MIME[kind])
    setOpen(false)
  }

  return (
    <Show
      when={hasMultiple()}
      fallback={
        <button type="button" class="octo-action-btn octo-action-btn-download" onClick={props.onPrimaryDownload} title="下载">
          <IconDownloadNew size={16} />
          <span>下载</span>
        </button>
      }
    >
      <div class="relative" style={{ display: "inline-flex" }}>
        <button
          ref={btnRef}
          type="button"
          class="octo-action-btn octo-action-btn-download"
          onClick={() => setOpen(!open())}
          title="导出"
        >
          <IconDownloadNew size={16} />
          <span>导出</span>
        </button>
        <Show when={open()}>
          <Portal mount={document.body}>
            {(() => {
              const rect = btnRef?.getBoundingClientRect()
              return (
                <div
                  class="fixed z-[99999] rounded-lg overflow-hidden"
                  style={{
                    top: `${(rect?.bottom ?? 0) + 4}px`,
                    left: `${rect?.left ?? 0}px`,
                    background: "#ffffff",
                    border: "1px solid var(--octo-border-default, #E5E7EB)",
                    "box-shadow": "var(--octo-shadow-md, 0 4px 16px rgba(0,0,0,0.08))",
                    animation: "octo-pop-in 120ms var(--octo-ease-out, cubic-bezier(0.23, 1, 0.32, 1))",
                  }}
                  onClick={(e) => {
                    const target = e.target as HTMLElement
                    if (!target.closest("button")) setOpen(false)
                  }}
                >
                  <For each={exports()}>
                    {(kind) => (
                      <button
                        type="button"
                        class="w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--octo-surface-hover,#F5F5F5)]"
                        style={{ color: "var(--octo-text-primary, #191919)" }}
                        onClick={() => handleExport(kind)}
                      >
                        {EXPORT_LABELS[kind]}
                      </button>
                    )}
                  </For>
                </div>
              )
            })()}
          </Portal>
        </Show>
      </div>
    </Show>
  )
}