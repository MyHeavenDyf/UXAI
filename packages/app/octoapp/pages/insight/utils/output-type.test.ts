import { describe, expect, test } from "bun:test"
import { resolveOutputType, extOf, type OutputCardType } from "./output-type"

// SPEC-INS-026 §11.1 V4 / V5。

describe("resolveOutputType 表驱动(V4)", () => {
  const cases: Array<[string, string | undefined, OutputCardType]> = [
    // 扩展名优先 —— 身份是磁盘路径,文件名是身份的一部分
    ["data.csv", undefined, "file"],
    ["report.md", undefined, "markdown"],
    ["a.json", undefined, "json"],
    ["notes.txt", undefined, "code"],
    ["page.html", undefined, "html"],
    ["shot.png", undefined, "image"],
    ["book.pdf", undefined, "file"],
    ["sheet.xlsx", undefined, "file"],
    ["script.py", undefined, "code"],
    ["x.unknownext", undefined, "code"],
    // 无扩展名 → mimeType 兜底
    ["", "text/html", "html"],
    ["", "text/markdown", "markdown"],
    ["", "application/json", "json"],
    ["", "image/png", "image"],
    ["", "application/pdf", "file"],
    ["", "text/csv", "file"],
    // 无扩展名无 mime → code
    ["", undefined, "code"],
    ["Makefile", undefined, "code"],
    ["Dockerfile", undefined, "code"],
  ]
  for (const [name, mime, expected] of cases) {
    test(`${JSON.stringify(name)} + ${mime ?? "无 mime"} → ${expected}`, () => {
      expect(resolveOutputType(name, mime)).toBe(expected)
    })
  }

  test("大小写不敏感", () => {
    expect(resolveOutputType("REPORT.MD")).toBe("markdown")
    expect(resolveOutputType("IMG.PNG")).toBe("image")
    expect(resolveOutputType("Page.HTML")).toBe("html")
  })

  test("有扩展名时 mimeType 不参与判定(否则又是两个答案)", () => {
    expect(resolveOutputType("data.csv", "text/markdown")).toBe("file")
    expect(resolveOutputType("a.json", "text/html")).toBe("json")
    expect(resolveOutputType("notes.txt", "application/json")).toBe("code")
  })

  test("完整路径只取 basename", () => {
    expect(resolveOutputType("/proj/.octo/ses_1/outputs/报告.md")).toBe("markdown")
    expect(resolveOutputType("C:\\out\\a.json")).toBe("json")
  })

  test("§4.1 起磁盘名可含空格括号,判定不受影响", () => {
    expect(resolveOutputType("林(2).json")).toBe("json")
    expect(resolveOutputType("我的 报告 v2.md")).toBe("markdown")
  })

  test("不再产出 mindmap / table —— 思维导图是 json 的内容形态,不是类型", () => {
    expect(resolveOutputType("mindmap.json")).toBe("json")
    expect(resolveOutputType("", "application/json")).toBe("json")
    expect(resolveOutputType("data.csv")).not.toBe("table")
    expect(resolveOutputType("", "text/csv")).not.toBe("table")
  })
})

describe("resolveOutputType 对 business_type 不敏感(V5)", () => {
  // business_type 已降级为元数据(§8):它是「产生该资源的 MCP tool 名」,不是「用哪个渲染器」。
  // resolveOutputType 签名里根本没有这个参数 —— 带与不带只能得到同一个结果。
  const link = { name: "访谈观点.json", mimeType: "application/json" }
  test("带 business_type:'mindmap' 与不带,结论相同", () => {
    const withBt = { ...link, business_type: "mindmap" }
    const withoutBt = { ...link }
    expect(resolveOutputType(withBt.name, withBt.mimeType)).toBe(
      resolveOutputType(withoutBt.name, withoutBt.mimeType),
    )
    expect(resolveOutputType(withBt.name, withBt.mimeType)).toBe("json")
  })

  test("任意 business_type 取值都不改变结论", () => {
    for (const bt of ["mindmap", "key_findings", "run_usability_analysis", "未知工具"]) {
      const l = { ...link, business_type: bt }
      expect(resolveOutputType(l.name, l.mimeType)).toBe("json")
    }
  })
})

// 从 write-output.test.ts 迁来(原 extToOutputType 的覆盖),确保收敛没丢断言。
describe("resolveOutputType 承接原 extToOutputType 覆盖", () => {
  test("应用内渲染:md / html", () => {
    expect(resolveOutputType("a/b/report.md")).toBe("markdown")
    expect(resolveOutputType("x.markdown")).toBe("markdown")
    expect(resolveOutputType("page.html")).toBe("html")
    expect(resolveOutputType("page.htm")).toBe("html")
  })
  test(".json 走 json 卡(扩展名不携带语义,普通 JSON 与导图同扩展名无法区分)", () => {
    expect(resolveOutputType("data.json")).toBe("json")
  })
  test("代码/纯文本(任何语言)→ code(应用内 shiki 预览)", () => {
    for (const f of ["script.py", "mod.ts", "main.cpp", "lib.rs", "App.java", "a.go", "q.sql", "x.lua", "s.swift", "n.kt", "notes.txt", "data.log", "conf.yaml", "app.toml", "q.graphql"]) {
      expect(resolveOutputType(f)).toBe("code")
    }
  })
  test("无扩展名 / 未知扩展名 → code(兜底,无需穷举代码扩展名)", () => {
    expect(resolveOutputType("Makefile")).toBe("code")
    expect(resolveOutputType("a/b/README")).toBe("code")
    expect(resolveOutputType("x.unknownext")).toBe("code")
  })
  test("office/表格/媒体/压缩/二进制 → file(拉本地应用)", () => {
    for (const f of ["rows.csv", "book.xlsx", "old.xls", "report.docx", "slides.pptx", "doc.pdf", "p.pages", "s.numbers", "v.mp4", "a.mp3", "pack.zip", "disk.dmg", "bin.exe", "lib.so"]) {
      expect(resolveOutputType(f)).toBe("file")
    }
  })
  test("可浏览器内渲染的图片 → image;无法渲染的设计源文件 → file", () => {
    for (const f of ["img.png", "pic.heic", "a.jpg", "b.webp", "c.svg", "d.gif"]) {
      expect(resolveOutputType(f)).toBe("image")
    }
    for (const f of ["src.psd", "art.ai", "design.sketch", "board.fig"]) {
      expect(resolveOutputType(f)).toBe("file")
    }
  })
})

describe("extOf", () => {
  test("取小写扩展名", () => {
    expect(extOf("a/b/REPORT.MD")).toBe("md")
  })
  test("无扩展名返回空串", () => {
    expect(extOf("Makefile")).toBe("")
    expect(extOf("a/b/README")).toBe("")
    expect(extOf("")).toBe("")
  })
  test("点号开头的是主名不是扩展名", () => {
    expect(extOf(".gitignore")).toBe("")
  })
  test("尾部点号不算扩展名", () => {
    expect(extOf("report.")).toBe("")
  })
  test("目录名里的点不误伤", () => {
    expect(extOf("/proj/v1.2/README")).toBe("")
  })
})
