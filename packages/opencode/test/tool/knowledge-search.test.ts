import { describe, expect, it } from "bun:test"
import { parseDocs } from "../../src/tool/knowledge_search"

// 新接口 queryKnowledge 的响应整形(SPEC-INS-030 §4.2 / §7,Q3 定案:只查全量库)。
// 后端已按 documentId 去重 + 按相关性降序返回;parseDocs 只做:保序、按 documentId 兜底去重、
// chunkTitle→title(缺则取正文首个 md 标题 / id)、chunkContent→content、documentUrl→url。
describe("parseDocs(新接口扁平数组)", () => {
  it("按返回序整形,字段映射正确", () => {
    const docs = parseDocs([
      { documentId: "b", chunkTitle: "文档B", chunkContent: "正文 B", documentUrl: "https://x/b" },
      { documentId: "a", chunkTitle: "文档A", chunkContent: "正文 A", documentUrl: "https://x/a" },
    ])
    expect(docs).toEqual([
      { id: "b", title: "文档B", url: "https://x/b", content: "正文 B" },
      { id: "a", title: "文档A", url: "https://x/a", content: "正文 A" },
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
    expect(docs).toEqual([{ id: "b", title: "有内容", url: "https://x/b", content: "正文" }])
  })

  it("非数组 / 脏 payload 一律降级为空,不抛错", () => {
    expect(parseDocs(null)).toEqual([])
    expect(parseDocs({ data: [] })).toEqual([])
    expect(parseDocs("nope")).toEqual([])
    expect(parseDocs([])).toEqual([])
  })
})
