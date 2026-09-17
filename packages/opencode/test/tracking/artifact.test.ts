import { beforeEach, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import path from "node:path"
import { mkdir, writeFile, symlink } from "node:fs/promises"
import { Effect } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { sql } from "drizzle-orm"
import { Database } from "../../src/storage/db"
import {
  ArtifactEventTable as Events,
  ArtifactFactTable as Facts,
  ArtifactObservationTable as Observations,
  ArtifactTaskTable as Tasks,
  ArtifactTurnTable as Turns,
  ArtifactScanTable as Scans,
} from "../../src/tracking/artifact.sql"
import { artifacts, hash, identity, mcpFact, record, resources } from "../../src/tracking/facts"
import {
  beginTurn,
  enqueue,
  replay,
  readTurn,
  cleanup,
  inheritTurn,
  resultTurn,
  type Turn,
} from "../../src/tracking/store"
import { claim, finish, retryDelay, deliver, ArtifactSender } from "../../src/tracking/sender"
import { BUDGET, snapshot, commitScan, recoverScans, before, after } from "../../src/tracking/scanner"
import { resolveOutputType } from "../../src/tracking/output-type"
import { resolveOutputType as frontendType } from "../../../app/octoapp/pages/insight/utils/output-type"
import { tmpdir } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { ArtifactTracking } from "../../src/tracking"
import { claimTask, failTask, pollTasks } from "../../src/tracking/tasks"
import { GlobalBus } from "../../src/bus/global"

const it = testEffect(FetchHttpClient.layer)
const worker = testEffect(ArtifactSender.defaultLayer)
const rows = () => Database.use((db) => db.select().from(Events).all())
const extend = () => rows().map((r) => JSON.parse(JSON.parse(r.payload!).datas[0].extend))
const turn = (directory = process.cwd(), account: string | null = "origin-account"): Turn => ({
  message_id: `msg_${randomUUID()}`,
  session_id: `ses_${randomUUID()}`,
  root_message_id: "",
  root_session_id: "",
  directory,
  account,
  uid: "origin-uid",
  version: "test",
  owner: "server",
  created_at: Date.now(),
})
function seed(directory = process.cwd(), account: string | null = "origin-account") {
  const t = turn(directory, account)
  t.root_message_id = t.message_id
  t.root_session_id = t.session_id
  Database.use((db) => db.insert(Turns).values(t).run())
  return t
}
const write = (file: string, tool = "write") => ({
  type: "tool",
  tool,
  state: { status: "completed", input: { filePath: file }, metadata: { filepath: file }, time: { end: 1234 } },
})
function queue(t: Turn, file = "report.md") {
  Database.Client().transaction((db) => enqueue(db, t, artifacts(write(file), t.directory)[0]))
}

// Real persisted message/part facts, bypassing LLM execution only.
function persist(t: Turn, part: unknown, at = 1000) {
  const assistant = `msg_${randomUUID()}`
  const id = `prt_${randomUUID()}`
  Database.use((db) => {
    db.run(
      sql`INSERT OR IGNORE INTO project (id, worktree, sandboxes, time_created, time_updated) VALUES ('artifact-test', ${t.directory}, '[]', 1, 1)`,
    )
    db.run(
      sql`INSERT OR IGNORE INTO session (id, project_id, slug, directory, title, version, time_created, time_updated) VALUES (${t.session_id}, 'artifact-test', 'test', ${t.directory}, 'test', 'test', 1, 1)`,
    )
    db.run(
      sql`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (${assistant}, ${t.session_id}, ${at}, ${at}, ${JSON.stringify({ role: "assistant", parentID: t.message_id })})`,
    )
    db.run(
      sql`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (${id}, ${assistant}, ${t.session_id}, ${at}, ${at}, ${JSON.stringify(part)})`,
    )
  })
  return id
}

beforeEach(() => {
  delete process.env.OCTO_REPORT_BASE_URL
  delete process.env.OCTO_ARTIFACT_SUCCESS
  Database.use((db) => {
    for (const table of [
      "insight_artifact_event",
      "insight_artifact_fact",
      "insight_artifact_observation",
      "insight_artifact_task",
      "insight_artifact_turn",
      "insight_artifact_scan",
    ])
      db.run(sql.raw(`DELETE FROM ${table}`))
  })
})

describe("artifact facts and recovery", () => {
  test("full file type classifier stays identical to UI, including unknown extensions", async () => {
    const source = await Bun.file(
      path.resolve(import.meta.dir, "../../../app/octoapp/pages/insight/utils/output-type.ts"),
    ).text()
    const names = [...source.matchAll(/\b[a-z0-9]+\b/g)].map((m) => `file.${m[0]}`)
    for (const name of [...names, ".gitignore", "Makefile", "file.unknown", "file.mdown", "file.heic"]) {
      expect(resolveOutputType(name)).toBe(frontendType(name))
    }
    expect(resolveOutputType("no-extension", "image/png")).toBe("image")
  })
  test("Windows paths merge; POSIX case remains distinct; raw resources retain signed URIs", () => {
    expect(identity("A\\..\\REPORT.md", "D:\\project", "win32")).toBe(identity("report.md", "d:\\project", "win32"))
    expect(identity("Report.md", "/tmp", "linux")).not.toBe(identity("report.md", "/tmp", "linux"))
    const list = resources({
      content: [
        { type: "resource_link", name: "x", uri: "https://host/x?sig=a" },
        { type: "resource_link", name: "x", uri: "https://host/x?sig=b" },
      ],
    })
    expect(list).toHaveLength(2)
  })
  test("MCP identity ignores rotating signed URIs when the stable resource ID matches", () => {
    const part = (signature: string) => ({
      type: "tool",
      tool: "uxr-tool_get_task_result",
      state: {
        status: "completed",
        metadata: {
          octoArtifactResult: mcpFact({
            structuredContent: { task_id: "same-task", status: "completed" },
            content: [
              {
                type: "resource_link",
                uri: `https://example/result?signature=${signature}`,
                resource_id: "same-file",
                name: "result.xlsx",
              },
            ],
          }),
        },
      },
    })
    expect(artifacts(part("first"), process.cwd())[0].identity).toBe(
      artifacts(part("second"), process.cwd())[0].identity,
    )
  })
  test("persisted result before enqueue replays once without a completion callback", () => {
    const t = seed()
    persist(t, write("report.md"))
    replay()
    replay()
    expect(rows()).toHaveLength(1)
    expect(extend()[0].occurredAt).toBe(new Date(1234).toISOString())
    expect(JSON.parse(rows()[0].payload!).account).toBe("origin-account")
  })
  test("turn/name/file dedup crosses sources; next turn counts again", () => {
    const t = seed()
    const item = artifacts(write("report.md"), t.directory)[0]
    Database.Client().transaction((db) => enqueue(db, t, { ...item, source: "script" }))
    queue(t)
    Database.Client().transaction((db) => enqueue(db, t, artifacts(write("report.md", "edit"), t.directory)[0]))
    queue(seed())
    expect(rows()).toHaveLength(3)
    expect(extend()[0].source).toBe("script")
  })
  test("MCP preserves structured facts and uses original task turn after later poll", () => {
    const first = seed()
    const later = { ...seed(), session_id: first.session_id, root_session_id: first.session_id }
    Database.use((db) =>
      db
        .update(Turns)
        .set({ session_id: first.session_id, root_session_id: first.session_id })
        .where(sql`${Turns.message_id} = ${later.message_id}`)
        .run(),
    )
    const submit = {
      type: "tool",
      tool: "uxr_key_findings",
      state: {
        status: "completed",
        metadata: { octoArtifactResult: mcpFact({ structuredContent: { task_id: "task-1", status: "processing" } }) },
        time: { end: 1100 },
      },
    }
    persist(first, submit, 1000)
    const result = mcpFact({
      structuredContent: { task_id: "task-1", status: "completed" },
      content: [
        {
          type: "resource_link",
          uri: "https://example/x?secret=token",
          resource_id: "result-report",
          name: "report.xlsx",
          business_type: "key_findings",
        },
      ],
    })
    persist(
      later,
      {
        type: "tool",
        tool: "uxr_get_task_result",
        state: { status: "completed", metadata: { octoArtifactResult: result }, time: { end: 3000 } },
      },
      2000,
    )
    replay()
    expect(rows()).toHaveLength(1)
    expect(extend()[0].messageId).toBe(first.message_id)
    expect(extend()[0].files).toEqual([{ type: "file", count: 1, tool: "key_findings" }])
    expect(rows()[0].payload).not.toContain("secret")
  })
  test("async MCP task is persisted and polled without another conversation turn", async () => {
    const origin = seed()
    persist(origin, {
      type: "tool",
      tool: "uxr-tool_key_findings",
      state: {
        status: "completed",
        metadata: {
          octoArtifactResult: mcpFact({ structuredContent: { task_id: "task-auto", status: "processing" } }),
        },
        time: { end: 1000 },
      },
    })
    replay()
    Database.use((db) => db.update(Tasks).set({ next_at: 0 }).run())
    const events: unknown[] = []
    const listener = (event: unknown) => events.push(event)
    GlobalBus.on("event", listener)
    try {
      await pollTasks(async () => ({
        structuredContent: { task_id: "task-auto", status: "completed" },
        content: [
          {
            type: "resource_link",
            uri: "https://example/result?signature=first",
            resource_id: "stable-result",
            name: "result.xlsx",
            business_type: "key_findings",
          },
        ],
      }))
    } finally {
      GlobalBus.off("event", listener)
    }
    expect(rows()).toHaveLength(1)
    const task = Database.use((db) => db.select().from(Tasks).get())!
    expect(task.state).toBe("succeeded")
    expect(task.result_part_id).toStartWith("prt_")
    expect(Database.use((db) => db.get(sql`SELECT id FROM part WHERE id = ${task.result_part_id}`))).toBeDefined()
    expect(events.some((event) => record(record(event).payload).type === "message.part.updated")).toBe(true)
    expect(rows()[0].payload).not.toContain("signature")
  })
  test("MCP resources without a provider-stable ID stay diagnostic", () => {
    const origin = seed()
    persist(origin, {
      type: "tool",
      tool: "uxr-tool_key_findings",
      state: {
        status: "completed",
        metadata: { octoArtifactResult: mcpFact({ structuredContent: { task_id: "unknown", status: "processing" } }) },
      },
    })
    replay()
    persist(origin, {
      type: "tool",
      tool: "uxr-tool_get_task_result",
      state: {
        status: "completed",
        metadata: {
          octoArtifactResult: mcpFact({
            structuredContent: { task_id: "unknown", status: "completed" },
            content: [{ type: "resource_link", uri: "https://example/result?signature=rotating", name: "result.xlsx" }],
          }),
        },
      },
    })
    replay()
    expect(rows()).toHaveLength(0)
    expect(
      Database.use((db) => db.select().from(Observations).all()).some((row) => row.reason === "identity-unresolved"),
    ).toBe(true)
  })
  test("async task auth failures pause with retry and deadlines become terminal", () => {
    const origin = seed()
    persist(origin, {
      type: "tool",
      tool: "uxr-tool_key_findings",
      state: {
        status: "completed",
        metadata: {
          octoArtifactResult: mcpFact({ structuredContent: { task_id: "auth-task", status: "processing" } }),
        },
      },
    })
    replay()
    Database.use((db) => db.update(Tasks).set({ next_at: 0 }).run())
    const claimed = claimTask(1000)!
    failTask(claimed, new Error("HTTP 401 unauthorized"), 1000)
    const waiting = Database.use((db) => db.select().from(Tasks).get())!
    expect(waiting.state).toBe("waiting_auth")
    expect(claimTask(waiting.next_at - 1)).toBeUndefined()
    expect(claimTask(waiting.next_at)?.state).toBe("waiting_auth")
    Database.use((db) =>
      db.update(Tasks).set({ state: "pending", lease: null, lease_until: null, deadline_at: 2000, next_at: 0 }).run(),
    )
    expect(claimTask(2000)).toBeUndefined()
    expect(Database.use((db) => db.select().from(Tasks).get())?.state).toBe("timed_out")
  })
  test("unresolved result origin remains pending and replays after the submission mapping appears", () => {
    const origin = seed()
    persist(
      origin,
      {
        type: "tool",
        tool: "uxr-tool_get_task_result",
        state: {
          status: "completed",
          metadata: {
            octoArtifactResult: mcpFact({
              structuredContent: { task_id: "late-task", status: "completed" },
              content: [
                { type: "resource_link", uri: "https://example/result", resource_id: "late-file", name: "result.xlsx" },
              ],
            }),
          },
        },
      },
      1000,
    )
    replay()
    expect(Database.use((db) => db.select().from(Facts).get())?.state).toBe("pending")
    persist(
      origin,
      {
        type: "tool",
        tool: "uxr-tool_key_findings",
        state: {
          status: "completed",
          metadata: {
            octoArtifactResult: mcpFact({ structuredContent: { task_id: "late-task", status: "processing" } }),
          },
        },
      },
      900,
    )
    Database.use((db) => db.update(Facts).set({ next_at: 0 }).run())
    replay()
    expect(rows()).toHaveLength(1)
    expect(Database.use((db) => db.select().from(Facts).all()).every((fact) => fact.state === "processed")).toBe(true)
  })
  test("failed tools and historical turns are not new facts", () => {
    const t = seed()
    persist(t, { ...write("failed.md"), state: { status: "error" } })
    Database.use((db) => db.delete(Turns).run())
    replay()
    expect(rows()).toHaveLength(0)
    expect(
      beginTurn({ messageID: "new", sessionID: "make", directory: "/tmp", createdAt: 1, agent: "octo_make" }),
    ).toBeUndefined()
  })
  test("child facts inherit the root user and account", () => {
    const root = seed()
    const part = persist(root, write("root.md"))
    const assistant = Database.use((db) =>
      db.get<{ message_id: string }>(sql`SELECT message_id FROM part WHERE id = ${part}`),
    )!
    inheritTurn(assistant.message_id, "ses_child", "msg_child")
    const child = readTurn("msg_child")!
    persist(child, write("child.md"))
    replay()
    expect(extend().every((e) => e.messageId === root.message_id && e.sessionId === root.session_id)).toBe(true)
    expect(rows()).toHaveLength(2)
  })
  test("poll after rollback follows original owner; unknown old task remains legacy", () => {
    const root = seed()
    persist(root, {
      type: "tool",
      tool: "uxr_mindmap",
      state: { status: "completed", metadata: { structuredContent: { task_id: "existing" } }, time: { end: 1 } },
    })
    const later = { ...root, message_id: "msg_rollback", root_message_id: "msg_rollback", owner: "diagnostic" as const }
    Database.use((db) => db.insert(Turns).values(later).run())
    expect(resultTurn(later, "uxr_get_task_result", "existing")?.owner).toBe("server")
    expect(resultTurn(later, "uxr_get_task_result", "before-rollout")).toBeUndefined()
  })
  test("account and ownership are immutable; missing account never uses later login", () => {
    const t = seed(process.cwd(), null)
    beginTurn({
      messageID: t.message_id,
      sessionID: t.session_id,
      directory: t.directory,
      createdAt: 2,
      agent: "octo_insight",
      extra: { account: "later-account" },
    })
    queue(t)
    expect(readTurn(t.message_id)?.account).toBeNull()
    expect(rows()[0].state).toBe("missing-account")
    expect(claim()).toBeUndefined()
  })
  test("transaction rollback leaves neither event nor receipt", () => {
    const t = seed()
    expect(() =>
      Database.Client().transaction((db) => {
        enqueue(db, t, artifacts(write("x.md"), t.directory)[0])
        throw new Error("crash")
      }),
    ).toThrow("crash")
    expect(rows()).toHaveLength(0)
    queue(t, "x.md")
    expect(rows()).toHaveLength(1)
  })
})

describe("queue delivery", () => {
  worker.live("scoped worker recovers facts in diagnostic mode without a network endpoint", () =>
    Effect.gen(function* () {
      const t = seed()
      persist(t, write("worker.md"))
      const sender = yield* ArtifactSender.Service
      yield* sender.tick
      expect(rows()).toHaveLength(1)
      expect(rows()[0].state).toBe("pending")
    }),
  )
  test("lease prevents concurrent sends and recovers expired sending", () => {
    queue(seed())
    const first = claim(10)!
    expect(first).toBeDefined()
    expect(claim(11)).toBeUndefined()
    const next = claim(30_011)!
    expect(next.lease).not.toBe(first.lease)
    finish(first, { status: 200, ok: true })
    expect(rows()[0].state).toBe("sending")
    finish(next, { status: 200, ok: true })
    expect(rows()[0].state).toBe("sent")
  })
  test("Retry-After respected; sent cleanup retains dedup receipt", () => {
    expect(retryDelay(1, "120", 0)).toBeGreaterThanOrEqual(120_000)
    const t = seed()
    queue(t)
    finish(claim()!, { status: 200, ok: true })
    cleanup(Date.now() + 31 * 86400_000)
    expect(rows()[0].payload).toBeNull()
    queue(t)
    expect(rows()).toHaveLength(1)
    cleanup(Date.now() + 91 * 86400_000)
    expect(rows()).toHaveLength(0)
  })
  test("pending payload expires at 30 days and is retained for diagnosis until 90 days", () => {
    queue(seed())
    cleanup(Date.now() + 31 * 86400_000)
    expect(rows()[0].state).toBe("expired")
    expect(rows()[0].payload).not.toBeNull()
    cleanup(Date.now() + 91 * 86400_000)
    expect(rows()).toHaveLength(0)
  })
  it.live("receiver accepted but response failed: retry uses same eventId for dedup", () =>
    Effect.gen(function* () {
      queue(seed())
      const requests: string[] = []
      const accepted = new Set<string>()
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          requests.push(await req.text())
          accepted.add(JSON.parse(JSON.parse(requests.at(-1)!).datas[0].extend).eventId)
          return requests.length === 1 ? new Response("retry", { status: 503 }) : Response.json({ code: 0 })
        },
      })
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          server.stop(true)
        }),
      )
      yield* deliver(server.url.toString(), "code-0")
      expect(rows()[0].state).toBe("pending")
      Database.use((db) => db.update(Events).set({ next_at: 0 }).run())
      yield* deliver(server.url.toString(), "code-0")
      expect(rows()[0].state).toBe("sent")
      expect(requests[0]).toBe(requests[1])
      expect(accepted.size).toBe(1)
    }).pipe(Effect.scoped),
  )
  it.live("permanent HTTP and business failures do not retry", () =>
    Effect.gen(function* () {
      const server = Bun.serve({
        port: 0,
        fetch() {
          return new Response("not-json", { status: 400 })
        },
      })
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          server.stop(true)
        }),
      )
      queue(seed())
      yield* deliver(server.url.toString(), "code-0")
      expect(rows()[0].state).toBe("failed")
      server.reload({
        fetch() {
          return Response.json({ code: 123 })
        },
      })
      queue(seed())
      yield* deliver(server.url.toString(), "code-0")
      expect(rows().every((r) => r.state === "failed")).toBe(true)
    }).pipe(Effect.scoped),
  )
})

