import { createMemo, createSignal, Show, For, type JSX } from "solid-js"

export type ToolCallStatus = "running" | "done" | "error"

export type ToolCallInfo = {
  name: string
  status: ToolCallStatus
  input?: Record<string, unknown>
  output?: string
  filePath?: string
}

type ToolFamily = "write" | "edit" | "read" | "bash" | "glob" | "grep" | "search" | "task" | "other"

export function toolFamily(name: string): ToolFamily {
  const n = name.toLowerCase()
  if (/write|create_file/.test(n)) return "write"
  if (/edit|str_replace/.test(n)) return "edit"
  if (/read|read_file/.test(n)) return "read"
  if (/bash|shell/.test(n)) return "bash"
  if (/glob|list/.test(n)) return "glob"
  if (/grep/.test(n)) return "grep"
  if (/search|websearch|web_search/.test(n)) return "search"
  if (/task/.test(n)) return "task"
  return "other"
}

const FAMILY_LABEL: Record<ToolFamily, string> = {
  write: "写入",
  edit: "编辑",
  read: "读取",
  bash: "执行命令",
  glob: "搜索文件",
  grep: "搜索内容",
  search: "网络搜索",
  task: "子任务",
  other: "工具调用",
}

function StatusBadge(props: { status: ToolCallStatus }): JSX.Element {
  const cfg = createMemo(() => {
    switch (props.status) {
      case "running":
        return { bg: "rgba(59,130,246,0.1)", color: "#3b82f6", label: "运行中", pulse: true }
      case "done":
        return { bg: "rgba(34,197,94,0.1)", color: "#22c55e", label: "完成", pulse: false }
      case "error":
        return { bg: "rgba(239,68,68,0.1)", color: "#ef4444", label: "错误", pulse: false }
    }
  })
  return (
    <span
      class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium"
      style={{ background: cfg().bg, color: cfg().color }}
    >
      {cfg().pulse && (
        <span class="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: cfg().color }} />
      )}
      {cfg().label}
    </span>
  )
}

function SingleToolCard(props: { call: ToolCallInfo }): JSX.Element {
  const family = createMemo(() => toolFamily(props.call.name))
  const label = createMemo(() => FAMILY_LABEL[family()])
  const summary = createMemo(() => {
    const input = props.call.input
    if (!input) return ""
    if (props.call.filePath) return props.call.filePath.split(/[/\\]/).pop() ?? props.call.filePath
    if (typeof input.command === "string") return input.command.length > 60 ? input.command.slice(0, 60) + "…" : input.command
    if (typeof input.pattern === "string") return input.pattern
    if (typeof input.query === "string") return input.query
    return ""
  })
  return (
    <div
      class="mx-3 mb-1 px-2.5 py-1.5 flex items-center gap-2 text-xs"
      style={{
        "border-radius": "var(--octo-radius-md)",
        background: "var(--octo-surface-page)",
        border: "1px solid var(--octo-border-default)",
      }}
    >
      <span style={{ color: "var(--octo-text-secondary)" }}>{label()}</span>
      <Show when={summary()}>
        <span class="truncate flex-1 min-w-0" style={{ color: "var(--octo-text-primary)" }}>
          {summary()}
        </span>
      </Show>
      <StatusBadge status={props.call.status} />
    </div>
  )
}

type GroupedToolCalls = {
  family: ToolFamily
  calls: ToolCallInfo[]
}

function groupByFamily(calls: ToolCallInfo[]): GroupedToolCalls[] {
  const groups: GroupedToolCalls[] = []
  for (const call of calls) {
    const f = toolFamily(call.name)
    const last = groups[groups.length - 1]
    if (last && last.family === f) {
      last.calls.push(call)
    } else {
      groups.push({ family: f, calls: [call] })
    }
  }
  return groups
}

function ToolGroupCard(props: { group: GroupedToolCalls }): JSX.Element {
  const isSingle = createMemo(() => props.group.calls.length === 1)
  const [open, setOpen] = createSignal(false)

  const allDone = createMemo(() => props.group.calls.every((c) => c.status === "done"))
  const hasError = createMemo(() => props.group.calls.some((c) => c.status === "error"))
  const overallStatus = createMemo((): ToolCallStatus => {
    if (hasError()) return "error"
    if (allDone()) return "done"
    return "running"
  })

  const label = createMemo(() => FAMILY_LABEL[props.group.family])

  return (
    <Show
      when={isSingle()}
      fallback={
        <div
          class="mx-3 mb-1"
          style={{ "border-radius": "var(--octo-radius-md)" }}
        >
          <button
            type="button"
            onClick={() => setOpen(!open())}
            class="w-full px-2.5 py-1.5 flex items-center gap-2 text-xs text-left"
            style={{
              background: "var(--octo-surface-page)",
              border: "1px solid var(--octo-border-default)",
              "border-radius": "var(--octo-radius-md)",
            }}
          >
            <span style={{ color: "var(--octo-text-secondary)" }}>{label()}</span>
            <span style={{ color: "var(--octo-text-secondary)" }}>x{props.group.calls.length}</span>
            <span class="flex-1" />
            <StatusBadge status={overallStatus()} />
            <svg
              width="12" height="12" viewBox="0 0 12 12" fill="none"
              style={{ transform: open() ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s", color: "var(--octo-text-disabled)" }}
            >
              <path d="M4 2l4 4-4 4" stroke="currentColor" stroke-width="1.5" fill="none" />
            </svg>
          </button>
          <Show when={open()}>
            <div class="mt-0.5 flex flex-col gap-0.5">
              <For each={props.group.calls}>
                {(call) => <SingleToolCard call={call} />}
              </For>
            </div>
          </Show>
        </div>
      }
    >
      <SingleToolCard call={props.group.calls[0]} />
    </Show>
  )
}

export function ToolCallGroupCard(props: { calls: ToolCallInfo[] }): JSX.Element {
  const groups = createMemo(() => groupByFamily(props.calls))
  return (
    <div class="flex flex-col gap-0.5 mb-1">
      <For each={groups()}>
        {(group) => <ToolGroupCard group={group} />}
      </For>
    </div>
  )
}
