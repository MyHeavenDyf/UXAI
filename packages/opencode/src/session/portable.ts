import { createHash, randomUUID } from "node:crypto"
import { lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import JSZip from "jszip"
import { Effect, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { Filesystem } from "@/util/filesystem"
import { NonNegativeInt } from "@/util/schema"
import { MessageV2 } from "./message-v2"
import { MessageID, PartID, SessionID } from "./schema"
import { Session } from "./session"
import { Todo } from "./todo"

const bundleVersion = 1 as const
const manifestName = "manifest.json"
const sessionDirectory = ".octo"

const ShareUploadResponse = Schema.Struct({
  content: Schema.Struct({
    uniqueId: Schema.String,
  }),
  success: Schema.Boolean,
})

const FileEntry = Schema.Struct({
  sessionID: SessionID,
  scope: Schema.optional(Schema.Literals(["session", "design-history", "project"])),
  directory: Schema.String,
  path: Schema.String,
  size: NonNegativeInt,
  sha256: Schema.String,
  blob: Schema.String,
})

const SessionEntry = Schema.Struct({
  info: Session.Info,
  messages: Schema.Array(MessageV2.WithParts),
  todos: Schema.Array(Todo.Info),
})

const Manifest = Schema.Struct({
  format: Schema.Literal("octo-session"),
  version: Schema.Literal(bundleVersion),
  exportedAt: NonNegativeInt,
  rootSessionID: SessionID,
  sourceDirectory: Schema.String,
  exclusions: Schema.Array(Schema.String),
  sessions: Schema.Array(SessionEntry),
  files: Schema.Array(FileEntry),
})

type SessionEntry = {
  info: Session.Info
  messages: MessageV2.WithParts[]
  todos: Todo.Info[]
}

type FileEntry = {
  sessionID: SessionID
  scope?: "session" | "design-history" | "project"
  directory: string
  path: string
  size: number
  sha256: string
  blob: string
}

type Manifest = {
  format: "octo-session"
  version: typeof bundleVersion
  exportedAt: number
  rootSessionID: SessionID
  sourceDirectory: string
  exclusions: string[]
  sessions: SessionEntry[]
  files: FileEntry[]
}

const decodeManifest = (input: unknown) => Schema.decodeUnknownSync(Manifest)(input) as unknown as Manifest

function portableInfo(info: Session.Info): Session.Info {
  return {
    ...info,
    workspaceID: undefined,
    share: undefined,
    permission: undefined,
    revert: undefined,
    time: {
      created: info.time.created,
      updated: info.time.updated,
      archived: info.time.archived,
    },
  }
}

function isPortablePath(value: string) {
  if (
    !value ||
    value.includes("\0") ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    value.includes(":")
  )
    return false
  const normalized = value.replaceAll("\\", "/")
  return !normalized.split("/").includes("..")
}

function digest(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex")
}

function isProjectFile(value: string) {
  return value.replaceAll("\\", "/").split("/")
    .every((part) => part && !/[\0:]/.test(part) && !part.startsWith(".") && part !== "node_modules")
}

async function listFiles(root: string, project = false) {
  const found: string[] = []
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (project && !isProjectFile(entry.name)) continue
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) await visit(target)
      if (entry.isFile()) found.push(target)
    }
  }
  await visit(root)
  return found.sort()
}

function collectSessions(rootSessionID: SessionID) {
  return Effect.gen(function* () {
    const sessions = yield* Session.Service
    const todos = yield* Todo.Service
    const collect = (
      sessionID: SessionID,
    ): Effect.Effect<SessionEntry[], Session.NotFound, Session.Service | Todo.Service> =>
      Effect.gen(function* () {
        const info = yield* sessions.get(sessionID)
        const children = yield* sessions.children(sessionID)
        const descendants = yield* Effect.all(
          children.map((child) => collect(child.id)),
          { concurrency: "unbounded" },
        )
        return [
          {
            info: portableInfo(info),
            messages: yield* sessions.messages({ sessionID }),
            todos: yield* todos.get(sessionID),
          },
          ...descendants.flat(),
        ]
      })
    return yield* collect(rootSessionID)
  })
}

