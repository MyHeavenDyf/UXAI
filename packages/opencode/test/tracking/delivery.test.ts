import { beforeEach, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import path from "node:path"
import { createServer } from "node:http"
import { Database } from "../../src/storage/db"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import type { MessageV2 } from "../../src/session/message-v2"
import {
  ArtifactEventTable as Events,
  ArtifactReceiptTable as Receipts,
  ArtifactTurnTable as Turns,
  ArtifactTaskTable as Tasks,
} from "../../src/tracking/delivery.sql"
import { begin, collect, recover, inherit } from "../../src/tracking/store"
import { mcpFacts, fileFact } from "../../src/tracking/facts"
import { claim, finish, deliver, endpoint } from "../../src/tracking/sender"
import { resolveOutputType } from "../../src/tracking/output-type"
import { resolveOutputType as frontendType } from "../../../app/octoapp/pages/insight/utils/output-type"
import { tmpdir } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(FetchHttpClient.layer)
const rows = () => Database.use((db) => db.select().from(Events).all())
function seed(sessionID = SessionID.descending(), account = "original-account", enroll = true) {
  const messageID = MessageID.ascending()
  if (enroll)
    begin({
      messageID,
      sessionID,
      directory: "D:/project",
      extra: { account, artifactTracking: { module: "insight" } },
    })
  Database.use((db) => {
    db.run(
      sql`INSERT OR IGNORE INTO project (id, worktree, sandboxes, time_created, time_updated) VALUES ('delivery-test', 'D:/project', '[]', 1, 1)`,
    )
    db.run(
      sql`INSERT OR IGNORE INTO session (id, project_id, slug, directory, title, version, time_created, time_updated) VALUES (${sessionID}, 'delivery-test', 'test', 'D:/project', 'test', 'test', 1, 1)`,
    )
  })
  return { messageID, sessionID }
}
function part(
  turn: ReturnType<typeof seed>,
  tool = "write",
  metadata: Record<string, unknown> = {},
  input = { filePath: "report.md" },
) {
  const assistant = MessageID.ascending()
  const value: MessageV2.ToolPart = {
    id: PartID.ascending(),
    messageID: assistant,
    sessionID: turn.sessionID,
    callID: PartID.ascending(),
    type: "tool",
    tool,
    state: { status: "completed", title: "test", output: "done", input, metadata, time: { start: 1, end: 2 } },
  }
  Database.use((db) => {
    db.run(
      sql`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (${assistant}, ${turn.sessionID}, 1, 1, ${JSON.stringify({ role: "assistant", parentID: turn.messageID })})`,
    )
    db.run(
      sql`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (${value.id}, ${assistant}, ${turn.sessionID}, 1, 1, ${JSON.stringify(value)})`,
    )
  })
  return value
}
const result = (status: string, signature = "first", ids = true) => ({
  structuredContent: { task_id: "task-1", status },
  content:
    status === "completed"
      ? ["one.md", "two.csv"].map((name) => ({
          type: "resource_link",
          name,
          mimeType: "text/plain",
          uri: `https://example.test/${name}?sig=${signature}`,
          ...(ids ? { resourceId: name } : {}),
        }))
      : [],
})
function mcp(turn: ReturnType<typeof seed>, tool: string, output: unknown) {
  return part(turn, `uxr-tool_${tool}`, { artifactDelivery: mcpFacts("uxr-tool", `uxr-tool_${tool}`, output) })
}

beforeEach(() =>
  Database.use((db) => {
    for (const table of [Events, Receipts, Turns, Tasks]) db.delete(table).run()
  }),
)

test("write/edit preserve names, same turn/file dedup, next turn counts again", () => {
  const turn = seed()
  collect(part(turn))
  collect(part(turn, "write", {}, { filePath: "REPORT.md" }))
  collect(part(turn, "edit"))
  collect(part(seed(turn.sessionID)))
  expect(
    rows()
      .map((item) => item.name)
      .sort(),
  ).toEqual(["artifact-file-edit", "artifact-file-write", "artifact-file-write"])
  expect(rows()[0].payload.account).toBe("original-account")
})

test("failed tool, scripts, manual edits and non-Insight turns do not create events", () => {
  const turn = seed()
  for (const tool of ["bash", "powershell", "python", "read", "apply_patch"]) collect(part(turn, tool))
  const failed = part(turn)
  failed.state = { status: "error", input: {}, error: "write failed", time: { start: 1, end: 2 } }
  collect(failed)
  collect(part(seed(undefined, "someone", false)))
  expect(rows()).toHaveLength(0)
  expect(Database.use((db) => db.select().from(Receipts).all())).toHaveLength(5)
})

test("startup recovery captures a saved result without a callback once", () => {
  part(seed())
  recover()
  recover()
  expect(rows()).toHaveLength(1)
})

test("turn identity is immutable; missing original account never borrows a later account", () => {
  const turn = seed(undefined, "")
  begin({
    ...turn,
    directory: "D:/project",
    extra: { account: "later-account", artifactTracking: { module: "insight" } },
  })
  collect(part(turn))
  expect(rows()[0].state).toBe("blocked")
  expect(rows()[0].reason).toBe("missing-original-account")
  expect(claim()).toBeUndefined()
})

test("concurrent child outputs inherit original root and deduplicate the same file", () => {
  const turn = seed()
  const parent = part(turn, "task")
  for (let index = 0; index < 2; index++) {
    const child = seed(undefined, "different-account", false)
    inherit(parent.messageID, child.messageID, child.sessionID, "D:/project")
    collect(part(child))
  }
  expect(rows()).toHaveLength(1)
  expect(rows()[0].message_id).toBe(turn.messageID)
  expect(rows()[0].payload.account).toBe("original-account")
})

test("MCP waits for user query; multiple files, rotated URLs and changed account preserve the original event set", () => {
  const turn = seed()
  collect(mcp(turn, "key_findings", result("pending")))
  expect(rows()).toHaveLength(0)
  const query = seed(turn.sessionID, "new-account")
  collect(mcp(query, "get_task_result", result("processing")))
  expect(rows()).toHaveLength(0)
  collect(mcp(query, "get_task_result", result("completed")))
  collect(mcp(query, "get_task_result", result("completed", "renewed")))
  expect(rows()).toHaveLength(2)
  expect(
    rows().every(
      (item) =>
        item.name === "artifact-mcp-return" &&
        item.payload.account === "original-account" &&
        item.message_id === turn.messageID,
    ),
  ).toBe(true)
})

test("UXR immutable full manifest assigns durable local identities without resource IDs", () => {
  const turn = seed()
  collect(mcp(turn, "mindmap", result("pending")))
  collect(mcp(turn, "get_task_result", result("completed", "a", false)))
  collect(mcp(turn, "get_task_result", result("completed", "b", false)))
  expect(rows()).toHaveLength(2)
})

test("unknown task origin stays pending and can resolve after the submission is recovered", () => {
  const turn = seed()
  const query = mcp(turn, "get_task_result", result("completed"))
  collect(query)
  expect(rows()).toHaveLength(0)
  expect(Database.use((db) => db.select().from(Receipts).get())?.reason).toBe("missing-task-origin")
  collect(mcp(turn, "key_findings", result("pending")))
  recover()
  expect(rows()).toHaveLength(2)
})

test("MCP errors, cancellation and text-only results never count as artifacts", () => {
  const turn = seed()
  collect(mcp(turn, "key_findings", result("pending")))
  collect(mcp(turn, "get_task_result", { ...result("completed"), isError: true }))
  collect(mcp(turn, "stop_task", result("completed")))
  collect(mcp(turn, "get_task_result", { ...result("completed"), content: [{ type: "text", text: "finished" }] }))
  expect(rows()).toHaveLength(0)
})

test("generic synchronous MCP requires stable resource identity; does not use URL or name", () => {
  const turn = seed()
  collect(
    part(turn, "provider_generate", {
      artifactDelivery: mcpFacts("provider", "provider_generate", { content: result("completed", "a", false).content }),
    }),
  )
  expect(rows()).toHaveLength(0)
  collect(
    part(turn, "provider_generate", {
      artifactDelivery: mcpFacts("provider", "provider_generate", { content: result("completed").content }),
    }),
  )
  expect(rows()).toHaveLength(2)
})

test("MCP JSON envelopes preserve resources before output truncation without duplicate extraction", () => {
  const output = result("completed")
  const facts = mcpFacts("uxr-tool", "uxr-tool_get_task_result", {
    content: [{ type: "text", text: JSON.stringify(output) }],
    metadata: output,
  })
  expect(facts.resources).toHaveLength(2)
  expect(facts.taskId).toBe("task-1")
  expect(facts.tool).toBe("get_task_result")
})

test("leases prevent simultaneous sending; stale responses cannot acknowledge a new lease", () => {
  collect(part(seed()))
  const first = claim()!
  expect(claim()).toBeUndefined()
  const second = claim(Date.now() + 31_000)!
  expect(second.id).toBe(first.id)
  expect(second.lease).not.toBe(first.lease)
  finish(first, { ok: true, status: 200 })
  expect(rows()[0].state).toBe("sending")
  finish(second, { ok: true, status: 200 })
  expect(rows()[0].state).toBe("sent")
})

it.live("real HTTP sender retries a lost acknowledgement with the same event ID", () =>
  Effect.gen(function* () {
    collect(part(seed()))
    const received: string[] = []
    const server = createServer((request, response) => {
      request.resume()
      request.on("end", () => {
        received.push(String(request.headers["idempotency-key"]))
        if (received.length === 1) {
          request.socket.destroy()
          return
        }
        response.end(JSON.stringify({ code: 0 }))
      })
    })
    yield* Effect.promise(() => new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)))
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        server.closeAllConnections()
        server.close()
      }),
    )
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("missing-listener-address")
    const url = endpoint(`http://127.0.0.1:${address.port}`)
    yield* deliver(url, "code-0")
    expect(rows()[0].state).toBe("pending")
    Database.use((db) => db.update(Events).set({ next_at: 0 }).run())
    yield* deliver(url, "code-0")
    expect(rows()[0].state).toBe("sent")
    expect(received).toEqual([rows()[0].id, rows()[0].id])
  }),
)

