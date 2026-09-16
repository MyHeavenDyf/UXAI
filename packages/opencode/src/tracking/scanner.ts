import path from "node:path"
import { createHash, randomUUID } from "node:crypto"
import { lstat, opendir, open, readFile } from "node:fs/promises"
import { eq, sql } from "drizzle-orm"
import { Database } from "@/storage/db"
import { ArtifactScanTable as Scans } from "./artifact.sql"
import { enqueue, readTurn, type Turn } from "./store"
import { identity, json, string, toolIs } from "./facts"
import { resolveOutputType } from "./output-type"

export const BUDGET = { files: 1000, bytes: 256 * 1024 * 1024, fileBytes: 128 * 1024 * 1024, ms: 3000 }
type Version = { digest: string; bytes: number }
export type Snapshot = {
  files: Record<string, Version>
  sources: Record<string, { digest: string; pending: boolean }>
  complete: boolean
  reason?: string
  metrics?: { bytes: number; entries: number; ms: number }
}
const SOURCE_PENDING_MS = 10 * 60 * 1000
type Baseline = { snapshot: Snapshot; operation?: string; tool?: string; observed?: Snapshot; occurredAt?: number }
let running = 0
const sessions = new Map<string, { id: string; conflicted: boolean; count: number }>()
const scans = new Map<string, Promise<Snapshot>>()

export function outputs(turn: Turn) {
  return path.join(turn.directory, ".octo", turn.root_session_id, "outputs")
}

// Deliberately enumerate these internal/temporary names; unknown extensions and dotfiles are retained.
export function excluded(name: string) {
  return (
    name === ".materialized.json" ||
    name.startsWith(".artifact-source-") ||
    name.endsWith(".crdownload") ||
    name.endsWith(".part") ||
    name.startsWith("~$")
  )
}

export function snapshot(root: string, budget = BUDGET): Promise<Snapshot> {
  const key = identity(root, root)
  const pending = scans.get(key)
  if (pending) return pending
  const next = scan(root, budget)
    .then(async (first) => {
      if (first.reason !== "file changed during scan" || !first.metrics) return first
      const remaining = {
        ...budget,
        bytes: budget.bytes - first.metrics.bytes,
        files: budget.files - first.metrics.entries,
        ms: budget.ms - first.metrics.ms,
      }
      if (remaining.bytes <= 0 || remaining.files <= 0 || remaining.ms <= 0) return first
      return scan(root, remaining) // one bounded retry, sharing the original I/O/time budget
    })
    .finally(() => scans.delete(key))
  scans.set(key, next)
  return next
}