function collectFiles(entries: SessionEntry[], sourceDirectory: string, zip: JSZip, output: string, scope?: "project") {
  return Effect.gen(function* () {
    const blobs = new Set<string>()
    const locations = [
      entries.flatMap((entry) => [
        {
          scope: "session" as const,
          sessionID: entry.info.id,
          root: path.join(sourceDirectory, sessionDirectory, entry.info.id),
        },
        {
          scope: "design-history" as const,
          sessionID: entry.info.id,
          root: path.join(sourceDirectory, sessionDirectory, "design", "history", entry.info.id),
        },
      ]),
      scope === "project" ? [{ scope: "project" as const, sessionID: entries[0].info.id, root: sourceDirectory }] : [],
    ].flat()
    const files = yield* Effect.forEach(
      locations,
      (location) =>
        Effect.promise(async () =>
          (await listFiles(location.root, location.scope === "project"))
            .filter((file) => path.resolve(file) !== output)
            .map((file) => ({ file, location })),
        ),
      { concurrency: 2 },
    )
    return yield* Effect.forEach(
      files.flat(),
      ({ file, location }) =>
        Effect.promise(async (): Promise<FileEntry> => {
          const relative = path.relative(location.root, file).replaceAll("\\", "/")
          const content = new Uint8Array(await readFile(file))
          const sha256 = digest(content)
          const blob = `blobs/${sha256}`
          if (!blobs.has(blob)) {
            zip.file(blob, content)
            blobs.add(blob)
          }
          return {
            sessionID: location.sessionID,
            scope: location.scope,
            directory: ".",
            path: relative,
            size: content.byteLength,
            sha256,
            blob,
          }
        }),
      { concurrency: 8 },
    )
  })
}

export const exportPortableSession = Effect.fn("SessionPortable.export")(function* (input: {
  sessionID: SessionID
  output: string
  scope?: "project"
}) {
  const context = yield* InstanceState.context
  const entries = yield* collectSessions(input.sessionID)
  const zip = new JSZip()
  const output = path.resolve(
    input.output.toLowerCase().endsWith(".zip") ? input.output : `${input.output.replace(/\.octosession$/i, "")}.zip`,
  )
  const manifest: Manifest = {
    format: "octo-session",
    version: bundleVersion,
    exportedAt: Date.now(),
    rootSessionID: input.sessionID,
    sourceDirectory: context.directory,
    exclusions: [
      "credentials", "permissions", "share links", "active processes", "workspace binding",
      ...(input.scope === "project" ? ["hidden workspace files", "node_modules", "symbolic links", "export target"] : []),
    ],
    sessions: entries,
    files: yield* collectFiles(entries, context.directory, zip, output, input.scope),
  }
  zip.file(manifestName, JSON.stringify(manifest, null, 2))
  const archive = yield* Effect.promise(() => zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }))
  yield* Effect.promise(() => Filesystem.write(output, archive))
  return {
    output,
    sessions: entries.length,
    files: manifest.files.length,
  }
})

