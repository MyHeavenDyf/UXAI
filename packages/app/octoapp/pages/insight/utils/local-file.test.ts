import { describe, expect, test } from "bun:test"
import { saveDialogName, defaultFilename, ensureMarkdownExt } from "./local-file"

// saveDialogName 只服务 OS 保存对话框的 defaultPath(会被当路径解析),不在落盘链路上。
// 落盘的清洗/拒绝规则在主进程 packages/desktop/src/main/landing-name.ts(SPEC-INS-026 §4.1)。
describe("saveDialogName", () => {
  test("去掉路径分隔符与控制字符", () => {
    expect(saveDialogName("a/b\\c:d*?.md")).toBe("a_b_c_d__.md")
  })
  test("空名兜底 untitled", () => {
    expect(saveDialogName("")).toBe("untitled")
  })
  test("限长 200", () => {
    expect(saveDialogName("x".repeat(300)).length).toBe(200)
  })
})

describe("defaultFilename", () => {
  test("优先 fileName", () => {
    expect(defaultFilename({ fileName: "报告.md", uri: "https://x/y.md", title: "T" })).toBe("报告.md")
  })
  // SPEC-INS-026 §4.1:落盘名逐字保留,渲染侧不再做第二层静默改名
  test("空格 / 括号 / 冒号逐字保留,不再换成 _", () => {
    expect(defaultFilename({ fileName: "林(2).json" })).toBe("林(2).json")
    expect(defaultFilename({ fileName: "我的 报告 v2.md" })).toBe("我的 报告 v2.md")
    expect(defaultFilename({ fileName: "a:b.md" })).toBe("a:b.md")
  })
  test("超长名不再截 200(截断归主进程 landingName,按字节且保扩展名)", () => {
    const name = `${"x".repeat(300)}.md`
    expect(defaultFilename({ fileName: name })).toBe(name)
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
