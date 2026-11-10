import { createMemo, Show, For, Switch, Match, onMount, createEffect, createSignal, onCleanup, type Accessor } from "solid-js"
import { Portal } from "solid-js/web"
import type { JSX } from "solid-js"
import { useSync } from "@/context/sync"
import { agentExecution, setAgentExecution } from "./agent-execution-state"
import type { AssistantMessage, CompactionPart, Message, Part, ToolPart, ToolState } from "@opencode-ai/sdk/v2/client"
import "./agent-execution-panel.css"

type SyncApi = ReturnType<typeof useSync>

function toolStatusIcon(state: ToolState): string {
  if (state.status === "pending") return "⏳"
  if (state.status === "running") return "⚡"
  if (state.status === "completed") return "✅"
  if (state.status === "error") return "❌"
  return "•"
}

function toolTitle(part: ToolPart): string {
  const state = part.state
  if (state.status === "running") return state.title ?? part.tool
  if (state.status === "completed") return state.title ?? part.tool
  if (state.status === "error") return part.tool
  return part.tool
}

function truncate(text: string, max: number): string {
  const t = text.trim()
  return t.length > max ? t.slice(0, max) + "…" : t
}

function sessionUsage(messages: Message[]): { tokens: number; cost: number } {
  return messages.reduce(
    (acc, msg) => {
      if (msg.role !== "assistant") return acc
      return { tokens: acc.tokens + msg.tokens.input + msg.tokens.output, cost: acc.cost + msg.cost }
    },
    { tokens: 0, cost: 0 },
  )
}

function formatUsage(usage: { tokens: number; cost: number }): string {
  const tokens = usage.tokens >= 1000000
    ? `${(usage.tokens / 1000000).toFixed(2)}M`
    : usage.tokens >= 1000
      ? `${(usage.tokens / 1000).toFixed(1)}k`
      : `${usage.tokens}`
  return usage.cost > 0 ? `${tokens} · $${usage.cost.toFixed(2)}` : tokens
}

function findCompactionPart(parts: Part[]): CompactionPart | undefined {
  return parts.find((p): p is CompactionPart => p.type === "compaction")
}

function compactionState(messages: Message[], compactionID: string): "running" | "compacted" | "aborted" | "failed" {
  const summaries = messages.filter(
    (m): m is AssistantMessage => m.role === "assistant" && m.parentID === compactionID,
  )
  if (summaries.some((m) => m.summary === true && !!m.finish && !m.error)) return "compacted"
  if (summaries.some((m) => m.error?.name === "MessageAbortedError")) return "aborted"
  if (summaries.some((m) => m.error)) return "failed"
  return "running"
}

function CompactionRow(props: { message: Message; parts: Accessor<Part[]>; sessionMessages: Accessor<Message[]> }): JSX.Element {
  const compaction = createMemo(() => findCompactionPart(props.parts()))
  const state = createMemo(() => compactionState(props.sessionMessages(), props.message.id))

  const label = createMemo(() => {
    if (state() === "compacted") return "上下文已压缩"
    if (state() === "aborted") return "上下文压缩已停止"
    if (state() === "failed") return "上下文压缩失败"
    return "正在压缩上下文…"
  })

  const detail = createMemo(() => {
    const c = compaction()
    if (!c) return ""
    const trigger = c.overflow ? "溢出触发" : c.auto ? "自动" : "手动"
    const estimate = c.estimated_tokens ? ` · 压缩时约 ${formatUsage({ tokens: c.estimated_tokens, cost: 0 })} tokens` : ""
    return `${trigger}${estimate}`
  })

  return (
    <div
      class="agent-exec-compaction"
      classList={{
        "agent-exec-compaction-error": state() === "failed",
        "agent-exec-compaction-running": state() === "running",
      }}
    >
      <span class="agent-exec-compaction-icon">
        {state() === "running" ? "♻" : state() === "compacted" ? "✅" : state() === "failed" ? "❌" : "⏹"}
      </span>
      <span class="agent-exec-compaction-label">{label()}</span>
      <Show when={detail()}>
        <span class="agent-exec-compaction-detail">（{detail()}）</span>
      </Show>
    </div>
  )
}

function ExpandableText(props: { text: string; max: number }): JSX.Element {
  const trimmed = createMemo(() => (props.text ?? "").trim())
  const overflow = createMemo(() => trimmed().length > props.max)
  const [expanded, setExpanded] = createSignal(false)
  const display = createMemo(() => {
    const t = trimmed()
    if (expanded() || !overflow()) return t
    return t.slice(0, props.max) + "…"
  })
  return (
    <span
      class="agent-exec-expandable"
      classList={{ "agent-exec-expandable-clickable": overflow() }}
      onClick={() => { if (overflow()) setExpanded(v => !v) }}
      title={overflow() ? (expanded() ? "点击折叠" : "点击展开") : undefined}
    >
      {display()}
    </span>
  )
}

