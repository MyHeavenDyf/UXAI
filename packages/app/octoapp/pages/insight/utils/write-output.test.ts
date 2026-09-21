import { describe, expect, test } from "bun:test"
import { canOpenLocally, basename, langFromPath, findWriteCards, findWriteOnlyCards, findEditCards } from "./write-output"

// 路径 C:write 工具产物 → OutputCard。spec: output-renderers.md §2.6。
// 类型判定的用例已随 extToOutputType 一并迁到 ./output-type.test.ts(SPEC-INS-026 §4.2 单一入口)。

describe("canOpenLocally", () => {
  test("普通文件可本地打开", () => {
    expect(canOpenLocally("a.xlsx")).toBe(true)
    expect(canOpenLocally("a.pdf")).toBe(true)
    expect(canOpenLocally("a.png")).toBe(true)
  })
  test("可执行/库类不给打开按钮", () => {
    expect(canOpenLocally("a.exe")).toBe(false)
    expect(canOpenLocally("a.dll")).toBe(false)
    expect(canOpenLocally("a.so")).toBe(false)
    expect(canOpenLocally("a.dylib")).toBe(false)
  })
})

describe("basename", () => {
  test("取末段(兼容 / 和 \\)", () => {
    expect(basename("/a/b/report.md")).toBe("report.md")
    expect(basename("C:\\x\\y\\page.html")).toBe("page.html")
    expect(basename("solo.json")).toBe("solo.json")
  })
})

describe("langFromPath", () => {
  test("扩展名 → shiki lang", () => {
    expect(langFromPath("a.py")).toBe("python")
    expect(langFromPath("a.cpp")).toBe("cpp")
    expect(langFromPath("a.ts")).toBe("typescript")
    expect(langFromPath("a.sql")).toBe("sql")
  })
  test("无扩展名按 basename 认 Makefile / Dockerfile", () => {
    expect(langFromPath("path/to/Makefile")).toBe("makefile")
    expect(langFromPath("Dockerfile")).toBe("docker")
    expect(langFromPath("README")).toBe("text")
  })
  test("未知扩展名 → text", () => {
    expect(langFromPath("a.xyz")).toBe("text")
  })
})

function writePart(filePath: string, status = "completed", tool = "write") {
  return { type: "tool", tool, state: { status, input: { filePath } } }
}

// 服务端重定向后的真实形态:input.filePath = 模型产出的裸名,metadata.filepath = 实际写盘绝对路径。
function writePartRedirected(inputName: string, metaFilepath: string, tool = "write") {
  return { type: "tool", tool, state: { status: "completed", input: { filePath: inputName }, metadata: { filepath: metaFilepath } } }
}

