import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const ToolCallTable = sqliteTable(
  "agent_tool_call",
  {
    id: text().primaryKey(),
    message_id: text().notNull(),
    call_id: text().notNull(),
    process_id: integer().notNull(),
    process_token: text().notNull(),
    started_at: integer().notNull(),
    ended_at: integer(),
    data: text({ mode: "json" }).$type<Record<string, unknown>>().notNull(),
    payload: text({ mode: "json" }).$type<Record<string, unknown>>().notNull(),
  },
  (table) => [index("agent_tool_call_open_idx").on(table.ended_at)],
)

export const ToolCallParentTable = sqliteTable("agent_tool_call_parent", {
  message_id: text().primaryKey(),
  invocation_id: text().notNull(),
})
