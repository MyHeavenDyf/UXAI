import type { Event, Message, Part } from "@opencode-ai/sdk/v2/client"

const reported = new Set<string>()

/** 仅消费实时 SSE；历史消息 API 加载不经过这里，不做首次快照推断。 */
export function createSkillUsageTracker(input: {
  module: "design" | "studio"
  scope: string
  sessionIDs: () => string[]
  message: (sessionID: string, messageID: string) => Message | undefined
  report: (event: { module: string; name: string; extend: string }) => void
}) {
  const roles = new Map<string, Message["role"]>()
  const parents = new Map<string, string>()
  const pending = new Map<string, Part>()

  function owns(sessionID: string, visited = new Set<string>()): boolean {
    if (input.sessionIDs().includes(sessionID)) return true
    if (visited.has(sessionID)) return false
    visited.add(sessionID)
    const parent = parents.get(sessionID)
    return !!parent && owns(parent, visited)
  }

  function track(part: Part) {
    if (!owns(part.sessionID) || part.type !== "tool" || part.tool !== "skill") return
    if (part.state.status !== "completed" || part.state.metadata?.source === "user") return
    const skill = part.state.metadata?.name
    if (typeof skill !== "string" || !skill.trim()) return
    const messageKey = JSON.stringify([part.sessionID, part.messageID])
    const role = roles.get(messageKey) ?? input.message(part.sessionID, part.messageID)?.role
    if (!role) {
      pending.set(part.id, part)
      return
    }
    pending.delete(part.id)
    if (role !== "assistant") return
    const key = JSON.stringify([input.scope, input.module, part.sessionID, part.id])
    if (reported.has(key)) return
    reported.add(key)
    input.report({ module: input.module, name: "server-skill-used", extend: JSON.stringify({ skill }) })
  }

  return (event: Event) => {
    if (event.type === "session.created" || event.type === "session.updated") {
      const session = event.properties.info
      if (session.parentID) parents.set(session.id, session.parentID)
      return
    }
    if (event.type === "message.updated") {
      const message = event.properties.info
      if (!owns(message.sessionID)) return
      roles.set(JSON.stringify([message.sessionID, message.id]), message.role)
      pending.forEach((part) => {
        if (part.sessionID === message.sessionID && part.messageID === message.id) track(part)
      })
      return
    }
    if (event.type === "message.part.updated") track(event.properties.part)
  }
}
