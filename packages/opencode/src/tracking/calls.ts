import { randomUUID } from "node:crypto"
import { and, eq, isNull, sql } from "drizzle-orm"
import { Cause, Effect, Exit } from "effect"
import { Database } from "@/storage/db"
import { MessageTable, PartTable } from "@/session/session.sql"
import { ArtifactEventTable as Events, ArtifactTurnTable as Turns } from "./delivery.sql"
import { ToolCallTable as Calls, ToolCallParentTable as Parents } from "./calls.sql"
import { capture, failure, resultFacts } from "./call-data"
import { hash, record, string } from "./facts"

type Descriptor = { kind: "builtin" | "plugin" | "mcp"; provider?: string; transport?: string }
type Input = { messageID: string; sessionID: string; callID: string; tool: string; args: unknown; partID?: string }
const token = randomUUID()
const catalogs = new Map<string, Record<string, Descriptor>>()

export const safely = <A>(run: () => A) =>
  Effect.sync(run).pipe(
    Effect.catchDefect(() => Effect.logWarning("[octo:tool-call] capture deferred").pipe(Effect.as(undefined))),
  )

export function configure(messageID: string, tools: Record<string, Descriptor>) {
  catalogs.set(messageID, tools)
}

export function id(messageID: string, callID: string) {
  return hash("agent-tool-call", messageID, callID)
}

function enqueue(
  db: Database.Transaction,
  row: typeof Calls.$inferSelect,
  phase: "start" | "end",
  data: Record<string, unknown>,
) {
  const eventId = hash(row.id, phase)
  const name = `agent-tool-call-${phase}`
  const extend = { ...data, argumentsHash: undefined, schemaVersion: 1, eventId, invocationId: row.id, phase }
  const encoded = JSON.stringify(extend)
  // Keep identity/status even if a future adapter supplies an oversized field.
  const bounded =
    Buffer.byteLength(encoded) <= 32768
      ? encoded
      : JSON.stringify({
          ...record(
            capture(
              {
                ...extend,
                effectiveArguments: undefined,
                arguments: undefined,
                resultSummary: undefined,
                toolDetails: undefined,
                redactedFields: undefined,
                omittedFields: undefined,
                resultRedactedFields: undefined,
                resultOmittedFields: undefined,
              },
              30 * 1024,
            ).value,
          ),
          schemaVersion: 1,
          eventId,
          invocationId: row.id,
          phase,
          payloadTruncated: true,
        })
  db.insert(Events)
    .values({
      id: eventId,
      message_id: string(data.rootMessageId),
      part_id: string(data.partId) || row.call_id,
      name,
      payload: {
        ...row.payload,
        datas: [{ type: "interaction", subType: "click", name, path: "/insight", extend: bounded }],
      },
      state: row.payload.account ? "pending" : "blocked",
      reason: row.payload.account ? null : "missing-original-account",
      created_at: Number(data.occurredAt),
      next_at: Date.now(),
    })
    .onConflictDoNothing()
    .run()
}

export function start(input: Input, descriptor = catalogs.get(input.messageID)?.[input.tool], now = Date.now()) {
  const invocationId = id(input.messageID, input.callID)
  if (Database.use((db) => db.select().from(Calls).where(eq(Calls.id, invocationId)).get())) {
    if (input.partID) update(input.messageID, input.callID, { partId: input.partID })
    return invocationId
  }
  const owner = Database.use((db) =>
    db
      .select({ turn: Turns, message: MessageTable.data })
      .from(MessageTable)
      .innerJoin(Turns, sql`${Turns.message_id} = json_extract(${MessageTable.data}, '$.parentID')`)
      .where(sql`${MessageTable.id} = ${input.messageID}`)
      .get(),
  )
  if (!owner) return
  const parent = Database.use((db) =>
    db.select().from(Parents).where(eq(Parents.message_id, owner.turn.message_id)).get(),
  )
  const ancestor =
    parent && Database.use((db) => db.select().from(Calls).where(eq(Calls.id, parent.invocation_id)).get())
  const args = capture(input.args)
  const message = record(owner.message)
  const data = {
    toolName:
      descriptor?.kind === "mcp" && descriptor.provider
        ? input.tool.slice(descriptor.provider.replace(/[^a-zA-Z0-9_-]/g, "_").length + 1)
        : input.tool,
    registeredToolName: input.tool,
    toolKind: descriptor?.kind,
    toolProvider: descriptor?.provider,
    transport: descriptor?.transport,
    agent: message.agent,
    rootAgent: ancestor?.data.rootAgent ?? message.agent,
    sessionId: input.sessionID,
    rootSessionId: owner.turn.root_session_id,
    messageId: input.messageID,
    rootMessageId: owner.turn.root_message_id,
    partId: input.partID,
    toolCallId: input.callID,
    parentInvocationId: parent?.invocation_id,
    parentSessionId: ancestor?.data.sessionId,
    depth: Number(ancestor?.data.depth ?? -1) + 1,
    modelProvider: message.providerID,
    modelId: message.modelID,
    triggerSource: "model",
    requestedAt: now,
    occurredAt: now,
    arguments: args.value,
    argumentsTruncated: args.truncated,
    argumentsHash: hash(JSON.stringify(input.args) ?? ""),
    argumentsBytes: Buffer.byteLength(JSON.stringify(input.args) ?? ""),
    redactedFields: args.redactedFields,
    omittedFields: args.omittedFields,
    executionStarted: false,
    executionStage: "validation",
    version: owner.turn.version ?? undefined,
    environment: process.env.NODE_ENV,
  }
  const row = {
    id: invocationId,
    message_id: input.messageID,
    call_id: input.callID,
    process_id: process.pid,
    process_token: token,
    started_at: now,
    ended_at: null,
    data,
    payload: {
      account: owner.turn.account ?? "",
      uid: owner.turn.uid ?? undefined,
      browserName: "server",
      browserVersion: "",
      userAgent: "octo-tool-call-server",
      project: "octo-agent",
      module: "insight",
      os: process.platform === "win32" ? "Windows" : process.platform === "darwin" ? "macOS" : "Linux",
      platform: process.platform === "win32" ? 1 : process.platform === "darwin" ? 2 : 3,
    },
  }
  Database.Client().transaction((db) => {
    db.insert(Calls).values(row).onConflictDoNothing().run()
    enqueue(db, row, "start", data)
  })
  return invocationId
}

