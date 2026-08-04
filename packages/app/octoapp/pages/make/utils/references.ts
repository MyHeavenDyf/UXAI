/**
 * HTML/CSS/JS 引用资源解析。
 *
 * 用于 Make 页 ZIP 打包流程（ActionBar 下载 / 画布编辑 C2D / 归档），
 * 替代过去「无差别打包同目录所有文件」的逻辑。
 *
 * 提取所有相对路径引用，递归处理 CSS/JS 中的二级引用，
 * 配合网络信号（resource-tracker.ts）取并集后过滤同目录文件。
 */

export type ContentType = "html" | "css" | "js"

const REF_ATTR_REGEX = /(?:href|src|poster|data|formaction|xlink:href)\s*=\s*["']([^"']+)["']/gi
const SRCSET_REGEX = /srcset\s*=\s*["']([^"']+)["']/gi
const URL_FUNC_REGEX = /url\(\s*["']?([^"')]+)["']?\s*\)/gi
const CSS_IMPORT_REGEX = /@import\s+(?:url\(\s*)?["']([^"']+)["']\s*\)?\s*;?/gi
const JS_IMPORT_REGEX = /import\s*\(\s*["']([^"']+)["']\s*\)/gi
const SOURCEMAP_REGEX = /\/\/#\s*sourceMappingURL=(\S+)/gi

function isRelativeRef(ref: string): boolean {
  if (!ref) return false
  const trimmed = ref.trim()
  if (!trimmed) return false

  if (trimmed.startsWith("//")) return false        // 协议相对 //cdn.x.com
  if (trimmed.startsWith("#")) return false         // 锚点
  if (trimmed.startsWith("/")) return false         // 绝对路径 /foo
  if (trimmed.startsWith("data:")) return false
  if (trimmed.startsWith("blob:")) return false
  if (trimmed.startsWith("javascript:")) return false
  if (trimmed.startsWith("mailto:")) return false
  if (trimmed.startsWith("tel:")) return false
  if (trimmed.startsWith("file:")) return false
  if (trimmed.startsWith("ftp:")) return false
  // 任何形如 scheme: 的协议前缀都拒绝（http:、https:、ws:、自定义 scheme 等）
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return false

  return true
}

function normalizeRef(ref: string): string {
  let r = ref.trim()
  const qIdx = r.indexOf("?")
  if (qIdx >= 0) r = r.slice(0, qIdx)
  const hIdx = r.indexOf("#")
  if (hIdx >= 0) r = r.slice(0, hIdx)
  try {
    r = decodeURIComponent(r)
  } catch {}
  r = r.replace(/\\/g, "/")
  while (r.startsWith("./")) r = r.slice(2)
  return r
}

function unique(arr: string[]): string[] {
  return Array.from(new Set(arr))
}

/** 从一段内容中提取所有相对路径引用（剥 query/hash、URL 解码、过滤绝对/协议/锚点） */
export function extractReferences(content: string, type: ContentType): string[] {
  if (!content) return []
  const refs: string[] = []

  const collectAllMatches = (regex: RegExp, group: number = 1) => {
    regex.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = regex.exec(content)) !== null) {
      if (m[group]) refs.push(m[group])
    }
  }

  if (type === "html") {
    collectAllMatches(REF_ATTR_REGEX)
    collectAllMatches(SRCSET_REGEX)
    // srcset 值是 "url descriptor, url descriptor"，需要拆分
    SRCSET_REGEX.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = SRCSET_REGEX.exec(content)) !== null) {
      const value = m[1]
      if (!value) continue
      const parts = value.split(",")
      for (const part of parts) {
        const url = part.trim().split(/\s+/)[0]
        if (url) refs.push(url)
      }
    }
    collectAllMatches(URL_FUNC_REGEX)
    collectAllMatches(CSS_IMPORT_REGEX)
    collectAllMatches(JS_IMPORT_REGEX)
    collectAllMatches(SOURCEMAP_REGEX)
  } else if (type === "css") {
    collectAllMatches(URL_FUNC_REGEX)
    collectAllMatches(CSS_IMPORT_REGEX)
  } else {
    // js
    collectAllMatches(JS_IMPORT_REGEX)
    collectAllMatches(URL_FUNC_REGEX)
    collectAllMatches(SOURCEMAP_REGEX)
  }

  const normalized = refs.map(normalizeRef).filter(isRelativeRef)
  return unique(normalized)
}

