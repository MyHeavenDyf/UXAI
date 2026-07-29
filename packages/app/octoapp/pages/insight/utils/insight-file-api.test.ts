import { describe, expect, test } from "bun:test"
import { fileKind } from "./insight-file-api"
import { resolveOutputType } from "./output-type"

// SPEC-INS-026 §4.2:InsightFileKind 必须由 resolveOutputType 派生,不再是第三套扩展名判定。

describe("fileKind 与 resolveOutputType 一致", () => {
  test("产物类型与 kind 同名的那几档不会打架", () => {
    const pairs: Array<[string, string]> = [
      ["a.md", "markdown"],
      ["a.html", "html"],
      ["a.json", "json"],
      ["a.png", "image"],
      ["a.svg", "image"],
    ]
    for (const [name, kind] of pairs) {
      expect(fileKind(name)).toBe(kind as never)
      expect(resolveOutputType(name)).toBe(kind as never)
    }
  })

  test("resolveOutputType=file 的一律落 office/媒体/其他,绝不落 code/text", () => {
    for (const name of ["a.pdf", "a.docx", "a.pptx", "a.xlsx", "a.csv", "a.mp4", "a.zip", "a.exe"]) {
      expect(resolveOutputType(name)).toBe("file")
      expect(["pdf", "word", "ppt", "excel", "video", "other"]).toContain(fileKind(name))
    }
  })

  test("resolveOutputType=code 的一律落 code/text,绝不落 other", () => {
    for (const name of ["a.py", "a.ts", "a.txt", "a.log", "a.unknownext", "Makefile"]) {
      expect(resolveOutputType(name)).toBe("code")
      expect(["code", "text"]).toContain(fileKind(name))
    }
  })
})

describe("fileKind 细分", () => {
  test("office 各归各的图标档", () => {
    expect(fileKind("a.pdf")).toBe("pdf")
    expect(fileKind("a.docx")).toBe("word")
    expect(fileKind("a.rtf")).toBe("word")
    expect(fileKind("a.pptx")).toBe("ppt")
    expect(fileKind("a.key")).toBe("ppt")
    expect(fileKind("a.xlsx")).toBe("excel")
    expect(fileKind("a.csv")).toBe("excel")
    expect(fileKind("a.numbers")).toBe("excel")
    expect(fileKind("a.mp4")).toBe("video")
  })

  test("file 档里查不到的落 other", () => {
    expect(fileKind("a.zip")).toBe("other")
    expect(fileKind("a.mp3")).toBe("other")
    expect(fileKind("a.woff2")).toBe("other")
    expect(fileKind("a.psd")).toBe("other")
  })

  test("code 档:命中语言表算代码,其余算文本", () => {
    expect(fileKind("a.py")).toBe("code")
    expect(fileKind("a.tsx")).toBe("code")
    expect(fileKind("a.txt")).toBe("text")
    expect(fileKind("a.log")).toBe("text")
    // 未知扩展名归 text 而非 other —— 它打开后就是应用内文本预览,标「其他」会与实际行为对不上
    expect(fileKind("a.unknownext")).toBe("text")
  })

  test("§4.1 起磁盘名可含空格括号,分组判定不受影响", () => {
    expect(fileKind("林(2).json")).toBe("json")
    expect(fileKind("我的 报告 v2.md")).toBe("markdown")
  })
})
