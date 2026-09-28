import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import type { SessionID } from "@/session/schema"
import { SessionTable } from "@/session/session.sql"
import { Timestamps } from "@/storage/schema.sql"
import { StudioGenerationTable } from "./studio-generation.sql"

export type StudioMediaThumbnailStatus = "queued" | "running" | "succeeded" | "failed"

export const StudioMediaThumbnailTable = sqliteTable(
  "studio_media_thumbnail",
  {
    id: text().primaryKey(),
    generation_id: text()
      .notNull()
      .references(() => StudioGenerationTable.id, { onDelete: "cascade" }),
    session_id: text()
      .$type<SessionID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    directory: text().notNull(),
    media_index: integer().notNull(),
    kind: text().$type<"image" | "video">().notNull(),
    source_url: text().notNull(),
    status: text().$type<StudioMediaThumbnailStatus>().notNull(),
    attempts: integer().notNull().default(0),
    next_retry_at: integer().notNull(),
    lease_owner: text(),
    lease_expires_at: integer(),
    thumbnail_path: text(),
    error: text(),
    ...Timestamps,
  },
  (table) => [
    uniqueIndex("studio_media_thumbnail_generation_media_idx").on(table.generation_id, table.media_index),
    index("studio_media_thumbnail_directory_status_retry_idx").on(
      table.directory,
      table.status,
      table.next_retry_at,
    ),
    index("studio_media_thumbnail_session_idx").on(table.session_id),
  ],
)
