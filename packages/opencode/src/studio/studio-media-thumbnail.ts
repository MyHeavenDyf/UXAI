import { randomUUID } from "node:crypto"
import { lookup } from "node:dns/promises"
import { mkdir, rename, stat, unlink, writeFile } from "node:fs/promises"
import { isIP } from "node:net"
import path from "node:path"
import { and, eq, isNull, lte, or } from "@/storage/db"
import * as Database from "@/storage/db"
import { MessageV2 } from "@/session/message-v2"
import { PartTable, SessionTable } from "@/session/session.sql"
import { SessionID } from "@/session/schema"
import { SyncEvent } from "@/sync"
import { Instance } from "@/project/instance"
import { registerDisposer } from "@/effect/instance-registry"
import { Identifier } from "@/id/id"
import { StudioGenerationTable } from "./studio-generation.sql"
import { StudioMediaThumbnailTable } from "./studio-media-thumbnail.sql"

const MAX_CSS_WIDTH = 420
const MAX_CSS_HEIGHT = 210
export const STUDIO_THUMBNAIL_TARGET_DPR = 1.5
const ABSOLUTE_MAX_EDGE = 768
const MAX_IMAGE_BYTES = 50 * 1024 * 1024
const MAX_INPUT_PIXELS = 100_000_000
const DOWNLOAD_TIMEOUT_MS = 30_000
const MAX_REDIRECTS = 5
const MAX_ATTEMPTS = 3
const LEASE_MS = 60_000
const LEASE_RENEW_INTERVAL_MS = 20_000

type StudioThumbnailMedia = {
  id: string
  kind?: "image" | "video"
  url: string
  remoteUrl?: string
  thumbnailUrl?: string
  thumbnailStatus?: "pending" | "ready" | "failed"
  width?: number
  height?: number
  duration?: number
}

type StudioThumbnailResult = Record<string, unknown> & {
  images: StudioThumbnailMedia[]
}

type StudioMediaThumbnailRecord = typeof StudioMediaThumbnailTable.$inferSelect

export function studioThumbnailDimensions(sourceWidth: number, sourceHeight: number) {
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error("Thumbnail source dimensions are invalid.")
  }
  const displayScale = Math.min(MAX_CSS_WIDTH / sourceWidth, MAX_CSS_HEIGHT / sourceHeight)
  const scale = Math.min(
    1,
    displayScale * STUDIO_THUMBNAIL_TARGET_DPR,
    ABSOLUTE_MAX_EDGE / Math.max(sourceWidth, sourceHeight),
  )
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  }
}

function isVideo(media: StudioThumbnailMedia) {
  return (
    media.kind === "video" ||
    /^data:video\//i.test(media.remoteUrl ?? media.url) ||
    /\.(mp4|mov|webm)(?:[?#]|$)/i.test(media.remoteUrl ?? media.url)
  )
}

function usableLocalThumbnail(media: StudioThumbnailMedia) {
  return (
    media.thumbnailStatus === "ready" &&
    Boolean(media.thumbnailUrl?.replaceAll("\\", "/").match(/(^|\/)\.octo\/[^/]+\/thumbnails\//))
  )
}

export function prepareStudioThumbnailMedia(media: StudioThumbnailMedia[]) {
  return media.map((item) => ({
    ...item,
    ...(usableLocalThumbnail(item)
      ? { thumbnailStatus: "ready" as const }
      : isVideo(item)
        ? { thumbnailUrl: undefined, thumbnailStatus: "failed" as const }
        : item.thumbnailStatus === "failed"
          ? { thumbnailUrl: undefined, thumbnailStatus: "failed" as const }
          : { thumbnailUrl: undefined, thumbnailStatus: "pending" as const }),
  }))
}

function mediaResult(value: unknown): StudioThumbnailResult | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.images)) return undefined
  const images = record.images.filter((item): item is StudioThumbnailMedia => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false
    const media = item as Record<string, unknown>
    return typeof media.id === "string" && typeof media.url === "string"
  })
  return { ...record, images }
}

function thumbnailPath(record: Pick<StudioMediaThumbnailRecord, "session_id" | "generation_id" | "media_index">) {
  return path.posix.join(".octo", record.session_id, "thumbnails", `${record.generation_id}-${record.media_index}.webp`)
}

