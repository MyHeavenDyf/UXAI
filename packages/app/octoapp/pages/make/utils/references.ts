/**
 * HTML/CSS/JS 引用资源解析。
 *
 * 用于 Make 页 ZIP 打包流程（ActionBar 下载 / 画布编辑 C2D / 归档），
 * 替代过去「无差别打包同目录所有文件」的逻辑。
 *
 * 提取所有相对路径引用，递归处理 CSS/JS 中的二级引用，
 * 配合网络信号（resource-tracker.ts）取并集后过滤同目录文件。
 */

import { localUrlToPath } from "./resource-tracker"

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

  // local:// 是本项目自定义协议,放行后由 normalizeRef 转回绝对路径
  if (trimmed.startsWith("local://")) return true
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
  const raw = ref.trim()
  // local:// URL: 转回绝对文件路径(剥 query/hash、URI 解码、Windows 盘符规范化)
  // 反向操作为 pathToLocalUrl（artifact-file-api.ts）
  if (raw.startsWith("local://")) {
    const abs = localUrlToPath(raw)
    return abs || raw
  }

  let r = raw
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

  // 先 filter 后 map：isRelativeRef 需要看到原始 local:// 前缀（normalizeRef 会把它转成 C:/...，转完会被 scheme 正则误判拒绝）
  const normalized = refs.filter(isRelativeRef).map(normalizeRef)
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
  /** 根文件的绝对路径（如 HTML 文件路径）。用于解析 `..` 等相对引用。 */
  rootAbsPath: string
  readFileBuffer: (path: string) => Promise<ArrayBuffer | null>
  maxDepth?: number
}

/**
 * 递归收集引用链上的所有文件，返回**绝对路径**集合（已规范化，无 `..`/`.`）。
 *
 * 关键点：每个被解析的 CSS/JS 都按它**自己所在目录**去解析其中的相对引用，
 * 因此 `../sibling/foo.css` 中再 `url(../images/x.png)` 会被正确解析到
 * `sibling/images/x.png` 而不是错误地相对 htmlDir。
 *
 * HTML → CSS/JS → CSS/JS → ... 直到无新文件或达深度上限（默认 10）。
 */
export async function collectReferencedFiles(options: CollectOptions): Promise<Set<string>> {
  const referenced = new Set<string>()
  const maxDepth = options.maxDepth ?? 10

  let queue: Array<{ content: string; type: ContentType; dir: string }> = [
    { content: options.rootContent, type: options.rootType, dir: dirname(options.rootAbsPath) },
  ]
  let depth = 0

  while (queue.length > 0 && depth < maxDepth) {
    const batch = queue
    queue = []
    depth++

    for (const item of batch) {
      const refs = extractReferences(item.content, item.type)
      for (const ref of refs) {
        const abs = resolvePath(item.dir, ref)
        if (referenced.has(abs)) continue
        referenced.add(abs)

        const lower = abs.toLowerCase()
        const isParsable = lower.endsWith(".css") || lower.endsWith(".js") || lower.endsWith(".mjs")
        if (!isParsable) continue

        try {
          const buf = await options.readFileBuffer(abs)
          if (!buf) continue
          const subType: ContentType = lower.endsWith(".css") ? "css" : "js"
          const subContent = new TextDecoder("utf-8", { fatal: false }).decode(buf)
          queue.push({ content: subContent, type: subType, dir: dirname(abs) })
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

/**
 * 把相对路径解析到绝对路径，正确处理 `..` 和 `.`。
 * baseDir 是参考目录（绝对路径），relative 是相对该目录的引用。
 * 不调用 fs.realpath，仅做字符串层级的规范化。
 */
export function resolvePath(baseDir: string, relative: string): string {
  const baseNorm = baseDir.replace(/\\/g, "/")
  const relNorm = relative.replace(/\\/g, "/")

  // 已经是绝对路径（Windows 盘符 / Unix 根）直接返回规范化结果
  if (/^[A-Za-z]:[\/\\]/.test(relNorm) || relNorm.startsWith("/")) {
    return relNorm
  }

  const isUnixAbsolute = baseNorm.startsWith("/")
  const isWindowsDrive = /^[A-Za-z]:/.test(baseNorm)
  const segments = baseNorm.split("/").filter(Boolean)

  for (const seg of relNorm.split("/")) {
    if (seg === "" || seg === ".") continue
    if (seg === "..") {
      segments.pop()
    } else {
      segments.push(seg)
    }
  }

  if (isUnixAbsolute) return "/" + segments.join("/")
  if (isWindowsDrive) return segments.join("/")
  return segments.join("/")
}

/**
 * 找一组绝对路径的最近公共祖先目录。
 * 输入应是混合的目录和文件路径；返回的是路径分段的最长公共前缀。
 */
export function findCommonAncestor(paths: string[]): string {
  if (paths.length === 0) return ""

  const splitSegs = paths.map((p) => p.replace(/\\/g, "/").split("/").filter(Boolean))
  let common = splitSegs[0]
  for (const segs of splitSegs.slice(1)) {
    const next: string[] = []
    for (let i = 0; i < Math.min(common.length, segs.length); i++) {
      if (common[i].toLowerCase() === segs[i].toLowerCase()) {
        next.push(common[i])
      } else break
    }
    common = next
    if (common.length === 0) break
  }

  const first = paths[0].replace(/\\/g, "/")
  if (first.startsWith("/")) return "/" + common.join("/")
  if (/^[A-Za-z]:/.test(first)) return common.join("/")
  return common.join("/")
}

/**
 * 假设 target 在 base 内，返回 target 相对 base 的相对路径。
 * 若 target 不在 base 内，返回空串。
 */
export function relativeTo(base: string, target: string): string {
  const baseNorm = base.replace(/\\/g, "/").replace(/\/+$/, "")
  const targetNorm = target.replace(/\\/g, "/")
  if (targetNorm.toLowerCase() === baseNorm.toLowerCase()) return ""
  if (!targetNorm.toLowerCase().startsWith(baseNorm.toLowerCase() + "/")) return ""
  return targetNorm.slice(baseNorm.length + 1)
}

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
