import { describe, expect, test } from "bun:test"
import type { Message, Part } from "@opencode-ai/sdk/v2/client"
import { isStudioGenerationStatusRegression } from "./studio-shared"
import { buildStudioConversationContext, buildStudioTurns } from "./turns"
import type { StudioGenerationResult } from "./types"

describe("Studio generation status merging", () => {
  test("rejects active states after a terminal state", () => {
    expect(isStudioGenerationStatusRegression("create_failed", "running")).toBe(true)
    expect(isStudioGenerationStatusRegression("create_failed", "queued")).toBe(true)
    expect(isStudioGenerationStatusRegression("failed", "running")).toBe(true)
    expect(isStudioGenerationStatusRegression("failed", "queued")).toBe(true)
    expect(isStudioGenerationStatusRegression("succeeded", "running")).toBe(true)
    expect(isStudioGenerationStatusRegression("succeeded", "queued")).toBe(true)
  })

  test("allows active progress and terminal transitions", () => {
    expect(isStudioGenerationStatusRegression("queued", "running")).toBe(false)
    expect(isStudioGenerationStatusRegression("running", "queued")).toBe(false)
    expect(isStudioGenerationStatusRegression("running", "failed")).toBe(false)
    expect(isStudioGenerationStatusRegression("running", "succeeded")).toBe(false)
  })
})

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

const attachmentToolPart = (id: string, messageID: string, url: string, tool = "jimeng_image_generate", mime = "image/png") =>
  ({
    id,
    sessionID: "ses_1",
    messageID,
    type: "tool",
    callID: `call_${id}`,
    tool,
    state: {
      status: "completed",
      title: "图片生成",
      time: { start: 1, end: 2 },
      output: JSON.stringify({ ok: true, imageCount: 1, primaryImage: "jimeng-1.png" }),
      attachments: [{ mime, url, filename: "jimeng-1.png" }],
    },
  }) as Part

const runningToolPart = (
  id: string,
  messageID: string,
  tool = "internel_image_generate",
  studio?: Record<string, unknown>,
) =>
  ({
    id,
    sessionID: "ses_1",
    messageID,
    type: "tool",
    callID: `call_${id}`,
    tool,
    state: {
      status: "running",
      title: "图片生成",
      time: { start: 1 },
      input: { capability: "image.generate", aspectRatio: "3:4" },
      metadata: studio ? { studio } : undefined,
    },
  }) as Part

const erroredToolPart = (
  id: string,
  messageID: string,
  capability: "image.generate" | "video.generate",
  error = "用户取消生成",
  status: "create_failed" | "failed" = "failed",
) =>
  ({
    id,
    sessionID: "ses_1",
    messageID,
    type: "tool",
    callID: `call_${id}`,
    tool: "internel_image_generate",
    state: {
      status: "error",
      time: { start: 1, end: 2 },
      input: { capability, aspectRatio: capability === "video.generate" ? "16:9" : "3:4" },
      error,
      metadata: {
        studio: {
          generationID: `studio_gen_${id}`,
          status,
          rawStatus: 4,
          progress: 0,
        },
      },
    },
  }) as Part

