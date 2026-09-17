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

  test("Windows 点段路径解析为同一文件，只保留首次写法", async () => {
    const first = "D:\\workspace\\download\\a.docx"
    const files = await resolvePromptLocalDocuments(
      `${first} D:\\workspace\\download\\.\\a.docx D:\\workspace\\download\\tmp\\..\\a.docx`,
      { statFile: async () => ({ size: 1024 }) },
    )
    expect(files).toEqual([{ filename: "a.docx", path: first, bytes: 1024 }])
  })

  test("macOS 绝对路径支持空格和中文，POSIX 路径保留大小写语义", () => {
    const upper = "/Users/test/Documents/项目资料/Final Report.txt"
    const lower = "/Users/test/Documents/项目资料/final report.txt"
    expect(extractPromptLocalDocuments(`请读取【"${upper}"】和【"${lower}"】`)).toEqual([
      { filename: "Final Report.txt", path: upper },
      { filename: "final report.txt", path: lower },
    ])
  })

  test("macOS 路径按 POSIX 等价写法去重，并支持外置卷", () => {
    const first = "/Users/test/Documents/./materials//a.md"
    const duplicate = "/Users/test/Documents/materials/a.md"
    const volume = "/Volumes/团队资料/会议/c.docx"
    expect(extractPromptLocalDocuments(`${first} ${duplicate} ${volume}`)).toEqual([
      { filename: "a.md", path: first },
      { filename: "c.docx", path: volume },
    ])
  })

  test("三个 macOS 文档路径经 stat 确认后命中 doc-count", async () => {
    const files = [
      "/Users/test/Documents/a.docx",
      "/Users/test/Documents/b.xlsx",
      "/Volumes/team/c.pdf",
    ]
    const resolved = await resolvePromptLocalDocuments(files.join("、"), {
      statFile: async () => ({ size: 1024 }),
    })
    expect(resolved.map((file) => file.path)).toEqual(files)
    expect(decideInlineStrategy(resolved).reasons).toContain("doc-count")
  })

  test("macOS Shell 转义路径先还原再 stat，三个真实文档命中 doc-count", async () => {
    const paths = [
      "/Users/jiangke/Desktop/【会议通知】12.4全天苏皖片区发展建设月度会议.docx",
      "/Users/jiangke/Desktop/【曾来福】个人任务单反馈进度(2021-12-24).xlsx",
      "/Users/jiangke/Desktop/【曾来福】2020-07个人任务单反馈进度(2021-12-24).xlsx",
    ]
    const text = paths
      .map((path) => path.replace(/([ ()[\]])/g, "\\$1"))
      .join(" ")
    const probed: string[] = []
    const resolved = await resolvePromptLocalDocuments(text, {
      statFile: async (path) => {
        probed.push(path)
        return paths.includes(path) ? { size: 1024 } : null
      },
    })
    expect(resolved.map((file) => file.path)).toEqual(paths)
    expect(probed).toEqual(paths)
    expect(decideInlineStrategy(resolved).reasons).toContain("doc-count")
  })

  test("macOS Shell 转义的空格和方括号会还原", () => {
    const path = "/Users/jiangke/Desktop/Final Report[1].txt"
    expect(extractPromptLocalDocuments("/Users/jiangke/Desktop/Final\\ Report\\[1\\].txt")).toEqual([
      { filename: "Final Report[1].txt", path },
    ])
  })

  test("macOS 首页缩写、HOME 和 file URL 会解析为真实绝对路径", async () => {
    const home = "/Users/jiangke"
    const paths = [
      `${home}/Desktop/a.docx`,
      `${home}/Desktop/b report.xlsx`,
      `${home}/Desktop/c.pdf`,
    ]
    const text = "~/Desktop/a.docx $HOME/Desktop/b\\ report.xlsx file:///Users/jiangke/Desktop/c.pdf"
    const resolved = await resolvePromptLocalDocuments(
      text,
      { statFile: async (path) => (paths.includes(path) ? { size: 1024 } : null) },
      home,
    )
    expect(resolved.map((file) => file.path)).toEqual(paths)
    expect(decideInlineStrategy(resolved).reasons).toContain("doc-count")
  })

  test("macOS file URL 支持 localhost 与百分号编码", () => {
    expect(
      extractPromptLocalDocuments("file://localhost/Users/jiangke/Desktop/Final%20Report%5B1%5D.txt"),
    ).toEqual([
      {
        filename: "Final Report[1].txt",
        path: "/Users/jiangke/Desktop/Final Report[1].txt",
      },
    ])
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
