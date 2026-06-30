import type { AssistantMessage, Message } from "@opencode-ai/sdk/v2/client"
import type { SessionStatus } from "@opencode-ai/sdk/v2"
import { useData } from "@opencode-ai/ui/context"
import { useSync } from "@/context/sync"
import { Markdown } from "@opencode-ai/ui/markdown"
import { Button } from "@opencode-ai/ui/button"
import { Spinner } from "@opencode-ai/ui/spinner"
import { createEffect, createMemo, createSignal, Show, For, type JSX } from "solid-js"

import { createArtifactParser } from "../utils/artifact-parser"
import { splitOnQuestionForms, type FormSegment } from "../utils/question-form"
import { QuickBriefFormView } from "./quick-brief-form"
import "./quick-brief-form.css"

function _debugLog(...args: unknown[]) {
  console.log("[InsightTurn]", ...args)
}

export type DeltaLogEntry = {
  timestamp: number
  eventType: string
  sessionID: string
  messageID: string
  partID: string
  field: string
  delta: string
}

function formatBlockTime(secs: number): string {
  if (secs < 60) return `${secs}秒`
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}分${s}秒`
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return true
  const mdMatch = trimmed.match(/```(?:json)?\s*[\s\S]*?```/)
  if (mdMatch) return true
  try { JSON.parse(trimmed); return true } catch { return false }
}

/** 提取并美化 JSON 文本（去掉 markdown 代码围栏，能解析则缩进 2 空格，否则原样返回） */
function formatJson(text: string): string {
  let candidate = text.trim()
  const mdMatch = candidate.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (mdMatch) candidate = mdMatch[1].trim()
  try { return JSON.stringify(JSON.parse(candidate), null, 2) } catch { return candidate }
}

function formatTime(d: Date): string {
  return d.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
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

function WaitingPill(props: {
  parts: Array<{ type: string; text?: string }>
  partStore: Record<string, { type: string; text?: string }[]>
  messageID: string
  sessionID: string
  deltaLog: DeltaLogEntry[]
}): JSX.Element {
  const statusLabel = createMemo(() => {
    const parts = props.parts
    const hasText = parts.some((p) => p.type === "text")
    const hasCurrentTextDelta = props.deltaLog.some(e => e.sessionID === props.sessionID && e.field === "text")
    const hasReasoning = props.deltaLog.some(e => e.sessionID !== props.sessionID && e.field === "reasoning")
    if (hasReasoning) return "深度思考中"
    if (hasCurrentTextDelta || hasText) return "生成中"
    return "思考中"
  })

  // 生成中面板只显示状态胶囊，不把 reasoning / 正文流式 dump 到面板里
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
          style={{ background: "var(--octo-brand, #3b82f6)" }}
        />
        <span class="text-xs" style={{ color: "var(--octo-text-secondary)" }}>
          {statusLabel()}…
        </span>
      </div>
    </div>
  )
}

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

/** 线框 DSL 的图标（描边 braces 样式，对齐 make 的 IconCardJson） */
function DslIcon(props: { size?: number }): JSX.Element {
  const s = props.size ?? 28
  return (
    <svg width={s} height={s} viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M2.41501 2.5725C1.66543 2.5725 1.05585 3.17917 1.05585 3.92875L1.05585 6.14833C1.9921 6.14833 2.75335 6.90958 2.75335 7.84875C2.75335 8.785 1.9921 9.54625 1.05585 9.54625L1.05585 11.7658C1.05585 12.5154 1.66543 13.125 2.41501 13.125L4.6346 13.125C4.6346 12.1858 5.39585 11.4246 6.3321 11.4246C7.26835 11.4246 8.0296 12.1858 8.0296 13.1221L10.2492 13.125C10.9988 13.125 11.6083 12.5154 11.6083 11.7658L11.6083 9.54625C12.5446 9.54625 13.3058 8.785 13.3058 7.84875C13.3058 6.90958 12.5446 6.14833 11.6083 6.14833L11.6083 3.92875C11.6083 3.17917 10.9988 2.5725 10.2492 2.5725L8.0296 2.5725C8.0296 1.63333 7.26835 0.875 6.3321 0.875C5.39585 0.875 4.6346 1.63333 4.6346 2.5725L2.41501 2.5725Z"
        fill-rule="nonzero"
        stroke="rgb(119,119,119)"
        stroke-linejoin="round"
        stroke-width="1"
      />
    </svg>
  )
}

/** 统计 DSL 树节点数（递归 children） */
function countDslNodes(jsonStr: string): number {
  try {
    let n = 0
    const walk = (node: { children?: unknown[] } | null | undefined) => {
      if (!node || typeof node !== "object") return
      n++
      const children = (node as { children?: unknown[] }).children
      if (Array.isArray(children)) for (const c of children) walk(c as { children?: unknown[] })
    }
    const root = JSON.parse(jsonStr)
    if (Array.isArray(root)) for (const r of root) walk(r as { children?: unknown[] })
    else walk(root as { children?: unknown[] })
    return n
  } catch { return 0 }
}

/** 步骤二 Node DSL JSON：对齐 make 的产物卡片样式，点击内联展开完整 JSON */
function DslCollapsed(props: { json: string; expanded: boolean; onToggle: () => void }): JSX.Element {
  const formatted = createMemo(() => formatJson(props.json))
  const nodeCount = createMemo(() => countDslNodes(formatted()))
  const subtitle = createMemo(() => {
    const action = props.expanded ? "点击收起" : "点击展开"
    return nodeCount() > 0 ? `${nodeCount()} 个节点 · ${action}` : action
  })
  return (
    <div
      class="mb-3"
      style={{
        "border-radius": "12px",
        padding: "16px 20px",
        background: "linear-gradient(90deg, rgba(245,248,255,1) 0%, rgba(255,255,255,1) 50%)",
        border: "1px solid rgba(0,0,0,0.1)",
      }}
    >
      <button
        type="button"
        onClick={() => props.onToggle()}
        class="w-full text-left transition-all"
        style={{ background: "transparent" }}
      >
        <div class="flex items-center" style={{ gap: "12px" }}>
          <span class="flex-shrink-0 flex items-center">
            <DslIcon size={28} />
          </span>
          <div class="flex flex-col min-w-0 flex-1" style={{ gap: "0" }}>
            <span class="truncate" style={{ color: "rgb(25,25,25)", "font-size": "14px", "line-height": "22px", "font-weight": 500 }}>线框 DSL</span>
            <span style={{ color: "#777", "font-size": "12px", "line-height": "22px" }}>{subtitle()}</span>
          </div>
          <span
            class="flex-shrink-0 inline-flex items-center"
            style={{
              color: "var(--icon-base, #777)",
              transition: "transform 0.2s ease",
              transform: props.expanded ? "rotate(180deg)" : "rotate(0deg)",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
              <path d="M3 4.5l3 3 3-3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" fill="none" />
            </svg>
          </span>
        </div>
      </button>
      <Show when={props.expanded}>
        <div
          style={{
            "margin-top": "12px",
            "border-radius": "8px",
            background: "rgba(0,0,0,0.04)",
            border: "1px solid rgba(0,0,0,0.08)",
            "max-height": "320px",
            overflow: "auto",
          }}
        >
          <pre
            class="whitespace-pre-wrap word-break-word"
            style={{
              margin: "0",
              padding: "12px",
              "font-size": "11px",
              "line-height": "16px",
              "font-family": "'SF Mono', 'Monaco', 'Consolas', 'Courier New', monospace",
              color: "#191919",
              "user-select": "text",
            }}
          >{formatted()}</pre>
        </div>
      </Show>
    </div>
  )
}

export function InsightTurn(props: {
  sessionID: string
  messageID: string
  status: SessionStatus
  active: boolean
  elapsedText?: string
  blockTime?: number
  onAbort?: () => void
  onChildSession?: (subSessionID: string) => void
  deltaLog?: DeltaLogEntry[]
  onFormSubmit?: (text: string) => void
}): JSX.Element {
  const data = useData()
  const sync = useSync()
  const partStore = sync.data.part as Record<string, { type: string; text?: string }[]>
  const msgStore = sync.data.message as Record<string, Message[]>

  // DSL 卡片展开态：本组件持有（流式期间不重建），卡片本身渲染在 <For> 外的稳定节点上，
  // 避免流式 delta 重建 DOM 导致点击/滚动被打断、展开态丢失
  const [dslExpanded, setDslExpanded] = createSignal(false)

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
      allParts.push(...parts)
    }
    return allParts
  })

  const assistantError = createMemo(() => {
    for (const msg of assistantMsgs()) {
      const err = (msg as Record<string, unknown>).error as Record<string, unknown> | undefined
      if (!err) continue
      if (err.name === "MessageAbortedError") continue
      const errData = err.data as Record<string, unknown> | undefined
      const message = typeof errData?.message === "string" ? errData.message : typeof err.message === "string" ? err.message as string : ""
      return { name: err.name as string, message }
    }
    return null
  })

  const latestAssistantMessageID = createMemo(() => {
    const msgs = assistantMsgs()
    if (msgs.length === 0) return ""
    return msgs[msgs.length - 1].id
  })

  const reasoningTexts = createMemo(() => {
    const parts = assistantParts()
    const texts: string[] = []
    for (const p of parts) {
      if (p.type === "reasoning" && (p as { text?: string }).text) {
        texts.push((p as { text: string }).text)
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
    return prose.trim()
  })

  const proseSegments = createMemo(() => {
    const text = proseText()
    if (!text) return []
    return splitOnQuestionForms(text)
  })

  // 步骤二的 Node DSL JSON：作为整段稳定数据源，渲染在 <For> 外，
  // 流式增长时只更新内容、不重建卡片节点。
  // 直接取最后一个 text part 原文（不经 proseText 剥 artifact）：
  // 既支持裸 JSON，也支持被 <artifact> 包裹的 JSON。
  const dslJson = createMemo(() => {
    const parts = assistantParts()
    const textPart = [...parts].reverse().find((p) => p.type === "text") as { type: "text"; text?: string } | undefined
    const raw = textPart?.text?.trim() ?? ""
    if (!raw) return ""
    if (raw.includes("<artifact")) {
      const parser = createArtifactParser()
      let content = ""
      for (const ev of parser.feed(raw)) if (ev.type === "artifact:chunk") content += ev.delta
      for (const ev of parser.flush()) if (ev.type === "artifact:chunk") content += ev.delta
      const c = content.trim()
      return c && looksLikeJson(c) ? c : ""
    }
    return looksLikeJson(raw) ? raw : ""
  })

  const formSubmitted = createMemo(() => {
    const messages = msgStore?.[props.sessionID] ?? []
    const currentIndex = messages.findIndex((m) => m.id === props.messageID)
    if (currentIndex === -1) return false
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

  // Notify parent about child sessions from Task tool calls
  createEffect(() => {
    const parts = assistantParts()
    for (const p of parts) {
      if (p.type !== "tool") continue
      const raw = p as Record<string, unknown>
      const state = raw.state as Record<string, unknown> | undefined
      if (!state) continue
      const toolName = raw.tool ?? raw.name ?? state.name
      if (typeof toolName !== "string" || !/task/i.test(toolName)) continue
      const metadata = state.metadata as Record<string, unknown> | undefined
      const subSessionID = metadata?.sessionId as string | undefined
      if (subSessionID) props.onChildSession?.(subSessionID)
    }
  })

  return (
    <div class="flex flex-col" style={{ "user-select": "text" }}>
      {/* 用户消息气泡 */}
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
            <ReasoningCollapsed texts={reasoningTexts()} duration={reasoningDuration()} />
          </div>
        }>
          <div class="mx-3 mb-1" style={{ "padding-left": "12px", "border-left": "1px solid rgba(0,0,0,0.08)" }}>
            <div
              class="overflow-auto"
              style={{ color: "#777", "font-size": "12px", "line-height": "18px", "max-height": "300px" }}
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

      {/* AI 文字回复（proseSegments 渲染） */}
      <Show when={proseSegments().length > 0}>
        <For each={proseSegments()}>
          {(seg) => {
            if (seg.kind === "text") {
              if (seg.text.trim().length === 0) return null
              // JSON 段交给 <For> 外的稳定 DSL 卡片渲染（见下方 dslJson），这里跳过
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

      {/* 步骤二 DSL 卡片：稳定节点，流式增长只更新内容不重建 DOM（保证可点击/可滚动） */}
      <Show when={dslJson()}>
        <div class="px-3">
          <DslCollapsed
            json={dslJson()}
            expanded={dslExpanded()}
            onToggle={() => setDslExpanded((v) => !v)}
          />
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

      {/* 生成中状态指示 */}
      <Show when={showGenerating()}>
        <WaitingPill
          parts={assistantParts()}
          partStore={partStore}
          messageID={latestAssistantMessageID()}
          sessionID={props.sessionID}
          deltaLog={props.deltaLog ?? []}
        />
      </Show>

      {/* 阻塞提示 */}
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
                <Button variant="secondary" size="small" onClick={props.onAbort} class="text-sm">
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
