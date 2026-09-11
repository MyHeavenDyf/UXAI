import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "../project/project.sql"
import { SessionTable } from "./session.sql"
import { Timestamps } from "../storage/schema.sql"
import type { ProjectID } from "../project/schema"
import type { SessionID } from "./schema"

export type SessionGroupNamespace = "make" | "insight"

export const SessionGroupTable = sqliteTable(
  "session_group",
  {
    id: text().primaryKey(),
    project_id: text()
      .$type<ProjectID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    directory: text().notNull(),
    namespace: text().$type<SessionGroupNamespace>().notNull(),
    name: text().notNull(),
    position: integer().notNull().default(0),
    ...Timestamps,
  },
  (table) => [
    index("session_group_project_idx").on(table.project_id),
    index("session_group_dir_ns_idx").on(table.directory, table.namespace),
  ],
)

export const SessionGroupMappingTable = sqliteTable(
  "session_group_mapping",
  {
    session_id: text()
      .$type<SessionID>()
      .primaryKey()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    group_id: text()
      .notNull()
      .references(() => SessionGroupTable.id, { onDelete: "cascade" }),
    ...Timestamps,
  },
  (table) => [index("session_group_mapping_group_idx").on(table.group_id)],
)
