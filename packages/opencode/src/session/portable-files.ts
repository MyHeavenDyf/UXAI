import path from "node:path"
import { lstat, readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { glob } from "glob"
import { parse } from "jsonc-parser"
import type { MessageV2 } from "./message-v2"

const markers = [
  ".octo-fastui.json",
  "package.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "CMakeLists.txt",
  "vite.config.ts",
  "vite.config.js",
  "webpack.config.js",
  "angular.json",
  "tsconfig.json",
  "index.html",
]
// Build inputs only; never implicitly include .env, credentials, or repository internals.
export const portableProjectHiddenFiles = new Set([
  ".octo-fastui.json",
  ".env.example",
  ".env.sample",
  ".env.template",
  ".browserslistrc",
  ".postcssrc",
  ".postcssrc.json",
  ".babelrc",
  ".babelrc.json",
])

function markdownPaths(text: string) {
  const files: string[] = []
  for (const match of text.matchAll(/\]\(\s*/g)) {
    const start = match.index + match[0].length
    if (text[start] === "<") {
      const end = text.indexOf(">", start + 1)
      if (end !== -1) files.push(text.slice(start + 1, end))
      continue
    }
    const value: string[] = []
    const depth = { value: 0 }
    for (let index = start; index < Math.min(text.length, start + 8192); index++) {
      const char = text[index]
      if (char === "\\" && /[()\\ ]/.test(text[index + 1] ?? "")) {
        value.push(text[++index])
        continue
      }
      if (char === ")" && depth.value === 0) break
      if (/\s/.test(char) && depth.value === 0) break
      if (char === "(") depth.value++
      if (char === ")") depth.value--
      value.push(char)
    }
    if (value.length) files.push(value.join(""))
  }
  return files
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** Select shared files from conversation evidence, without scanning unrelated workspace trees. */
export async function collectPortableProjectFiles(input: {
  root: string
  sessions: { info: { id: string }; messages: MessageV2.WithParts[] }[]
  list: (directory: string) => Promise<string[]>
}) {
  const root = path.resolve(input.root)
  const inside = (file: string) => {
    const relative = path.relative(root, file)
    return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
  }
  const seeds = new Set<string>()
  const directorySeeds = new Set<string>()
  const previews = new Map<string, { name: string; sessionID: string }>()
  const add = (value: unknown, cwd = root, directory = false, sessionID = input.sessions[0]?.info.id) => {
    if (typeof value !== "string" || !value.trim() || value.includes("\0")) return
    const text = value.trim().replaceAll("&amp;", "&")
    if (/^fastui:\/\//i.test(text)) {
      const name = text.slice("fastui://".length).replace(/\/+$/, "")
      const decoded = (() => {
        try {
          return decodeURIComponent(name)
        } catch {
          return name
        }
      })()
      if (decoded && sessionID && !/[\\/?#]/.test(decoded) && decoded !== "." && decoded !== "..") {
        previews.set(`${sessionID}/${decoded}`, { name: decoded, sessionID })
      }
      return
    }
    const file = (() => {
      if (/^file:/i.test(text)) {
        try {
          return fileURLToPath(text)
        } catch {
          return undefined
        }
      }
      if (/^(?:https?:|data:|blob:|javascript:|mailto:)/i.test(text)) return
      // A Windows drive path is not a relative path when exporting on macOS/Linux.
      if (process.platform !== "win32" && path.win32.isAbsolute(text) && !path.isAbsolute(text)) return
      return path.resolve(cwd, text)
    })()
    if (!file || !inside(file)) return
    if (
      path
        .relative(root, file)
        .split(path.sep)
        .some((part) => part.startsWith(".") && !portableProjectHiddenFiles.has(part))
    )
      return
    seeds.add(file)
    if (directory) directorySeeds.add(file)
    // Try the literal filename first (it may contain # or %), then its URL spelling.
    if (!/^file:/i.test(text) && /[%?#]/.test(text)) {
      try {
        const decoded = decodeURIComponent(text.split(/[?#]/)[0])
        if (decoded && decoded !== text) add(decoded, cwd, directory, sessionID)
      } catch {
        /* Malformed URLs are optional evidence, not export failures. */
      }
    }
  }
  const attachment = (value: unknown) => {
    const file = record(value)
    add(file.url, root, true)
    add(record(file.source).path, root, true)
  }
  const textFiles = (text: string, cwd = root, sessionID = input.sessions[0]?.info.id) => {
    markdownPaths(text).forEach((file) => add(file, cwd, true, sessionID))
    // Paths in ordinary replies, code blocks, and command arguments are useful even
    // when a tool did not emit an artifact manifest. Only existing paths are selected.
    for (const match of text.matchAll(/`([^`\r\n]+)`|"([^"\r\n]+)"|'([^'\r\n]+)'/g)) {
      const value = match[1] ?? match[2] ?? match[3]
      if (/^(?:file:|fastui:|[A-Za-z]:[\\/]|\.?\.?\/)|[\\/]|\.[A-Za-z0-9]{1,12}(?:[?#].*)?$/.test(value))
        add(value, cwd, true, sessionID)
    }
    for (const match of text.matchAll(
      /(?:^|[\s<>：:])((?:file:\/\/\/|[A-Za-z]:[\\/]|\.\.?\/|\/)[^\s<>"`]+|[^\s<>"`=;|]+\.[A-Za-z0-9]{1,12})(?=$|[\s<>，。；])/gm,
    )) {
      add(match[1].replace(/[，。；]+$/, ""), cwd)
    }
  }
  for (const session of input.sessions) {
    // Upgraded workspaces retain per-session ownership in this directory.
    add(
      path.join(root, "output", session.info.id.startsWith("ses_") ? session.info.id.slice(4, 16) : session.info.id),
      root,
      true,
    )
    for (const message of session.messages) {
      for (const part of message.parts) {
        if (part.type === "file") attachment(part)
        if (part.type === "text") {
          // Ignore the injected workspace/artifact listing; it describes unrelated sessions too.
          const text =
            message.info.role === "user" && part.text.includes("\n---\n")
              ? part.text.slice(part.text.lastIndexOf("\n---\n") + 5)
              : part.text
          textFiles(text, root, session.info.id)
          if (/^\s*\[(?:附件|引用文件)\]/.test(text)) {
            for (const match of text.matchAll(/^-\s+[^\r\n]+?:\s+([^\r\n]+)/gm)) add(match[1], root, true)
          }
          if (message.info.role === "assistant") {
            for (const match of text.matchAll(/<artifact\b([^>]*)>([\s\S]*?)(?:<\/artifact\s*>|$)/gi)) {
              if (/\btype\s*=\s*(?:"text\/link"|'text\/link')/i.test(match[1]))
                add(match[2], root, true, session.info.id)
            }
          }
        }
        if (part.type !== "tool" || part.state.status !== "completed") continue
        const metadata = part.state.metadata
        const cwd = typeof part.state.input.workdir === "string" ? path.resolve(root, part.state.input.workdir) : root
        if (["read", "write", "edit", "multiedit"].includes(part.tool)) {
          for (const key of ["filePath", "filepath", "path", "file_path"]) add(part.state.input[key], cwd)
        }
        if (["bash", "shell"].includes(part.tool)) {
          if (typeof part.state.input.command === "string") textFiles(part.state.input.command, cwd, session.info.id)
          textFiles(part.state.output, cwd, session.info.id)
          if (typeof part.state.input.workdir === "string" && cwd !== root) add(cwd, root, true)
        }
        add(metadata.filepath, cwd)
        if (Array.isArray(metadata.files)) {
          for (const file of metadata.files) {
            add(record(file).filePath, cwd)
            add(record(file).movePath, cwd)
          }
        }
        const script = record(metadata.artifactScript)
        if (metadata.exit === 0 && script.version === 1 && Array.isArray(script.files)) {
          for (const file of script.files) {
            if (record(file).reason === "verified-change") add(record(file).path, cwd)
          }
        }
        if (Array.isArray(part.state.attachments)) part.state.attachments.forEach(attachment)
      }
    }
  }
  for (const preview of previews.values()) {
    // Preview resolves a private project first; do not include a different, same-named shared project.
    const privateRoot = path.join(root, ".octo", preview.sessionID)
    const privateProject = await lstat(path.join(privateRoot, "outputs", preview.name)).catch(() => undefined)
    const marker = await Promise.all(
      [
        path.join(privateRoot, "outputs", preview.name, ".octo-fastui.json"),
        path.join(privateRoot, ".octo-fastui.json"),
      ].map((file) =>
        lstat(file).then(
          (info) => info.isFile(),
          () => false,
        ),
      ),
    )
    if (privateProject?.isDirectory() && marker.some(Boolean)) continue
    add(path.join(root, preview.name), root, true)
  }
  const stats = new Map<string, ReturnType<typeof lstat>>()
  const stat = (file: string) => {
    const previous = stats.get(file)
    if (previous) return previous
    const result = lstat(file)
    // Attach the rejection handler immediately; an absent seed is normal for old sessions.
    result.catch(() => undefined)
    stats.set(file, result)
    return result
  }
  const projects = new Map<string, Promise<string | undefined>>()
  const project = (directory: string): Promise<string | undefined> => {
    // A workspace-level manifest may serve many sessions. Only an explicitly
    // referenced root directory may select the whole workspace, never an ancestor lookup.
    if (directory === root || !inside(directory)) return Promise.resolve(undefined)
    const existing = projects.get(directory)
    if (existing) return existing
    const result = (async () => {
      const present = await Promise.all(
        markers.map((name) =>
          stat(path.join(directory, name)).then(
            (value) => value.isFile(),
            () => false,
          ),
        ),
      )
      if (present.some(Boolean)) return directory
      return project(path.dirname(directory))
    })()
    projects.set(directory, result)
    return result
  }
  const directories = new Set<string>()
  const files = new Set<string>()
  // Keep filesystem concurrency bounded regardless of conversation size.
  const pending = [...seeds]
  for (let index = 0; index < pending.length; index += 8) {
    await Promise.all(
      pending.slice(index, index + 8).map(async (file) => {
        const info = await stat(file).catch(() => undefined)
        if (!info || info.isSymbolicLink() || (info.isDirectory() && !directorySeeds.has(file))) return
        const directory = await project(info.isDirectory() ? file : path.dirname(file))
        if (directory) directories.add(directory)
        if (!directory && info.isFile() && /\.(?:html?|vue|svelte)$/i.test(file) && path.dirname(file) !== root) {
          const parts = path.relative(root, file).split(path.sep)
          const source = parts.indexOf("src")
          directories.add(source > 0 ? path.join(root, ...parts.slice(0, source)) : path.dirname(file))
        }
        if (!directory && info.isDirectory()) directories.add(file)
        if (!directory && info.isFile()) files.add(file)
      }),
    )
  }
  // Follow declared local packages and path aliases, including sibling workspace
  // packages. Never execute configuration/scripts to discover dependencies.
  const processed = new Set<string>()
  const configs = new Map<string, Promise<Record<string, unknown>>>()
  const config = (file: string) => {
    const previous = configs.get(file)
    if (previous) return previous
    const value = readFile(file, "utf8")
      .then((text) => record(parse(text) as unknown))
      .catch(() => record(undefined))
    configs.set(file, value)
    return value
  }
  const workspaces = new Map<string, Promise<{ name: string; directory: string }[]>>()
  const packages = (parent: string, patterns: unknown[]) => {
    const previous = workspaces.get(parent)
    if (previous) return previous
    const value = (async () => {
      const found: { name: string; directory: string }[] = []
      for (const pattern of patterns) {
        if (typeof pattern !== "string" || pattern.startsWith("!")) continue
        if (!inside(path.resolve(parent, pattern.split(/[*?[{]/)[0]))) continue
        const patternPath = path.posix.join(pattern.replaceAll("\\", "/"), "package.json")
        try {
          for (const match of await glob(patternPath, {
            cwd: parent,
            absolute: true,
            nodir: true,
            follow: false,
            dot: false,
            ignore: ["**/node_modules/**", "**/.*/**"],
          })) {
            if (
              !inside(match) ||
              path
                .relative(parent, match)
                .split(path.sep)
                .some((part) => part === "node_modules" || part.startsWith("."))
            )
              continue
            const item = await config(match)
            if (typeof item.name === "string") found.push({ name: item.name, directory: path.dirname(match) })
          }
        } catch {
          /* An unreadable/invalid workspace must not block export. */
        }
      }
      return found
    })()
    workspaces.set(parent, value)
    return value
  }
  for (const directory of directories) {
    if (processed.has(directory)) continue
    processed.add(directory)
    const include = async (value: string, cwd = directory) => {
      const target = path.resolve(cwd, value.replace(/\*.*$/, ""))
      if (target === root && directory !== root) return
      if (
        !inside(target) ||
        path
          .relative(root, target)
          .split(path.sep)
          .some((part) => part.startsWith(".") && !portableProjectHiddenFiles.has(part))
      )
        return
      const info = await stat(target).catch(() => undefined)
      if (!info || info.isSymbolicLink()) return
      if (info.isDirectory()) directories.add(target)
      if (info.isFile()) files.add(target)
    }
    const pkg = await config(path.join(directory, "package.json"))
    const deps = { ...record(pkg.dependencies), ...record(pkg.devDependencies), ...record(pkg.optionalDependencies) }
    for (const value of Object.values(deps)) {
      if (typeof value === "string" && /^(?:file|link):/.test(value))
        await include(value.replace(/^(?:file|link):/, ""))
    }
    const configurations = new Set([path.join(directory, "tsconfig.json"), path.join(directory, "jsconfig.json")])
    for (const file of configurations) {
      const value = await config(file)
      const options = record(value.compilerOptions)
      const base =
        typeof options.baseUrl === "string" ? path.resolve(path.dirname(file), options.baseUrl) : path.dirname(file)
      for (const values of Object.values(record(options.paths))) {
        if (!Array.isArray(values)) continue
        for (const value of values) if (typeof value === "string") await include(value, base)
      }
      const parents = Array.isArray(value.extends) ? value.extends : [value.extends]
      for (const parent of parents) {
        if (typeof parent !== "string" || !parent.startsWith(".")) continue
        const target = path.resolve(path.dirname(file), /\.json$/i.test(parent) ? parent : `${parent}.json`)
        if (!inside(target) || configurations.size >= 64) continue
        configurations.add(target)
        await include(target)
      }
    }
    for (const name of ["vite.config.ts", "vite.config.js", "vite.config.mts", "webpack.config.js"]) {
      const text = await readFile(path.join(directory, name), "utf8").catch(() => "")
      // Resolve only literal paths; never import a Vite/Webpack config to inspect it.
      for (const match of text.matchAll(
        /(?:\bresolve\(\s*__dirname\s*,\s*|new\s+URL\(\s*)["'](\.{1,2}\/[^"']+)["']/g,
      )) {
        await include(match[1])
      }
    }
    const workspace = new Set(Object.keys(deps))
    for (let parent = path.dirname(directory); workspace.size && inside(parent); parent = path.dirname(parent)) {
      const manifest = await config(path.join(parent, "package.json"))
      const patterns = Array.isArray(manifest.workspaces) ? manifest.workspaces : record(manifest.workspaces).packages
      if (Array.isArray(patterns)) {
        for (const name of [
          "package.json",
          "bun.lock",
          "bun.lockb",
          "package-lock.json",
          "pnpm-lock.yaml",
          "pnpm-workspace.yaml",
          "yarn.lock",
        ]) {
          await include(path.join(parent, name))
        }
        for (const item of await packages(parent, patterns)) {
          if (workspace.delete(item.name)) await include(item.directory)
        }
      }
      if (parent === root) break
    }
  }
  const roots = [...directories].filter(
    (directory) => ![...directories].some((parent) => parent !== directory && directory.startsWith(parent + path.sep)),
  )
  for (const directory of roots) {
    for (const file of await input.list(directory).catch(() => [])) files.add(file)
  }
  return [...files].sort()
}
