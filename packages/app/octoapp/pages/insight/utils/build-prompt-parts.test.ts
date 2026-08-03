import { describe, expect, test } from "bun:test"
import { assembleInsightParts } from "./build-prompt-parts"

/**
 * SPEC-INS-027：正常发送与排队 drain 共用的 parts 组装骨架单测。
 * 锁死顺序契约（cleanText → synthetic → txt/md FilePart → 图片 FilePart）与 FilePart 映射，
 * 防止两条发送路径漂移。
 */
describe("assembleInsightParts", () => {
  test("纯文本：只有一个 text part", () => {
    const { parts, imageParts } = assembleInsightParts({ text: "hi" })
    expect(parts).toEqual([{ type: "text", text: "hi" }])
    expect(imageParts).toEqual([])
  })

  test("synthetic 文本按序追加、均标 synthetic", () => {
    const { parts } = assembleInsightParts({ text: "hi", syntheticTexts: ["[附件]…", "chipT", "chipD"] })
    expect(parts).toEqual([
      { type: "text", text: "hi" },
      { type: "text", text: "[附件]…", synthetic: true },
      { type: "text", text: "chipT", synthetic: true },
      { type: "text", text: "chipD", synthetic: true },
    ])
  })

  test("空串的 synthetic 被跳过", () => {
    const { parts } = assembleInsightParts({ text: "hi", syntheticTexts: ["", "x", ""] })
    expect(parts).toEqual([
      { type: "text", text: "hi" },
      { type: "text", text: "x", synthetic: true },
    ])
  })

  test("txt/md → file part(file://, text/plain)；office 被过滤掉", () => {
    const { parts } = assembleInsightParts({
      text: "hi",
      textInlineFiles: [
        { filename: "a.md", path: "/p/a.md" },
        { filename: "b.docx", path: "/p/b.docx" }, // 非 txt/md，isTextInlineFile=false → 不入
      ],
    })
    const fileParts = parts.filter((p) => p.type === "file")
    expect(fileParts).toEqual([{ type: "file", mime: "text/plain", url: "file:///p/a.md", filename: "a.md" }])
  })

  test("图片 → vision file part{url}，mime 缺省 image/png；imageParts 单独返回", () => {
    const { parts, imageParts } = assembleInsightParts({
      text: "hi",
      imageFiles: [
        { filename: "c.png", url: "https://s3/c.png", mime: "image/png" },
        { filename: "d.jpg", url: "https://s3/d.jpg" },
      ],
    })
    expect(imageParts).toEqual([
      { type: "file", mime: "image/png", url: "https://s3/c.png", filename: "c.png" },
      { type: "file", mime: "image/png", url: "https://s3/d.jpg", filename: "d.jpg" },
    ])
    // parts 尾部即 imageParts
    expect(parts.slice(-2)).toEqual(imageParts)
  })

  test("完整顺序：text → synthetic → txt/md → 图片", () => {
    const { parts } = assembleInsightParts({
      text: "T",
      syntheticTexts: ["S1", "S2"],
      textInlineFiles: [{ filename: "a.md", path: "/a.md" }],
      imageFiles: [{ filename: "c.png", url: "u" }],
    })
    expect(parts.map((p) => (p.type === "text" ? p.text : `file:${p.filename}`))).toEqual([
      "T",
      "S1",
      "S2",
      "file:a.md",
      "file:c.png",
    ])
  })
})
