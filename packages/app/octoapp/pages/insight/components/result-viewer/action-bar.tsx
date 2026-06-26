import { createSignal, onCleanup, Show, For } from "solid-js"
import type { JSX } from "solid-js"
import writeXlsxFile from "write-excel-file/browser"
import type { ResultTab, TabViewMode } from "./tab-store"
import { isToggleType } from "./tab-store"
import { IconActionCopy, IconActionDownload, IconActionOpen, IconActionFolder } from "../../icons"
import { parseMarkdownTable, tableToCSV, extractTableMarkdown } from "../../utils/markdown-table"
import { stripCodeFence } from "../../utils/detect"
import { isMindmapJSON } from "../../utils/mindmap-adapter"
import { getDesktopApi } from "../../lib/electron-api"
import { showToast } from "@opencode-ai/ui/toast"
import { tracker } from "@/utils/tracker"
import { useProjectDir } from "@/hooks/use-project-dir"

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).then(() => {
    showToast({ description: "已复制到剪贴板", variant: "success", duration: 2000 })
  }).catch(console.error)
}

function downloadBlob(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim() || "untitled"
}

// path 源(write 文本产物)的本地打开 / 文件夹定位:文件已在磁盘,直接传 filePath。
async function openLocal(filePath: string) {
  const api = getDesktopApi()
  if (typeof api?.openPath !== "function") {
    showToast({ title: "桌面端能力缺失", description: "缺少 window.api.openPath", variant: "error" })
    return
  }
  console.log("[octo:path] open-local", { filePath })
  try {
    const r = (await api.openPath(filePath)) as unknown as string | undefined
    if (typeof r === "string" && r.length > 0) {
      showToast({ title: "唤起本地应用失败", description: "请安装对应应用或在系统设置中关联打开方式", variant: "error" })
    }
  } catch (err) {
    showToast({ title: "无法打开文件", description: err instanceof Error ? err.message : String(err), variant: "error" })
  }
}

function revealLocal(filePath: string) {
  const api = getDesktopApi()
  if (typeof api?.showItemInFolder !== "function") {
    showToast({ title: "桌面端能力缺失", description: "缺少 window.api.showItemInFolder", variant: "error" })
    return
  }
  console.log("[octo:path] reveal-local", { filePath })
  api.showItemInFolder(filePath)
}

// uri 源「另存为」:始终从 url 重新拉 MCP 原始版本(不取本地工作副本/编辑后内容),
// 让用户另存到任意目录 —— 对应「要原件就重新下载」的常规心智(与 file 类型「另存为」同义)。见 §3。
async function downloadOriginal(tab: ResultTab, projectBase: string) {
  if (!tab.uri) return
  const api = getDesktopApi()
  if (typeof api?.saveFilePicker !== "function" || typeof api?.downloadResource !== "function") {
    showToast({ title: "桌面端能力缺失", description: "缺少 saveFilePicker / downloadResource", variant: "error" })
    return
  }
  const fname = sanitizeFilename(tab.fileName || tab.title || "download")
  const defaultPath = projectBase ? `${projectBase}/${fname}` : fname
  try {
    const chosen = await api.saveFilePicker({ defaultPath })
    if (!chosen) return
    console.log("[octo:resource] download-original-start", { uri: tab.uri, destPath: chosen })
    await api.downloadResource(tab.uri, chosen)
    console.log("[octo:resource] download-original-ok", { destPath: chosen })
    showToast({ description: "已另存", variant: "success", duration: 2000 })
  } catch (err) {
    console.error("[octo:resource] download-original-failed", { uri: tab.uri, err })
    showToast({ title: "下载失败", description: err instanceof Error ? err.message : String(err), variant: "error" })
  }
}

async function tableToXlsx(md: string, filename: string) {
  const rows = parseMarkdownTable(md)
  if (rows.length === 0) return
  const data = rows.map((row) => row.map((c) => ({ value: c, type: String })))
  await writeXlsxFile(data).toFile(filename)
}

type DownloadOption = { label: string; format: string; onClick: () => void }

