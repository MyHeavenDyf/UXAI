import type { AssistantMessage, Message } from "@opencode-ai/sdk/v2/client"
import type { SessionStatus } from "@opencode-ai/sdk/v2"
import { useData, useI18n } from "@opencode-ai/ui/context"
import { Markdown } from "@opencode-ai/ui/markdown"
import { MessageDivider } from "@opencode-ai/ui/message-part"
import { Button } from "@opencode-ai/ui/button"
import { createEffect, createMemo, createResource, createSignal, on, Show, For, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { IconCardTable, IconCardMindmap, IconCardJson, IconCardFile, IconCardMarkdown, IconCardHtml, IconCardDeck, IconCardSvg, IconCardReact, IconCardDiagram } from "../icons"
import { createArtifactParser, isTruncatedHtml, repairTruncatedHtml } from "../utils/artifact-parser"
import { splitOnQuestionForms, type FormSegment, type QuestionForm } from "../utils/question-form"
import { QuickBriefFormView } from "./quick-brief-form"
import './quick-brief-form.css'
import './insight-turn-meta.css'
import { autoSaveArtifact } from "../utils/artifact-auto-save"
import { parseUploadedFiles } from "../../insight/lib/upload"
import { ExpandableBubble } from "@/components/expandable-bubble"

import { ToolCallGroupCard, type ToolCallInfo } from "./tool-call-card"
import { FileOpsSummary } from "./file-ops-summary"
import { getFileIcon } from "../icons/file-type-icons"
import { extractSubtypeFromTitle } from "../utils/subtype-extractor"
import { kindFromMime } from "./attachment-bar"
import { isElectronDesktop, pathToLocalUrl } from "../utils/artifact-file-api"
import { lookupDisplayName } from "./skill-config-types"

function renderMentionText(text: string): JSX.Element {
  const parts = text.split(/(@[^\s@]+)/g)
  
  return (
    <>
      {parts.map((part) => {
        if (part.startsWith("@") && part.length > 1) {
          return (
            <span style={{ "margin-left": "8px", "margin-right": "8px" }}>
              {part}
            </span>
          )
        }
        return part
      })}
    </>
  )
}

// 跟踪已 autoSave 的 artifact（避免重复调用）
const autoSavedArtifacts = new Set<string>()

export type DeltaLogEntry = {
  timestamp: number
  eventType: string
  sessionID: string
  messageID: string
  partID: string
  field: string
  delta: string
}

export type OutputCardType =
  | "table" | "mindmap" | "markdown" | "file" | "json" | "html"
  | "deck" | "svg" | "markdown-document" | "code-snippet"
  | "react-component" | "diagram"
  | "image" | "video" | "audio" | "pdf" | "text"
  | "design-plan"
  | "link"

export type ArtifactExportKind = "html" | "pdf" | "zip" | "pptx" | "svg" | "md" | "txt" | "json" | "csv"

export type OutputCard = {
  id: string
  title: string
  type: OutputCardType
  subtype?: string
  content: string
  filePath?: string
  commentFilePath?: string
  sessionId?: string
  artifactKind?: string
  artifactIdentifier?: string
  exports?: ArtifactExportKind[]
  designSystemId?: string | null
  truncated?: boolean
  createdAt: Date
}

const ARTIFACT_TYPE_MAP: Record<string, OutputCardType> = {
  html: "html",
  "text/html": "html",
  "text/html+deck": "deck",
  deck: "deck",
  svg: "svg",
  "image/svg+xml": "svg",
  "markdown-document": "markdown-document",
  "code-snippet": "code-snippet",
  "react-component": "react-component",
  diagram: "diagram",
  "text/design-plan": "design-plan",
  "text/link": "link",
}

// 从 link artifact 的 content(URL 或磁盘路径)提取卡片标题
// URL:        提取最后的文件名(含扩展名),无路径时回退到 host
//             "https://a.com/path/file.html" → "file.html"
//             "https://a.com/"               → "a.com"
// 磁盘路径:   取最后一段并去掉格式后缀,保留 subtype
//             "D:\\dir\\a.shadcn.html" → "a.shadcn"
//             "D:\\dir\\report.pdf"    → "report"
function extractLinkTitle(content: string): string {
  const trimmed = (content ?? "").trim()
  if (!trimmed) return ""

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed)
      const segments = u.pathname.split("/").filter(Boolean)
      if (segments.length > 0) {
        const last = segments[segments.length - 1]
        try { return decodeURIComponent(last) } catch { return last }
      }
      return u.host
    } catch {
      // fall through to path handling
    }
  }

  const parts = trimmed.split(/[/\\]/).filter(Boolean)
  const filename = parts.length > 0 ? parts[parts.length - 1] : trimmed
  const lastDot = filename.lastIndexOf(".")
  if (lastDot > 0) return filename.slice(0, lastDot)
  return filename
}

function isMarkdownTable(text: string): boolean {
  if (/\|[\s]*[-:]+[-:\s|]*\|/.test(text)) return true
  const tableLines = text
    .split("\n")
    .filter((l) => l.trim().startsWith("|") && (l.match(/\|/g) ?? []).length >= 3)
  return tableLines.length >= 2
}

function decodeDataUrl(url: string): string {
  try {
    const match = url.match(/^data:[^;]*;base64,(.+)$/)
    if (match) return atob(match[1])
    return url
  } catch {
    return url
  }
}

// 从文件名扩展名推断 mime,仅用于 local 附件清单渲染(后端 manifest 只存了 filename+path)。
// 覆盖常见图片/svg/webp/gif,其余按二进制处理,渲染端走文件图标 fallback。
function mimeFromFilename(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? ""
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    html: "text/html",
    htm: "text/html",
    md: "text/markdown",
    txt: "text/plain",
    json: "application/json",
    js: "application/javascript",
    ts: "application/typescript",
    css: "text/css",
    pdf: "application/pdf",
    mp4: "video/mp4",
    webm: "video/webm",
    mp3: "audio/mpeg",
    wav: "audio/wav",
  }
  return map[ext] ?? "application/octet-stream"
}


function getToolEndTime(state: Record<string, unknown> | undefined): number {
  const time = state?.time as Record<string, unknown> | undefined
  const end = time?.end as number | undefined
  return end ?? Date.now()
}

function getTextPartTime(part: Record<string, unknown>): number {
  const time = part.time as Record<string, unknown> | undefined
  const end = time?.end as number | undefined
  return end ?? Date.now()
}

function CardTypeIcon(props: { type: OutputCardType }): JSX.Element {
  switch (props.type) {
    case "table": return <IconCardTable size={16} />
    case "mindmap": return <IconCardMindmap size={16} />
    case "json": return <IconCardJson size={16} />
    case "file": return <IconCardFile size={16} />
    case "markdown": return <IconCardMarkdown size={16} />
    case "html": return <IconCardHtml size={16} />
    case "deck": return <IconCardDeck size={16} />
    case "svg": return <IconCardSvg size={16} />
    case "markdown-document": return <IconCardMarkdown size={16} />
    case "code-snippet": return <IconCardFile size={16} />
    case "react-component": return <IconCardReact size={16} />
    case "diagram": return <IconCardDiagram size={16} />
  }
}

function cardTypeIconSrc(_type: OutputCardType): string {
  return "/AI_doc_plaintext.svg"
}

