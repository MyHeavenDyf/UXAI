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
  tool: text().notNull(),
})

// Immutable receipts survive payload cleanup; a replay cannot recreate sent events.
export const ArtifactEventTable = sqliteTable(
  "insight_artifact_event",
  {
    id: text().primaryKey(),
    message_id: text().notNull(),
    payload: text(),
    state: text().$type<"pending" | "sending" | "sent" | "failed" | "diagnostic" | "missing-account">().notNull(),
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
})

export const ArtifactScanTable = sqliteTable("insight_artifact_scan", {
  message_id: text().primaryKey(),
  baseline: text().notNull(),
  diagnostic: text(),
  updated_at: integer().notNull(),
})
