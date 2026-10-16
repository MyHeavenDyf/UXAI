import * as Database from "@/storage/db"
import { and, asc, desc, eq, gt, inArray, lt, notInArray, or, sql } from "@/storage/db"
import { readdir, rm, stat } from "node:fs/promises"
import path from "path"
import type { SessionID } from "@/session/schema"
import { SessionTable } from "@/session/session.sql"
import { StudioGenerationTable } from "./studio-generation.sql"
import { StudioHistoryExcludedTable, StudioHistoryTable } from "./studio-history.sql"

export type StudioHistoryMediaItem = {
  id: string
  sessionID: string
  generationID: string
  mediaIndex: number
  kind: "image" | "video"
  url: string
  thumbnailUrl?: string
  thumbnailStatus?: string
  width?: number
  height?: number
  aspectRatio?: string
  capability?: string
  duration?: string
  createdAt: number
}

export type StudioHistorySort = "desc" | "asc"

export type StudioHistoryQuery = {
  kind?: "image" | "video"
  resolutions?: string[]
  ratios?: string[]
  sort?: StudioHistorySort
  cursor?: string
  limit?: number
}

export type StudioHistoryPage = {
  items: StudioHistoryMediaItem[]
  nextCursor?: string
}

// 解析逗号分隔的筛选 query（resolution/ratio），供 Hono 与 HttpApi 两个入口共用。
export function splitHistoryFilter(value?: string): string[] | undefined {
  if (!value) return undefined
  const parts = value.split(",").map((item) => item.trim()).filter(Boolean)
  return parts.length > 0 ? parts : undefined
}

type StudioHistoryRow = typeof StudioHistoryTable.$inferSelect

const DEFAULT_LIMIT = 48
const MAX_LIMIT = 200

// SQLite 单条语句的绑定参数有上限（默认 32766），历史行每行 17 列，
// 一次性 upsert 约 1900 行就会触发 "too many SQL variables"，必须分块。
const SQLITE_CHUNK = 500

function chunked<T>(items: T[]): T[][] {
  const chunks: T[][] = []
  for (let offset = 0; offset < items.length; offset += SQLITE_CHUNK) {
    chunks.push(items.slice(offset, offset + SQLITE_CHUNK))
  }
  return chunks
}

const RATIO_OPTIONS: { label: string; value: number }[] = [
  { label: "21:9", value: 21 / 9 },
  { label: "16:9", value: 16 / 9 },
  { label: "3:2", value: 3 / 2 },
  { label: "4:3", value: 4 / 3 },
  { label: "1:1", value: 1 },
  { label: "2:3", value: 2 / 3 },
  { label: "3:4", value: 3 / 4 },
  { label: "9:16", value: 9 / 16 },
]

const RATIO_LABELS = new Set(RATIO_OPTIONS.map((o) => o.label))
const RATIO_TOLERANCE = 0.02

// 与前端 `studio-history-gallery` 的分桶逻辑保持一致，保证服务端筛选与展示口径相同。
function mediaResolution(width?: number, height?: number): string | undefined {
  const short = Math.min(width ?? 0, height ?? 0)
  if (!short) return undefined
  if (short <= 480) return "480P"
  if (short <= 720) return "720P"
  if (short <= 1080) return "1080P"
  return "4K"
}

function mediaRatio(aspectRatio?: string, width?: number, height?: number): string | undefined {
  if (aspectRatio && RATIO_LABELS.has(aspectRatio)) return aspectRatio
  const w = width ?? 0
  const h = height ?? 0
  if (!w || !h) return undefined
  const ratio = w / h
  const closest = RATIO_OPTIONS.reduce((best, option) =>
    Math.abs(ratio - option.value) < Math.abs(ratio - best.value) ? option : best,
  )
  if (Math.abs(ratio - closest.value) <= RATIO_TOLERANCE) return closest.label
  return "自定义"
}

