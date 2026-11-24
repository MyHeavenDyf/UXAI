import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "../project/project.sql"
import type { ProjectID } from "../project/schema"

// 删除墓碑:记录 topic 被删除的版本,阻止更旧的提取批次通过 INSERT 复活已删除记忆。
export const MemoryTombstoneTable = sqliteTable(
  "memory_tombstone",
  {
    project_id: text()
      .$type<ProjectID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    topic: text().notNull(),
    time_deleted: integer().notNull(),
  },
  (table) => [primaryKey({ columns: [table.project_id, table.topic] })],
)
