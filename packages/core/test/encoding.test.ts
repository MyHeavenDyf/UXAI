import { describe, expect, test } from "bun:test"
import { decodeHtmlBytes, detectHtmlEncoding } from "@opencode-ai/core/bridge-scripts"

const NI_HAO_GBK = [0xc4, 0xe3, 0xba, 0xc3]

function gbkDoc(inner: string): Uint8Array {
  return Uint8Array.from([...Buffer.from(inner, "latin1"), ...NI_HAO_GBK, ...Buffer.from("</body></html>", "latin1")])
}

describe("detectHtmlEncoding", () => {
  test("UTF-8 BOM → utf-8", () => {
    const bytes = Uint8Array.from([0xef, 0xbb, 0xbf, ...Buffer.from("<html><body>你好</body></html>", "utf-8")])
    expect(detectHtmlEncoding(bytes)).toBe("utf-8")
  })

  test("UTF-16LE BOM → utf-16le", () => {
    const bytes = Uint8Array.from([0xff, 0xfe, ...Buffer.from("<html>", "utf-16le")])
    expect(detectHtmlEncoding(bytes)).toBe("utf-16le")
  })

  test("meta charset=utf-8 → utf-8 (skips fatal scan)", () => {
    const bytes = Buffer.from('<html><head><meta charset="utf-8"></head><body>你好</body></html>', "utf-8")
    expect(detectHtmlEncoding(bytes)).toBe("utf-8")
  })

  test("GBK + meta charset=gbk → gb18030", () => {
    expect(detectHtmlEncoding(gbkDoc('<html><head><meta charset="gbk"></head><body>'))).toBe("gb18030")
  })

  test("GBK + meta http-equiv charset=gbk → gb18030", () => {
    const bytes = gbkDoc('<html><head><meta http-equiv="Content-Type" content="text/html; charset=gbk"></head><body>')
    expect(detectHtmlEncoding(bytes)).toBe("gb18030")
  })

  test("GBK no meta → gb18030 (heuristic fallback)", () => {
    expect(detectHtmlEncoding(gbkDoc("<html><body>"))).toBe("gb18030")
  })

  test("UTF-8 no meta → utf-8 (fatal sniff succeeds)", () => {
    expect(detectHtmlEncoding(Buffer.from("<html><body>你好世界</body></html>", "utf-8"))).toBe("utf-8")
  })

  test("pure ASCII → utf-8", () => {
    expect(detectHtmlEncoding(Buffer.from("<html><body>hello world</body></html>", "latin1"))).toBe("utf-8")
  })

  test("data-charset attribute is NOT treated as a declaration (boundary aligned with rewrite side)", () => {
    const bytes = Buffer.from('<html><head><meta data-charset="gbk"></head><body>你好</body></html>', "utf-8")
    expect(detectHtmlEncoding(bytes)).toBe("utf-8")
  })

  test("contradictory file: valid UTF-8 bytes + meta charset=gbk → utf-8 (trusts bytes)", () => {
    const bytes = Buffer.from('<html><head><meta charset="gbk"></head><body>你好</body></html>', "utf-8")
    expect(detectHtmlEncoding(bytes)).toBe("utf-8")
  })

  test("empty bytes → utf-8", () => {
    expect(detectHtmlEncoding(new Uint8Array(0))).toBe("utf-8")
  })
})

describe("decodeHtmlBytes", () => {
  test("GBK + meta charset=gbk → decodes 你好 and normalizes meta to utf-8", () => {
    const out = decodeHtmlBytes(gbkDoc('<html><head><meta charset="gbk"></head><body>'))
    expect(out).toContain("你好")
    expect(out).toContain('charset="utf-8"')
    expect(out).not.toContain('charset="gbk"')
  })

  test("GBK + http-equiv → decodes 你好 and normalizes content charset to utf-8", () => {
    const bytes = gbkDoc('<html><head><meta http-equiv="Content-Type" content="text/html; charset=gbk"></head><body>')
    const out = decodeHtmlBytes(bytes)
    expect(out).toContain("你好")
    expect(out).toContain("charset=utf-8")
  })

  test("UTF-8 + meta charset=utf-8 → preserved", () => {
    const bytes = Buffer.from('<html><head><meta charset="utf-8"></head><body>你好</body></html>', "utf-8")
    const out = decodeHtmlBytes(bytes)
    expect(out).toContain("你好")
    expect(out).toContain('charset="utf-8"')
  })

  test("UTF-8 BOM is stripped on decode", () => {
    const bytes = Uint8Array.from([0xef, 0xbb, 0xbf, ...Buffer.from("<html><body>你好</body></html>", "utf-8")])
    expect(decodeHtmlBytes(bytes).codePointAt(0)).toBe(0x3c)
  })

  test("GBK no meta → decodes 你好 via gb18030 fallback", () => {
    expect(decodeHtmlBytes(gbkDoc("<html><body>"))).toContain("你好")
  })

  test("meta charset with spaces around = → normalized", () => {
    const bytes = gbkDoc('<html><head><meta charset = "gbk"></head><body>')
    const out = decodeHtmlBytes(bytes)
    expect(out).toContain("你好")
    expect(out).toContain('charset = "utf-8"')
  })

  test("unquoted meta charset → normalized", () => {
    const bytes = gbkDoc("<html><head><meta charset=gbk></head><body>")
    const out = decodeHtmlBytes(bytes)
    expect(out).toContain("你好")
    expect(out).toContain("charset=utf-8")
    expect(out).not.toContain("charset=gbk")
  })

  test("data-charset attribute is left untouched (rewrite boundary guard)", () => {
    const bytes = Buffer.from('<html><head><meta charset="utf-8"><meta data-charset="gbk" name="x"></head><body>ok</body></html>', "utf-8")
    const out = decodeHtmlBytes(bytes)
    expect(out).toContain('data-charset="gbk"')
    expect(out).not.toContain('data-charset="utf-8"')
  })

  test("non-charset meta tags (viewport) are not altered", () => {
    const bytes = Buffer.from('<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body>ok</body></html>', "utf-8")
    const out = decodeHtmlBytes(bytes)
    expect(out).toContain('name="viewport"')
    expect(out).toContain('content="width=device-width"')
  })

  test("empty bytes → empty string (no throw)", () => {
    expect(decodeHtmlBytes(new Uint8Array(0))).toBe("")
  })

  test("never throws on arbitrary byte patterns (fallback path)", () => {
    const patterns = [
      new Uint8Array([0x80, 0x81, 0xfe, 0xff, 0x00, 0x01]),
      Uint8Array.from([...Buffer.from("<html><body>", "latin1"), 0xff, 0xfe, 0xfd, ...Buffer.from("</body></html>", "latin1")]),
      new Uint8Array([0xc0, 0xc1, 0xf8, 0x80, 0x80]),
    ]
    for (const bytes of patterns) {
      expect(() => decodeHtmlBytes(bytes)).not.toThrow()
      expect(typeof decodeHtmlBytes(bytes)).toBe("string")
    }
  })
})
