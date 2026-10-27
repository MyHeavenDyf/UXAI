import { expect, test } from "bun:test"
import type { Message, Part } from "@opencode-ai/sdk/v2/client"
import { isExpansionPreview, isExpansionReasoning, latestExpansionPreview, mergePromptPart } from "./studio-prompt-state"
import { buildStudioTurns, buildStudioConversationContext } from "./turns"

const guide = {
  id: "guide",
  sessionID: "session",
  messageID: "a1",
  type: "text",
  text: "你好",
  metadata: {
    studioPromptRecommendation: { version: 1, kind: "guide", revision: 1, status: "armed" },
  },
} satisfies Part
const result = {
  id: "result",
  sessionID: "session",
  messageID: "a2",
  type: "text",
  text: "扩写正文",
  metadata: {
    studioPromptExpansion: {
      version: 1,
      kind: "result",
      revision: 2,
      guidePartID: "guide",
      status: "completed",
      tags: ["场景：城市"],
    },
  },
} satisfies Part

test("an old running snapshot cannot overwrite a completed part", () => {
  const old = {
    ...result,
    text: "",
    metadata: { studioPromptExpansion: { ...result.metadata.studioPromptExpansion, revision: 1, status: "running" } },
  }
  expect(mergePromptPart(result, old)).toBe(result)
  expect(mergePromptPart(old, result)).toBe(result)
})

test("recommendations retain proper parents, tags and input attachments without becoming generation context", () => {
  const user = (id: string): Message => ({
    id,
    sessionID: "session",
    role: "user",
    time: { created: 1 },
    agent: "octo_studio",
    model: { providerID: "test", modelID: "test" },
  })
  const assistant = (id: string, parentID: string): Message => ({
    id,
    parentID,
    sessionID: "session",
    role: "assistant",
    time: { created: 2 },
    agent: "octo_studio",
    mode: "octo_studio",
    modelID: "test",
    providerID: "test",
    path: { cwd: "/tmp", root: "/tmp" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  })
  const input = {
    messages: [user("u1"), user("u2"), assistant("a1", "u1"), assistant("a2", "u2")],
    parts: {
      a1: [guide],
      a2: [result],
      u1: [],
      u2: [
        {
          id: "file",
          sessionID: "session",
          messageID: "u2",
          type: "file",
          mime: "image/png",
          url: "/tmp/.octo/session/uploads/ref.png",
        } satisfies Part,
      ],
    },
  }
  const turns = buildStudioTurns(input)
  expect(turns[0].recommendation?.kind).toBe("guide")
  expect(turns[1].recommendation?.tags).toEqual(["场景：城市"])
  expect(turns[1].inputImages).toHaveLength(1)
  expect(buildStudioConversationContext(input)).toBe("")
  const reasoning = {
    id: "reason", messageID: "a2", sessionID: "session", type: "reasoning", text: "先考虑构图",
    time: { start: 1 }, metadata: { studioPromptExpansionReasoning: { version: 1 } },
  } satisfies Part
  const running = { ...result, metadata: { studioPromptExpansion: { ...result.metadata.studioPromptExpansion, status: "running" } } }
  const preview = {
    id: "preview", messageID: "a2", sessionID: "session", type: "text", text: "仅作临时反馈",
    time: { start: 1 }, metadata: { studioPromptExpansionPreview: { version: 1, attempt: 1, resultPartID: "result" } },
  } satisfies Part
  const active = { ...input, parts: { ...input.parts, a2: [running, reasoning, preview] } }
  expect(buildStudioTurns(active)[1].previewPart).toEqual(preview)
  const repair = { ...preview, id: "repair", text: "", metadata: { studioPromptExpansionPreview: { version: 1, attempt: 2, resultPartID: "result" } } }
  expect(buildStudioTurns({ ...active, parts: { ...active.parts, a2: [running, reasoning, preview, repair] } })[1].previewPart).toEqual(repair)
  expect(buildStudioTurns(active)[1].assistantText).toBe("扩写正文")
  for (const status of ["cancelling", "completed", "failed", "cancelled"]) {
    expect(buildStudioTurns({ ...active, parts: { ...active.parts, a2: [
      { ...running, metadata: { studioPromptExpansion: { ...running.metadata.studioPromptExpansion, status } } }, reasoning, preview,
    ] } })[1].previewPart).toBeUndefined()
  }
})

test("Studio reasoning uses validated markers and never regresses to an older snapshot", () => {
  const part = {
    id: "r", messageID: "m", sessionID: "s", type: "reasoning", text: "构图与光线",
    time: { start: 1 }, metadata: { studioPromptExpansionReasoning: { version: 1 } },
  } satisfies Part
  expect(isExpansionReasoning(part)).toBe(true)
  expect(isExpansionReasoning({ ...part, metadata: { studioPromptExpansionReasoning: true } })).toBe(false)
  expect(mergePromptPart(part, { ...part, text: "" })).toBe(part)
  const complete = { ...part, text: "构图与光线都很重要", time: { start: 1, end: 2 } }
  expect(mergePromptPart(part, complete)).toBe(complete)
  expect(mergePromptPart(complete, part)).toBe(complete)
  expect(mergePromptPart(complete, { ...complete, text: "构图" })).toBe(complete)
  const divergent = { ...part, text: "服务端重建的基线" }
  expect(mergePromptPart(part, divergent)).toBe(divergent)
})


test("preview selection validates metadata, isolates results and keeps empty repair attempts", () => {
  const part = {
    id: "preview", messageID: "m", sessionID: "s", type: "text", text: "首轮正文",
    time: { start: 1 }, metadata: { studioPromptExpansionPreview: { version: 1, attempt: 1, resultPartID: "result" } },
  } satisfies Part
  const repair = { ...part, id: "repair", text: "", metadata: { studioPromptExpansionPreview: { version: 1, attempt: 2, resultPartID: "result" } } }
  expect(isExpansionPreview(part)).toBe(true)
  expect(isExpansionPreview({ ...part, metadata: { studioPromptExpansionPreview: true } })).toBe(false)
  expect(latestExpansionPreview([repair, part], "result")).toBe(repair)
  expect(latestExpansionPreview([repair, part], "other-result")).toBeUndefined()
  expect(mergePromptPart(part, { ...part, text: "" })).toBe(part)
  const complete = { ...part, text: "首轮正文及细节", time: { start: 1, end: 2 } }
  expect(mergePromptPart(part, complete)).toBe(complete)
  expect(mergePromptPart(complete, part)).toBe(complete)
})
