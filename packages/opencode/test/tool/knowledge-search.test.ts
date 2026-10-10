import { describe, expect, it } from "bun:test"
import { buildOutput, parseDocs } from "../../src/tool/knowledge_search"

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

// 同 insight_report_search 的回归门禁(2026-10-10):模型抄占位符 URL 的 bug 在这边是同源的
// (两个工具的 output 前缀同出一脉),故一并钉住——不给模型 URL,它就不可能写错 URL。

// buildOutput 的回归门禁(2026-10-10 内网实测的 bug)。
//
// 当时提示词示例里写着 `[[1]](https://...)`,GLM 把那个**占位符**当内容原样抄进回答,
// 用户点开得到 `https://.../`。根因是我们自己埋了一个语法上成立的假 URL —— 真实地址模型是会
// 照抄的。所以修法是**删掉可抄的假 URL**,而不是不给模型链接(不给就没有行内可点角标了)。
// 下面第一条用例钉的就是这一点:谁再往提示词里塞一个 `https://` 开头的示例地址,这里就红。
describe("buildOutput(给模型看的检索结果)", () => {
  const docs = parseDocs([
    {
      documentId: "a",
      chunkTitle: "普通用户申请酬金",
      chunkContent: "正文 A",
      documentUrl: "https://octo.hdesign.huawei.com/x?id=695",
    },
  ])

  it("指令部分不含任何可被照抄的假 URL", () => {
    const instructions = buildOutput(docs).split("[1] ")[0]
    expect(instructions).not.toContain("https://")
    expect(instructions).not.toContain("http://")
  })

  it("片段头给出真实链接,供模型写 [[n]](链接)", () => {
    const out = buildOutput(docs)
    expect(out).toContain("[1] 普通用户申请酬金 — 链接:https://octo.hdesign.huawei.com/x?id=695")
  })

  it("无 url 的条目不编出一个链接字段", () => {
    const noUrl = parseDocs([{ documentId: "a", chunkTitle: "无链接", chunkContent: "正文" }])
    // 只看片段段(指令段里本来就提到「— 链接:」这个字段名)
    const fragments = buildOutput(noUrl).split("[1] ")[1]
    expect(fragments).toBe("无链接\n正文")
  })

  it("超长正文按上限截断", () => {
    const long = parseDocs([{ documentId: "a", chunkTitle: "长文", chunkContent: "x".repeat(50) }])
    expect(buildOutput(long, 10)).toContain("xxxxxxxxxx…")
  })
})
