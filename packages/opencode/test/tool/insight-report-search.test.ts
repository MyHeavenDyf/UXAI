import { describe, expect, it } from "bun:test"
import { parseDocs } from "../../src/tool/insight_report_search"

// 研究报告库接口 queryReportKnowledge 的响应整形(SPEC-INS-034 §3.3 / §4)。
// 与 knowledge_search 的 parseDocs 同构(扁平数组、按 documentId 兜底去重、保序、不截断),
// 差别只在**多一个 downloadUrl**:null / 键缺失 / 空串一律归一成 undefined,不写成空串。
describe("parseDocs(研究报告库扁平数组)", () => {
  it("按返回序整形,字段映射正确", () => {
    const docs = parseDocs([
      {
        documentId: "b",
        chunkTitle: "报告B",
        chunkContent: "正文 B",
        documentUrl: "https://x/b",
        downloadUrl: "https://x/b.docx",
      },
      { documentId: "a", chunkTitle: "报告A", chunkContent: "正文 A", documentUrl: "https://x/a", downloadUrl: null },
    ])
    expect(docs).toEqual([
      { id: "b", title: "报告B", url: "https://x/b", content: "正文 B", downloadUrl: "https://x/b.docx" },
      { id: "a", title: "报告A", url: "https://x/a", content: "正文 A", downloadUrl: undefined },
    ])
  })

  it("按 documentId 兜底去重,保留首次(相关性更高)出现", () => {
    const docs = parseDocs([
      { documentId: "a", chunkTitle: "先出现", chunkContent: "第一条", documentUrl: "https://x/a" },
      { documentId: "a", chunkTitle: "同文档另一 chunk", chunkContent: "第二条", documentUrl: "https://x/a" },
    ])
    expect(docs).toHaveLength(1)
    expect(docs[0].title).toBe("先出现")
    expect(docs[0].content).toBe("第一条")
  })

  it("保持返回序,不按标题/id 重排", () => {
    const docs = parseDocs([
      { documentId: "z", chunkTitle: "最相关", chunkContent: "1" },
      { documentId: "a", chunkTitle: "次相关", chunkContent: "2" },
      { documentId: "m", chunkTitle: "再次", chunkContent: "3" },
    ])
    expect(docs.map((d) => d.id)).toEqual(["z", "a", "m"])
  })

  // downloadUrl 三态(spec §4 / §3.4 A1):有值 / null / 键缺失。
  it("downloadUrl 有值 → 原样解析", () => {
    const docs = parseDocs([
      { documentId: "a", chunkTitle: "报告", chunkContent: "正文", downloadUrl: "https://x/a.docx" },
    ])
    expect(docs[0].downloadUrl).toBe("https://x/a.docx")
  })

  it("downloadUrl 为 null → undefined(当前真实数据的形态)", () => {
    const docs = parseDocs([{ documentId: "a", chunkTitle: "报告", chunkContent: "正文", downloadUrl: null }])
    expect(docs[0].downloadUrl).toBeUndefined()
  })

  it("downloadUrl 键缺失 → undefined", () => {
    const docs = parseDocs([{ documentId: "a", chunkTitle: "报告", chunkContent: "正文" }])
    expect(docs[0].downloadUrl).toBeUndefined()
  })

  it("downloadUrl 为空串 / 非字符串 → undefined,不写成空串", () => {
    const docs = parseDocs([
      { documentId: "a", chunkTitle: "空串", chunkContent: "正文", downloadUrl: "" },
      { documentId: "b", chunkTitle: "非串", chunkContent: "正文", downloadUrl: 123 },
    ])
    expect(docs[0].downloadUrl).toBeUndefined()
    expect(docs[1].downloadUrl).toBeUndefined()
  })

  it("chunkTitle 缺失 → 取正文首个 markdown 标题兜底", () => {
    const docs = parseDocs([{ documentId: "a", chunkContent: "# 兜底标题\n正文", documentUrl: "https://x/a" }])
    expect(docs[0].title).toBe("兜底标题")
  })

  it("chunkTitle 与正文标题都缺 → 用 id 兜底", () => {
    const docs = parseDocs([{ documentId: "a", chunkContent: "没有标题的一段正文" }])
    expect(docs[0].title).toBe("a")
    expect(docs[0].url).toBeUndefined()
  })

  it("空正文的条目跳过", () => {
    const docs = parseDocs([
      { documentId: "a", chunkTitle: "空", chunkContent: "   ", documentUrl: "https://x/a" },
      { documentId: "b", chunkTitle: "有内容", chunkContent: "正文", documentUrl: "https://x/b" },
    ])
    expect(docs).toEqual([
      { id: "b", title: "有内容", url: "https://x/b", content: "正文", downloadUrl: undefined },
    ])
  })

  it("空数组 / 非数组 / 脏 payload 一律降级为空,不抛错", () => {
    expect(parseDocs([])).toEqual([])
    expect(parseDocs(null)).toEqual([])
    expect(parseDocs({ data: [] })).toEqual([])
    expect(parseDocs("nope")).toEqual([])
  })
})
