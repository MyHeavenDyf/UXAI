import path from "node:path"
import { lstat, realpath } from "node:fs/promises"
import { fileURLToPath, pathToFileURL } from "node:url"
import { isExcludedPortableFile } from "./portable-exclusions"

const textFile = /\.(?:html?|css|[cm]?js|jsx|tsx?|svg)$/i
const entryFile = /\.(?:html?|svg|jsx|tsx)$/i
const resourceFile =
  /\.(?:[cm]?js|jsx|tsx?|css|json|wasm|map|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf|eot|mp[34]|webm|ogg|wav)$/i
const moduleExtensions = [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".json"]

function moduleReferences(text: string) {
  // Tokenize without executing code; comments and quoted examples must not become imports.
  const tokens = text.matchAll(
    /\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|[\w$]+|[^\s]/g,
  )
  const buffer: string[] = []
  const peek = (index: number): string | undefined => {
    while (buffer.length <= index) {
      const next = tokens.next()
      if (next.done) return
      const value = next.value[0]
      if (!value.startsWith("//") && !value.startsWith("/*")) buffer.push(value)
    }
    return buffer[index]
  }
  const literal = (value?: string) =>
    value && /^["'`]/.test(value) && !value.includes("${")
      ? value.slice(1, -1).replace(/\\(["'`\\])/g, "$1")
      : undefined
  const refs: string[] = []
  const optional = new Set<string>()
  const required = new Set<string>()
  const assets = new Set<string>()
  const constants = new Map<string, string | undefined>()
  const resourceProperty = /^(?:src|srcset|href|poster|image|backgroundImage)$/i
  const identifier = /^[A-Za-z_$][\w$]*$/
  const previous: string[] = []
  const add = (value?: string, bundled = false) => {
    const ref = literal(value)
    if (!ref || (!ref.startsWith(".") && !ref.startsWith("/"))) return
    refs.push(ref)
    if (bundled) optional.add(ref)
    if (!bundled) required.add(ref)
  }
  while (peek(0) !== undefined) {
    const token = buffer.shift()
    const assignment = previous.at(-1) === "{" ? previous.slice(0, -1) : previous
    const property = assignment.at(-2)
    if (
      token &&
      (literal(token) !== undefined || identifier.test(token)) &&
      ["=", ":"].includes(assignment.at(-1) ?? "") &&
      resourceProperty.test(literal(property) ?? property ?? "") &&
      !["-", "const", "let", "var"].includes(assignment.at(-3) ?? "") &&
      !["+", ".", "[", "?", "("].includes(peek(0) ?? "")
    ) {
      assets.add(token)
    }
    // Resolve only immutable literal bindings (or aliases), never evaluate expressions.
    if (token === "const" && identifier.test(peek(0) ?? "") && peek(1) === "=") {
      const name = peek(0)!
      const value = peek(2)
      if (constants.has(name)) constants.set(name, undefined)
      else if (
        value &&
        (literal(value) !== undefined || identifier.test(value)) &&
        (peek(3) === undefined || [";", ",", "}", "const", "let", "export", "function"].includes(peek(3)!))
      )
        constants.set(name, value)
    }
    if (
      token === "setAttribute" &&
      previous.at(-1) === "." &&
      peek(0) === "(" &&
      resourceProperty.test(literal(peek(1)) ?? "") &&
      peek(2) === "," &&
      peek(4) === ")"
    ) {
      if (peek(3)) assets.add(peek(3)!)
    }
    previous.push(token!)
    if (previous.length > 8) previous.shift()
    if (token === "require" || (token === "import" && peek(0) === "(")) {
      if (peek(0) === "(") add(peek(1), token === "require")
      continue
    }
    if (
      token === "URL" &&
      peek(0) === "(" &&
      peek(2) === "," &&
      peek(3) === "import" &&
      peek(4) === "." &&
      peek(5) === "meta"
    ) {
      add(peek(1))
      continue
    }
    if (token !== "import" && token !== "export") continue
    if (peek(0) === "." || (token === "export" && /^(?:default|const|let|function|class)$/.test(peek(0) ?? "")))
      continue
    if (literal(peek(0))) {
      add(peek(0))
      continue
    }
    for (const index of Array.from({ length: 128 }, (_, index) => index)) {
      const value = peek(index)
      if (value === undefined || value === ";") break
      if (value !== "from") continue
      add(peek(index + 1))
      break
    }
  }
  for (const ref of required) optional.delete(ref)
  const resolveAsset = (token: string) => {
    const visited = new Set<string>()
    const resolve = (value: string): string | undefined => {
      const text = literal(value)
      if (text !== undefined) return text
      if (visited.has(value) || visited.size >= 32) return
      visited.add(value)
      const constant = constants.get(value)
      return constant === undefined ? undefined : resolve(constant)
    }
    return resolve(token)
  }
  return {
    refs,
    optional,
    documentRefs: [
      ...new Set(
        [...assets].flatMap((token) => {
          const value = resolveAsset(token)
          return (
            value?.split(",").flatMap((item) => {
              const ref = item.trim().split(/\s+/)[0]
              return /^(?:\.\/)?assets\//.test(ref) &&
                resourceFile.test(ref.split(/[?#]/)[0]) &&
                !required.has(ref) &&
                !optional.has(ref)
                ? [ref]
                : []
            }) ?? []
          )
        }),
      ),
    ],
  }
}

function attributes(tag: string) {
  return new Map(
    [...tag.replace(/^<[\w:-]+/, "").matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)].map(
      (match) => [match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? ""],
    ),
  )
}

function cssReferences(text: string) {
  const css = text.replace(/\\(["'])/g, "$1").replace(/\/\*[\s\S]*?\*\//g, "")
  return [
    ...[...css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^"'()\s][^()\s]*))\s*\)/gi)].map(
      (match) => match[1] ?? match[2] ?? match[3],
    ),
    ...[...css.matchAll(/@import\s+(?:"([^"]+)"|'([^']+)')/gi)].map((match) => match[1] ?? match[2]),
  ]
}

function references(text: string, file: string) {
  if (/\.css$/i.test(file))
    return { base: undefined, refs: cssReferences(text), documentRefs: [] as string[], optional: new Set<string>() }
  if (/\.(?:[cm]?js|jsx|tsx?)$/i.test(file)) {
    return { base: undefined, ...moduleReferences(text) }
  }
  // Inline JS/JSX can contain HTML/CSS strings that are not browser resource requests.
  const uncommented = text.replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, (value) =>
    value.startsWith("<!--") ? "" : value,
  )
  const markup = uncommented.replace(/(<script\b[^>]*>)[\s\S]*?<\/script\s*>/gi, "$1</script>")
  const tags = [
    ...markup.matchAll(
      /<(?:script|link|img|source|video|audio|iframe|embed|object|image|use)\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi,
    ),
  ]
    .map(([tag]) => ({ tag, attrs: attributes(tag) }))
    .filter(
      ({ tag, attrs }) =>
        !/^<link\b/i.test(tag) ||
        (attrs.get("rel") ?? "")
          .toLowerCase()
          .split(/\s+/)
          .some((rel) =>
            ["stylesheet", "icon", "apple-touch-icon", "mask-icon", "preload", "modulepreload"].includes(rel),
          ),
    )
  return {
    base: /<base\b[^>]*\s+href\s*=\s*["']([^"']+)["']/i.exec(markup)?.[1],
    documentRefs: [] as string[],
    optional: new Set<string>(),
    refs: [
      ...[...uncommented.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)].flatMap((match) => {
        const modules = moduleReferences(match[1])
        return [...modules.refs.filter((ref) => !modules.optional.has(ref)), ...modules.documentRefs]
      }),
      ...tags.flatMap(({ attrs }) =>
        ["src", "href", "xlink:href", "poster", "data"].flatMap((name) => (attrs.has(name) ? [attrs.get(name)!] : [])),
      ),
      ...tags.flatMap(({ attrs }) => {
        const srcset = attrs.get("srcset") ?? ""
        return srcset.startsWith("data:") ? [] : srcset.split(",").map((value) => value.trim().split(/\s+/)[0])
      }),
      ...[...markup.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].flatMap((match) => cssReferences(match[1])),
      ...[...markup.matchAll(/\s+style\s*=\s*"([^"]*)"/gi)].flatMap((match) => cssReferences(match[1])),
      ...[...markup.matchAll(/\s+style\s*=\s*'([^']*)'/gi)].flatMap((match) => cssReferences(match[1])),
    ],
  }
}

function inside(root: string, file: string) {
  const relative = path.relative(root, file)
  return !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`)
}

/** Preserve logical asset paths while copying bytes from explicitly trusted, linked resource roots. */
export async function collectPortableDependencies(input: {
  root: string
  files: string[]
  trustedRoots: string[]
  read: (file: string) => Promise<Uint8Array>
  blacklist?: readonly string[]
}) {
  if (!input.files.length) return []
  const root = await realpath(input.root)
  const trusted = (
    await Promise.all(
      input.trustedRoots.map((dir) =>
        realpath(dir).catch((error) => {
          if (error.code === "ENOENT") return
          throw error
        }),
      ),
    )
  ).filter((dir): dir is string => !!dir)
  const known = new Set(input.files)
  const found = new Map<string, string>()
  const visited = new Set<string>()
  const missing = new Set<string>()
  const parsedFiles = new Map<string, ReturnType<typeof references>>()
  const key = (file: string, document?: string) => JSON.stringify([file, document])
  const pending = new Map<string, { file: string; source: string; document?: string }>(
    input.files
      .filter(
        (file) =>
          entryFile.test(file) &&
          !path
            .relative(input.root, file)
            .split(path.sep)
            .some((part) => part.startsWith(".")),
      )
      .map((file) => [key(file), { file, source: file }]),
  )
  const resolve = async (file: string) => {
    if (isExcludedPortableFile(file, input.blacklist)) return
    const actual = await realpath(file).catch((error) => {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") return
      throw error
    })
    if (!actual) return
    if (isExcludedPortableFile(actual, input.blacklist)) return
    if (!inside(root, actual) && (!resourceFile.test(actual) || !trusted.some((dir) => inside(dir, actual)))) {
      throw new Error(`导出依赖超出允许的资源目录：${path.relative(input.root, file)}`)
    }
    return (await lstat(actual)).isFile() ? actual : undefined
  }
  while (pending.size) {
    const batch = Array.from({ length: Math.min(4, pending.size) }, () => {
      const next = pending.entries().next().value!
      pending.delete(next[0])
      visited.add(next[0])
      return next[1]
    })
    await Promise.all(
      batch.map(async ({ file, source, document }) => {
        const parsed = parsedFiles.get(file) ?? references(new TextDecoder().decode(await input.read(source)), file)
        parsedFiles.set(file, parsed)
        const base = new URL(parsed.base ?? "", pathToFileURL(file))
        const page = /\.(?:html?|svg)$/i.test(file) ? base.href : document
        const refs = [
          ...[...new Set(parsed.refs)].map((raw) => ({ raw, base })),
          ...(page ? parsed.documentRefs.map((raw) => ({ raw, base: new URL(page) })) : []),
        ]
        for (const reference of refs) {
          const raw = reference.raw
          const ref = raw.replaceAll("&amp;", "&").trim()
          if (!ref || ref.startsWith("#") || /\$\{|\{\{|<%/.test(ref)) continue
          if (!URL.canParse(ref, reference.base)) throw new Error(`页面依赖地址无效：${ref}`)
          const url = new URL(ref, reference.base)
          if (url.protocol !== "file:") continue
          const target = fileURLToPath(url)
          const relative = path.relative(input.root, target)
          if (!inside(input.root, target) || relative.split(path.sep).some((part) => part.startsWith("."))) {
            throw new Error(`页面依赖无法安全保留相对路径：${ref}`)
          }
          if (isExcludedPortableFile(target, input.blacklist)) continue
          const candidates = /\.(?:[cm]?js|jsx|tsx?)$/i.test(file)
            ? [target, ...moduleExtensions.flatMap((ext) => [`${target}${ext}`, path.join(target, `index${ext}`)])]
            : [target]
          const resolved = await (async () => {
            for (const candidate of candidates) {
              const actual = await resolve(candidate)
              if (actual) return { file: candidate, source: actual }
            }
          })()
          // Browserify/UMD bundles contain internal require() IDs that are not filesystem dependencies.
          if (!resolved && parsed.optional.has(raw)) continue
          if (!resolved) {
            const warning = JSON.stringify([file, reference.base.href, target])
            if (!missing.has(warning)) {
              missing.add(warning)
              console.warn(
                "[octo:share] missing dependency",
                JSON.stringify({
                  source: file,
                  reference: raw,
                  base: reference.base.href,
                  target,
                }),
              )
            }
            continue
          }
          if (!known.has(resolved.file)) found.set(resolved.file, resolved.source)
          if (textFile.test(resolved.file) && !visited.has(key(resolved.file, page))) {
            pending.set(key(resolved.file, page), { ...resolved, document: page })
          }
        }
      }),
    )
  }
  return [...found].map(([file, source]) => ({ file, source }))
}