function absoluteThumbnailPath(
  record: Pick<StudioMediaThumbnailRecord, "directory" | "session_id" | "generation_id" | "media_index">,
) {
  return path.join(
    record.directory,
    ".octo",
    record.session_id,
    "thumbnails",
    `${record.generation_id}-${record.media_index}.webp`,
  )
}

function syncCompletedMessage(record: StudioMediaThumbnailRecord, result: StudioThumbnailResult) {
  const generation = Database.use((db) =>
    db
      .select({ tool_part_id: StudioGenerationTable.tool_part_id })
      .from(StudioGenerationTable)
      .where(eq(StudioGenerationTable.id, record.generation_id))
      .get(),
  )
  if (!generation) return
  const row = Database.use((db) => db.select().from(PartTable).where(eq(PartTable.id, generation.tool_part_id)).get())
  if (!row) return
  const part = { ...row.data, id: row.id, messageID: row.message_id, sessionID: row.session_id } as MessageV2.Part
  if (part.type !== "tool" || part.state.status !== "completed") return
  const output = ((): Record<string, unknown> | undefined => {
    try {
      const parsed = JSON.parse(part.state.output) as unknown
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined
      return parsed as Record<string, unknown>
    } catch {
      return undefined
    }
  })()
  if (!output) {
    console.warn("[studio.thumbnail] skipped invalid completed tool output", {
      generationID: record.generation_id,
      partID: generation.tool_part_id,
    })
    return
  }
  SyncEvent.run(MessageV2.Event.PartUpdated, {
    sessionID: record.session_id,
    part: {
      ...part,
      state: {
        ...part.state,
        output: JSON.stringify({ ...output, media: result.images }, null, 2),
      },
    },
    time: Date.now(),
  })
}

function updateMedia(
  record: StudioMediaThumbnailRecord,
  update: Pick<StudioThumbnailMedia, "thumbnailUrl" | "thumbnailStatus">,
) {
  const generation = Database.use((db) =>
    db.select().from(StudioGenerationTable).where(eq(StudioGenerationTable.id, record.generation_id)).get(),
  )
  const result = mediaResult(generation?.result)
  if (!generation || !result || !result.images[record.media_index]) return false
  result.images = result.images.map((item, index) => (index === record.media_index ? { ...item, ...update } : item))
  Database.use((db) =>
    db
      .update(StudioGenerationTable)
      .set({ result, time_updated: Date.now() })
      .where(eq(StudioGenerationTable.id, record.generation_id))
      .run(),
  )
  syncCompletedMessage(record, result)
  return true
}

function enqueueResult(record: typeof StudioGenerationTable.$inferSelect, result: StudioThumbnailResult) {
  const now = Date.now()
  const jobs = result.images.flatMap((media, mediaIndex) => {
    if (isVideo(media) || media.thumbnailStatus === "ready" || media.thumbnailStatus === "failed") return []
    const source = media.remoteUrl ?? media.url
    if (!source) return []
    return [
      {
        id: Identifier.create("studio_thumb", "ascending"),
        generation_id: record.id,
        session_id: record.session_id,
        directory: record.directory,
        media_index: mediaIndex,
        kind: "image" as const,
        source_url: source,
        status: "queued" as const,
        attempts: 0,
        next_retry_at: now,
        time_created: now,
        time_updated: now,
      },
    ]
  })
  if (jobs.length === 0) return 0
  return Database.use(
    (db) =>
      db
        .insert(StudioMediaThumbnailTable)
        .values(jobs)
        .onConflictDoNothing()
        .returning({ id: StudioMediaThumbnailTable.id })
        .all().length,
  )
}

export function enqueueStudioMediaThumbnails(generationID: string) {
  const record = Database.use((db) =>
    db.select().from(StudioGenerationTable).where(eq(StudioGenerationTable.id, generationID)).get(),
  )
  const result = mediaResult(record?.result)
  if (!record || !result) return 0
  const queued = enqueueResult(record, result)
  startStudioMediaThumbnailWorker()
  return queued
}

