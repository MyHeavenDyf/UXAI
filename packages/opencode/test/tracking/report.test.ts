import { describe, expect, test } from "bun:test"
import {
  attributeDiff,
  buildPayload,
  collectAttributionSources,
  isSessionArtifactPath,
  outputTypeOf,
  synthPath,
} from "@/tracking/report"

// SPEC-INS-033 D3/D4 服务端产物打点的纯函数单测:分桶判据镜像原前端 worktree-layout 用例,
// 三层归因(tool part 精确 > resource_link basename > git status 兜底)是 D4 的核心,
// payload 构造验证与前端 tracker 协议同构。fetch 发送路径(account 缺失跳过/mock 占位)在
// reportDiffs 内,依赖 sessionExtras 进程态,不在此覆盖。

describe("isSessionArtifactPath(SPEC-INS-033 §4.2 路径分桶)", () => {
  test("会话产物区内(git diff 相对路径)", () => {
    expect(isSessionArtifactPath(".octo/ses_1/outputs/报告.md", "ses_1")).toBe(true)
  })
  test("会话产物区内(Windows 反斜杠绝对路径)", () => {
    expect(isSessionArtifactPath("D:\\proj\\.octo\\ses_1\\outputs\\a.md", "ses_1")).toBe(true)
  })
  test("projectDir 是仓库子目录时 .octo 不在路径根", () => {
    expect(isSessionArtifactPath("sub/dir/.octo/ses_1/outputs/a.md", "ses_1")).toBe(true)
  })
  test("别的会话的产物区不算", () => {
    expect(isSessionArtifactPath(".octo/ses_2/outputs/a.md", "ses_1")).toBe(false)
  })
  test("Make 模块产物区不算", () => {
    expect(isSessionArtifactPath(".octo/artifacts/make/ses_1/x.md", "ses_1")).toBe(false)
  })
  test("不在 .octo 下的路径不算", () => {
    expect(isSessionArtifactPath("src/main.ts", "ses_1")).toBe(false)
  })
  test("路径恰好以 .octo 结尾不算", () => {
    expect(isSessionArtifactPath("foo/.octo", "ses_1")).toBe(false)
  })
})

describe("outputTypeOf(SPEC-INS-026 §4.2 服务端镜像)", () => {
  test.each([
    ["报告.md", "markdown"],
    ["index.html", "html"],
    ["data.json", "json"],
    ["a.ts", "code"],
    ["a.py", "code"],
    ["notes.txt", "code"],
    ["pic.png", "image"],
    ["report.csv", "file"],
    ["archive.docx", "file"],
    ["noext", "file"],
  ] as const)("outputTypeOf(%s) === %s", (filename, expected) => {
    expect(outputTypeOf(filename)).toBe(expected)
  })
})

// ── D4 三层归因 ────────────────────────────────────────────────────────────────────────

const NO_SOURCES = { toolParts: [] as Array<{ tool: string; path: string }>, resourceLinks: [] as Array<{ name: string; tool: string }> }

describe("attributeDiff 第一层:tool part 精确匹配(工具优先于 status)", () => {
  test("write 工具(绝对路径 vs 仓库相对路径,后缀匹配)", () => {
    const diff = { file: ".octo/ses_1/outputs/报告.md", status: "added" as const }
    expect(attributeDiff(diff, [{ tool: "write", path: "D:\\proj\\.octo\\ses_1\\outputs\\报告.md" }], [])).toEqual({ event: "write" })
  })
  test("edit 工具命中 modified 的 diff(工具优先)", () => {
    const diff = { file: ".octo/ses_1/outputs/报告.md", status: "modified" as const }
    expect(attributeDiff(diff, [{ tool: "edit", path: "/proj/.octo/ses_1/outputs/报告.md" }], [])).toEqual({ event: "edit" })
  })
  test("write 工具对 modified(覆盖写)仍归 write", () => {
    const diff = { file: ".octo/ses_1/outputs/a.md", status: "modified" as const }
    expect(attributeDiff(diff, [{ tool: "write", path: "/p/.octo/ses_1/outputs/a.md" }], [])).toEqual({ event: "write" })
  })
  test("带 MCP 前缀的工具名(client_write / mcp:edit)", () => {
    expect(attributeDiff({ file: "f.ts", status: "added" as const }, [{ tool: "client_write", path: "/x/f.ts" }], [])).toEqual({ event: "write" })
    expect(attributeDiff({ file: "f.ts", status: "added" as const }, [{ tool: "edit", path: "/x/f.ts" }], [])).toEqual({ event: "edit" })
  })
})

