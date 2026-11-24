import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "../project/project.sql"
import type { ProjectID } from "../project/schema"
import type { SessionID } from "../session/schema"
import { Timestamps } from "../storage/schema.sql"

export type MemoryType = "user" | "feedback" | "project" | "reference"

export const MemoryTable = sqliteTable(
  "memory",
  {
    id: text().primaryKey(),
    project_id: text()
      .$type<ProjectID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    type: text().$type<MemoryType>().notNull(),
    topic: text().notNull(),
    content: text().notNull(),
    summary: text().notNull(),
    source_session_id: text().$type<SessionID>(),
    pinned: integer().notNull().default(0),
    ...Timestamps,
  },
  (table) => [
    index("memory_project_idx").on(table.project_id),
    uniqueIndex("memory_project_topic_idx").on(table.project_id, table.topic),
  ],
)
