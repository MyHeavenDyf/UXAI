import { describe, expect, test } from "bun:test"
import type { Event, Message, Part, Session } from "@opencode-ai/sdk/v2/client"
import { createSkillUsageTracker } from "./skill-usage-tracker"

let sequence = 0

function message(role: "user" | "assistant" = "assistant", sessionID = "main") {
  return { id: "message", sessionID, role } as Message
}

function part(input: { id?: string; sessionID?: string; status?: string; tool?: string; name?: string; source?: string; end?: number } = {}) {
  return {
    id: input.id ?? "part",
    messageID: "message",
    callID: input.id ?? "call",
    sessionID: input.sessionID ?? "main",
    type: "tool",
    tool: input.tool ?? "skill",
    state: {
      status: input.status ?? "completed",
      input: {},
      title: "Loaded skill",
      output: "",
      metadata: { name: input.name ?? "image-design", source: input.source },
      time: { start: Date.now(), end: input.end ?? Date.now() + 1000 },
    },
  } as Part
}

function updated(value: Part): Event {
  return { id: `event-${value.id}`, type: "message.part.updated", properties: { sessionID: value.sessionID, part: value, time: Date.now() } }
}

function setup(module: "design" | "studio" = "design") {
  const events: Array<{ module: string; name: string; extend: string }> = []
  const sessions = ["main"]
  const history = new Map<string, Message>()
  const input = {
    module,
    scope: `test-${++sequence}`,
    sessionIDs: () => sessions,
    message: (sessionID: string, messageID: string) => history.get(`${sessionID}:${messageID}`),
    report: (event: (typeof events)[number]) => events.push(event),
  }
  return { events, sessions, history, input, consume: createSkillUsageTracker(input) }
}

describe("server-skill-used realtime tracking", () => {
  test.each(["design", "studio"] as const)("reports completed assistant calls in %s once per part", (module) => {
    const state = setup(module)
    state.history.set("main:message", message())
    state.consume(updated(part({ status: "running" })))
    expect(state.events).toHaveLength(0)
    state.consume(updated(part()))
    state.consume(updated(part()))
    state.consume(updated(part({ id: "second" })))
    expect(state.events).toEqual([1, 2].map(() => ({
      module,
      name: "server-skill-used",
      extend: JSON.stringify({ skill: "image-design" }),
    })))
  })

  test("history hydration does not report; realtime completion does not depend on client/server clock agreement", () => {
    const state = setup()
    state.history.set("main:message", message())
    expect(state.events).toHaveLength(0)
    state.consume(updated(part({ end: 1 })))
    expect(state.events).toHaveLength(1)
  })

  test("ignores user activation, user messages, failures, other tools and empty names", () => {
    const state = setup()
    state.history.set("main:message", message())
    state.consume(updated(part({ source: "user" })))
    state.consume(updated(part({ status: "error" })))
    state.consume(updated(part({ tool: "internel_image_generate" })))
    state.consume(updated(part({ name: " " })))
    state.history.set("main:message", message("user"))
    state.consume(updated(part()))
    expect(state.events).toHaveLength(0)
  })

  test("waits for assistant identity when the part arrives before its message", () => {
    const state = setup()
    state.consume(updated(part()))
    expect(state.events).toHaveLength(0)
    state.consume({ id: "message-event", type: "message.updated", properties: { sessionID: "main", info: message() } })
    expect(state.events).toHaveLength(1)
    state.consume({ id: "message-event", type: "message.updated", properties: { sessionID: "main", info: message() } })
    expect(state.events).toHaveLength(1)
  })

  test("tracks known children and descendants created in realtime, excluding other sessions", () => {
    const state = setup()
    state.sessions.push("known-child")
    state.history.set("known-child:message", message("assistant", "known-child"))
    state.consume(updated(part({ id: "known", sessionID: "known-child" })))
    state.consume({
      id: "child-event",
      type: "session.created",
      properties: { sessionID: "child", info: { id: "child", parentID: "main" } as Session },
    })
    state.consume({
      id: "grandchild-event",
      type: "session.created",
      properties: { sessionID: "grandchild", info: { id: "grandchild", parentID: "child" } as Session },
    })
    state.consume({ id: "message-event", type: "message.updated", properties: { sessionID: "grandchild", info: message("assistant", "grandchild") } })
    state.consume(updated(part({ id: "descendant", sessionID: "grandchild" })))
    state.consume(updated(part({ sessionID: "unrelated" })))
    expect(state.events).toHaveLength(2)
  })

  test("session switches and remounts do not duplicate a reported part", () => {
    const state = setup()
    state.history.set("main:message", message())
    state.consume(updated(part()))
    state.sessions.splice(0, 1, "other")
    state.consume(updated(part({ id: "inactive" })))
    state.sessions.splice(0, 1, "main")
    createSkillUsageTracker(state.input)(updated(part()))
    expect(state.events).toHaveLength(1)
  })

  test("deduplication is isolated by server/directory scope and module", () => {
    const state = setup()
    state.history.set("main:message", message())
    state.consume(updated(part()))
    createSkillUsageTracker({ ...state.input, scope: "another-server" })(updated(part()))
    createSkillUsageTracker({ ...state.input, module: "studio" })(updated(part()))
    expect(state.events).toHaveLength(3)
  })
})