export function ensureStudioSessionThumbnails(sessionID: string) {
  const parsed = SessionID.zod.parse(sessionID)
  const session = Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, parsed)).get())
  if (!session || session.directory !== Instance.directory || session.agent !== "octo_studio") {
    throw new Error(`Studio session not found: ${parsed}`)
  }
  const records = Database.use((db) =>
    db
      .select()
      .from(StudioGenerationTable)
      .where(and(eq(StudioGenerationTable.session_id, parsed), eq(StudioGenerationTable.status, "succeeded")))
      .all(),
  )
  const queued = records.reduce((total, record) => {
    const result = mediaResult(record.result)
    if (!result) return total
    const next = prepareStudioThumbnailMedia(result.images)
    const changed = next.some(
      (item, index) =>
        item.thumbnailUrl !== result.images[index]?.thumbnailUrl ||
        item.thumbnailStatus !== result.images[index]?.thumbnailStatus,
    )
    const normalized = changed ? { ...result, images: next } : result
    if (changed) {
      Database.use((db) =>
        db
          .update(StudioGenerationTable)
          .set({ result: normalized, time_updated: Date.now() })
          .where(eq(StudioGenerationTable.id, record.id))
          .run(),
      )
      const synthetic = {
        id: "",
        generation_id: record.id,
        session_id: record.session_id,
        directory: record.directory,
        media_index: 0,
        kind: "image" as const,
        source_url: "",
        status: "queued" as const,
        attempts: 0,
        next_retry_at: 0,
        lease_owner: null,
        lease_expires_at: null,
        thumbnail_path: null,
        error: null,
        time_created: 0,
        time_updated: 0,
      }
      syncCompletedMessage(synthetic, normalized)
    }
    return total + enqueueResult(record, normalized)
  }, 0)
  startStudioMediaThumbnailWorker()
  return { queued }
}

function privateIPv4(address: string) {
  const parts = address.split(".").map(Number)
  if (parts.length !== 4 || parts.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) return true
  const [a, b, c] = parts
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  )
}

export function studioThumbnailAddressAllowed(address: string) {
  if (isIP(address) === 4) return !privateIPv4(address)
  const normalized = address.toLowerCase()
  if (normalized === "::" || normalized === "::1") return false
  if (normalized.startsWith("fc") || normalized.startsWith("fd") || /^fe[89ab]/.test(normalized)) return false
  if (normalized.startsWith("ff") || normalized.startsWith("2001:db8:")) return false
  if (normalized.startsWith("::ffff:")) return !privateIPv4(normalized.slice(7))
  return isIP(address) === 6
}

async function validateRemoteUrl(value: string) {
  const url = new URL(value)
  if (url.protocol !== "https:") throw new Error("Thumbnail source must use HTTPS.")
  if (url.username || url.password) throw new Error("Thumbnail source credentials are not allowed.")
  if (url.hostname.toLowerCase() === "localhost") throw new Error("Thumbnail source host is not allowed.")
  const addresses = await lookup(url.hostname, { all: true, verbatim: true })
  if (addresses.length === 0 || addresses.some((item) => !studioThumbnailAddressAllowed(item.address))) {
    throw new Error("Thumbnail source resolves to a private or reserved address.")
  }
  return url
}

export function studioThumbnailContentTypeAllowed(value: string | null) {
  const contentType = value?.split(";")[0]?.trim().toLowerCase()
  return Boolean(contentType && (contentType.startsWith("image/") || contentType === "application/octet-stream"))
}

export async function studioThumbnailResponseBytes(response: Response, maximumBytes = MAX_IMAGE_BYTES) {
  const length = Number(response.headers.get("content-length") ?? 0)
  if (length > maximumBytes) throw new Error("Thumbnail source exceeds the maximum download size.")
  if (!response.body) throw new Error("Thumbnail source has no response body.")
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const item = await reader.read()
    if (item.done) break
    size += item.value.byteLength
    if (size > maximumBytes) {
      await reader.cancel()
      throw new Error("Thumbnail source exceeds the maximum download size.")
    }
    chunks.push(item.value)
  }
  const output = new Uint8Array(size)
  let offset = 0
  chunks.forEach((chunk) => {
    output.set(chunk, offset)
    offset += chunk.byteLength
  })
  return Buffer.from(output)
}