test("report URL accepts base or full endpoint; file classification matches the UI", async () => {
  expect(endpoint("http://www")).toBe("http://www/record/logger/interaction")
  expect(endpoint("http://www/record/logger/interaction")).toBe("http://www/record/logger/interaction")
  expect(() => endpoint("<Beta 上报地址>")).toThrow()
  expect(fileFact("write", { filePath: "A/../REPORT.md" }, {}, "D:/project")?.identity).toBe("d:/project/report.md")
  const source = await Bun.file(
    path.resolve(import.meta.dir, "../../../app/octoapp/pages/insight/utils/output-type.ts"),
  ).text()
  for (const match of source.matchAll(/\b[a-z0-9]+\b/g))
    expect(resolveOutputType(`x.${match[0]}`)).toBe(frontendType(`x.${match[0]}`))
})

test("restart sends a 45-day-old event without opening its project or session", async () => {
  await using dir = await tmpdir()
  const received: unknown[] = []
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      received.push(await request.json())
      return new Response("{}")
    },
  })
  const run = async (mode: string) => {
    const child = Bun.spawn(
      [
        process.execPath,
        path.join(import.meta.dir, "restart-fixture.ts"),
        mode,
        path.join(dir.path, "delivery.db"),
        server.url.origin,
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          XDG_DATA_HOME: path.join(dir.path, "data"),
          XDG_CONFIG_HOME: path.join(dir.path, "config"),
          XDG_STATE_HOME: path.join(dir.path, "state"),
          XDG_CACHE_HOME: path.join(dir.path, "cache"),
        },
      },
    )
    const [code, output, errors] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect({ code, errors: code ? errors + output : "" }).toEqual({ code: 0, errors: "" })
  }
  try {
    await run("seed")
    await run("restart")
    expect(received).toHaveLength(1)
  } finally {
    server.stop(true)
  }
}, 30_000)
