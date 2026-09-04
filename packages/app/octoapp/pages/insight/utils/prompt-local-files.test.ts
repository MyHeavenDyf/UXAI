import { describe, expect, test } from "bun:test"
import { decideInlineStrategy } from "./build-prompt-parts"
import {
  extractPromptLocalDocuments,
  formatPromptLocalDocuments,
  resolvePromptLocalDocuments,
} from "./prompt-local-files"

describe("prompt 正文中的本地文档路径", () => {
  const paths = [
    "D:\\workspace\\download\\【曾来福】2020-07个人任务单反馈进度(2021-12-24).xlsx",
    "D:\\workspace\\download\\【曾来福】个人任务单反馈进度(2021-12-24).xlsx",
    "D:\\workspace\\download\\【会议通知】12.4全天苏皖片区发展建设月度会议.docx",
  ]

  test("中文括号/重复引号包裹的三个 Windows 路径均能精确提取", () => {
    const text = `帮我读取【""${paths[0]}""】【""${paths[1]}""】【"${paths[2]}"】`
    expect(extractPromptLocalDocuments(text)).toEqual(
      paths.map((path) => ({ filename: path.split("\\").pop()!, path })),
    )
  })

  test("同一路径忽略大小写与斜杠差异去重；网址和非文档路径不参与", () => {
    expect(
      extractPromptLocalDocuments(
        `${paths[2]} D:/workspace/download/【会议通知】12.4全天苏皖片区发展建设月度会议.DOCX ` +
          "https://example.com/a.docx D:\\workspace\\download\\image.png",
      ),
    ).toEqual([{ filename: paths[2].split("\\").pop()!, path: paths[2] }])
  })

  test("目录名或文件名中间含受支持扩展名时不截断", () => {
    const nested = "D:\\research.md\\final.docx"
    const dotted = "D:\\reports\\survey.md.backup.docx"
    expect(extractPromptLocalDocuments(`${nested} ${dotted}`)).toEqual([
      { filename: "final.docx", path: nested },
      { filename: "survey.md.backup.docx", path: dotted },
    ])
  })

  test("路径后还有扩展名文案时，以 stat 选择最长的真实候选", async () => {
    const path = "D:\\reports\\survey.docx"
    const files = await resolvePromptLocalDocuments(`${path} 输出为 report.md`, {
      statFile: async (candidate) => (candidate === path ? { size: 1024 } : null),
    })
    expect(files).toEqual([{ filename: "survey.docx", path, bytes: 1024 }])
  })

  test("只把 stat 确认存在的普通文件送入分治判定，三份 Office 命中 doc-count", async () => {
    const files = await resolvePromptLocalDocuments(paths.join("、"), {
      statFile: async (path) => (path === paths[1] ? null : { size: 1024 }),
    })
    expect(files.map((file) => file.path)).toEqual([paths[0], paths[2]])

    const all = await resolvePromptLocalDocuments(paths.join("、"), { statFile: async () => ({ size: 1024 }) })
    const decision = decideInlineStrategy(all)
    expect(decision.mode).toBe("dispatch")
    expect(decision.reasons).toContain("doc-count")
  })

  test("正文直接给出的 txt/md 会参与 32KB 文本预算", async () => {
    const textPaths = ["D:\\materials\\a.txt", "D:\\materials\\b.md"]
    const files = await resolvePromptLocalDocuments(textPaths.join("、"), {
      statFile: async () => ({ size: 17 * 1024 }),
    })
    expect(files.map((file) => file.path)).toEqual(textPaths)
    expect(decideInlineStrategy(files).reasons).toContain("text-budget")
  })

  test("旧版 doc/xls/ppt 不冒充 extract_document 可读格式", () => {
    expect(extractPromptLocalDocuments("D:\\materials\\a.doc D:\\materials\\b.xls D:\\materials\\c.ppt")).toEqual([])
  })

  test("完整回归：前置错误路径不计数，随后三个真实路径仍触发分治", async () => {
    const text =
      `帮我读一下【"D:\workspace\download】12.4全天苏皖片区发展建设月度会议.docx"】下的三个文件` +
      `【""${paths[0]}""】【""${paths[1]}""】【"${paths[2]}"】`
    const files = await resolvePromptLocalDocuments(text, {
      statFile: async (path) => (paths.includes(path) ? { size: 1024 } : null),
    })
    expect(files.map((file) => file.path)).toEqual(paths)
    expect(decideInlineStrategy(files).reasons).toContain("doc-count")
  })

  test("旧 preload 没有 statFile 时可用 fileExists 降级，清单不受正文引号干扰", async () => {
    const files = await resolvePromptLocalDocuments(paths[2], { fileExists: async () => true })
    expect(files).toEqual([{ filename: paths[2].split("\\").pop()!, path: paths[2] }])
    expect(formatPromptLocalDocuments(files)).toContain(`- ${files[0]!.filename}: ${paths[2]}`)
  })
})