export function update(messageID: string, callID: string, fields: Record<string, unknown>) {
  Database.Client().transaction((db) => {
    const row = db
      .select()
      .from(Calls)
      .where(eq(Calls.id, id(messageID, callID)))
      .get()
    if (!row || row.ended_at !== null) return
    db.update(Calls)
      .set({ data: { ...row.data, ...fields } })
      .where(eq(Calls.id, row.id))
      .run()
  })
}

export function executing(messageID: string, callID: string) {
  const row = Database.use((db) =>
    db
      .select()
      .from(Calls)
      .where(eq(Calls.id, id(messageID, callID)))
      .get(),
  )
  if (!row) return
  update(messageID, callID, {
    executionStarted: true,
    executionStartedAt: row.data.executionStartedAt ?? Date.now(),
    executionStage: "execution",
    executionPermissionWaitBase: row.data.executionPermissionWaitBase ?? row.data.permissionWaitMs ?? 0,
  })
}

export function parameters(messageID: string, callID: string, args: unknown) {
  const row = Database.use((db) =>
    db
      .select()
      .from(Calls)
      .where(eq(Calls.id, id(messageID, callID)))
      .get(),
  )
  if (!row) return
  const captured = capture(args)
  const changed = hash(JSON.stringify(args) ?? "") !== row.data.argumentsHash
  const input = record(args)
  update(messageID, callID, {
    argumentsChanged: changed,
    effectiveArguments: changed ? captured.value : undefined,
    argumentsTruncated: row.data.argumentsTruncated === true || captured.truncated,
    redactedFields: [...new Set([...(row.data.redactedFields as string[]), ...captured.redactedFields])].slice(0, 16),
    omittedFields: [...new Set([...(row.data.omittedFields as string[]), ...captured.omittedFields])].slice(0, 32),
    toolDetails: capture(
      {
        ...(row.data.registeredToolName === "bash"
          ? { artifactFiles: input.artifactFiles, workdir: input.workdir, timeout: input.timeout }
          : {}),
        ...(row.data.registeredToolName === "task" ? { subagentType: input.subagent_type } : {}),
        ...(["read", "write", "edit"].includes(string(row.data.registeredToolName))
          ? { filePath: input.filePath }
          : {}),
      },
      2048,
    ).value,
  })
}

export function end(messageID: string, callID: string, fields: Record<string, unknown>, now = Date.now()) {
  Database.Client().transaction((db) => {
    const row = db
      .select()
      .from(Calls)
      .where(eq(Calls.id, id(messageID, callID)))
      .get()
    if (!row || row.ended_at !== null) return
    const part = db
      .select({ id: PartTable.id })
      .from(PartTable)
      .where(
        and(sql`${PartTable.message_id} = ${messageID}`, sql`json_extract(${PartTable.data}, '$.callID') = ${callID}`),
      )
      .get()
    const data = {
      ...row.data,
      ...fields,
      arguments: undefined,
      mcpResult: undefined,
      executionPermissionWaitBase: undefined,
      occurredAt: now,
      endedAt: now,
      partId: part?.id ?? row.data.partId,
      toolDetails: { ...record(row.data.toolDetails), ...record(fields.toolDetails) },
      durationMs: Math.max(0, now - row.started_at),
      executionDurationMs:
        fields.executionStarted !== false && typeof row.data.executionStartedAt === "number"
          ? Math.max(
              0,
              now -
                row.data.executionStartedAt -
                Number(row.data.permissionWaitMs ?? 0) +
                Number(row.data.executionPermissionWaitBase ?? 0),
            )
          : undefined,
    }
    db.update(Calls).set({ ended_at: now, data }).where(eq(Calls.id, row.id)).run()
    enqueue(db, row, "end", data)
  })
}