export const sharePortableSession = Effect.fn("SessionPortable.share")(function* (input: {
  sessionID: SessionID
  headers?: Record<string, string | undefined>
  scope?: "project"
}) {
  const uploadURL = process.env.OCTO_SHARE_API_URL?.trim()
  const sharePageURL = process.env.OCTO_SHARE_PAGE_URL?.trim()
  const missing = [!uploadURL && "OCTO_SHARE_API_URL", !sharePageURL && "OCTO_SHARE_PAGE_URL"].filter(Boolean)
  if (missing.length) return yield* Effect.fail(new Error(`分享配置缺失：请配置环境变量 ${missing.join("、")}`))
  if (![uploadURL, sharePageURL].every((value) => value && URL.canParse(value) && ["http:", "https:"].includes(new URL(value).protocol))) {
    return yield* Effect.fail(new Error("分享配置错误：OCTO_SHARE_API_URL 和 OCTO_SHARE_PAGE_URL 必须是有效的 HTTP(S) 地址"))
  }
  const sessions = yield* Session.Service
  const info = yield* sessions.get(input.sessionID)
  const output = path.join(tmpdir(), `octo-session-${randomUUID()}.zip`)

  return yield* Effect.gen(function* () {
    const exported = yield* exportPortableSession({ sessionID: input.sessionID, output, scope: input.scope })
    const result = yield* Effect.tryPromise({
      try: async () => {
        const token = Object.entries(input.headers ?? {}).find(([name]) => name.toLowerCase() === "uiplustoken")?.[1]
        const cookie = Object.entries(input.headers ?? {}).find(([name]) => name.toLowerCase() === "x-opencode-share-cookie")?.[1]
        const headers = { ...(token ? { uiplustoken: token } : {}), ...(cookie ? { Cookie: cookie } : {}) }
        const form = new FormData()
        form.append(
          "file",
          new Blob([new Uint8Array(await readFile(exported.output))], { type: "application/zip" }),
          `${(info.title || "session").replace(/[<>:"/\\|?*]/g, "-").trim() || "session"}.zip`,
        )
        form.append("description", info.title || "")
        console.info("[octo:share] upload request", JSON.stringify({
          sessionID: input.sessionID,
          uploadURL: `${new URL(uploadURL!).origin}${new URL(uploadURL!).pathname}`,
          method: "POST",
          fields: ["file", "description"],
          authHeaders: Object.keys(headers ?? {}),
          tokenSuffix: token ? token.slice(-6) : null,
        }))
        const response = await fetch(uploadURL!, {
          method: "POST",
          headers,
          body: form,
        })
        const body = await response.text()
        const payload: unknown = await Promise.resolve().then(() => JSON.parse(body)).catch(() => undefined)
        console.info("[octo:share] upload response", JSON.stringify({
          sessionID: input.sessionID,
          status: response.status,
          redirected: response.redirected,
          contentType: response.headers.get("content-type"),
          bodyLength: body.length,
          body: payload === undefined ? "[非 JSON 响应]" : JSON.stringify(payload, (key, value) =>
            /token|cookie|authorization|password|secret|accesskey/i.test(key) ? "[REDACTED]" : value,
          ).slice(0, 8192),
        }))
        if (!response.ok) throw new Error(`Share upload failed: ${response.status}`)
        if (payload === undefined) throw new Error("分享上传接口未返回有效 JSON，请检查接口地址及登录状态")
        if (payload && typeof payload === "object" && "success" in payload && payload.success === false) {
          const message = "errorMessage" in payload && typeof payload.errorMessage === "string" ? payload.errorMessage : "未知错误"
          throw new Error(message.toLowerCase() === "unlogin" ? "登录已失效或未登录，请重新登录后分享（unLogin）" : `分享上传失败：${message}`)
        }
        return Schema.decodeUnknownSync(ShareUploadResponse)(payload)
      },
      catch: (cause) => {
        const error = cause instanceof Error ? cause : new Error(String(cause))
        console.error("[octo:share] upload failed", JSON.stringify({ sessionID: input.sessionID, message: error.message }))
        return error
      },
    })
    if (!result.success || !result.content.uniqueId) throw new Error("Share upload did not return a uniqueId")
    return {
      uniqueId: result.content.uniqueId,
      url: (() => {
        const url = new URL(sharePageURL!)
        url.searchParams.set("uniqueId", result.content.uniqueId)
        return url.toString()
      })(),
    }
  }).pipe(Effect.ensuring(Effect.promise(() => rm(output, { force: true }))))
})

type ReferencePaths = {
  sourceDirectory: string
  targetDirectory: string
  sessionIDs: Map<string, SessionID>
  relocate?: (value: string, rewrite: (value: string) => string) => string
}

function rewritePath(
  value: string,
  input: ReferencePaths,
) {
  const fileUrl = value.startsWith("file://")
  const normalize = (input: string) => {
    const normalized = input.replaceAll("\\", "/")
    return normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized
  }
  const raw = fileUrl
    ? normalize(
        (() => {
          const url = new URL(value)
          const pathname = decodeURIComponent(url.pathname)
          const withHost = url.hostname ? `//${url.hostname}${pathname}` : pathname
          return /^\/[A-Za-z]:\//.test(withHost) ? withHost.slice(1) : withHost
        })(),
      )
    : normalize(value)
  const source = normalize(input.sourceDirectory)
  const inside = (target: string) => raw === target || raw.startsWith(`${target}/`)
  const session = [...input.sessionIDs]
    .flatMap(([oldID, newID]) => [
      { newID, root: `${source}/${sessionDirectory}/${oldID}`, target: `${sessionDirectory}/${newID}` },
      {
        newID,
        root: `${source}/${sessionDirectory}/design/history/${oldID}`,
        target: `${sessionDirectory}/design/history/${newID}`,
      },
    ])
    .find((candidate) => inside(candidate.root))
  const relative = session
    ? `${session.target}${raw.slice(session.root.length)}`
    : inside(source)
      ? raw.slice(source.length).replace(/^\/+/, "")
      : undefined
  if (relative === undefined) return value
  const rewritten = relative
    ? path.join(input.targetDirectory, ...relative.split("/").filter(Boolean))
    : input.targetDirectory
  return fileUrl ? pathToFileURL(rewritten).href : rewritten
}