function extractMediaFromResult(
  result: Record<string, unknown> | undefined,
  sessionId: string,
  createdAt: number,
): StudioHistoryMediaItem[] {
  if (!result) return []
  const images = result.images
  if (!Array.isArray(images)) return []
  const generationID = typeof result.id === "string" ? result.id : ""
  const capability = typeof result.capability === "string" ? result.capability : undefined
  const aspectRatio = typeof result.aspectRatio === "string" ? result.aspectRatio : undefined
  const duration = typeof result.duration === "string" ? result.duration : undefined
  const resultWidth = typeof result.width === "number" ? result.width : undefined
  const resultHeight = typeof result.height === "number" ? result.height : undefined

  return images.flatMap((image, mediaIndex): StudioHistoryMediaItem[] => {
    if (!image || typeof image !== "object") return []
    const img = image as Record<string, unknown>
    const remoteUrl = typeof img.remoteUrl === "string" ? img.remoteUrl : undefined
    const url = remoteUrl ?? (typeof img.url === "string" ? img.url : "")
    if (!url) return []
    const kind: "image" | "video" = img.kind === "video" ? "video" : "image"
    return [{
      id: typeof img.id === "string" ? img.id : `${generationID}-${mediaIndex}`,
      sessionID: sessionId,
      generationID,
      mediaIndex,
      kind,
      url,
      thumbnailUrl: typeof img.thumbnailUrl === "string" ? img.thumbnailUrl : undefined,
      thumbnailStatus: typeof img.thumbnailStatus === "string" ? img.thumbnailStatus : undefined,
      width: typeof img.width === "number" ? img.width : resultWidth,
      height: typeof img.height === "number" ? img.height : resultHeight,
      aspectRatio,
      capability,
      duration,
      createdAt,
    }]
  })
}

function toRow(item: StudioHistoryMediaItem, directory: string) {
  return {
    id: item.id,
    session_id: item.sessionID,
    directory,
    generation_id: item.generationID,
    media_index: item.mediaIndex,
    kind: item.kind,
    url: item.url,
    thumbnail_url: item.thumbnailUrl ?? null,
    thumbnail_status: item.thumbnailStatus ?? null,
    width: item.width ?? null,
    height: item.height ?? null,
    aspect_ratio: item.aspectRatio ?? null,
    resolution: mediaResolution(item.width, item.height) ?? null,
    ratio: mediaRatio(item.aspectRatio, item.width, item.height) ?? null,
    capability: item.capability ?? null,
    duration: item.duration ?? null,
    created_at: item.createdAt,
  }
}

function toItem(row: StudioHistoryRow): StudioHistoryMediaItem {
  return {
    id: row.id,
    sessionID: row.session_id,
    generationID: row.generation_id,
    mediaIndex: row.media_index,
    kind: row.kind,
    url: row.url,
    thumbnailUrl: row.thumbnail_url ?? undefined,
    thumbnailStatus: row.thumbnail_status ?? undefined,
    width: row.width ?? undefined,
    height: row.height ?? undefined,
    aspectRatio: row.aspect_ratio ?? undefined,
    capability: row.capability ?? undefined,
    duration: row.duration ?? undefined,
    createdAt: row.created_at,
  }
}

// 幂等写入：历史表是所有 Studio 媒体的唯一来源，重复物化时刷新可变字段（缩略图/URL 等）。
// 返回真正写入的行数；被用户删除（墓碑）或隐藏的媒体会被跳过，避免被 backfill/materialize/snapshot 复活。
// 分块提交：已写入的块在后续块失败时仍然生效，upsert 幂等，重试会自愈。
function upsertMedia(directory: string, items: StudioHistoryMediaItem[]): number {
  let written = 0
  for (const chunk of chunked(items)) {
    written += Database.use((db) => {
      const blocked = new Set(
        db
          .select({ id: StudioHistoryExcludedTable.media_id })
          .from(StudioHistoryExcludedTable)
          .where(and(
            eq(StudioHistoryExcludedTable.directory, directory),
            inArray(StudioHistoryExcludedTable.media_id, chunk.map((item) => item.id)),
          ))
          .all()
          .map((row) => row.id),
      )
      const writable = chunk.filter((item) => !blocked.has(item.id))
      if (writable.length === 0) return 0
      db
        .insert(StudioHistoryTable)
        .values(writable.map((item) => toRow(item, directory)))
        .onConflictDoUpdate({
          target: [StudioHistoryTable.directory, StudioHistoryTable.id],
          set: {
            url: sql`excluded.url`,
            thumbnail_url: sql`excluded.thumbnail_url`,
            thumbnail_status: sql`excluded.thumbnail_status`,
            width: sql`excluded.width`,
            height: sql`excluded.height`,
            aspect_ratio: sql`excluded.aspect_ratio`,
            resolution: sql`excluded.resolution`,
            ratio: sql`excluded.ratio`,
            capability: sql`excluded.capability`,
            duration: sql`excluded.duration`,
            time_updated: Date.now(),
          },
        })
        .run()
      return writable.length
    })
  }
  return written
}

