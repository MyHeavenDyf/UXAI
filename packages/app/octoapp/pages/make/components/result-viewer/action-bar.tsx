import type { JSX } from "solid-js"
import { Show, For, createSignal } from "solid-js"
import { Portal } from "solid-js/web"
import type { ResultTab } from "./tab-store"
import type { ViewportPreset, PaletteId } from "./html-renderer"
import type { ArtifactExportKind } from "../insight-turn"
import { PALETTE_PRESETS } from "./html-renderer"
import { IconActionCopy, IconActionDownload, IconActionEdit, IconActionPreview, IconViewportDesktop, IconViewportTablet, IconViewportMobile, IconInspect, IconEditLine } from "../../icons"
import { showToast } from "@opencode-ai/ui/toast"
import { getDesktopApi } from "../../lib/electron-api"

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text)
    .then(() => showToast({ title: "已复制" }))
    .catch(console.error)
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim() || "untitled"
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
      return { filename: `${tab.title}.html`, mime: "text/html;charset=utf-8" }
    case "deck":
      return { filename: `${tab.title}.pdf`, mime: "application/pdf" }
    case "svg":
      return { filename: `${tab.title}.svg`, mime: "image/svg+xml;charset=utf-8" }
    case "json":
      return { filename: `${tab.title}.json`, mime: "application/json;charset=utf-8" }
    case "table":
      return { filename: `${tab.title}.csv`, mime: "text/csv;charset=utf-8" }
    case "code-snippet":
      return { filename: `${tab.title}.${getCodeSnippetExt(tab.content)}`, mime: "text/plain;charset=utf-8" }
    case "markdown":
    case "markdown-document":
      return { filename: `${tab.title}.md`, mime: "text/markdown;charset=utf-8" }
    default:
      return { filename: `${tab.title}.txt`, mime: "text/plain;charset=utf-8" }
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
  const base = tab.title.replace(/[^a-zA-Z0-9一-鿿_-]/g, "_")
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
      return { content: raw, filename: `${base}.${ext}` }
    }
    case "pdf":
      if (tab.type === "deck") {
        exportDeckAsPDF(tab.content, tab.title)
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

export function ActionBar(props: {
    tab: ResultTab
    mode?: "preview" | "edit"
    viewport?: ViewportPreset
    palette?: PaletteId | null
    inspecting?: boolean
    editing?: boolean
    drawing?: boolean
    onModeChange?: () => void
    onViewportChange?: (vp: ViewportPreset) => void
    onPaletteChange?: (palette: PaletteId | null) => void
    onInspectToggle?: () => void
    onEditToggle?: () => void
    onDrawToggle?: () => void
  }): JSX.Element {
  async function handleDownload() {
    if (props.tab.type === "deck") {
      exportDeckAsPDF(props.tab.content, props.tab.title)
      return
    }
    const info = getDownloadInfo(props.tab)
    const content = extractDownloadContent(props.tab)
    await downloadBlob(content, info.filename, info.mime)
  }

  const canToggleMode = props.tab.type === "html" || props.tab.type === "svg"
  const showViewport = props.tab.type === "html"

  return (
    <div class="octo-action-bar">
      <span class="text-[14px] truncate max-w-[55%]" style={{ color: "var(--octo-text-secondary)" }}>{props.tab.title}</span>
      <div class="flex items-center gap-0.5">
        {showViewport && props.onViewportChange && (
          <div class="flex items-center gap-0.5 mr-1 px-1" style={{ "border-right": "1px solid var(--octo-border-divider)" }}>
            <button
              type="button"
              class="octo-viewport-btn"
              classList={{ "octo-viewport-btn-active": (props.viewport ?? "desktop") === "desktop" }}
              onClick={() => props.onViewportChange!("desktop")}
              title="桌面"
            >
              <IconViewportDesktop size={13} />
            </button>
            <button
              type="button"
              class="octo-viewport-btn"
              classList={{ "octo-viewport-btn-active": props.viewport === "tablet" }}
              onClick={() => props.onViewportChange!("tablet")}
              title="平板"
            >
              <IconViewportTablet size={13} />
            </button>
            <button
              type="button"
              class="octo-viewport-btn"
              classList={{ "octo-viewport-btn-active": props.viewport === "mobile" }}
              onClick={() => props.onViewportChange!("mobile")}
              title="手机"
            >
              <IconViewportMobile size={13} />
            </button>
          </div>
        )}
        {showViewport && props.onPaletteChange && (
          <div class="flex items-center gap-[2px] mr-1 px-1" style={{ "border-right": "1px solid var(--octo-border-divider)" }}>
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
        {showViewport && props.onInspectToggle && (
          <button
            type="button"
            class="octo-action-btn"
            classList={{ "octo-viewport-btn-active": !!props.inspecting }}
            onClick={props.onInspectToggle}
            title="元素检查"
          >
            <IconInspect size={13} />
            <span>检查</span>
          </button>
        )}
        {showViewport && props.onDrawToggle && (
          <button
            type="button"
            class="octo-action-btn"
            classList={{ "octo-viewport-btn-active": !!props.drawing }}
            onClick={props.onDrawToggle}
            title="标注绘图"
          >
            <span style={{ "font-size": "13px" }}>✎</span>
            <span>标注</span>
          </button>
        )}
        {showViewport && props.onEditToggle && (
          <button
            type="button"
            class="octo-action-btn"
            classList={{ "octo-viewport-btn-active": !!props.editing }}
            onClick={props.onEditToggle}
            title="可视化元素编辑（文本、链接、图片、样式）"
          >
            <IconEditLine size={13} />
            <span>编辑</span>
          </button>
        )}
        {canToggleMode && props.onModeChange && (
          <button
            type="button"
            class="octo-action-btn"
            onClick={props.onModeChange}
          >
            {props.mode === "edit" ? <IconActionPreview size={13} /> : <IconActionEdit size={13} />}
            <span>{props.mode === "edit" ? "预览" : "查看源码"}</span>
          </button>
        )}
        <button type="button" class="octo-action-btn" onClick={() => copyToClipboard(props.tab.content)}>
          <IconActionCopy size={13} />
          <span>复制</span>
        </button>
        <ExportButton tab={props.tab} onPrimaryDownload={handleDownload} />
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
    const result = getExportContent(props.tab, kind)
    if (result) await downloadBlob(result.content, result.filename, EXPORT_MIME[kind])
    setOpen(false)
  }

  return (
    <Show
      when={hasMultiple()}
      fallback={
        <button type="button" class="octo-action-btn" onClick={props.onPrimaryDownload}>
          <IconActionDownload size={13} />
          <span>下载</span>
        </button>
      }
    >
      <div class="relative" style={{ display: "inline-flex" }}>
        <button
          ref={btnRef}
          type="button"
          class="octo-action-btn"
          onClick={() => setOpen(!open())}
        >
          <IconActionDownload size={13} />
          <span>导出</span>
        </button>
        <Show when={open()}>
          <Portal>
            {(() => {
              const rect = btnRef?.getBoundingClientRect()
              return (
                <div
                  class="fixed z-[9999] rounded-lg overflow-hidden"
                  style={{
                    top: `${(rect?.bottom ?? 0) + 4}px`,
                    left: `${(rect?.left ?? 0) - 40}px`,
                    background: "var(--octo-surface-page)",
                    border: "1px solid var(--octo-border-default)",
                    "box-shadow": "var(--octo-shadow-md)",
                    "min-width": "120px",
                    animation: "octo-pop-in 120ms var(--octo-ease-out)",
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
                        class="w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--octo-surface-hover)]"
                        style={{ color: "var(--octo-text-primary)" }}
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