function downloadOptions(tab: ResultTab): DownloadOption[] {
  const base = sanitizeFilename(tab.fileName?.replace(/\.[^.]+$/, "") || tab.title)
  const content = tab.content ?? ""
  switch (tab.type) {
    case "table":
      return [
        {
          label: "Markdown (.md)",
          format: "md",
          onClick: () => downloadBlob(extractTableMarkdown(content), `${base}.md`, "text/markdown;charset=utf-8"),
        },
        {
          label: "CSV (.csv)",
          format: "csv",
          onClick: () =>
            downloadBlob("﻿" + tableToCSV(content), `${base}.csv`, "text/csv;charset=utf-8"),
        },
        {
          label: "Excel (.xlsx)",
          format: "xlsx",
          onClick: () => {
            tableToXlsx(content, `${base}.xlsx`).catch((err) => {
              console.error("Excel 导出失败:", err)
            })
          },
        },
      ]
    case "html":
      return [
        {
          label: "HTML (.html)",
          format: "html",
          onClick: () =>
            downloadBlob(stripCodeFence(content), `${base}.html`, "text/html;charset=utf-8"),
        },
      ]
    case "mindmap":
      return [
        {
          label: "JSON (.json)",
          format: "json",
          onClick: () =>
            downloadBlob(stripCodeFence(content), `${base}.json`, "application/json;charset=utf-8"),
        },
      ]
    case "json":
      return [
        {
          label: "JSON (.json)",
          format: "json",
          onClick: () =>
            downloadBlob(stripCodeFence(content), `${base}.json`, "application/json;charset=utf-8"),
        },
      ]
    case "code": {
      // 代码/纯文本(路径 C):保留原始文件名与扩展名下载
      const name = sanitizeFilename(tab.fileName || `${base}.txt`)
      return [
        {
          label: `下载 (${name})`,
          format: name.split(".").pop() || "txt",
          onClick: () => downloadBlob(content, name, "text/plain;charset=utf-8"),
        },
      ]
    }
    default:
      return [
        {
          label: "Markdown (.md)",
          format: "md",
          onClick: () => downloadBlob(content, `${base}.md`, "text/markdown;charset=utf-8"),
        },
      ]
  }
}

export function ActionBar(props: {
  tab: ResultTab
  viewMode: TabViewMode
  onSetViewMode: (mode: TabViewMode) => void
  /** 进入全屏 markdown 编辑器(仅 markdown 卡且有本地文件时给出) */
  onEdit?: () => void
}): JSX.Element {
  // URI 模式 fetch 未完成时 content 为空,禁用复制 / 下载
  const ready = () => typeof props.tab.content === "string" && props.tab.content.length > 0
  // file 类型(Office/PDF/二进制):FileFallback 自带"用本地应用打开 / 在文件夹中打开 / 另存为",
  // ActionBar 的复制/下载对它无意义(content 为空,复制不出东西),整组隐藏。
  const showActions = () => props.tab.type !== "file"
  // 切换可见性:静态 toggle 类型(mindmap/html/table/markdown)恒显;json 卡按内容判定——
  // 内容是思维导图 shape(顶层带 children 的树)时才出「预览(markmap)/代码(json)」切换,
  // 普通配置 JSON 无切换单显源。内容随 path/uri 读取后回填,本函数响应式重算。见 output-renderers.md §1。
  const showToggle = () =>
    isToggleType(props.tab.type) ||
    (props.tab.type === "json" && isMindmapJSON(props.tab.content ?? ""))
  // 编辑按钮:仅 markdown 卡,且内容来自本地可写文件(uri 落 .octo/downloads / path write 产物);
  // inline 无本地文件不给编辑。见 docs/specs/ui/insight-markdown-editor.md §2.1。
  const canEdit = () =>
    !!props.onEdit && props.tab.type === "markdown" && (props.tab.source === "uri" || props.tab.source === "path") && ready()
  return (
    <div
      class="flex items-center justify-between px-4 py-1.5 shrink-0 gap-2"
      style={{
        "border-bottom": "1px solid var(--octo-border-divider)",
        background: "var(--octo-surface-page)",
        "min-height": "36px",
      }}
    >
      <Show
        when={showToggle()}
        fallback={
          <span class="text-xs truncate max-w-[55%]" style={{ color: "var(--octo-text-secondary)" }}>{props.tab.title}</span>
        }
      >
        <ViewModeToggle mode={props.viewMode} onSet={props.onSetViewMode} />
      </Show>
      <Show when={showActions()}>
        <div class="flex items-center gap-0.5">
          {/* path 源(write 文本产物):额外给"本地打开/文件夹打开"——文件在本地磁盘,
              方便用 Typora / VSCode 等原生应用打开编辑。见 output-renderers.md §2.6.8。 */}
          <Show when={props.tab.source === "path" && props.tab.filePath}>
            <ActionBtn icon={<IconActionOpen size={14} />} label="本地打开" onClick={() => openLocal(props.tab.filePath!)} />
            <ActionBtn icon={<IconActionFolder size={14} />} label="文件夹" onClick={() => revealLocal(props.tab.filePath!)} />
          </Show>
          <Show when={canEdit()}>
            <ActionBtn
              icon={<IconEditPencil size={14} />}
              label="编辑"
              onClick={() => {
                tracker.interaction({ module: "insight", name: "md-edit-open", extend: JSON.stringify({ source: props.tab.source }) })
                props.onEdit!()
              }}
            />
          </Show>
          <ActionBtn
            icon={<IconActionCopy size={14} />}
            label="复制"
            disabled={!ready()}
            onClick={() => {
              if (!ready()) return
              tracker.interaction({
                module: "insight",
                name: "result-copy-content",
                extend: JSON.stringify({ tabType: props.tab.type, viewMode: props.viewMode }),
              })
              const text = props.tab.type === "table"
                ? extractTableMarkdown(props.tab.content!)
                : props.tab.content!
              copyToClipboard(text)
            }}
          />
          <DownloadMenu tab={props.tab} disabled={!ready()} />
        </div>
      </Show>
    </div>
  )
}