function generationMedia(directory: string, generationID: string): StudioHistoryMediaItem[] {
  const rows = Database.use((db) =>
    db
      .select()
      .from(StudioGenerationTable)
      .where(and(
        eq(StudioGenerationTable.id, generationID),
        eq(StudioGenerationTable.directory, directory),
        eq(StudioGenerationTable.status, "succeeded"),
      ))
      .all(),
  )
  return rows.flatMap((row) =>
    extractMediaFromResult(
      row.result as Record<string, unknown> | undefined,
      row.session_id,
      row.completed_at ?? row.time_created,
    ),
  )
}

// 单个 generation 完成/缩略图就绪时物化到历史表。
export function materializeStudioGeneration(directory: string, generationID: string): number {
  return upsertMedia(directory, generationMedia(directory, generationID))
}

// 单条媒体的缩略图状态回写：避免为一张图重算并 upsert 整条 generation（O(images²)）。
export function updateStudioHistoryThumbnail(
  directory: string,
  generationID: string,
  mediaIndex: number,
  input: { thumbnailUrl?: string | null; thumbnailStatus: string; preserveUrl?: boolean },
) {
  Database.use((db) =>
    db
      .update(StudioHistoryTable)
      .set({
        ...(input.preserveUrl ? {} : { thumbnail_url: input.thumbnailUrl ?? null }),
        thumbnail_status: input.thumbnailStatus,
        time_updated: Date.now(),
      })
      .where(and(
        eq(StudioHistoryTable.directory, directory),
        eq(StudioHistoryTable.generation_id, generationID),
        eq(StudioHistoryTable.media_index, mediaIndex),
      ))
      .run(),
  )
}

// 终端失败的缩略图回写为 failed，避免历史列表长期停留在 pending。
export function markStudioHistoryThumbnailFailed(directory: string, generationID: string, mediaIndex: number) {
  updateStudioHistoryThumbnail(directory, generationID, mediaIndex, { thumbnailStatus: "failed", preserveUrl: true })
}

// 一次性回填：把本进程内尚未物化的历史 generation 补进历史表（旧数据 < 本功能上线前）。
// 缓存有上限，超出后淘汰最早目录；被淘汰目录只会多跑一次幂等回填，不影响正确性。
const backfilledDirectories = new Set<string>()
const MAX_BACKFILLED_DIRECTORIES = 200

function rememberBackfilled(directory: string) {
  backfilledDirectories.add(directory)
  if (backfilledDirectories.size <= MAX_BACKFILLED_DIRECTORIES) return
  const oldest = backfilledDirectories.values().next().value
  if (oldest !== undefined) backfilledDirectories.delete(oldest)
}

export function backfillStudioHistory(directory: string) {
  if (backfilledDirectories.has(directory)) return
  // 只补尚未进入历史表的 generation（用子查询排除已物化的），既保留旧数据又避免重复 upsert。
  // 同时排除已有墓碑的 generation：用户删除全部媒体后 generation_id 不再出现在
  // studio_history 中，但墓碑表里仍有记录。不排除会导致每次重启都重新提取并尝试
  // 物化已删除的媒体，墓碑一旦失效数据就会复活。
  const rows = Database.use((db) =>
    db
      .select()
      .from(StudioGenerationTable)
      .where(and(
        eq(StudioGenerationTable.directory, directory),
        eq(StudioGenerationTable.status, "succeeded"),
        notInArray(
          StudioGenerationTable.id,
          db
            .select({ generation_id: StudioHistoryTable.generation_id })
            .from(StudioHistoryTable)
            .where(eq(StudioHistoryTable.directory, directory)),
        ),
        notInArray(
          StudioGenerationTable.id,
          db
            .select({ generation_id: StudioHistoryExcludedTable.generation_id })
            .from(StudioHistoryExcludedTable)
            .where(and(
              eq(StudioHistoryExcludedTable.directory, directory),
              sql`${StudioHistoryExcludedTable.generation_id} IS NOT NULL`,
            )),
        ),
      ))
      .all(),
  )
  const items = rows.flatMap((row) =>
    extractMediaFromResult(
      row.result as Record<string, unknown> | undefined,
      row.session_id,
      row.completed_at ?? row.time_created,
    ),
  )
  upsertMedia(directory, items)
  scheduleStudioHistoryMaintenance(directory)
  rememberBackfilled(directory)
}

