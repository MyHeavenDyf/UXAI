/**
 * InsightTurn 可见 user 消息判定(供 userMessages 过滤 / Fix 8 发送后自愈 / Fix 9 切换校验共用)。
 *
 * 运行: bun test --preload ./happydom.ts ./octoapp/pages/make/utils/visible-message.test.ts(在 packages/app 下)
 */
import { describe, expect, test } from "bun:test"
import type { Message, Part } from "@opencode-ai/sdk/v2/client"
import { isCompactionInjectedMessage, isVisibleUserMessage } from "./visible-message"

const sessionID = "ses_1"

const userMessage = (id: string): Message => ({
  id,
  sessionID,
  role: "user",
  time: { created: 1 },
  agent: "assistant",
  model: { providerID: "openai", modelID: "gpt" },
})

const assistantMessage = (id: string): Message => ({
  id,
  sessionID,
  role: "assistant",
  time: { created: 1 },
  parentID: "msg_0",
  modelID: "gpt",
  providerID: "openai",
  mode: "primary",
  agent: "assistant",
  path: { cwd: "/", root: "/" },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
})

const textPart = (id: string, messageID: string): Part => ({
  id,
  sessionID,
  messageID,
  type: "text",
  text: id,
})

const compactionPart = (id: string, messageID: string): Part => ({
  id,
  sessionID,
  messageID,
  type: "compaction",
  auto: true,
})

const filePart = (id: string, messageID: string): Part => ({
  id,
  sessionID,
  messageID,
  type: "file",
  mime: "image/png",
  url: "https://example.com/a.png",
})

describe("isVisibleUserMessage", () => {
  test("assistant 消息不可见", () => {
    expect(isVisibleUserMessage(assistantMessage("msg_1"), [textPart("prt_1", "msg_1")])).toBe(false)
  })

  test("user 消息 parts 为 undefined 不可见(SSE gap 丢 part 事件)", () => {
    expect(isVisibleUserMessage(userMessage("msg_1"), undefined)).toBe(false)
  })

  test("user 消息 parts 为空数组不可见", () => {
    expect(isVisibleUserMessage(userMessage("msg_1"), [])).toBe(false)
  })

  test("user 消息带 text part 可见", () => {
    expect(isVisibleUserMessage(userMessage("msg_1"), [textPart("prt_1", "msg_1")])).toBe(true)
  })

  test("user 消息带 file part 可见(纯附件消息)", () => {
    expect(isVisibleUserMessage(userMessage("msg_1"), [filePart("prt_1", "msg_1")])).toBe(true)
  })

  test("仅 compaction part 不可见(自动压缩)", () => {
    expect(isVisibleUserMessage(userMessage("msg_1"), [compactionPart("prt_1", "msg_1")])).toBe(false)
  })

  test("compaction + text part 可见(手动 /compact 回显)", () => {
    expect(
      isVisibleUserMessage(userMessage("msg_1"), [compactionPart("prt_1", "msg_1"), textPart("prt_2", "msg_1")]),
    ).toBe(true)
  })
})

describe("isCompactionInjectedMessage", () => {
  const injectedTextPart = (id: string, metadata: Record<string, unknown>): Part => ({
    id,
    sessionID,
    messageID: "msg_1",
    type: "text",
    text: "Continue if you have next steps...",
    synthetic: true,
    metadata,
  })

  test("Continue 提示注入消息(compaction_continue)判定为注入", () => {
    expect(isCompactionInjectedMessage([injectedTextPart("prt_1", { compaction_continue: true })])).toBe(true)
  })

  test("overflow 回放消息(compaction_replay)判定为注入", () => {
    expect(isCompactionInjectedMessage([injectedTextPart("prt_1", { compaction_replay: true })])).toBe(true)
  })

  test("[附件] synthetic 清单(无注入标记)不是注入消息", () => {
    const part: Part = {
      id: "prt_1",
      sessionID,
      messageID: "msg_1",
      type: "text",
      text: "[附件]\nfile a.png",
      synthetic: true,
    }
    expect(isCompactionInjectedMessage([part])).toBe(false)
  })

  test("普通用户消息不是注入消息", () => {
    expect(isCompactionInjectedMessage([textPart("prt_1", "msg_1")])).toBe(false)
  })

  test("真实 text 与注入标记 part 并存时不是注入消息", () => {
    expect(
      isCompactionInjectedMessage([injectedTextPart("prt_1", { compaction_continue: true }), textPart("prt_2", "msg_1")]),
    ).toBe(false)
  })

  test("undefined / 空数组不是注入消息", () => {
    expect(isCompactionInjectedMessage(undefined)).toBe(false)
    expect(isCompactionInjectedMessage([])).toBe(false)
  })
})