// 预览/代码 分段切换(仅 mindmap/html/table/markdown)
function ViewModeToggle(props: { mode: TabViewMode; onSet: (mode: TabViewMode) => void }): JSX.Element {
  const seg = (mode: TabViewMode, label: string) => {
    const active = () => props.mode === mode
    return (
      <button
        type="button"
        onClick={() => props.onSet(mode)}
        class="px-2.5 py-1 text-xs rounded-md transition-colors"
        style={{
          background: active() ? "var(--octo-surface-page)" : "transparent",
          color: active() ? "var(--octo-text-primary)" : "var(--octo-text-secondary)",
          "font-weight": active() ? "500" : "400",
          "box-shadow": active() ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
        }}
      >
        {label}
      </button>
    )
  }
  return (
    <div
      class="flex items-center gap-0.5 p-0.5 rounded-lg"
      style={{ background: "var(--octo-surface-hover, #f1f1f1)" }}
    >
      {seg("preview", "预览")}
      {seg("source", "代码")}
    </div>
  )
}

function DownloadMenu(props: { tab: ResultTab; disabled?: boolean }): JSX.Element {
  const [open, setOpen] = createSignal(false)
  const projectDir = useProjectDir()
  let containerRef: HTMLDivElement | undefined

  const onDocClick = (e: MouseEvent) => {
    if (!containerRef) return
    if (!containerRef.contains(e.target as Node)) setOpen(false)
  }
  document.addEventListener("click", onDocClick)
  onCleanup(() => document.removeEventListener("click", onDocClick))

  // uri markdown 卡:预览/编辑用的是本地工作副本(可能已改),「另存为」给的是 MCP 原件(§3);
  // 其余类型沿用按当前内容导出/转格式。
  const options = (): DownloadOption[] =>
    props.tab.source === "uri" && props.tab.type === "markdown"
      ? [{ label: "另存为", format: "original", onClick: () => void downloadOriginal(props.tab, projectDir() || "") }]
      : downloadOptions(props.tab)

  return (
    <div class="relative" ref={(el) => (containerRef = el)}>
      <ActionBtn
        icon={<IconActionDownload size={14} />}
        label="下载"
        disabled={props.disabled}
        onClick={() => !props.disabled && setOpen((v) => !v)}
      />
      <Show when={open() && !props.disabled}>
        <div
          class="absolute right-0 mt-1 py-1 min-w-[140px] z-10 rounded shadow-md"
          style={{
            background: "var(--octo-surface-page)",
            border: "1px solid var(--octo-border-default)",
            top: "100%",
          }}
        >
          <For each={options()}>
            {(opt) => (
              <button
                type="button"
                class="block w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--octo-brand-a5)]"
                style={{ color: "var(--octo-text-primary)" }}
                onClick={() => {
                  setOpen(false)
                  tracker.interaction({
                    module: "insight",
                    name: "result-download",
                    extend: JSON.stringify({ format: opt.format, tabType: props.tab.type }),
                  })
                  opt.onClick()
                }}
              >
                {opt.label}
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}

function IconEditPencil(props: { size?: number }): JSX.Element {
  const s = () => props.size ?? 14
  return (
    <svg viewBox="0 0 16 16" width={s()} height={s()} fill="none" aria-hidden="true">
      <path d="M11 2.5l2.5 2.5L6 12.5 3 13l.5-3L11 2.5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />
    </svg>
  )
}

function ActionBtn(props: {
  icon: JSX.Element
  label: string
  onClick: () => void
  disabled?: boolean
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      class="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors octo-btn-action disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {props.icon}
      <span>{props.label}</span>
    </button>
  )
}