async function downloadImage(source: string, signal: AbortSignal) {
  if (source.startsWith("data:image/")) {
    const match = source.match(/^data:image\/[a-z0-9.+-]+;base64,(.+)$/is)
    if (!match) throw new Error("Thumbnail data URL is invalid.")
    const bytes = Buffer.from(match[1], "base64")
    if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("Thumbnail source exceeds the maximum download size.")
    return bytes
  }
  let url = await validateRemoteUrl(source)
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    const response = await fetch(url, { redirect: "manual", signal })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location")
      if (!location || redirect === MAX_REDIRECTS) throw new Error("Thumbnail source redirect is invalid.")
      url = await validateRemoteUrl(new URL(location, url).toString())
      continue
    }
    if (!response.ok) throw new Error(`Thumbnail source request failed with status ${response.status}.`)
    const contentType = response.headers.get("content-type")
    if (!studioThumbnailContentTypeAllowed(contentType)) {
      throw new Error(`Thumbnail source content type is not an image: ${contentType}`)
    }
    return studioThumbnailResponseBytes(response)
  }
  throw new Error("Thumbnail source has too many redirects.")
}

async function validThumbnail(file: string) {
  const exists = await stat(file)
    .then((item) => item.isFile() && item.size > 0)
    .catch(() => false)
  if (!exists) return false
  return import("sharp")
    .then((module) => module.default(file).metadata())
    .then((metadata) => metadata.format === "webp" && Boolean(metadata.width && metadata.height))
    .catch(() => false)
}

