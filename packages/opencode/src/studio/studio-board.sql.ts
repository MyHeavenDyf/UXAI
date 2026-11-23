import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import type { BoardDocument } from "@opencode-ai/core/studio-board"
import { SessionTable } from "@/session/session.sql"
import type { SessionID } from "@/session/schema"
import type { boardRebootBaseline } from "./studio-board-reboot"

export const StudioBoardTable = sqliteTable("studio_board", {
  session_id: text()
    .$type<SessionID>()
    .primaryKey()
    .references(() => SessionTable.id, { onDelete: "cascade" }),
  directory: text().notNull(),
  revision: integer().notNull().default(0),
  document: text({ mode: "json" }).$type<BoardDocument>().notNull(),
  updated_at: integer().notNull(),
})

export const StudioBoardSubmissionTable = sqliteTable(
  "studio_board_submission",
  {
    id: text().primaryKey(),
    session_id: text()
      .$type<SessionID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    card_id: text().notNull(),
    generation_id: text().notNull(),
  },
  (table) => [uniqueIndex("studio_board_submission_generation_idx").on(table.generation_id)],
)

export const StudioBoardOperationTable = sqliteTable("studio_board_operation", {
  id: text().primaryKey(),
  session_id: text()
    .$type<SessionID>()
    .notNull()
    .references(() => SessionTable.id, { onDelete: "cascade" }),
  generation_id: text().notNull(),
  provider_task_id: text().notNull(),
  execution_baseline: text({ mode: "json" }).$type<ReturnType<typeof boardRebootBaseline>>(),
  status: text().$type<"pending" | "completed" | "rejected">().notNull(),
  error: text(),
})