describe("findWriteCards", () => {
  test("所有写入文件都出卡,按内容分流(md/html→渲染, py/cpp→code, csv/xlsx→file)", () => {
    const cards = findWriteCards([
      writePart("/p/report.md"),
      writePart("/p/page.html"),
      writePart("/p/run.py"),
      writePart("/p/main.cpp"),
      writePart("/p/rows.csv"),
      writePart("/p/book.xlsx"),
    ])
    expect(cards).toEqual([
      { filePath: "/p/report.md", type: "markdown" },
      { filePath: "/p/page.html", type: "html" },
      { filePath: "/p/run.py", type: "code" },
      { filePath: "/p/main.cpp", type: "code" },
      { filePath: "/p/rows.csv", type: "file" },
      { filePath: "/p/book.xlsx", type: "file" },
    ])
  })
  test("edit 工具(修改文件)也出卡", () => {
    expect(findWriteCards([writePart("/p/a.cpp", "completed", "edit")])).toEqual([{ filePath: "/p/a.cpp", type: "code" }])
  })
  test("未完成的 write 不出卡", () => {
    expect(findWriteCards([writePart("/p/a.md", "running")])).toEqual([])
  })
  test("非写文件工具忽略(read / bash)", () => {
    expect(findWriteCards([{ type: "tool", tool: "read", state: { status: "completed", input: { filePath: "/p/a.md" } } }])).toEqual([])
    expect(findWriteCards([{ type: "tool", tool: "bash", state: { status: "completed", input: { command: "echo > /p/a.cpp" } } }])).toEqual([])
  })
  test("带前缀的工具名也识别(clientName_write / mcp:edit)", () => {
    expect(findWriteCards([writePart("/p/a.md", "completed", "octo_write")])).toEqual([{ filePath: "/p/a.md", type: "markdown" }])
    expect(findWriteCards([writePart("/p/a.md", "completed", "mcp:edit")])).toEqual([{ filePath: "/p/a.md", type: "markdown" }])
  })
  test("同一 filePath 多次写 → 去重保留最后一次", () => {
    const cards = findWriteCards([writePart("/p/a.md"), writePart("/p/b.html"), writePart("/p/a.md")])
    expect(cards).toEqual([
      { filePath: "/p/b.html", type: "html" },
      { filePath: "/p/a.md", type: "markdown" },
    ])
  })
  test("防御读 path / file_path 兜底字段", () => {
    const byPath = { type: "tool", tool: "write", state: { status: "completed", input: { path: "/p/a.json" } } }
    expect(findWriteCards([byPath])).toEqual([{ filePath: "/p/a.json", type: "json" }])
  })

  // ── 服务端重定向回归(方向 2):卡片路径必须取 metadata.filepath(真实落点),不取 input 的裸名 ──
  test("重定向场景:input 是裸文件名、metadata.filepath 是绝对落点 → 卡片用绝对落点", () => {
    const cards = findWriteCards([writePartRedirected("报告.md", "/proj/insight/ses_1/outputs/报告.md")])
    expect(cards).toEqual([{ filePath: "/proj/insight/ses_1/outputs/报告.md", type: "markdown" }])
  })
  test("metadata.filepath 优先于 input.filePath(两者都在且不同时)", () => {
    const cards = findWriteCards([writePartRedirected("裸名.html", "/abs/outputs/裸名.html")])
    expect(cards[0]?.filePath).toBe("/abs/outputs/裸名.html")
  })
  test("edit 同样取 metadata.filepath", () => {
    const cards = findWriteCards([writePartRedirected("a.cpp", "/abs/outputs/a.cpp", "edit")])
    expect(cards).toEqual([{ filePath: "/abs/outputs/a.cpp", type: "code" }])
  })
  test("无 metadata 时兜底 input(旧数据 / 异常态,向后兼容)", () => {
    expect(findWriteCards([writePart("/p/legacy.md")])).toEqual([{ filePath: "/p/legacy.md", type: "markdown" }])
  })
  test("按 metadata.filepath 去重(同一真实落点多次写只留最后一次)", () => {
    const cards = findWriteCards([
      writePartRedirected("a.md", "/abs/outputs/a.md"),
      writePartRedirected("a.md", "/abs/outputs/a.md"),
    ])
    expect(cards).toEqual([{ filePath: "/abs/outputs/a.md", type: "markdown" }])
  })
})

// 工具 part 构造器(支持可选 metadata.filepath 覆盖 input.filePath,用于 findWriteOnlyCards / findEditCards 测试)。
function toolPart(tool: unknown, status: string, metaPath?: string, inputPath?: string) {
  const state: Record<string, unknown> = { status }
  if (metaPath) state.metadata = { filepath: metaPath }
  if (inputPath) state.input = { filePath: inputPath }
  return { type: "tool", tool, state }
}

// ── findWriteOnlyCards / findEditCards 拆分测试(统计产物打点 artifact-file-write / artifact-file-edit) ──
// 与 findWriteCards 共用同一套 findWriteCardsByFilter 逻辑,仅工具过滤器不同。
// 这两组用例锁住「findWriteCards(parts) 的 filePath 集合 == findWriteOnlyCards ∪ findEditCards」的划分不变量,
// 防止三条分支在后续重构中漂移。

const mixedParts = [
  toolPart("write", "completed", "/out/report.md"),
  toolPart("edit", "completed", "/out/report.md"),
  toolPart("write", "completed", "/out/index.html"),
  toolPart("mcp:edit", "completed", "/out/data.csv"),
  toolPart("client_write", "completed", "/out/a.ts"),
  toolPart("client_edit", "completed", "/out/b.ts"),
  toolPart("read", "completed", "/out/ignored.md"),
  toolPart("bash", "completed", "/out/ignored2.md"),
  toolPart("write", "running", "/out/pending.md"),
  toolPart(123, "completed", "/out/bad.md"),
  toolPart("write", "completed", undefined, "/out/fallback.md"),
  toolPart(null, "completed", "/out/null-tool.md"),
]