async function scan(root: string, budget: typeof BUDGET): Promise<Snapshot> {
  const result: Snapshot = { files: {}, sources: {}, complete: false, metrics: { bytes: 0, entries: 0, ms: 0 } }
  if (running >= 2) return { ...result, reason: "global scan concurrency exceeded" }
  running++
  const started = Date.now()
  let bytes = 0
  let files = 0
  const check = () => {
    if (Date.now() - started > budget.ms || bytes > budget.bytes || files > budget.files)
      throw new Error("scan budget exceeded")
  }
  const walk = async (dir: string): Promise<void> => {
    const handle = await opendir(dir)
    for await (const entry of handle) {
      check()
      files++
      check()
      const file = path.join(dir, entry.name)
      const info = await lstat(file)
      if (info.isSymbolicLink()) continue
      if (info.isDirectory()) {
        if (!excluded(entry.name)) await walk(file)
        continue
      }
      if (!info.isFile()) continue
      if (entry.name.startsWith(".artifact-source-") && entry.name.endsWith(".json")) {
        if (info.size > 8192) throw new Error("invalid source record")
        const source = json(await readFile(file, "utf8"))
        const name = string(source.file)
        if (name && path.basename(name) === name && typeof source.digest === "string") {
          const recent = typeof source.recordedAt === "number" && Date.now() - source.recordedAt < SOURCE_PENDING_MS
          result.sources[identity(path.join(dir, name), root)] = {
            digest: source.digest,
            pending: source.pending === true && recent,
          }
        }
        continue
      }
      if (excluded(entry.name)) continue
      if (info.size > budget.fileBytes || bytes + info.size > budget.bytes) throw new Error("scan byte budget exceeded")
      const fd = await open(file, "r")
      const digest = createHash("sha256")
      const buffer = Buffer.allocUnsafe(64 * 1024)
      try {
        while (true) {
          check()
          const read = await fd.read(buffer, 0, buffer.length, null)
          if (!read.bytesRead) break
          bytes += read.bytesRead
          digest.update(buffer.subarray(0, read.bytesRead))
        }
        const after = await fd.stat()
        const current = await lstat(file)
        if (
          current.isSymbolicLink() ||
          current.ino !== info.ino ||
          after.size !== info.size ||
          after.mtimeMs !== info.mtimeMs ||
          after.ctimeMs !== info.ctimeMs
        )
          throw new Error("file changed during scan")
        result.files[identity(file, root)] = { digest: digest.digest("hex"), bytes: after.size }
      } finally {
        await fd.close()
      }
    }
  }
  try {
    // Check the owned ancestors too: outputs itself may be a junction.
    for (const dir of [path.dirname(path.dirname(root)), path.dirname(root), root]) {
      const info = await lstat(dir).catch((err: NodeJS.ErrnoException) =>
        err.code === "ENOENT" ? undefined : Promise.reject(err),
      )
      if (!info) return { ...result, complete: true }
      if (info.isSymbolicLink() || !info.isDirectory()) return { ...result, reason: "linked output root" }
    }
    await walk(root)
    check()
    if (Object.values(result.sources).some((s) => s.pending))
      return { ...result, reason: "download in progress or receipt incomplete" }
    result.complete = true
    return result
  } catch (err) {
    return { ...result, reason: err instanceof Error ? err.message : "scan failed" }
  } finally {
    Object.assign(result.metrics!, { bytes, entries: files, ms: Date.now() - started })
    running--
  }
}

function save(turn: Turn, baseline: Baseline, diagnostic?: string) {
  Database.use((db) =>
    db
      .insert(Scans)
      .values({
        message_id: turn.root_message_id,
        baseline: JSON.stringify(baseline),
        diagnostic: diagnostic ?? null,
        updated_at: Date.now(),
      })
      .onConflictDoUpdate({
        target: Scans.message_id,
        set: { baseline: JSON.stringify(baseline), diagnostic: diagnostic ?? null, updated_at: Date.now() },
      })
      .run(),
  )
}

export async function before(turn: Turn | undefined, tool: string) {
  if (!turn || process.env.OCTO_ARTIFACT_SCRIPTS !== "1") return
  recoverObservedScans() // do not overwrite an observed diff whose enqueue previously failed
  const key = turn.root_session_id
  const active = sessions.get(key)
  if (active) {
    active.conflicted = true
    active.count++
    return {
      id: active.id,
      turn,
      tool,
      baseline: { files: {}, sources: {}, complete: false, reason: "concurrent tools" } satisfies Snapshot,
    }
  }
  const id = randomUUID()
  sessions.set(key, { id, conflicted: false, count: 1 })
  const snap = await snapshot(outputs(turn))
  if (!snap.complete)
    console.warn("[octo:artifact] scan-incomplete", { messageId: turn.root_message_id, reason: snap.reason })
  try {
    save(turn, { snapshot: snap, operation: id, tool }, snap.reason ?? "running")
  } catch (err) {
    sessions.delete(key)
    throw err
  }
  return { id, turn, tool, baseline: snap }
}

