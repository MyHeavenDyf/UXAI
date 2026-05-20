import { describe, expect, test } from "bun:test"
import type { Message, Part } from "@opencode-ai/sdk/v2/client"
import { buildStudioConversationContext, buildStudioTurns } from "./turns"
import type { StudioGenerationResult } from "./types"

const userMessage = (id: string, time = 1) =>
  ({
    id,
    sessionID: "ses_1",
    role: "user",
    time: { created: time },
    agent: "assistant",
    model: { providerID: "openai", modelID: "gpt" },
  }) as Message

const assistantMessage = (id: string, time = 1) =>
  ({
    id,
    sessionID: "ses_1",
    role: "assistant",
    time: { created: time },
    agent: "assistant",
    model: { providerID: "openai", modelID: "gpt" },
    parentID: "msg_0",
    modelID: "gpt",
    providerID: "openai",
    mode: "default",
  }) as unknown as Message

const textPart = (id: string, messageID: string, text: string) =>
  ({
    id,
    sessionID: "ses_1",
    messageID,
    type: "text",
    text,
  }) as Part

  const toolPart = (id: string, messageID: string, output: string, tool = "jimeng_image_generate") =>
    ({
      id,
      sessionID: "ses_1",
      messageID,
    type: "tool",
    tool,
      state: {
        status: "completed",
        title: "图片生成",
        time: { start: 1, end: 2 },
        output,
      },
    }) as Part

const attachmentToolPart = (id: string, messageID: string, url: string, tool = "jimeng_image_generate") =>
  ({
    id,
    sessionID: "ses_1",
    messageID,
    type: "tool",
    tool,
    state: {
      status: "completed",
      title: "图片生成",
      time: { start: 1, end: 2 },
      output: JSON.stringify({ ok: true, imageCount: 1, primaryImage: "jimeng-1.png" }),
      attachments: [{ mime: "image/png", url, filename: "jimeng-1.png" }],
    },
  }) as Part

const contentFileToolPart = (id: string, messageID: string, url: string, tool = "internel_image_generate") =>
  ({
    id,
    sessionID: "ses_1",
    messageID,
    type: "tool",
    tool,
    state: {
      status: "completed",
      title: "图片生成",
      time: { start: 1, end: 2 },
      output: JSON.stringify({ ok: true, imageCount: 1, primaryImage: "internel-1.png" }),
      content: [{ type: "file", uri: url, mime: "image/png", name: "internel-1.png" }],
    },
  }) as unknown as Part

const pendingResult = (): StudioGenerationResult =>
  ({
    id: "studio_pending_1",
    status: "succeeded",
    capability: "image.generate",
    prompt: "生成一张卡通小猫的图",
    provider: "jimeng",
    model: "jimeng_t2i_v40",
    aspectRatio: "3:4",
    images: [],
    createdAt: 1,
    completedAt: 1,
  }) as StudioGenerationResult

