import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import type { MessageID, PartID, SessionID } from "@/session/schema"
import { SessionTable } from "@/session/session.sql"
import { Timestamps } from "@/storage/schema.sql"
import type { StudioCapability } from "./image-provider"

export type StudioGenerationStatus = "queued" | "running" | "succeeded" | "failed"

export const StudioGenerationTable = sqliteTable(
  "studio_generation",
  {
    id: text().primaryKey(),
    session_id: text()
      .$type<SessionID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    directory: text().notNull(),
    assistant_message_id: text().$type<MessageID>().notNull(),
    tool_part_id: text().$type<PartID>().notNull(),
    provider: text().$type<"jimeng" | "internel">().notNull(),
    provider_task_id: text(),
    capability: text().$type<StudioCapability>().notNull(),
    status: text().$type<StudioGenerationStatus>().notNull(),
    raw_status: text(),
    progress: integer().notNull().default(0),
    queue_order: integer(),
    request: text({ mode: "json" }).$type<Record<string, unknown>>().notNull(),
    result: text({ mode: "json" }).$type<Record<string, unknown>>(),
    error: text(),
    next_poll_at: integer().notNull(),
    poll_attempts: integer().notNull().default(0),
    completed_at: integer(),
    ...Timestamps,
  },
  (table) => [
    index("studio_generation_directory_status_poll_idx").on(table.directory, table.status, table.next_poll_at),
    index("studio_generation_session_idx").on(table.session_id),
  ],
)
