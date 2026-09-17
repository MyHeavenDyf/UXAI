import { integer, sqliteTable, text, index } from "drizzle-orm/sqlite-core"

export const ArtifactTurnTable = sqliteTable("insight_artifact_turn", {
  message_id: text().primaryKey(),
  session_id: text().notNull(),
  root_message_id: text().notNull(),
  root_session_id: text().notNull(),
  directory: text().notNull(),
  account: text(),
  uid: text(),
  version: text(),
  owner: text().$type<"server" | "diagnostic">().notNull(),
  created_at: integer().notNull(),
})

export const ArtifactTaskTable = sqliteTable("insight_artifact_task", {
  id: text().primaryKey(),
  message_id: text().notNull(),
  assistant_message_id: text(),
  session_id: text(),
  result_part_id: text(),
  tool: text().notNull(),
  provider: text(),
  task_id: text(),
  query_tool: text(),
  query_input: text(),
  state: text()
    .$type<
      "pending" | "polling" | "succeeded" | "failed" | "cancelled" | "timed_out" | "waiting_auth" | "unsupported"
    >()
    .notNull()
    .default("pending"),
  next_at: integer().notNull().default(0),
  deadline_at: integer(),
  attempts: integer().notNull().default(0),
  lease: text(),
  lease_until: integer(),
  error: text(),
  updated_at: integer().notNull().default(0),
})

// Immutable receipts survive payload cleanup; a replay cannot recreate sent events.
export const ArtifactEventTable = sqliteTable(
  "insight_artifact_event",
  {
    id: text().primaryKey(),
    message_id: text().notNull(),
    payload: text(),
    state: text()
      .$type<"pending" | "sending" | "sent" | "failed" | "expired" | "diagnostic" | "missing-account">()
      .notNull(),
    created_at: integer().notNull(),
    attempts: integer().notNull().default(0),
    next_at: integer().notNull().default(0),
    lease: text(),
    lease_until: integer(),
    reason: text(),
  },
  (t) => [index("insight_artifact_pending_idx").on(t.state, t.next_at)],
)

export const ArtifactFactTable = sqliteTable("insight_artifact_fact", {
  part_id: text().primaryKey(),
  created_at: integer().notNull(),
  state: text().$type<"pending" | "processed">().notNull().default("processed"),
  reason: text(),
  next_at: integer().notNull().default(0),
  updated_at: integer().notNull().default(0),
})

export const ArtifactObservationTable = sqliteTable(
  "insight_artifact_observation",
  {
    id: text().primaryKey(),
    message_id: text().notNull(),
    tool_call_id: text(),
    task_id: text(),
    kind: text().notNull(),
    status: text().notNull(),
    reason: text(),
    detail: text(),
    created_at: integer().notNull(),
    updated_at: integer().notNull(),
  },
  (t) => [index("insight_artifact_observation_message_idx").on(t.message_id, t.updated_at)],
)

export const ArtifactScanTable = sqliteTable("insight_artifact_scan", {
  message_id: text().primaryKey(),
  baseline: text().notNull(),
  diagnostic: text(),
  updated_at: integer().notNull(),
})
