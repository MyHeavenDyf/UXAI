import { afterAll, describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  decideInsightDispatch,
  extractInsightPromptLocalFiles,
  OctoInsightDispatchPlugin,
  shouldDeferInsightLocalTextReads,
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

  test("直接路径不会在目录名或文件名中间的扩展名处截断", () => {
    expect(
      extractInsightPromptLocalFiles("D:\\research.md\\final.docx D:\\reports\\survey.md.backup.docx").map(
        (file) => file.path,
      ),
    ).toEqual(["D:\\research.md\\final.docx", "D:\\reports\\survey.md.backup.docx"])
  })

  test("Windows 点段与 UNC 斜杠差异不会重复计入分治阈值", async () => {
    const drive = await decideInsightDispatch(
      [
        {
          type: "text",
          text: "D:\\docs\\a.docx D:\\docs\\.\\a.docx D:\\docs\\sub\\..\\a.docx",
        },
      ],
      async () => ({ size: 1024, isFile: true }),
    )
    const unc = await decideInsightDispatch(
      [
        { type: "text", text: "\\\\server\\share\\a.txt" },
        { type: "file", filename: "a.txt", url: "file:////server/share/a.txt" },
      ],
      async () => ({ size: 17 * 1024, isFile: true }),
    )
    expect(drive.docs).toHaveLength(1)
    expect(drive.mode).toBe("inline")
    expect(unc.files).toHaveLength(1)
    expect(unc.mode).toBe("inline")
  })

  test("macOS 直接路径保留大小写，并按 POSIX 等价写法去重", () => {
    const first = "/Users/test/Documents/./materials//Final Report.txt"
    const duplicate = "/Users/test/Documents/materials/Final Report.txt"
    const caseDistinct = "/Users/test/Documents/materials/final report.txt"
    expect(extractInsightPromptLocalFiles(`${first} ${duplicate} ${caseDistinct}`)).toEqual([
      { filename: "Final Report.txt", path: first },
      { filename: "final report.txt", path: caseDistinct },
    ])
  })

  test("三个 macOS 文档路径命中服务端 doc-count 兜底", async () => {
    const paths = [
      "/Users/test/Documents/a.docx",
      "/Users/test/Documents/b.xlsx",
      "/Volumes/team/c.pdf",
    ]
    const decision = await decideInsightDispatch([{ type: "text", text: paths.join("、") }], async () => ({
      size: 1024,
      isFile: true,
    }))
    expect(decision.reasons).toContain("doc-count")
    expect(decision.directFiles.map((file) => file.path)).toEqual(paths)
  })

  test("macOS Shell 转义路径还原后命中服务端 doc-count 兜底", async () => {
    const paths = [
      "/Users/jiangke/Desktop/【会议通知】12.4全天苏皖片区发展建设月度会议.docx",
      "/Users/jiangke/Desktop/【曾来福】个人任务单反馈进度(2021-12-24).xlsx",
      "/Users/jiangke/Desktop/【曾来福】2020-07个人任务单反馈进度(2021-12-24).xlsx",
    ]
    const text = paths.map((path) => path.replace(/([ ()[\]])/g, "\\$1")).join(" ")
    const decision = await decideInsightDispatch([{ type: "text", text }], async (path) =>
      paths.includes(path) ? { size: 1024, isFile: true } : undefined,
    )
    expect(decision.mode).toBe("dispatch")
    expect(decision.reasons).toContain("doc-count")
    expect(decision.directFiles.map((file) => file.path)).toEqual(paths)
  })

  test("macOS 首页缩写、HOME 和 file URL 命中服务端 doc-count 兜底", async () => {
    const home = process.env.HOME || process.env.USERPROFILE || ""
    const paths = [
      `${home}/Desktop/a.docx`,
      `${home}/Desktop/b report.xlsx`,
      "/Users/jiangke/Desktop/c.pdf",
    ]
    const decision = await decideInsightDispatch(
      [
        {
          type: "text",
          text: "~/Desktop/a.docx $HOME/Desktop/b\\ report.xlsx file://localhost" +
            "/Users/jiangke/Desktop/c.pdf",
        },
      ],
      async (path) => (paths.includes(path) ? { size: 1024, isFile: true } : undefined),
    )
    expect(decision.mode).toBe("dispatch")
    expect(decision.reasons).toContain("doc-count")
    expect(decision.directFiles.map((file) => file.path)).toEqual(paths)
  })

  test("路径后还有扩展名文案时，以 stat 选择最长的真实候选", async () => {
    const file = "D:\\reports\\survey.txt"
    const decision = await decideInsightDispatch(
      [{ type: "text", text: `${file} 输出为 report.md` }],
      async (candidate) => (candidate === file ? { size: 33 * 1024, isFile: true } : undefined),
    )
    expect(decision.directFiles).toEqual([{ filename: "survey.txt", path: file }])
    expect(decision.mode).toBe("dispatch")
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

  test("大文本 FilePart 在 resolvePart 前即命中分治，阻止父上下文展开正文", async () => {
    expect(
      await shouldDeferInsightLocalTextReads([
        {
          type: "file",
          mime: "text/plain",
          filename: "large.txt",
          url: `file://${LARGE_TEXT.replace(/\\/g, "/")}`,
        },
      ]),
    ).toBe(true)
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
