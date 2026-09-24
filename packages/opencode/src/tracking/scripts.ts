import { Effect, Semaphore } from "effect"
import path from "node:path"
import { open, realpath, stat } from "node:fs/promises"
import { createHash } from "node:crypto"

const MAX_FILES = 32
const MAX_BYTES = 64 * 1024 * 1024
const MAX_TOTAL = 256 * 1024 * 1024
const locks = new Map<string, { semaphore: Semaphore.Semaphore; users: number }>()

function key(file: string) {
  return process.platform === "win32" ? path.resolve(file).toLowerCase() : path.resolve(file)
}

function inside(root: string, file: string) {
  const relative = path.relative(key(root), key(file))
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

// Resolve aliases even for a target that does not exist yet.
async function canonical(file: string): Promise<string> {
  return realpath(file).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT" || path.dirname(file) === file) throw error
    return path.join(await canonical(path.dirname(file)), path.basename(file))
  })
}

// Shared by enrolled write/edit and declared Shell calls. Sorted acquisition avoids
// deadlocks for overlapping multi-file commands; interrupted waiters release refs.
export function withFiles<A, E, R>(files: readonly string[], effect: Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const names = yield* Effect.promise(async () =>
      [
        ...new Set(
          await Promise.all(files.map(async (file) => key(await canonical(path.resolve(file)).catch(() => file)))),
        ),
      ].sort(),
    )
    return yield* Effect.acquireUseRelease(
      Effect.sync(() =>
        names.map((name) => {
          const lock = locks.get(name) ?? { semaphore: Semaphore.makeUnsafe(1), users: 0 }
          lock.users++
          locks.set(name, lock)
          return { name, lock }
        }),
      ),
      (entries) => entries.reduceRight((next, entry) => entry.lock.semaphore.withPermits(1)(next), effect),
      (entries) =>
        Effect.sync(() =>
          entries.forEach(({ name, lock }) => {
            if (--lock.users === 0) locks.delete(name)
          }),
        ),
    )
  })
}

type Snapshot =
  | { kind: "missing" }
  | { kind: "file"; hash: string; size: number }
  | { kind: "unverified"; reason: string }

export type ScriptFacts = {
  version: 1
  reason: string
  files: { path: string; before?: Snapshot; after?: Snapshot; operation?: "write" | "edit"; reason: string }[]
}

async function snapshot(file: string, roots: string[], budget: { bytes: number }): Promise<Snapshot> {
  try {
    if (!roots.some((root) => inside(root, file))) return { kind: "unverified", reason: "outside-session-files" }
    const resolved = await canonical(file)
    if (!roots.some((root) => inside(root, resolved)))
      return { kind: "unverified", reason: "symlink-outside-session-files" }
    const info = await stat(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined
      throw error
    })
    if (!info) return { kind: "missing" }
    if (!info.isFile()) return { kind: "unverified", reason: "not-regular-file" }
    if (info.size > MAX_BYTES || budget.bytes + info.size > MAX_TOTAL)
      return { kind: "unverified", reason: "size-limit" }
    budget.bytes += info.size
    const handle = await open(file, "r")
    try {
      const before = await handle.stat()
      if (
        !before.isFile() ||
        before.size > MAX_BYTES ||
        before.ino !== info.ino ||
        before.dev !== info.dev ||
        before.size !== info.size ||
        before.mtimeMs !== info.mtimeMs ||
        before.ctimeMs !== info.ctimeMs
      )
        return { kind: "unverified", reason: "file-changed-during-check" }
      const stream = handle.createReadStream({ autoClose: false })
      const timer = setTimeout(() => stream.destroy(new Error("hash-timeout")), 5000)
      const digest = createHash("sha256")
      let bytes = 0
      try {
        for await (const chunk of stream) {
          bytes += chunk.length
          if (bytes > MAX_BYTES) return { kind: "unverified", reason: "size-limit" }
          digest.update(chunk)
        }
      } finally {
        clearTimeout(timer)
        stream.destroy()
      }
      const after = await stat(file)
      if (
        before.ino !== after.ino ||
        before.dev !== after.dev ||
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs ||
        bytes !== after.size ||
        key(await canonical(file)) !== key(resolved)
      )
        return { kind: "unverified", reason: "file-changed-during-check" }
      return { kind: "file", hash: digest.digest("hex"), size: bytes }
    } finally {
      await handle.close()
    }
  } catch (error) {
    return {
      kind: "unverified",
      reason: error instanceof Error && error.message === "hash-timeout" ? "hash-timeout" : "file-check-failed",
    }
  }
}

export function observe<A extends { metadata: { exit: number | null } }, E, R>(
  input: { directory: string; sessionID: string; files: readonly string[]; abort: AbortSignal },
  command: Effect.Effect<A, E, R>,
) {
  return Effect.gen(function* () {
    const files = [...new Set(input.files.map((file) => key(file)))]
    const reason = !files.length ? "script-no-targets" : files.length > MAX_FILES ? "script-target-limit" : ""
    if (reason) {
      const result = yield* command
      return {
        ...result,
        metadata: { ...result.metadata, artifactScript: { version: 1, reason, files: [] } satisfies ScriptFacts },
      }
    }
    return yield* withFiles(
      files,
      Effect.gen(function* () {
        if (input.abort.aborted) return yield* Effect.interrupt
        const directory = yield* Effect.promise(() =>
          canonical(path.resolve(input.directory)).catch(() => path.resolve(input.directory)),
        )
        const roots = ["uploads", "outputs"].map((name) => path.join(directory, ".octo", input.sessionID, name))
        const beforeBudget = { bytes: 0 }
        const before = yield* Effect.promise(async () => {
          const values: Snapshot[] = []
          for (const file of files) values.push(await snapshot(file, roots, beforeBudget))
          return values
        })
        if (input.abort.aborted) return yield* Effect.interrupt
        const result = yield* command
        const budget = { bytes: 0 }
        const facts: ScriptFacts = { version: 1, reason: "script-no-change", files: [] }
        for (const [index, file] of files.entries()) {
          if (result.metadata.exit !== 0 || input.abort.aborted) {
            facts.files.push({ path: file, before: before[index], reason: "script-not-successful" })
            continue
          }
          if (before[index].kind === "unverified") {
            facts.files.push({ path: file, before: before[index], reason: "before-unverified" })
            continue
          }
          const after = yield* Effect.promise(() => snapshot(file, roots, budget))
          const previous = before[index]
          const operation =
            after.kind !== "file"
              ? undefined
              : previous.kind === "missing"
                ? "write"
                : previous.kind === "file" && previous.hash !== after.hash
                  ? "edit"
                  : undefined
          facts.files.push({
            path: file,
            before: previous,
            after,
            operation,
            reason: operation
              ? "verified-change"
              : after.kind === "unverified"
                ? after.reason
                : after.kind === "missing"
                  ? "target-missing"
                  : "unchanged",
          })
        }
        if (input.abort.aborted)
          facts.files = facts.files.map((file) => ({ ...file, operation: undefined, reason: "script-not-successful" }))
        facts.reason = facts.files.some((file) => file.operation)
          ? "script-enqueued"
          : facts.files.every((file) => file.reason === "unchanged")
            ? "script-no-change"
            : "script-unverified"
        return { ...result, metadata: { ...result.metadata, artifactScript: facts } }
      }),
    )
  })
}