function rewriteFilePart(
  part: MessageV2.FilePart,
  input: ReferencePaths,
) {
  return {
    ...part,
    url: input.relocate ? input.relocate(part.url, (value) => rewritePath(value, input)) : rewritePath(part.url, input),
    source:
      part.source?.type === "file" || part.source?.type === "symbol"
        ? { ...part.source, path: input.relocate ? input.relocate(part.source.path, (value) => rewritePath(value, input)) : rewritePath(part.source.path, input) }
        : part.source,
  }
}

function rewriteReferences(
  value: unknown,
  input: ReferencePaths,
): unknown {
  if (typeof value === "string") {
    const rewrite = (value: string) => {
      const sessions = [...input.sessionIDs].reduce(
        (result, [oldID, newID]) => result.replaceAll(oldID, newID),
        value,
      )
      const sources = [
        input.sourceDirectory,
        input.sourceDirectory.replaceAll("\\", "/"),
        input.sourceDirectory.replaceAll("/", "\\"),
      ].filter((source, index, values) => source && values.indexOf(source) === index)
      const rewritten = sources.reduce((result, source) => result.replaceAll(source, input.targetDirectory), sessions)
      return sources.some((source) => value.includes(source)) ? rewritten.replaceAll("\\", "/") : rewritten
    }
    return input.relocate ? input.relocate(value, rewrite) : rewrite(value)
  }
  if (Array.isArray(value)) return value.map((entry) => rewriteReferences(entry, input))
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, rewriteReferences(entry, input)]))
}

function rewritePartReferences(
  part: MessageV2.Part,
  input: ReferencePaths,
) {
  return rewriteReferences(part, input) as MessageV2.Part
}

export function remapPart(
  part: MessageV2.Part,
  input: {
    sessionID: SessionID
    messageID: MessageID
    partID: PartID
    messageIDs: Map<string, MessageID>
    sessionIDs: Map<string, SessionID>
    sourceDirectory: string
    targetDirectory: string
    relocate?: ReferencePaths["relocate"]
  },
): MessageV2.Part {
  const base = {
    ...part,
    id: input.partID,
    sessionID: input.sessionID,
    messageID: input.messageID,
  }
  const paths = {
    sourceDirectory: input.sourceDirectory,
    targetDirectory: input.targetDirectory,
    sessionIDs: input.sessionIDs,
    relocate: input.relocate,
  }
  if (base.type === "file") return rewritePartReferences(rewriteFilePart(base, paths), paths)
  if (base.type === "compaction" && base.tail_start_id) {
    return rewritePartReferences({ ...base, tail_start_id: input.messageIDs.get(base.tail_start_id) }, paths)
  }
  if (base.type === "tool" && base.state.status === "completed" && base.state.attachments) {
    return rewritePartReferences(
      {
        ...base,
        state: {
          ...base.state,
          attachments: base.state.attachments.map((attachment) =>
            rewriteFilePart(
              {
                ...attachment,
                id: PartID.ascending(),
                sessionID: input.sessionID,
                messageID: input.messageID,
              },
              paths,
            ),
          ),
        },
      },
      paths,
    )
  }
  return rewritePartReferences(base, paths)
}

function validateManifest(manifest: Manifest, zip: JSZip) {
  const ids = new Set(manifest.sessions.map((entry) => entry.info.id))
  if (!ids.has(manifest.rootSessionID)) throw new Error("Portable session root is missing")
  if (ids.size !== manifest.sessions.length) throw new Error("Portable session contains duplicate session IDs")
  for (const entry of manifest.sessions) {
    if (entry.info.parentID && !ids.has(entry.info.parentID))
      throw new Error("Portable session contains an unknown parent")
  }
  for (const file of manifest.files) {
    if (!ids.has(file.sessionID)) throw new Error("Portable session file references an unknown session")
    if (!isPortablePath(file.directory) || !isPortablePath(file.path) || !isPortablePath(file.blob))
      throw new Error("Portable session contains an unsafe path")
    if (
      file.scope === "project" &&
      !isProjectFile(
        `${file.directory}/${file.path}`
          .replaceAll("\\", "/")
          .split("/")
          .filter((part) => part !== ".")
          .join("/"),
      )
    )
      throw new Error("Portable session contains an unsafe shared file path")
    if (!zip.file(file.blob)) throw new Error(`Portable session is missing ${file.blob}`)
  }
}