export function inherit(messageID: string, callID: string | undefined, childMessageID: string) {
  if (!callID) return
  const invocationId = id(messageID, callID)
  if (!Database.use((db) => db.select().from(Calls).where(eq(Calls.id, invocationId)).get())) return
  Database.use((db) =>
    db.insert(Parents).values({ message_id: childMessageID, invocation_id: invocationId }).onConflictDoNothing().run(),
  )
}

export function permission<A, E, R>(messageID: string, callID: string, effect: Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const began = Date.now()
    yield* safely(() => update(messageID, callID, { executionStage: "permission" }))
    return yield* effect.pipe(
      Effect.onExit((exit) =>
        safely(() => {
          const row = Database.use((db) =>
            db
              .select()
              .from(Calls)
              .where(eq(Calls.id, id(messageID, callID)))
              .get(),
          )
          if (!row) return
          update(messageID, callID, {
            permissionWaitMs: Number(row.data.permissionWaitMs ?? 0) + Date.now() - began,
            executionStage: Exit.isSuccess(exit) ? "execution" : "permission",
          })
        }),
      ),
    )
  })
}

export function observe<A, E, R>(input: Input, effect: Effect.Effect<A, E, R>, signal?: AbortSignal) {
  return Effect.gen(function* () {
    yield* safely(() => start(input))
    return yield* effect.pipe(
      Effect.onExit((exit) =>
        safely(() => {
          const row = Database.use((db) =>
            db
              .select()
              .from(Calls)
              .where(eq(Calls.id, id(input.messageID, input.callID)))
              .get(),
          )
          if (!row) return
          if (Exit.isFailure(exit)) {
            const facts = failure(Cause.squash(exit.cause), signal?.aborted || Cause.hasInterruptsOnly(exit.cause))
            end(input.messageID, input.callID, {
              ...facts,
              ...(facts.status === "denied" ? { executionStarted: false, executionStartedAt: undefined } : {}),
            })
            return
          }
          const facts = row.data.mcpResult ?? resultFacts(input.tool, undefined, exit.value)
          end(input.messageID, input.callID, { ...record(facts), executionStage: "completed" })
        }),
      ),
    )
  })
}

// Called by the stream as a fallback for SDK validation/provider execution outside our wrapper.
export function settled(input: Input, result?: unknown, error?: unknown, status?: string) {
  start(input)
  const row = Database.use((db) =>
    db
      .select()
      .from(Calls)
      .where(eq(Calls.id, id(input.messageID, input.callID)))
      .get(),
  )
  if (!row) return
  end(
    input.messageID,
    input.callID,
    error !== undefined
      ? { ...failure(error), ...(status ? { status } : {}) }
      : {
          ...record(
            row.data.mcpResult ??
              resultFacts(input.tool, row.data.toolKind === "mcp" ? string(row.data.toolProvider) : undefined, result),
          ),
          executionStage: "completed",
        },
  )
}

export function forget(messageID: string) {
  catalogs.delete(messageID)
}

function alive(row: typeof Calls.$inferSelect) {
  if (row.process_id === process.pid) return row.process_token === token
  try {
    process.kill(row.process_id, 0)
    return true
  } catch (error) {
    return record(error).code !== "ESRCH"
  }
}

export function recover() {
  const rows = Database.use((db) => db.select().from(Calls).where(isNull(Calls.ended_at)).all())
  for (const row of rows) {
    const part = Database.use((db) =>
      db
        .select()
        .from(PartTable)
        .where(
          and(
            sql`${PartTable.message_id} = ${row.message_id}`,
            sql`json_extract(${PartTable.data}, '$.callID') = ${row.call_id}`,
          ),
        )
        .get(),
    )
    const state = record(record(part?.data).state)
    if (state.status === "completed") {
      end(
        row.message_id,
        row.call_id,
        {
          ...record(
            row.data.mcpResult ??
              resultFacts(
                string(row.data.registeredToolName),
                row.data.toolKind === "mcp" ? string(row.data.toolProvider) : undefined,
                state,
              ),
          ),
          recovered: true,
        },
        Number(record(state.time).end) || Date.now(),
      )
      continue
    }
    if (state.status !== "error" && alive(row)) continue
    end(
      row.message_id,
      row.call_id,
      state.status === "error"
        ? {
            ...failure(state.error),
            ...(record(state.metadata).interrupted ? { status: "interrupted" } : {}),
            recovered: true,
          }
        : { status: "interrupted", recovered: true, errorCode: "PROCESS_EXITED", durationEstimated: true },
      Number(record(state.time).end) || Date.now(),
    )
  }
}

export * as ToolCalls from "./calls"
