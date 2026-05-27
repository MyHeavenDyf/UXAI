import type { AssistantMessage, Message, Part } from "@opencode-ai/sdk/v2/client"
import type { SessionStatus } from "@opencode-ai/sdk/v2"
import { useData } from "@opencode-ai/ui/context"
import { Markdown } from "@opencode-ai/ui/markdown"
import { createMemo, createSignal, Show, For, type JSX } from "solid-js"
import { IconCardTable, IconCardMindmap, IconCardJson, IconCardFile, IconCardMarkdown, IconCardHtml, IconCardDeck, IconCardSvg } from "../icons"
import { createArtifactParser } from "../utils/artifact-parser"
import { stripArtifact } from "../utils/artifact-strip"
import { ToolCallGroupCard, type ToolCallInfo } from "./tool-call-card"
import { FileOpsSummary } from "./file-ops-summary"

export type OutputCardType =
  | "table" | "mindmap" | "markdown" | "file" | "json" | "html"
  | "deck" | "svg" | "markdown-document" | "code-snippet"

export type OutputCard = {
  id: string
  title: string
  type: OutputCardType
  content: string
  filePath?: string
  artifactKind?: string
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

  if (/```html/i.test(text) || /<!DOCTYPE\s+html/i.test(text) || /<html[\s>]/i.test(text)) {
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
  if (/```mermaid/i.test(text)) {
    return { type: "mindmap", title: heading(text) ?? "思维导图" }
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
  }
}

function parseArtifactFromText(text: string): Omit<OutputCard, "id" | "createdAt"> | null {
  if (!text.includes("<artifact")) return null
  try {
    const parser = createArtifactParser()
    let startEvent: { identifier: string; artifactType: string; title: string } | null = null
    let fullContent = ""
    for (const ev of parser.feed(text)) {
      if (ev.type === "artifact:start") startEvent = ev
      else if (ev.type === "artifact:end") fullContent = ev.fullContent
    }
    for (const ev of parser.flush()) {
      if (ev.type === "artifact:start") startEvent = ev
      else if (ev.type === "artifact:end") fullContent = ev.fullContent
    }
    if (!startEvent) return null
    const mappedType = ARTIFACT_TYPE_MAP[startEvent.artifactType]
    if (!mappedType) return null
    return {
      title: startEvent.title || mappedType,
      type: mappedType,
      content: fullContent,
      artifactKind: startEvent.artifactType,
    }
  } catch {
    return null
  }
}

