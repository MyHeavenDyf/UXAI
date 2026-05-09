import { sqliteTable, text, index } from "drizzle-orm/sqlite-core"
import { SessionTable } from "./session.sql"
import { Timestamps } from "../storage/schema.sql"
import type { SessionID } from "./schema"

export type SessionCategory = "dev" | "design" | "prototype" | "analysis" | "creative" | "planning"

export const SessionCategoryTable = sqliteTable(
  "session_category",
  {
    session_id: text()
      .$type<SessionID>()
      .primaryKey()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    category: text().$type<SessionCategory>().notNull(),
    ...Timestamps,
  },
  (table) => [index("session_category_category_idx").on(table.category)],
)
