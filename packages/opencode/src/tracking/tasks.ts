import { randomUUID } from "node:crypto"
import { and, eq, inArray, lte, or } from "drizzle-orm"
import { BUILTIN_MCP_SERVERS } from "@/config/builtin-mcp"
import { GlobalBus } from "@/bus/global"
import { callRemoteToolDirect } from "@/mcp"
import { Database } from "@/storage/db"
import { PartTable } from "@/session/session.sql"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { ArtifactTaskTable as Tasks, ArtifactTurnTable as Turns } from "./artifact.sql"
import { artifacts, mcpFact, record, string, taskInfo, unresolvedResources } from "./facts"
import { enqueue, observe } from "./store"

const LEASE_MS = 60_000
const POLL_MS = 15_000
const MAX_POLL_MS = 5 * 60_000

export type Task = typeof Tasks.$inferSelect

export function claimTask(now = Date.now()) {
  return Database.Client().transaction(
    (db) => {
      const row = db
        .select()
        .from(Tasks)
        .where(
          or(
            and(eq(Tasks.state, "pending"), lte(Tasks.next_at, now)),
            and(eq(Tasks.state, "waiting_auth"), lte(Tasks.next_at, now)),
            and(eq(Tasks.state, "polling"), lte(Tasks.lease_until, now)),
          ),
        )
        .orderBy(Tasks.next_at)
        .get()
      if (!row) return
      if (row.deadline_at && row.deadline_at <= now) {
        db.update(Tasks)
          .set({
            state: "timed_out",
            error: "task polling deadline exceeded",
            lease: null,
            lease_until: null,
            updated_at: now,
          })
          .where(eq(Tasks.id, row.id))
          .run()
        observe(db, {
          messageID: row.message_id,
          taskID: row.task_id ?? undefined,
          kind: "async-task",
          status: "terminal",
          reason: "timed-out",
        })
        return
      }
      const lease = randomUUID()
      db.update(Tasks)
        .set({ state: "polling", lease, lease_until: now + LEASE_MS, attempts: row.attempts + 1, updated_at: now })
        .where(eq(Tasks.id, row.id))
        .run()
      return { ...row, lease, attempts: row.attempts + 1 }
    },
    { behavior: "immediate" },
  )
}

function status(result: unknown) {
  const fact = mcpFact(result)
  if (fact.isError) return "failed"
  return string(record(fact.structuredContent).status)?.toLowerCase()
}

