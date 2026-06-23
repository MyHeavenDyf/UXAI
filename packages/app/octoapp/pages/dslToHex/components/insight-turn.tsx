import type { AssistantMessage, Message } from "@opencode-ai/sdk/v2/client"
import type { SessionStatus } from "@opencode-ai/sdk/v2"
import { useData } from "@opencode-ai/ui/context"
import { useSync } from "@/context/sync"
import { Markdown } from "@opencode-ai/ui/markdown"
import { Button } from "@opencode-ai/ui/button"
import { Spinner } from "@opencode-ai/ui/spinner"
import { createEffect, createMemo, createSignal, Show, For, type JSX } from "solid-js"
import { createStore } from "solid-js/store"

function _debugLog(...args: unknown[]) {
  console.log("[InsightTurn]", ...args)
}
import { IconCardTable, IconCardMindmap, IconCardJson, IconCardFile, IconCardMarkdown, IconCardHtml, IconCardDeck, IconCardSvg, IconCardReact, IconCardDiagram } from "../icons"
import { createArtifactParser, isTruncatedHtml, repairTruncatedHtml } from "../utils/artifact-parser"
import { splitOnQuestionForms, type FormSegment, type QuestionForm } from "../utils/question-form"
import { QuickBriefFormView } from "./quick-brief-form"
import './quick-brief-form.css'

import { ToolCallGroupCard, type ToolCallInfo } from "./tool-call-card"
import { FileOpsSummary } from "./file-ops-summary"

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

export type ArtifactExportKind = "html" | "pdf" | "zip" | "pptx" | "svg" | "md" | "txt" | "json" | "csv"

