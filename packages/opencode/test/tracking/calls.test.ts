import { beforeEach, expect, test } from "bun:test"
import { eq, sql } from "drizzle-orm"
import { Effect, Exit } from "effect"
import { Database } from "../../src/storage/db"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { ArtifactEventTable as Events, ArtifactTurnTable as Turns } from "../../src/tracking/delivery.sql"
import { ToolCallTable as Calls, ToolCallParentTable as Parents } from "../../src/tracking/calls.sql"
import { ToolCalls } from "../../src/tracking/calls"
import { begin, inherit } from "../../src/tracking/store"
import { capture, failure, resultFacts } from "../../src/tracking/call-data"
import { Permission } from "../../src/permission"
import { testEffect } from "../lib/effect"
import { Layer } from "effect"
import { claim, finish } from "../../src/tracking/sender"

const it = testEffect(Layer.empty)
function seed(enroll = true, agent = "octo_insight") {
  const sessionID = SessionID.descending()
  const user = MessageID.ascending()
  const messageID = MessageID.ascending()
  Database.use((db) => {
    db.run(
      sql`INSERT OR IGNORE INTO project (id, worktree, sandboxes, time_created, time_updated) VALUES ('tool-tracking-test', 'D:/test', '[]', 1, 1)`,
    )
    db.run(
      sql`INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated) VALUES (${sessionID}, 'tool-tracking-test', 'test', 'D:/test', 'test', 'test', 1, 1)`,
    )
    db.run(
      sql`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (${messageID}, ${sessionID}, 1, 1, ${JSON.stringify({ role: "assistant", parentID: user, agent, modelID: "test-model", providerID: "test-provider" })})`,
    )
  })
  if (enroll)
    begin({
      messageID: user,
      sessionID,
      directory: "D:/test",
      extra: { account: "account", artifactTracking: { module: "insight" } },
    })
  ToolCalls.configure(messageID, {
    read: { kind: "builtin" },
    custom: { kind: "plugin" },
    "uxr-tool_key_findings": { kind: "mcp", provider: "uxr-tool" },
  })
  return { messageID, sessionID, callID: "call-1", tool: "read", args: { filePath: "notes.md" }, user }
}
const events = () => Database.use((db) => db.select().from(Events).orderBy(Events.created_at).all())
function data(phase: string) {
  const row = events().find((event) => event.name === `agent-tool-call-${phase}`)!
  const datas = row.payload.datas as { extend: string }[]
  return JSON.parse(datas[0].extend)
}
beforeEach(() =>
  Database.use((db) => {
    db.delete(Events).run()
    db.delete(Calls).run()
    db.delete(Parents).run()
    db.delete(Turns).run()
  }),
)

test("start/end are paired and idempotent; independent start survives metadata updates", () => {
  const input = seed()
  ToolCalls.start(input, undefined, 1000)
  ToolCalls.start(input, undefined, 3000)
  ToolCalls.update(input.messageID, input.callID, {
    executionStartedAt: 1100,
    executionStarted: true,
    permissionWaitMs: 100,
  })
  ToolCalls.end(input.messageID, input.callID, { status: "success" }, 2000)
  ToolCalls.end(input.messageID, input.callID, { status: "failure" }, 4000)
  expect(events()).toHaveLength(2)
  expect(data("start").arguments).toEqual(input.args)
  expect(data("end").invocationId).toBe(data("start").invocationId)
  expect(data("end")).toMatchObject({
    status: "success",
    durationMs: 1000,
    executionDurationMs: 800,
    agent: "octo_insight",
    toolKind: "builtin",
  })
  expect(data("end").arguments).toBeUndefined()
})

test("unenrolled modules produce no calls or events", () => {
  const input = seed(false, "octo_make")
  ToolCalls.start(input)
  ToolCalls.settled(input, { output: "ok", metadata: {} })
  expect(events()).toHaveLength(0)
})

test("changed effective parameters are recorded without credentials", () => {
  const input = seed()
  ToolCalls.start(input)
  ToolCalls.parameters(input.messageID, input.callID, { filePath: "outputs/notes.md", apiKey: "do-not-report" })
  ToolCalls.end(input.messageID, input.callID, { status: "success" })
  expect(data("end")).toMatchObject({
    argumentsChanged: true,
    effectiveArguments: { filePath: "outputs/notes.md", apiKey: "[redacted]" },
  })
  expect(JSON.stringify(Database.use((db) => db.select().from(Calls).all()))).not.toContain("do-not-report")
})

test("MCP call status stays separate from async task status", () => {
  expect(
    resultFacts("uxr-tool_get_task_result", "uxr-tool", {
      structuredContent: { task_id: "task-1", status: "failed" },
      content: [],
    }),
  ).toMatchObject({ status: "success", toolDetails: { businessStatus: "failed", taskId: "task-1" } })
  expect(resultFacts("uxr-tool_key_findings", "uxr-tool", { isError: true, content: [] }).status).toBe("failure")
  expect(resultFacts("bash", undefined, { metadata: { exit: 2 } }).status).toBe("failure")
  expect(resultFacts("bash", undefined, { metadata: { exit: null, timedOut: true } }).status).toBe("timeout")
  expect(resultFacts("bash", undefined, { metadata: { aborted: true } }).status).toBe("cancelled")
  expect(resultFacts("extract_document", undefined, { metadata: { error: "unsupported-format" } }).status).toBe(
    "failure",
  )
})

