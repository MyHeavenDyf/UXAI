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
import { createExpansionReasoning, closeExpansionReasoning } from "@/studio/prompt-expansion-reasoning"
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
    reasoning: createExpansionReasoning(assistant, resultPartID),
    parts: () => Database.use((db) => db.select().from(PartTable)
      .where(eq(PartTable.message_id, assistant.id)).all()).filter((row) => row.data.type === "reasoning"),
  }
}

it.instance("streams deltas and saves full reasoning only when a segment ends", () => Effect.gen(function* () {
  const instance = yield* InstanceState.context
  yield* Effect.promise(() => Instance.restore(instance, async () => {
    const value = await fixture()
    const deltas: string[] = []
    const unsubscribe = Bus.subscribe(MessageV2.Event.PartDelta, (event) => { deltas.push(event.properties.delta) })
    try {
      await Effect.runPromise(value.reasoning.event({ type: "reasoning-start", id: "r" }))
      await Effect.runPromise(value.reasoning.event({ type: "reasoning-start", id: "r" }))
      await Effect.runPromise(value.reasoning.event({ type: "reasoning-delta", id: "r", text: "光线" }))
      await Effect.runPromise(value.reasoning.event({ type: "reasoning-delta", id: "r", text: "与构图" }))
      expect(value.parts()).toHaveLength(1)
      expect(value.parts()[0].data).toMatchObject({ text: "", time: { start: expect.any(Number) } })
      expect(deltas).toEqual(["光线", "与构图"])
      await Effect.runPromise(value.reasoning.event({ type: "reasoning-end", id: "r" }))
      await Effect.runPromise(value.reasoning.event({ type: "reasoning-delta", id: "r", text: "迟到内容" }))
      await Effect.runPromise(value.reasoning.end())
      expect(value.parts()[0].data).toMatchObject({ text: "光线与构图", time: { end: expect.any(Number) } })
      expect(deltas).toEqual(["光线", "与构图"])
    } finally {
      unsubscribe()
    }
  }))
}))

it.instance("closes interrupted segments and allows a repair call to reuse provider IDs", () => Effect.gen(function* () {
  const instance = yield* InstanceState.context
  yield* Effect.promise(() => Instance.restore(instance, async () => {
    const value = await fixture()
    await Effect.runPromise(value.reasoning.event({ type: "reasoning-delta", id: "r", text: "第一轮" }))
    await Effect.runPromise(value.reasoning.end())
    await Effect.runPromise(value.reasoning.end())
    await Effect.runPromise(value.reasoning.event({ type: "reasoning-delta", id: "r", text: "修复轮" }))
    await Effect.runPromise(value.reasoning.end())
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
    await Effect.runPromise(value.reasoning.event({ type: "reasoning-start", id: "r" }))
    closeExpansionReasoning(value.assistant)
    expect(value.parts()[0].data).toMatchObject({ time: { end: expect.any(Number) } })
    Database.use((db) => db.delete(SessionTable).where(eq(SessionTable.id, SessionID.make(value.assistant.sessionID))).run())
    await Effect.runPromise(value.reasoning.event({ type: "reasoning-delta", id: "r", text: "不能复活" }))
    await Effect.runPromise(value.reasoning.end())
    expect(value.parts()).toEqual([])
  }))
}))
