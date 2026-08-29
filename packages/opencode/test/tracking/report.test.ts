import { describe, expect, test } from "bun:test"
import { buildPayload, isSessionArtifactPath, outputTypeOf, synthPath } from "@/tracking/report"

// SPEC-INS-033 D3 服务端上报的纯函数单测:分桶判据镜像前端 worktree-layout 用例,
// payload 构造验证与前端 tracker 协议同构。fetch 发送路径(account 缺失跳过)在
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

describe("buildPayload / synthPath", () => {
  test("path 复刻前端 /insight/:id 路由形态", () => {
    expect(synthPath("ses_abc")).toBe("http://localhost/insight/ses_abc")
  })
  test("payload 与前端 tracker 协议同构(interaction 单条 datas)", () => {
    const payload = buildPayload({
      account: "c60050492",
      name: "artifact-output",
      extend: { sessionID: "ses_1", messageId: "msg_1", file: ".octo/ses_1/outputs/a.md", type: "markdown", status: "added" },
    })
    expect(payload.account).toBe("c60050492")
    expect(payload.browserName).toBe("server")
    expect(payload.project).toBe("octo-agent")
    expect(payload.module).toBe("insight")
    const datas = payload.datas as Array<Record<string, unknown>>
    expect(datas.length).toBe(1)
    expect(datas[0]?.type).toBe("interaction")
    expect(datas[0]?.name).toBe("artifact-output")
    expect(datas[0]?.path).toBe("http://localhost/insight/ses_1")
    const extend = JSON.parse(String(datas[0]?.extend)) as Record<string, unknown>
    expect(extend.messageId).toBe("msg_1")
    expect(extend.file).toBe(".octo/ses_1/outputs/a.md")
    expect(extend.type).toBe("markdown")
    expect(extend.status).toBe("added")
  })
})