describe("attributeDiff 第二层:resource_link basename 匹配", () => {
  test("同名命中,带 business_type", () => {
    const diff = { file: ".octo/ses_1/outputs/report.md", status: "added" as const }
    expect(attributeDiff(diff, [], [{ name: "report.md", tool: "key_findings" }])).toEqual({ event: "mcp", tool: "key_findings" })
  })
  test("markdown 补扩展名(link 名无 .md,落盘补了)", () => {
    const diff = { file: ".octo/ses_1/outputs/报告.md", status: "added" as const }
    expect(attributeDiff(diff, [], [{ name: "报告", tool: "mindmap" }])).toEqual({ event: "mcp", tool: "mindmap" })
  })
  test("撞名加后缀(best-effort 前缀匹配)", () => {
    const diff = { file: ".octo/ses_1/outputs/报告-1.md", status: "added" as const }
    expect(attributeDiff(diff, [], [{ name: "报告.md", tool: "key_findings" }])).toEqual({ event: "mcp", tool: "key_findings" })
  })
  test("完全不相关不命中", () => {
    const diff = { file: ".octo/ses_1/outputs/other.md", status: "added" as const }
    expect(attributeDiff(diff, [], [{ name: "report.md", tool: "key_findings" }])).toEqual({ event: "write" })
  })
})

describe("attributeDiff 第三层:git status 兜底(覆盖 bash/powershell 脚本通道)", () => {
  test("bash 新建(status=added)归 write", () => {
    expect(attributeDiff({ file: ".octo/ses_1/outputs/a.txt", status: "added" as const }, [], [])).toEqual({ event: "write" })
  })
  test("bash 修改(status=modified)归 edit", () => {
    expect(attributeDiff({ file: ".octo/ses_1/outputs/a.txt", status: "modified" as const }, [], [])).toEqual({ event: "edit" })
  })
  test("status 缺省按 modified → edit", () => {
    expect(attributeDiff({ file: ".octo/ses_1/outputs/a.txt" }, NO_SOURCES.toolParts, NO_SOURCES.resourceLinks)).toEqual({ event: "edit" })
  })
})

describe("collectAttributionSources(从 turn parts 提取归因原料)", () => {
  const toolPart = (tool: unknown, status: string, metaPath?: string, inputPath?: string) => {
    const state: Record<string, unknown> = { status }
    if (metaPath) state.metadata = { filepath: metaPath }
    if (inputPath) state.input = { filePath: inputPath }
    return { type: "tool", tool, state }
  }

  test("只取 assistant 消息的 completed 写盘类工具 part,落点优先 metadata.filepath", () => {
    const messages = [
      { info: { role: "user" }, parts: [toolPart("write", "completed", "/out/from-user.md")] },
      {
        info: { role: "assistant" },
        parts: [
          toolPart("write", "completed", "/out/from-meta.md", "/out/from-input.md"),
          toolPart("write", "running", "/out/pending.md"),
          toolPart("read", "completed", "/out/ignored.md"),
          toolPart("bash", "completed", "/out/ignored2.md"),
          toolPart("write", "completed", undefined, "/out/fallback.md"),
        ],
      },
    ] as never
    const { toolParts } = collectAttributionSources(messages)
    expect(toolParts).toEqual([
      { tool: "write", path: "/out/from-meta.md" },
      { tool: "write", path: "/out/fallback.md" },
    ])
  })

  test("resource_link:独立 part 主路径 + tool part metadata.content[] 兜底", () => {
    const messages = [
      {
        info: { role: "assistant" },
        parts: [
          { type: "resource_link", name: "r1.md", business_type: "key_findings" },
          { type: "tool", tool: "mcp_tool", state: { status: "completed", metadata: { content: [{ type: "resource_link", name: "r2.md" }] } } },
        ],
      },
    ] as never
    const { resourceLinks } = collectAttributionSources(messages)
    expect(resourceLinks).toEqual([
      { name: "r1.md", tool: "key_findings" },
      { name: "r2.md", tool: "unknown" },
    ])
  })
})

describe("buildPayload / synthPath", () => {
  test("path 复刻前端 /insight/:id 路由形态", () => {
    expect(synthPath("ses_abc")).toBe("http://localhost/insight/ses_abc")
  })
  test("payload 与前端 tracker 协议同构(interaction 单条 datas)", () => {
    const payload = buildPayload({
      account: "c60050492",
      name: "artifact-file-write",
      extend: { sessionID: "ses_1", messageId: "msg_1", file: ".octo/ses_1/outputs/a.md", type: "markdown", status: "added" },
    })
    expect(payload.account).toBe("c60050492")
    expect(payload.browserName).toBe("server")
    expect(payload.project).toBe("octo-agent")
    expect(payload.module).toBe("insight")
    const datas = payload.datas as Array<Record<string, unknown>>
    expect(datas.length).toBe(1)
    expect(datas[0]?.type).toBe("interaction")
    expect(datas[0]?.name).toBe("artifact-file-write")
    expect(datas[0]?.path).toBe("http://localhost/insight/ses_1")
    const extend = JSON.parse(String(datas[0]?.extend)) as Record<string, unknown>
    expect(extend.messageId).toBe("msg_1")
    expect(extend.file).toBe(".octo/ses_1/outputs/a.md")
    expect(extend.type).toBe("markdown")
    expect(extend.status).toBe("added")
  })
})
