/**
 * 回退文件收集(collectRevertedFiles):主会话与子任务子会话共用同一口径——
 * write/edit 工具路径 + <artifact> 标签落盘产物(路径按主会话 id 推导,
 * 因为子会话产物由前端 autoSave 归档到主会话产物目录)。
 *
 * 运行: bun test --preload ./happydom.ts ./octoapp/pages/make/utils/restore-draft.test.ts(在 packages/app 下)
 */
import { describe, expect, test } from "bun:test"
import {
  collectRevertedFiles,
  collectWriteEditFiles,
  recordWriteEvidence,
  type RevertDraftPart,
} from "./restore-draft"

const writeToolPart = (path: string, status = "completed"): RevertDraftPart => ({
  type: "tool",
  tool: "write",
  state: { status, input: { path }, name: "write" },
})

const artifactTextPart = (title: string): RevertDraftPart => ({
  type: "text",
  text: `<artifact type="html" title="${title}"><html><body>${title}</body></html></artifact>`,
})

describe("collectWriteEditFiles", () => {
  test("收集完成的 write 工具路径", () => {
    expect(collectWriteEditFiles([writeToolPart("D:/proj/.octo/ses_main/outputs/a.html")])).toEqual([
      "D:/proj/.octo/ses_main/outputs/a.html",
    ])
  })

  test("未完成的工具调用不收集", () => {
    expect(collectWriteEditFiles([writeToolPart("D:/proj/a.html", "running")])).toEqual([])
  })

  test("路径去重", () => {
    expect(collectWriteEditFiles([writeToolPart("D:/p/a.html"), writeToolPart("D:/p/a.html")])).toEqual(["D:/p/a.html"])
  })
})

describe("collectRevertedFiles", () => {
  const opts = { sessionId: "ses_main", projectDir: "D:/proj", kind: "normal" as const }

  test("子会话 write 工具路径直接收集(子代理落盘文件)", () => {
    expect(collectRevertedFiles([writeToolPart("D:/proj/.octo/ses_child/outputs/b.svg")], opts)).toEqual([
      "D:/proj/.octo/ses_child/outputs/b.svg",
    ])
  })

  test("子会话 <artifact> 产物路径按主会话 id 推导(autoSave 归属 mainSessionID)", () => {
    expect(collectRevertedFiles([artifactTextPart("登录页")], opts)).toEqual([
      "D:/proj/.octo/ses_main/outputs/登录页.html",
    ])
  })

  test("write 路径与 artifact 推导路径合并去重", () => {
    const files = collectRevertedFiles(
      [writeToolPart("D:/proj/.octo/ses_main/outputs/登录页.html"), artifactTextPart("登录页")],
      opts,
    )
    expect(files).toEqual(["D:/proj/.octo/ses_main/outputs/登录页.html"])
  })

  test("code 工作区 artifact 落 output/<sid 前 12 位>", () => {
    expect(
      collectRevertedFiles([artifactTextPart("组件")], { sessionId: "ses_abcdefghijkl", projectDir: "D:/proj", kind: "code" }),
    ).toEqual(["D:/proj/output/abcdefghijkl/组件.html"])
  })

  test("无 projectDir 时只收工具路径", () => {
    expect(collectRevertedFiles([writeToolPart("D:/p/a.html"), artifactTextPart("登录页")], { sessionId: "ses_main" })).toEqual([
      "D:/p/a.html",
    ])
  })
})

describe("recordWriteEvidence", () => {
  const writePart = (path: string, exists: boolean | undefined, status = "completed"): RevertDraftPart => ({
    type: "tool",
    tool: "write",
    state: { status, input: { filePath: path }, ...(exists === undefined ? {} : { metadata: { exists } }) },
  })
  const editPart = (path: string): RevertDraftPart => ({
    type: "tool",
    tool: "edit",
    state: { status: "completed", input: { filePath: path } },
  })

  test("write 记录 metadata.exists(新建/已存在)", () => {
    const target = new Map()
    recordWriteEvidence([writePart("D:/p/a.html", false)], "m1", target)
    recordWriteEvidence([writePart("D:/p/b.html", true)], "m1", target)
    expect(target.get("D:/p/a.html")).toEqual({ msgId: "m1", existed: false })
    expect(target.get("D:/p/b.html")).toEqual({ msgId: "m1", existed: true })
  })

  test("write 无 metadata 时 existed 为 undefined(证据不足不删)", () => {
    const target = new Map()
    recordWriteEvidence([writePart("D:/p/a.html", undefined)], "m1", target)
    expect(target.get("D:/p/a.html")).toEqual({ msgId: "m1", existed: undefined })
  })

  test("edit 视为文件已存在", () => {
    const target = new Map()
    recordWriteEvidence([editPart("D:/p/a.html")], "m1", target)
    expect(target.get("D:/p/a.html")).toEqual({ msgId: "m1", existed: true })
  })

  test("路径反斜杠归一为正斜杠(与 involved 集合同口径)", () => {
    const target = new Map()
    recordWriteEvidence([writePart("D:\\proj\\.octo\\ses_main\\outputs\\a.html", false)], "m1", target)
    expect(target.has("D:/proj/.octo/ses_main/outputs/a.html")).toBe(true)
  })

  test("多条消息按 msgId 保留最早的写证据(与调用顺序无关)", () => {
    const target = new Map()
    recordWriteEvidence([writePart("D:/p/a.html", false)], "m2", target)
    recordWriteEvidence([editPart("D:/p/a.html")], "m1", target)
    expect(target.get("D:/p/a.html")).toEqual({ msgId: "m1", existed: true })

    const target2 = new Map()
    recordWriteEvidence([editPart("D:/p/a.html")], "m1", target2)
    recordWriteEvidence([writePart("D:/p/a.html", false)], "m2", target2)
    expect(target2.get("D:/p/a.html")).toEqual({ msgId: "m1", existed: true })
  })

  test("未完成的工具调用不记录", () => {
    const target = new Map()
    recordWriteEvidence([writePart("D:/p/a.html", false, "running")], "m1", target)
    expect(target.size).toBe(0)
  })
})
