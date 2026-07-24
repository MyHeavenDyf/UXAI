import { describe, expect, test } from "bun:test"
import { sanitizeFilename, defaultFilename, ensureMarkdownExt, isPendingUploadPath } from "./local-file"

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

describe("isPendingUploadPath", () => {
  test("预会话落地区(Windows 反斜杠)", () => {
    expect(isPendingUploadPath("D:\\proj\\.octo\\tmps\\访谈稿.docx")).toBe(true)
  })
  test("预会话落地区(POSIX)", () => {
    expect(isPendingUploadPath("/proj/.octo/tmps/访谈稿.docx")).toBe(true)
  })
  test("已归属会话的不再挪", () => {
    expect(isPendingUploadPath("/proj/.octo/ses_1/uploads/访谈稿.docx")).toBe(false)
  })
  // 落点在 b90d404c6 收进 .octo 根前是 insight/uploads/;老路径不该被当成待搬迁。
  test("旧布局路径不误判", () => {
    expect(isPendingUploadPath("/proj/insight/uploads/访谈稿.docx")).toBe(false)
  })
  test("不在 .octo 下的同名目录不误判", () => {
    expect(isPendingUploadPath("/proj/tmps/访谈稿.docx")).toBe(false)
  })
})
