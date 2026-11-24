/**
 * InsightTurn 可见 user 消息判定(供 userMessages 过滤 / Fix 8 发送后自愈 / Fix 9 切换校验共用)
 * + 自动压缩回填轮判定(isHiddenCompactionTurn)
 * + task 子会话隐藏 prompt 判定(isHiddenTaskPromptMessage)。
 *
 * 运行: bun test --preload ./happydom.ts ./octoapp/pages/make/utils/visible-message.test.ts(在 packages/app 下)
 */
import { describe, expect, test } from "bun:test"
import type { Message, Part } from "@opencode-ai/sdk/v2/client"
import { isHiddenCompactionTurn, isHiddenTaskPromptMessage, isVisibleUserMessage } from "./visible-message"

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

describe("isHiddenCompactionTurn", () => {
  test("replay: text part 带 metadata.compaction_replay 判定为隐藏轮", () => {
    expect(
      isHiddenCompactionTurn([{ type: "text", text: "做个落地页", metadata: { compaction_replay: true } }]),
    ).toBe(true)
  })

  test("replay 轮同时带附件占位 part 也判定为隐藏轮", () => {
    expect(
      isHiddenCompactionTurn([
        { type: "text", text: "做个落地页", metadata: { compaction_replay: true } },
        { type: "text", text: "[Attached image/png: a.png]", synthetic: true, metadata: { compaction_replay: true } },
      ]),
    ).toBe(true)
  })

  test("continue: synthetic text 带 metadata.compaction_continue 判定为隐藏轮", () => {
    expect(
      isHiddenCompactionTurn([
        { type: "text", text: "Continue if you have next steps", synthetic: true, metadata: { compaction_continue: true } },
      ]),
    ).toBe(true)
  })

  test("普通消息不为隐藏轮", () => {
    expect(isHiddenCompactionTurn([{ type: "text", text: "hi" }])).toBe(false)
    expect(isHiddenCompactionTurn(undefined)).toBe(false)
    expect(isHiddenCompactionTurn([])).toBe(false)
  })

  test("含 compaction part 的消息优先走压缩 turn 逻辑,不在此隐藏", () => {
    expect(
      isHiddenCompactionTurn([
        { type: "compaction", auto: false },
        { type: "text", text: "/compact", synthetic: true, metadata: { compaction_continue: true } },
      ]),
    ).toBe(false)
  })

  test("synthetic 但无 compaction_continue 标记不为隐藏轮(手动 /compact 回显等)", () => {
    expect(isHiddenCompactionTurn([{ type: "text", text: "/compact", synthetic: true }])).toBe(false)
  })

  test("metadata 非对象或标记非 true 不判定为隐藏轮", () => {
    expect(isHiddenCompactionTurn([{ type: "text", text: "hi", metadata: null }])).toBe(false)
    expect(
      isHiddenCompactionTurn([{ type: "text", text: "hi", metadata: { compaction_replay: "true" } }]),
    ).toBe(false)
  })
})

describe("isHiddenTaskPromptMessage", () => {
  const childUser = (agent: string): Message =>
    ({ ...userMessage("msg_1"), sessionID: "ses_child", agent }) as Message
  const mainUser = (agent: string): Message => ({ ...userMessage("msg_1"), agent }) as Message

  test("octo_design/octo_code/plan 子会话消息是隐藏 task prompt", () => {
    for (const agent of ["octo_design", "octo_code", "plan"]) {
      expect(isHiddenTaskPromptMessage(childUser(agent), sessionID)).toBe(true)
    }
  })

  test("主会话消息不是隐藏 task prompt", () => {
    for (const agent of ["octo_design", "octo_code", "plan", "octo_make"]) {
      expect(isHiddenTaskPromptMessage(mainUser(agent), sessionID)).toBe(false)
    }
  })

  test("其他子代理(octo_make_plan/ict_pattern)的子会话消息不是隐藏 task prompt", () => {
    for (const agent of ["octo_make_plan", "ict_pattern"]) {
      expect(isHiddenTaskPromptMessage(childUser(agent), sessionID)).toBe(false)
    }
  })

  test("消息缺 sessionID 时按主会话处理,不是隐藏 task prompt", () => {
    const noSession = { ...userMessage("msg_1"), agent: "octo_design" } as Message
    delete (noSession as { sessionID?: string }).sessionID
    expect(isHiddenTaskPromptMessage(noSession, sessionID)).toBe(false)
  })

  test("主会话 id 为空时恒为 false", () => {
    expect(isHiddenTaskPromptMessage(childUser("octo_design"), undefined)).toBe(false)
  })
})
