import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Timestamps } from "@/storage/schema.sql"

// 主键为 (directory, id)：不同项目目录下 provider 返回的媒体 id 可能相同，
// 若只用 id 作为主键，跨目录会互相覆盖，且墓碑无法按目录隔离。
export const StudioHistoryTable = sqliteTable(
  "studio_history",
  {
    id: text().notNull(),
    session_id: text().notNull(),
    directory: text().notNull(),
    generation_id: text().notNull(),
    media_index: integer().notNull(),
    kind: text().$type<"image" | "video">().notNull(),
    url: text().notNull(),
    thumbnail_url: text(),
    thumbnail_status: text(),
    width: integer(),
    height: integer(),
    aspect_ratio: text(),
    resolution: text(),
    ratio: text(),
    capability: text(),
    duration: text(),
    created_at: integer().notNull(),
    // 生成级文案字段：会话删除会级联清理 studio_generation,
    // 这些列让历史记录在会话被删后仍能复原右侧详情面板。
    prompt: text(),
    display_prompt: text(),
    detail_prompt: text(),
    detail_title: text(),
    model: text(),
    style_model: text(),
    provider: text(),
    video_mode: text(),
    video_quality_mode: text(),
    tool_action: text(),
    is_custom: integer(),
    ...Timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.directory, table.id] }),
    index("studio_history_directory_idx").on(table.directory),
    index("studio_history_directory_created_idx").on(table.directory, table.created_at),
    index("studio_history_directory_kind_created_idx").on(table.directory, table.kind, table.created_at),
    index("studio_history_session_idx").on(table.session_id),
    index("studio_history_generation_idx").on(table.generation_id),
  ],
)

// 历史记录的排除表（墓碑）：记录用户已从历史中删除的媒体 id。
// 它阻止 backfill/materialize/snapshot 再次把已删除的媒体物化回 `studio_history`。
// `generation_id` 用于垃圾回收：当对应 generation 行被删除后，墓碑不再需要，可被清理。
export const StudioHistoryExcludedTable = sqliteTable(
  "studio_history_excluded",
  {
    media_id: text().notNull(),
    directory: text().notNull(),
    generation_id: text(),
    ...Timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.directory, table.media_id] }),
    index("studio_history_excluded_directory_idx").on(table.directory),
    index("studio_history_excluded_generation_idx").on(table.directory, table.generation_id),
  ],
)
