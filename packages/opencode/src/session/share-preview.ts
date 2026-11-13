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
  reasoning: Schema.optional(Schema.String),
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

function studioUserDemand(text: string) {
  const marker = "用户需求："
  const content = text.slice(Math.max(0, text.lastIndexOf(marker) + (text.includes(marker) ? marker.length : 0)))
  const stop = [
    "\n能力：",
    "\n风格模型：",
    "\n画幅比例：",
    "\n生成数量：",
    "\n当前选中的生图工具：",
    "\n工具参数JSON：",
    "\n调用生图工具",
    "\n输出时先简短说明",
  ]
    .map((item) => content.indexOf(item))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0]
  return content
    .slice(0, stop ?? content.length)
    .split("\n")
    .filter((line) => !line.startsWith("工具参数JSON：") && !line.startsWith("调用生图工具"))
    .join("\n")
    .trim()
}

export const previewSession = Effect.fn("SessionShare.preview")(function* (input: {
  sessionID: SessionID
  limit?: number
  before?: string
}) {
  const session = yield* (yield* Session.Service).get(input.sessionID)
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
                : session.agent === "octo_insight"
                  ? sql<string | null>`case when json_extract(${PartTable.data}, '$.type') = 'tool' then
                      '工具：' || substr(coalesce(json_extract(${PartTable.data}, '$.tool'), ''), 1, 128)
                      || '（分享时状态：' || substr(coalesce(
                        json_extract(${PartTable.data}, '$.state.metadata.structuredContent.status'),
                        json_extract(${PartTable.data}, '$.state.metadata.status'),
                        case when json_valid(json_extract(${PartTable.data}, '$.state.output'))
                          then json_extract(json_extract(${PartTable.data}, '$.state.output'), '$.structuredContent.status') end,
                        json_extract(${PartTable.data}, '$.state.status'), 'unknown'), 1, 64) || '）'
                      || coalesce((select char(10) || '参考资料：' || group_concat(title, '；') from (
                        select substr(json_extract(value, '$.title'), 1, 256) as title
                        from json_each(${PartTable.data}, '$.state.metadata.sources')
                        where type = 'object' limit 8
                      )), '')
                    else substr(json_extract(${PartTable.data}, '$.text'), 1, 8193) end`
                  : session.agent === "octo_studio"
                    ? sql<string | null>`case when json_extract(${PartTable.data}, '$.type') = 'tool' then
                        case when coalesce(
                          json_extract(${PartTable.data}, '$.state.input.capability'),
                          case when json_valid(json_extract(${PartTable.data}, '$.state.output'))
                            then json_extract(json_extract(${PartTable.data}, '$.state.output'), '$.capability') end,
                          '') = 'video.generate' then '视频' else '图片' end
                        || case coalesce(json_extract(${PartTable.data}, '$.state.status'), '')
                          when 'completed' then '生成完成'
                          when 'running' then '生成中'
                          when 'pending' then '生成中'
                          when 'error' then '生成失败'
                          else '生成任务' end
                      else substr(json_extract(${PartTable.data}, '$.text'), 1, 8193) end`
                  : sql<string | null>`substr(json_extract(${PartTable.data}, '$.text'), 1, 8193)`,
            name: sql<string | null>`substr(json_extract(${PartTable.data}, '$.filename'), 1, 256)`,
            mime: sql<string | null>`substr(json_extract(${PartTable.data}, '$.mime'), 1, 128)`,
          })
          .from(PartTable)
          .where(
            and(
              eq(PartTable.message_id, row.id),
              (session.agent === "octo_insight" || session.agent === "octo_studio") && row.role === "assistant"
                ? sql`json_extract(${PartTable.data}, '$.type') in ('text', 'file', 'tool', 'reasoning')`
                : row.role === "assistant"
                  ? sql`json_extract(${PartTable.data}, '$.type') in ('text', 'file', 'reasoning')`
                  : sql`json_extract(${PartTable.data}, '$.type') in ('text', 'file')`,
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
      const studioDisplayPrompt = session.agent === "octo_studio" && row.role === "user"
        ? Database.use((db) =>
            db
              .select({
                text: sql<string | null>`substr(json_extract(${PartTable.data}, '$.state.input.displayPrompt'), 1, 8193)`,
              })
              .from(MessageTable)
              .innerJoin(PartTable, eq(PartTable.message_id, MessageTable.id))
              .where(
                and(
                  eq(MessageTable.session_id, input.sessionID),
                  sql`json_extract(${MessageTable.data}, '$.role') = 'assistant'`,
                  sql`json_extract(${MessageTable.data}, '$.parentID') = ${row.id}`,
                  sql`json_extract(${PartTable.data}, '$.type') = 'tool'`,
                  sql`json_type(${PartTable.data}, '$.state.input.displayPrompt') = 'text'`,
                  sql`length(json_extract(${PartTable.data}, '$.state.input.displayPrompt')) > 0`,
                ),
              )
              .orderBy(PartTable.id)
              .limit(1)
              .get(),
          )?.text?.trim()
        : undefined
      const text =
        row.role === "user"
          ? studioDisplayPrompt || (session.agent === "octo_studio"
              ? studioUserDemand((parts.find((part) => part.type === "text")?.text ?? "").trim())
              : (parts.find((part) => part.type === "text")?.text ?? "").trim())
          : parts
              .slice(0, 16)
              .filter((part) => part.type === "text" || ((session.agent === "octo_insight" || session.agent === "octo_studio") && part.type === "tool"))
              .map((part) => part.text ?? "")
              .join("\n")
      const reasoningText = row.role === "assistant"
        ? parts
            .slice(0, 16)
            .filter((part) => part.type === "reasoning")
            .map((part) => part.text ?? "")
            .join("\n")
            .trim()
        : ""
      const reasoning = reasoningText.slice(0, 4096)
      const files = parts
        .slice(0, 16)
        .filter((part) => part.type === "file")
        .map((part) => ({ name: part.name || "附件", mime: part.mime || "application/octet-stream" }))
      if (!text.trim() && !reasoning && !files.length) return []
      return [
        {
          id: row.id,
          role: row.role as "user" | "assistant",
          text: text.slice(0, 8192),
          ...(reasoning ? { reasoning } : {}),
          truncated: text.length > 8192 || reasoningText.length > 4096 || parts.length > 16,
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