describe("findWriteOnlyCards", () => {
  test("只匹配 write 类工具,排除 edit", () => {
    const cards = findWriteOnlyCards(mixedParts)
    const paths = cards.map((c) => c.filePath)
    expect(paths).toContain("/out/report.md")
    expect(paths).toContain("/out/index.html")
    expect(paths).toContain("/out/a.ts")
    expect(paths).toContain("/out/fallback.md")
    expect(paths).not.toContain("/out/data.csv")
    expect(paths).not.toContain("/out/b.ts")
  })

  test("非 completed 状态 / 非写类工具 / 非 string 工具名都不命中", () => {
    const paths = findWriteOnlyCards(mixedParts).map((c) => c.filePath)
    expect(paths).not.toContain("/out/ignored.md")
    expect(paths).not.toContain("/out/ignored2.md")
    expect(paths).not.toContain("/out/pending.md")
    expect(paths).not.toContain("/out/bad.md")
    expect(paths).not.toContain("/out/null-tool.md")
  })

  test("同一 filePath 多次 write → 去重保留最后一次(与 findWriteCards 语义一致)", () => {
    const cards = findWriteOnlyCards([
      toolPart("write", "completed", "/out/file.md"),
      toolPart("write", "completed", "/out/file.md"),
    ])
    expect(cards).toHaveLength(1)
    expect(cards[0].filePath).toBe("/out/file.md")
  })
})

describe("findEditCards", () => {
  test("只匹配 edit 类工具,排除 write", () => {
    const cards = findEditCards(mixedParts)
    const paths = cards.map((c) => c.filePath)
    expect(paths).toContain("/out/data.csv")
    expect(paths).toContain("/out/b.ts")
    expect(paths).not.toContain("/out/index.html")
    expect(paths).not.toContain("/out/a.ts")
    expect(paths).not.toContain("/out/fallback.md")
  })

  test("非 completed 状态 / 非 edit 类工具都不命中", () => {
    const paths = findEditCards(mixedParts).map((c) => c.filePath)
    expect(paths).not.toContain("/out/ignored.md")
    expect(paths).not.toContain("/out/pending.md")
  })

  test("同一 filePath 多次 edit → 去重保留最后一次", () => {
    const cards = findEditCards([
      toolPart("edit", "completed", "/out/file.md"),
      toolPart("mcp:edit", "completed", "/out/file.md"),
    ])
    expect(cards).toHaveLength(1)
    expect(cards[0].filePath).toBe("/out/file.md")
  })
})

describe("findWriteCards 划分不变量", () => {
  test("findWriteCards 的 filePath 集合 == findWriteOnlyCards ∪ findEditCards", () => {
    const all = findWriteCards(mixedParts)
    const writes = findWriteOnlyCards(mixedParts)
    const edits = findEditCards(mixedParts)

    const allPaths = new Set(all.map((c) => c.filePath))
    const writePaths = new Set(writes.map((c) => c.filePath))
    const editPaths = new Set(edits.map((c) => c.filePath))

    for (const p of writePaths) expect(allPaths.has(p)).toBe(true)
    for (const p of editPaths) expect(allPaths.has(p)).toBe(true)
    for (const p of allPaths) expect(writePaths.has(p) || editPaths.has(p)).toBe(true)
  })

  test("无 filePath 重叠时,write 数 + edit 数 == all 数(精确划分)", () => {
    const nonOverlapping = [
      toolPart("write", "completed", "/out/a.md"),
      toolPart("edit", "completed", "/out/b.md"),
      toolPart("client_write", "completed", "/out/c.ts"),
      toolPart("mcp:edit", "completed", "/out/d.csv"),
    ]
    const all = findWriteCards(nonOverlapping)
    const writes = findWriteOnlyCards(nonOverlapping)
    const edits = findEditCards(nonOverlapping)

    expect(writes.length + edits.length).toBe(all.length)
    const union = [...writes, ...edits].sort((a, b) => a.filePath.localeCompare(b.filePath))
    const sorted = [...all].sort((a, b) => a.filePath.localeCompare(b.filePath))
    expect(union).toEqual(sorted)
  })
})
