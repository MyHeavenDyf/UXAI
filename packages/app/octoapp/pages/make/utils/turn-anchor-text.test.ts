/**
 * 锚点 hover 气泡文案提取(turnAnchorText)。
 *
 * 运行: bun test --preload ./happydom.ts ./octoapp/pages/make/utils/turn-anchor-text.test.ts(在 packages/app 下)
 */
import { describe, expect, test } from "bun:test"
import type { Part } from "@opencode-ai/sdk/v2/client"
import { turnAnchorText } from "./turn-anchor-text"

const textPart = (text: string, metadata?: Record<string, unknown>): Part => ({
  id: "prt_1",
  sessionID: "ses_1",
  messageID: "msg_1",
  type: "text",
  text,
  ...(metadata ? { metadata } : {}),
})

const filePart = (): Part => ({
  id: "prt_2",
  sessionID: "ses_1",
  messageID: "msg_1",
  type: "file",
  mime: "image/png",
  url: "https://example.com/a.png",
})

describe("turnAnchorText", () => {
  test("parts 为 undefined 返回空串", () => {
    expect(turnAnchorText(undefined)).toBe("")
  })

  test("优先取 metadata.displayText", () => {
    const parts = [textPart("原始内容", { displayText: "  展示文本  " })]
    expect(turnAnchorText(parts)).toBe("展示文本")
  })

  test("无 displayText 时取首个有内容的 text part", () => {
    const parts = [textPart("  "), textPart("正文内容")]
    expect(turnAnchorText(parts)).toBe("正文内容")
  })

  test("剥离最后 \\n---\\n 之前的上下文注入段", () => {
    const parts = [textPart("上下文注入\n---\n用户输入")]
    expect(turnAnchorText(parts)).toBe("用户输入")
  })

  test("换行与连续空白折叠为单个空格", () => {
    const parts = [textPart("第一行\n\n第二行  尾部")]
    expect(turnAnchorText(parts)).toBe("第一行 第二行 尾部")
  })

  test("纯附件消息(file part 无正文)返回 [附件] 占位", () => {
    expect(turnAnchorText([filePart()])).toBe("[附件]")
  })

  test("synthetic [附件] 清单且无正文返回 [附件] 占位", () => {
    const parts: Part[] = [
      { id: "prt_3", sessionID: "ses_1", messageID: "msg_1", type: "text", text: "[附件]\nfile a.png", synthetic: true },
    ]
    expect(turnAnchorText(parts)).toBe("[附件]")
  })

  test("synthetic [附件] 清单与正文并存时返回正文", () => {
    const parts: Part[] = [
      { id: "prt_3", sessionID: "ses_1", messageID: "msg_1", type: "text", text: "[附件]\nfile a.png", synthetic: true },
      textPart("带附件的正文"),
    ]
    expect(turnAnchorText(parts)).toBe("带附件的正文")
  })

  test("空数组返回空串", () => {
    expect(turnAnchorText([])).toBe("")
  })
})
