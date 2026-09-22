import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { and, eq, like, or } from "@/storage/db"
import * as Database from "@/storage/db"
import { MessageV2 } from "@/session/message-v2"
import { PartTable, SessionTable } from "@/session/session.sql"
import { PartID, SessionID } from "@/session/schema"
import { SyncEvent } from "@/sync"
import { Instance } from "@/project/instance"
import { Identifier } from "@/id/id"
import { sniffAttachmentMime } from "@/util/media"
import { StudioGenerationTable } from "./studio-generation.sql"
import { StudioMediaThumbnailTable } from "./studio-media-thumbnail.sql"

const MAX_IMAGE_BYTES = 50 * 1024 * 1024
const MAX_THUMBNAIL_BYTES = 10 * 1024 * 1024
const DOWNLOAD_TIMEOUT_MS = 30_000
const MAX_REDIRECTS = 5

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

type StudioThumbnailResult = Record<string, unknown> & { images: StudioThumbnailMedia[] }
type StudioMediaThumbnailRecord = typeof StudioMediaThumbnailTable.$inferSelect

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
  const output = (() => {
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
    part: { ...part, state: { ...part.state, output: JSON.stringify({ ...output, media: result.images }, null, 2) } },
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
    if (usableLocalThumbnail(media)) return []
    const source = media.remoteUrl ?? media.url
    if (!source) return []
    return [
      {
        id: Identifier.create("studio_thumb", "ascending"),
        generation_id: record.id,
        session_id: record.session_id,
        directory: record.directory,
        media_index: mediaIndex,
        kind: isVideo(media) ? ("video" as const) : ("image" as const),
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
  if (!record || !result) {
    console.warn("[studio.thumbnail] enqueue skipped", {
      generationID,
      directory: Instance.directory,
      reason: !record ? "generation_not_found" : "generation_has_no_media",
    })
    return 0
  }
  const queued = enqueueResult(record, result)
  console.info("[studio.thumbnail] enqueue checked", {
    generationID,
    sessionID: record.session_id,
    mediaCount: result.images.length,
    queued,
    directory: record.directory,
  })
  return queued
}

export function ensureStudioSessionThumbnails(sessionID: string) {
  const parsed = SessionID.zod.parse(sessionID)
  const session = Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, parsed)).get())
  if (!session || session.directory !== Instance.directory || session.agent !== "octo_studio")
    throw new Error(`Studio session not found: ${parsed}`)
  const recovered = Database.use(
    (db) =>
      db
        .update(StudioMediaThumbnailTable)
        .set({
          status: "queued",
          attempts: 0,
          next_retry_at: Date.now(),
          error: null,
          lease_owner: null,
          lease_expires_at: null,
          time_updated: Date.now(),
        })
        .where(
          and(
            eq(StudioMediaThumbnailTable.session_id, parsed),
            or(
              eq(StudioMediaThumbnailTable.status, "running"),
              and(
                eq(StudioMediaThumbnailTable.status, "failed"),
                or(
                  eq(StudioMediaThumbnailTable.error, "Thumbnail source resolves to a private or reserved address."),
                  eq(StudioMediaThumbnailTable.error, "sharp is not a function"),
                  like(StudioMediaThumbnailTable.error, "Sharp module did not expose a callable factory%"),
                  like(StudioMediaThumbnailTable.error, 'Could not load the "sharp" module using the % runtime%'),
                ),
              ),
            ),
          ),
        )
        .returning({ id: StudioMediaThumbnailTable.id })
        .all().length,
  )
  const records = Database.use((db) =>
    db
      .select()
      .from(StudioGenerationTable)
      .where(and(eq(StudioGenerationTable.session_id, parsed), eq(StudioGenerationTable.status, "succeeded")))
      .all(),
  )
  const queued =
    recovered +
    records.reduce((total, record) => {
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
        syncCompletedMessage(
          {
            id: "",
            generation_id: record.id,
            session_id: record.session_id,
            directory: record.directory,
            media_index: 0,
            kind: "image",
            source_url: "",
            status: "queued",
            attempts: 0,
            next_retry_at: 0,
            lease_owner: null,
            lease_expires_at: null,
            thumbnail_path: null,
            error: null,
            time_created: 0,
            time_updated: 0,
          },
          normalized,
        )
      }
      return total + enqueueResult(record, normalized)
    }, 0)
  console.info("[studio.thumbnail] session backfill checked", {
    sessionID: parsed,
    generationCount: records.length,
    queued,
    recoveredLegacyFailures: recovered,
    directory: session.directory,
  })
  return { queued }
}