function extractTaskTools(parts: Part[]): Array<{ part: ToolPart; subSessionId?: string; description: string; status: string }> {
  const tasks: Array<{ part: ToolPart; subSessionId?: string; description: string; status: string }> = []
  for (const p of parts) {
    if (p.type !== "tool") continue
    const raw = p as Record<string, unknown>
    const state = raw.state as Record<string, unknown> | undefined
    if (!state) continue
    const toolName = raw.tool ?? raw.name
    if (typeof toolName !== "string" || !/task/i.test(toolName)) continue
    const input = state.input as Record<string, unknown> | undefined
    const metadata = state.metadata as Record<string, unknown> | undefined
    const subSessionId = metadata?.sessionId as string | undefined
    const description = (input?.description as string) ?? (input?.prompt as string) ?? "子任务"
    tasks.push({
      part: p as ToolPart,
      subSessionId,
      description,
      status: state.status as string,
    })
  }
  return tasks
}

function SubAgentMessages(props: { subSessionId: string; sync: SyncApi }): JSX.Element {
  const messages = createMemo(() => (props.sync.data.message?.[props.subSessionId] ?? []) as Message[])
  const usage = createMemo(() => sessionUsage(messages()))

  createEffect(() => {
    if (props.sync.data.message?.[props.subSessionId] === undefined) {
      void props.sync.session.sync(props.subSessionId)
    }
  })

  return (
    <div class="agent-exec-subagent">
      <Show when={usage().tokens > 0}>
        <div class="agent-exec-sub-usage" title="子 Agent 累计上下文 tokens / 费用">上下文 {formatUsage(usage())}</div>
      </Show>
      <For each={messages()}>
        {(msg) => {
          const parts = createMemo(() => (props.sync.data.part?.[msg.id] ?? []) as Part[])
          return (
            <Switch>
              <Match when={msg.role === "user" && findCompactionPart(parts())}>
                <CompactionRow message={msg} parts={parts} sessionMessages={messages} />
              </Match>
              <Match when={msg.role === "assistant" && msg.summary !== true}>
                <div class="agent-exec-sub-msg">
                  <For each={parts()}>
                    {(p) => (
                      <Show when={p.type === "text"} fallback={<Show when={p.type === "tool"}>
                        <div class="agent-exec-sub-tool">
                          <span class="agent-exec-tool-icon">{toolStatusIcon((p as ToolPart).state)}</span>
                          <span class="agent-exec-tool-name">{truncate(toolTitle(p as ToolPart), 60)}</span>
                        </div>
                      </Show>}>
                        <div class="agent-exec-sub-text"><ExpandableText text={(p as { text: string }).text} max={500} /></div>
                      </Show>
                    )}
                  </For>
                </div>
              </Match>
              <Match when={true}>
                <div class="agent-exec-sub-user">{msg.id}</div>
              </Match>
            </Switch>
          )
        }}
      </For>
      <Show when={messages().length === 0}>
        <div class="agent-exec-sub-loading">子 Agent 启动中…</div>
      </Show>
    </div>
  )
}

