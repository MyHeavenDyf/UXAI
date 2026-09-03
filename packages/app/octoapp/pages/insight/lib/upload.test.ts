import { describe, expect, test } from "bun:test"
import {
  DISPATCH_NOTE_HEADER,
  formatDispatchNote,
  imageMimeFor,
  isExtractableDocFile,
  isTextInlineFile,
} from "./upload"

/**
 * SPEC-INS-032 §2.6：分治判定的两套口径在**文案**上也要分开说。
 * 文本类给得出确切体量（字节即进上下文的量），文档类只给份数（发送前拿不到正文体量）——
 * 说一个自己不知道的数会把模型带偏。
 */
describe("formatDispatchNote", () => {
  const base = { count: 0, totalBytes: 0, docCount: 0, oversized: [] as Array<{ filename: string; bytes: number }> }

  test("纯文本材料：给份数 + 合计体量", () => {
    const note = formatDispatchNote({ ...base, count: 4, totalBytes: 64 * 1024 })
    expect(note.startsWith(DISPATCH_NOTE_HEADER)).toBe(true)
    expect(note).toContain("4 份文本材料")
    expect(note).toContain("64 KB")
    expect(note).not.toContain("份文档")
  })

  test("纯 office：只给份数，不编造体量", () => {
    const note = formatDispatchNote({ ...base, docCount: 9 })
    expect(note).toContain("9 份文档")
    expect(note).not.toContain("份文本材料")
    // 不能出现 "0 KB" 这种把未知说成已知的措辞
    expect(note).not.toContain("0 KB")
  })

  test("混合上传：两类都点到", () => {
    const note = formatDispatchNote({ ...base, count: 2, totalBytes: 40 * 1024, docCount: 3 })
    expect(note).toContain("2 份文本材料")
    expect(note).toContain("3 份文档")
  })

  test("串行要求写进文案（并发是限流与多用户公平性问题，§5.4）", () => {
    const note = formatDispatchNote({ ...base, count: 4, totalBytes: 64 * 1024 })
    expect(note).toContain("一份回来了再派下一份")
  })

  test("单份超上界：指向切段，**不再**让用户拆分文件（§2.4 v3）", () => {
    const note = formatDispatchNote({
      ...base,
      count: 1,
      totalBytes: 300 * 1024,
      oversized: [{ filename: "超长访谈.md", bytes: 300 * 1024 }],
    })
    expect(note).toContain("切段清单")
    expect(note).toContain("照样派子代理")
    // 回归锁：v2 的「请用户拆分后重新上传」是把工程问题甩给用户，不许再出现
    expect(note).not.toContain("拆分")
    expect(note).not.toContain("重新上传")
  })
})

describe("文件分类谓词", () => {
  test("office / pdf 归 extract_document，不算可内联文本", () => {
    for (const name of ["a.docx", "b.pdf", "c.xlsx", "d.pptx", "e.doc"]) {
      expect(isExtractableDocFile(name)).toBe(true)
      expect(isTextInlineFile(name)).toBe(false)
    }
  })

  test("图片两边都不算（走 vision）", () => {
    expect(isExtractableDocFile("x.png")).toBe(false)
    expect(isTextInlineFile("x.png")).toBe(false)
  })

  test("其余一律按可内联文本处理（反向排除，与上游 read 口径一致）", () => {
    for (const name of ["a.md", "b.txt", "c.csv", "d.json", "e.log", "无扩展名"]) {
      expect(isTextInlineFile(name)).toBe(true)
      expect(isExtractableDocFile(name)).toBe(false)
    }
  })
})

// 粘贴/部分拖拽源 File.type 为空时按扩展名兜底精确 mime(评审 P2):
// 笼统给 image/png 会把 jpg/gif/webp 错标,落库 media_type 与实际字节不符。
describe("imageMimeFor", () => {
  test("五种图片扩展名各自映射到精确 mime", () => {
    expect(imageMimeFor("a.png")).toBe("image/png")
    expect(imageMimeFor("a.jpg")).toBe("image/jpeg")
    expect(imageMimeFor("a.jpeg")).toBe("image/jpeg")
    expect(imageMimeFor("a.gif")).toBe("image/gif")
    expect(imageMimeFor("a.webp")).toBe("image/webp")
  })

  test("大写扩展名同样命中(getExt 已 lower-case)", () => {
    expect(imageMimeFor("Photo.JPG")).toBe("image/jpeg")
  })

  test("非图片扩展名 → fallback(默认 octet-stream)", () => {
    expect(imageMimeFor("材料.xlsx")).toBe("application/octet-stream")
    expect(imageMimeFor("readme")).toBe("application/octet-stream")
    expect(imageMimeFor("a.docx", "image/png")).toBe("image/png")
  })
})