// backfill 附带的维护（失效墓碑回收 + 孤儿缩略图全量 GC）不放在请求路径上：
// `.octo` 下会话目录很多时，全量扫描会明显拖慢首个 /studio/history 响应，
// 且 GC 内部改用异步 fs，也不会长时间阻塞事件循环。
// 同目录同时只有一个维护任务；失败只记日志，下次进程启动的 backfill 会幂等重试。
const maintenanceTasks = new Map<string, Promise<void>>()

function scheduleStudioHistoryMaintenance(directory: string) {
  if (maintenanceTasks.has(directory)) return
  const task = new Promise<void>((resolve) => {
    // setTimeout 而不是微任务：确保维护在当前请求响应发送之后才开始。
    setTimeout(() => {
      Promise.resolve()
        .then(() => pruneStudioHistoryExcluded(directory))
        .then(() => gcStudioHistoryThumbnails(directory))
        .catch((error) =>
          console.error("[studio.history] background maintenance failed", {
            directory,
            error: error instanceof Error ? error.message : error,
          })
        )
        .then(() => resolve())
    }, 0)
  })
  maintenanceTasks.set(directory, task)
  task.then(() => {
    if (maintenanceTasks.get(directory) === task) maintenanceTasks.delete(directory)
  })
}

// 等待该目录尚未完成的维护任务（不主动触发），供测试确定性验证后台维护结果。
export function flushStudioHistoryMaintenance(directory: string): Promise<void> {
  return maintenanceTasks.get(directory) ?? Promise.resolve()
}

function encodeCursor(createdAt: number, id: string) {
  return `${createdAt}|${id}`
}

function decodeCursor(cursor?: string): { createdAt: number; id: string } | undefined {
  if (!cursor) return undefined
  const index = cursor.indexOf("|")
  if (index < 0) return undefined
  const createdAt = Number(cursor.slice(0, index))
  if (!Number.isFinite(createdAt)) return undefined
  return { createdAt, id: cursor.slice(index + 1) }
}

export type StudioHistoryRevision = {
  revision: string
  count: number
  headId?: string
  headCreatedAt?: number
}

// 目录级轻量指纹：客户端据此判断是否需要重新拉取列表，避免每次点击都跑完整查询。
// count 覆盖新增/删除，max(time_updated) 覆盖缩略图等字段更新，head 覆盖顶部新增，
// 三者任一变化都会让 revision 变化，因此未变化时可安全复用缓存。
export function studioHistoryRevision(directory: string): StudioHistoryRevision {
  backfillStudioHistory(directory)
  return Database.use((db) => {
    const stats = db
      .select({
        count: sql<number>`count(*)`,
        updated: sql<number | null>`max(${StudioHistoryTable.time_updated})`,
        created: sql<number | null>`max(${StudioHistoryTable.created_at})`,
      })
      .from(StudioHistoryTable)
      .where(eq(StudioHistoryTable.directory, directory))
      .get()
    const head = db
      .select({ id: StudioHistoryTable.id, created_at: StudioHistoryTable.created_at })
      .from(StudioHistoryTable)
      .where(eq(StudioHistoryTable.directory, directory))
      .orderBy(desc(StudioHistoryTable.created_at), desc(StudioHistoryTable.id))
      .limit(1)
      .get()
    const count = stats?.count ?? 0
    return {
      revision: `${count}:${stats?.updated ?? 0}:${stats?.created ?? 0}:${head?.id ?? ""}`,
      count,
      headId: head?.id,
      headCreatedAt: head?.created_at,
    }
  })
}

