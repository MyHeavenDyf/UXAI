import { describe, expect, it } from "bun:test"
import { readKnowledgeSources } from "./knowledge-references"

// readKnowledgeSources 吃的是 sync store 里 any 化的 part 数组(SPEC-INS-030 §2)。
// 重点不是"取得到",而是**脏数据不能把对话流带崩** —— 取不到就当没有引用。
describe("readKnowledgeSources", () => {
  const sourcePart = (sources: unknown) => ({
    type: "tool",
    tool: "knowledge_search",
    state: { status: "completed", metadata: { sources } },
  })

  it("取出 knowledge_search 的 sources", () => {
    const parts = [
      { type: "text", text: "答案正文[[1]](https://x)" },
      sourcePart([{ n: 1, id: "d1", title: "用户酬金申请", url: "https://x", classification: "用户研究" }]),
    ]
    expect(readKnowledgeSources(parts)).toEqual([
      { n: 1, id: "d1", title: "用户酬金申请", url: "https://x", classification: "用户研究" },
    ])
  })

  it("忽略其它工具与非工具 part", () => {
    const parts = [
      { type: "text", text: "hi" },
      { type: "tool", tool: "bash", state: { status: "completed", metadata: { sources: [{ n: 1, title: "x" }] } } },
    ]
    expect(readKnowledgeSources(parts)).toEqual([])
  })

  it("空结果检索(sources 为空数组)不出引用列表", () => {
    expect(readKnowledgeSources([sourcePart([])])).toEqual([])
  })

  it("脏数据一律降级为无引用,不抛错", () => {
    expect(readKnowledgeSources([sourcePart(null)])).toEqual([])
    expect(readKnowledgeSources([sourcePart("not-an-array")])).toEqual([])
    expect(readKnowledgeSources([{ type: "tool", tool: "knowledge_search" }])).toEqual([])
    expect(readKnowledgeSources([sourcePart([{ title: "缺 n" }, { n: 2 }])])).toEqual([])
    expect(readKnowledgeSources([])).toEqual([])
  })

  it("元素级过滤:坏元素丢掉,好元素保留", () => {
    const parts = [sourcePart([{ n: 1, id: "d1", title: "好的" }, { n: "2", title: "坏的 n" }])]
    expect(readKnowledgeSources(parts)).toEqual([{ n: 1, id: "d1", title: "好的" }])
  })

  it("多条 assistant part 时取第一组非空 sources", () => {
    const parts = [sourcePart([]), sourcePart([{ n: 1, id: "d1", title: "第二次检索" }])]
    expect(readKnowledgeSources(parts)).toEqual([{ n: 1, id: "d1", title: "第二次检索" }])
  })
})
