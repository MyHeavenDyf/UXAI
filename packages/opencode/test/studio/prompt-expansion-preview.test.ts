import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Bus } from "@/bus"
import { Instance } from "@/project/instance"
import { InstanceState } from "@/effect/instance-state"
import { Database, eq } from "@/storage/db"
import { MessageV2 } from "@/session/message-v2"
import { MessageTable, PartTable, SessionTable } from "@/session/session.sql"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { SyncEvent } from "@/sync"
import { initializeRecommendation } from "@/studio/prompt-recommendation"
import { createExpansionPreview, closeExpansionPreview } from "@/studio/prompt-expansion-preview"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

async function fixture() {
  const guide = await initializeRecommendation({ requestID: crypto.randomUUID() })
  const row = Database.use((db) => db.select().from(MessageTable)
    .where(eq(MessageTable.id, MessageID.make(guide.guideMessageID))).get())!
  const assistant = { ...row.data, id: row.id, sessionID: row.session_id } as MessageV2.Assistant
  const resultPartID = PartID.ascending()
  SyncEvent.run(MessageV2.Event.PartUpdated, {
    sessionID: assistant.sessionID,
    time: Date.now(),
    part: {
      id: resultPartID, sessionID: assistant.sessionID, messageID: assistant.id, type: "text", text: "",
      metadata: { studioPromptExpansion: {
        version: 1, kind: "result", revision: 1, guidePartID: guide.guidePartID, status: "running",
      } },
    },
  })
  return {
    assistant,
    resultPartID,
    preview: createExpansionPreview(assistant, resultPartID),
    parts: () => Database.use((db) => db.select().from(PartTable)
      .where(eq(PartTable.message_id, assistant.id)).all()).filter((row) => row.data.type === "text" && (row.data as MessageV2.TextPart).metadata?.studioPromptExpansionPreview),
  }
}

it.instance("streams preview deltas and saves full text only when an attempt ends", () => Effect.gen(function* () {
  const instance = yield* InstanceState.context
  yield* Effect.promise(() => Instance.restore(instance, async () => {
    const value = await fixture()
    const deltas: string[] = []
    const unsubscribe = Bus.subscribe(MessageV2.Event.PartDelta, (event) => { deltas.push(event.properties.delta) })
    try {
      await Effect.runPromise(value.preview.start(1))
      await Effect.runPromise(value.preview.append("光线"))
      await Effect.runPromise(value.preview.append("与构图"))
      expect(value.parts()).toHaveLength(1)
      expect(value.parts()[0].data).toMatchObject({ text: "", time: { start: expect.any(Number) } })
      expect(deltas).toEqual(["光线", "与构图"])
      await Effect.runPromise(value.preview.end())
      await Effect.runPromise(value.preview.append("迟到内容"))
      await Effect.runPromise(value.preview.end())
      expect(value.parts()[0].data).toMatchObject({ text: "光线与构图", time: { end: expect.any(Number) } })
      expect(deltas).toEqual(["光线", "与构图"])
    } finally {
      unsubscribe()
    }
  }))
}))

it.instance("publishes an empty repair preview before its first text and keeps attempts separate", () => Effect.gen(function* () {
  const instance = yield* InstanceState.context
  yield* Effect.promise(() => Instance.restore(instance, async () => {
    const value = await fixture()
    await Effect.runPromise(value.preview.start(1))
    await Effect.runPromise(value.preview.append("第一轮"))
    await Effect.runPromise(value.preview.end())
    await Effect.runPromise(value.preview.end())
    await Effect.runPromise(value.preview.start(2))
    expect(value.parts().map((row) => row.data)).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: "", metadata: { studioPromptExpansionPreview: { version: 1, attempt: 2, resultPartID: value.resultPartID } } }),
    ]))
    await Effect.runPromise(value.preview.append("修复轮"))
    await Effect.runPromise(value.preview.end())
    const parts = value.parts()
    expect(parts).toHaveLength(2)
    expect(parts.map((row) => row.data)).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: "第一轮", time: expect.objectContaining({ end: expect.any(Number) }) }),
      expect.objectContaining({ text: "修复轮", time: expect.objectContaining({ end: expect.any(Number) }) }),
    ]))
    expect(parts[0].id).not.toBe(parts[1].id)
  }))
}))

it.instance("recovers unfinished persisted segments and never recreates deleted messages", () => Effect.gen(function* () {
  const instance = yield* InstanceState.context
  yield* Effect.promise(() => Instance.restore(instance, async () => {
    const value = await fixture()
    await Effect.runPromise(value.preview.start(1))
    closeExpansionPreview(value.assistant, value.resultPartID)
    expect(value.parts()[0].data).toMatchObject({ time: { end: expect.any(Number) } })
    Database.use((db) => db.delete(SessionTable).where(eq(SessionTable.id, SessionID.make(value.assistant.sessionID))).run())
    await Effect.runPromise(value.preview.append("不能复活"))
    await Effect.runPromise(value.preview.end())
    expect(value.parts()).toEqual([])
  }))
}))


it.instance("keeps reasoning and raw body segments ordered and closes every segment", () => Effect.gen(function* () {
  const instance = yield* InstanceState.context
  yield* Effect.promise(() => Instance.restore(instance, async () => {
    const value = await fixture()
    const deltas: { partID: string; delta: string }[] = []
    const unsubscribe = Bus.subscribe(MessageV2.Event.PartDelta, (event) => {
      deltas.push({ partID: event.properties.partID, delta: event.properties.delta })
    })
    try {
      await Effect.runPromise(value.preview.start(1))
      await Effect.runPromise(value.preview.append("先考虑", "reasoning", "r1"))
      await Effect.runPromise(value.preview.append("构图", "reasoning", "r1"))
      await Effect.runPromise(value.preview.append('{"expandedPrompt":"城市', "text", "t1"))
      await Effect.runPromise(value.preview.append("补充光线", "reasoning", "r2"))
      await Effect.runPromise(value.preview.append('雨景"}', "text", "t2"))
      await Effect.runPromise(value.preview.end())
      const parts = Database.use((db) => db.select().from(PartTable)
        .where(eq(PartTable.message_id, value.assistant.id)).all())
        .map((row) => row.data as MessageV2.TextPart | MessageV2.ReasoningPart)
        .filter((part) => part.metadata?.studioPromptExpansionPreview && part.text)
      expect(parts.map((part) => ({ type: part.type, text: part.text }))).toEqual([
        { type: "reasoning", text: "先考虑构图" },
        { type: "text", text: '{"expandedPrompt":"城市' },
        { type: "reasoning", text: "补充光线" },
        { type: "text", text: '雨景"}' },
      ])
      expect(parts.every((part) => part.time?.end !== undefined)).toBe(true)
      expect(deltas[0].partID).toBe(deltas[1].partID)
      expect(new Set(deltas.map((delta) => delta.partID)).size).toBe(4)
    } finally { unsubscribe() }
  }))
}))
