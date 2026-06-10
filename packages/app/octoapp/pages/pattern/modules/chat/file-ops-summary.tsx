import { createMemo, Show, For, type JSX } from "solid-js"
import type { ToolCallInfo } from "./tool-call-card"

type FileOpKind = "read" | "write" | "edit"
type FileOpEntry = {
  path: string
  name: string
  ops: FileOpKind[]
  status: "running" | "done" | "error"
}

function classifyOp(name: string): FileOpKind | null {
  const n = name.toLowerCase()
  if (/write|create_file/.test(n)) return "write"
  if (/edit|str_replace/.test(n)) return "edit"
  if (/read|read_file/.test(n)) return "read"
  return null
}

export function deriveFileOps(calls: ToolCallInfo[]): FileOpEntry[] {
  const map = new Map<string, FileOpEntry>()
  for (const call of calls) {
    const op = classifyOp(call.name)
    if (!op || !call.filePath) continue
    const existing = map.get(call.filePath)
    if (existing) {
      if (!existing.ops.includes(op)) existing.ops.push(op)
      if (call.status === "error") existing.status = "error"
      else if (call.status === "running" && existing.status !== "error") existing.status = "running"
    } else {
      map.set(call.filePath, {
        path: call.filePath,
        name: call.filePath.split("/").pop() ?? call.filePath,
        ops: [op],
        status: call.status === "running" ? "running" : call.status === "error" ? "error" : "done",
      })
    }
  }
  return [...map.values()]
}

function OpBadge(props: { op: FileOpKind }): JSX.Element {
  const cfg = createMemo(() => {
    switch (props.op) {
      case "write": return { label: "W", bg: "rgba(59,130,246,0.1)", color: "#3b82f6" }
      case "edit": return { label: "E", bg: "rgba(168,85,247,0.1)", color: "#a855f7" }
      case "read": return { label: "R", bg: "rgba(107,114,128,0.1)", color: "#6b7280" }
    }
  })
  return (
    <span
      class="inline-flex items-center justify-center w-4 h-4 rounded text-[10px] font-bold"
      style={{ background: cfg().bg, color: cfg().color }}
    >
      {cfg().label}
    </span>
  )
}

export function FileOpsSummary(props: { calls: ToolCallInfo[] }): JSX.Element {
  const entries = createMemo(() => deriveFileOps(props.calls))
  const summary = createMemo(() => {
    let w = 0, e = 0, r = 0
    for (const entry of entries()) {
      for (const op of entry.ops) {
        if (op === "write") w++
        else if (op === "edit") e++
        else if (op === "read") r++
      }
    }
    const parts: string[] = []
    if (w) parts.push(`写入 ${w}`)
    if (e) parts.push(`编辑 ${e}`)
    if (r) parts.push(`读取 ${r}`)
    return parts.join(" · ")
  })

  return (
    <div
      class="mx-3 mb-1 px-2.5 py-1.5 flex flex-col gap-1"
      style={{
        "border-radius": "var(--octo-radius-md)",
        background: "var(--octo-surface-page)",
        border: "1px solid var(--octo-border-default)",
      }}
    >
      <div class="flex items-center gap-1.5 text-[11px]" style={{ color: "var(--octo-text-secondary)" }}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2 4h8M2 6h8M2 8h5" stroke="currentColor" stroke-width="1.2" />
        </svg>
        <span>文件操作: {summary()}</span>
      </div>
      <Show when={entries().length <= 5}>
        <div class="flex flex-col gap-0.5">
          <For each={entries()}>
            {(entry) => (
              <div class="flex items-center gap-1.5 text-[11px]">
                <span class="truncate flex-1 min-w-0" style={{ color: "var(--octo-text-primary)" }}>
                  {entry.name}
                </span>
                <div class="flex items-center gap-0.5">
                  <For each={entry.ops}>
                    {(op) => <OpBadge op={op} />}
                  </For>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
