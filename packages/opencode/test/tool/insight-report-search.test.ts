import { describe, expect, it } from "bun:test"
import { buildOutput, parseDocs } from "../../src/tool/insight_report_search"

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

// buildOutput 的回归门禁(2026-10-10 内网实测的 bug):模型把提示词里的占位符 `https://...`
// 原样抄进了回答,用户点开得到 `https://.../`。修法不是改措辞,而是**让模型根本拿不到 URL**。
// 这几条用例钉的就是这一点——任何把 URL 重新放回 output 的改动都会在这里红。

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
      chunkTitle: "搜索功能可用性测试报告",
      chunkContent: "正文 A",
      documentUrl: "https://octo-g.hdesign.huawei.com/x?id=695",
      downloadUrl: "https://s3-hc-dgg.hics.huawei.com/x/v1m.md?Expires=1&Signature=abc",
    },
  ])

  it("指令部分不含任何可被照抄的假 URL", () => {
    const instructions = buildOutput(docs).split("[1] ")[0]
    expect(instructions).not.toContain("https://")
    expect(instructions).not.toContain("http://")
  })

  it("片段头给出真实链接,供模型写 [[n]](链接)", () => {
    const out = buildOutput(docs)
    expect(out).toContain("[1] 搜索功能可用性测试报告 — 链接:https://octo-g.hdesign.huawei.com/x?id=695")
  })

  it("无 url 的条目不编出一个链接字段", () => {
    const noUrl = parseDocs([{ documentId: "a", chunkTitle: "无链接", chunkContent: "正文" }])
    // 只看片段段(指令段里本来就提到「— 链接:」这个字段名)
    const fragments = buildOutput(noUrl).split("[1] ")[1]
    expect(fragments).toBe("无链接\n正文")
  })

  // downloadUrl 仍然不给模型:200+ 字符签名串,且本期没有功能用它(SPEC-INS-034 §4)。
  it("不把 downloadUrl 交给模型", () => {
    const out = buildOutput(docs)
    expect(out).not.toContain("s3-hc-dgg")
    expect(out).not.toContain("Signature")
  })

  it("提醒模型不要承诺下载能力", () => {
    expect(buildOutput(docs)).toContain("不要承诺可以为用户下载报告原文")
  })

  it("超长正文按上限截断", () => {
    const long = parseDocs([{ documentId: "a", chunkTitle: "长文", chunkContent: "x".repeat(50) }])
    expect(buildOutput(long, 10)).toContain("xxxxxxxxxx…")
  })
})
