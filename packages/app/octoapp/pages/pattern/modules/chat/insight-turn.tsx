import type { AssistantMessage, Message, Part } from "@opencode-ai/sdk/v2/client"
import type { SessionStatus } from "@opencode-ai/sdk/v2"
import { useData } from "@opencode-ai/ui/context"
import { Markdown } from "@opencode-ai/ui/markdown"
import { createEffect, createMemo, createSignal, Show, For, type JSX } from "solid-js"
import { IconCardTable, IconCardMindmap, IconCardJson, IconCardFile, IconCardMarkdown, IconCardHtml, IconCardDeck, IconCardSvg } from "../icons"
import { createArtifactParser } from "../../utils/artifact-parser"
import { ToolCallGroupCard, type ToolCallInfo } from "./tool-call-card"
import { FileOpsSummary, deriveFileOps } from "./file-ops-summary"
import { UserInputCard } from "./user-input-card"
import "../../assets/style/chat/insight-turn.css"

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

function detectCard(): { type: OutputCardType; title: string } {
  return { type: "json", title: '当前阶段已完成' }
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

// ── Internal: ProducedFilesList ────────────────────────────

function ProducedFilesList(props: { files: Array<{ path: string; name: string }> }): JSX.Element {
  return (
    <div class="mx-3 mb-2">
      <div
        class="px-2.5 py-1.5 flex flex-col gap-1 produced-files-list"
      >
        <div class="text-[11px] produce-text">
          涉及文件
        </div>
        <For each={props.files}>
          {(file) => (
            <div class="flex items-center gap-1.5 text-xs">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <rect x="2" y="1" width="8" height="10" rx="1" stroke="currentColor" stroke-width="1" />
                <path d="M5 4h3M5 6h3M5 8h2" stroke="currentColor" stroke-width="0.7" />
              </svg>
              <span class="truncate file-name">{file.name}</span>
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
  pipelineBusy: boolean
}): JSX.Element {
  const data = useData()
  const partStore = data.store.part as Record<string, { type: string; text?: string }[]>
  const msgStore = data.store.message as Record<string, Message[]>

  // 思考过程/输出结果折叠状态，默认收起
  const [contentCollapsed, setContentCollapsed] = createSignal(true)

  const userText = createMemo(() => {
    const parts = partStore?.[props.messageID] ?? []
    const textPart = parts.find((p) => p.type === "text")
    if (!textPart?.text) return ""
    const raw = textPart.text
    const sepIdx = raw.lastIndexOf("\n---\n")
    if (sepIdx !== -1) return raw.slice(sepIdx + 5).trim()
    return raw.trim()
  })

  const allAssistantMsgs = createMemo((): AssistantMessage[] => {
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

  const assistantParts = createMemo(() => {
    const parts: { type: string; text?: string }[] = []
    for (const msg of allAssistantMsgs()) {
      const msgParts = partStore?.[msg.id] ?? []
      parts.push(...msgParts)
    }
    return parts
  })

  const assistantGenerating = createMemo(() => {
    const msgs = allAssistantMsgs()
    if (msgs.length === 0) return props.pipelineBusy
    return msgs.some((m) => typeof m.time.completed !== "number")
  })

  const customCardLabel = createMemo(() => {
    const text = userText()
    if (text.endsWith("请分析用户需求中尚未明确的维度，输出缺失维度的选项清单。")) return "分析用户需求"
    if (text.endsWith("请开始意图扩展。")) return "意图扩展"
    if (text.startsWith("请根据以下页面蓝图，设计外壳布局并指定下一步细化模块：")) return "布局规划"
    if (text.startsWith("请为以下模块生成 A2UI JSON：")) return "模块生成"
    if (text.startsWith("请根据以下内容，修改外壳布局并指定下一步细化模块")) return "细化模块"
    if (text.startsWith("[顶层布局和Slots]:")) return "更新页面"
    return null
  })

  const showUserInput = createMemo(() =>
    userText().endsWith("请分析用户需求中尚未明确的维度，输出缺失维度的选项清单。")
    || userText().startsWith("[用户修改请求]:")
  )

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

  const hasError = createMemo(() => toolCalls().some((c) => c.status === "error"))
  const fileOpsEntries = createMemo(() => deriveFileOps(toolCalls()))

  // ── NEW: prose text (stripped of artifacts) ──
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
    const trimmed = prose.trim()
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed)
        return JSON.stringify(parsed, null, 2)
      } catch { /* incomplete JSON, fall through */ }
    }
    return trimmed
  })

  const proseIsJson = createMemo(() => {
    const parts = assistantParts()
    const textPart = [...parts]
      .reverse()
      .find((p) => p.type === "text") as { type: "text"; text?: string } | undefined
    if (!textPart?.text) return false
    const parser = createArtifactParser()
    let prose = ""
    for (const ev of parser.feed(textPart.text)) {
      if (ev.type === "text") prose += ev.delta
    }
    return prose.trim().startsWith("{") || prose.trim().startsWith("[")
  })

  const streamingArtifact = createMemo((): OutputCard | null => {
    if (!assistantGenerating()) return null
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
  const [hasSeenArtifact, setHasSeenArtifact] = createSignal(false)
  const [lastSeenCard, setLastSeenCard] = createSignal<OutputCard | null>(null)

  // Track whether we've seen an artifact during streaming (effect, not memo)
  createEffect(() => {
    if (!assistantGenerating()) {
      setHasSeenArtifact(false)
      setLastSeenCard(null)
      return
    }
    const card = streamingArtifact()
    if (card) {
      setHasSeenArtifact(true)
      setLastSeenCard(card)
    }
  })

  const stableStreamingCard = createMemo((): OutputCard | null => {
    if (!assistantGenerating()) return null
    return streamingArtifact() ?? (hasSeenArtifact() ? lastSeenCard() : null)
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
    if (parts.length === 0 && !assistantGenerating()) return null
    if (assistantGenerating()) return null

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

        const info = detectCard()
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

      const info = detectCard()
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
    <div class="flex flex-col insight-turn-root">
      <Show when={showUserInput()}>
        <UserInputCard text={userText()} />
      </Show>

      {/* 自定义标签卡片 */}
      <Show when={customCardLabel()}>
        {(label) => (
              <div
              class="mx-3 mb-1 captured-card-btn"
              classList={{
                generating: assistantGenerating(),
                error: !assistantGenerating() && hasError(),
              }}
            >
              <div
                role="button"
                tabIndex={0}
                onClick={() => setContentCollapsed((p) => !p)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setContentCollapsed((p) => !p) } }}
                class="flex items-center gap-3 cursor-pointer select-none"
              >
                <div class="flex flex-col min-w-0 flex-1">
                  <span class="truncate title">{label()}</span>
                </div>
                <span class="flex-shrink-0 flex items-center justify-center size-6 rounded-md hover:bg-black/5 transition-colors">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 16 16"
                    fill="none"
                    class="transition-transform"
                    style={{ transform: contentCollapsed() ? "rotate(-90deg)" : "rotate(90deg)" }}
                  >
                    <path d="M6 4L10 8L6 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </span>
                <Show when={!assistantGenerating() && hasError()} fallback={
                  <Show when={assistantGenerating()} fallback={
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="#2E7D32" stroke-width="2" />
                      <path d="M8 12L11 15L16 9" stroke="#2E7D32" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                  }>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" class="insight-spinner">
                      <circle cx="12" cy="12" r="10" stroke="#2563EB" stroke-width="3" opacity="0.15" />
                        <path d="M12 2a10 10 0 0 1 10 10" stroke="#2563EB" stroke-width="3" stroke-linecap="round" />
                    </svg>
                  </Show>
                }>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="#D32F2F" stroke-width="2" />
                    <path d="M9 9L15 15M15 9L9 15" stroke="#D32F2F" stroke-width="2" stroke-linecap="round" />
                  </svg>
                </Show>
            </div>
          </div>
        )}
      </Show>

      {/* 卡片下方内容（收起时隐藏） */}
      <Show when={!contentCollapsed()}>
        {/* 思考过程 */}
        <Show when={reasoningTexts().length > 0}>
          <div
            ref={(el) => {
              createEffect(() => {
                reasoningTexts()
                el.scrollTop = el.scrollHeight
              })
            }}
            class="mx-3 mb-2 px-3 py-2 rounded-md text-xs leading-relaxed overflow-auto reasoning-text"
          >
            <Show when={assistantGenerating()}>
              <div class="text-[12px] text-[#999] reasoning-text-tip">思考中...</div>
            </Show>
            <For each={reasoningTexts()}>
              {(text, i) => (
                <>
                  <Show when={i() > 0}>
                    <div class="my-1.5 split-line" />
                  </Show>
                  <div class="whitespace-pre-wrap">{text}</div>
                </>
              )}
            </For>
          </div>
        </Show>

        {/* AI 文字回复 */}
        <Show when={proseText().length > 0}>
          <Show when={proseIsJson()} fallback={
            <div
              ref={(el) => {
                createEffect(() => {
                  proseText()
                  el.scrollTop = el.scrollHeight
                })
              }}
              class="mx-3 mb-2 px-3 py-2 rounded-md text-xs leading-relaxed overflow-auto prose-text"
            >
              <Show when={assistantGenerating()}>
                <div class="text-[12px] text-[#999] reasoning-text-tip">输出中...</div>
              </Show>
              <Markdown text={proseText()} streaming={assistantGenerating()} />
            </div>
          }>
            <pre
              ref={(el) => {
                createEffect(() => {
                  proseText()
                  el.scrollTop = el.scrollHeight
                })
              }}
              class="prose-json-pre mx-3 mb-2"
              classList={{ completed: !assistantGenerating() }}
            >
              <Show when={assistantGenerating()}>
                <div class="text-[12px] text-[#999] prose-text-tip">输出中...</div>
              </Show>
              {proseText()}
            </pre>
          </Show>
        </Show>
      </Show>

      {/* 文件操作摘要（生成完成后） */}
      <Show when={!assistantGenerating() && fileOpsEntries().length > 0}>
        <div class="mb-1">
          <FileOpsSummary calls={toolCalls()} />
        </div>
      </Show>

      {/* 工具调用进度 */}
      <Show when={toolCalls().length > 0}>
        <ToolCallGroupCard calls={toolCalls()} />
      </Show>

      {/* 产出文件列表 */}
      <Show when={!assistantGenerating() && producedFiles().length > 0}>
        <ProducedFilesList files={producedFiles()} />
      </Show>
    </div>
  )
}