function readBundle(file: string) {
  return Effect.promise(async () => {
    const zip = await JSZip.loadAsync(await readFile(file))
    const manifestFile = zip.file(manifestName)
    if (!manifestFile) throw new Error("Portable session manifest is missing")
    const manifest = decodeManifest(JSON.parse(await manifestFile.async("string")))
    validateManifest(manifest, zip)
    const blobs = new Map<string, Uint8Array>()
    for (const entry of manifest.files) {
      if (blobs.has(entry.blob)) continue
      const content = await zip.file(entry.blob)!.async("uint8array")
      if (content.byteLength !== entry.size || digest(content) !== entry.sha256) {
        throw new Error(`Portable session file failed validation: ${entry.path}`)
      }
      blobs.set(entry.blob, content)
    }
    return { manifest, blobs }
  })
}

function orderedEntries(manifest: Manifest) {
  const byID = new Map(manifest.sessions.map((entry) => [entry.info.id, entry]))
  const ordered: SessionEntry[] = []
  const visit = (id: SessionID) => {
    const entry = byID.get(id)
    if (!entry) return
    ordered.push(entry)
    manifest.sessions
      .filter((candidate) => candidate.info.parentID === id)
      .forEach((candidate) => visit(candidate.info.id))
  }
  visit(manifest.rootSessionID)
  if (ordered.length !== manifest.sessions.length) throw new Error("Portable session contains a disconnected session")
  return ordered
}

async function sharedFileTarget(directory: string, file: FileEntry) {
  const segments = `${file.directory}/${file.path}`
    .replaceAll("\\", "/")
    .split("/")
    .filter((part) => part !== ".")
  for (const [index] of segments.entries()) {
    const target = path.join(directory, ...segments.slice(0, index + 1))
    const stat = await lstat(target).catch((error) => {
      if (error.code === "ENOENT") return
      throw error
    })
    if (!stat) continue
    if (stat.isSymbolicLink()) throw new Error(`共享文件路径包含符号链接，无法导入：${file.path}`)
    if (index < segments.length - 1 && !stat.isDirectory()) throw new Error(`共享文件目录冲突：${file.path}`)
    if (index === segments.length - 1 && (!stat.isFile() || digest(await readFile(target)) !== file.sha256)) {
      throw new Error(`共享文件已存在且内容不同，请更换导入目录：${file.path}`)
    }
  }
  return path.join(directory, ...segments)
}

