import { createHash, randomUUID } from "node:crypto"
import { lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import JSZip from "jszip"
import { Effect, Option, Schema } from "effect"
import { Global } from "@opencode-ai/core/global"
import { InstanceState } from "@/effect/instance-state"
import { Filesystem } from "@/util/filesystem"
import { NonNegativeInt } from "@/util/schema"
import { MessageV2 } from "./message-v2"
import { MessageID, PartID, SessionID } from "./schema"
import { Session } from "./session"
import { SessionStatus } from "./status"
import { Todo } from "./todo"
import { collectPortableDependencies } from "./portable-dependencies"
import { planPortablePaths, rewritePortableDocument } from "./portable-paths"
import { isExcludedPortableFile, loadPortableFileBlacklist } from "./portable-exclusions"

const bundleVersion = 1 as const
const manifestName = "manifest.json"
const sessionDirectory = ".octo"

export class PortableValidationError extends Schema.TaggedErrorClass<PortableValidationError>()(
  "PortableValidationError",
  {
    message: Schema.String,
  },
) {}

const ShareUploadResponse = Schema.Struct({
  content: Schema.Struct({
    uniqueId: Schema.String,
  }),
  success: Schema.Boolean,
})

export class PortableShareBusyError extends Schema.TaggedErrorClass<PortableShareBusyError>()(
  "PortableShareBusyError",
  { message: Schema.String },
) {}

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
  sourcePlatform: Schema.optional(Schema.Literals(["posix", "win32"])),
  pathMappings: Schema.optional(
    Schema.Array(
      Schema.Struct({
        sessionID: Schema.String,
        scope: Schema.String,
        from: Schema.String,
        to: Schema.String,
      }),
    ),
  ),
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
  sourcePlatform?: "posix" | "win32"
  pathMappings?: { sessionID: string; scope: string; from: string; to: string }[]
  exclusions: string[]
  sessions: SessionEntry[]
  files: FileEntry[]
}

export type PortableProgress = {
  type: "export" | "import" | "share"
  stage: string
  percent: number
  completed?: number
  total?: number
  processedBytes?: number
  totalBytes?: number
}

const portableProgress = new Map<string, PortableProgress>()
const portableProgressTimers = new Map<string, ReturnType<typeof setTimeout>>()

export function getPortableProgress(operationID: string) {
  return portableProgress.get(operationID)
}

function reportPortableProgress(operationID: string | undefined, progress: PortableProgress) {
  if (!operationID) return
  const value = { ...progress, percent: Math.max(0, Math.min(100, Math.round(progress.percent))) }
  const current = portableProgress.get(operationID)
  if (current && current.stage === value.stage && current.percent === value.percent) return
  portableProgress.set(operationID, value)
  const timer = portableProgressTimers.get(operationID)
  if (timer) clearTimeout(timer)
  const next = setTimeout(() => {
    portableProgress.delete(operationID)
    portableProgressTimers.delete(operationID)
  }, 10 * 60_000)
  next.unref()
  portableProgressTimers.set(operationID, next)
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
    /^[a-z]:/i.test(value) ||
    value.includes(":")
  )
    return false
  const normalized = value.replaceAll("\\", "/")
  return !normalized.split("/").includes("..")
}

function digest(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex")
}

function isProjectFile(value: string, legacy = false) {
  return value
    .replaceAll("\\", "/")
    .split("/")
    .every((part) => part && !(legacy ? /\0/ : /[\0:]/).test(part) && !part.startsWith(".") && part !== "node_modules")
}

