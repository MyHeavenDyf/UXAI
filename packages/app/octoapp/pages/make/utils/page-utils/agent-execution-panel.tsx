import { createMemo, Show, For, onMount, createEffect, type Accessor } from "solid-js"
import { Portal } from "solid-js/web"
import type { JSX } from "solid-js"
import { useSync } from "@/context/sync"
import { agentExecution, setAgentExecution } from "./agent-execution-state"
import type { Message, Part, ToolPart, ToolState } from "@opencode-ai/sdk/v2/client"
import "./agent-execution-panel.css"

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

function AgentMessageRow(props: { message: Message; parts: Accessor<Part[]> }): JSX.Element {
  const textParts = createMemo(() => props.parts().filter((p) => p.type === "text") as Array<{ type: "text"; text: string }>)
  const toolParts = createMemo(() => props.parts().filter((p) => p.type === "tool") as ToolPart[])
  const reasoningParts = createMemo(
    () => props.parts().filter((p) => p.type === "reasoning") as Array<{ type: "reasoning"; text: string }>,
  )

  return (
    <div class="agent-exec-msg agent-exec-msg-assistant">
      <div class="agent-exec-msg-role">Agent</div>
      <Show when={reasoningParts().length > 0}>
        <div class="agent-exec-reasoning">
          <For each={reasoningParts()}>{(r) => <div class="agent-exec-reasoning-text">{truncate(r.text, 200)}</div>}</For>
        </div>
      </Show>
      <For each={textParts()}>{(p) => <div class="agent-exec-text">{p.text}</div>}</For>
      <Show when={toolParts().length > 0}>
        <div class="agent-exec-tools">
          <For each={toolParts()}>
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
      <For each={textParts()}>{(p) => <div class="agent-exec-text">{truncate(p.text, 300)}</div>}</For>
    </div>
  )
}

export function AgentExecutionPanel(): JSX.Element {
  const sync = useSync()
  const state = agentExecution

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

  return (
    <Portal mount={document.body}>
      <div class="agent-exec-overlay" onClick={(e) => { if (e.target === e.currentTarget) setAgentExecution(prev => prev ? { ...prev, visible: false } : null) }}>
        <div class="agent-exec-panel">
          <div class="agent-exec-header">
            <div class="agent-exec-header-title">
              <Show when={sessionStatus()?.type === "busy" || sessionStatus()?.type === "retry"}>
                <span class="agent-exec-spinner" />
              </Show>
              {state()?.title ?? "Agent 执行中"}
            </div>
            <button class="agent-exec-close" onClick={() => setAgentExecution(prev => prev ? { ...prev, visible: false } : null)}>✕</button>
          </div>
          <div class="agent-exec-body" ref={scrollRef}>
            <For each={messages()}>
              {(msg) => {
                const parts = createMemo(() => (sync.data.part?.[msg.id] ?? []) as Part[])
                return (
                  <Show
                    when={msg.role === "assistant"}
                    fallback={<UserMessageRow message={msg} parts={parts} />}
                  >
                    <AgentMessageRow message={msg} parts={parts} />
                  </Show>
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
