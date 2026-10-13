import { integer, sqliteTable, text, index } from "drizzle-orm/sqlite-core"

export const ArtifactTurnTable = sqliteTable("insight_artifact_delivery_turn", {
  message_id: text().primaryKey(),
  session_id: text().notNull(),
  root_message_id: text().notNull(),
  root_session_id: text().notNull(),
  directory: text().notNull(),
  account: text(),
  uid: text(),
  version: text(),
  created_at: integer().notNull(),
})

export const ArtifactTaskTable = sqliteTable("insight_artifact_delivery_task", {
  id: text().primaryKey(),
  message_id: text().notNull(),
  tool: text().notNull(),
  completed_part_id: text(),
})

export const ArtifactEventTable = sqliteTable(
  "insight_artifact_delivery_event",
  {
    id: text().primaryKey(),
    message_id: text().notNull(),
    part_id: text().notNull(),
    name: text().notNull(),
    payload: text({ mode: "json" }).$type<Record<string, unknown>>().notNull(),
    state: text().notNull().default("pending"),
    attempts: integer().notNull().default(0),
    next_at: integer().notNull(),
    lease: text(),
    lease_until: integer(),
    reason: text(),
    created_at: integer().notNull(),
  },
  (table) => [index("insight_artifact_delivery_event_due_idx").on(table.state, table.next_at)],
)

export const ArtifactReceiptTable = sqliteTable("insight_artifact_delivery_receipt", {
  part_id: text().primaryKey(),
  message_id: text().notNull(),
  tool: text().notNull(),
  task_id: text(),
  state: text().notNull(),
  reason: text().notNull(),
  updated_at: integer().notNull(),
})
