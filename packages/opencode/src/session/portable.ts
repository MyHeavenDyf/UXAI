import { createHash } from "node:crypto"
import { readFile, readdir, rm } from "node:fs/promises"
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

const FileEntry = Schema.Struct({
  sessionID: SessionID,
  scope: Schema.optional(Schema.Union([Schema.Literal("session"), Schema.Literal("design-history")])),
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
  scope?: "session" | "design-history"
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
  if (!value || path.isAbsolute(value)) return false
  const normalized = value.replaceAll("\\", "/")
  return normalized !== ".." && !normalized.startsWith("../") && !normalized.includes("/../")
}

function digest(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex")
}

async function listFiles(root: string) {
  const found: string[] = []
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
    await Promise.all(
      entries.map(async (entry) => {
        const target = path.join(directory, entry.name)
        if (entry.isDirectory()) return visit(target)
        if (entry.isFile()) found.push(target)
      }),
    )
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

function collectFiles(entries: SessionEntry[], sourceDirectory: string, zip: JSZip) {
  return Effect.promise(async () => {
    const blobs = new Set<string>()
    const files = (
      await Promise.all(
        entries.flatMap((entry) =>
          [
            {
              scope: "session" as const,
              root: path.join(sourceDirectory, sessionDirectory, entry.info.id),
            },
            {
              scope: "design-history" as const,
              root: path.join(sourceDirectory, sessionDirectory, "design", "history", entry.info.id),
            },
          ].map(async (location) =>
            Promise.all(
              (await listFiles(location.root)).map(async (file): Promise<FileEntry> => {
                const relative = path.relative(location.root, file).replaceAll("\\", "/")
                const content = new Uint8Array(await readFile(file))
                const sha256 = digest(content)
                const blob = `blobs/${sha256}`
                if (!blobs.has(blob)) {
                  zip.file(blob, content)
                  blobs.add(blob)
                }
                return {
                  sessionID: entry.info.id,
                  scope: location.scope,
                  directory: ".",
                  path: relative,
                  size: content.byteLength,
                  sha256,
                  blob,
                }
              }),
            ),
          ),
        ),
      )
    ).flat(2)
    return files
  })
}

export const exportPortableSession = Effect.fn("SessionPortable.export")(function* (input: {
  sessionID: SessionID
  output: string
}) {
  const context = yield* InstanceState.context
  const entries = yield* collectSessions(input.sessionID)
  const zip = new JSZip()
  const manifest: Manifest = {
    format: "octo-session",
    version: bundleVersion,
    exportedAt: Date.now(),
    rootSessionID: input.sessionID,
    sourceDirectory: context.directory,
    exclusions: ["credentials", "permissions", "share links", "active processes", "workspace binding"],
    sessions: entries,
    files: yield* collectFiles(entries, context.directory, zip),
  }
  zip.file(manifestName, JSON.stringify(manifest, null, 2))
  const archive = yield* Effect.promise(() => zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }))
  const output = path.resolve(
    input.output.toLowerCase().endsWith(".octosession") ? input.output : `${input.output}.octosession`,
  )
  yield* Effect.promise(() => Filesystem.write(output, archive))
  return {
    output,
    sessions: entries.length,
    files: manifest.files.length,
  }
})

function rewritePath(
  value: string,
  input: { sourceDirectory: string; targetDirectory: string; sessionIDs: Map<string, SessionID> },
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
  input: { sourceDirectory: string; targetDirectory: string; sessionIDs: Map<string, SessionID> },
) {
  return {
    ...part,
    url: rewritePath(part.url, input),
    source:
      part.source?.type === "file" || part.source?.type === "symbol"
        ? { ...part.source, path: rewritePath(part.source.path, input) }
        : part.source,
  }
}

function rewriteReferences(
  value: unknown,
  input: { sourceDirectory: string; targetDirectory: string; sessionIDs: Map<string, SessionID> },
): unknown {
  if (typeof value === "string") {
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
  if (Array.isArray(value)) return value.map((entry) => rewriteReferences(entry, input))
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, rewriteReferences(entry, input)]))
}

function rewritePartReferences(
  part: MessageV2.Part,
  input: { sourceDirectory: string; targetDirectory: string; sessionIDs: Map<string, SessionID> },
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

export const importPortableSession = Effect.fn("SessionPortable.import")(function* (file: string) {
  const context = yield* InstanceState.context
  const sessions = yield* Session.Service
  const todos = yield* Todo.Service
  const bundle = yield* readBundle(path.resolve(file))
  const sessionIDs = new Map<string, SessionID>()
  const created: SessionID[] = []

  const importEffect = Effect.gen(function* () {
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
            }),
          )
        }
      }
    }

    for (const fileEntry of bundle.manifest.files) {
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
      files: bundle.manifest.files.length,
    }
  })

  return yield* importEffect.pipe(
    Effect.onError(() =>
      Effect.all(created.slice(0, 1).map((id) => sessions.remove(id).pipe(Effect.ignore))).pipe(
        Effect.andThen(
          Effect.promise(() =>
            Promise.all(
              created.map((id) =>
                rm(path.join(context.directory, sessionDirectory, id), { recursive: true, force: true }),
              ),
            ),
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