function parseAllArtifactsFromText(text: string): Omit<OutputCard, "id" | "createdAt">[] {
  if (!/<artifact/i.test(text)) return []
  const results: Omit<OutputCard, "id" | "createdAt">[] = []
  try {
    const parser = createArtifactParser()
    let startEvent: Extract<import("../utils/artifact-parser").ArtifactEvent, { type: "artifact:start" }> | null = null
    let fullContent = ""
    function handleEvent(ev: import("../utils/artifact-parser").ArtifactEvent) {
      if (ev.type === "artifact:start") {
        startEvent = ev
        fullContent = ""
      } else if (ev.type === "artifact:chunk") {
        fullContent += ev.delta
      } else if (ev.type === "artifact:end") {
        fullContent = ev.fullContent
        if (!startEvent) return
        const mappedType = ARTIFACT_TYPE_MAP[startEvent.artifactType]
        // design-plan 或 identifier 以 "plan-" 开头的 artifact 不在消息流中显示卡片。
        // 它们是方案阶段产物,只通过输入框上方的 plan banner 入口进入 ResultViewer。
        // 双重兜底:type 正确时 mappedType === "design-plan";agent 把 type 写错时
        // (例如写成 markdown-document) identifier 前缀仍然能识别出来。
        const isPlanArtifact =
          mappedType === "design-plan" ||
          (startEvent.identifier || "").startsWith("plan-")
        if (isPlanArtifact) {
          startEvent = null
          return
        }
        if (!mappedType) return
        const explicitExports = startEvent.exports
          ? startEvent.exports.split(",").map((s) => s.trim() as ArtifactExportKind)
          : undefined
        // link 类型:始终从 content(URL 或磁盘路径)派生标题,忽略 artifact 标签的 title 属性
        // 原因:content 是路径,标题应为文件名(磁盘路径去格式后缀保留 subtype,URL 取文件名含扩展名)
        // 模型声明的 title 可能带后缀或含异常字符,不可靠
        let resolvedTitle = startEvent.title
        if (mappedType === "link") {
          const fromContent = extractLinkTitle(fullContent)
          if (fromContent) resolvedTitle = fromContent
        }
        results.push({
          title: resolvedTitle || mappedType,
          type: mappedType,
          subtype: extractSubtypeFromTitle(resolvedTitle),
          content: fullContent,
          artifactKind: startEvent.artifactType,
          artifactIdentifier: startEvent.identifier || undefined,
          exports: explicitExports,
          designSystemId: startEvent.designSystemId || null,
        })
        startEvent = null
      }
    }
    for (const ev of parser.feed(text)) handleEvent(ev)
    // 不调用 flush() — 未闭合的 artifact 不应该被输出，避免中断时生成混乱卡片
  } catch {
    // ignore parse errors
  }
  return results
}

/** Quick regex scan for all artifact open tags (completed + in-progress) for streaming placeholders */
function scanArtifactHeaders(text: string): Array<{ identifier: string; title: string; type: OutputCardType }> {
  if (!/<artifact/i.test(text)) return []
  const results: Array<{ identifier: string; title: string; type: OutputCardType }> = []
  const re = /<artifact\s+([^>]*)>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const attrs = m[1]
    const identifier = attrs.match(/identifier="([^"]*)"/)?.[1] ?? ""
    const artifactType = attrs.match(/type="([^"]*)"/)?.[1] ?? "text/html"
    const title = attrs.match(/title="([^"]*)"/)?.[1] ?? ""
    const mappedType = ARTIFACT_TYPE_MAP[artifactType]
    // design-plan 或 identifier 以 "plan-" 开头的 artifact 跳过,不显示消息流卡片
    const isPlanArtifact =
      mappedType === "design-plan" || identifier.startsWith("plan-")
    if (mappedType && !isPlanArtifact) {
      results.push({ identifier, title: title || mappedType, type: mappedType })
    }
  }
  return results
}

