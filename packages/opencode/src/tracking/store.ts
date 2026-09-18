import { and, eq, isNull, sql } from "drizzle-orm"
import { Database } from "@/storage/db"
import { MessageTable, PartTable } from "@/session/session.sql"
import { MessageV2 } from "@/session/message-v2"
import {
  ArtifactEventTable as Event,
  ArtifactTurnTable as Turn,
  ArtifactTaskTable as Task,
  ArtifactReceiptTable as Receipt,
} from "./delivery.sql"
import { fileFact, hash, record, string, type MCPFacts } from "./facts"
import { resolveOutputType } from "./output-type"

export function begin(input: {
  messageID: string
  sessionID: string
  directory: string
  extra?: Record<string, unknown>
}) {
  // Opt in only at the Insight prompt boundary; other products use the same tools.
  if (record(input.extra?.artifactTracking).module !== "insight") return
  Database.use((db) =>
    db
      .insert(Turn)
      .values({
        message_id: input.messageID,
        session_id: input.sessionID,
        root_message_id: input.messageID,
        root_session_id: input.sessionID,
        directory: input.directory,
        account: string(input.extra?.account) || null,
        uid: string(record(input.extra?.artifactTracking).uid) || null,
        version: string(record(input.extra?.artifactTracking).version) || null,
        created_at: Date.now(),
      })
      .onConflictDoNothing()
      .run(),
  )
}

function parent(messageID: string) {
  return Database.use(
    (db) =>
      db
        .select({ turn: Turn })
        .from(MessageTable)
        .innerJoin(Turn, sql`${Turn.message_id} = json_extract(${MessageTable.data}, '$.parentID')`)
        .where(sql`${MessageTable.id} = ${messageID}`)
        .get()?.turn,
  )
}

export function enabled(assistantID: string) {
  return Boolean(parent(assistantID))
}

export function inherit(assistantID: string, messageID: string, sessionID: string, directory: string) {
  const turn = parent(assistantID)
  if (!turn) return
  Database.use((db) =>
    db
      .insert(Turn)
      .values({ ...turn, message_id: messageID, session_id: sessionID, directory })
      .onConflictDoNothing()
      .run(),
  )
}

