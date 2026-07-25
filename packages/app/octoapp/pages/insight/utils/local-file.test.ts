import { describe, expect, test } from "bun:test"
import { sanitizeFilename, defaultFilename, ensureMarkdownExt } from "./local-file"

describe("sanitizeFilename", () => {
  test("去掉路径分隔符与控制字符", () => {
    expect(sanitizeFilename("a/b\\c:d*?.md")).toBe("a_b_c_d__.md")
  })
  test("空名兜底 untitled", () => {
    expect(sanitizeFilename("")).toBe("untitled")
  })
  test("限长 200", () => {
    expect(sanitizeFilename("x".repeat(300)).length).toBe(200)
  })
})

describe("defaultFilename", () => {
  test("优先 fileName", () => {
    expect(defaultFilename({ fileName: "报告.md", uri: "https://x/y.md", title: "T" })).toBe("报告.md")
  })
  test("无 fileName 取 uri basename(解码)", () => {
    expect(defaultFilename({ uri: "https://x/a/%E6%8A%A5%E5%91%8A.md" })).toBe("报告.md")
  })
  test("uri 非标准 URL 落到 title", () => {
    expect(defaultFilename({ uri: "not a url", title: "我的文档" })).toBe("我的文档")
  })
  test("都没有兜底 download", () => {
    expect(defaultFilename({})).toBe("download")
  })
})

describe("ensureMarkdownExt", () => {
  test("非 md 结尾补 .md", () => {
    expect(ensureMarkdownExt("report")).toBe("report.md")
    expect(ensureMarkdownExt("a.txt")).toBe("a.txt.md")
  })
  test("已是 md 系列不重复补", () => {
    expect(ensureMarkdownExt("a.md")).toBe("a.md")
    expect(ensureMarkdownExt("a.markdown")).toBe("a.markdown")
    expect(ensureMarkdownExt("A.MD")).toBe("A.MD")
  })
})
