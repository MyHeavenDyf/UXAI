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
  let active: MessageV2.TextPart | undefined
  const writable = () => {
    const result = Database.use((db) => db.select().from(PartTable).where(eq(PartTable.id, resultPartID)).get())
    const message = Database.use((db) => db.select().from(MessageTable).where(eq(MessageTable.id, assistant.id)).get())
    if (!result || !message || result.message_id !== assistant.id || result.session_id !== assistant.sessionID) return false
    const metadata = result.data.type === "text"
      ? resultSchema.safeParse((result.data as MessageV2.TextPart).metadata?.studioPromptExpansion)
      : undefined
    return metadata?.success === true && ["running", "cancelling"].includes(metadata.data.status)
  }
  const save = (part: MessageV2.TextPart) => Database.transaction(() => {
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

  return {
    start: (attempt) => Effect.gen(function* () {
      yield* end()
      if (!writable()) return
      const part: MessageV2.TextPart = {
        id: PartID.ascending(),
        sessionID: assistant.sessionID,
        messageID: assistant.id,
        type: "text",
        text: "",
        time: { start: Date.now() },
        metadata: { studioPromptExpansionPreview: { version: 1, attempt, resultPartID } },
      }
      save(part)
      active = part
    }),
    append: (delta) => Effect.gen(function* () {
      const part = active
      if (!part || !delta || !writable()) return
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
      if (part.type !== "text" || part.time?.end !== undefined ||
        part.metadata?.studioPromptExpansionPreview?.version !== 1 ||
        part.metadata.studioPromptExpansionPreview.resultPartID !== resultPartID) return
      SyncEvent.run(MessageV2.Event.PartUpdated, {
        sessionID: assistant.sessionID,
        part: { ...part, time: { start: part.time?.start ?? Date.now(), end: Date.now() } },
        time: Date.now(),
      })
    })
}