/** 快速预筛：HTML 中是否包含任何相对引用（决定是否要调 listDirectory） */
export function checkHasRelativeRefs(html: string): boolean {
  const attrRegex = /(?:href|src)=["'](?!https?:|data:|#|[\/\\])[^"']+["']/i
  const cssRegex = /url\(["']?(?!https?:|data:|#)[^"')]+["']?\)/i
  return attrRegex.test(html) || cssRegex.test(html)
}

export interface CollectOptions {
  rootContent: string
  rootType: ContentType
  htmlDir: string
  readFileBuffer: (path: string) => Promise<ArrayBuffer | null>
  maxDepth?: number
}

/**
 * 递归收集引用链上的所有相对路径文件。
 * HTML → CSS/JS → CSS/JS → ... 直到无新文件或达深度上限。
 * 返回的 Set 中的路径都是「相对 htmlDir」的标准化路径（正斜杠，无 ./）。
 */
export async function collectReferencedFiles(options: CollectOptions): Promise<Set<string>> {
  const referenced = new Set<string>()
  const visited = new Set<string>()
  const maxDepth = options.maxDepth ?? 10

  let queue: Array<{ content: string; type: ContentType }> = [
    { content: options.rootContent, type: options.rootType },
  ]
  let depth = 0

  while (queue.length > 0 && depth < maxDepth) {
    const batch = queue
    queue = []
    depth++

    for (const item of batch) {
      const refs = extractReferences(item.content, item.type)
      for (const ref of refs) {
        if (referenced.has(ref)) continue
        referenced.add(ref)

        const lower = ref.toLowerCase()
        const isParsable = lower.endsWith(".css") || lower.endsWith(".js") || lower.endsWith(".mjs")
        if (!isParsable || visited.has(ref)) continue
        visited.add(ref)

        try {
          const abs = joinPath(options.htmlDir, ref)
          const buf = await options.readFileBuffer(abs)
          if (!buf) continue
          const subType: ContentType = lower.endsWith(".css") ? "css" : "js"
          const subContent = new TextDecoder("utf-8", { fatal: false }).decode(buf)
          queue.push({ content: subContent, type: subType })
        } catch {
          // 文件不存在 / 读失败：忽略
        }
      }
    }
  }

  return referenced
}

/** 把绝对路径数组筛出 htmlDir 下的相对路径 */
export function filterObservedPathsToRelative(observedAbsolute: string[], htmlDir: string): string[] {
  const base = htmlDir.replace(/\\/g, "/").replace(/\/+$/, "")
  const result: string[] = []
  for (const abs of observedAbsolute) {
    if (!abs) continue
    const normalized = abs.replace(/\\/g, "/")
    if (normalized === base) continue
    if (normalized.startsWith(base + "/")) {
      const rel = normalized.slice(base.length + 1)
      result.push(rel)
    }
  }
  return Array.from(new Set(result))
}

// ===== path 工具：统一从此处导出，替代散落副本 =====

export function dirname(path: string): string {
  const normalized = path.replace(/\\/g, "/")
  const idx = normalized.lastIndexOf("/")
  return idx >= 0 ? normalized.slice(0, idx) : path
}

export function basename(path: string): string {
  const normalized = path.replace(/\\/g, "/")
  const idx = normalized.lastIndexOf("/")
  return idx >= 0 ? normalized.slice(idx + 1) : path
}

export function joinPath(base: string, relative: string): string {
  const normalizedBase = base.replace(/\\/g, "/")
  const normalizedRelative = relative.replace(/\\/g, "/")

  if (normalizedRelative.startsWith(normalizedBase)) {
    return normalizedRelative
  }
  if (normalizedBase.endsWith("/")) {
    return normalizedBase + normalizedRelative
  }
  return normalizedBase + "/" + normalizedRelative
}
