import { and, eq, isNull, lt, or, sql } from "drizzle-orm"
import { Database } from "@/storage/db"
import { MessageTable, PartTable } from "@/session/session.sql"
import {
  ArtifactEventTable as Events,
  ArtifactFactTable as Facts,
  ArtifactTaskTable as Tasks,
  ArtifactTurnTable as Turns,
} from "./artifact.sql"
import { artifacts, hash, record, string, taskInfo, toolIs, type Artifact } from "./facts"

export type Turn = typeof Turns.$inferSelect
export const QUEUE_LIMIT = 50_000
export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000
export const RECEIPT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000

export function mode(): Turn["owner"] {
  // Formal sending requires an explicitly selected success contract and rollout mode.
  return process.env.OCTO_ARTIFACT_TRACKING === "server" &&
    process.env.OCTO_REPORT_BASE_URL &&
    ["http-2xx", "code-0"].includes(process.env.OCTO_ARTIFACT_SUCCESS ?? "")
    ? "server"
    : "diagnostic"
}

export function readTurn(messageID: string) {
  return Database.use((db) => db.select().from(Turns).where(eq(Turns.message_id, messageID)).get())
}

export function assistantTurn(messageID: string) {
  const msg = Database.use((db) =>
    db
      .select()
      .from(MessageTable)
      .where(sql`${MessageTable.id} = ${messageID}`)
      .get(),
  )
  const parent = string(record(msg?.data).parentID)
  return msg?.data.role === "assistant" && parent ? readTurn(parent) : undefined
}

export function beginTurn(input: {
  messageID: string
  sessionID: string
  directory: string
  createdAt: number
  agent: string
  extra?: Record<string, unknown>
}) {
  const existing = readTurn(input.messageID)
  if (existing) return existing
  if (input.agent !== "octo_insight") return
  const user = record(input.extra?.artifactTracking)
  const turn: Turn = {
    message_id: input.messageID,
    session_id: input.sessionID,
    root_message_id: input.messageID,
    root_session_id: input.sessionID,
    directory: input.directory,
    account: string(input.extra?.account) ?? null,
    uid: string(user.uid) ?? null,
    version: string(user.version) ?? null,
    owner: mode(),
    created_at: input.createdAt,
  }
  Database.use((db) => db.insert(Turns).values(turn).onConflictDoNothing().run())
  return readTurn(input.messageID)
}

export function inheritTurn(parentAssistantID: string, sessionID: string, messageID: string) {
  const parent = assistantTurn(parentAssistantID)
  if (!parent) return
  Database.use((db) =>
    db
      .insert(Turns)
      .values({ ...parent, message_id: messageID, session_id: sessionID })
      .onConflictDoNothing()
      .run(),
  )
}

export function taskKey(sessionID: string, tool: string, taskID: string) {
  // task IDs are namespaced by MCP server prefix as well as session.
  const bare = [
    "get_task_result",
    "stop_task",
    "key_findings",
    "run_guide_analysis",
    "run_usability_analysis",
    "mindmap",
  ].find((n) => toolIs(tool, n))
  return hash(JSON.stringify([sessionID, bare ? tool.slice(0, -bare.length) : tool, taskID]))
}

export function resultTurn(turn: Turn, tool: string, taskID?: string) {
  if (!toolIs(tool, "get_task_result")) return turn
  if (!taskID) return
  const task = Database.use((db) =>
    db
      .select()
      .from(Tasks)
      .where(eq(Tasks.id, taskKey(turn.root_session_id, tool, taskID)))
      .get(),
  )
  if (task) return readTurn(task.message_id)
  // Recover attribution independently of queue capacity / the replay batch size.
  // A polling result must not fall back to the new turn while its submission is backlogged.
  const submissions = Database.use((db) =>
    db
      .select({ part: PartTable, origin: Turns })
      .from(PartTable)
      .innerJoin(MessageTable, eq(MessageTable.id, PartTable.message_id))
      .innerJoin(Turns, sql`${Turns.message_id} = json_extract(${MessageTable.data}, '$.parentID')`)
      .where(
        and(
          eq(Turns.root_session_id, turn.root_session_id),
          sql`json_extract(${PartTable.data}, '$.state.status') = 'completed'`,
        ),
      )
      .orderBy(PartTable.time_created, PartTable.id)
      .all(),
  )
  const submission = submissions.find((row) => {
    const name = string(record(row.part.data).tool) ?? ""
    return (
      !toolIs(name, "get_task_result") &&
      !toolIs(name, "stop_task") &&
      taskInfo(row.part.data).id === taskID &&
      taskKey(turn.root_session_id, name, taskID) === taskKey(turn.root_session_id, tool, taskID)
    )
  })
  if (!submission) return
  Database.use((db) =>
    db
      .insert(Tasks)
      .values({
        id: taskKey(turn.root_session_id, tool, taskID),
        message_id: submission.origin.message_id,
        tool: String(record(submission.part.data).tool),
      })
      .onConflictDoNothing()
      .run(),
  )
  return submission.origin
}

export function payload(turn: Turn, item: Artifact, id: string) {
  return JSON.stringify({
    account: turn.account,
    uid: turn.uid ?? undefined,
    browserName: "server",
    browserVersion: "",
    userAgent: "octo-agent-server",
    os: process.platform === "win32" ? "Windows" : process.platform === "darwin" ? "macOS" : "Linux",
    platform: process.platform === "win32" ? 1 : process.platform === "darwin" ? 2 : 3,
    project: "octo-agent",
    module: "insight",
    datas: [
      {
        type: "interaction",
        subType: "click",
        name: item.name,
        path: `/insight/${turn.root_session_id}`,
        extend: JSON.stringify({
          files: [{ type: item.type, count: 1, ...(item.tool ? { tool: item.tool } : {}) }],
          schemaVersion: 2,
          eventId: id,
          sessionId: turn.root_session_id,
          messageId: turn.root_message_id,
          source: item.source,
          occurredAt: new Date(item.occurredAt || turn.created_at).toISOString(),
          ...(turn.version ? { version: turn.version } : {}),
        }),
      },
    ],
  })
}