export function finishTask(row: NonNullable<ReturnType<typeof claimTask>>, result: unknown, now = Date.now()) {
  const fact = mcpFact(result)
  const current = status(result)
  const terminal = ["completed", "failed", "stopped", "cancelled"].includes(current ?? "")
  const published = Database.Client().transaction((db) => {
    const owned = db
      .select()
      .from(Tasks)
      .where(and(eq(Tasks.id, row.id), eq(Tasks.lease, row.lease), eq(Tasks.state, "polling")))
      .get()
    if (!owned) return
    const turn = db.select().from(Turns).where(eq(Turns.message_id, row.message_id)).get()
    if (!turn) {
      db.update(Tasks)
        .set({ state: "failed", error: "origin turn missing", lease: null, lease_until: null, updated_at: now })
        .where(eq(Tasks.id, row.id))
        .run()
      return
    }
    const part = {
      type: "tool",
      tool: `${row.provider ?? "unknown"}_${row.query_tool ?? "get_task_result"}`,
      state: { status: "completed", metadata: { octoArtifactResult: fact }, time: { end: now } },
    }
    const found = current === "completed" ? artifacts(part, turn.directory) : []
    for (const item of found) enqueue(db, turn, item)
    const unresolved = current === "completed" ? unresolvedResources(part) : []
    const nextState =
      current === "completed"
        ? "succeeded"
        : current === "failed"
          ? "failed"
          : current === "stopped" || current === "cancelled"
            ? "cancelled"
            : "pending"
    const resultPartID =
      current === "completed" && row.assistant_message_id && row.session_id
        ? (row.result_part_id ?? PartID.ascending())
        : row.result_part_id
    const data =
      current === "completed" && resultPartID && row.assistant_message_id && row.session_id && !row.result_part_id
        ? ({
            type: "tool",
            tool: `${row.provider ?? "unknown"}_${row.query_tool ?? "get_task_result"}`,
            callID: `artifact-auto-${row.task_id}`,
            state: {
              status: "completed",
              input: record(row.query_input ? JSON.parse(row.query_input) : {}),
              output: JSON.stringify(fact),
              metadata: {
                structuredContent: fact.structuredContent,
                octoArtifactResult: fact,
                octoArtifactOwner: turn.owner,
                octoArtifactAutomatic: true,
              },
              title: "",
              time: { start: now, end: now },
            },
          } as typeof PartTable.$inferInsert.data)
        : undefined
    if (data && resultPartID && row.assistant_message_id && row.session_id) {
      db.insert(PartTable)
        .values({
          id: PartID.make(resultPartID),
          message_id: MessageID.make(row.assistant_message_id),
          session_id: SessionID.make(row.session_id),
          time_created: now,
          time_updated: now,
          data,
        })
        .onConflictDoNothing()
        .run()
    }
    db.update(Tasks)
      .set({
        state: nextState,
        next_at: terminal ? 0 : now + POLL_MS,
        lease: null,
        lease_until: null,
        error: current === "failed" ? "provider reported failure" : null,
        updated_at: now,
        result_part_id: resultPartID,
      })
      .where(eq(Tasks.id, row.id))
      .run()
    observe(db, {
      messageID: turn.root_message_id,
      taskID: row.task_id ?? undefined,
      kind: "async-task",
      status: terminal ? "terminal" : "pending",
      reason: unresolved.length
        ? "identity-unresolved"
        : found.length
          ? "events-created"
          : (current ?? "provider-status-missing"),
      detail: { provider: row.provider, eventCount: found.length, unresolvedCount: unresolved.length },
    })
    if (!data || !resultPartID || !row.assistant_message_id || !row.session_id) return
    return {
      directory: turn.directory,
      part: {
        id: PartID.make(resultPartID),
        messageID: MessageID.make(row.assistant_message_id),
        sessionID: SessionID.make(row.session_id),
        ...data,
      },
    }
  })
  if (!published) return
  GlobalBus.emit("event", {
    directory: published.directory,
    payload: {
      type: "message.part.updated",
      properties: { sessionID: published.part.sessionID, part: published.part, time: now },
    },
  })
}

export function failTask(row: NonNullable<ReturnType<typeof claimTask>>, error: unknown, now = Date.now()) {
  const message = error instanceof Error ? error.message : String(error)
  const waitingAuth = /401|403|unauthori[sz]ed|authentication/i.test(message)
  Database.use((db) => {
    db.update(Tasks)
      .set({
        state: waitingAuth ? "waiting_auth" : "pending",
        next_at: waitingAuth
          ? now + MAX_POLL_MS
          : now + Math.min(MAX_POLL_MS, POLL_MS * 2 ** Math.min(row.attempts, 5)),
        lease: null,
        lease_until: null,
        error: message,
        updated_at: now,
      })
      .where(and(eq(Tasks.id, row.id), eq(Tasks.lease, row.lease), eq(Tasks.state, "polling")))
      .run()
    observe(db, {
      messageID: row.message_id,
      taskID: row.task_id ?? undefined,
      kind: "async-task",
      status: waitingAuth ? "paused" : "pending",
      reason: waitingAuth ? "waiting-auth" : "poll-failed",
      detail: { error: message },
    })
  })
}

export async function queryTask(row: Task) {
  if (row.provider !== "uxr-tool") throw new Error(`unsupported MCP provider: ${row.provider ?? "unknown"}`)
  const config = BUILTIN_MCP_SERVERS["uxr-tool"]
  if (config.type !== "remote") throw new Error("uxr-tool is not a remote MCP server")
  return callRemoteToolDirect(
    "uxr-tool",
    config,
    row.query_tool ?? "get_task_result",
    JSON.parse(row.query_input ?? JSON.stringify({ task_id: row.task_id })),
  )
}

export async function pollTasks(query: (task: Task) => Promise<unknown> = queryTask) {
  for (let i = 0; i < 5; i++) {
    const row = claimTask()
    if (!row) break
    await query(row)
      .then((result) => finishTask(row, result))
      .catch((error) => failTask(row, error))
  }
}

export function resumeWaitingAuth(now = Date.now()) {
  Database.use((db) =>
    db
      .update(Tasks)
      .set({ state: "pending", next_at: now, error: null, updated_at: now })
      .where(inArray(Tasks.state, ["waiting_auth"]))
      .run(),
  )
}

export * as ArtifactTasks from "./tasks"