export function collect(part: MessageV2.ToolPart) {
  if (part.state.status !== "completed") return
  const turn = parent(part.messageID)
  if (!turn) return
  const state = part.state
  const mcp = state.metadata.artifactDelivery as MCPFacts | undefined
  Database.Client().transaction(
    (db) => {
      if (db.select().from(Receipt).where(eq(Receipt.part_id, part.id)).get()?.state === "processed") return
      const receipt = (reason: string, pending = false) =>
        db
          .insert(Receipt)
          .values({
            part_id: part.id,
            message_id: turn.message_id,
            tool: part.tool,
            task_id: mcp?.taskId || null,
            state: pending ? "pending" : "processed",
            reason,
            updated_at: Date.now(),
          })
          .onConflictDoUpdate({
            target: Receipt.part_id,
            set: {
              state: pending ? "pending" : "processed",
              reason,
              updated_at: Date.now(),
            },
          })
          .run()
      const enqueue = (
        owner: typeof turn,
        name: string,
        identity: string,
        type: string,
        source: string,
        tool?: string,
      ) => {
        const id = hash(owner.root_session_id, owner.root_message_id, name, identity)
        db.insert(Event)
          .values({
            id,
            message_id: owner.root_message_id,
            part_id: part.id,
            name,
            state: owner.account ? "pending" : "blocked",
            reason: owner.account ? null : "missing-original-account",
            created_at: state.time.end,
            next_at: Date.now(),
            payload: {
              account: owner.account ?? "",
              uid: owner.uid ?? undefined,
              browserName: "server",
              browserVersion: "",
              os: process.platform === "win32" ? "Windows" : process.platform === "darwin" ? "macOS" : "Linux",
              platform: process.platform === "win32" ? 1 : process.platform === "darwin" ? 2 : 3,
              project: "octo-agent",
              userAgent: "octo-artifact-server",
              module: "insight",
              datas: [
                {
                  type: "interaction",
                  subType: "click",
                  name,
                  path: "/insight",
                  extend: JSON.stringify({
                    files: [{ type, count: 1, ...(tool ? { tool } : {}) }],
                    eventId: id,
                    sessionId: owner.root_session_id,
                    messageId: owner.root_message_id,
                    toolCallId: part.callID,
                    taskId: mcp?.taskId || undefined,
                    source,
                    occurredAt: state.time.end,
                    version: owner.version ?? undefined,
                  }),
                },
              ],
            },
          })
          .onConflictDoNothing()
          .run()
      }
      const file = fileFact(part.tool, state.input, state.metadata, turn.directory)
      if (file) {
        enqueue(turn, file.name, file.identity, file.type, part.tool)
        receipt("file-enqueued")
        return
      }
      if (!mcp) {
        receipt(part.tool === "write" || part.tool === "edit" ? "missing-file-path" : "tool-not-integrated")
        return
      }
      if (mcp.provider === "unknown") {
        receipt("unknown-mcp-provider", true)
        return
      }
      if (mcp.isError) {
        receipt("mcp-error")
        return
      }
      if (mcp.status && ["failed", "stopped", "cancelled", "error"].includes(mcp.status)) {
        receipt("mcp-not-successful")
        return
      }
      if (mcp.tool === "stop_task") {
        receipt("task-control-result")
        return
      }
      const taskID = mcp.taskId || string(state.input.task_id)
      const key = hash(turn.root_session_id, mcp.provider, taskID)
      const query = mcp.tool === "get_task_result"
      if (taskID && !query)
        db.insert(Task).values({ id: key, message_id: turn.message_id, tool: mcp.tool }).onConflictDoNothing().run()
      const task = taskID ? db.select().from(Task).where(eq(Task.id, key)).get() : undefined
      const owner = task ? db.select().from(Turn).where(eq(Turn.message_id, task.message_id)).get() : turn
      if (query && !task) {
        receipt("missing-task-origin", true)
        return
      }
      if (!owner) {
        receipt("missing-turn-origin", true)
        return
      }
      if (taskID && mcp.status !== "completed") {
        receipt("task-not-completed")
        return
      }
      if (!mcp.resources.length) {
        receipt("no-artifact-resource")
        return
      }
      if (task?.completed_part_id) {
        receipt("task-manifest-already-captured")
        return
      }
      // UXR completed results are immutable full manifests (the UI uses the same contract).
      // Freeze the first manifest atomically. Local slot IDs never depend on renewable URIs.
      // Other providers must supply stable IDs; names/URLs do not silently become identities.
      const immutable =
        mcp.provider === "uxr-tool" &&
        task &&
        ["key_findings", "run_guide_analysis", "run_usability_analysis", "mindmap"].includes(task.tool)
      if (!immutable && mcp.resources.some((item) => !item.id)) {
        receipt("missing-stable-resource-id", true)
        return
      }
      mcp.resources.forEach((item, index) =>
        enqueue(
          owner,
          "artifact-mcp-return",
          hash(mcp.provider, taskID, item.id || `manifest-slot:${index}`),
          resolveOutputType(item.name, item.mime),
          "mcp",
          item.tool || task?.tool || mcp.tool,
        ),
      )
      if (task) db.update(Task).set({ completed_part_id: part.id }).where(eq(Task.id, key)).run()
      receipt("mcp-enqueued")
    },
    { behavior: "immediate" },
  )
  return true
}

// Only parts belonging to newly enrolled turns are replayed. No adoption of historical turns.
export function recover() {
  const parts = Database.use((db) =>
    db
      .select({
        id: PartTable.id,
        messageID: PartTable.message_id,
        sessionID: PartTable.session_id,
        data: PartTable.data,
      })
      .from(PartTable)
      .innerJoin(MessageTable, eq(MessageTable.id, PartTable.message_id))
      .innerJoin(Turn, sql`${Turn.message_id} = json_extract(${MessageTable.data}, '$.parentID')`)
      .leftJoin(Receipt, eq(Receipt.part_id, PartTable.id))
      .where(
        and(
          sql`json_extract(${PartTable.data}, '$.type') = 'tool'`,
          sql`json_extract(${PartTable.data}, '$.state.status') = 'completed'`,
          isNull(Receipt.part_id),
        ),
      )
      .orderBy(PartTable.time_created)
      .all(),
  )
  for (const item of parts) {
    const part = MessageV2.Part.zod.safeParse({
      ...item.data,
      id: item.id,
      messageID: item.messageID,
      sessionID: item.sessionID,
    })
    if (part.success && part.data.type === "tool") collect(part.data)
  }
  const pending = Database.use((db) =>
    db
      .select({
        id: PartTable.id,
        messageID: PartTable.message_id,
        sessionID: PartTable.session_id,
        data: PartTable.data,
      })
      .from(PartTable)
      .innerJoin(Receipt, eq(Receipt.part_id, PartTable.id))
      .where(eq(Receipt.state, "pending"))
      .all(),
  )
  for (const item of pending) {
    const part = MessageV2.Part.zod.safeParse({
      ...item.data,
      id: item.id,
      messageID: item.messageID,
      sessionID: item.sessionID,
    })
    if (part.success && part.data.type === "tool") collect(part.data)
  }
}

export * as ArtifactStore from "./store"