async function listFiles(root: string, project = false, blacklist: readonly string[] = []) {
  const found: string[] = []
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (project && !isProjectFile(entry.name, true)) continue
      const target = path.join(directory, entry.name)
      if (isExcludedPortableFile(target, blacklist)) continue
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

function collectFiles(
  entries: SessionEntry[],
  sourceDirectory: string,
  zip: JSZip,
  output: string,
  scope?: "project",
  blacklist: readonly string[] = [],
  progress?: (value: PortableProgress) => void,
) {
  return Effect.gen(function* () {
    const blobs = new Set<string>()
    const global = Option.getOrElse(yield* Effect.serviceOption(Global.Service), Global.make)
    const contents = new Map<string, Promise<Uint8Array>>()
    const read = (file: string) => {
      const cached = contents.get(file)
      if (cached) return cached
      if (contents.size >= 16) contents.delete(contents.keys().next().value!)
      const content = readFile(file).then((value) => new Uint8Array(value))
      contents.set(file, content)
      return content
    }
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
        Effect.promise(async () => {
          const files = (await listFiles(location.root, location.scope === "project", blacklist)).filter(
            (file) => path.resolve(file) !== output,
          )
          const dependencies = await collectPortableDependencies({
            root: location.root,
            files,
            read,
            blacklist,
            trustedRoots: ["skill", "skills"].map((dir) =>
              path.join(global.octoConfig, dir, "ict-react-coder", "scripts", "preview", "assets"),
            ),
          })
          return [
            ...files.map((file) => ({ file, source: file })),
            ...dependencies.filter(
              ({ file }) =>
                path.resolve(file) !== output &&
                !isExcludedPortableFile(file, blacklist) &&
                (location.scope !== "project" || isProjectFile(path.relative(location.root, file), true)),
            ),
          ].map((file) => ({ ...file, location }))
        }),
      { concurrency: 2 },
    )
    const packedProgress = { completed: 0 }
    const packed = yield* Effect.forEach(
      files.flat().map((file, _index, all) => ({ ...file, total: all.length })),
      ({ file, source, location, total }) =>
        Effect.promise(async (): Promise<FileEntry | undefined> => {
          const relative = path.relative(location.root, file)
          const content = await read(source).catch((error) => {
            console.warn(
              "[octo:share] skipped file",
              JSON.stringify({
                source,
                path: relative,
                reason: "unreadable",
                error: error instanceof Error ? error.message : String(error),
              }),
            )
          })
          contents.delete(source)
          packedProgress.completed += 1
          progress?.({
            type: "export",
            stage: "正在读取文件",
            percent: 20 + (packedProgress.completed / Math.max(total, 1)) * 35,
            completed: packedProgress.completed,
            total,
          })
          if (!content) return
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
    return packed.filter((file): file is FileEntry => !!file)
  })
}

export const exportPortableSession = Effect.fn("SessionPortable.export")(function* (input: {
  sessionID: SessionID
  output: string
  scope?: "project"
  operationID?: string
  progressRange?: readonly [number, number]
  progressType?: PortableProgress["type"]
}) {
  const range = input.progressRange ?? [0, 100]
  const update = (progress: PortableProgress) =>
    reportPortableProgress(input.operationID, {
      ...progress,
      type: input.progressType ?? "export",
      percent: range[0] + (progress.percent / 100) * (range[1] - range[0]),
    })
  const context = yield* InstanceState.context
  update({ type: "export", stage: "正在整理聊天记录", percent: 1 })
  const entries = yield* collectSessions(input.sessionID)
  update({ type: "export", stage: "正在扫描文件", percent: 8, completed: 0 })
  const zip = new JSZip()
  const output = path.resolve(
    input.output.toLowerCase().endsWith(".zip") ? input.output : `${input.output.replace(/\.octosession$/i, "")}.zip`,
  )
  // Snapshot once per export: scanning, dependency collection and the manifest use the same rules.
  const blacklist = yield* Effect.promise(() => loadPortableFileBlacklist())
  const manifest: Manifest = {
    format: "octo-session",
    version: bundleVersion,
    exportedAt: Date.now(),
    rootSessionID: input.sessionID,
    sourceDirectory: context.directory,
    sourcePlatform: process.platform === "win32" ? "win32" : "posix",
    exclusions: [
      "credentials",
      "permissions",
      "share links",
      "active processes",
      "workspace binding",
      ...blacklist.map((extension) => `*${extension} files and archive contents`),
      ...(input.scope === "project"
        ? ["hidden workspace files", "node_modules", "symbolic links", "export target"]
        : []),
    ],
    sessions: entries,
    files: yield* collectFiles(entries, context.directory, zip, output, input.scope, blacklist, update),
  }
  update({ type: "export", stage: "正在整理文件路径", percent: 56 })
  yield* Effect.tryPromise({
    try: () => normalizeBundlePaths(manifest, zip),
    catch: (error) => new PortableValidationError({ message: error instanceof Error ? error.message : String(error) }),
  })
  zip.file(manifestName, JSON.stringify(manifest, null, 2))
  const archive = yield* Effect.promise(() =>
    zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }, (metadata) =>
      update({ type: "export", stage: "正在压缩文件", percent: 58 + metadata.percent * 0.34 }),
    ),
  )
  update({ type: "export", stage: "正在保存压缩包", percent: 94, processedBytes: 0, totalBytes: archive.byteLength })
  yield* Effect.promise(() => Filesystem.write(output, archive))
  update({
    type: "export",
    stage: "导出完成",
    percent: 100,
    processedBytes: archive.byteLength,
    totalBytes: archive.byteLength,
  })
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
  operationID?: string
}) {
  const status = yield* SessionStatus.Service
  const sessions = yield* Session.Service
  const assertShareable = Effect.gen(function* () {
    if ((yield* status.get(input.sessionID)).type !== "idle") {
      return yield* new PortableShareBusyError({ message: "对话正在进行中，请等待结束后再分享" })
    }
  })
  yield* assertShareable
  const uploadURL = process.env.OCTO_SHARE_API_URL?.trim()
  const sharePageURL = process.env.OCTO_SHARE_PAGE_URL?.trim()
  const missing = [!uploadURL && "OCTO_SHARE_API_URL", !sharePageURL && "OCTO_SHARE_PAGE_URL"].filter(Boolean)
  if (missing.length) return yield* Effect.fail(new Error(`分享配置缺失：请配置环境变量 ${missing.join("、")}`))
  if (
    ![uploadURL, sharePageURL].every(
      (value) => value && URL.canParse(value) && ["http:", "https:"].includes(new URL(value).protocol),
    )
  ) {
    return yield* Effect.fail(
      new Error("分享配置错误：OCTO_SHARE_API_URL 和 OCTO_SHARE_PAGE_URL 必须是有效的 HTTP(S) 地址"),
    )
  }
  const info = yield* sessions.get(input.sessionID)
  const output = path.join(tmpdir(), `octo-session-${randomUUID()}.zip`)

  return yield* Effect.gen(function* () {
    const exported = yield* exportPortableSession({
      sessionID: input.sessionID,
      output,
      scope: input.scope,
      operationID: input.operationID,
      progressRange: [0, 72],
      progressType: "share",
    })
    yield* assertShareable
    reportPortableProgress(input.operationID, { type: "share", stage: "正在上传压缩包", percent: 75 })
    const result = yield* Effect.tryPromise({
      try: async () => {
        const token = Object.entries(input.headers ?? {}).find(([name]) => name.toLowerCase() === "uiplustoken")?.[1]
        const cookie = Object.entries(input.headers ?? {}).find(
          ([name]) => name.toLowerCase() === "x-opencode-share-cookie",
        )?.[1]
        const headers = { ...(token ? { uiplustoken: token } : {}), ...(cookie ? { Cookie: cookie } : {}) }
        const form = new FormData()
        form.append(
          "file",
          new Blob([new Uint8Array(await readFile(exported.output))], { type: "application/zip" }),
          `${(info.title || "session").replace(/[<>:"/\\|?*]/g, "-").trim() || "session"}.zip`,
        )
        form.append("description", info.title || "")
        console.info(
          "[octo:share] upload request",
          JSON.stringify({
            sessionID: input.sessionID,
            uploadURL: `${new URL(uploadURL!).origin}${new URL(uploadURL!).pathname}`,
            method: "POST",
            fields: ["file", "description"],
            authHeaders: Object.keys(headers ?? {}),
            tokenSuffix: token ? token.slice(-6) : null,
          }),
        )
        const response = await fetch(uploadURL!, {
          method: "POST",
          headers,
          body: form,
        })
        const body = await response.text()
        const payload: unknown = await Promise.resolve()
          .then(() => JSON.parse(body))
          .catch(() => undefined)
        console.info(
          "[octo:share] upload response",
          JSON.stringify({
            sessionID: input.sessionID,
            status: response.status,
            redirected: response.redirected,
            contentType: response.headers.get("content-type"),
            bodyLength: body.length,
            body:
              payload === undefined
                ? "[非 JSON 响应]"
                : JSON.stringify(payload, (key, value) =>
                    /token|cookie|authorization|password|secret|accesskey/i.test(key) ? "[REDACTED]" : value,
                  ).slice(0, 8192),
          }),
        )
        if (!response.ok) throw new Error(`Share upload failed: ${response.status}`)
        if (payload === undefined) throw new Error("分享上传接口未返回有效 JSON，请检查接口地址及登录状态")
        if (payload && typeof payload === "object" && "success" in payload && payload.success === false) {
          const message =
            "errorMessage" in payload && typeof payload.errorMessage === "string" ? payload.errorMessage : "未知错误"
          throw new Error(
            message.toLowerCase() === "unlogin"
              ? "登录已失效或未登录，请重新登录后分享（unLogin）"
              : `分享上传失败：${message}`,
          )
        }
        return Schema.decodeUnknownSync(ShareUploadResponse)(payload)
      },
      catch: (cause) => {
        const error = cause instanceof Error ? cause : new Error(String(cause))
        console.error(
          "[octo:share] upload failed",
          JSON.stringify({ sessionID: input.sessionID, message: error.message }),
        )
        return error
      },
    })
    if (!result.success || !result.content.uniqueId) throw new Error("Share upload did not return a uniqueId")
    reportPortableProgress(input.operationID, { type: "share", stage: "分享链接已生成", percent: 100 })
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

function rewritePath(value: string, input: ReferencePaths) {
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

function rewriteFilePart(part: MessageV2.FilePart, input: ReferencePaths) {
  return {
    ...part,
    url: input.relocate ? input.relocate(part.url, (value) => rewritePath(value, input)) : rewritePath(part.url, input),
    source:
      part.source?.type === "file" || part.source?.type === "symbol"
        ? {
            ...part.source,
            path: input.relocate
              ? input.relocate(part.source.path, (value) => rewritePath(value, input))
              : rewritePath(part.source.path, input),
          }
        : part.source,
  }
}

function rewriteReferences(value: unknown, input: ReferencePaths): unknown {
  if (typeof value === "string") {
    const rewrite = (value: string) => {
      const sessions = [...input.sessionIDs].reduce((result, [oldID, newID]) => result.replaceAll(oldID, newID), value)
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

function rewritePartReferences(part: MessageV2.Part, input: ReferencePaths) {
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

function validateManifest(manifest: Manifest, zip: JSZip, legacy = false) {
  const ids = new Set(manifest.sessions.map((entry) => entry.info.id))
  if (!ids.has(manifest.rootSessionID)) throw new Error("Portable session root is missing")
  if (ids.size !== manifest.sessions.length) throw new Error("Portable session contains duplicate session IDs")
  for (const entry of manifest.sessions) {
    if (entry.info.parentID && !ids.has(entry.info.parentID))
      throw new Error("Portable session contains an unknown parent")
  }
  for (const [index, file] of manifest.files.entries()) {
    if (!ids.has(file.sessionID)) throw new Error("Portable session file references an unknown session")
    for (const field of ["directory", "path", "blob"] as const) {
      if (legacy && field !== "blob") continue
      if (!isPortablePath(file[field]) || (field === "blob" && !/^blobs\/[a-f0-9]{64}$/.test(file.blob)))
        throw new Error(
          `分享包路径不兼容：files[${index}].${field}=${JSON.stringify(file[field])}，unsafe path（空值、绝对路径、越界或异常 blob）`,
        )
    }
    if (
      !legacy &&
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

async function normalizeBundlePaths(manifest: Manifest, zip: JSZip, maxLength?: number) {
  // Blob keys are always validated before accessing ZIP data; local path rules are never applied to blobs.
  validateManifest(manifest, zip, true)
  const plan = planPortablePaths({
    files: manifest.files,
    sourceDirectory: manifest.sourceDirectory,
    sourcePlatform: manifest.sourcePlatform,
    maxLength,
  })
  const files = plan.entries.map((entry) => ({ ...entry.file, directory: ".", path: entry.path }))
  if (maxLength !== undefined && files.some((file) => file.path.length > maxLength)) {
    throw new Error("目标目录过长，无法安全恢复分享文件，请选择更短的关联本地文件夹")
  }
  const rewrite = plan.rewriteText
  const references = (value: unknown): unknown => {
    if (typeof value === "string") return rewrite(value)
    if (Array.isArray(value)) return value.map(references)
    if (!value || typeof value !== "object") return value
    const result = Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, references(entry)]))
    if (
      "url" in value &&
      typeof value.url === "string" &&
      typeof result.url === "string" &&
      result.url !== value.url &&
      typeof result.filename === "string"
    ) {
      const filename = result.url.startsWith("file://") ? decodeURIComponent(new URL(result.url).pathname) : result.url
      return { ...result, filename: path.posix.basename(filename.replaceAll("\\", "/")) }
    }
    return result
  }
  // A shared blob may be used by several files. Preserve original blobs and update only changed text entries.
  for (const [index, file] of files.entries()) {
    if (!plan.changed) break
    if (!/\.(?:html?|css|[cm]?js|jsx|tsx?|json|svg|md|txt)$/i.test(file.path)) continue
    const original = await zip.file(file.blob)!.async("uint8array")
    if (original.byteLength !== file.size || digest(original) !== file.sha256)
      throw new Error(`Portable session file failed validation: ${file.path}`)
    const text = Buffer.from(original).toString("utf8")
    const rewritten = rewritePortableDocument(text, plan.entries[index].original, (value, base) =>
      plan.reference(value, index, true, base),
    )
    if (text === rewritten) continue
    const content = new TextEncoder().encode(rewritten)
    file.size = content.byteLength
    file.sha256 = digest(content)
    file.blob = `blobs/${file.sha256}`
    zip.file(file.blob, content)
  }
  manifest.files = files
  const mappings = plan.entries
    .filter((entry) => entry.path !== entry.original)
    .map((entry) => ({
      sessionID: entry.file.sessionID,
      scope: entry.file.scope ?? "session",
      from: entry.original,
      to: entry.path,
    }))
  if (mappings.length) manifest.pathMappings = [...(manifest.pathMappings ?? []), ...mappings]
  if (plan.changed)
    manifest.sessions = manifest.sessions.map((entry) => ({
      ...entry,
      messages: references(entry.messages) as MessageV2.WithParts[],
    }))
  validateManifest(manifest, zip)
}

function readBundle(file: string, maxLength?: number, progress?: (value: PortableProgress) => void) {
  return Effect.gen(function* () {
    // Keep I/O failures distinct from invalid bundle errors; only parsing/validation is a 400.
    progress?.({ type: "import", stage: "正在读取压缩包", percent: 2 })
    const archive = yield* Effect.promise(() => readFile(file))
    return yield* Effect.tryPromise({
      try: async () => {
        progress?.({
          type: "import",
          stage: "正在解析压缩包",
          percent: 8,
          processedBytes: archive.byteLength,
          totalBytes: archive.byteLength,
        })
        const zip = await JSZip.loadAsync(archive)
        const manifestFile = zip.file(manifestName)
        if (!manifestFile) throw new Error("Portable session manifest is missing")
        const manifest = decodeManifest(JSON.parse(await manifestFile.async("string")))
        await normalizeBundlePaths(manifest, zip, maxLength)
        const blobs = new Map<string, Uint8Array>()
        for (const [index, entry] of manifest.files.entries()) {
          const cached = blobs.get(entry.blob)
          const content = cached ?? (await zip.file(entry.blob)!.async("uint8array"))
          if (
            content.byteLength !== entry.size ||
            (!cached && digest(content) !== entry.sha256) ||
            entry.blob !== `blobs/${entry.sha256}`
          ) {
            throw new Error(`Portable session file failed validation: ${entry.path}`)
          }
          if (!cached) blobs.set(entry.blob, content)
          progress?.({
            type: "import",
            stage: "正在校验文件",
            percent: 12 + ((index + 1) / Math.max(manifest.files.length, 1)) * 25,
            completed: index + 1,
            total: manifest.files.length,
          })
        }
        return { manifest, blobs }
      },
      catch: (error) =>
        new PortableValidationError({ message: error instanceof Error ? error.message : String(error) }),
    })
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
  const skip = (reason: string, error?: unknown) => {
    console.warn(
      "[octo:import] skipped file",
      JSON.stringify({
        path: file.path,
        reason,
        ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}),
      }),
    )
  }
  const segments = `${file.directory}/${file.path}`
    .replaceAll("\\", "/")
    .split("/")
    .filter((part) => part !== ".")
  for (const [index] of segments.entries()) {
    const target = path.join(directory, ...segments.slice(0, index + 1))
    const result = await lstat(target).then(
      (stat) => ({ stat }),
      (error) => ({ error }),
    )
    if ("error" in result) {
      if (result.error.code === "ENOENT") continue
      skip("unreadable-target", result.error)
      return
    }
    if (result.stat.isSymbolicLink()) {
      skip("symbolic-link")
      return
    }
    if (index < segments.length - 1 && !result.stat.isDirectory()) {
      skip("directory-conflict")
      return
    }
    if (index !== segments.length - 1) continue
    if (!result.stat.isFile()) {
      skip("file-conflict")
      return
    }
    const content = await readFile(target).catch((error) => {
      skip("unreadable-target", error)
    })
    if (!content) return
    if (digest(content) !== file.sha256) {
      skip("content-conflict")
      return
    }
  }
  return path.join(directory, ...segments)
}

function importFiles(manifest: Manifest, scope?: "project" | "session") {
  if (scope === "session" && manifest.files.some((file) => file.scope === "project")) {
    const attachments = new Set(
      manifest.sessions
        .flatMap((session) =>
          session.messages
            .filter((message) => message.info.role === "user")
            .flatMap((message) =>
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
            ),
        )
        .map((value) => {
          if (!value.startsWith("file://")) return value.replaceAll("\\", "/")
          const url = new URL(value)
          const decoded = decodeURIComponent(url.pathname)
          return url.hostname ? `//${url.hostname}${decoded}` : decoded.replace(/^\/([A-Za-z]:\/)/, "$1")
        }),
    )
    const files = new Map<string, FileEntry>()
    const paths = new Map<string, FileEntry>()
    const add = (file: FileEntry) => {
      const key = `${file.scope ?? "session"}/${file.sessionID}/${path.posix.normalize(`${file.directory}/${file.path}`.replaceAll("\\", "/"))}`
      const existing = files.get(key)
      if (existing && existing.sha256 !== file.sha256) {
        console.warn(
          "[octo:import] skipped file",
          JSON.stringify({ path: file.path, reason: "private-content-conflict" }),
        )
        return
      }
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
    manifest.files
      .filter((file) => file.scope === "project")
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
      if (existing.sha256 !== file.sha256) {
        console.warn("[octo:import] skipped file", JSON.stringify({ path: target, reason: "shared-content-conflict" }))
      }
      continue
    }
    // Keep the private copy and its chat references; expose an additional shared copy.
    const entry = { ...file, scope: "project" as const, directory: ".", path: target }
    shared.set(target, entry)
    files.push(entry)
  }
  return { files, paths: new Map<string, FileEntry>() }
}

export const importPortableSession = Effect.fn("SessionPortable.import")(function* (
  file: string,
  scope?: "project" | "session",
  operationID?: string,
) {
  const update = (progress: PortableProgress) => reportPortableProgress(operationID, progress)
  const context = yield* InstanceState.context
  const sessions = yield* Session.Service
  const todos = yield* Todo.Service
  const bundle = yield* readBundle(
    path.resolve(file),
    process.platform === "win32" ? 240 - context.directory.length - 65 : undefined,
    update,
  )
  const plan = importFiles(bundle.manifest, scope)
  const files = plan.files
  const sessionIDs = new Map<string, SessionID>()
  const created: SessionID[] = []
  const sharedFiles: string[] = []

  const importEffect = Effect.gen(function* () {
    const ordered = orderedEntries(bundle.manifest)
    for (const [index, entry] of ordered.entries()) {
      const parentID = entry.info.parentID ? sessionIDs.get(entry.info.parentID) : undefined
      const session = yield* sessions.create({
        parentID,
        title: entry.info.title,
        agent: entry.info.agent,
        model: entry.info.model,
      })
      sessionIDs.set(entry.info.id, session.id)
      created.push(session.id)
      update({
        type: "import",
        stage: "正在创建对话",
        percent: 38 + ((index + 1) / Math.max(ordered.length, 1)) * 10,
        completed: index + 1,
        total: ordered.length,
      })
    }

    // Protect relocated references from generic prefix rewriting, including same-directory imports.
    const paths = new Map(
      [...plan.paths].flatMap(([relative, entry]) => {
        const source = `${bundle.manifest.sourceDirectory.replaceAll("\\", "/").replace(/\/+$/, "")}/${relative}`
        const url = new URL(source.startsWith("//") ? `file://${source.slice(2).split("/")[0]}/` : "file:///")
        url.pathname = source.startsWith("//")
          ? source.slice(source.indexOf("/", 2))
          : source.startsWith("/")
            ? source
            : `/${source}`
        const target = path.join(
          context.directory,
          sessionDirectory,
          sessionIDs.get(entry.sessionID)!,
          entry.directory,
          entry.path,
        )
        return [
          [source.replaceAll("\\", "/"), target.replaceAll("\\", "/")] as const,
          [source.replaceAll("/", "\\"), target.replaceAll("\\", "/")] as const,
          [url.href, pathToFileURL(target).href] as const,
          [target, target] as const,
          [target.replaceAll("\\", "/"), target.replaceAll("\\", "/")] as const,
          [pathToFileURL(target).href, pathToFileURL(target).href] as const,
        ]
      }),
    )
    const pattern = paths.size
      ? new RegExp(
          "(" +
            [...paths.keys()]
              .sort((a, b) => b.length - a.length)
              .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
              .join("|") +
            ")(?=$|[\\s\"'`<>\\[\\](){}?,;:!#，。；：！？]|\\.(?=\\s|$))",
          "g",
        )
      : undefined
    const relocate: ReferencePaths["relocate"] = pattern
      ? (value, rewrite) =>
          value
            .split(pattern)
            .map((part, index) => (index % 2 ? paths.get(part)! : rewrite(part)))
            .join("")
      : undefined

    const totalMessages = ordered.reduce((total, entry) => total + entry.messages.length, 0)
    let completedMessages = 0
    for (const entry of ordered) {
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
        completedMessages += 1
        update({
          type: "import",
          stage: "正在恢复聊天记录",
          percent: 48 + (completedMessages / Math.max(totalMessages, 1)) * 22,
          completed: completedMessages,
          total: totalMessages,
        })
      }
    }

    let completedBytes = 0
    const totalBytes = files.reduce((total, file) => total + file.size, 0)
    for (const [index, fileEntry] of files.entries()) {
      if (fileEntry.scope === "project") {
        yield* Effect.promise(async () => {
          const target = await sharedFileTarget(context.directory, fileEntry)
          if (!target) return
          const directory = await mkdir(path.dirname(target), { recursive: true }).then(
            () => true,
            (error) => {
              console.warn(
                "[octo:import] skipped file",
                JSON.stringify({
                  path: fileEntry.path,
                  reason: "create-directory-failed",
                  error: error instanceof Error ? error.message : String(error),
                }),
              )
              return false
            },
          )
          if (!directory) return
          await writeFile(target, bundle.blobs.get(fileEntry.blob)!, { flag: "wx" }).then(
            () => {
              sharedFiles.push(target)
            },
            async (error) => {
              if (error.code === "EEXIST") return sharedFileTarget(context.directory, fileEntry)
              console.warn(
                "[octo:import] skipped file",
                JSON.stringify({
                  path: fileEntry.path,
                  reason: "write-failed",
                  error: error instanceof Error ? error.message : String(error),
                }),
              )
            },
          )
        })
        completedBytes += fileEntry.size
        update({
          type: "import",
          stage: "正在恢复文件",
          percent: 70 + (completedBytes / Math.max(totalBytes, 1)) * 28,
          completed: index + 1,
          total: files.length,
          processedBytes: completedBytes,
          totalBytes,
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
      yield* Effect.promise(() =>
        Filesystem.write(target, bundle.blobs.get(fileEntry.blob)!).catch((error) => {
          console.warn(
            "[octo:import] skipped file",
            JSON.stringify({
              path: fileEntry.path,
              reason: "write-failed",
              error: error instanceof Error ? error.message : String(error),
            }),
          )
        }),
      )
      completedBytes += fileEntry.size
      update({
        type: "import",
        stage: "正在恢复文件",
        percent: 70 + (completedBytes / Math.max(totalBytes, 1)) * 28,
        completed: index + 1,
        total: files.length,
        processedBytes: completedBytes,
        totalBytes,
      })
    }

    update({
      type: "import",
      stage: "导入完成",
      percent: 100,
      completed: files.length,
      total: files.length,
      processedBytes: totalBytes,
      totalBytes,
    })

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