export function listStudioHistoryMedia(directory: string, query: StudioHistoryQuery = {}): StudioHistoryPage {
  backfillStudioHistory(directory)
  const sort: StudioHistorySort = query.sort === "asc" ? "asc" : "desc"
  const limit = Math.min(Math.max(Math.trunc(query.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT)
  const cursor = decodeCursor(query.cursor)

  return Database.use((db) => {
    const conditions = [eq(StudioHistoryTable.directory, directory)]
    if (query.kind) conditions.push(eq(StudioHistoryTable.kind, query.kind))
    if (query.resolutions?.length) conditions.push(inArray(StudioHistoryTable.resolution, query.resolutions))
    if (query.ratios?.length) conditions.push(inArray(StudioHistoryTable.ratio, query.ratios))
    conditions.push(
      notInArray(
        StudioHistoryTable.id,
        db
          .select({ media_id: StudioHistoryExcludedTable.media_id })
          .from(StudioHistoryExcludedTable)
          .where(eq(StudioHistoryExcludedTable.directory, directory)),
      ),
    )
    if (cursor) {
      const tied = and(eq(StudioHistoryTable.created_at, cursor.createdAt))
      conditions.push(
        sort === "desc"
          ? or(lt(StudioHistoryTable.created_at, cursor.createdAt), and(tied, lt(StudioHistoryTable.id, cursor.id)))!
          : or(gt(StudioHistoryTable.created_at, cursor.createdAt), and(tied, gt(StudioHistoryTable.id, cursor.id)))!,
      )
    }

    const rows = db
      .select()
      .from(StudioHistoryTable)
      .where(and(...conditions))
      .orderBy(
        sort === "desc" ? desc(StudioHistoryTable.created_at) : asc(StudioHistoryTable.created_at),
        sort === "desc" ? desc(StudioHistoryTable.id) : asc(StudioHistoryTable.id),
      )
      .limit(limit + 1)
      .all()

    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    const last = page[page.length - 1]
    return {
      items: page.map(toItem),
      nextCursor: hasMore && last ? encodeCursor(last.created_at, last.id) : undefined,
    }
  })
}

export function snapshotSessionMedia(directory: string, sessionID: string): number {
  const rows = Database.use((db) =>
    db
      .select()
      .from(StudioGenerationTable)
      .where(and(
        eq(StudioGenerationTable.directory, directory),
        eq(StudioGenerationTable.session_id, sessionID as SessionID),
        eq(StudioGenerationTable.status, "succeeded"),
      ))
      .all(),
  )

  const items = rows.flatMap((row) =>
    extractMediaFromResult(
      row.result as Record<string, unknown> | undefined,
      sessionID,
      row.completed_at ?? row.time_created,
    ),
  )

  return upsertMedia(directory, items)
}

// 真正删除历史记录：只移除 `studio_history` 行，绝不触碰 `studio_generation`
// 与会话产物文件（原图/缩略图仍归会话所有）。
// 删除时写入 `studio_history_excluded` 墓碑，阻止 backfill/materialize/snapshot 再次物化它。
export async function deleteStudioHistoryMedia(directory: string, mediaIds: string[]): Promise<number> {
  const unique = [...new Set(mediaIds)]
  if (unique.length === 0) return 0

  const affectedSessions = new Set<string>()
  const deleted = Database.transaction((tx) => {
    // 先取出待删行的 generation_id 写入墓碑，供后续垃圾回收判断墓碑是否仍需要。
    const generationByMedia = new Map(
      chunked(unique).flatMap((part) =>
        tx
          .select({
            id: StudioHistoryTable.id,
            generation_id: StudioHistoryTable.generation_id,
            session_id: StudioHistoryTable.session_id,
          })
          .from(StudioHistoryTable)
          .where(and(eq(StudioHistoryTable.directory, directory), inArray(StudioHistoryTable.id, part)))
          .all()
          .flatMap((row) => {
            affectedSessions.add(row.session_id)
            return [[row.id, row.generation_id] as const]
          }),
      ),
    )
    // 只为历史表中真实存在的媒体写墓碑：发来的未知 id 无生成来源，写 null 墓碑
    // 后将永久无法被 pruneStudioHistoryExcluded 回收，导致墓碑表无界增长。
    for (const part of chunked(unique)) {
      const values = part.flatMap((media_id) => {
        const generation_id = generationByMedia.get(media_id)
        return generation_id ? [{ media_id, directory, generation_id }] : []
      })
      if (values.length === 0) continue
      tx
        .insert(StudioHistoryExcludedTable)
        .values(values)
        .onConflictDoNothing()
        .run()
    }
    return chunked(unique).reduce((deleted, part) =>
      deleted + tx
        .delete(StudioHistoryTable)
        .where(and(eq(StudioHistoryTable.directory, directory), inArray(StudioHistoryTable.id, part)))
        .returning({ id: StudioHistoryTable.id })
        .all()
        .length, 0)
  })
  // 只 GC 受影响会话（作用域小、很快），在响应返回前完成，保证删除接口的确定性。
  await gcStudioHistoryThumbnails(directory, affectedSessions)
  return deleted
}

// 孤儿缩略图目录回收：会话删除后 `.octo/<sessionID>/thumbnails` 由历史记录继续引用，
// 当会话本身已删除且历史表中不再有其任何媒体行时，该目录成为孤儿，可安全删除。
// 只清理 `thumbnails` 子目录，绝不触碰 comments/uploads 等其他会话数据。
function sessionThumbnailsOrphaned(directory: string, sessionID: string): boolean {
  return Database.use((db) => {
    if (db
      .select({ id: SessionTable.id })
      .from(SessionTable)
      .where(and(eq(SessionTable.directory, directory), eq(SessionTable.id, sessionID as SessionID)))
      .get()) return false
    return db
      .select({ id: StudioHistoryTable.id })
      .from(StudioHistoryTable)
      .where(and(
        eq(StudioHistoryTable.directory, directory),
        eq(StudioHistoryTable.session_id, sessionID),
      ))
      .limit(1)
      .all()
      .length === 0
  })
}

export async function gcStudioHistoryThumbnails(directory: string, sessions?: Iterable<string>): Promise<number> {
  const octoDir = path.join(directory, ".octo")
  // 异步 fs + 逐会话 await：GC 可能在请求路径（删除）或后台任务（backfill）中执行，
  // 无论哪种都不应长时间阻塞事件循环。
  const targets = sessions
    ? new Set(sessions)
    : new Set(
        (await readdir(octoDir, { withFileTypes: true }).catch(() => []))
          .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
          .map((entry) => entry.name),
      )
  let removed = 0
  for (const sessionID of targets) {
    const thumbnails = path.join(octoDir, sessionID, "thumbnails")
    // 先看目录是否存在（大多数会话没有 thumbnails），避免对每个会话都查一次库。
    if (!(await stat(thumbnails).then(() => true, () => false))) continue
    if (!sessionThumbnailsOrphaned(directory, sessionID)) continue
    await rm(thumbnails, { recursive: true, force: true })
    removed++
  }
  return removed
}

// 墓碑回收：对应 generation 已被删除（如会话删除后级联清理）时，backfill 不可能再把它物化回来，
// 墓碑失去意义即可清理。deleteStudioHistoryMedia 只为历史表中真实存在的媒体写墓碑，
// 因此 generation_id 恒非空；SQL 的 `NOT IN` 遇 NULL 不匹配，空值行自然被保守保留。
export function pruneStudioHistoryExcluded(directory: string): number {
  return Database.use((db) =>
    db
      .delete(StudioHistoryExcludedTable)
      .where(and(
        eq(StudioHistoryExcludedTable.directory, directory),
        notInArray(
          StudioHistoryExcludedTable.generation_id,
          db
            .select({ id: StudioGenerationTable.id })
            .from(StudioGenerationTable)
            .where(eq(StudioGenerationTable.directory, directory)),
        ),
      ))
      .returning({ media_id: StudioHistoryExcludedTable.media_id })
      .all()
      .length,
  )
}

export function listStudioHistoryExcludedIds(directory: string): string[] {
  return Database.use((db) =>
    db.select({ media_id: StudioHistoryExcludedTable.media_id })
      .from(StudioHistoryExcludedTable)
      .where(eq(StudioHistoryExcludedTable.directory, directory))
      .all(),
  ).map((row) => row.media_id)
}
