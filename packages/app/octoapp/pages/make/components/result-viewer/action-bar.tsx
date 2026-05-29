import type { JSX } from "solid-js"
import type { ResultTab } from "./tab-store"
import { IconActionCopy, IconActionDownload, IconActionEdit, IconActionPreview } from "../../icons"

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(console.error)
}

function downloadBlob(content: string | Uint8Array, filename: string, mimeType: string) {
  const part: BlobPart = typeof content === "string" ? content : (content.buffer as ArrayBuffer)
  const blob = new Blob([part], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
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
    desktopApi.htmlToPdf(printHtml).then((buffer) => {
      downloadBlob(new Uint8Array(buffer), `${title}.pdf`, "application/pdf")
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
  onModeChange?: () => void
}): JSX.Element {
  function handleDownload() {
    if (props.tab.type === "deck") {
      exportDeckAsPDF(props.tab.content, props.tab.title)
      return
    }
    const info = getDownloadInfo(props.tab)
    const content = extractDownloadContent(props.tab)
    downloadBlob(content, info.filename, info.mime)
  }

  const canToggleMode = props.tab.type === "html" || props.tab.type === "svg"

  return (
    <div class="octo-action-bar">
      <span class="text-[12px] truncate max-w-[55%]" style={{ color: "var(--octo-text-secondary)" }}>{props.tab.title}</span>
      <div class="flex items-center gap-0.5">
        {canToggleMode && props.onModeChange && (
          <button
            type="button"
            class="octo-action-btn"
            onClick={props.onModeChange}
          >
            {props.mode === "edit" ? <IconActionPreview size={13} /> : <IconActionEdit size={13} />}
            <span>{props.mode === "edit" ? "预览" : "编辑"}</span>
          </button>
        )}
        <button type="button" class="octo-action-btn" onClick={() => copyToClipboard(props.tab.content)}>
          <IconActionCopy size={13} />
          <span>复制</span>
        </button>
        <button type="button" class="octo-action-btn" onClick={handleDownload}>
          <IconActionDownload size={13} />
          <span>下载</span>
        </button>
      </div>
    </div>
  )
}
