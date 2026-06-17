import { describe, expect, test } from "bun:test"
import { extToOutputType, canOpenLocally, basename, langFromPath, findWriteCards } from "./write-output"

// 路径 C:write 工具产物 → OutputCard。spec: output-renderers.md §2.6。

describe("extToOutputType", () => {
  test("应用内渲染:md / html", () => {
    expect(extToOutputType("a/b/report.md")).toBe("markdown")
    expect(extToOutputType("x.markdown")).toBe("markdown")
    expect(extToOutputType("page.html")).toBe("html")
    expect(extToOutputType("page.htm")).toBe("html")
  })
  test(".json 走 mindmap 卡(内容是思维导图→markmap,否则降级 json 代码)", () => {
    expect(extToOutputType("data.json")).toBe("mindmap")
  })
  test("代码/纯文本(任何语言)→ code(应用内 shiki 预览)", () => {
    for (const f of ["script.py", "mod.ts", "main.cpp", "lib.rs", "App.java", "a.go", "q.sql", "x.lua", "s.swift", "n.kt", "notes.txt", "data.log", "conf.yaml", "app.toml", "q.graphql"]) {
      expect(extToOutputType(f)).toBe("code")
    }
  })
  test("无扩展名 / 未知扩展名 → code(兜底,无需穷举代码扩展名)", () => {
    expect(extToOutputType("Makefile")).toBe("code")
    expect(extToOutputType("a/b/README")).toBe("code")
    expect(extToOutputType("x.unknownext")).toBe("code")
  })
  test("office/表格/图片/媒体/压缩/二进制 → file(拉本地应用)", () => {
    for (const f of ["rows.csv", "book.xlsx", "old.xls", "report.docx", "slides.pptx", "doc.pdf", "p.pages", "s.numbers", "img.png", "pic.heic", "v.mp4", "a.mp3", "pack.zip", "disk.dmg", "bin.exe", "lib.so"]) {
      expect(extToOutputType(f)).toBe("file")
    }
  })
  test("大小写不敏感", () => {
    expect(extToOutputType("REPORT.MD")).toBe("markdown")
    expect(extToOutputType("Page.HTML")).toBe("html")
    expect(extToOutputType("IMG.PNG")).toBe("file")
  })
})

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
    expect(findWriteCards([byPath])).toEqual([{ filePath: "/p/a.json", type: "mindmap" }])
  })
})