function generationRecord(generationID: string) {
  const direct = Database.use((db) =>
    db.select().from(StudioGenerationTable).where(eq(StudioGenerationTable.id, generationID)).get(),
  )
  if (direct) return direct
  if (!generationID.startsWith("studio_prt_")) return
  return Database.use((db) =>
    db
      .select()
      .from(StudioGenerationTable)
      .where(eq(StudioGenerationTable.tool_part_id, PartID.zod.parse(generationID.slice("studio_".length))))
      .get(),
  )
}

function generationMedia(generationID: string, mediaIndex: number) {
  if (!Number.isInteger(mediaIndex) || mediaIndex < 0) throw new Error("Studio thumbnail media index is invalid.")
  const generation = generationRecord(generationID)
  const result = mediaResult(generation?.result)
  const media = result?.images[mediaIndex]
  if (
    !generation ||
    generation.directory !== Instance.directory ||
    generation.status !== "succeeded" ||
    !result ||
    !media
  )
    throw new Error(`Studio generation media not found: ${generationID}/${mediaIndex}`)
  return { generation, result, media }
}

function thumbnailRecord(input: ReturnType<typeof generationMedia>, mediaIndex: number): StudioMediaThumbnailRecord {
  return {
    id: "",
    generation_id: input.generation.id,
    session_id: input.generation.session_id,
    directory: input.generation.directory,
    media_index: mediaIndex,
    kind: isVideo(input.media) ? "video" : "image",
    source_url: input.media.remoteUrl ?? input.media.url,
    status: "queued",
    attempts: 0,
    next_retry_at: 0,
    lease_owner: null,
    lease_expires_at: null,
    thumbnail_path: null,
    error: null,
    time_created: 0,
    time_updated: 0,
  }
}

function validateRemoteUrl(value: string) {
  const url = new URL(value)
  if (url.protocol !== "https:") throw new Error("Thumbnail source must use HTTPS.")
  if (url.username || url.password) throw new Error("Thumbnail source credentials are not allowed.")
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
    const match = source.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/is)
    if (!match) throw new Error("Thumbnail data URL is invalid.")
    const bytes = Buffer.from(match[2], "base64")
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES)
      throw new Error("Thumbnail source exceeds the maximum download size.")
    return { bytes, contentType: sniffAttachmentMime(bytes, match[1].toLowerCase()) }
  }
  let url = validateRemoteUrl(source)
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    const response = await fetch(url, { redirect: "manual", signal })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location")
      if (!location || redirect === MAX_REDIRECTS) throw new Error("Thumbnail source redirect is invalid.")
      url = validateRemoteUrl(new URL(location, url).toString())
      continue
    }
    if (!response.ok) throw new Error(`Thumbnail source request failed with status ${response.status}.`)
    if (!studioThumbnailContentTypeAllowed(response.headers.get("content-type")))
      throw new Error(`Thumbnail source content type is not an image: ${response.headers.get("content-type")}`)
    const bytes = await studioThumbnailResponseBytes(response)
    return {
      bytes,
      contentType: sniffAttachmentMime(bytes, response.headers.get("content-type") ?? "application/octet-stream"),
    }
  }
  throw new Error("Thumbnail source has too many redirects.")
}

function recordTaskError(generationID: string, mediaIndex: number, error: unknown) {
  const resolvedID = generationRecord(generationID)?.id ?? generationID
  Database.use((db) =>
    db
      .update(StudioMediaThumbnailTable)
      .set({
        status: "queued",
        error: error instanceof Error ? error.message : String(error),
        lease_owner: null,
        lease_expires_at: null,
        time_updated: Date.now(),
      })
      .where(
        and(
          eq(StudioMediaThumbnailTable.generation_id, resolvedID),
          eq(StudioMediaThumbnailTable.media_index, mediaIndex),
        ),
      )
      .run(),
  )
}

export async function loadStudioThumbnailSource(input: {
  generationID: string
  mediaIndex: number
  signal?: AbortSignal
}) {
  const found = generationMedia(input.generationID, input.mediaIndex)
  if (isVideo(found.media)) throw new Error("Studio thumbnail source target is not an image.")
  const controller = new AbortController()
  const abort = () => controller.abort(input.signal?.reason)
  input.signal?.addEventListener("abort", abort, { once: true })
  const timeout = setTimeout(
    () => controller.abort(new Error("Thumbnail source download timed out.")),
    DOWNLOAD_TIMEOUT_MS,
  )
  return downloadImage(found.media.remoteUrl ?? found.media.url, controller.signal)
    .then((result) => {
      console.info("[studio.thumbnail] image source loaded", {
        generationID: input.generationID,
        mediaIndex: input.mediaIndex,
        bytes: result.bytes.byteLength,
      })
      return result
    })
    .catch((error) => {
      recordTaskError(found.generation.id, input.mediaIndex, error)
      throw error
    })
    .finally(() => {
      clearTimeout(timeout)
      input.signal?.removeEventListener("abort", abort)
    })
}

