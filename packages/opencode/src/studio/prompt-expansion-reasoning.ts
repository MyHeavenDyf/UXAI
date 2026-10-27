import { Effect } from "effect"
import { Bus } from "@/bus"
import { Database, eq } from "@/storage/db"
import { MessageV2 } from "@/session/message-v2"
import { MessageTable, PartTable } from "@/session/session.sql"
import { PartID } from "@/session/schema"
import { SyncEvent } from "@/sync"
import { resultSchema } from "./prompt-recommendation-schema"
import type { ExpansionReasoning } from "./prompt-expansion"

export function createExpansionReasoning(assistant: MessageV2.Assistant, resultPartID: PartID): ExpansionReasoning {
  const active = new Map<string, MessageV2.ReasoningPart>()
  const ended = new Set<string>()
  const writable = () => {
    const result = Database.use((db) => db.select().from(PartTable).where(eq(PartTable.id, resultPartID)).get())
    const message = Database.use((db) => db.select().from(MessageTable).where(eq(MessageTable.id, assistant.id)).get())
    if (!result || !message || result.message_id !== assistant.id || result.session_id !== assistant.sessionID) return false
    const metadata = result.data.type === "text"
      ? resultSchema.safeParse((result.data as MessageV2.TextPart).metadata?.studioPromptExpansion)
      : undefined
    return metadata?.success === true && ["running", "cancelling"].includes(metadata.data.status)
  }
  const save = (part: MessageV2.ReasoningPart) => Database.transaction(() => {
    if (!writable()) return
    SyncEvent.run(MessageV2.Event.PartUpdated, {
      sessionID: assistant.sessionID,
      part: structuredClone(part),
      time: Date.now(),
    })
  }, { behavior: "immediate" })

  return {
    event: (event) => Effect.gen(function* () {
      if (ended.has(event.id)) return
      if (!writable()) return
      if (event.type === "reasoning-end") {
        const part = active.get(event.id)
        if (part) {
          part.time.end = Date.now()
          save(part)
          active.delete(event.id)
        }
        ended.add(event.id)
        return
      }
      if (event.type === "reasoning-delta" && !event.text) return
      const part = active.get(event.id) ?? {
        id: PartID.ascending(),
        sessionID: assistant.sessionID,
        messageID: assistant.id,
        type: "reasoning" as const,
        text: "",
        time: { start: Date.now() },
        metadata: { studioPromptExpansionReasoning: { version: 1 } },
      }
      if (!active.has(event.id)) {
        save(part)
        active.set(event.id, part)
      }
      if (event.type !== "reasoning-delta") return
      part.text += event.text
      yield* Effect.promise(() => Bus.publish(MessageV2.Event.PartDelta, {
        sessionID: part.sessionID,
        messageID: part.messageID,
        partID: part.id,
        field: "text",
        delta: event.text,
      }))
    }),
    end: () => Effect.sync(() => {
      active.forEach((part) => {
        part.time.end = Date.now()
        save(part)
      })
      active.clear()
      ended.clear()
    }),
  }
}

// Recovery has no access to the lost run's in-memory deltas.
export function closeExpansionReasoning(assistant: MessageV2.Assistant) {
  Database.use((db) => db.select().from(PartTable).where(eq(PartTable.message_id, assistant.id)).all())
    .forEach((row) => {
      const part = { ...row.data, id: row.id, sessionID: row.session_id, messageID: row.message_id } as MessageV2.Part
      if (part.type !== "reasoning" || part.time.end !== undefined ||
        part.metadata?.studioPromptExpansionReasoning?.version !== 1) return
      SyncEvent.run(MessageV2.Event.PartUpdated, {
        sessionID: assistant.sessionID,
        part: { ...part, time: { ...part.time, end: Date.now() } },
        time: Date.now(),
      })
    })
}