const editorEntryToolPart = (
  id: string,
  messageID: string,
  capability: "image.upscale" | "image.cutout" | "image.inpaint" | "image.outpaint",
  entryID: string,
) =>
  ({
    id,
    sessionID: "ses_1",
    messageID,
    type: "tool",
    callID: `studio_editor_entry_${entryID}`,
    tool: "studio_editor_entry",
    state: {
      status: "completed",
      title: "进入编辑区",
      time: { start: 1, end: 1 },
      input: { capability, entryID },
      output: JSON.stringify({ type: "editor_entry", capability, entryID }),
      metadata: {
        studio: {
          type: "editor_entry",
          capability,
          entryID,
        },
      },
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

const completedGenerationToolPart = (
  id: string,
  messageID: string,
  input: Record<string, unknown>,
  output: Record<string, unknown> = {},
  tool = "internel_image_generate",
) =>
  ({
    id,
    sessionID: "ses_1",
    messageID,
    type: "tool",
    callID: `call_${id}`,
    tool,
    state: {
      status: "completed",
      title: "图片生成",
      time: { start: 1, end: 2 },
      input,
      output: JSON.stringify({
        ok: true,
        images: ["https://example.com/regenerate.png"],
        ...output,
      }),
    },
  }) as Part

const pendingResult = (status: StudioGenerationResult["status"] = "succeeded"): StudioGenerationResult =>
  ({
    id: "studio_pending_1",
    status,
    capability: "image.generate",
    prompt: "生成一张卡通小猫的图",
    provider: "jimeng",
    model: "jimeng_t2i_v40",
    aspectRatio: "3:4",
    images: [],
    createdAt: 1,
    completedAt: status === "succeeded" ? 1 : undefined,
  }) as StudioGenerationResult

describe("buildStudioTurns", () => {
  test("restores persisted editor entry turns", () => {
    const user = userMessage("msg_editor_user")
    const assistant = assistantMessage("msg_editor_assistant", 2)
    const turns = buildStudioTurns({
      messages: [user, assistant],
      parts: {
        [user.id]: [textPart("p_editor_user", user.id, "变清晰")],
        [assistant.id]: [
          textPart("p_editor_assistant", assistant.id, "点击前往编辑区"),
          editorEntryToolPart("p_editor_tool", assistant.id, "image.upscale", "entry_1"),
        ],
      },
    })

    expect(turns).toHaveLength(1)
    expect(turns[0].editCapability).toBe("image.upscale")
    expect(turns[0].editorEntryID).toBe("entry_1")
    expect(turns[0].result).toBeUndefined()
    expect(turns[0].toolTitle).toBeUndefined()
    expect(turns[0].isLatest).toBe(true)
  })

  test("keeps multiple editor entry turns in order", () => {
    const user1 = userMessage("msg_editor_user_1", 1)
    const assistant1 = assistantMessage("msg_editor_assistant_1", 2)
    const user2 = userMessage("msg_editor_user_2", 3)
    const assistant2 = assistantMessage("msg_editor_assistant_2", 4)
    const turns = buildStudioTurns({
      messages: [user2, assistant2, user1, assistant1],
      parts: {
        [user1.id]: [textPart("p_editor_user_1", user1.id, "变清晰")],
        [assistant1.id]: [editorEntryToolPart("p_editor_tool_1", assistant1.id, "image.upscale", "entry_1")],
        [user2.id]: [textPart("p_editor_user_2", user2.id, "扩图")],
        [assistant2.id]: [editorEntryToolPart("p_editor_tool_2", assistant2.id, "image.outpaint", "entry_2")],
      },
    })

    expect(turns.map((turn) => turn.editCapability)).toEqual(["image.upscale", "image.outpaint"])
    expect(turns[0].isLatest).toBe(false)
    expect(turns[1].isLatest).toBe(true)
  })

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

  test("hides internal tool settings from studio center user text", () => {
    const m1 = userMessage("msg_1")
    const a1 = assistantMessage("msg_2")

    const turns = buildStudioTurns({
      messages: [m1, a1],
      parts: {
        [m1.id]: [
          textPart(
            "p_1",
            m1.id,
            [
              "用户需求：生成一张卡通小猫的图",
              "能力：image.generate",
              "风格模型：千问",
              "画幅比例：3:4",
              "生成数量：1",
              "当前选中的生图工具：internel_image_generate",
              '工具参数JSON：{"styleModel":"千问","aspectRatio":"3:4","count":1}',
              "调用生图工具时必须使用工具参数JSON中的 styleModel、aspectRatio、count。",
              "输出时先简短说明，再调用对应工具。",
            ].join("\n"),
          ),
        ],
        [a1.id]: [textPart("p_2", a1.id, "好的")],
      },
    })

    expect(turns[0].userText).toBe("生成一张卡通小猫的图")
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

  test("marks fallback pending generations as running", () => {
    const turns = buildStudioTurns({
      messages: [],
      parts: {},
      fallback: pendingResult("running"),
    })

    expect(turns[0].toolTitle).toBe("图片生成中")
    expect(turns[0].toolRunning).toBe(true)
    expect(turns[0].result?.status).toBe("running")
  })

  test("keeps queued video fallback labelled as video generation", () => {
    const turns = buildStudioTurns({
      messages: [],
      parts: {},
      fallback: {
        ...pendingResult("queued"),
        capability: "video.generate",
        aspectRatio: "16:9",
      },
    })

    expect(turns[0].toolTitle).toBe("视频生成中")
    expect(turns[0].toolRunning).toBe(true)
    expect(turns[0].result?.capability).toBe("video.generate")
  })

  test("restores queued generation progress from running tool metadata", () => {
    const user = userMessage("msg_progress_user")
    const assistant = assistantMessage("msg_progress_assistant", 2)
    const turns = buildStudioTurns({
      messages: [user, assistant],
      parts: {
        [user.id]: [textPart("p_progress_text", user.id, "生成视频")],
        [assistant.id]: [
          runningToolPart("p_progress_tool", assistant.id, "internel_image_generate", {
            generationID: "studio_gen_1",
            status: "queued",
            progress: 12,
            order: 3,
            rawStatus: 6,
          }),
        ],
      },
    })

    expect(turns[0].result?.id).toBe("studio_gen_1")
    expect(turns[0].result?.status).toBe("queued")
    expect(turns[0].result?.progress).toBe(12)
    expect(turns[0].result?.order).toBe(3)
    expect(turns[0].result?.rawStatus).toBe(6)
  })

  test("preserves video capability after cancelling the first generation", () => {
    const user = userMessage("msg_video_user")
    const assistant = assistantMessage("msg_video_assistant", 2)
    const turns = buildStudioTurns({
      messages: [user, assistant],
      parts: {
        [user.id]: [textPart("p_video_text", user.id, "生成一段海边日落视频")],
        [assistant.id]: [erroredToolPart("p_video_tool", assistant.id, "video.generate")],
      },
    })

    expect(turns[0].toolTitle).toBe("视频生成失败")
    expect(turns[0].toolError).toBe("用户取消生成")
    expect(turns[0].result?.id).toBe("studio_gen_p_video_tool")
    expect(turns[0].result?.status).toBe("failed")
    expect(turns[0].result?.capability).toBe("video.generate")
    expect(turns[0].result?.aspectRatio).toBe("16:9")
    expect(turns[0].result?.error).toBe("用户取消生成")
  })

  test("keeps image capability for failed image generations", () => {
    const user = userMessage("msg_image_user")
    const assistant = assistantMessage("msg_image_assistant", 2)
    const turns = buildStudioTurns({
      messages: [user, assistant],
      parts: {
        [user.id]: [textPart("p_image_text", user.id, "生成一张海报")],
        [assistant.id]: [erroredToolPart("p_image_tool", assistant.id, "image.generate", "生成失败")],
      },
    })

    expect(turns[0].toolTitle).toBe("图片生成失败")
    expect(turns[0].result?.status).toBe("failed")
    expect(turns[0].result?.capability).toBe("image.generate")
    expect(turns[0].result?.error).toBe("生成失败")
  })

  test("uses display prompt for regenerated turns while keeping the effective generation prompt", () => {
    const user = userMessage("msg_regenerate_user")
    const assistant = assistantMessage("msg_regenerate_assistant", 2)
    const turns = buildStudioTurns({
      messages: [user, assistant],
      parts: {
        [user.id]: [textPart("p_regenerate_text", user.id, "一只大黄狗，阳光草地，胶片质感")],
        [assistant.id]: [
          textPart("p_regenerate_assistant", assistant.id, "好的，我会按当前结果的配置重新生成。"),
          completedGenerationToolPart("p_regenerate_tool", assistant.id, {
            capability: "image.generate",
            prompt: "一只大黄狗",
            displayPrompt: "再次生成",
            refinedPrompt: "一只大黄狗，阳光草地，胶片质感",
            effectivePrompt: "一只大黄狗，阳光草地，胶片质感",
            aspectRatio: "3:4",
          }),
        ],
      },
    })

    expect(turns[0].userText).toBe("再次生成")
    expect(turns[0].assistantText).toBe("好的，我会按当前结果的配置重新生成。")
    expect(turns[0].result?.prompt).toBe("一只大黄狗，阳光草地，胶片质感")
    expect(turns[0].result?.displayPrompt).toBe("再次生成")
  })

  test("restores create failure separately from generation failure", () => {
    const user = userMessage("msg_create_failed_user")
    const assistant = assistantMessage("msg_create_failed_assistant", 2)
    const turns = buildStudioTurns({
      messages: [user, assistant],
      parts: {
        [user.id]: [textPart("p_create_failed_text", user.id, "生成一张海报")],
        [assistant.id]: [
          erroredToolPart(
            "p_create_failed_tool",
            assistant.id,
            "image.generate",
            "最多支持同时进行3个生成任务",
            "create_failed",
          ),
        ],
      },
    })

    expect(turns[0].toolTitle).toBe("图片创建失败")
    expect(turns[0].result?.status).toBe("create_failed")
    expect(turns[0].result?.error).toBe("最多支持同时进行3个生成任务")
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

    expect(summary).toBe("生成一张卡通小猫的图")
    expect(summary).not.toContain("上一轮助手说明")
    expect(summary).not.toContain("3:4")
    expect(summary).not.toContain("https://example.com/one.png")
  })

  test("uses the last successful generation when the latest turn is not completed", () => {
    const m1 = userMessage("msg_1", 1)
    const a1 = assistantMessage("msg_2", 2)
    const m2 = userMessage("msg_3", 3)
    const a2 = assistantMessage("msg_4", 4)

    const summary = buildStudioConversationContext({
      messages: [m1, a1, m2, a2],
      parts: {
        [m1.id]: [textPart("p_1", m1.id, "生成一张卡通小猫的图")],
        [a1.id]: [
          textPart("p_2", a1.id, "第一轮完成"),
          toolPart("p_3", a1.id, JSON.stringify({ images: ["https://example.com/one.png"] })),
        ],
        [m2.id]: [textPart("p_4", m2.id, "把它改成夜景")],
        [a2.id]: [runningToolPart("p_5", a2.id)],
      },
    })

    expect(summary).toBe("生成一张卡通小猫的图")
    expect(summary).not.toContain("https://example.com/one.png")
    expect(summary).not.toContain("把它改成夜景")
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

  test("restores studio generation metadata from unified tool output", () => {
    const m1 = userMessage("msg_1")
    const a1 = assistantMessage("msg_2")

    const turns = buildStudioTurns({
      messages: [m1, a1],
      parts: {
        [m1.id]: [textPart("p_1", m1.id, "将当前图片变清晰，提升分辨率和细节")],
        [a1.id]: [
          ({
            id: "p_2",
            sessionID: "ses_1",
            messageID: a1.id,
            type: "tool",
            tool: "internel_image_generate",
            state: {
              status: "completed",
              title: "图片生成",
              input: {
                capability: "image.upscale",
                aspectRatio: "16:9",
              },
              time: { start: 1, end: 2 },
              output: JSON.stringify({
                ok: true,
                capability: "image.upscale",
                toolAction: "super_resolution",
                taskId: "task_1",
                model: "magnify",
                aspectRatio: "16:9",
                width: 1280,
                height: 720,
                images: ["https://example.com/upscaled.png"],
              }),
            },
          }) as unknown as Part,
        ],
      },
    })

    expect(turns[0].result?.capability).toBe("image.upscale")
    expect(turns[0].result?.toolAction).toBe("super_resolution")
    expect(turns[0].result?.taskId).toBe("task_1")
    expect(turns[0].result?.model).toBe("magnify")
    expect(turns[0].result?.aspectRatio).toBe("16:9")
    expect(turns[0].result?.images[0]?.width).toBe(1280)
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
    expect(turns[0].result?.images[0]?.kind).toBe("image")
    expect(turns[0].toolTitle).toBe("图片生成完成")
  })

  test("keeps remove_bg png attachment as an image", () => {
    const m1 = userMessage("msg_1")
    const a1 = assistantMessage("msg_2")

    const turns = buildStudioTurns({
      messages: [m1, a1],
      parts: {
        [m1.id]: [textPart("p_1", m1.id, "抠图")],
        [a1.id]: [attachmentToolPart("p_2", a1.id, "http://localhost:3000/static/images/remove_bg/test4.png")],
      },
    })

    expect(turns[0].result?.images[0]?.url).toBe("http://localhost:3000/static/images/remove_bg/test4.png")
    expect(turns[0].result?.images[0]?.kind).toBe("image")
  })

  test("keeps remove_bg png tool output as an image", () => {
    const m1 = userMessage("msg_1")
    const a1 = assistantMessage("msg_2")

    const turns = buildStudioTurns({
      messages: [m1, a1],
      parts: {
        [m1.id]: [textPart("p_1", m1.id, "抠图")],
        [a1.id]: [
          toolPart(
            "p_2",
            a1.id,
            JSON.stringify({
              images: ["http://localhost:3000/static/images/remove_bg/test4.png"],
              primaryImage: "http://localhost:3000/static/images/remove_bg/test4.png",
            }),
          ),
        ],
      },
    })

    expect(turns[0].result?.images).toHaveLength(1)
    expect(turns[0].result?.images[0]?.kind).toBe("image")
  })

  test("keeps image mime authoritative when url contains mov", () => {
    const m1 = userMessage("msg_1")
    const a1 = assistantMessage("msg_2")

    const turns = buildStudioTurns({
      messages: [m1, a1],
      parts: {
        [m1.id]: [textPart("p_1", m1.id, "生成海报")],
        [a1.id]: [attachmentToolPart("p_2", a1.id, "https://example.com/movie/poster.png")],
      },
    })

    expect(turns[0].result?.images[0]?.kind).toBe("image")
  })

  test("recognizes video attachments by extension and mime", () => {
    const m1 = userMessage("msg_1")
    const a1 = assistantMessage("msg_2")
    const m2 = userMessage("msg_3", 3)
    const a2 = assistantMessage("msg_4", 4)

    const turns = buildStudioTurns({
      messages: [m1, a1, m2, a2],
      parts: {
        [m1.id]: [textPart("p_1", m1.id, "生成视频")],
        [a1.id]: [attachmentToolPart("p_2", a1.id, "https://example.com/result.MOV?token=1", "internel_image_generate", "")],
        [m2.id]: [textPart("p_3", m2.id, "生成视频")],
        [a2.id]: [attachmentToolPart("p_4", a2.id, "https://example.com/download?id=1", "internel_image_generate", "video/mp4")],
      },
    })

    expect(turns[0].result?.images[0]?.kind).toBe("video")
    expect(turns[1].result?.images[0]?.kind).toBe("video")
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

  test("marks the latest running image tool turn", () => {
    const m1 = userMessage("msg_1")
    const a1 = assistantMessage("msg_2")

    const turns = buildStudioTurns({
      messages: [m1, a1],
      parts: {
        [m1.id]: [textPart("p_1", m1.id, "继续生成一张卡通小狗的图")],
        [a1.id]: [runningToolPart("p_2", a1.id)],
      },
    })

    expect(turns[0].toolRunning).toBe(true)
    expect(turns[0].toolTitle).toBe("图片生成中")
    expect(turns[0].isLatest).toBe(true)
  })
})