async function materializeThumbnail(record: StudioMediaThumbnailRecord, signal: AbortSignal) {
  const target = absoluteThumbnailPath(record)
  const temporary = `${target}.tmp`
  if (await validThumbnail(target)) {
    await unlink(temporary).catch(() => undefined)
    return thumbnailPath(record)
  }
  const controller = new AbortController()
  const abort = () => controller.abort(signal.reason)
  signal.addEventListener("abort", abort, { once: true })
  const timeout = setTimeout(
    () => controller.abort(new Error("Thumbnail source download timed out.")),
    DOWNLOAD_TIMEOUT_MS,
  )
  const bytes = await downloadImage(record.source_url, controller.signal).finally(() => {
    clearTimeout(timeout)
    signal.removeEventListener("abort", abort)
  })
  const sharp = (await import("sharp")).default
  const input = sharp(bytes, { animated: false, page: 0, limitInputPixels: MAX_INPUT_PIXELS })
  const metadata = await input.metadata()
  const rotated = metadata.orientation && metadata.orientation >= 5 && metadata.orientation <= 8
  const sourceWidth = rotated ? metadata.height : metadata.width
  const sourceHeight = rotated ? metadata.width : metadata.height
  if (!sourceWidth || !sourceHeight) throw new Error("Thumbnail source dimensions could not be read.")
  const size = studioThumbnailDimensions(sourceWidth, sourceHeight)
  const output = await input
    .rotate()
    .resize(size.width, size.height, { fit: "fill", withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer()
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(temporary, output)
  if (!(await validThumbnail(temporary))) {
    await unlink(temporary).catch(() => undefined)
    throw new Error("Generated thumbnail failed validation.")
  }
  await unlink(target).catch(() => undefined)
  await rename(temporary, target)
  return thumbnailPath(record)
}

function claimJob(directory: string): StudioMediaThumbnailRecord | undefined {
  const now = Date.now()
  const candidate = Database.use((db) =>
    db
      .select()
      .from(StudioMediaThumbnailTable)
      .where(
        and(
          eq(StudioMediaThumbnailTable.directory, directory),
          or(
            and(eq(StudioMediaThumbnailTable.status, "queued"), lte(StudioMediaThumbnailTable.next_retry_at, now)),
            and(
              eq(StudioMediaThumbnailTable.status, "running"),
              or(
                isNull(StudioMediaThumbnailTable.lease_expires_at),
                lte(StudioMediaThumbnailTable.lease_expires_at, now),
              ),
            ),
          ),
        ),
      )
      .limit(1)
      .get(),
  )
  if (!candidate) return undefined
  const owner = randomUUID()
  return Database.transaction(
    (db) => {
      const current = db
        .select()
        .from(StudioMediaThumbnailTable)
        .where(eq(StudioMediaThumbnailTable.id, candidate.id))
        .get()
      if (!current || current.directory !== directory) return undefined
      const available =
        current.status === "queued"
          ? current.next_retry_at <= now
          : current.status === "running" && (current.lease_expires_at ?? 0) <= now
      if (!available) return undefined
      db.update(StudioMediaThumbnailTable)
        .set({
          status: "running",
          lease_owner: owner,
          lease_expires_at: now + LEASE_MS,
          time_updated: now,
        })
        .where(eq(StudioMediaThumbnailTable.id, current.id))
        .run()
      return { ...current, status: "running" as const, lease_owner: owner, lease_expires_at: now + LEASE_MS }
    },
    { behavior: "immediate" },
  )
}

function renewJobLease(record: StudioMediaThumbnailRecord) {
  const now = Date.now()
  return Boolean(
    Database.use((db) =>
      db
        .update(StudioMediaThumbnailTable)
        .set({ lease_expires_at: now + LEASE_MS, time_updated: now })
        .where(
          and(
            eq(StudioMediaThumbnailTable.id, record.id),
            eq(StudioMediaThumbnailTable.status, "running"),
            eq(StudioMediaThumbnailTable.lease_owner, record.lease_owner!),
          ),
        )
        .returning({ id: StudioMediaThumbnailTable.id })
        .get(),
    ),
  )
}

async function completeJob(record: StudioMediaThumbnailRecord, relativePath: string) {
  if (!renewJobLease(record)) return
  if (!updateMedia(record, { thumbnailUrl: relativePath, thumbnailStatus: "ready" })) {
    await unlink(absoluteThumbnailPath(record)).catch(() => undefined)
    return
  }
  Database.use((db) =>
    db
      .update(StudioMediaThumbnailTable)
      .set({
        status: "succeeded",
        thumbnail_path: relativePath,
        error: null,
        lease_owner: null,
        lease_expires_at: null,
        time_updated: Date.now(),
      })
      .where(
        and(
          eq(StudioMediaThumbnailTable.id, record.id),
          eq(StudioMediaThumbnailTable.lease_owner, record.lease_owner!),
        ),
      )
      .run(),
  )
}

function failJob(record: StudioMediaThumbnailRecord, error: unknown, aborted: boolean) {
  const message = error instanceof Error ? error.message : String(error)
  const attempts = aborted ? record.attempts : record.attempts + 1
  const terminal = !aborted && attempts >= MAX_ATTEMPTS
  const updated = Database.use((db) =>
    db
      .update(StudioMediaThumbnailTable)
      .set({
        status: terminal ? "failed" : "queued",
        attempts,
        next_retry_at: aborted ? Date.now() : Date.now() + Math.min(30_000, 1000 * 2 ** attempts),
        error: message,
        lease_owner: null,
        lease_expires_at: null,
        time_updated: Date.now(),
      })
      .where(
        and(
          eq(StudioMediaThumbnailTable.id, record.id),
          eq(StudioMediaThumbnailTable.lease_owner, record.lease_owner!),
        ),
      )
      .returning({ id: StudioMediaThumbnailTable.id })
      .get(),
  )
  if (updated && terminal) updateMedia(record, { thumbnailUrl: undefined, thumbnailStatus: "failed" })
}

const workerTimers = new Map<string, ReturnType<typeof setInterval>>()
const activeDirectories = new Set<string>()
const activeControllers = new Map<string, AbortController>()

async function tick(directory: string) {
  if (activeDirectories.has(directory)) return
  const record = claimJob(directory)
  if (!record) return
  activeDirectories.add(directory)
  const controller = new AbortController()
  activeControllers.set(directory, controller)
  const leaseTimer = setInterval(() => {
    if (renewJobLease(record)) return
    controller.abort(new Error("Studio thumbnail task lease was lost."))
  }, LEASE_RENEW_INTERVAL_MS)
  await materializeThumbnail(record, controller.signal)
    .then((relativePath) => completeJob(record, relativePath))
    .catch((error) => failJob(record, error, controller.signal.aborted))
    .finally(() => {
      clearInterval(leaseTimer)
      activeDirectories.delete(directory)
      activeControllers.delete(directory)
    })
}

export function runStudioMediaThumbnailWorkerOnce() {
  return tick(Instance.directory)
}

export function startStudioMediaThumbnailWorker() {
  const directory = Instance.directory
  if (workerTimers.has(directory)) return
  const run = Instance.bind(() =>
    tick(directory).catch((error) => console.error("[studio.thumbnail] tick failed", error)),
  )
  workerTimers.set(directory, setInterval(run, 1000))
  void run()
}

registerDisposer(async (directory) => {
  const timer = workerTimers.get(directory)
  if (timer) clearInterval(timer)
  workerTimers.delete(directory)
  activeControllers.get(directory)?.abort(new Error("Studio instance disposed."))
})
