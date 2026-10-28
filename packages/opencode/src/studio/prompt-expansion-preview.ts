import { Effect } from "effect"
import { Bus } from "@/bus"
import { Database, eq } from "@/storage/db"
import { MessageV2 } from "@/session/message-v2"
import { MessageTable, PartTable } from "@/session/session.sql"
import { PartID } from "@/session/schema"
import { SyncEvent } from "@/sync"
import { resultSchema } from "./prompt-recommendation-schema"
import type { ExpansionPreview } from "./prompt-expansion"

export function createExpansionPreview(assistant: MessageV2.Assistant, resultPartID: PartID): ExpansionPreview {
  let active: MessageV2.TextPart | MessageV2.ReasoningPart | undefined
  let attempt: 1 | 2 = 1
  let streamID: string | undefined
  const writable = () => {
    const result = Database.use((db) => db.select().from(PartTable).where(eq(PartTable.id, resultPartID)).get())
    const message = Database.use((db) => db.select().from(MessageTable).where(eq(MessageTable.id, assistant.id)).get())
    if (!result || !message || result.message_id !== assistant.id || result.session_id !== assistant.sessionID) return false
    const metadata = result.data.type === "text"
      ? resultSchema.safeParse((result.data as MessageV2.TextPart).metadata?.studioPromptExpansion)
      : undefined
    return metadata?.success === true && ["running", "cancelling"].includes(metadata.data.status)
  }
  const save = (part: MessageV2.TextPart | MessageV2.ReasoningPart) => Database.transaction(() => {
    if (!writable()) return
    SyncEvent.run(MessageV2.Event.PartUpdated, {
      sessionID: assistant.sessionID,
      part: structuredClone(part),
      time: Date.now(),
    })
  }, { behavior: "immediate" })
  const end = () => Effect.sync(() => {
    if (!active) return
    active.time = { start: active.time?.start ?? Date.now(), end: Date.now() }
    save(active)
    active = undefined
  })

  const create = (type: "text" | "reasoning") => {
    const part = {
      id: PartID.ascending(),
      sessionID: assistant.sessionID,
      messageID: assistant.id,
      type,
      text: "",
      time: { start: Date.now() },
      metadata: { studioPromptExpansionPreview: { version: 1, attempt, resultPartID } },
    }
    save(part)
    active = part
  }

  return {
    start: (nextAttempt) => Effect.gen(function* () {
      yield* end()
      attempt = nextAttempt
      streamID = undefined
      if (writable()) create("text")
    }),
    append: (delta, type = "text", id) => Effect.gen(function* () {
      if (!active || !delta || !writable()) return
      if (active.type !== type || (streamID !== undefined && streamID !== id)) {
        yield* end()
        create(type)
      }
      streamID = id
      const part = active!
      part.text += delta
      yield* Effect.promise(() => Bus.publish(MessageV2.Event.PartDelta, {
        sessionID: part.sessionID,
        messageID: part.messageID,
        partID: part.id,
        field: "text",
        delta,
      }))
    }),
    end,
  }
}

// Recovery can close persisted previews, but cannot reconstruct lost in-memory deltas.
export function closeExpansionPreview(assistant: MessageV2.Assistant, resultPartID: PartID) {
  Database.use((db) => db.select().from(PartTable).where(eq(PartTable.message_id, assistant.id)).all())
    .forEach((row) => {
      const part = { ...row.data, id: row.id, sessionID: row.session_id, messageID: row.message_id } as MessageV2.Part
      if ((part.type !== "text" && part.type !== "reasoning") || part.time?.end !== undefined ||
        part.metadata?.studioPromptExpansionPreview?.version !== 1 ||
        part.metadata.studioPromptExpansionPreview.resultPartID !== resultPartID) return
      SyncEvent.run(MessageV2.Event.PartUpdated, {
        sessionID: assistant.sessionID,
        part: { ...part, time: { start: part.time?.start ?? Date.now(), end: Date.now() } },
        time: Date.now(),
      })
    })
}
