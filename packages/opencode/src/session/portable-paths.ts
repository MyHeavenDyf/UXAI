import path from "node:path"
import { createHash } from "node:crypto"

type File = { sessionID: string; scope?: "session" | "design-history" | "project"; directory: string; path: string; sha256?: string }

const hash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 12)
const identity = (value: string) => value.normalize("NFC").toLowerCase()
const windows = (value: string) => /^[a-z]:[/\\]|^\\\\|^\/\//i.test(value)

function relative(value: string) {
  const parts: string[] = []
  for (const part of value.split("/")) {
    if (!part || part === ".") continue
    if (part === "..") {
      if (!parts.length) throw new Error("路径越过文件所属根目录")
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.join("/")
}

function component(value: string) {
  const encoded = value
    .normalize("NFC")
    .replace(/[\\<>:"|?*\x01-\x1f\x7f]|[ .]+$/g, (part) =>
      [...part].map((char) => `~${char.charCodeAt(0).toString(16).padStart(4, "0")}~`).join(""),
    )
  const reserved = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(encoded)
    ? `~reserved~${encoded}`
    : encoded
  return Buffer.byteLength(reserved) <= 100
    ? reserved
    : `${[...reserved].slice(0, 24).join("")}~${hash(value)}${path.posix.extname(reserved).slice(0, 16)}`
}

/** Pure planning: no filesystem reads/writes and no URL requests. Scope is part of every lookup key. */
export function planPortablePaths<T extends File>(input: {
  files: T[]
  sourceDirectory: string
  maxLength?: number
  sourcePlatform?: "posix" | "win32"
}) {
  const win = input.sourcePlatform ? input.sourcePlatform === "win32" : windows(input.sourceDirectory)
  const normalize = (value: string) => (win ? value.replaceAll("\\", "/") : value)
  const source = normalize(input.sourceDirectory).replace(/\/+$/, "")
  const root = (file: File) =>
    file.scope === "project"
      ? source
      : file.scope === "design-history"
        ? `${source}/.octo/design/history/${file.sessionID}`
        : `${source}/.octo/${file.sessionID}`
  const absolute = (value: string, base: string) => {
    if (!path.posix.isAbsolute(value) && !/^[a-z]:/i.test(value)) return value
    if (/^[a-z]:[^/]/i.test(value)) throw new Error("无法定位盘符相对路径")
    const normal = path.posix.normalize(value)
    const compare = win ? normal.toLowerCase() : normal
    const parent = win ? base.toLowerCase() : base
    if (!compare.startsWith(`${parent}/`)) throw new Error("绝对路径不属于记录的原始目录")
    return normal.slice(base.length + 1)
  }
  const entries = input.files.map((file, index) => {
    const fail = (field: string, value: string, reason: string): never => {
      throw new Error(`分享包路径不兼容：files[${index}].${field}=${JSON.stringify(value)}，${reason}`)
    }
    if (!file.path || file.path.includes("\0")) fail("path", file.path, "文件路径为空或包含空字符")
    if (file.directory.includes("\0")) fail("directory", file.directory, "包含空字符")
    try {
      const directory = absolute(normalize(file.directory || "."), root(file))
      const name = normalize(file.path)
      const original =
        path.posix.isAbsolute(name) || /^[a-z]:/i.test(name)
          ? relative(absolute(name, root(file)))
          : relative(`${directory}/${name}`)
      if (!original) fail("path", file.path, "文件路径归一化后为空")
      const scope = file.scope === "project" ? "project" : `${file.scope ?? "session"}/${file.sessionID}`
      return { file, original, scope, root: root(file), path: "" }
    } catch (error) {
      return fail("path", `${file.directory}/${file.path}`, error instanceof Error ? error.message : String(error))
    }
  })
  // Reserve names in deterministic order, including directory prefixes and file/directory collisions.
  const nodes = new Map<string, { scope: string; original: string; target: string; file: boolean }>()
  const originals = new Map<string, string | undefined>()
  for (const entry of entries) {
    const key = `${entry.scope}/${entry.original}`
    if (originals.has(key) && originals.get(key) !== entry.file.sha256) throw new Error(`分享包中同一路径包含不同内容，无法确定引用目标：${entry.original}`)
    originals.set(key, entry.file.sha256)
    const parts = entry.original.split("/")
    parts.forEach((_, index) => {
      const original = parts.slice(0, index + 1).join("/")
      const key = `${entry.scope}/${original}`
      const existing = nodes.get(key)
      const file = index === parts.length - 1
      if (existing && existing.file !== file) throw new Error(`分享包内部文件与目录冲突：${original}`)
      nodes.set(key, { scope: entry.scope, original, target: "", file })
    })
  }
  const occupied = new Map<string, string>()
  const ordered = [...nodes.values()].sort(
    (a, b) =>
      a.original.split("/").length - b.original.split("/").length ||
      (a.original < b.original ? -1 : a.original > b.original ? 1 : 0),
  )
  for (const node of ordered) {
    const parent = path.posix.dirname(node.original)
    const directory = parent === "." ? "" : nodes.get(`${node.scope}/${parent}`)!.target
    const name = component(path.posix.basename(node.original))
    const candidate = directory ? `${directory}/${name}` : name
    const key = `${node.scope}/${identity(candidate)}`
    const suffix = occupied.has(key) ? `~${hash(`${node.scope}/${node.original}`)}` : ""
    const ext = path.posix.extname(name)
    const targetName = suffix ? `${name.slice(0, name.length - ext.length)}${suffix}${ext}` : name
    const target = directory ? `${directory}/${targetName}` : targetName
    const targetKey = `${node.scope}/${identity(target)}`
    if (occupied.has(targetKey)) throw new Error(`无法消解分享包内部路径冲突：${node.original}`)
    occupied.set(targetKey, node.original)
    node.target = target
  }
  const maximum = Math.max(48, input.maxLength ?? 180)
  for (const entry of entries) {
    const candidate = nodes.get(`${entry.scope}/${entry.original}`)!.target
    const bucket = /^(outputs|uploads)\//.exec(candidate)?.[1]
    entry.path =
      candidate.length <= maximum
        ? candidate
        : `${bucket ? `${bucket}/` : ""}portable-long/${hash(`${entry.scope}/${entry.original}`)}${path.posix.extname(candidate).slice(0, 16)}`
    if (
      entry.path !== candidate &&
      occupied.has(`${entry.scope}/${identity(entry.path)}`) &&
      occupied.get(`${entry.scope}/${identity(entry.path)}`) !== entry.original
    )
      throw new Error(`长路径转换冲突：${entry.original}`)
    occupied.set(`${entry.scope}/${identity(entry.path)}`, entry.original)
  }
  const lookups = new Map(entries.map((entry) => [`${entry.scope}/${entry.original}`, entry]))
  const absoluteFiles = new Map(entries.map((entry) => [`${entry.root}/${entry.original}`, entry]))
  const mapped = entries.filter((entry) => entry.path !== entry.original)
  const resolve = (
    value: string,
    from: (typeof entries)[number],
    url = true,
    base = path.posix.dirname(from.original),
  ) => {
    if (!value || /^(?:https?:|data:|blob:|javascript:|mailto:|#|\/\/)/i.test(value)) return value
    const fileURL = value.startsWith("file://") ? new URL(value) : undefined
    const offset = url ? value.search(/[?#]/) : -1
    const pathname = offset < 0 ? value : value.slice(0, offset)
    const suffix = offset < 0 ? "" : value.slice(offset)
    const decoded = url ? decodeURIComponentSafe(pathname) : pathname
    const local = fileURL
      ? normalize(decodeURIComponentSafe(`${fileURL.hostname ? `//${fileURL.hostname}` : ""}${fileURL.pathname}`).replace(/^\/([a-z]:\/)/i, "$1"))
      : normalize(decoded)
    const absolutePath = path.posix.isAbsolute(local) || /^[a-z]:/i.test(local)
    const inRoot =
      absolutePath &&
      (win ? local.toLowerCase().startsWith(`${from.root.toLowerCase()}/`) : local.startsWith(`${from.root}/`))
    const absoluteTarget = absolutePath ? absoluteFiles.get(local) : undefined
    if (absolutePath && !inRoot && !absoluteTarget) return value
    const original = path.posix.normalize(inRoot ? local.slice(from.root.length + 1) : `${base}/${local}`)
    const target = absoluteTarget ?? lookups.get(`${from.scope}/${original}`)
    if (
      !target ||
      (target.path === target.original && from.path === from.original && base === path.posix.dirname(from.original))
    )
      return value
    const relocated = absolutePath
      ? `${target.root}/${target.path}`
      : path.posix.relative(path.posix.dirname(from.path), target.path)
    // A rewritten ES module specifier must remain relative rather than becoming a bare package name.
    const result = !absolutePath && /^\.\.?\//.test(local) && !relocated.startsWith(".") ? `./${relocated}` : relocated
    if (fileURL) {
      fileURL.pathname = (fileURL.hostname ? result.slice(result.indexOf("/", 2)) : result.startsWith("/") ? result : `/${result}`).replaceAll("%", "%25")
      return fileURL.href
    }
    return (url ? result.split("/").map(encodeURIComponent).join("/") : result) + suffix
  }
  const absoluteMappings = mapped.flatMap((entry) => {
    const original = `${entry.root}/${entry.original}`
    const target = `${entry.root}/${entry.path}`
    const url = (value: string) => {
      const result = new URL(value.startsWith("//") ? `file://${value.slice(2).split("/")[0]}/` : "file:///")
      result.pathname = (value.startsWith("//")
        ? value.slice(value.indexOf("/", 2))
        : value.startsWith("/")
          ? value
          : `/${value}`).replaceAll("%", "%25")
      return result.href
    }
    return [
      [original, target] as const,
      ...(win ? [[original.replaceAll("/", "\\"), target] as const] : []),
      [url(original), url(target)] as const,
    ]
  })
  const aliases = new Map(absoluteMappings)
  const pattern = aliases.size
    ? new RegExp(
        `(?<![\\w/\\\\])(${[...aliases.keys()]
          .sort((a, b) => b.length - a.length)
          .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join("|")})(?=$|[\\s"'\x60<>\\[\\](){}?,;:!#，。；：！？])`,
        "g",
      )
    : undefined
  return {
    entries,
    changed: mapped.length > 0,
    rewriteText: (value: string) => {
      if (value.startsWith("file://") && entries.length && !/\s/.test(value)) return resolve(value, entries[0])
      return pattern ? value.replace(pattern, (name) => aliases.get(name)!) : value
    },
    reference: (value: string, index: number, url = true, base?: string) => resolve(value, entries[index], url, base),
  }
}

function decodeURIComponentSafe(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** Rewrite only resource references resolved against the original file, never basename-wide text. */
export function rewritePortableDocument(
  text: string,
  filename: string,
  reference: (value: string, base?: string) => string,
) {
  const css = (text: string, base?: string) =>
    text.replace(
      /\/\*[\s\S]*?\*\/|url\(\s*(["']?)([^)"']+)\1\s*\)|@import\s+(["'])([^"']+)\3/gi,
      (match, quote: string, value: string, importQuote: string, imported: string) => {
        if (match.startsWith("/*")) return match
        if (reference(value || imported, base) === (value || imported)) return match
        return value
          ? `url(${quote}${reference(value, base)}${quote})`
          : `@import ${importQuote}${reference(imported, base)}${importQuote}`
      },
    )
  const script = (text: string, base?: string) =>
    text.replace(/\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|(["'`])((?:\\.|[^\\])*?)\1/g, (match, quote: string, value: string) => {
      if (!quote || value.includes("${") || value.includes("\\")) return match
      return `${quote}${reference(value, base)}${quote}`
    })
  if (/\.(?:jsx|tsx)$/i.test(filename)) return script(text)
  if (/\.(?:html?|svg)$/i.test(filename)) {
    const baseMatch = /<base\b[^>]*\bhref\s*=\s*["']([^"']*)["']/i.exec(text)
    if (baseMatch && /^[a-z]+:|^\/\//i.test(baseMatch[1])) return text
    const base = baseMatch
      ? path.posix.normalize(path.posix.join(path.posix.dirname(filename), baseMatch[1]))
      : undefined
    const tag = (tag: string) => {
      if (tag.startsWith("<!--")) return tag
      if (/^<base\b/i.test(tag) && baseMatch && !/^[a-z]+:|^\/\//i.test(baseMatch[1]))
        return tag.replace(/(\bhref\s*=\s*["'])[^"']*/i, "$1./")
      return tag.replace(
        /(\b(?:src|href|poster|srcset)\s*=\s*)(["'])(.*?)\2/gi,
        (_, prefix: string, quote: string, value: string) => {
          const rewritten = /^srcset/i.test(prefix) && !value.includes("data:")
            ? value
                .split(",")
                .map((part) =>
                  part.replace(/^(\s*)(\S+)/, (_, space: string, url: string) => space + reference(url, base)),
                )
                .join(",")
            : reference(value, base)
          return prefix + quote + rewritten + quote
        },
      )
    }
    return text.replace(/<!--[\s\S]*?-->|(<script\b[^>]*>)([\s\S]*?)(<\/script>)|(<style\b[^>]*>)([\s\S]*?)(<\/style>)|<[^>]+>/gi,
      (match, scriptStart: string, scriptBody: string, scriptEnd: string, styleStart: string, styleBody: string, styleEnd: string) => {
        if (match.startsWith("<!--")) return match
        if (scriptStart) return tag(scriptStart) + script(scriptBody, base) + scriptEnd
        if (styleStart) return tag(styleStart) + css(styleBody, base) + styleEnd
        return tag(match).replace(/(\bstyle\s*=\s*)(["'])(.*?)\2/gi, (_, prefix: string, quote: string, value: string) => prefix + quote + css(value, base) + quote)
      })
  }
  if (/\.css$/i.test(filename)) return css(text)
  if (/\.(?:[cm]?js|ts|json)$/i.test(filename)) return script(text)
  if (/\.(?:md|txt)$/i.test(filename))
    return text.replace(
      /(!?\[[^\]]*\]\()([^\s)]+)([^)]*\))/g,
      (_, start: string, url: string, end: string) => start + reference(url) + end,
    )
  return text
}
