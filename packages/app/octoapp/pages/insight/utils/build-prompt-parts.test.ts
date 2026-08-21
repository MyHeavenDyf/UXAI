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

  test("文本类 → file part(file://, text/plain)；office 被过滤掉", () => {
    const { parts } = assembleInsightParts({
      text: "hi",
      textInlineFiles: [
        { filename: "a.md", path: "/p/a.md" },
        { filename: "b.docx", path: "/p/b.docx" }, // office → extract_document，不内联
      ],
    })
    const fileParts = parts.filter((p) => p.type === "file")
    expect(fileParts).toEqual([{ type: "file", mime: "text/plain", url: "file:///p/a.md", filename: "a.md" }])
  })

  // 2026-08-20：内联判定改为**反向排除**（只排 office/pdf/图片，其余交服务端 read 判二进制），
  // 这样上传格式放开（json/csv…）时无需再同步一次内联清单。
  test("反向排除：非 office/pdf/图片的文本类一律内联（csv/json/log/html/无扩展名）", () => {
    const files = [
      { filename: "a.csv", path: "/p/a.csv" },
      { filename: "b.json", path: "/p/b.json" },
      { filename: "c.log", path: "/p/c.log" },
      { filename: "d.html", path: "/p/d.html" },
      { filename: "README", path: "/p/README" },
      { filename: "e.mmd", path: "/p/e.mmd" },
    ]
    const { parts } = assembleInsightParts({ text: "hi", textInlineFiles: files })
    expect(parts.filter((p) => p.type === "file").map((p) => p.filename)).toEqual(files.map((f) => f.filename))
  })

  test("反向排除：office / pdf / 图片都不走内联", () => {
    const { parts } = assembleInsightParts({
      text: "hi",
      textInlineFiles: [
        { filename: "a.docx", path: "/p/a.docx" },
        { filename: "b.xlsx", path: "/p/b.xlsx" },
        { filename: "c.pptx", path: "/p/c.pptx" },
        { filename: "d.pdf", path: "/p/d.pdf" },
        { filename: "e.png", path: "/p/e.png" },
        { filename: "f.jpeg", path: "/p/f.jpeg" },
      ],
    })
    expect(parts.filter((p) => p.type === "file")).toEqual([])
  })

  // `@` 引用的文件与附件由调用方合并后传入同一入参（SPEC-INS-023 §7.2 2026-08-20 修订）：
  // 同一文件既是本轮附件、又被 `@` 引用时只内联一次，否则同份正文在上下文里存两遍。
  test("同一 path 出现两次（附件 + @ 引用）只内联一次", () => {
    const { parts } = assembleInsightParts({
      text: "hi",
      textInlineFiles: [
        { filename: "a.md", path: "/p/a.md" },
        { filename: "a.md", path: "/p/a.md" },
        { filename: "b.md", path: "/p/b.md" },
      ],
    })
    expect(parts.filter((p) => p.type === "file").map((p) => p.filename)).toEqual(["a.md", "b.md"])
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
