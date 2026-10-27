import { createMemo, Show, For, onMount, createEffect, type Accessor } from "solid-js"
import { Portal } from "solid-js/web"
import type { JSX } from "solid-js"
import { useSync } from "@/context/sync"
import { agentExecution, setAgentExecution } from "./agent-execution-state"
import type { Message, Part, ToolPart, ToolState } from "@opencode-ai/sdk/v2/client"
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
    const description = (input?.description as string) ?? (input?.prompt as string)?.slice(0, 80) ?? "子任务"
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

  createEffect(() => {
    if (props.sync.data.message?.[props.subSessionId] === undefined) {
      void props.sync.session.sync(props.subSessionId)
    }
  })

  return (
    <div class="agent-exec-subagent">
      <For each={messages()}>
        {(msg) => {
          const parts = createMemo(() => (props.sync.data.part?.[msg.id] ?? []) as Part[])
          return (
            <Show when={msg.role === "assistant"} fallback={<div class="agent-exec-sub-user">{msg.id}</div>}>
              <div class="agent-exec-sub-msg">
                <For each={parts()}>
                  {(p) => (
                    <Show when={p.type === "text"} fallback={<Show when={p.type === "tool"}>
                      <div class="agent-exec-sub-tool">
                        <span class="agent-exec-tool-icon">{toolStatusIcon((p as ToolPart).state)}</span>
                        <span class="agent-exec-tool-name">{truncate(toolTitle(p as ToolPart), 60)}</span>
                      </div>
                    </Show>}>
                      <div class="agent-exec-sub-text">{truncate((p as { text: string }).text, 500)}</div>
                    </Show>
                  )}
                </For>
              </div>
            </Show>
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
          <For each={reasoningParts()}>{(r) => <div class="agent-exec-reasoning-text">{truncate(r.text, 200)}</div>}</For>
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
                  <span class="agent-exec-task-desc">{t.description}</span>
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
      <For each={textParts()}>{(p) => <div class="agent-exec-text">{truncate(p.text, 300)}</div>}</For>
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
      <div class="agent-exec-overlay" onClick={(e) => { if (e.target === e.currentTarget) hide() }}>
        <div class="agent-exec-panel">
          <div class="agent-exec-header">
            <div class="agent-exec-header-title">
              <Show when={sessionStatus()?.type === "busy" || sessionStatus()?.type === "retry"}>
                <span class="agent-exec-spinner" />
              </Show>
              {state()?.title ?? "Agent 执行中"}
            </div>
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
                    <AgentMessageRow message={msg} parts={parts} sync={sync} />
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
