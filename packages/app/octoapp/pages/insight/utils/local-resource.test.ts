import { describe, expect, it, beforeEach, mock } from "bun:test"

// 记录每次 downloadResourceToTemp 的入参,断言幂等键。主进程按 namespace 复用,
// 故「同一 URI 是否只用一个 namespace」决定了会不会重复下载落盘。
const calls: Array<{ url: string; namespace: string; filename: string }> = []

mock.module("../lib/electron-api", () => ({
  getDesktopApi: () => ({
    downloadResourceToTemp: async (url: string, namespace: string, filename: string) => {
      calls.push({ url, namespace, filename })
      return `/proj/insight/ses_1/outputs/${filename}`
    },
  }),
}))

const { materializeUriCardToOutputs, ensureLocalResourceFile } = await import("./local-resource")

const URI = "https://mcp.intra/artifacts/abc/report.md"

function card(id: string, over: Record<string, unknown> = {}) {
  return { id, type: "markdown", source: "uri" as const, uri: URI, fileName: "report.md", ...over }
}

describe("materializeUriCardToOutputs 幂等键", () => {
  beforeEach(() => (calls.length = 0))

  // 回归:任务卡走 task-<taskId>-<i>、「查询结果」turn 的路径 A 卡走 card-<msgID>-<i>,
  // 两者指向同一批 URI(resolveTaskLinks 换回首次那批)。曾用 card.id 作幂等键 →
  // 主进程两个 key 各记各的 → 同一 URI 落两份,第二份撞名成 `report (2).md`,每查一次多一份。
  it("同一 URI 被不同 card.id 引用 → 幂等键一致(不会重复落盘)", async () => {
    await materializeUriCardToOutputs(card("task-t1-0"), "/proj", "ses_1")
    await materializeUriCardToOutputs(card("card-msg9-0"), "/proj", "ses_1")

    expect(calls).toHaveLength(2)
    expect(calls[0]!.namespace).toBe(URI)
    expect(calls[1]!.namespace).toBe(URI)
    // 幂等键相同 → 主进程 materializedByNamespace 命中复用,第二次不落新文件
    expect(new Set(calls.map((c) => c.namespace)).size).toBe(1)
  })

  it("幂等键是 uri 而非 card.id", async () => {
    await materializeUriCardToOutputs(card("card-xyz-3"), "/proj", "ses_1")

    expect(calls[0]!.namespace).toBe(URI)
    expect(calls[0]!.namespace).not.toBe("card-xyz-3")
  })

  it("不同 URI 仍是不同幂等键(不能误合成一份)", async () => {
    await materializeUriCardToOutputs(card("card-1"), "/proj", "ses_1")
    await materializeUriCardToOutputs(card("card-2", { uri: "https://mcp.intra/artifacts/def/other.md" }), "/proj", "ses_1")

    expect(new Set(calls.map((c) => c.namespace)).size).toBe(2)
  })

  it("filename 规则不一(补/不补 .md)也不影响幂等键 → 同一 URI 仍复用一份", async () => {
    await materializeUriCardToOutputs(card("card-1", { fileName: "report" }), "/proj", "ses_1")
    await materializeUriCardToOutputs(card("card-2", { type: "file", fileName: "report" }), "/proj", "ses_1")

    expect(calls[0]!.filename).toBe("report.md") // markdown 补 .md
    expect(calls[1]!.filename).toBe("report") // file 型保留原名
    expect(new Set(calls.map((c) => c.namespace)).size).toBe(1)
  })
})

describe("ensureLocalResourceFile", () => {
  beforeEach(() => (calls.length = 0))

  it("json 卡保留原扩展名(不强补 .md),幂等键传 uri", async () => {
    const uri = "https://mcp.intra/artifacts/abc/林(2).json"
    const { path } = await ensureLocalResourceFile(
      { id: "task-t1-0", type: "json", source: "uri", uri, fileName: "林(2).json" } as never,
      "/proj",
      "ses_1",
    )
    expect(calls[0]!.filename).toBe("林(2).json") // 主进程再落地为 林_2_.json;客户端不预清洗
    expect(calls[0]!.namespace).toBe(uri)
    expect(path).toBe("/proj/insight/ses_1/outputs/林(2).json")
  })

  it("markdown 卡补 .md", async () => {
    await ensureLocalResourceFile(
      { id: "c1", type: "markdown", source: "uri", uri: "https://x/y", fileName: "report" } as never,
      "/proj",
      "ses_1",
    )
    expect(calls[0]!.filename).toBe("report.md")
  })

  it("path 源直接返回 filePath,不落盘", async () => {
    const { path } = await ensureLocalResourceFile(
      { id: "c2", type: "json", source: "path", filePath: "/proj/insight/ses_1/outputs/a.json" } as never,
      "/proj",
      "ses_1",
    )
    expect(path).toBe("/proj/insight/ses_1/outputs/a.json")
    expect(calls).toHaveLength(0)
  })
})