export function studioThumbnailWebpAllowed(bytes: Uint8Array) {
  if (bytes.byteLength < 12 || bytes.byteLength > MAX_THUMBNAIL_BYTES) return false
  if (Buffer.from(bytes.subarray(0, 4)).toString("ascii") !== "RIFF") return false
  if (Buffer.from(bytes.subarray(8, 12)).toString("ascii") !== "WEBP") return false
  const declared = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true) + 8
  return declared >= 12 && declared <= bytes.byteLength
}

async function validStoredThumbnail(file: string) {
  const info = await stat(file).catch(() => undefined)
  if (!info?.isFile() || info.size < 12 || info.size > MAX_THUMBNAIL_BYTES) return false
  return readFile(file)
    .then(studioThumbnailWebpAllowed)
    .catch(() => false)
}

const thumbnailWrites = new Map<string, Promise<{ thumbnailUrl: string }>>()

export function saveStudioMediaThumbnail(input: { generationID: string; mediaIndex: number; content: string }) {
  const directory = Instance.directory
  const key = `${directory}:${input.generationID}:${input.mediaIndex}`
  const active = thumbnailWrites.get(key)
  if (active) {
    console.info("[studio.thumbnail] reused active write", {
      generationID: input.generationID,
      mediaIndex: input.mediaIndex,
      directory,
    })
    return active
  }
  console.info("[studio.thumbnail] thumbnail write started", {
    generationID: input.generationID,
    mediaIndex: input.mediaIndex,
    directory,
  })
  const task = materializeStudioMediaThumbnail(input)
    .then((result) => {
      console.info("[studio.thumbnail] thumbnail write succeeded", {
        generationID: input.generationID,
        mediaIndex: input.mediaIndex,
        thumbnailPath: path.join(directory, result.thumbnailUrl),
      })
      return result
    })
    .catch((error) => {
      recordTaskError(input.generationID, input.mediaIndex, error)
      console.error("[studio.thumbnail] thumbnail write failed", {
        generationID: input.generationID,
        mediaIndex: input.mediaIndex,
        directory,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    })
    .finally(() => thumbnailWrites.delete(key))
  thumbnailWrites.set(key, task)
  return task
}

async function materializeStudioMediaThumbnail(input: { generationID: string; mediaIndex: number; content: string }) {
  const found = generationMedia(input.generationID, input.mediaIndex)
  enqueueResult(found.generation, found.result)
  const record = thumbnailRecord(found, input.mediaIndex)
  const target = absoluteThumbnailPath(record)
  const relativePath = thumbnailPath(record)
  if (!(await validStoredThumbnail(target))) {
    if (input.content.length > Math.ceil((MAX_THUMBNAIL_BYTES * 4) / 3) + 8)
      throw new Error("Studio thumbnail exceeds the maximum size.")
    const bytes = Buffer.from(input.content, "base64")
    if (!studioThumbnailWebpAllowed(bytes)) throw new Error("Studio thumbnail is not a valid WebP file.")
    const temporary = `${target}.${randomUUID()}.tmp`
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(temporary, bytes)
    if (!(await validStoredThumbnail(temporary))) {
      await unlink(temporary).catch(() => undefined)
      throw new Error("Generated Studio thumbnail failed validation.")
    }
    await unlink(target).catch(() => undefined)
    await rename(temporary, target)
  }
  if (!updateMedia(record, { thumbnailUrl: relativePath, thumbnailStatus: "ready" })) {
    await unlink(target).catch(() => undefined)
    throw new Error("Studio generation was removed before its thumbnail completed.")
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
          eq(StudioMediaThumbnailTable.generation_id, record.generation_id),
          eq(StudioMediaThumbnailTable.media_index, input.mediaIndex),
        ),
      )
      .run(),
  )
  return { thumbnailUrl: relativePath }
}

/** @deprecated Use saveStudioMediaThumbnail. */
export const saveStudioVideoPoster = saveStudioMediaThumbnail