export type OutputCard = {
  id: string
  title: string
  type: OutputCardType
  content: string
  filePath?: string
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

function detectCard(text: string): { type: OutputCardType; title: string } | null {
  const heading = (t: string) => t.match(/^#{1,3}\s+(.+)/m)?.[1]?.trim()

  if (/```tsx\b/i.test(text) || /```jsx\b/i.test(text) || /^import\s+React/i.test(text)) {
    return { type: "react-component", title: heading(text) ?? "React 组件" }
  }
  if (/```mermaid\b/i.test(text)) {
    return { type: "diagram", title: heading(text) ?? "流程图" }
  }
  if (/```html/i.test(text) || /<!DOCTYPE\s+html/i.test(text) || /<html[\s>]/i.test(text) || /<script[\s>]/i.test(text)) {
    if (/<div[^>]*class=["']slide["']/.test(text) || /\.slide\b/.test(text)) {
      return { type: "deck", title: heading(text) ?? "幻灯片" }
    }
    return { type: "html", title: heading(text) ?? "HTML 原型" }
  }
  if (/<svg[\s>]/i.test(text) || /```svg\b/i.test(text)) {
    return { type: "svg", title: heading(text) ?? "SVG 图形" }
  }
  if (isMarkdownTable(text)) {
    return { type: "table", title: heading(text) ?? "分析结果" }
  }
  if (/```json/i.test(text)) {
    return { type: "json", title: heading(text) ?? "JSON 数据" }
  }
  if (/```(tsx?|jsx?|python|css|yaml|toml|rust|go|java|sh|bash)\b/i.test(text)) {
    return { type: "code-snippet", title: heading(text) ?? "代码片段" }
  }
  if (text.trim().length > 200) {
    return { type: "markdown", title: heading(text) ?? "分析报告" }
  }
  return null
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
  if (!text.includes("<artifact")) return []
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
        if (!mappedType) return
        const explicitExports = startEvent.exports
          ? startEvent.exports.split(",").map((s) => s.trim() as ArtifactExportKind)
          : undefined
        results.push({
          title: startEvent.title || mappedType,
          type: mappedType,
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
    for (const ev of parser.flush()) handleEvent(ev)
  } catch {
    // ignore parse errors
  }
  return results
}

/** Quick regex scan for all artifact open tags (completed + in-progress) for streaming placeholders */
function scanArtifactHeaders(text: string): Array<{ identifier: string; title: string; type: OutputCardType }> {
  if (!text.includes("<artifact")) return []
  const results: Array<{ identifier: string; title: string; type: OutputCardType }> = []
  const re = /<artifact\s+([^>]*)>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const attrs = m[1]
    const identifier = attrs.match(/identifier="([^"]*)"/)?.[1] ?? ""
    const artifactType = attrs.match(/type="([^"]*)"/)?.[1] ?? "text/html"
    const title = attrs.match(/title="([^"]*)"/)?.[1] ?? ""
    const mappedType = ARTIFACT_TYPE_MAP[artifactType]
    if (mappedType) {
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

function DslJsonCard(props: { rawText: string; expanded: boolean; onToggle: () => void; isStreaming?: boolean }): JSX.Element {
  const nodeCount = createMemo(() => {
    try {
      const obj = JSON.parse(props.rawText)
      if (Array.isArray(obj)) return obj.length
      if (obj.children) {
        let count = 1
        function walk(nodes: unknown[]) { for (const n of nodes) { count++; if ((n as Record<string, unknown>).children) walk((n as Record<string, unknown>).children as unknown[]) } }
        walk(obj.children as unknown[])
        return count
      }
      return 1
    } catch {
      return null
    }
  })
  const summary = createMemo(() => {
    const n = nodeCount()
    if (props.isStreaming) return n !== null ? `DSL JSON · ${n} 个节点 · 生成中…` : "DSL JSON · 生成中…"
    if (n !== null) return `DSL JSON · ${n} 个节点`
    return "DSL JSON"
  })
  return (
    <div
      class="mx-3 mb-2"
      style={{
        "border-radius": "8px",
        border: "1px solid rgba(0,0,0,0.1)",
        background: "#f7f8fa",
      }}
    >
      <button
        type="button"
        class="w-full flex items-center gap-2 px-3 py-2 text-left"
        style={{ background: "transparent" }}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); props.onToggle() }}
      >
        <Show when={props.isStreaming}>
          <div class="shrink-0 flex items-center gap-1.5">
            <Spinner class="size-3.5" />
          </div>
        </Show>
        <Show when={!props.isStreaming}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
            style={{ transform: props.expanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s", color: "#777" }}>
            <path d="M4 2l4 4-4 4" stroke="currentColor" stroke-width="1.5" fill="none" />
          </svg>
        </Show>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ color: "#3478F6" }}>
          <rect x="1" y="1" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1" />
          <rect x="8" y="1" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1" />
          <rect x="1" y="8" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1" />
          <rect x="8" y="8" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1" />
        </svg>
        <span style={{ "font-size": "12px", "font-weight": 500, color: "#191919" }}>{summary()}</span>
      </button>
      <Show when={props.expanded}>
        <div
          style={{
            "max-height": "240px",
            overflow: "auto",
            "font-size": "11px",
            "font-family": "'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace",
            color: "#555",
            padding: "0 12px 8px",
            "border-top": "1px solid rgba(0,0,0,0.06)",
            "margin-top": "0",
            "line-height": "16px",
          }}
        >
          <pre class="whitespace-pre-wrap word-break-word" style={{ margin: "0" }}>{props.rawText}</pre>
        </div>
      </Show>
    </div>
  )
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return true
  const mdMatch = trimmed.match(/```(?:json)?\s*[\s\S]*?```/)
  if (mdMatch) return true
  try { JSON.parse(trimmed); return true } catch { return false }
}

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
      if (entry.delta.includes("<artifact")) {
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
      class="mx-3 mb-2"
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
    <div class="mx-3 mb-2">
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
    <div style={{ width: "100%", "margin-bottom": "8px" }}>
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
            "margin-top": "20px",
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
  onContinue?: (card: OutputCard) => void
  onChildSession?: (subSessionID: string) => void
  deltaLog?: DeltaLogEntry[]
  onFormSubmit?: (text: string) => void
  dslJsonOverride?: string
  dslJsonIsStreaming?: boolean
}): JSX.Element {
  const data = useData()
  const sync = useSync()
  const partStore = sync.data.part as Record<string, { type: string; text?: string }[]>
  const msgStore = sync.data.message as Record<string, Message[]>

  // Lifted expand state for subtasks (persists across re-renders)
  const [subtaskExpandState, setSubtaskExpandState] = createStore<Record<string, boolean>>({})
  const [dslJsonExpanded, setDslJsonExpanded] = createSignal(false)

  const userText = createMemo(() => {
    const parts = partStore?.[props.messageID] ?? []
    const textPart = parts.find((p) => p.type === "text")
    if (!textPart?.text) return ""
    const raw = textPart.text
    const sepIdx = raw.lastIndexOf("\n---\n")
    if (sepIdx !== -1) return raw.slice(sepIdx + 5).trim()
    return raw.trim()
  })

  const userAttachments = createMemo(() => {
    const parts = partStore?.[props.messageID] ?? []
    return parts.filter((p) => p.type === "file") as Array<{ type: "file"; mime?: string; filename?: string; url?: string }>
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
    _debugLog("assistantMsgs:", { sessionID: props.sessionID, userMsgIdx: idx, total: messages.length, found: result.length, ids: result.map(m => m.id) })
    return result
  })

  const assistantParts = createMemo(() => {
    const msgs = assistantMsgs()
    if (msgs.length === 0) return []
    const allParts: { type: string; text?: string }[] = []
    for (const msg of msgs) {
      const parts = partStore?.[msg.id] ?? []
      _debugLog("assistantParts:", { msgID: msg.id, partsCount: parts.length, types: parts.map(p => p.type) })
      allParts.push(...parts)
    }
    _debugLog("assistantParts total:", allParts.length)
    return allParts
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
    const lastUser = [...messages].reverse().find((m) => m.role === "user")
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

  // ── NEW: tool calls ──
  const toolCalls = createMemo((): ToolCallInfo[] => {
    const parts = assistantParts()
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
        return {
          name: (raw.tool as string) ?? (raw.name as string) ?? (state.name as string) ?? "unknown",
          status: isCompleted ? ("done" as const) : isCancelled ? ("error" as const) : isError ? ("error" as const) : ("running" as const),
          input: input ?? undefined,
          output: hasOutput ? (state.output as string) : undefined,
          filePath: filePath || undefined,
        }
      })
  })

  // Non-task tool calls (for ToolCallGroupCard — task calls shown separately as subtask cards)
  const nonTaskToolCalls = createMemo(() =>
    toolCalls().filter((c) => !/task/i.test(c.name))
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
        const proseOnly = resultContent.replace(/<artifact[\s\S]*?<\/artifact>/g, "").trim()
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
  const outputCards = createMemo((): OutputCard[] => {
    const parts = assistantParts()
    if (parts.length === 0 && !showGenerating()) return []
    if (showGenerating()) return []

    function maybeRepair(card: OutputCard): OutputCard {
      if (card.type !== "html" || !isTruncatedHtml(card.content)) return card
      return { ...card, content: repairTruncatedHtml(card.content), truncated: true }
    }

    // ── 优先级 1：write / edit tool（HTML 文件写入或编辑） ──
    for (const p of [...parts].reverse()) {
      if (p.type !== "tool") continue
      const state = (p as Record<string, unknown>).state as Record<string, unknown> | undefined
      if (!state) continue

      const toolTs = getToolEndTime(state)

      // attachments
      const attachments = state.attachments as Array<{ mime?: string; url?: string; filename?: string }> | undefined
      if (attachments) {
        for (const att of attachments) {
          if (att.mime === "text/html" && att.url) {
            const html = decodeDataUrl(att.url)
            if (html.length > 10) {
              return [maybeRepair({
                id: `card-${props.messageID}-html`,
                title: att.filename?.replace(/\.html?$/i, "") ?? "HTML 原型",
                type: "html",
                content: html,
                createdAt: new Date(toolTs),
              })]
            }
          }
        }
      }

      // input (write/edit tool — 检测 HTML 文件)
      const input = state.input as Record<string, unknown> | undefined
      if (input) {
        // write tool uses `content`, edit tool uses `newString`
        const content = (input.content ?? input.newString ?? input.text ?? input.data) as string | undefined
        const filePath = (input.path ?? input.filepath ?? input.filePath ?? "") as string
        if (content && content.length > 10) {
          const artifacts = parseAllArtifactsFromText(content)
          if (artifacts.length > 0) {
            return artifacts.map((a, i) => ({
              ...a,
              id: `card-${props.messageID}-artifact-${i}`,
              filePath: filePath || undefined,
              createdAt: new Date(toolTs),
            }))
          }

          if (/```html/i.test(content) || /<!DOCTYPE\s+html/i.test(content) || /<html[\s>]/i.test(content) || /\.html?$/i.test(filePath)) {
            return [maybeRepair({
              id: `card-${props.messageID}-html`,
              title: content.match(/^#{1,3}\s+(.+)/m)?.[1]?.trim() ?? filePath.split(/[/\\]/).pop()?.replace(/\.html?$/i, "") ?? "HTML 原型",
              type: "html",
              content,
              filePath: filePath || undefined,
              createdAt: new Date(toolTs),
            })]
          }
        }
      }
    }

    // ── 优先级 2：text parts（含 artifact 标签，支持多个） ──
    // 多条 assistant 消息时，HTML artifact 可能不在最后一个 text part，
    // 所以要先扫描所有 text part 找 artifact 标签
    const allTextParts = parts.filter((p) => p.type === "text") as Array<{ type: "text"; text?: string }>

    // 优先从所有 text part 中找 artifact 标签（按 reverse 顺序，最近的优先）
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

// 没有 artifact 标签，fallback 到最后一个 text part 用 detectCard 检测
    const lastTextPart = allTextParts[allTextParts.length - 1]
    if (lastTextPart && typeof lastTextPart.text === "string") {
      const text = lastTextPart.text.trim()
      if (text.length > 0) {
        const ts = getTextPartTime(lastTextPart as Record<string, unknown>)
        const info = detectCard(text)
        // if (info) return [{ id: `card-${props.messageID}`, ...info, content: lastTextPart.text, createdAt: new Date(ts) }]

        // Before falling back to markdown, check if subtask artifacts exist for assembly
        const stForText = subtasks()
        const subArtForText = stForText.flatMap((t) => t.artifactOutputs)
        // if (subArtForText.length === 0) {
        //   return [{
        //     id: `card-${props.messageID}-text`,
        //     title: text.match(/^#{1,3}\s+(.+)/m)?.[1]?.trim() ?? text.split("\n")[0]?.slice(0, 40) ?? "AI 产出",
        //     type: "markdown",
        //     content: lastTextPart.text,
        //     createdAt: new Date(ts),
        //   }]
        // }
      }
    }

    // ── 优先级 3：任何 tool output（聚合所有 tool 输出） ──
    const allToolOutput: string[] = []
    let latestToolTs = 0
    for (const p of parts) {
      if (p.type !== "tool") continue
      const state = (p as Record<string, unknown>).state as Record<string, unknown> | undefined
      if (!state) continue
      const output = state.output as string | undefined
      if (output && output.trim().length > 0 && output.trim() !== "No files found") allToolOutput.push(output.trim())
      const ts = getToolEndTime(state)
      if (ts > latestToolTs) latestToolTs = ts
    }
    if (allToolOutput.length > 0) {
      // When subtasks have artifact outputs, skip priority 3 entirely —
      // priority 4 will assemble them into a complete page.
      const stForTools = subtasks()
      const hasSubArtifacts = stForTools.some((t) => t.artifactOutputs.length > 0)
      if (!hasSubArtifacts) {
        const content = allToolOutput.join("\n\n")
        const ts = latestToolTs || Date.now()
        const artifacts = parseAllArtifactsFromText(content)
        if (artifacts.length > 0) {
          return artifacts.map((a, i) => ({
            ...a,
            id: `card-${props.messageID}-artifact-${i}`,
            createdAt: new Date(ts),
          }))
        }

        const info = detectCard(content)
        if (info) return [{ id: `card-${props.messageID}-tools`, ...info, content, createdAt: new Date(ts) }]

        return [{
          id: `card-${props.messageID}-tools-fallback`,
          title: content.split("\n")[0]?.slice(0, 40) ?? "工具产出",
          type: "markdown",
          content,
          createdAt: new Date(ts),
        }]
      }
    }

    // ── 优先级 4：子任务 artifact 自动组装 ──
    const st = subtasks()
    const subArtifacts = st.flatMap((t) => t.artifactOutputs)
    if (subArtifacts.length > 0) {
      const subtaskTs = st.reduce((max, t) => Math.max(max, t.completedAt ?? 0), 0) || Date.now()
      // Check if any subtask artifact is a full HTML document — use it directly
      const fullDoc = subArtifacts.find((a) => /<!DOCTYPE\s+html/i.test(a.content) || /<html[\s>]/i.test(a.content))
      if (fullDoc) {
        return [maybeRepair({
          id: `card-${props.messageID}-composed-from-subtask`,
          title: "完整页面（组装）",
          type: "html",
          content: fullDoc.content,
          artifactIdentifier: fullDoc.identifier + "-composed",
          createdAt: new Date(subtaskTs),
        })]
      }
      // Assemble HTML fragments into a full page
      const styles = subArtifacts.map((a) => {
        const matches = a.content.match(/<style[^>]*>([\s\S]*?)<\/style>/gi)
        return matches ? matches.map((m) => m.replace(/<\/?style[^>]*>/gi, "")).join("\n") : ""
      }).filter(Boolean).join("\n")
      const bodies = subArtifacts.map((a) =>
        a.content.replace(/<style[\s\S]*?<\/style>/gi, "").trim()
      ).filter(Boolean).join("\n")
      const assembled = `<!DOCTYPE html>
        <html lang="zh-CN">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>页面预览</title>
            <style>
            ${styles}
            </style>
          </head>
          <body>
            ${bodies}
          </body>
        </html>`
      return [maybeRepair({
        id: `card-${props.messageID}-composed-auto`,
        title: "完整页面（自动组装）",
        type: "html",
        content: assembled,
        artifactIdentifier: "auto-composed",
        createdAt: new Date(subtaskTs),
      })]
    }

    return []
  })

  return (
    <div class="flex flex-col" style={{ "user-select": "text" }}>
      {/* 用户消息气泡（右侧对齐） */}
      <div class="flex flex-col items-end gap-2 px-3 py-2.5">
        <Show when={userText() || userAttachments().length === 0}>
          <div
            class="break-words"
            style={{
              background: "var(--octo-brand-a8)",
              padding: "8px 12px",
              "border-radius": "16px 16px 2px 16px",
              color: "#191919",
              "font-size": "14px",
              "line-height": "22px",
              "white-space": "pre-wrap",
              display: "inline-block",
              "max-width": "85%",
            }}
          >
            {userText()}
          </div>
        </Show>
        <Show when={userAttachments().length > 0}>
          <div class="flex flex-col gap-2">
            <For each={userAttachments()}>
              {(att) => (
                <div
                  class="break-words flex items-center gap-2"
                  style={{
                    background: "var(--octo-brand-a8)",
                    padding: "8px 12px",
                    "border-radius": "12px",
                    color: "#191919",
                    "font-size": "13px",
                    display: "inline-flex",
                    "max-width": "200px",
                  }}
                >
                  <Show when={att.mime?.startsWith("image/")}>
                    <img
                      src={att.url}
                      alt={att.filename || "attachment"}
                      style={{ "max-width": "32px", "max-height": "32px", "border-radius": "4px", "object-fit": "cover" }}
                    />
                  </Show>
                  <span class="truncate">{att.filename || "attachment"}</span>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>

      {/* 思考过程 */}
      <Show when={reasoningTexts().length > 0}>
        <Show when={showGenerating()} fallback={
          <div class="mx-3 mb-1">
            <ReasoningCollapsed
              texts={reasoningTexts()}
              duration={reasoningDuration()}
            />
          </div>
        }>
          <div class="mx-3 mb-1" style={{ "padding-left": "12px", "border-left": "1px solid rgba(0,0,0,0.08)" }}>
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

      {/* DSL JSON 独立渲染（来自 stepBDslJsonPatched，不依赖 proseText） */}
      <Show when={props.dslJsonOverride}>
        <DslJsonCard rawText={props.dslJsonOverride!} expanded={dslJsonExpanded()} onToggle={() => setDslJsonExpanded(!dslJsonExpanded())} isStreaming={props.dslJsonIsStreaming} />
      </Show>

      {/* AI 文字回复（proseText 已剥离 artifact 内容，使用 segments 渲染） */}
      <Show when={proseSegments().length > 0}>
        <For each={proseSegments()}>
          {(seg) => {
            if (seg.kind === "text") {
              if (seg.text.trim().length === 0) return null
              if (looksLikeJson(seg.text)) return null
              return (
                <div
                  class="mb-2 px-3 py-2"
                  style={{ color: "#191919", "font-size": "14px", "line-height": "22px", "user-select": "text" }}
                >
                  <Markdown text={seg.text} />
                </div>
              )
            }
            if (seg.kind === "form") {
              return (
                <div class="mb-2 px-3 py-2" style={{ color: "#191919", "font-size": "14px", "line-height": "22px" }}>
                  <QuickBriefFormView
                    form={seg.form}
                    interactive={!props.active && props.status.type !== "busy"}
                    submitted={formSubmitted()}
                    onSubmit={props.onFormSubmit}
                  />
                </div>
              )
            }
          }}
        </For>
      </Show>

      {/* 工具调用进度（排除 Task 工具，由子任务卡片单独展示） */}
      <Show when={nonTaskToolCalls().length > 0}>
        <ToolCallGroupCard calls={nonTaskToolCalls()} />
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
            <div class="mx-3 mb-2" style={{ "border-radius": "8px", border: "1px solid rgba(0,0,0,0.1)", background: "var(--octo-surface-page)" }}>
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
                  <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>
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
      <Show when={!showGenerating() && nonTaskToolCalls().length > 0}>
        <div class="mb-1">
          <FileOpsSummary calls={nonTaskToolCalls()} />
        </div>
      </Show>

      {/* 错误提示 */}
      <Show when={assistantError()}>
        <div
          class="mx-3 mb-2 px-3 py-2 text-xs leading-relaxed"
          style={{
            "border-radius": "var(--octo-radius-md)",
            background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.2)",
            color: "#ef4444",
          }}
        >
          <div class="flex items-center gap-1.5 mb-1 font-medium">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="6" stroke="currentColor" stroke-width="1.2" />
              <path d="M7 4v3M7 9v0.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
            </svg>
            {assistantError()!.name === "ProviderAuthError" ? "认证失败" : "生成出错"}
          </div>
          <Show when={assistantError()!.message}>
            <div style={{ "user-select": "text" }}>{assistantError()!.message}</div>
          </Show>
        </div>
      </Show>



      {/* 产出文件列表 */}
      <Show when={!showGenerating() && producedFiles().length > 0}>
        <ProducedFilesList files={producedFiles()} />
      </Show>

      {/* 生成中状态指示 — 始终在底部 */}
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



      {/* 阻塞提示 — 渐进式显示 */}
      <Show when={showGenerating() && props.blockTime && props.blockTime >= 60}>
        {(() => {
          const bt = props.blockTime!
          const isWarning = bt >= 80
          return (
            <div class="mx-3 mb-3 p-3 flex items-center justify-between" style={{
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