function importFiles(manifest: Manifest, scope?: "project" | "session") {
  if (scope === "session" && manifest.files.some((file) => file.scope === "project")) {
    const attachments = new Set(manifest.sessions.flatMap((session) => session.messages.filter((message) => message.info.role === "user").flatMap((message) =>
      message.parts.flatMap((part) => {
        // Non-image uploads are recorded as a synthetic manifest, not FileParts.
        if (part.type === "text" && part.synthetic && /^\[附件\]\r?\n/.test(part.text)) {
          return part.text.split(/\r?\n/).flatMap((line) => {
            const match = /^- .+?: (.+)$/.exec(line)
            return match ? [match[1]] : []
          })
        }
        const files = part.type === "file" ? [part] : []
        return files.flatMap((file) => [
          file.url,
          ...(file.source?.type === "file" || file.source?.type === "symbol" ? [file.source.path] : []),
        ])
      }),
    )).map((value) => {
      if (!value.startsWith("file://")) return value.replaceAll("\\", "/")
      const url = new URL(value)
      const decoded = decodeURIComponent(url.pathname)
      return url.hostname ? `//${url.hostname}${decoded}` : decoded.replace(/^\/([A-Za-z]:\/)/, "$1")
    }))
    const files = new Map<string, FileEntry>()
    const paths = new Map<string, FileEntry>()
    const add = (file: FileEntry) => {
      const key = `${file.scope ?? "session"}/${file.sessionID}/${path.posix.normalize(`${file.directory}/${file.path}`.replaceAll("\\", "/"))}`
      const existing = files.get(key)
      if (existing && existing.sha256 !== file.sha256) throw new Error(`私有文件同名且内容不同，无法导入：${file.path}`)
      if (!existing) files.set(key, file)
    }
    manifest.files.filter((file) => file.scope !== "project").forEach(add)
    for (const file of manifest.files.filter((file) => file.scope === "project")) {
      const relative = path.posix.normalize(`${file.directory}/${file.path}`.replaceAll("\\", "/"))
      const source = `${manifest.sourceDirectory.replaceAll("\\", "/").replace(/\/+$/, "")}/${relative}`
      const entry = { ...file, scope: "session" as const, directory: ".", path: `outputs/${relative}` }
      // Keep the complete shared tree together so relative HTML/CSS/image dependencies still resolve.
      add(entry)
      const upload = attachments.has(source)
      const target = upload ? { ...entry, path: `uploads/${relative}` } : entry
      if (upload) add(target)
      paths.set(relative, target)
    }
    return { files: [...files.values()], paths }
  }
  if (scope !== "project") return { files: manifest.files, paths: new Map<string, FileEntry>() }
  const shared = new Map(
    manifest.files.filter((file) => file.scope === "project")
      .map((file) => [path.posix.normalize(`${file.directory}/${file.path}`.replaceAll("\\", "/")), file]),
  )
  const files = [...manifest.files]
  for (const file of manifest.files) {
    if (file.scope && file.scope !== "session") continue
    const relative = path.posix.normalize(`${file.directory}/${file.path}`.replaceAll("\\", "/"))
    if (!/^(uploads|outputs)\//.test(relative)) continue
    const target = relative.replace(/^(uploads|outputs)\//, "")
    if (!isProjectFile(target)) continue
    const existing = shared.get(target)
    if (existing) {
      if (existing.sha256 !== file.sha256) throw new Error(`共享文件同名且内容不同，无法导入：${target}`)
      continue
    }
    // Keep the private copy and its chat references; expose an additional shared copy.
    const entry = { ...file, scope: "project" as const, directory: ".", path: target }
    shared.set(target, entry)
    files.push(entry)
  }
  return { files, paths: new Map<string, FileEntry>() }
}

export const importPortableSession = Effect.fn("SessionPortable.import")(function* (file: string, scope?: "project" | "session") {
  const context = yield* InstanceState.context
  const sessions = yield* Session.Service
  const todos = yield* Todo.Service
  const bundle = yield* readBundle(path.resolve(file))
  const plan = importFiles(bundle.manifest, scope)
  const files = plan.files
  const sessionIDs = new Map<string, SessionID>()
  const created: SessionID[] = []
  const sharedFiles: string[] = []

  const importEffect = Effect.gen(function* () {
    // Fail before creating sessions or writing files when a shared path conflicts.
    yield* Effect.forEach(
      files.filter((file) => file.scope === "project"),
      (file) => Effect.promise(() => sharedFileTarget(context.directory, file)),
      { concurrency: 8 },
    )
    for (const entry of orderedEntries(bundle.manifest)) {
      const parentID = entry.info.parentID ? sessionIDs.get(entry.info.parentID) : undefined
      const session = yield* sessions.create({
        parentID,
        title: entry.info.title,
        agent: entry.info.agent,
        model: entry.info.model,
      })
      sessionIDs.set(entry.info.id, session.id)
      created.push(session.id)
    }

    // Protect relocated references from generic prefix rewriting, including same-directory imports.
    const paths = new Map([...plan.paths].flatMap(([relative, entry]) => {
      const source = `${bundle.manifest.sourceDirectory.replaceAll("\\", "/").replace(/\/+$/, "")}/${relative}`
      const url = new URL(source.startsWith("//") ? `file://${source.slice(2).split("/")[0]}/` : "file:///")
      url.pathname = source.startsWith("//") ? source.slice(source.indexOf("/", 2)) : source.startsWith("/") ? source : `/${source}`
      const target = path.join(context.directory, sessionDirectory, sessionIDs.get(entry.sessionID)!, entry.directory, entry.path)
      return [
        [source.replaceAll("\\", "/"), target.replaceAll("\\", "/")] as const,
        [source.replaceAll("/", "\\"), target.replaceAll("\\", "/")] as const,
        [url.href, pathToFileURL(target).href] as const,
        [target, target] as const,
        [target.replaceAll("\\", "/"), target.replaceAll("\\", "/")] as const,
        [pathToFileURL(target).href, pathToFileURL(target).href] as const,
      ]
    }))
    const pattern = paths.size
      ? new RegExp("(" + [...paths.keys()].sort((a, b) => b.length - a.length)
        .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")(?=$|[\\s\"'`<>\\[\\](){}?,;:!#，。；：！？]|\\.(?=\\s|$))", "g")
      : undefined
    const relocate: ReferencePaths["relocate"] = pattern
      ? (value, rewrite) => value.split(pattern).map((part, index) => index % 2 ? paths.get(part)! : rewrite(part)).join("")
      : undefined

    for (const entry of orderedEntries(bundle.manifest)) {
      const sessionID = sessionIDs.get(entry.info.id)!
      if (entry.info.summary) {
        yield* sessions.setSummary({
          sessionID,
          summary: {
            ...entry.info.summary,
            ...(entry.info.summary.diffs ? { diffs: [...entry.info.summary.diffs] } : {}),
          },
        })
      }
      if (entry.info.time.archived) yield* sessions.setArchived({ sessionID, time: entry.info.time.archived })
      yield* sessions.setSortOrder({ sessionID, sortOrder: entry.info.sort_order })
      if (entry.info.pinned) yield* sessions.setPinned({ sessionID, pinned: true })
      if (entry.todos.length) yield* todos.update({ sessionID, todos: [...entry.todos] })

      const messageIDs = new Map(entry.messages.map((message) => [message.info.id, MessageID.ascending()]))
      for (const message of entry.messages) {
        const messageID = messageIDs.get(message.info.id)!
        const info: MessageV2.Info =
          message.info.role === "assistant"
            ? {
                ...message.info,
                id: messageID,
                sessionID,
                parentID: messageIDs.get(message.info.parentID)!,
                path: { cwd: context.directory, root: context.worktree },
              }
            : { ...message.info, id: messageID, sessionID }
        yield* sessions.updateMessage(info)
        for (const part of message.parts) {
          yield* sessions.updatePart(
            remapPart(part, {
              sessionID,
              messageID,
              partID: PartID.ascending(),
              messageIDs,
              sessionIDs,
              sourceDirectory: bundle.manifest.sourceDirectory,
              targetDirectory: context.directory,
              relocate,
            }),
          )
        }
      }
    }

    for (const fileEntry of files) {
      if (fileEntry.scope === "project") {
        yield* Effect.promise(async () => {
          const target = await sharedFileTarget(context.directory, fileEntry)
          await mkdir(path.dirname(target), { recursive: true })
          await writeFile(target, bundle.blobs.get(fileEntry.blob)!, { flag: "wx" }).then(
            () => {
              sharedFiles.push(target)
            },
            async (error) => {
              if (error.code !== "EEXIST") throw error
              await sharedFileTarget(context.directory, fileEntry)
            },
          )
        })
        continue
      }
      const sessionID = sessionIDs.get(fileEntry.sessionID)!
      const target =
        fileEntry.scope === "design-history"
          ? path.join(
              context.directory,
              sessionDirectory,
              "design",
              "history",
              sessionID,
              fileEntry.directory,
              fileEntry.path,
            )
          : path.join(context.directory, sessionDirectory, sessionID, fileEntry.directory, fileEntry.path)
      yield* Effect.promise(() => Filesystem.write(target, bundle.blobs.get(fileEntry.blob)!))
    }

    return {
      sessionID: sessionIDs.get(bundle.manifest.rootSessionID)!,
      sessions: sessionIDs.size,
      files: files.length,
    }
  })

  return yield* importEffect.pipe(
    Effect.onError(() =>
      Effect.all(created.slice(0, 1).map((id) => sessions.remove(id).pipe(Effect.ignore))).pipe(
        Effect.andThen(
          Effect.promise(() =>
            Promise.all([
              ...sharedFiles.map((file) => rm(file, { force: true })),
              ...created.map((id) =>
                rm(path.join(context.directory, sessionDirectory, id), { recursive: true, force: true }),
              ),
            ]),
          ).pipe(Effect.ignore),
        ),
      ),
    ),
  )
})

export async function isPortableSessionFile(file: string) {
  if (file.toLowerCase().endsWith(".octosession")) return true
  const header = (await readFile(file)).subarray(0, 4).toString("hex")
  return header === "504b0304"
}
