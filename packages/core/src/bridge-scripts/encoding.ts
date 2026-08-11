function hasUtf16Bom(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 2 &&
    ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))
  )
}

function hasUtf8Bom(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
}

function latinHead(bytes: Uint8Array, max = 4096): string {
  const len = Math.min(bytes.length, max)
  let s = ""
  for (let i = 0; i < len; i++) s += String.fromCharCode(bytes[i])
  return s
}

function normalizeEncoding(label: string): string | null {
  const enc = label.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "")
  if (!enc) return null
  if (enc === "utf-8" || enc === "utf8" || enc === "unicode-1-1-utf-8") return "utf-8"
  if (enc === "utf-16le" || enc === "utf-16" || enc === "ucs-2" || enc === "ucs2") return "utf-16le"
  if (enc === "utf-16be" || enc === "ucs-2be") return "utf-16be"
  if (enc === "gb2312" || enc === "gbk" || enc === "gb18030" || enc === "iso-ir-58" || enc === "936") return "gb18030"
  if (enc === "big5" || enc === "big-5" || enc === "csbig5" || enc === "950") return "big5"
  if (enc === "shift_jis" || enc === "shift-jis" || enc === "sjis" || enc === "ms-kanji" || enc === "csshiftjis") return "shift_jis"
  if (enc === "euc-kr" || enc === "euckr" || enc === "ksc5601" || enc === "ks-c-5601" || enc === "cp949") return "euc-kr"
  if (enc === "iso-8859-1" || enc === "iso8859-1" || enc === "latin1" || enc === "l1") return "iso-8859-1"
  if (enc === "windows-1252" || enc === "cp1252") return "windows-1252"
  return null
}

function detectMetaCharset(bytes: Uint8Array): string | null {
  const head = latinHead(bytes)
  const m = /<meta\b[^>]*?(?:^|[\s;"'])(charset\s*=\s*)("[^"]*"|'[^']*'|[^\s"'<>]+)/i.exec(head)
  if (!m) return null
  return m[2].replace(/^["']|["']$/g, "")
}

export function detectHtmlEncoding(bytes: Uint8Array): string {
  if (hasUtf16Bom(bytes)) return bytes[0] === 0xff ? "utf-16le" : "utf-16be"
  if (hasUtf8Bom(bytes)) return "utf-8"
  const metaEnc = normalizeEncoding(detectMetaCharset(bytes) ?? "")
  if (metaEnc === "utf-8") return "utf-8"
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    return "utf-8"
  } catch {
    // fatal 严格到任一字节非法即抛 —— 末尾截断的多字节序列(文件按大小截断 / 写入未完成)会让整篇
    // 合法 UTF-8 误判成非 UTF-8,错走 gb18030 把全文解成乱码。非 fatal 解码后看替换符位置:
    // 仅末尾有替换符(截断特征)→ 仍按 UTF-8;替换符散落在前面 → 真 GBK,走 gb18030。
    // 对 GBK 检测零回归:GBK 解成 UTF-8 会产生大量前置替换符,firstBad 远离末尾。
    const lenient = new TextDecoder("utf-8", { fatal: false }).decode(bytes)
    const firstBad = lenient.indexOf("\uFFFD")
    if (firstBad === -1 || firstBad >= lenient.length - 4) return "utf-8"
    return metaEnc ?? "gb18030"
  }
}

function normalizeMetaCharsetToUtf8(html: string): string {
  return html.replace(/<meta\b[^>]*>/gi, (tag) =>
    tag.replace(
      /(^|[\s;"'])(charset\s*=\s*)("[^"]*"|'[^']*'|[^\s"'<>]+)/i,
      (_m, pre: string, prefix: string, val: string) => {
        const quote = val.startsWith('"') ? '"' : val.startsWith("'") ? "'" : ""
        return `${pre}${prefix}${quote}utf-8${quote}`
      },
    ),
  )
}

export function decodeHtmlBytes(bytes: Uint8Array): string {
  const encoding = detectHtmlEncoding(bytes)
  let decoded: string
  try {
    decoded = new TextDecoder(encoding).decode(bytes)
  } catch {
    decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes)
  }
  return normalizeMetaCharsetToUtf8(decoded)
}
