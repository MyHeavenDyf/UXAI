import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import type { Event, Part } from "@opencode-ai/sdk/v2/client"
import { createStudioSessionData } from "./studio-session-data"

test("reasoning deltas cannot cross sessions, revive deleted parts or append after final snapshots", async () => {
  const event = createGlobalEmitter<{ [key: string]: Event }>()
  const part = {
    id: "r", messageID: "a", sessionID: "s", type: "reasoning", text: "",
    time: { start: 1 }, metadata: { studioPromptExpansionReasoning: { version: 1 } },
  } satisfies Part
  const snapshot = Promise.withResolvers<{ data: { agent: string } }>()
  const sdk = {
    event,
    client: { session: {
      get: () => snapshot.promise,
      messages: async () => ({ data: [] }),
    } },
  } as unknown as Parameters<typeof createStudioSessionData>[0]["globalSDK"]
  let dispose = () => {}
  const data = createRoot((cleanup) => {
    dispose = cleanup
    return createStudioSessionData({ sessionID: () => "s", globalSDK: sdk })
  })
  const update = (next: Part) => event.emit("directory", {
    id: crypto.randomUUID(), type: "message.part.updated", properties: { sessionID: "s", time: Date.now(), part: next },
  })
  const delta = (text: string, sessionID = "s") => event.emit("directory", {
    id: crypto.randomUUID(), type: "message.part.delta", properties: { sessionID, messageID: "a", partID: "r", field: "text", delta: text },
  })
  try {
    await Bun.sleep(0)
    update(part)
    delta("光线")
    expect(data.dataStore.part.a[0]).toMatchObject({ text: "光线" })
    delta("其他会话", "other")
    expect(data.dataStore.part.a[0]).toMatchObject({ text: "光线" })
    update({ ...part, text: "" })
    expect(data.dataStore.part.a[0]).toMatchObject({ text: "光线" })
    update({ ...part, text: "光线与构图", time: { start: 1, end: 2 } })
    delta("重复增量")
    expect(data.dataStore.part.a[0]).toMatchObject({ text: "光线与构图" })
    event.emit("directory", {
      id: crypto.randomUUID(), type: "message.part.removed", properties: { sessionID: "s", messageID: "a", partID: "r" },
    })
    update(part)
    delta("迟到增量")
    expect(data.dataStore.part.a).toEqual([])
  } finally {
    dispose()
    snapshot.resolve({ data: { agent: "octo_studio" } })
  }
})