describe("buildStudioTurns", () => {
  test("keeps earlier turns when a second user message arrives", () => {
    const m1 = userMessage("msg_1")
    const a1 = assistantMessage("msg_2")
    const m2 = userMessage("msg_3", 3)
    const a2 = assistantMessage("msg_4", 4)

    const turns = buildStudioTurns({
      messages: [m1, a1, m2, a2],
      parts: {
        [m1.id]: [textPart("p_1", m1.id, "第一轮")],
        [a1.id]: [
          textPart("p_2", a1.id, "第一轮回复"),
          toolPart("p_3", a1.id, JSON.stringify({ images: ["https://example.com/one.png"] })),
        ],
        [m2.id]: [textPart("p_4", m2.id, "第二轮")],
        [a2.id]: [textPart("p_5", a2.id, "第二轮回复")],
      },
    })

    expect(turns).toHaveLength(2)
    expect(turns[0].userText).toBe("第一轮")
    expect(turns[0].assistantText).toBe("第一轮回复")
    expect(turns[0].result?.images[0]?.url).toBe("https://example.com/one.png")
    expect(turns[0].isLatest).toBe(false)
    expect(turns[1].userText).toBe("第二轮")
    expect(turns[1].assistantText).toBe("第二轮回复")
    expect(turns[1].isLatest).toBe(true)
  })

  test("sorts messages before building turns", () => {
    const m1 = userMessage("msg_1", 1)
    const a1 = assistantMessage("msg_2", 2)
    const m2 = userMessage("msg_3", 3)
    const a2 = assistantMessage("msg_4", 4)

    const turns = buildStudioTurns({
      messages: [a2, m2, a1, m1],
      parts: {
        [m1.id]: [textPart("p_1", m1.id, "第一轮")],
        [a1.id]: [textPart("p_2", a1.id, "第一轮回复"), toolPart("p_3", a1.id, JSON.stringify({ images: ["https://example.com/one.png"] }))],
        [m2.id]: [textPart("p_4", m2.id, "第二轮")],
        [a2.id]: [textPart("p_5", a2.id, "第二轮回复")],
      },
    })

    expect(turns).toHaveLength(2)
    expect(turns[0].userText).toBe("第一轮")
    expect(turns[1].userText).toBe("第二轮")
  })

  test("falls back to the pending generation when messages are still empty", () => {
    const turns = buildStudioTurns({
      messages: [],
      parts: {},
      fallback: pendingResult(),
    })

    expect(turns).toHaveLength(1)
    expect(turns[0].userText).toBe("生成一张卡通小猫的图")
    expect(turns[0].isLatest).toBe(true)
  })

  test("builds a continuity summary from the latest completed turn", () => {
    const m1 = userMessage("msg_1")
    const a1 = assistantMessage("msg_2")

    const summary = buildStudioConversationContext({
      messages: [m1, a1],
      parts: {
        [m1.id]: [textPart("p_1", m1.id, "生成一张卡通小猫的图")],
        [a1.id]: [
          textPart("p_2", a1.id, "保持可爱风格，背景更明亮"),
          toolPart("p_3", a1.id, JSON.stringify({ images: ["https://example.com/one.png"] })),
        ],
      },
    })

    expect(summary).toContain("上一轮用户需求：生成一张卡通小猫的图")
    expect(summary).toContain("上一轮助手说明：保持可爱风格，背景更明亮")
    expect(summary).toContain("上一轮生成结果：模型 jimeng_image_generate，比例 3:4，1 张图")
  })

  test("marks internel tool results with the internel provider", () => {
    const m1 = userMessage("msg_1")
    const a1 = assistantMessage("msg_2")

    const turns = buildStudioTurns({
      messages: [m1, a1],
      parts: {
        [m1.id]: [textPart("p_1", m1.id, "生成一张卡通小狗的图")],
        [a1.id]: [
          toolPart("p_2", a1.id, JSON.stringify({ images: ["https://example.com/two.png"] }), "internel_image_generate"),
        ],
      },
    })

    expect(turns[0].result?.provider).toBe("internel")
  })

  test("ignores request urls when extracting images from tool output", () => {
    const m1 = userMessage("msg_1")
    const a1 = assistantMessage("msg_2")

    const turns = buildStudioTurns({
      messages: [m1, a1],
      parts: {
        [m1.id]: [textPart("p_1", m1.id, "生成一张卡通小猫的图")],
        [a1.id]: [
          toolPart(
            "p_2",
            a1.id,
            JSON.stringify({
              ok: true,
              request: {
                url: "https://visual.volcengineapi.com?Action=CVProcess&Version=2022-08-31",
              },
              images: [
                "https://visual.volcengineapi.com?Action=CVProcess&Version=2022-08-31",
                "https://example.com/final.png",
              ],
              primaryImage: "https://example.com/final.png",
            }),
          ),
        ],
      },
    })

    expect(turns[0].result?.images[0]?.url).toBe("https://example.com/final.png")
  })

  test("uses tool attachments when present", () => {
    const m1 = userMessage("msg_1")
    const a1 = assistantMessage("msg_2")

    const turns = buildStudioTurns({
      messages: [m1, a1],
      parts: {
        [m1.id]: [textPart("p_1", m1.id, "生成一张卡通小狗的图")],
        [a1.id]: [attachmentToolPart("p_2", a1.id, "data:image/png;base64,QUJDREVGRw==")],
      },
    })

    expect(turns[0].result?.images[0]?.url).toBe("data:image/png;base64,QUJDREVGRw==")
  })

  test("uses file content urls when attachments are omitted from tool state", () => {
    const m1 = userMessage("msg_1")
    const a1 = assistantMessage("msg_2")

    const turns = buildStudioTurns({
      messages: [m1, a1],
      parts: {
        [m1.id]: [textPart("p_1", m1.id, "生成一张卡通小狗的图")],
        [a1.id]: [contentFileToolPart("p_2", a1.id, "data:image/png;base64,QUJDREVGRw==")],
      },
    })

    expect(turns[0].result?.provider).toBe("internel")
    expect(turns[0].result?.images[0]?.url).toBe("data:image/png;base64,QUJDREVGRw==")
  })
})
