import path from "node:path"
import { lstat } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import type { MessageV2 } from "./message-v2"

export function portableMarkdownReferences(text: string) {
  const result: string[] = []
  for (const match of text.matchAll(/\]\(\s*/g)) {
    const start = match.index + match[0].length
    if (text[start] === "<") {
      const end = text.indexOf(">", start + 1)
      if (end !== -1) result.push(text.slice(start + 1, end))
      continue
    }
    const value: string[] = []
    const nesting = { depth: 0 }
    for (let index = start; index < Math.min(text.length, start + 8192); index++) {
      const char = text[index]
      if (char === "\\" && /[()\\ ]/.test(text[index + 1] ?? "")) {
        value.push(text[++index])
        continue
      }
      if ((char === ")" || /\s/.test(char)) && nesting.depth === 0) break
      if (char === "(") nesting.depth++
      if (char === ")") nesting.depth--
      value.push(char)
    }
    if (value.length) result.push(value.join(""))
  }
  return result
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** Insight references are explicit files/folder attachments, never inferred project roots. */
export async function collectInsightSharedFiles(input: {
  root: string
  sessions: { messages: MessageV2.WithParts[] }[]
  list: (directory: string) => Promise<string[]>
}) {
  const root = path.resolve(input.root)
  const seeds = new Map<string, boolean>()
  const add = (value: unknown, directory = false, cwd = root) => {
    if (typeof value !== "string" || !value.trim() || value.includes("\0")) return
    const text = value.trim().replaceAll("&amp;", "&")
    const file = (() => {
      if (/^file:/i.test(text)) {
        try {
          return fileURLToPath(text)
        } catch {
          return undefined
        }
      }
      if (/^[a-z][\w+.-]*:/i.test(text) && !/^[a-z]:[\\/]/i.test(text)) return
      if (process.platform !== "win32" && path.win32.isAbsolute(text) && !path.isAbsolute(text)) return
      return path.resolve(cwd, text)
    })()
    if (!file) return
    const relative = path.relative(root, file)
    // A workspace mention or tool cwd is not an instruction to export its contents.
    if (!relative || path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) return
    if (relative.split(path.sep).some((part) => part.startsWith(".") || part === "node_modules")) return
    seeds.set(file, directory || seeds.get(file) === true)
    if (!/^file:/i.test(text) && /[%?#]/.test(text)) {
      try {
        const decoded = decodeURIComponent(text.split(/[?#]/)[0])
        if (decoded && decoded !== text) add(decoded, directory, cwd)
      } catch {
        /* An invalid optional reference must not prevent sharing. */
      }
    }
  }
  const attachment = (value: unknown) => {
    const file = record(value)
    add(file.url, true)
    add(record(file.source).path, true)
  }
  for (const session of input.sessions) {
    for (const message of session.messages) {
      for (const part of message.parts) {
        if (part.type === "file") attachment(part)
        if (part.type === "text") {
          // Skill/context injections can list unrelated workspace files. Only the
          // machine-readable attachment/reference blocks count as explicit references.
          const manifest = /^\s*\[(?:附件|引用文件)\]/.test(part.text)
          if (manifest) {
            for (const line of part.text.split("\n")) {
              const match = /^\s*-\s+.+?:\s+(.+)$/.exec(line)
              if (match) add(match[1], true)
            }
          }
          if (part.synthetic) continue
          const text =
            message.info.role === "user" && part.text.includes("\n---\n")
              ? part.text.slice(part.text.lastIndexOf("\n---\n") + 5)
              : part.text
          portableMarkdownReferences(text).forEach((value) => add(value))
          for (const match of text.matchAll(
            /<artifact\b[^>]*\btype\s*=\s*["']text\/link["'][^>]*>([\s\S]*?)<\/artifact\s*>/gi,
          ))
            add(match[1])
        }
        if (part.type !== "tool" || part.state.status !== "completed") continue
        const cwd = typeof part.state.input.workdir === "string" ? path.resolve(root, part.state.input.workdir) : root
        if (["read", "write", "edit", "multiedit"].includes(part.tool)) {
          for (const key of ["filePath", "filepath", "file_path", "path"]) add(part.state.input[key], false, cwd)
        }
        const metadata = record(part.state.metadata)
        add(metadata.filepath, false, cwd)
        if (Array.isArray(metadata.files)) {
          for (const file of metadata.files) {
            add(record(file).filePath, false, cwd)
            add(record(file).movePath, false, cwd)
          }
        }
        if (Array.isArray(part.state.attachments)) part.state.attachments.forEach(attachment)
      }
    }
  }
  const files = new Set<string>()
  const selected = [...seeds]
  for (let index = 0; index < selected.length; index += 8) {
    await Promise.all(
      selected.slice(index, index + 8).map(async ([file, directory]) => {
        const info = await lstat(file).catch(() => undefined)
        if (info?.isFile()) files.add(file)
        if (!directory || !info?.isDirectory()) return
        for (const child of await input.list(file).catch(() => [])) files.add(child)
      }),
    )
  }
  return [...files].sort()
}