it.live("execution wrapper records success and preserves returned value", () =>
  Effect.gen(function* () {
    const input = seed()
    const value = { output: "ok", metadata: {} }
    const result = yield* ToolCalls.observe(
      input,
      Effect.gen(function* () {
        ToolCalls.executing(input.messageID, input.callID)
        return value
      }),
    )
    expect(result).toBe(value)
    expect(events()).toHaveLength(2)
    expect(data("end")).toMatchObject({ status: "success", executionStarted: true })
  }),
)

it.live("execution failure is reported without swallowing the original error", () =>
  Effect.gen(function* () {
    const input = seed()
    const result = yield* Effect.exit(ToolCalls.observe(input, Effect.die(new Error("bad execution"))))
    expect(Exit.isFailure(result)).toBe(true)
    expect(data("end")).toMatchObject({ status: "failure", errorMessage: "bad execution" })
  }),
)

it.live("permission rejection and aborted execution get distinct statuses", () =>
  Effect.gen(function* () {
    const input = seed()
    yield* Effect.exit(
      ToolCalls.observe(
        input,
        ToolCalls.permission(input.messageID, input.callID, Effect.die(new Permission.RejectedError())),
      ),
    )
    expect(data("end")).toMatchObject({ status: "denied", executionStarted: false, executionStage: "permission" })
    expect(failure(new DOMException("cancelled", "AbortError")).status).toBe("cancelled")
    expect(failure(new DOMException("too slow", "TimeoutError")).status).toBe("timeout")
    expect(failure({ name: "McpError", code: -32001, message: "Request timed out" }).status).toBe("timeout")
  }),
)

test("subagent calls retain parent invocation and root attribution", () => {
  const parent = seed()
  ToolCalls.start({ ...parent, tool: "task" }, { kind: "builtin" })
  const child = seed(false, "insight_reader")
  inherit(parent.messageID, child.user, child.sessionID, "D:/test")
  ToolCalls.inherit(parent.messageID, parent.callID, child.user)
  const childId = ToolCalls.start(child)!
  const row = Database.use((db) => db.select().from(Calls).where(eq(Calls.id, childId)).get())!
  expect(row.data).toMatchObject({
    parentInvocationId: ToolCalls.id(parent.messageID, parent.callID),
    rootSessionId: parent.sessionID,
    rootMessageId: parent.user,
    rootAgent: "octo_insight",
    agent: "insight_reader",
    depth: 1,
  })
})

test("recovery leaves live work alone and closes dead-process calls only once", () => {
  const input = seed()
  const id = ToolCalls.start(input)!
  ToolCalls.recover()
  expect(events()).toHaveLength(1)
  Database.use((db) => db.update(Calls).set({ process_token: "previous-process" }).where(eq(Calls.id, id)).run())
  ToolCalls.recover()
  ToolCalls.recover()
  expect(events()).toHaveLength(2)
  expect(data("end")).toMatchObject({ status: "interrupted", recovered: true })
})

test("capture recursively filters credentials and signed URLs, and bounds JSON size", () => {
  const input = {
    nested: { authorization: "secret-a", password: "secret-b" },
    command: 'curl -H "Authorization: Bearer secret-c" https://host/file?X-Amz-Signature=secret-d&name=file',
    content: '中"'.repeat(50_000),
    bytes: new Uint8Array([1, 2]),
  }
  const result = capture(input)
  const encoded = JSON.stringify(result)
  for (const value of ["secret-a", "secret-b", "secret-c", "secret-d"]) expect(encoded).not.toContain(value)
  expect(Buffer.byteLength(JSON.stringify(result.value))).toBeLessThanOrEqual(16 * 1024)
  expect(result.truncated).toBe(true)
  expect(result.redactedFields.length).toBeGreaterThan(0)
})

test("large final events stay below the extend limit", () => {
  const input = { ...seed(), args: { content: "中".repeat(100_000) } }
  ToolCalls.start(input)
  ToolCalls.parameters(input.messageID, input.callID, { content: "改".repeat(100_000) })
  ToolCalls.settled(input, { output: "返".repeat(100_000), metadata: {} })
  for (const event of events()) {
    const payload = event.payload.datas as { extend: string }[]
    expect(Buffer.byteLength(payload[0].extend)).toBeLessThanOrEqual(32768)
  }
})

it.live("fiber interruption still emits a cancelled end event", () =>
  Effect.gen(function* () {
    const input = seed()
    yield* Effect.exit(ToolCalls.observe(input, Effect.interrupt))
    expect(events()).toHaveLength(2)
    expect(data("end").status).toBe("cancelled")
  }),
)

