import { expect, test } from "bun:test"
import type { Message, Part } from "@opencode-ai/sdk/v2/client"
import { mergePromptPart } from "./studio-prompt-state"
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
})
