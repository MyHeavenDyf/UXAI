import { afterAll, describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  decideInsightDispatch,
  extractInsightPromptLocalFiles,
  OctoInsightDispatchPlugin,
} from "../../src/agent/octo-insight-dispatch"

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "octo-insight-dispatch-"))
const DOCS = ["a.docx", "b.xlsx", "c.pdf"].map((filename) => {
  const file = path.join(DIR, filename)
  fs.writeFileSync(file, "fixture")
  return { filename, path: file }
})
const LARGE_TEXT = path.join(DIR, "large.txt")
fs.writeFileSync(LARGE_TEXT, "x".repeat(33 * 1024))

afterAll(() => fs.rmSync(DIR, { recursive: true, force: true }))

function manifest(files = DOCS) {
  return `[附件]\n${files.map((file) => `- ${file.filename}: ${file.path}`).join("\n")}`
}

function output(parts: Array<{ type: "text"; text: string; synthetic?: boolean }>, task = true) {
  return {
    message: {
      id: "msg_test",
      sessionID: "ses_test",
      role: "user",
      time: { created: Date.now() },
      agent: "octo_insight",
      model: { providerID: "test", modelID: "test" },
      tools: { task },
    },
    parts: parts.map((part, index) => ({
      id: `prt_${index}`,
      messageID: "msg_test",
      sessionID: "ses_test",
      ...part,
    })),
  }
}

describe("Insight chat.message 分治守卫", () => {
  test("直接路径支持现代 Office/PDF 与 txt/md，不接受旧版 Office", () => {
    expect(
      extractInsightPromptLocalFiles(
        "D:\\materials\\a.docx D:\\materials\\b.txt D:\\materials\\c.md D:\\materials\\old.doc",
      ).map((file) => file.filename),
    ).toEqual(["a.docx", "b.txt", "c.md"])
  })

  test("三份文档命中 doc-count", async () => {
    const decision = await decideInsightDispatch([{ type: "text", text: manifest(), synthetic: true }])
    expect(decision.mode).toBe("dispatch")
    expect(decision.reasons).toContain("doc-count")
    expect(decision.docs).toHaveLength(3)
  })

  test("正文直接给出的 txt/md 超过 32KB 命中 text-budget", async () => {
    const paths = ["D:\\materials\\a.txt", "D:\\materials\\b.md"]
    const decision = await decideInsightDispatch([{ type: "text", text: paths.join("、") }], async () => ({
      size: 17 * 1024,
      isFile: true,
    }))
    expect(decision.mode).toBe("dispatch")
    expect(decision.reasons).toContain("text-budget")
    expect(decision.directFiles.map((file) => file.path)).toEqual(paths)
  })

  test("没有附件清单的本地 file:// Part 也能触发服务端兜底", async () => {
    const decision = await decideInsightDispatch([
      { type: "file", filename: "large.txt", url: `file://${LARGE_TEXT.replace(/\\/g, "/")}` },
    ])
    expect(decision.mode).toBe("dispatch")
    expect(decision.reasons).toContain("text-budget")
    expect(decision.directFiles[0]?.path).toBe(LARGE_TEXT.replace(/\\/g, "/"))
  })

  test("前端未注入时，服务端会追加材料体量块", async () => {
    const hooks = await OctoInsightDispatchPlugin({} as never)
    const hook = hooks["chat.message"]!
    const out = output([
      { type: "text", text: "请逐份总结" },
      { type: "text", text: manifest(), synthetic: true },
    ])
    await hook({ sessionID: "ses_test", agent: "octo_insight" }, out as never)
    expect(out.parts.filter((part) => part.text.startsWith("[材料体量]")).length).toBe(1)
  })

  test("前端已注入时幂等，不追加第二份", async () => {
    const hooks = await OctoInsightDispatchPlugin({} as never)
    const hook = hooks["chat.message"]!
    const out = output([
      { type: "text", text: manifest(), synthetic: true },
      { type: "text", text: "[材料体量] 前端已判定", synthetic: true },
    ])
    await hook({ sessionID: "ses_test", agent: "octo_insight" }, out as never)
    expect(out.parts.filter((part) => part.text.startsWith("[材料体量]")).length).toBe(1)
  })

  test("MCP chip turn 关闭 task 时不注入分治指令", async () => {
    const hooks = await OctoInsightDispatchPlugin({} as never)
    const hook = hooks["chat.message"]!
    const out = output([{ type: "text", text: manifest(), synthetic: true }], false)
    await hook({ sessionID: "ses_test", agent: "octo_insight" }, out as never)
    expect(out.parts.some((part) => part.text.startsWith("[材料体量]"))).toBe(false)
  })
})
