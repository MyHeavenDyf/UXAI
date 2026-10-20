import { and, desc, eq, lt, or, sql } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { Database } from "@/storage/db"
import { MessageV2 } from "./message-v2"
import { MessageID, SessionID } from "./schema"
import { Session } from "./session"
import { MessageTable, PartTable } from "./session.sql"
import { SessionStatus } from "./status"

export const PreviewMessage = Schema.Struct({
  id: Schema.String,
  role: Schema.Literals(["user", "assistant"]),
  text: Schema.String,
  truncated: Schema.Boolean,
  files: Schema.Array(Schema.Struct({ name: Schema.String, mime: Schema.String })),
})

export const PreviewPage = Schema.Struct({
  messages: Schema.Array(PreviewMessage),
  before: Schema.optional(Schema.String),
  running: Schema.Boolean,
})

// Match Design's user bubble: metadata.displayText wins; otherwise use the first
// text part after its LAST context separator. Strip inside SQLite BEFORE clipping,
// so even a long injected file list cannot displace the actual user input.
// Search backwards in overlapping 8K chunks; never hydrate the full prompt in JS.
const userText = sql<string | null>`case
  when json_type(${PartTable.data}, '$.metadata.displayText') = 'text'
    and length(json_extract(${PartTable.data}, '$.metadata.displayText')) > 0
  then substr(trim(json_extract(${PartTable.data}, '$.metadata.displayText')), 1, 8193)
  else (
    with recursive
      source(value) as materialized (select cast(coalesce(json_extract(${PartTable.data}, '$.text'), '') as blob)),
      chunks(start, chunk) as (
        select max(1, length(value) - 8191), substr(value, max(1, length(value) - 8191), 8192) from source
        union all
        select max(1, start - 8188), substr(value, max(1, start - 8188), 8192)
        from chunks, source where start > 1 and instr(chunk, x'0a2d2d2d0a') = 0
      ),
      tail as (select start, chunk from chunks where instr(chunk, x'0a2d2d2d0a') > 0),
      positions(pos) as (
        select instr(chunk, x'0a2d2d2d0a') from tail
        union all
        select pos + instr(substr(chunk, pos + 1), x'0a2d2d2d0a')
        from positions, tail where instr(substr(chunk, pos + 1), x'0a2d2d2d0a') > 0
      )
    select substr(cast(substr(value, coalesce((select start + max(pos) + 4 from positions, tail), 1), 32772) as text), 1, 8193) from source
  ) end`

export const previewSession = Effect.fn("SessionShare.preview")(function* (input: {
  sessionID: SessionID
  limit?: number
  before?: string
}) {
  yield* (yield* Session.Service).get(input.sessionID)
  const before = input.before ? MessageV2.cursor.decode(input.before) : undefined
  const limit = Math.min(20, Math.max(1, input.limit ?? 20))
  // Do not hydrate full messages/parts: tool output and data URLs can be megabytes.
  const rows = Database.use((db) =>
    db
      .select({
        id: MessageTable.id,
        time: MessageTable.time_created,
        role: sql<string>`json_extract(${MessageTable.data}, '$.role')`,
      })
      .from(MessageTable)
      .where(
        and(
          eq(MessageTable.session_id, input.sessionID),
          before
            ? or(
                lt(MessageTable.time_created, before.time),
                and(eq(MessageTable.time_created, before.time), lt(MessageTable.id, before.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(MessageTable.time_created), desc(MessageTable.id))
      .limit(limit + 1)
      .all(),
  )

  const messages = rows
    .slice(0, limit)
    .reverse()
    .flatMap((row) => {
      if (row.role !== "user" && row.role !== "assistant") return []
      // Bound both part count and projected string length in SQLite, before JS allocation.
      const parts = Database.use((db) =>
        db
          .select({
            type: sql<string>`json_extract(${PartTable.data}, '$.type')`,
            text:
              row.role === "user"
                ? userText
                : sql<string | null>`substr(json_extract(${PartTable.data}, '$.text'), 1, 8193)`,
            name: sql<string | null>`substr(json_extract(${PartTable.data}, '$.filename'), 1, 256)`,
            mime: sql<string | null>`substr(json_extract(${PartTable.data}, '$.mime'), 1, 128)`,
          })
          .from(PartTable)
          .where(
            and(
              eq(PartTable.message_id, row.id),
              sql`json_extract(${PartTable.data}, '$.type') in ('text', 'file')`,
              row.role === "user" ? undefined : sql`coalesce(json_extract(${PartTable.data}, '$.ignored'), 0) != 1`,
              row.role === "user" ? undefined : sql`coalesce(json_extract(${PartTable.data}, '$.synthetic'), 0) != 1`,
            ),
          )
          .orderBy(
            ...(row.role === "user"
              ? [
                  sql`case when json_extract(${PartTable.data}, '$.type') = 'text' and json_type(${PartTable.data}, '$.metadata.displayText') = 'text' and length(json_extract(${PartTable.data}, '$.metadata.displayText')) > 0 then 0 else 1 end`,
                  PartTable.id,
                ]
              : [PartTable.id]),
          )
          .limit(17)
          .all(),
      )
      const text =
        row.role === "user"
          ? (parts.find((part) => part.type === "text")?.text ?? "").trim()
          : parts
              .slice(0, 16)
              .filter((part) => part.type === "text")
              .map((part) => part.text ?? "")
              .join("\n")
      const files = parts
        .slice(0, 16)
        .filter((part) => part.type === "file")
        .map((part) => ({ name: part.name || "附件", mime: part.mime || "application/octet-stream" }))
      if (!text.trim() && !files.length) return []
      return [
        {
          id: row.id,
          role: row.role as "user" | "assistant",
          text: text.slice(0, 8192),
          truncated: text.length > 8192 || parts.length > 16,
          files,
        },
      ]
    })
  const tail = rows.slice(0, limit).at(-1)
  return {
    messages,
    ...(rows.length > limit && tail
      ? { before: MessageV2.cursor.encode({ id: MessageID.make(tail.id), time: tail.time }) }
      : {}),
    running: (yield* (yield* SessionStatus.Service).get(input.sessionID)).type !== "idle",
  }
})