export async function after(window: Awaited<ReturnType<typeof before>>) {
  if (!window) return
  const active = sessions.get(window.turn.root_session_id)
  try {
    if (active?.conflicted) {
      save(
        window.turn,
        { snapshot: window.baseline, operation: window.id, tool: window.tool },
        "concurrent tools; attribution unavailable",
      )
      return
    }
    const current = await snapshot(outputs(window.turn))
    if (!current.complete || !window.baseline.complete || active?.conflicted) {
      save(
        window.turn,
        { snapshot: window.baseline, operation: window.id, tool: window.tool },
        active?.conflicted
          ? "concurrent tools; attribution unavailable"
          : (current.reason ?? "incomplete initial baseline"),
      )
      return
    }
    const script = ["bash", "powershell", "python"].some((name) => toolIs(window.tool, name))
    const occurredAt = Date.now()
    save(
      window.turn,
      { snapshot: window.baseline, operation: window.id, tool: window.tool, observed: current, occurredAt },
      "observed",
    )
    commitScan(window.turn, window.baseline, current, script, occurredAt)
  } finally {
    if (active) active.count--
    if (!active || active.count === 0) sessions.delete(window.turn.root_session_id)
  }
}

export async function finalize(turn: Turn | undefined) {
  if (!turn || process.env.OCTO_ARTIFACT_SCRIPTS !== "1" || sessions.has(turn.root_session_id)) return
  const row = Database.use((db) => db.select().from(Scans).where(eq(Scans.message_id, turn.root_message_id)).get())
  if (!row) return
  const prior = JSON.parse(row.baseline) as Baseline
  if (prior.operation) return // interrupted/incomplete windows keep their recovery evidence
  const current = await snapshot(outputs(turn))
  if (!current.complete) {
    save(turn, prior, current.reason)
    return
  }
  const changed = Object.entries(current.files).some(
    ([file, v]) => prior.snapshot.files[file]?.digest !== v.digest && current.sources[file]?.digest !== v.digest,
  )
  if (changed) save(turn, prior, "post-tool changes; background/external origin not attributable")
}

export function commitScan(
  turn: Turn,
  previous: Snapshot,
  current: Snapshot,
  script: boolean,
  occurredAt = Date.now(),
) {
  if (!previous.complete || !current.complete) return
  Database.Client().transaction((db) => {
    for (const [file, version] of Object.entries(current.files)) {
      const prior = previous.files[file]
      if (prior?.digest === version.digest) continue
      const source = current.sources[file]
      if (source?.pending) continue
      if (source?.digest === version.digest) continue
      if (!script) continue
      const edit = !!prior || !!(source && source.digest !== previous.sources[file]?.digest)
      enqueue(db, turn, {
        name: edit ? "artifact-file-edit" : "artifact-file-write",
        identity: file,
        type: resolveOutputType(file),
        source: "script",
        occurredAt,
      })
    }
    db.insert(Scans)
      .values({
        message_id: turn.root_message_id,
        baseline: JSON.stringify({ snapshot: current }),
        updated_at: occurredAt,
      })
      .onConflictDoUpdate({
        target: Scans.message_id,
        set: { baseline: JSON.stringify({ snapshot: current }), diagnostic: null, updated_at: occurredAt },
      })
      .run()
  })
}

// A interrupted window is evidence of incomplete coverage, never permission to infer
// changes performed while the process was dead. Subsequent tools establish a new baseline.
export function recoverScans() {
  recoverObservedScans()
  Database.use((db) =>
    db
      .update(Scans)
      .set({ diagnostic: "interrupted scan; unobserved changes not attributed" })
      .where(sql`${Scans.diagnostic} = 'running'`)
      .run(),
  )
}

export function recoverObservedScans() {
  const rows = Database.use((db) => db.select().from(Scans).where(eq(Scans.diagnostic, "observed")).all())
  for (const row of rows) {
    const turn = readTurn(row.message_id)
    const baseline = JSON.parse(row.baseline) as Baseline
    if (!turn || !baseline.observed || !baseline.occurredAt) continue
    commitScan(
      turn,
      baseline.snapshot,
      baseline.observed,
      ["bash", "powershell", "python"].some((name) => toolIs(baseline.tool ?? "", name)),
      baseline.occurredAt,
    )
  }
}

export * as ArtifactScanner from "./scanner"