export function enqueue(db: Database.TxOrDb, turn: Turn, item: Artifact) {
  const id = hash(JSON.stringify([turn.root_session_id, turn.root_message_id, item.name, item.identity]))
  if (db.select({ id: Events.id }).from(Events).where(eq(Events.id, id)).get()) return
  const count =
    db
      .select({ count: sql<number>`count(*)` })
      .from(Events)
      .where(or(eq(Events.state, "pending"), eq(Events.state, "sending")))
      .get()?.count ?? 0
  if (count >= QUEUE_LIMIT) throw new Error("artifact queue capacity reached; fact retained for replay")
  db.insert(Events)
    .values({
      id,
      message_id: turn.root_message_id,
      payload: payload(turn, item, id),
      state: !turn.account ? "missing-account" : turn.owner === "diagnostic" ? "diagnostic" : "pending",
      created_at: Date.now(),
      reason: !turn.account ? "origin account missing" : null,
    })
    .onConflictDoNothing()
    .run()
}

// No advancing time cursor: each terminal part has an atomic receipt with its events.
// A crash after saving a tool result but before this transaction leaves it replayable.
export function replay(limit = 100) {
  const rows = Database.use((db) =>
    db
      .select({ part: PartTable, turn: Turns })
      .from(PartTable)
      .innerJoin(MessageTable, eq(MessageTable.id, PartTable.message_id))
      .innerJoin(Turns, sql`${Turns.message_id} = json_extract(${MessageTable.data}, '$.parentID')`)
      .leftJoin(Facts, eq(Facts.part_id, PartTable.id))
      .where(
        and(
          isNull(Facts.part_id),
          sql`json_extract(${PartTable.data}, '$.type') = 'tool'`,
          sql`json_extract(${PartTable.data}, '$.state.status') IN ('completed', 'error')`,
        ),
      )
      .orderBy(PartTable.time_created, PartTable.id)
      .limit(limit)
      .all(),
  )
  for (const row of rows) {
    Database.Client().transaction((db) => {
      const part = record(row.part.data)
      if (part.type !== "tool") return
      const tool = string(part.tool) ?? ""
      const task = taskInfo(part)
      const query = toolIs(tool, "get_task_result") || toolIs(tool, "stop_task")
      if (task.id && !query)
        db.insert(Tasks)
          .values({ id: taskKey(row.turn.root_session_id, tool, task.id), message_id: row.turn.message_id, tool })
          .onConflictDoNothing()
          .run()
      const origin =
        query && task.id
          ? db
              .select()
              .from(Tasks)
              .where(eq(Tasks.id, taskKey(row.turn.root_session_id, tool, task.id)))
              .get()
          : undefined
      const turn = query
        ? origin && db.select().from(Turns).where(eq(Turns.message_id, origin.message_id)).get()
        : row.turn
      // Unknown tasks predate rollout: never assign them to the polling turn.
      if (query && !turn) {
        console.warn("[octo:artifact] unresolved-task-origin", { partId: row.part.id })
        db.insert(Facts).values({ part_id: row.part.id, created_at: Date.now() }).onConflictDoNothing().run()
        return
      }
      if (turn) for (const item of artifacts(part, turn.directory)) enqueue(db, turn, item)
      db.insert(Facts).values({ part_id: row.part.id, created_at: Date.now() }).onConflictDoNothing().run()
    })
  }
  return rows.length
}

export function cleanup(now = Date.now()) {
  Database.Client().transaction((db) => {
    db.update(Events)
      .set({ state: "failed", reason: "retention expired", payload: null, lease: null, lease_until: null })
      .where(
        and(lt(Events.created_at, now - RETENTION_MS), or(eq(Events.state, "pending"), eq(Events.state, "sending"))),
      )
      .run()
    db.update(Events)
      .set({ payload: null })
      .where(and(lt(Events.created_at, now - RETENTION_MS), sql`${Events.state} NOT IN ('pending', 'sending')`))
      .run()
    db.run(sql`DELETE FROM insight_artifact_task WHERE message_id IN (
      SELECT message_id FROM insight_artifact_turn WHERE created_at < ${now - RECEIPT_RETENTION_MS}
    )`)
    db.run(sql`DELETE FROM insight_artifact_scan WHERE message_id IN (
      SELECT root_message_id FROM insight_artifact_turn WHERE created_at < ${now - RECEIPT_RETENTION_MS}
    )`)
    db.run(sql`DELETE FROM insight_artifact_turn WHERE created_at < ${now - RECEIPT_RETENTION_MS}
      AND NOT EXISTS (
        SELECT 1 FROM insight_artifact_event
        WHERE insight_artifact_event.message_id = insight_artifact_turn.root_message_id
          AND insight_artifact_event.state IN ('pending', 'sending')
      )`)
    db.run(sql`DELETE FROM insight_artifact_fact WHERE NOT EXISTS (
      SELECT 1 FROM part
      INNER JOIN message ON message.id = part.message_id
      INNER JOIN insight_artifact_turn ON insight_artifact_turn.message_id = json_extract(message.data, '$.parentID')
      WHERE part.id = insight_artifact_fact.part_id
    )`)
    db.delete(Events)
      .where(and(lt(Events.created_at, now - RECEIPT_RETENTION_MS), sql`${Events.state} NOT IN ('pending', 'sending')`))
      .run()
  })
}