describe("bounded non-Git scans", () => {
  test("write then script edit; download itself excluded, later script edit counted", async () => {
    await using tmp = await tmpdir()
    const t = seed(tmp.path)
    const root = path.join(tmp.path, ".octo", t.session_id, "outputs")
    await mkdir(root, { recursive: true })
    await writeFile(path.join(root, "write.md"), "first")
    queue(t, path.join(root, "write.md"))
    const before = await snapshot(root)
    await writeFile(path.join(root, "write.md"), "edited")
    await writeFile(path.join(root, "download.md"), "download")
    await writeFile(
      path.join(root, ".artifact-source-test.json"),
      JSON.stringify({ file: "download.md", digest: hash("download"), pending: false }),
    )
    const downloaded = await snapshot(root)
    commitScan(t, before, downloaded, true)
    expect(rows()).toHaveLength(1)
    await writeFile(path.join(root, "download.md"), "script edit")
    commitScan(t, downloaded, await snapshot(root), true)
    expect(rows()).toHaveLength(1)
    expect(Database.use((db) => db.select().from(Observations).all())).toHaveLength(2)
  })
  test("budget failure does not advance baseline or enqueue; unknown dotfiles counted", async () => {
    await using tmp = await tmpdir()
    const t = seed(tmp.path)
    const root = path.join(tmp.path, ".octo", t.session_id, "outputs")
    await mkdir(root, { recursive: true })
    const before = await snapshot(root)
    await writeFile(path.join(root, ".user-data"), "keep")
    const incomplete = await snapshot(root, { ...BUDGET, bytes: 1 })
    expect(incomplete.complete).toBe(false)
    commitScan(t, before, incomplete, true)
    expect(rows()).toHaveLength(0)
    expect(Database.use((db) => db.select().from(Scans).all())).toHaveLength(0)
    commitScan(t, before, await snapshot(root), true)
    expect(rows()).toHaveLength(0)
    expect(Database.use((db) => db.select().from(Observations).get())?.reason).toBe("attribution-unconfirmed")
  })
  test("junctions outside outputs are not followed; concurrent requests coalesce", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, ".octo", "ses_links", "outputs")
    const outside = path.join(tmp.path, "outside")
    await mkdir(root, { recursive: true })
    await mkdir(outside)
    await writeFile(path.join(outside, "private.md"), "outside")
    await symlink(outside, path.join(root, "linked"), process.platform === "win32" ? "junction" : "dir")
    const first = snapshot(root)
    expect(snapshot(root)).toBe(first)
    expect((await first).files).toEqual({})
  })
  it.live("concurrent tool windows remain unassigned until all have exited", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
      )
      const t = seed(tmp.path)
      const prior = process.env.OCTO_ARTIFACT_SCRIPTS
      process.env.OCTO_ARTIFACT_SCRIPTS = "1"
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (prior === undefined) delete process.env.OCTO_ARTIFACT_SCRIPTS
          else process.env.OCTO_ARTIFACT_SCRIPTS = prior
        }),
      )
      const first = yield* Effect.promise(() => before(t, "bash"))
      const second = yield* Effect.promise(() => before(t, "powershell"))
      const root = path.join(tmp.path, ".octo", t.session_id, "outputs")
      yield* Effect.promise(() => mkdir(root, { recursive: true }))
      yield* Effect.promise(() => writeFile(path.join(root, "ambiguous.md"), "overlap"))
      yield* Effect.promise(() => after(first))
      const third = yield* Effect.promise(() => before(t, "bash"))
      yield* Effect.promise(() => after(second))
      yield* Effect.promise(() => after(third))
      expect(rows()).toHaveLength(0)
      expect(Database.use((db) => db.select().from(Scans).get())?.diagnostic).toContain("concurrent")
    }).pipe(Effect.scoped),
  )
  test("typical directory benchmark and pending download coverage", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, ".octo", "ses_benchmark", "outputs")
    await mkdir(root, { recursive: true })
    await Promise.all(
      Array.from({ length: 128 }, (_, i) => writeFile(path.join(root, `${i}.txt`), Buffer.alloc(64 * 1024, i))),
    )
    const result = await snapshot(root)
    expect(result.complete).toBe(true)
    expect(Object.keys(result.files)).toHaveLength(128)
    console.info("[artifact benchmark]", result.metrics)
    await writeFile(
      path.join(root, ".artifact-source-pending.json"),
      JSON.stringify({ file: "pending.md", digest: hash("future"), pending: true, recordedAt: Date.now() }),
    )
    expect((await snapshot(root)).complete).toBe(false)
    await writeFile(
      path.join(root, ".artifact-source-pending.json"),
      JSON.stringify({ file: "pending.md", digest: hash("future"), pending: true, recordedAt: 1 }),
    )
    expect((await snapshot(root)).complete).toBe(true)
    const limited = await snapshot(root, { ...BUDGET, files: 10 })
    expect(limited.reason).toContain("budget")
  })
  it.live("failed script with a complete output still records the file in finalizer", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
      )
      const t = seed(tmp.path)
      const part = persist(t, write("unrelated.md"))
      const assistant = Database.use((db) =>
        db.get<{ message_id: string }>(sql`SELECT message_id FROM part WHERE id = ${part}`),
      )!
      const root = path.join(tmp.path, ".octo", t.session_id, "outputs")
      const previous = process.env.OCTO_ARTIFACT_SCRIPTS
      process.env.OCTO_ARTIFACT_SCRIPTS = "1"
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (previous === undefined) delete process.env.OCTO_ARTIFACT_SCRIPTS
          else process.env.OCTO_ARTIFACT_SCRIPTS = previous
        }),
      )
      yield* ArtifactTracking.aroundTool(
        assistant.message_id,
        "powershell",
        Effect.gen(function* () {
          yield* Effect.promise(() => mkdir(root, { recursive: true }))
          yield* Effect.promise(() => writeFile(path.join(root, "left-behind.md"), "complete"))
          return yield* Effect.fail(new Error("script exited nonzero"))
        }),
      ).pipe(Effect.flip)
      expect(extend().some((e) => e.source === "script")).toBe(false)
      expect(Database.use((db) => db.select().from(Observations).get())?.reason).toBe("completion-unconfirmed")
    }).pipe(Effect.scoped),
  )
  test("persisted observed scan can replay after restart", async () => {
    await using tmp = await tmpdir()
    const t = seed(tmp.path)
    const root = path.join(tmp.path, ".octo", t.session_id, "outputs")
    const previous = await snapshot(root)
    await mkdir(root, { recursive: true })
    await writeFile(path.join(root, "report.md"), "new")
    const observed = await snapshot(root)
    Database.use((db) =>
      db
        .insert(Scans)
        .values({
          message_id: t.message_id,
          baseline: JSON.stringify({ snapshot: previous, observed, occurredAt: 2000, tool: "powershell" }),
          diagnostic: "observed",
          updated_at: 2000,
        })
        .run(),
    )
    recoverScans()
    recoverScans()
    expect(rows()).toHaveLength(0)
    const observations = Database.use((db) => db.select().from(Observations).all())
    expect(observations).toHaveLength(1)
    expect(JSON.parse(observations[0].detail!).occurredAt).toBe(2000)
  })
  test("separate processes recover on-disk tool facts and observed scans", async () => {
    await using tmp = await tmpdir()
    const run = async (phase: string) => {
      const proc = Bun.spawn([process.execPath, "run", path.join(import.meta.dir, "restart-fixture.ts"), phase], {
        env: { ...process.env, OPENCODE_DB: path.join(tmp.path, "restart.db") },
        stdout: "pipe",
        stderr: "pipe",
      })
      const [exit, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ])
      expect({ exit, stderr: exit === 0 ? "" : stderr }).toEqual({ exit: 0, stderr: "" })
      return stdout
    }
    await run("seed")
    expect(await run("recover")).toContain("recovered=1")
    expect(await run("recover")).toContain("recovered=1")
  })
})