function formatTime(d: Date): string {
  return d.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function formatDeltaTime(ms: number): string {
  const d = new Date(ms)
  return d.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
}

function formatBlockTime(secs: number): string {
  if (secs < 60) return `${secs}秒`
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}分${s}秒`
}

// ── Internal: WaitingPill ──────────────────────────────────

type SubtaskInfo = {
  taskDescription: string
  subSessionID: string
  status: "running" | "done" | "error" | "cancelled"
  textParts: string[]
  artifactOutputs: Array<{ identifier: string; title: string; content: string }>
  completedAt?: number
}

function WaitingPill(props: {
  parts: Array<{ type: string; text?: string }>
  partStore: Record<string, { type: string; text?: string }[]>
  messageID: string
  sessionID: string
  deltaLog: DeltaLogEntry[]
  msgStore: Record<string, Message[]>
  subtasks: SubtaskInfo[]
}): JSX.Element {
  const statusLabel = createMemo(() => {
    const parts = props.parts
    const toolParts = parts.filter((p) => p.type === "tool")
    const hasText = parts.some((p) => p.type === "text")
    const hasReasoning = props.deltaLog.some(e => e.sessionID !== props.sessionID && e.field === "reasoning")
    if (hasReasoning) return "深度思考中"
    if (hasText) return "生成中"
    if (toolParts.length === 0) return "思考中"
    const lastTool = toolParts[toolParts.length - 1] as Record<string, unknown>
    const state = lastTool.state as Record<string, unknown> | undefined
    if (!state?.output) return "执行工具中"
    return "生成中"
  })

  const accumulatedText = createMemo(() => {
    if (!props.messageID) return { reasoning: "", artifact: "" }
    
    let reasoningContent = ""
    let artifactContent = ""
    
    const parts = props.partStore?.[props.messageID] ?? []
    const textPart = [...parts]
      .reverse()
      .find((p) => p.type === "text") as { type: "text"; text?: string } | undefined
    if (textPart?.text) {
      const parser = createArtifactParser()
      for (const ev of parser.feed(textPart.text)) {
        if (ev.type === "artifact:chunk") artifactContent += ev.delta
      }
      for (const ev of parser.flush()) {
        if (ev.type === "artifact:chunk") artifactContent += ev.delta
      }
    }
    
    const childReasoningDeltas = props.deltaLog
      .filter(entry => entry.sessionID !== props.sessionID && entry.field === "reasoning")
      .slice(-30)
    for (const entry of childReasoningDeltas) {
      reasoningContent += entry.delta
    }
    
    const childTextDeltas = props.deltaLog
      .filter(entry => entry.sessionID !== props.sessionID && entry.field === "text")
      .slice(-50)
    for (const entry of childTextDeltas) {
      if (/<artifact/i.test(entry.delta)) {
        const childParser = createArtifactParser()
        for (const ev of childParser.feed(entry.delta)) {
          if (ev.type === "artifact:chunk") artifactContent += ev.delta
        }
        for (const ev of childParser.flush()) {
          if (ev.type === "artifact:chunk") artifactContent += ev.delta
        }
      }
    }
    
    const runningSubtasks = props.subtasks.filter(t => t.status === "running" && t.subSessionID)
    for (const subtask of runningSubtasks) {
      const subMessages = props.msgStore?.[subtask.subSessionID] ?? []
      for (const msg of subMessages) {
        if (msg.role !== "assistant") continue
        const subParts = props.partStore?.[msg.id] ?? []
        for (const part of subParts) {
          if (part.type === "reasoning" && (part as { text?: string }).text) {
            reasoningContent += (part as { text: string }).text + "\n"
          }
        }
        const subTextPart = [...subParts]
          .reverse()
          .find((p) => p.type === "text") as { type: "text"; text?: string } | undefined
        if (subTextPart?.text) {
          const subParser = createArtifactParser()
          for (const ev of subParser.feed(subTextPart.text)) {
            if (ev.type === "artifact:chunk") artifactContent += ev.delta
          }
          for (const ev of subParser.flush()) {
            if (ev.type === "artifact:chunk") artifactContent += ev.delta
          }
        }
      }
    }
    
    return { reasoning: reasoningContent.trim(), artifact: artifactContent.trim() }
  })

  let contentRef: HTMLDivElement | undefined

  createEffect(() => {
    const text = accumulatedText()
    if ((text.reasoning || text.artifact) && contentRef) {
      contentRef.scrollTop = contentRef.scrollHeight
    }
  })

  const displayText = createMemo(() => {
    const { reasoning, artifact } = accumulatedText()
    return reasoning || artifact
  })

  return (
    <div
      class="mx-3"
        style={{
          "border-radius": "var(--octo-radius-md)",
          background: "var(--octo-brand-a3)",
          border: "1.5px dashed var(--octo-brand-a25)",
        }}
      >
      <div class="px-3 py-2 flex items-center gap-2">
        <div
          class="w-1.5 h-1.5 rounded-full animate-pulse"
          style={{
            background: "var(--octo-brand, #3b82f6)",
          }}
        />
        <span class="text-xs" style={{ color: "var(--octo-text-secondary)" }}>
          {statusLabel()}…
        </span>
      </div>
      <Show when={displayText().length > 0}>
        <div
          ref={(el) => { contentRef = el }}
          class="px-3 pb-2"
          style={{
            "max-height": "120px",
            overflow: "auto",
            "font-size": "11px",
            "font-family": "'SF Mono', 'Monaco', 'Consolas', 'Courier New', monospace",
            color: "var(--octo-text-primary)",
          }}
        >
          <pre class="whitespace-pre-wrap word-break-word" style={{ margin: "0" }}>{displayText()}</pre>
        </div>
      </Show>
    </div>
  )
}

// ── Internal: ProducedFilesList ────────────────────────────

function ProducedFilesList(props: { files: Array<{ path: string; name: string }> }): JSX.Element {
  return (
    <div class="mx-3">
      <div
        class="px-2.5 py-1.5 flex flex-col gap-1"
        style={{
          "border-radius": "var(--octo-radius-md)",
          background: "var(--octo-surface-page)",
          border: "1px solid rgba(0,0,0,0.1)",
        }}
      >
        <div class="text-[11px]" style={{ color: "var(--octo-text-secondary)" }}>
          涉及文件
        </div>
        <For each={props.files}>
          {(file) => (
            <div class="flex items-center gap-1.5 text-xs">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <rect x="2" y="1" width="8" height="10" rx="1" stroke="currentColor" stroke-width="1" />
                <path d="M5 4h3M5 6h3M5 8h2" stroke="currentColor" stroke-width="0.7" />
              </svg>
              <span class="truncate" style={{ color: "var(--octo-text-primary)" }}>{file.name}</span>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}

// ── Internal: ReasoningCollapsed ───────────────────────────

function ReasoningCollapsed(props: { texts: string[]; duration: string }): JSX.Element {
  const [open, setOpen] = createSignal(false)
  return (
    <div style={{ width: "100%" }}>
      <button
        type="button"
        onClick={() => setOpen(!open())}
        style={{
          display: "inline-flex",
          "align-items": "center",
          gap: "2px",
          padding: "0",
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "#191919",
          "font-size": "12px",
          "line-height": "18px",
          "user-select": "none",
          "text-align": "left",
        }}
      >
        <span style={{ "flex-shrink": 0 }}>已深度思考</span>
        <Show when={props.duration}>
          <span style={{ "flex-shrink": 0, color: "#191919" }}>（用时{props.duration}）</span>
        </Show>
        <span
          style={{
            "flex-shrink": 0,
            display: "inline-flex",
            "align-items": "center",
            color: "var(--icon-base, #777)",
            transition: "transform 0.2s ease",
            transform: open() ? "rotate(180deg)" : "rotate(0deg)",
          }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M3 4.5l3 3 3-3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" fill="none" />
          </svg>
        </span>
      </button>
      <Show when={open()}>
        <div
          style={{
            "margin-top": "16px",
            "padding-left": "12px",
            "border-left": "1px solid rgba(0,0,0,0.08)",
            "font-size": "12px",
            "line-height": "18px",
            color: "#777",
            "max-height": "300px",
            overflow: "auto",
          }}
        >
          <For each={props.texts}>
            {(text, i) => (
              <>
                <Show when={i() > 0}>
                  <div class="my-1.5" style={{ "border-top": "1px dashed rgba(0,0,0,0.08)" }} />
                </Show>
                <div class="whitespace-pre-wrap" style={{ "user-select": "text" }}>{text}</div>
              </>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}

// ── Main: InsightTurn ──────────────────────────────────────

export function InsightTurn(props: {
  sessionID: string
  messageID: string
  status: SessionStatus
  active: boolean
  elapsedText?: string
  blockTime?: number
  onAbort?: () => void
  onOpenResult: (card: OutputCard) => void
  onOpenLocalFile?: (filePath: string) => void
  projectDir?: string
  onContinue?: (card: OutputCard) => void
  onChildSession?: (subSessionID: string) => void
  deltaLog?: DeltaLogEntry[]
  onFormSubmit?: (text: string) => void
  hasQuestionRequest?: boolean
  onFilesRefresh?: () => void
  skillToolCalls?: ToolCallInfo[]
  skillConfig?: import("./skill-config-types").SkillConfig
}): JSX.Element {
  const data = useData()
  const i18n = useI18n()
  const partStore = data.store.part as Record<string, { type: string; text?: string }[]>
  const msgStore = data.store.message as Record<string, Message[]>

  // Lifted expand state for subtasks (persists across re-renders)
  const [subtaskExpandState, setSubtaskExpandState] = createStore<Record<string, boolean>>({})

  const userText = createMemo(() => {
    const parts = partStore?.[props.messageID] ?? []
    
    // 优先查找带有 metadata.displayText 的 text part（用于 @mention 显示）
    const displayTextPart = parts.find(
      (p) => p.type === "text" && (p as { metadata?: { displayText?: string } }).metadata?.displayText
    )
    if (displayTextPart) {
      const metadata = (displayTextPart as { metadata?: { displayText?: string } }).metadata
      return metadata?.displayText?.trim() ?? ""
    }
    
    // 否则查找第一个 text part
    const textPart = parts.find((p) => p.type === "text")
    if (!textPart?.text) return ""
    
    const raw = textPart.text
    const sepIdx = raw.lastIndexOf("\n---\n")
    if (sepIdx !== -1) return raw.slice(sepIdx + 5).trim()
    return raw.trim()
  })

  // FilePart entries (images with S3 URL)
  const userFileParts = createMemo(() => {
    const parts = partStore?.[props.messageID] ?? []
    return parts.filter((p) => p.type === "file") as Array<{ type: "file"; mime?: string; filename?: string; url?: string }>
  })

  // Synthetic [附件] manifest (local file references)
  const userInputManifest = createMemo((): Array<{ filename: string; path: string }> => {
    const parts = partStore?.[props.messageID] ?? []
    const block = parts.find(
      (p) => p.type === "text" && (p as { synthetic?: boolean }).synthetic && typeof (p as { text?: string }).text === "string" && (p as { text?: string }).text!.startsWith("[附件]")
    )
    if (!block) return []
    return parseUploadedFiles((block as { text: string }).text)
  })

  // Merged attachments for display
  // local 文件清单只存了 {filename, path},没带 mime。从扩展名推断图片类型,
  // Electron 桌面用 local:// 协议直接显示;浏览器环境无此协议,保持文件图标 fallback。
  const userAttachments = createMemo(() => {
    const files = userFileParts()
    const locals = userInputManifest()
    const desktop = isElectronDesktop()
    return [
      ...files.map(f => ({ filename: f.filename ?? "file", url: f.url as string | undefined, mime: f.mime, isLocal: false })),
      ...locals.map(l => {
        const mime = mimeFromFilename(l.filename)
        const isImage = mime.startsWith("image/")
        return {
          filename: l.filename,
          url: (desktop && isImage) ? pathToLocalUrl(l.path) : undefined,
          mime,
          isLocal: true,
        }
      }),
    ]
  })

  // Collect ALL assistant messages between this user message and the next user message.
  // Backend agent loop can produce multiple assistant messages per user turn
  // (e.g. first does reasoning + tool calls, second generates the actual artifact).
  const assistantMsgs = createMemo((): AssistantMessage[] => {
    const messages = msgStore?.[props.sessionID] ?? []
    const idx = messages.findIndex((m) => m.id === props.messageID)
    if (idx === -1) return []
    const result: AssistantMessage[] = []
    for (let i = idx + 1; i < messages.length; i++) {
      const m = messages[i]
      if (m.role === "assistant") result.push(m as AssistantMessage)
      if (m.role === "user") break
    }
    return result
  })

  const isAborted = createMemo(() => {
    for (const msg of assistantMsgs()) {
      const err = (msg as Record<string, unknown>).error as Record<string, unknown> | undefined
      if (err?.name === "MessageAbortedError") return true
    }
    return false
  })

  const assistantError = createMemo(() => {
    for (const msg of assistantMsgs()) {
      const err = (msg as Record<string, unknown>).error as Record<string, unknown> | undefined
      if (!err) continue
      if (err.name === "MessageAbortedError") continue
      const data = err.data as Record<string, unknown> | undefined
      const message = typeof data?.message === "string" ? data.message : typeof err.message === "string" ? err.message as string : ""
      return { name: err.name as string, message }
    }
    return null
  })

  const assistantParts = createMemo(() => {
    const msgs = assistantMsgs()
    if (msgs.length === 0) return []
    // Aggregate parts from all assistant messages in order
    const allParts: { type: string; text?: string }[] = []
    for (const msg of msgs) {
      const parts = partStore?.[msg.id] ?? []
      allParts.push(...parts)
    }
    return allParts
  })

  const latestAssistantMessageID = createMemo(() => {
    const msgs = assistantMsgs()
    if (msgs.length === 0) return ""
    return msgs[msgs.length - 1].id
  })

  // 提取 reasoning 内容
  const reasoningTexts = createMemo(() => {
    const parts = assistantParts()
    const texts: string[] = []
    for (const p of parts) {
      if (p.type === "reasoning" && (p as { text?: string }).text) {
        texts.push((p as { text: string }).text)
      }
      if (p.type === "tool") {
        const state = (p as Record<string, unknown>).state as Record<string, unknown> | undefined
        const reasoning = state?.reasoning as string | undefined
        if (reasoning) texts.push(reasoning)
      }
    }
    return texts
  })

  const isLatestTurn = createMemo(() => {
    const messages = msgStore?.[props.sessionID] ?? []
    let lastUser: Message | undefined
    let lastUserTime = -1
    for (const m of messages) {
      if (m.role !== "user") continue
      const t = (m as { time?: { created?: number } }).time?.created ?? 0
      if (t >= lastUserTime) {
        lastUserTime = t
        lastUser = m
      }
    }
    return lastUser?.id === props.messageID
  })

  const showGenerating = createMemo(() => props.active && isLatestTurn())

  const reasoningDuration = createMemo(() => {
    const msgs = assistantMsgs()
    if (msgs.length === 0) return ""
    const lastMsg = msgs[msgs.length - 1] as AssistantMessage
    const completed = lastMsg.time?.completed
    const created = lastMsg.time?.created
    if (typeof completed !== "number" || typeof created !== "number") return ""
    const secs = Math.round((completed - created) / 1000)
    if (secs <= 0) return ""
    if (secs < 60) return `${secs}s`
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return s > 0 ? `${m}m ${s}s` : `${m}m`
  })

  const turnMeta = createMemo(() => {
    const msgs = assistantMsgs()
    if (msgs.length === 0) return ""
    if (showGenerating()) return ""
    const firstMsg = msgs[0] as AssistantMessage
    const lastMsg = msgs[msgs.length - 1] as AssistantMessage
    const start = firstMsg.time?.created
    const completed = lastMsg.time?.completed
    if (typeof start !== "number" || typeof completed !== "number") return ""
    if (completed < start) return ""
    const secs = Math.round((completed - start) / 1000)
    if (secs < 0) return ""
    const duration = secs < 60
      ? `${secs} 秒`
      : `${Math.floor(secs / 60)} 分 ${secs % 60} 秒`

    let agent = lastMsg.agent
    if (agent === 'octo_ai' || agent === 'octo_make' || agent === 'octo_make_plan') agent = 'Octo_Design'
    const agentLabel = agent ? agent[0]?.toUpperCase() + agent.slice(1) : ""
    const modelLabel = (() => {
      const match = data.store.provider?.all?.find((p) => p.id === lastMsg.providerID)
      return match?.models?.[lastMsg.modelID]?.name ?? lastMsg.modelID ?? ""
    })()
    const interruptedLabel = isAborted() ? i18n.t("ui.message.interrupted") : ""
    return [agentLabel, modelLabel, duration, interruptedLabel]
      .filter(Boolean)
      .join(" · ")
  })

  // ── NEW: tool calls ──
  const toolCalls = createMemo((): ToolCallInfo[] => {
    const parts = assistantParts()
    const skillData = props.skillConfig?.skill
    
    return parts
      .filter((p) => p.type === "tool")
      .map((p) => {
        const raw = p as Record<string, unknown>
        const state = raw.state as Record<string, unknown> | undefined
        if (!state) return { name: "unknown", status: "running" as const }
        const input = state.input as Record<string, unknown> | undefined
        const filePath = input
          ? ((input.path ?? input.filepath ?? input.filePath ?? "") as string)
          : ""
        const stateStatus = state.status as string | undefined
        const stateError = state.error as string | undefined
        const hasOutput = typeof state.output === "string" && (state.output as string).length > 0
        const metadata = state.metadata as Record<string, unknown> | undefined
        const isCancelled = stateStatus === "error" && (stateError === "Cancelled" || stateError === "Tool execution aborted")
        const isErrorFromStatus = stateStatus === "error" && !isCancelled
        const isErrorFromMetadata = metadata?.exit !== undefined && (metadata.exit as number) !== 0
        const isError = isErrorFromStatus || isErrorFromMetadata
        const isCompleted = stateStatus === "completed"
        
        const toolName = (raw.tool as string) ?? (raw.name as string) ?? (state.name as string) ?? "unknown"
        
        // 查找 displayName（仅对 skill 工具）
        let displayName: string | undefined
        if (toolName === "skill" && input && typeof input.name === "string") {
          displayName = lookupDisplayName(skillData, input.name as string)
        }
        
        return {
          name: toolName,
          status: isCompleted ? ("done" as const) : isCancelled ? ("error" as const) : isError ? ("error" as const) : ("running" as const),
          input: input ?? undefined,
          output: hasOutput ? (state.output as string) : undefined,
          filePath: filePath || undefined,
          displayName,
        }
      })
  })

  // Non-task tool calls (for ToolCallGroupCard — task calls shown separately as subtask cards)

  // 用户通过 @ / / 激活的技能:后端在 createUserMessage 时为 user message 注入
  // type="tool" tool="skill" 的 part(source: "user")。assistantParts 不包含 user parts,
  // 需单独从 partStore[messageID] 取,合并到 skillToolCalls 前面展示。
  const userSkillToolCalls = createMemo((): ToolCallInfo[] => {
    const parts = (partStore?.[props.messageID] ?? []) as Array<Record<string, unknown>>
    const skillData = props.skillConfig?.skill
    return parts
      .filter((p) => p.type === "tool" && (p.tool as string | undefined) === "skill")
      .map((p) => {
        const state = (p.state as Record<string, unknown> | undefined) ?? {}
        const input = state.input as { name?: string } | undefined
        const displayName = input?.name
          ? lookupDisplayName(skillData, input.name)
          : undefined
        return {
          name: "skill",
          status: "done" as const,
          input: input ?? undefined,
          output: undefined,
          filePath: undefined,
          displayName,
        }
      })
  })

  const skillToolCalls = createMemo(() => [
    ...userSkillToolCalls(),
    ...toolCalls().filter((c) => c.name === "skill"),
  ])

  const otherToolCalls = createMemo(() =>
    toolCalls().filter((c) => c.name !== "skill" && !/task/i.test(c.name))
  )

  // ── NEW: subtask sessions (from Task tool calls) ──
  const subtasks = createMemo((): SubtaskInfo[] => {
    const parts = assistantParts()
    const tasks: SubtaskInfo[] = []
    for (const p of parts) {
      if (p.type !== "tool") continue
      const raw = p as Record<string, unknown>
      const state = raw.state as Record<string, unknown> | undefined
      if (!state) continue
      const input = state.input as Record<string, unknown> | undefined
      const toolName = raw.tool ?? raw.name ?? state.name
      if (typeof toolName !== "string" || !/task/i.test(toolName) || !input) continue

      const metadata = state.metadata as Record<string, unknown> | undefined
      const subSessionID = (metadata?.sessionId as string)
        ?? (typeof state.output === "string" ? (state.output as string).match(/task_id:\s*(\S+)/)?.[1] : undefined)

const stateStatus = state.status as string | undefined
      const stateError = state.error as string | undefined
      const outputStr = typeof state.output === "string" ? (state.output as string) : ""
      const hasOutput = outputStr.length > 0
      const isCancelled = stateStatus === "error" && (stateError === "Cancelled" || stateError === "Tool execution aborted")
      const isErrorFromStatus = stateStatus === "error" && !isCancelled
      const isErrorFromMetadata = metadata?.exit !== undefined && (metadata.exit as number) !== 0
      const isError = isErrorFromStatus || isErrorFromMetadata

      const textParts: string[] = []
      const artifactOutputs: Array<{ identifier: string; title: string; content: string }> = []

      if (!subSessionID) {
        // Degraded: subSessionID missing — still show as subtask card
        const parsed = parseAllArtifactsFromText(outputStr)
        for (const a of parsed) {
          artifactOutputs.push({ identifier: a.artifactIdentifier ?? "", title: a.title, content: a.content })
        }
        if (artifactOutputs.length === 0
            && /<(?:div|section|style|nav|header|main|article|form|table|html)\b/i.test(outputStr)) {
          artifactOutputs.push({ identifier: "degraded", title: "HTML 片段", content: outputStr })
        }
        tasks.push({
          taskDescription: (input.description as string) ?? (input.prompt as string)?.slice(0, 60) ?? "子任务",
          subSessionID: "",
          status: isCancelled ? "cancelled" : isError ? "error" : hasOutput ? "done" : "running",
          textParts: [],
          artifactOutputs,
          completedAt: getToolEndTime(state),
        })
        continue
      }

      // Parse <task_result> content from Task tool output
      const taskResultMatch = outputStr.match(/<task_result>([\s\S]*?)<\/task_result>/)
      const resultContent = taskResultMatch?.[1]?.trim() ?? ""

      if (resultContent.length > 0) {
        const parsedArtifacts = parseAllArtifactsFromText(resultContent)
        for (const a of parsedArtifacts) {
          artifactOutputs.push({ identifier: a.artifactIdentifier ?? "", title: a.title, content: a.content })
        }
        if (artifactOutputs.length === 0 && /<(?:div|section|style|nav|header|footer|main|article|form|table)\b/i.test(resultContent)) {
          artifactOutputs.push({ identifier: "raw-fragment", title: "HTML 片段", content: resultContent })
        }
        const proseOnly = resultContent.replace(/<artifact[\s\S]*?<\/artifact>/gi, "").trim()
        if (proseOnly.length > 0) textParts.push(proseOnly.length > 500 ? proseOnly.slice(0, 500) + "…" : proseOnly)
      }

      // Also try loading sub-session data from store as supplement
      const subMessages = msgStore?.[subSessionID] ?? []
      for (const msg of subMessages) {
        if (msg.role !== "assistant") continue
        const subParts = partStore?.[msg.id] ?? []
        for (const sp of subParts) {
          const spRaw = sp as Record<string, unknown>
          if (spRaw.type === "text" && typeof spRaw.text === "string" && spRaw.text.trim().length > 0) {
            const extra = parseAllArtifactsFromText(spRaw.text)
            for (const a of extra) {
              if (!artifactOutputs.some((e) => e.identifier === (a.artifactIdentifier ?? ""))) {
                artifactOutputs.push({ identifier: a.artifactIdentifier ?? "", title: a.title, content: a.content })
              }
            }
          }
          if (spRaw.type === "tool") {
            const spState = spRaw.state as Record<string, unknown> | undefined
            const spInputData = spState?.input as Record<string, unknown> | undefined
            if (spInputData) {
              const content = (spInputData.content ?? spInputData.newString) as string | undefined
              if (content && content.length > 20 && /<html|<!doctype|<artifact/i.test(content)) {
                const parsed = parseAllArtifactsFromText(content)
                if (parsed.length > 0) {
                  for (const a of parsed) {
                    if (!artifactOutputs.some((e) => e.identifier === (a.artifactIdentifier ?? ""))) {
                      artifactOutputs.push({ identifier: a.artifactIdentifier ?? "", title: a.title, content: a.content })
                    }
                  }
                } else if (/<html|<!doctype/i.test(content)) {
                  const filePath = (spInputData.filePath ?? spInputData.path ?? "") as string
                  const id = filePath.split(/[/\\]/).pop()?.replace(/\.html?$/i, "") ?? "component"
                  if (!artifactOutputs.some((e) => e.identifier === id)) {
                    artifactOutputs.push({
                      identifier: id,
                      title: filePath.split(/[/\\]/).pop()?.replace(/\.html?$/i, "") ?? "HTML 片段",
                      content,
                    })
                  }
                }
              }
            }
          }
        }
      }

      tasks.push({
        taskDescription: (input.description as string) ?? (input.prompt as string)?.slice(0, 60) ?? "子任务",
        subSessionID,
        status: isCancelled ? "cancelled" : isError ? "error" : hasOutput ? "done" : "running",
        textParts,
        artifactOutputs,
        completedAt: getToolEndTime(state),
      })
    }
    return tasks
  })

  // ── NEW: prose text (stripped of artifacts, using parser for partial-tag safety) ──
  const proseText = createMemo(() => {
    const parts = assistantParts()
    const textPart = [...parts]
      .reverse()
      .find((p) => p.type === "text") as { type: "text"; text?: string } | undefined
    if (!textPart?.text) return ""
    const parser = createArtifactParser()
    let prose = ""
    for (const ev of parser.feed(textPart.text)) {
      if (ev.type === "text") prose += ev.delta
    }
    // Intentionally skip flush() — partial <artifact prefixes held in the buffer
    // should NOT be emitted as visible text (prevents flicker/duplication).
    return prose.trim()
  })

  // ── NEW: prose segments (split on <question-form> blocks) ──
  const proseSegments = createMemo(() => {
    const text = proseText()
    if (!text) return []
    return splitOnQuestionForms(text)
  })

  // ── NEW: detect if form already submitted (scan subsequent user messages for submit marker) ──
  const formSubmitted = createMemo(() => {
    const messages = msgStore?.[props.sessionID] ?? []
    const currentIndex = messages.findIndex((m) => m.id === props.messageID)
    if (currentIndex === -1) return false

    // Check subsequent messages (after current user message)
    const subsequentMessages = messages.slice(currentIndex + 1)
    for (const msg of subsequentMessages) {
      if (msg.role !== "user") continue
      const parts = partStore?.[msg.id] ?? []
      const textPart = parts.find((p) => p.type === "text")
      const text = textPart?.text ?? ""
      if (text.includes("[快速简报]") || text.includes("[form answers —")) {
        return true
      }
    }
    return false
  })

  // Notify parent when subtasks with valid session IDs appear
  createEffect(() => {
    for (const t of subtasks()) {
      if (t.subSessionID) props.onChildSession?.(t.subSessionID)
    }
  })

  // ── NEW: streaming artifacts (live preview during generation, multiple) ──
  const streamingArtifacts = createMemo((): OutputCard[] => {
    if (!showGenerating()) return []
    const parts = assistantParts()
    const textPart = [...parts]
      .reverse()
      .find((p) => p.type === "text") as { type: "text"; text?: string } | undefined
    if (!textPart?.text) return []

    const text = textPart.text
    const ts = props.status.type === "busy" ? new Date(0) : new Date()

    // Use regex scan to find ALL artifact headers (completed + in-progress)
    const headers = scanArtifactHeaders(text)
    if (headers.length === 0) return []

    // Also get completed artifacts with full content
    const completed = parseAllArtifactsFromText(text)
    const completedById = new Map(completed.map((a) => [a.artifactIdentifier, a]))

    return headers.map((h, i) => {
      const done = completedById.get(h.identifier)
      if (done) {
        return {
          ...done,
          id: `streaming-${props.messageID}-${i}`,
          createdAt: ts,
        }
      }
      // In-progress: show placeholder
      return {
        id: `streaming-partial-${props.messageID}-${i}`,
        title: h.title,
        type: h.type,
        content: "",
        artifactIdentifier: h.identifier,
        createdAt: ts,
      }
    })
  })

  // Stable flag: once artifact detected during generation, don't flicker back
  const [hasSeenCount, setHasSeenCount] = createSignal(0)
  const [lastSeenCards, setLastSeenCards] = createSignal<OutputCard[]>([])

  // 切换 session/message 时清空 local state。
  // <Show> 包裹的 InsightTurn 在 userMessages().length > 0 保持 truthy 时会被复用,
  // 不重置 local state 会导致 B session 的 streaming cards 泄漏到 A session 的视图。
  createEffect(on(() => [props.sessionID, props.messageID] as const, () => {
    setHasSeenCount(0)
    setLastSeenCards([])
  }, { defer: true }))

  // Track whether we've seen artifacts during streaming (effect, not memo)
  createEffect(() => {
    if (!showGenerating()) {
      setHasSeenCount(0)
      setLastSeenCards([])
      return
    }
    const cards = streamingArtifacts()
    if (cards.length > 0) {
      setHasSeenCount(cards.length)
      setLastSeenCards(cards)
    }
  })

  const stableStreamingCards = createMemo((): OutputCard[] => {
    if (!showGenerating()) return []
    const live = streamingArtifacts()
    if (live.length > 0) return live
    return hasSeenCount() > 0 ? lastSeenCards() : []
  })

  // ── NEW: produced files ──
  const producedFiles = createMemo(() => {
    const calls = toolCalls()
    return calls
      .filter((c) =>
        (c.name.toLowerCase().includes("write") || c.name.toLowerCase().includes("edit"))
        && c.filePath && c.status === "done"
      )
      .map((c) => ({ path: c.filePath!, name: c.filePath!.split(/[/\\]/).pop()! }))
      .filter((f, i, arr) => arr.findIndex((x) => x.path === f.path) === i)
  })

  // ── output cards (final, after generation, multiple) ──
  // 只有 <artifact> 标签才会生成卡片
  const outputCards = createMemo((): OutputCard[] => {
    if (isAborted()) return []
    
    const parts = assistantParts()
    if (parts.length === 0 && !showGenerating()) return []
    if (showGenerating()) return []

    function maybeRepair(card: OutputCard): OutputCard {
      if (card.type !== "html" || !isTruncatedHtml(card.content)) return card
      return { ...card, content: repairTruncatedHtml(card.content), truncated: true }
    }

    // 扫描所有 text part 找 artifact 标签
    const allTextParts = parts.filter((p) => p.type === "text") as Array<{ type: "text"; text?: string }>

    for (const textPart of [...allTextParts].reverse()) {
      if (typeof textPart.text !== "string") continue
      const text = textPart.text.trim()
      if (text.length === 0) continue
      const artifacts = parseAllArtifactsFromText(text)
      if (artifacts.length > 0) {
        const ts = getTextPartTime(textPart as Record<string, unknown>)
        return artifacts.map((a, i) => ({
          ...a,
          id: `card-${props.messageID}-artifact-${i}`,
          createdAt: new Date(ts),
        }))
      }
    }

    return []
  })

  // 自动保存 artifact 到磁盘（生成时立即触发，不等待用户点击）
  createEffect(() => {
    const cards = outputCards()
    if (!props.projectDir) return
    
    for (const card of cards) {
      if (card.filePath && card.filePath.includes(".octo/artifacts")) continue
      const key = card.id
      if (autoSavedArtifacts.has(key)) continue
      
      const saveable = ["html", "deck", "svg", "markdown-document", "markdown", "code-snippet"]
      if (!saveable.includes(card.type)) continue
      
      autoSavedArtifacts.add(key)
      
      autoSaveArtifact(props.sessionID, card, props.projectDir!).then(() => {
        props.onFilesRefresh?.()
      }).catch(err => {
        console.error("[InsightTurn] autoSave failed:", err, "card:", card.id)
      })
    }
  })

  return (
    <div class="octo-make-turn flex flex-col gap-4" style={{ "user-select": "text" }}>
      {/* 用户消息气泡（右侧对齐） */}
      <Show when={userText() || userAttachments().length > 0}>
        <div class="flex flex-col items-end gap-4 px-3">
          <Show when={userAttachments().length > 0}>
            <div class="flex flex-col items-end gap-4">
              <For each={userAttachments()}>
                {(att) => (
                  <Show
                    when={att.url && att.mime?.startsWith("image/")}
                    fallback={
                      <div
                        class="break-words flex items-center"
                        style={{
                          background: "rgba(0,0,0,0.05)",
                          padding: "8px 12px",
                          "border-radius": "8px",
                          color: "rgba(0,0,0,0.9)",
                          "font-size": "14px",
                          "line-height": "22px",
                          gap: "6px",
                          display: "inline-flex",
                          "max-width": "200px",
                        }}
                      >
                        {getFileIcon(kindFromMime(att.mime ?? "application/octet-stream"), att.filename)({ size: 24 })}
                        <span class="truncate">{att.filename}</span>
                      </div>
                    }
                  >
                    <div style={{ width: "80px", height: "80px", "border-radius": "8px", overflow: "hidden", "flex-shrink": "0", "background-color": "rgba(0,0,0,0.05)" }}>
                      <img
                        src={att.url}
                        alt={att.filename}
                        style={{ width: "100%", height: "100%", "object-fit": "cover" }}
                      />
                    </div>
                  </Show>
                )}
              </For>
            </div>
          </Show>
          <Show when={userText()}>
            <ExpandableBubble
              class="break-words"
              style={{
                background: "var(--octo-brand-a8)",
                padding: "12px 16px",
                "border-radius": "16px 16px 2px 16px",
                color: "#191919",
                "font-size": "14px",
                "line-height": "22px",
                "white-space": "pre-wrap",
                display: "inline-block",
                "max-width": "85%",
              }}
            >
              {renderMentionText(userText())}
            </ExpandableBubble>
          </Show>
        </div>
      </Show>

      {/* 思考过程 */}
      <Show when={reasoningTexts().length > 0}>
        <Show when={showGenerating()} fallback={
          <div class="mx-3">
            <ReasoningCollapsed
              texts={reasoningTexts()}
              duration={reasoningDuration()}
            />
          </div>
        }>
          <div class="mx-3" style={{ "padding-left": "12px", "border-left": "1px solid rgba(0,0,0,0.08)" }}>
            <div
              class="overflow-auto"
              style={{
                color: "#777",
                "font-size": "12px",
                "line-height": "18px",
                "max-height": "300px",
              }}
            >
              <For each={reasoningTexts()}>
                {(text, i) => (
                  <>
                    <Show when={i() > 0}>
                      <div class="my-1.5" style={{ "border-top": "1px dashed rgba(0,0,0,0.08)" }} />
                    </Show>
                    <div class="whitespace-pre-wrap" style={{ "user-select": "text" }}>{text}</div>
                  </>
                )}
              </For>
            </div>
          </div>
        </Show>
      </Show>

      {/* AI 文字回复（proseText 已剥离 artifact 内容，使用 segments 渲染） */}
      <Show when={proseSegments().length > 0}>
        <div
          class="px-4"
          style={{ color: "#191919", "font-size": "14px", "line-height": "22px", "user-select": "text" }}
        >
          <For each={proseSegments()}>
            {(seg) => {
              if (seg.kind === "text") {
                if (seg.text.trim().length === 0) return null
                return (
                  <Markdown
                    text={seg.text}
                    onOpenLocalFile={props.onOpenLocalFile}
                    projectDir={props.projectDir}
                  />
                )
              }
              if (seg.kind === "form") {
                return (
                  <QuickBriefFormView
                    form={seg.form}
                    interactive={!props.active && props.status.type !== "busy"}
                    submitted={formSubmitted()}
                    onSubmit={props.onFormSubmit}
                  />
                )
              }
            }}
          </For>
        </div>
      </Show>

      {/* 工具调用区域 */}
      <Show when={skillToolCalls().length > 0 || otherToolCalls().length > 0 || subtasks().length > 0}>
        <div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
        {/* 技能调用（单独显示在最前面） */}
        <Show when={skillToolCalls().length > 0}>
          <ToolCallGroupCard calls={skillToolCalls()} />
        </Show>

        {/* 其他工具调用 */}
        <Show when={otherToolCalls().length > 0}>
          <ToolCallGroupCard calls={otherToolCalls()} />
        </Show>

        {/* 子任务进度（Task tool 调用的子 agent 会话） */}
        <For each={subtasks()}>
          {(task) => {
          // Initialize expand state if not exists (defaults to true = expanded)
          if (subtaskExpandState[task.subSessionID] === undefined) {
            setSubtaskExpandState(task.subSessionID, true)
          }
          const expanded = () => subtaskExpandState[task.subSessionID] ?? true
          const hasContent = task.textParts.length > 0 || task.artifactOutputs.length > 0
          return (
            <div class="mx-3" style={{ "border-radius": "8px", border: "1px solid rgba(0,0,0,0.1)", background: "var(--octo-surface-page)" }}>
              {/* Header */}
              <button
                type="button"
                onClick={() => setSubtaskExpandState(task.subSessionID, !expanded())}
                class="w-full px-2.5 py-1.5 flex items-center gap-2 text-xs text-left"
                style={{ background: "transparent" }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
                  style={{ transform: expanded() ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s", color: "var(--octo-text-disabled)" }}>
                  <path d="M4 2l4 4-4 4" stroke="currentColor" stroke-width="1.5" fill="none" />
                </svg>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ color: "var(--octo-brand, #3b82f6)" }}>
                  <path d="M2 3h10M2 7h10M2 11h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                </svg>
                <span class="truncate flex-1 min-w-0" style={{ color: "var(--octo-text-primary)", "font-weight": 500 }}>{task.taskDescription}</span>
                <Show when={task.status === "running"}>
                  <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium" style={{ background: "rgba(59,130,246,0.1)", color: "#3b82f6" }}>
                    <span class="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#3b82f6" }} />
                    运行中
                  </span>
                </Show>
                <Show when={task.status === "done"}>
                  <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium" style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e" }}>
                    完成
                  </span>
                </Show>
                <Show when={task.status === "cancelled"}>
                  <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium" style={{ background: "rgba(156,163,175,0.1)", color: "#6b7280" }}>
                    已中止
                  </span>
                </Show>
                <Show when={task.status === "error"}>
                  <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium" style={{ background: "rgba(0,0,0,0.05)", color: "rgba(0,0,0,0.6)" }}>
                    错误
                  </span>
                </Show>
                <Show when={task.artifactOutputs.length > 0}>
                  <span class="text-[11px]" style={{ color: "var(--octo-text-disabled)" }}>
                    {task.artifactOutputs.length} 输出
                  </span>
                </Show>
              </button>
              {/* Expandable content */}
              <Show when={expanded() && hasContent}>
                <div style={{ "border-top": "1px solid var(--octo-border-default)" }}>
                  {/* Sub-agent text responses */}
                  <Show when={task.textParts.length > 0}>
                    <div class="px-2.5 py-1.5 text-xs leading-relaxed max-h-[120px] overflow-auto" style={{ color: "var(--octo-text-secondary)", "user-select": "text" }}>
                      <For each={task.textParts}>
                        {(text) => <div class="mb-1 whitespace-pre-wrap">{text}</div>}
                      </For>
                    </div>
                  </Show>
                  {/* Artifact outputs — clickable preview cards */}
                  <Show when={task.artifactOutputs.length > 0}>
                    <div class="px-2.5 py-1.5 flex flex-col gap-1.5" style={{ "border-top": task.textParts.length > 0 ? "1px solid var(--octo-border-default)" : "none" }}>
                      <div class="text-[10px] mb-1" style={{ color: "var(--octo-text-disabled)" }}>输出结果</div>
                      <For each={task.artifactOutputs}>
                        {(artifact) => {
                          const outputCard: OutputCard = {
                            id: "subtask-" + task.subSessionID + "-" + artifact.identifier,
                            title: artifact.title,
                            type: "html",
                            content: artifact.content,
                            artifactIdentifier: artifact.identifier || undefined,
                            createdAt: new Date(task.completedAt ?? Date.now()),
                          }
                          return (
                            <button
                              type="button"
                              onClick={() => props.onOpenResult(outputCard)}
                              class="px-2 py-1.5 rounded text-xs text-left w-full transition-all"
                              style={{ background: "var(--octo-brand-a3)", "border-radius": "8px", border: "1px solid var(--octo-brand-a8)", color: "var(--octo-text-primary)" }}
                              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--octo-brand)" }}
                              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--octo-brand-a8)" }}
                            >
                              <div class="flex" style={{ gap: "12px" }}>
                                <span class="flex-shrink-0 flex items-center">
                                  <img src={cardTypeIconSrc("html")} width={28} height={28} alt="" />
                                </span>
                                <div class="flex flex-col min-w-0 flex-1">
                                  <span class="font-medium truncate" style={{ "font-size": "12px", "line-height": "22px", color: "rgb(25,25,25)" }}>{artifact.title}</span>
                                  <div class="text-xs truncate" style={{ color: "rgb(25,25,25)", "line-height": "22px" }}>
                                    {artifact.content.replace(/<[^>]+>/g, "").slice(0, 80)}{artifact.content.length > 80 ? "…" : ""}
                                  </div>
                                </div>
                              </div>
                            </button>
                          )
                        }}
                      </For>
                    </div>
                  </Show>
                </div>
              </Show>
            </div>
          )
        }}
      </For>

      {/* 文件操作摘要（生成完成后） */}
      <Show when={!showGenerating() && otherToolCalls().length > 0}>
        <div>
          <FileOpsSummary calls={otherToolCalls()} />
        </div>
      </Show>

      {/* 产出文件列表 */}
      <Show when={!showGenerating() && producedFiles().length > 0}>
        <ProducedFilesList files={producedFiles()} />
      </Show>
        </div>
      </Show>

      {/* 错误提示 */}
      <Show when={assistantError()}>
        <div
          class="mx-3 px-4 py-3 text-xs leading-relaxed"
          style={{
            "border-radius": "8px",
            background: "rgba(254, 231, 232, 1)",
            color: "#191919",
          }}
        >
          <div class="flex items-center gap-2 mb-1 font-size-[14px]">
            <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 14 14" width="14.000000" height="14.000000" fill="none">
              <rect id="高危_面性_镂空" width="14.000000" height="14.000000" x="0.000000" y="0.000000"/>
              <path id="path" d="M0.319885 10.3644L5.32281 1.69897C5.42523 1.52173 5.5484 1.36713 5.69232 1.23517C5.80209 1.13458 5.92392 1.04714 6.0578 0.972961C6.19095 0.899151 6.3288 0.842205 6.47137 0.802124C6.64093 0.754517 6.81708 0.730713 6.99994 0.730713C7.33673 0.730713 7.65082 0.811462 7.9422 0.972961C8.25165 1.14453 8.49664 1.38654 8.67706 1.69897L13.68 10.3644C13.8604 10.6768 13.9474 11.01 13.9413 11.3638C13.9355 11.6969 13.8483 12.0093 13.68 12.3009C13.5117 12.5925 13.2846 12.8242 12.9991 12.9957C12.8679 13.0746 12.7313 13.1364 12.5893 13.1812C12.4031 13.2398 12.2076 13.2692 12.0029 13.2692L1.99701 13.2692C1.79233 13.2692 1.59695 13.2398 1.41083 13.1812C1.26898 13.1365 1.13199 13.0745 1.00079 12.9957C0.715271 12.8242 0.48822 12.5925 0.319885 12.3009C0.15155 12.0093 0.0643921 11.6969 0.0586548 11.3638C0.0524292 11.01 0.139465 10.6768 0.319885 10.3644ZM6.99994 3.80017C7.27997 3.80017 7.49994 4.02014 7.49994 4.30017L7.49994 8.38342C7.49994 8.66342 7.27997 8.88342 6.99994 8.88342C6.71991 8.88342 6.49994 8.66342 6.49994 8.38342L6.49994 4.30017C6.49994 4.02014 6.71991 3.80017 6.99994 3.80017ZM6.41656 10.0461C6.41656 9.72397 6.6778 9.46277 6.99994 9.46277C7.32208 9.46277 7.58331 9.72397 7.58331 10.0461C7.58331 10.3683 7.32208 10.6295 6.99994 10.6295C6.6778 10.6295 6.41656 10.3683 6.41656 10.0461Z" fill="rgb(224,33,40)" fill-rule="evenodd"/>
            </svg>
            {assistantError()!.name === "ProviderAuthError"
              ? "认证失败"
              : assistantError()!.name === "ContextOverflowError"
                ? "当前对话上下文已达上限"
                : "生成出错"}
          </div>
          <Show when={assistantError()!.message}>
            <div style={{ "user-select": "text",  "padding-left": "22px"}}>{assistantError()!.message}</div>
          </Show>
        </div>
      </Show>

      {/* 输出卡片（生成完成后，支持多个） */}
      <For each={outputCards()}>
        {(capturedCard) => (
          <div
            title={capturedCard.type === "link" ? capturedCard.content : undefined}
            style={{
              "border-radius": "12px",
              padding: "16px 20px",
              "margin-left": "12px",
              "margin-right": "12px",
              background: "linear-gradient(90deg, rgba(245,248,255,1) 0%, rgba(255,255,255,1) 50%)",
              border: capturedCard.truncated ? "1px solid rgba(234,179,8,0.3)" : "1px solid rgba(0,0,0,0.1)",
            }}
          >
            <button
              type="button"
              onClick={() => props.onOpenResult(capturedCard)}
              class="w-full text-left transition-all"
              style={{ background: "transparent" }}
            >
              <div class="flex items-center" style={{ gap: "12px" }}>
                <span class="flex-shrink-0 flex items-center">
                  <img src={cardTypeIconSrc(capturedCard.type)} width={28} height={28} alt="" />
                </span>
                <div class="flex flex-col min-w-0 flex-1" style={{ gap: "0" }}>
                  <span class="truncate" style={{ color: "rgb(25,25,25)", "font-size": "14px", "line-height": "22px", "font-weight": 500 }}>{capturedCard.title}</span>
                  <span style={{ color: "#777", "font-size": "12px", "line-height": "22px" }}>{formatTime(capturedCard.createdAt)}</span>
                </div>
              </div>
            </button>
          </div>
        )}
      </For>

      {/* 中断提示 — 始终在最底部 */}
      <Show when={isAborted()}>
        <div data-slot="session-turn-compaction">
          <MessageDivider label={i18n.t("ui.message.interrupted")} />
        </div>
      </Show>

      {/* hover 显示的 turn 元信息（agent · model · 耗时 · 中断）— 仿 Insight 页 */}
      <Show when={turnMeta()}>
        <div class="octo-make-turn-meta-wrapper">
          <span class="octo-make-turn-meta">{turnMeta()}</span>
        </div>
      </Show>

      {/* 生成中状态指示 */}
      <Show when={showGenerating()}>
        <WaitingPill
          parts={assistantParts()}
          partStore={partStore}
          messageID={latestAssistantMessageID()}
          sessionID={props.sessionID}
          deltaLog={props.deltaLog ?? []}
          msgStore={msgStore}
          subtasks={subtasks()}
        />
      </Show>

      {/* 生成中的 artifact 卡片（带进度指示，支持多个）— 始终在底部 */}
      <For each={stableStreamingCards()}>
        {(genCard) => {
          const isPartial = genCard.content.length === 0
          return (
            <div
              title={genCard.type === "link" ? genCard.content : undefined}
              style={{
                "border-radius": "12px",
                padding: "16px 20px",
                "margin-left": "12px",
                "margin-right": "12px",
                background: "linear-gradient(90deg, rgba(245,248,255,1) 0%, rgba(255,255,255,1) 50%)",
                border: "1px dashed var(--octo-brand-a25)",
              }}
            >
              <div class="flex items-center" style={{ gap: "12px" }}>
                <span class="flex-shrink-0 flex items-center">
                  <img src={cardTypeIconSrc(genCard.type)} width={28} height={28} alt="" />
                </span>
                <div class="flex flex-col min-w-0 flex-1" style={{ gap: "0" }}>
                  <span class="truncate" style={{ color: "rgb(25,25,25)", "font-size": "14px", "line-height": "22px", "font-weight": 500 }}>{genCard.title}</span>
                  <span style={{ color: "#777", "font-size": "12px", "line-height": "22px" }}>
                    {isPartial ? "等待内容…" : "生成中…"}
                  </span>
                </div>
                <span
                  class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium"
                  style={{ background: "rgba(59,130,246,0.1)", color: "#3b82f6" }}
                >
                  <span class="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#3b82f6" }} />
                  {isPartial ? "排队中" : "生成中"}
                </span>
              </div>
            </div>
          )
        }}
      </For>

      {/* 已执行时间 — 仅在最新 turn 有生成中卡片时显示 */}
      <Show when={showGenerating() && stableStreamingCards().length > 0 && props.elapsedText}>
        <div class="mx-3">
          <span class="text-xs tabular-nums" style={{ color: "#6e737a" }}>
            已执行 {props.elapsedText}
          </span>
        </div>
      </Show>

      {/* 阻塞提示 — 渐进式显示（question 状态时不显示） */}
      <Show when={showGenerating() && props.blockTime && props.blockTime >= 60 && !props.hasQuestionRequest}>
        {(() => {
          const bt = props.blockTime!
          const isWarning = bt >= 180
          return (
            <div class="mx-3 px-4 py-2 flex items-center justify-between" style={{
              "border-radius": "var(--octo-radius-md)",
              border: isWarning ? "1px solid rgba(255, 177, 46, 0.3)" : "1px solid rgba(200, 200, 200, 0.2)",
              background: isWarning ? "rgba(255, 177, 46, 0.08)" : "rgba(200, 200, 200, 0.05)",
            }}>
              <span class="text-sm" style={{ color: isWarning ? "#b34700" : "#6e737a" }}>
                {isWarning
                  ? `模型超过 ${formatBlockTime(bt)} 没有响应，建议重新请求`
                  : "模型响应较慢，请耐心等待..."
                }
              </span>
              <Show when={isWarning && props.onAbort}>
                <Button
                  variant="secondary"
                  size="small"
                  onClick={props.onAbort}
                  class="text-sm"
                >
                  中止对话
                </Button>
              </Show>
            </div>
          )
        })()}
      </Show>
    </div>
  )
}