it.live("MCP protocol errors survive conversion of the returned tool output", () =>
  Effect.gen(function* () {
    const input = { ...seed(), tool: "uxr-tool_key_findings" }
    yield* ToolCalls.observe(
      input,
      Effect.sync(() => {
        ToolCalls.executing(input.messageID, input.callID)
        ToolCalls.update(input.messageID, input.callID, {
          mcpResult: resultFacts(input.tool, "uxr-tool", { isError: true, content: [] }),
        })
        return { output: "error", metadata: {} }
      }),
    )
    expect(data("end")).toMatchObject({
      status: "failure",
      toolName: "key_findings",
      toolKind: "mcp",
      toolDetails: { isError: true },
    })
    expect(data("end").mcpResult).toBeUndefined()
  }),
)

test("delivery retry preserves the event identity and does not count another invocation", () => {
  const input = seed()
  ToolCalls.start(input)
  const first = claim(Date.now() + 1000)!
  finish(first, { ok: false, status: 503 }, 1000)
  const retry = claim(10_000)!
  expect(retry.id).toBe(first.id)
  expect(retry.attempts).toBe(2)
  finish(retry, { ok: true, status: 204 })
  ToolCalls.end(input.messageID, input.callID, { status: "success" })
  expect(events()).toHaveLength(2)
  expect(events().find((event) => event.id === first.id)?.state).toBe("sent")
})

test("recovery retries a saved completion even while the owning process is still alive", () => {
  const input = seed()
  ToolCalls.start(input, undefined, 1000)
  const saved = {
    type: "tool",
    tool: input.tool,
    callID: input.callID,
    state: {
      status: "completed",
      input: input.args,
      output: "saved",
      metadata: {},
      title: "read",
      time: { start: 1000, end: 2000 },
    },
  }
  Database.use((db) =>
    db.run(
      sql`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (${PartID.ascending()}, ${input.messageID}, ${input.sessionID}, 1000, 2000, ${JSON.stringify(saved)})`,
    ),
  )
  ToolCalls.recover()
  ToolCalls.recover()
  expect(events()).toHaveLength(2)
  expect(data("end")).toMatchObject({ status: "success", recovered: true, durationMs: 1000, endedAt: 2000 })
})

test("Cookie headers are fully filtered before persistence and delivery", () => {
  const input = {
    ...seed(),
    args: { command: 'curl -H "Cookie: theme=light; sessionid=private-session; sid=private-sid" https://example.test' },
  }
  ToolCalls.start(input)
  ToolCalls.parameters(input.messageID, input.callID, {
    command: "Cookie: theme=dark; sessionid=changed-session\nAccept: application/json",
  })
  ToolCalls.settled(input, {
    output: 'Set-Cookie: sessionid=result-session; Path=/; HttpOnly\nContent-Type: text/plain',
    metadata: {},
  })
  const encoded = JSON.stringify([events(), Database.use((db) => db.select().from(Calls).all())])
  for (const secret of ["private-session", "private-sid", "changed-session", "result-session"]) {
    expect(encoded).not.toContain(secret)
  }
  expect(data("end").effectiveArguments.command).toContain("Accept: application/json")
  expect(data("end").resultSummary).toContain("Content-Type: text/plain")
  expect(capture(JSON.stringify({ Cookie: "theme=light; sessionid=json-session" })).value).not.toContain("json-session")
})

test("MCP binary content is omitted from successful and failed result payloads", () => {
  const input = { ...seed(), tool: "uxr-tool_key_findings" }
  const content = [
    { type: "image", mimeType: "image/png", data: "aW1hZ2UtcHJpdmF0ZQ==" },
    { type: "audio", mimeType: "audio/wav", data: "YXVkaW8tcHJpdmF0ZQ==" },
    { type: "resource", resource: { uri: "file:///report.bin", blob: "YmxvYi1wcml2YXRl" } },
    { type: "text", text: "plain result" },
  ]
  const original = JSON.stringify(content)
  for (const isError of [false, true]) {
    const facts = resultFacts(input.tool, "uxr-tool", { isError, content })
    const encoded = JSON.stringify(facts)
    for (const binary of ["aW1hZ2UtcHJpdmF0ZQ==", "YXVkaW8tcHJpdmF0ZQ==", "YmxvYi1wcml2YXRl"]) {
      expect(encoded).not.toContain(binary)
    }
    expect(encoded).toContain("plain result")
    expect(facts.resultOmittedFields).toEqual(["$[0].data", "$[1].data", "$[2].resource.blob"])
    ToolCalls.start({ ...input, callID: String(isError) })
    ToolCalls.update(input.messageID, String(isError), { mcpResult: facts })
    ToolCalls.settled({ ...input, callID: String(isError) }, { output: "converted" })
  }
  const persisted = JSON.stringify([events(), Database.use((db) => db.select().from(Calls).all())])
  expect(persisted).not.toContain("aW1hZ2UtcHJpdmF0ZQ==")
  expect(persisted).not.toContain("YXVkaW8tcHJpdmF0ZQ==")
  expect(persisted).not.toContain("YmxvYi1wcml2YXRl")
  expect(JSON.stringify(content)).toBe(original)
  expect(capture({ data: "ordinary data", blob: "ordinary text" }).value).toEqual({
    data: "ordinary data", blob: "ordinary text",
  })
})