function AgentMessageRow(props: { message: Message; parts: Accessor<Part[]>; sync: SyncApi }): JSX.Element {
  const textParts = createMemo(() => props.parts().filter((p) => p.type === "text") as Array<{ type: "text"; text: string }>)
  const allToolParts = createMemo(() => props.parts().filter((p) => p.type === "tool") as ToolPart[])
  const taskTools = createMemo(() => extractTaskTools(props.parts()))
  const nonTaskTools = createMemo(() => allToolParts().filter((t) => !/task/i.test(t.tool)))
  const reasoningParts = createMemo(
    () => props.parts().filter((p) => p.type === "reasoning") as Array<{ type: "reasoning"; text: string }>,
  )

  return (
    <div class="agent-exec-msg agent-exec-msg-assistant">
      <div class="agent-exec-msg-role">Agent</div>
      <Show when={reasoningParts().length > 0}>
        <div class="agent-exec-reasoning">
          <For each={reasoningParts()}>{(r) => <div class="agent-exec-reasoning-text"><ExpandableText text={r.text} max={200} /></div>}</For>
        </div>
      </Show>
      <For each={textParts()}>{(p) => <div class="agent-exec-text">{p.text}</div>}</For>
      <Show when={taskTools().length > 0}>
        <div class="agent-exec-tasks">
          <For each={taskTools()}>
            {(t) => (
              <div class="agent-exec-task" classList={{ "agent-exec-task-error": t.status === "error" }}>
                <div class="agent-exec-task-header">
                  <span class="agent-exec-tool-icon">{t.status === "running" ? "⚡" : t.status === "completed" ? "✅" : t.status === "error" ? "❌" : "⏳"}</span>
                  <span class="agent-exec-task-desc"><ExpandableText text={t.description} max={80} /></span>
                </div>
                <Show when={t.subSessionId}>
                  <SubAgentMessages subSessionId={t.subSessionId!} sync={props.sync} />
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={nonTaskTools().length > 0}>
        <div class="agent-exec-tools">
          <For each={nonTaskTools()}>
            {(t) => (
              <div class="agent-exec-tool" classList={{ "agent-exec-tool-error": t.state.status === "error" }}>
                <span class="agent-exec-tool-icon">{toolStatusIcon(t.state)}</span>
                <span class="agent-exec-tool-name">{truncate(toolTitle(t), 80)}</span>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={(props.message as any).error}>
        <div class="agent-exec-error">错误: {String((props.message as any).error?.message ?? "")}</div>
      </Show>
    </div>
  )
}

function UserMessageRow(props: { message: Message; parts: Accessor<Part[]> }): JSX.Element {
  const textParts = createMemo(() => props.parts().filter((p) => p.type === "text") as Array<{ type: "text"; text: string }>)
  return (
    <div class="agent-exec-msg agent-exec-msg-user">
      <div class="agent-exec-msg-role">用户</div>
      <For each={textParts()}>{(p) => <div class="agent-exec-text"><ExpandableText text={p.text} max={300} /></div>}</For>
    </div>
  )
}

export function AgentExecutionPanel(props: { tabId: string }): JSX.Element {
  const sync = useSync()
  const state = createMemo(() => agentExecution()[props.tabId])
  const hide = () => setAgentExecution(prev => prev[props.tabId] ? { ...prev, [props.tabId]: { ...prev[props.tabId], visible: false } } : prev)

  const messages = createMemo(() => {
    const s = state()
    if (!s) return [] as Message[]
    return (sync.data.message?.[s.childSessionId] ?? []) as Message[]
  })

  const sessionStatus = createMemo(() => {
    const s = state()
    if (!s) return undefined
    return sync.data.session_status?.[s.childSessionId]
  })

  const usage = createMemo(() => sessionUsage(messages()))

  let scrollRef: HTMLDivElement | undefined

  createEffect(() => {
    const msgs = messages()
    if (msgs.length > 0 && scrollRef) {
      scrollRef.scrollTop = scrollRef.scrollHeight
    }
  })

  onMount(() => {
    const s = state()
    if (s && sync.data.message?.[s.childSessionId] === undefined) {
      void sync.session.sync(s.childSessionId)
    }
  })

  const [panelWidth, setPanelWidth] = createSignal(460)
  let moveHandler: ((e: MouseEvent) => void) | undefined
  let upHandler: (() => void) | undefined
  const onResizeStart = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startWidth = panelWidth()
    const prevUserSelect = document.body.style.userSelect
    document.body.style.userSelect = "none"
    moveHandler = (ev: MouseEvent) => {
      const delta = startX - ev.clientX
      setPanelWidth(Math.min(Math.max(startWidth + delta, 320), window.innerWidth - 40))
    }
    upHandler = () => {
      if (moveHandler) window.removeEventListener("mousemove", moveHandler)
      if (upHandler) window.removeEventListener("mouseup", upHandler)
      moveHandler = undefined
      upHandler = undefined
      document.body.style.userSelect = prevUserSelect
    }
    window.addEventListener("mousemove", moveHandler)
    window.addEventListener("mouseup", upHandler)
  }
  onCleanup(() => {
    if (moveHandler) window.removeEventListener("mousemove", moveHandler)
    if (upHandler) window.removeEventListener("mouseup", upHandler)
    document.body.style.userSelect = ""
  })

  return (
    <Portal mount={document.body}>
      <div class="agent-exec-overlay" onClick={(e) => { if (e.target === e.currentTarget) hide() }}>
        <div class="agent-exec-panel" style={{ width: `${panelWidth()}px` }}>
          <div class="agent-exec-resizer" onMouseDown={onResizeStart} />
          <div class="agent-exec-header">
            <div class="agent-exec-header-title">
              <Show when={sessionStatus()?.type === "busy" || sessionStatus()?.type === "retry"}>
                <span class="agent-exec-spinner" />
              </Show>
              {state()?.title ?? "Agent 执行中"}
            </div>
            <div class="agent-exec-header-side">
              <Show when={usage().tokens > 0}>
                <span class="agent-exec-usage" title="主 Agent 累计上下文 tokens / 费用">上下文 {formatUsage(usage())}</span>
              </Show>
              <button class="agent-exec-close" onClick={hide} title="关闭" aria-label="关闭">×</button>
            </div>
          </div>
          <div class="agent-exec-body" ref={scrollRef}>
            <For each={messages()}>
              {(msg) => {
                const parts = createMemo(() => (sync.data.part?.[msg.id] ?? []) as Part[])
                return (
                  <Switch>
                    <Match when={msg.role === "user" && findCompactionPart(parts())}>
                      <CompactionRow message={msg} parts={parts} sessionMessages={messages} />
                    </Match>
                    <Match when={msg.role === "assistant" && msg.summary !== true}>
                      <AgentMessageRow message={msg} parts={parts} sync={sync} />
                    </Match>
                    <Match when={msg.role === "user"}>
                      <UserMessageRow message={msg} parts={parts} />
                    </Match>
                  </Switch>
                )
              }}
            </For>
            <Show when={messages().length === 0}>
              <div class="agent-exec-empty">等待 Agent 响应…</div>
            </Show>
          </div>
        </div>
      </div>
    </Portal>
  )
}