function formatTime(d: Date): string {
  return d.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

// ── Internal: WaitingPill ──────────────────────────────────

function WaitingPill(props: { parts: Array<{ type: string; text?: string }> }): JSX.Element {
  const statusLabel = createMemo(() => {
    const parts = props.parts
    const toolParts = parts.filter((p) => p.type === "tool")
    const hasText = parts.some((p) => p.type === "text")
    if (hasText) return "生成中"
    if (toolParts.length === 0) return "思考中"
    const lastTool = toolParts[toolParts.length - 1] as Record<string, unknown>
    const state = lastTool.state as Record<string, unknown> | undefined
    if (!state?.output) return "执行工具中"
    return "生成中"
  })

  return (
    <div
      class="mx-3 mb-2 px-3 py-2 flex items-center gap-2"
      style={{
        "border-radius": "var(--octo-radius-md)",
        background: "var(--octo-brand-a3)",
        border: "1.5px dashed var(--octo-brand-a25)",
      }}
    >
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
          border: "1px solid var(--octo-border-default)",
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

// ── Main: InsightTurn ──────────────────────────────────────

export function InsightTurn(props: {
  sessionID: string
  messageID: string
  status: SessionStatus
  active: boolean
  onOpenResult: (card: OutputCard) => void
}): JSX.Element {
  const data = useData()
  const partStore = data.store.part as Record<string, { type: string; text?: string }[]>
  const msgStore = data.store.message as Record<string, Message[]>

  const userText = createMemo(() => {
    const parts = partStore?.[props.messageID] ?? []
    const textPart = parts.find((p) => p.type === "text")
    if (!textPart?.text) return ""
    const raw = textPart.text
    const sepIdx = raw.lastIndexOf("\n---\n")
    if (sepIdx !== -1) return raw.slice(sepIdx + 5).trim()
    return raw.trim()
  })

  const assistantMsg = createMemo((): AssistantMessage | undefined => {
    const messages = msgStore?.[props.sessionID] ?? []
    const idx = messages.findIndex((m) => m.id === props.messageID)
    if (idx === -1) return undefined
    for (let i = idx + 1; i < messages.length; i++) {
      const m = messages[i]
      if (m.role === "assistant") return m as AssistantMessage
      if (m.role === "user") break
    }
    return undefined
  })

  const assistantParts = createMemo(() => {
    const msg = assistantMsg()
    if (!msg) return []
    return partStore?.[msg.id] ?? []
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
        const hasOutput = typeof state.output === "string" && (state.output as string).length > 0
        const isError = state.meta
          ? ((state.meta as Record<string, unknown>).exitCode as number) !== 0
          : false
        return {
          name: (state.name as string) ?? (raw.name as string) ?? "unknown",
          status: !hasOutput ? ("running" as const) : isError ? ("error" as const) : ("done" as const),
          input: input ?? undefined,
          output: hasOutput ? (state.output as string) : undefined,
          filePath: filePath || undefined,
        }
      })
  })

  // ── NEW: prose text (stripped of artifacts) ──
  const proseText = createMemo(() => {
    const parts = assistantParts()
    const textPart = [...parts]
      .reverse()
      .find((p) => p.type === "text") as { type: "text"; text?: string } | undefined
    if (!textPart?.text) return ""
    const stripped = stripArtifact(textPart.text)
    return stripped.trim()
  })

  // ── NEW: streaming artifact (live preview during generation) ──
  const streamingArtifact = createMemo((): OutputCard | null => {
    if (!showGenerating()) return null
    const parts = assistantParts()
    const textPart = [...parts]
      .reverse()
      .find((p) => p.type === "text") as { type: "text"; text?: string } | undefined
    if (!textPart?.text) return null

    const parser = createArtifactParser()
    let startEvent: { identifier: string; artifactType: string; title: string } | null = null
    let fullContent = ""
    for (const ev of parser.feed(textPart.text)) {
      if (ev.type === "artifact:start") startEvent = ev
      else if (ev.type === "artifact:chunk") fullContent += ev.delta
      else if (ev.type === "artifact:end") fullContent = ev.fullContent
    }
    for (const ev of parser.flush()) {
      if (ev.type === "artifact:start") startEvent = ev
      else if (ev.type === "artifact:chunk") fullContent += ev.delta
      else if (ev.type === "artifact:end") fullContent = ev.fullContent
    }
    if (!startEvent) return null
    const mappedType = ARTIFACT_TYPE_MAP[startEvent.artifactType]
    if (!mappedType) return null
    return {
      id: `streaming-${props.messageID}`,
      title: startEvent.title || mappedType,
      type: mappedType,
      content: fullContent,
      createdAt: props.status.type === "busy" ? new Date(0) : new Date(),
    }
  })

  // Stable flag: once artifact detected during generation, don't flicker back
  const hasSeenArtifact = createSignal(false)
  const stableStreamingCard = createMemo((): OutputCard | null => {
    if (!showGenerating()) {
      if (hasSeenArtifact[0]()) hasSeenArtifact[1](false)
      return null
    }
    const card = streamingArtifact()
    if (card) {
      if (!hasSeenArtifact[0]()) hasSeenArtifact[1](true)
      return card
    }
    // If we've seen an artifact before, keep showing the last known state
    // (parser might temporarily return null during streaming)
    return hasSeenArtifact[0]() ? streamingArtifact() : null
  })

  // ── NEW: produced files ──
  const producedFiles = createMemo(() => {
    const calls = toolCalls()
    return calls
      .filter((c) =>
        (c.name.toLowerCase().includes("write") || c.name.toLowerCase().includes("edit"))
        && c.filePath && c.status === "done"
      )
      .map((c) => ({ path: c.filePath!, name: c.filePath!.split("/").pop()! }))
      .filter((f, i, arr) => arr.findIndex((x) => x.path === f.path) === i)
  })

  // ── output card (final, after generation) ──
  const outputCard = createMemo((): OutputCard | null => {
    const parts = assistantParts()
    if (parts.length === 0 && !showGenerating()) return null
    if (showGenerating()) return null

    // ── 优先级 1：带文件路径的 write tool（HTML 文件写入） ──
    for (const p of [...parts].reverse()) {
      if (p.type !== "tool") continue
      const state = (p as Record<string, unknown>).state as Record<string, unknown> | undefined
      if (!state) continue

      // attachments
      const attachments = state.attachments as Array<{ mime?: string; url?: string; filename?: string }> | undefined
      if (attachments) {
        for (const att of attachments) {
          if (att.mime === "text/html" && att.url) {
            const html = decodeDataUrl(att.url)
            if (html.length > 10) {
              return {
                id: `card-${props.messageID}-html`,
                title: att.filename?.replace(/\.html?$/i, "") ?? "HTML 原型",
                type: "html",
                content: html,
                createdAt: new Date(),
              }
            }
          }
        }
      }

      // input (write tool — 检测 HTML 文件)
      const input = state.input as Record<string, unknown> | undefined
      if (input) {
        const content = (input.content ?? input.text ?? input.data) as string | undefined
        const filePath = (input.path ?? input.filepath ?? input.filePath ?? "") as string
        if (content && content.length > 10) {
          const artifact = parseArtifactFromText(content)
          if (artifact) return { ...artifact, id: `card-${props.messageID}-artifact`, filePath: filePath || undefined, createdAt: new Date() }

          if (/```html/i.test(content) || /<!DOCTYPE\s+html/i.test(content) || /<html[\s>]/i.test(content) || /\.html?$/i.test(filePath)) {
            return {
              id: `card-${props.messageID}-html`,
              title: content.match(/^#{1,3}\s+(.+)/m)?.[1]?.trim() ?? filePath.split("/").pop()?.replace(/\.html?$/i, "") ?? "HTML 原型",
              type: "html",
              content,
              filePath: filePath || undefined,
              createdAt: new Date(),
            }
          }
        }
      }
    }

    // ── 优先级 2：text parts（含 artifact 标签） ──
    const textPart = [...parts]
      .reverse()
      .find((p) => p.type === "text") as { type: "text"; text?: string } | undefined
    if (textPart && typeof textPart.text === "string") {
      const text = textPart.text.trim()
      if (text.length > 0) {
        const artifact = parseArtifactFromText(text)
        if (artifact) return { ...artifact, id: `card-${props.messageID}-artifact`, createdAt: new Date() }

        const info = detectCard(text)
        if (info) return { id: `card-${props.messageID}`, ...info, content: textPart.text, createdAt: new Date() }

        return {
          id: `card-${props.messageID}-text`,
          title: text.match(/^#{1,3}\s+(.+)/m)?.[1]?.trim() ?? text.split("\n")[0]?.slice(0, 40) ?? "AI 产出",
          type: "markdown",
          content: textPart.text,
          createdAt: new Date(),
        }
      }
    }

    // ── 优先级 3：任何 tool output（聚合所有 tool 输出） ──
    const allToolOutput: string[] = []
    for (const p of parts) {
      if (p.type !== "tool") continue
      const state = (p as Record<string, unknown>).state as Record<string, unknown> | undefined
      if (!state) continue
      const output = state.output as string | undefined
      if (output && output.trim().length > 0) allToolOutput.push(output.trim())
    }
    if (allToolOutput.length > 0) {
      const content = allToolOutput.join("\n\n")
      const artifact = parseArtifactFromText(content)
      if (artifact) return { ...artifact, id: `card-${props.messageID}-artifact`, createdAt: new Date() }

      const info = detectCard(content)
      if (info) return { id: `card-${props.messageID}-tools`, ...info, content, createdAt: new Date() }

      return {
        id: `card-${props.messageID}-tools-fallback`,
        title: content.split("\n")[0]?.slice(0, 40) ?? "工具产出",
        type: "markdown",
        content,
        createdAt: new Date(),
      }
    }

    return null
  })

  return (
    <div class="flex flex-col">
      {/* 用户消息气泡（右侧对齐） */}
      <div class="flex justify-end px-3 py-2.5">
        <div
          class="text-sm whitespace-pre-wrap break-words leading-relaxed max-w-[85%] px-3 py-2"
          style={{
            color: "var(--octo-text-primary)",
            background: "var(--octo-brand-a8)",
            "border-radius": "var(--octo-radius-md)",
          }}
        >
          {userText()}
        </div>
      </div>

      {/* 文件操作摘要（生成完成后） */}
      <Show when={!showGenerating() && toolCalls().length > 0}>
        <div class="mb-1">
          <FileOpsSummary calls={toolCalls()} />
        </div>
      </Show>

      {/* 思考过程（直接展示） */}
      <Show when={reasoningTexts().length > 0}>
        <div class="mx-3 mb-1">
          <div
            class="p-2.5 rounded-md text-xs leading-relaxed overflow-auto"
            style={{
              background: "var(--octo-brand-a3)",
              color: "var(--octo-text-secondary)",
              "max-height": "300px",
              "border": "1px solid var(--octo-brand-a8)",
            }}
          >
            <For each={reasoningTexts()}>
              {(text, i) => (
                <>
                  <Show when={i() > 0}>
                    <div class="my-1.5" style={{ "border-top": "1px dashed var(--octo-brand-a15)" }} />
                  </Show>
                  <div class="whitespace-pre-wrap">{text}</div>
                </>
              )}
            </For>
          </div>
        </div>
      </Show>

      {/* 生成中状态指示 */}
      <Show when={showGenerating()}>
        <WaitingPill parts={assistantParts()} />
      </Show>

      {/* 工具调用进度 */}
      <Show when={toolCalls().length > 0}>
        <ToolCallGroupCard calls={toolCalls()} />
      </Show>

      {/* AI 文字回复（剥离 artifact 标签） */}
      <Show when={proseText().length > 0}>
        <div
          class="mx-3 mb-2 px-3 py-2 text-sm leading-relaxed"
          style={{ color: "var(--octo-text-primary)" }}
        >
          <Markdown text={proseText()} />
        </div>
      </Show>

      {/* 生成中的 artifact 卡片（非点击，带进度指示） */}
      <Show when={showGenerating() && stableStreamingCard()}>
        {(card) => {
          const genCard = card()
          return (
            <div
              class="mx-3 mb-3 p-3"
              style={{
                "border-radius": "var(--octo-radius-md)",
                border: "1px dashed var(--octo-brand-a25)",
                background: "var(--octo-surface-page)",
                width: "calc(100% - 1.5rem)",
              }}
            >
              <div class="flex items-center gap-2">
                <span class="flex-shrink-0 flex items-center"><CardTypeIcon type={genCard.type} /></span>
                <div class="flex flex-col gap-0.5 min-w-0 flex-1">
                  <span class="text-sm font-medium truncate" style={{ color: "var(--octo-text-primary)" }}>{genCard.title}</span>
                  <span class="text-xs" style={{ color: "var(--octo-text-secondary)" }}>正在生成…</span>
                </div>
                <span
                  class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium"
                  style={{ background: "rgba(59,130,246,0.1)", color: "#3b82f6" }}
                >
                  <span class="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#3b82f6" }} />
                  生成中
                </span>
              </div>
            </div>
          )
        }}
      </Show>

      {/* 输出卡片（生成完成后） */}
      <Show when={outputCard()}>
        {(card) => {
          const capturedCard = card()
          return (
            <button
              type="button"
              onClick={() => props.onOpenResult(capturedCard)}
              class="mx-3 mb-3 p-3 text-left transition-all"
              style={{
                "border-radius": "var(--octo-radius-md)",
                border: "1px solid var(--octo-border-default)",
                background: "var(--octo-surface-page)",
                width: "calc(100% - 1.5rem)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "var(--octo-brand-a20)"
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "var(--octo-border-default)"
              }}
            >
              <div class="flex items-center gap-2">
                <span class="flex-shrink-0 flex items-center"><CardTypeIcon type={capturedCard.type} /></span>
                <div class="flex flex-col gap-0.5 min-w-0 flex-1">
                  <span class="text-sm font-medium truncate" style={{ color: "var(--octo-text-primary)" }}>{capturedCard.title}</span>
                  <span class="text-xs" style={{ color: "var(--octo-text-secondary)" }}>{formatTime(capturedCard.createdAt)}</span>
                </div>
                <span class="text-xs flex-shrink-0" style={{ color: "var(--octo-text-secondary)" }}>→</span>
              </div>
            </button>
          )
        }}
      </Show>

      {/* 产出文件列表 */}
      <Show when={!showGenerating() && producedFiles().length > 0}>
        <ProducedFilesList files={producedFiles()} />
      </Show>
    </div>
  )
}
