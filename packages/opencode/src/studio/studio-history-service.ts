import * as Database from "@/storage/db"
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, notInArray, or, sql } from "@/storage/db"
import { readdir, rm, stat } from "node:fs/promises"
import path from "path"
import type { SessionID } from "@/session/schema"
import { SessionTable } from "@/session/session.sql"
import { StudioGenerationTable } from "./studio-generation.sql"
import { StudioHistoryExcludedTable, StudioHistoryTable } from "./studio-history.sql"
import { resolveStudioVideoQualityMode } from "./image-provider"

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
  resolution?: string
  aspectRatio?: string
  capability?: string
  duration?: string
  createdAt: number
  // 生成级文案字段：从 studio_generation.result/request.input 复制而来,
  // 会话删除级联清理 studio_generation 后,这些字段支撑详情面板复原。
  prompt?: string
  displayPrompt?: string
  detailPrompt?: string
  detailTitle?: string
  model?: string
  styleModel?: string
  provider?: string
  videoMode?: string
  videoQualityMode?: string
  toolAction?: string
  isCustom?: boolean
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

// SQLite 单条语句的绑定参数有上限（默认 32766），历史行每行 28 列，
// 一次性 upsert 约 1100 行就会触发 "too many SQL variables"，必须分块。
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

function videoResolution(input: unknown, fallback?: unknown) {
  const quality = resolveStudioVideoQualityMode(input, fallback)
  if (!quality) return undefined
  return quality === "4k" ? "4K" : `${quality}P`
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

// 生成级文案字段：优先从 result 取（终态写入），其次从 request.input 取（入参）。
// model: result.model 优先,fallback 到 input.styleModel,与 studio-service 快照逻辑一致。
// backfill 修复存量行时与物化共用同一份解析，保证两条路径写入的值一致。
function historyTextFields(result: Record<string, unknown> | undefined, input: unknown) {
  const inputRecord = input && typeof input === "object" ? input as Record<string, unknown> : undefined
  const stringField = (src: Record<string, unknown> | undefined, key: string): string | undefined =>
    src && typeof src[key] === "string" ? src[key] as string : undefined
  const styleModel = stringField(inputRecord, "styleModel")
  return {
    prompt: stringField(inputRecord, "prompt"),
    displayPrompt: stringField(inputRecord, "displayPrompt"),
    // 旧数据/部分路径没有持久化 detailPrompt，回退到用户展示文案，避免详情面板"提示词"显示 "-"。
    detailPrompt: stringField(inputRecord, "detailPrompt") ?? stringField(inputRecord, "displayPrompt"),
    detailTitle: stringField(inputRecord, "detailTitle"),
    styleModel,
    model: stringField(result, "model") ?? styleModel,
    provider: stringField(result, "provider"),
    videoMode: stringField(result, "videoMode"),
    videoQualityMode: stringField(result, "videoQualityMode"),
    toolAction: stringField(result, "toolAction"),
    isCustom: typeof result?.isCustom === "boolean" ? result.isCustom : undefined,
  }
}

function extractMediaFromResult(
  result: Record<string, unknown> | undefined,
  sessionId: string,
  createdAt: number,
  input?: unknown,
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
  const text = historyTextFields(result, input)

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
      resolution: kind === "video" ? videoResolution(input, result.videoQualityMode) : undefined,
      aspectRatio,
      capability,
      duration,
      createdAt,
      ...text,
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
    resolution: item.resolution ?? null,
    ratio: mediaRatio(item.aspectRatio, item.width, item.height) ?? null,
    capability: item.capability ?? null,
    duration: item.duration ?? null,
    created_at: item.createdAt,
    prompt: item.prompt ?? null,
    display_prompt: item.displayPrompt ?? null,
    detail_prompt: item.detailPrompt ?? null,
    detail_title: item.detailTitle ?? null,
    model: item.model ?? null,
    style_model: item.styleModel ?? null,
    provider: item.provider ?? null,
    video_mode: item.videoMode ?? null,
    video_quality_mode: item.videoQualityMode ?? null,
    tool_action: item.toolAction ?? null,
    is_custom: item.isCustom === undefined ? null : (item.isCustom ? 1 : 0),
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
    prompt: row.prompt ?? undefined,
    displayPrompt: row.display_prompt ?? undefined,
    detailPrompt: row.detail_prompt ?? undefined,
    detailTitle: row.detail_title ?? undefined,
    model: row.model ?? undefined,
    styleModel: row.style_model ?? undefined,
    provider: row.provider ?? undefined,
    videoMode: row.video_mode ?? undefined,
    videoQualityMode: row.video_quality_mode ?? undefined,
    toolAction: row.tool_action ?? undefined,
    isCustom: row.is_custom === null ? undefined : row.is_custom === 1,
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
            // 文案字段同样在 upsert 时刷新,保证 backfill/snapshot 能补齐旧数据缺字段。
            prompt: sql`excluded.prompt`,
            display_prompt: sql`excluded.display_prompt`,
            detail_prompt: sql`excluded.detail_prompt`,
            detail_title: sql`excluded.detail_title`,
            model: sql`excluded.model`,
            style_model: sql`excluded.style_model`,
            provider: sql`excluded.provider`,
            video_mode: sql`excluded.video_mode`,
            video_quality_mode: sql`excluded.video_quality_mode`,
            tool_action: sql`excluded.tool_action`,
            is_custom: sql`excluded.is_custom`,
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
      row.request.input,
    ),
  )
}

// 从历史表复原 generation 详情:会话删除会级联清理 studio_generation,
// 历史表里仍保留的行可以让 /studio/generations/:id 在 generation 行不存在时
// 回退出一份"够用"的快照,让详情面板能展示文案与媒体信息,而不是 404。
export type StudioGenerationHistorySnapshot = {
  id: string
  sessionID: string
  capability?: string
  prompt?: string
  displayPrompt?: string
  detailPrompt?: string
  detailTitle?: string
  model?: string
  styleModel?: string
  provider?: string
  aspectRatio?: string
  videoMode?: string
  videoQualityMode?: string
  toolAction?: string
  isCustom?: boolean
  duration?: string
  createdAt: number
  images: Array<{
    id: string
    mediaIndex: number
    kind: "image" | "video"
    url: string
    thumbnailUrl?: string
    thumbnailStatus?: string
    width?: number
    height?: number
  }>
}

export function generationHistorySnapshot(directory: string, generationID: string): StudioGenerationHistorySnapshot | undefined {
  const rows = Database.use((db) =>
    db
      .select()
      .from(StudioHistoryTable)
      .where(and(
        eq(StudioHistoryTable.directory, directory),
        eq(StudioHistoryTable.generation_id, generationID),
      ))
      .orderBy(asc(StudioHistoryTable.media_index))
      .all(),
  )
  if (rows.length === 0) return undefined
  const first = rows[0]
  if (!first) return undefined
  const items = rows.map(toItem)
  const head = items[0]!
  return {
    id: generationID,
    sessionID: head.sessionID,
    capability: head.capability,
    prompt: head.prompt,
    displayPrompt: head.displayPrompt,
    // 历史行可能未存 detailPrompt（旧数据），回退到展示文案/提示词，供详情面板复用。
    detailPrompt: head.detailPrompt ?? head.displayPrompt ?? head.prompt,
    detailTitle: head.detailTitle,
    model: head.model,
    styleModel: head.styleModel,
    provider: head.provider,
    aspectRatio: head.aspectRatio,
    videoMode: head.videoMode,
    videoQualityMode: head.videoQualityMode,
    toolAction: head.toolAction,
    isCustom: head.isCustom,
    duration: head.duration,
    createdAt: head.createdAt,
    images: items.map((item) => ({
      id: item.id,
      mediaIndex: item.mediaIndex,
      kind: item.kind,
      url: item.url,
      thumbnailUrl: item.thumbnailUrl,
      thumbnailStatus: item.thumbnailStatus,
      width: item.width,
      height: item.height,
    })),
  }
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

// 幂等修复历史视频的分辨率：旧 provider 的 std/pro 档位，以及尚未写入分辨率的行（含会话已删除、
// generation 行不存在的老数据）。每次列表/指纹查询都会调用；候选行修完后为 0，开销可忽略，
// 因此不依赖进程重启。请求档位优先，结果/历史档位兜底。
function repairLegacyVideoResolutions(directory: string) {
  Database.transaction((db) => {
    const rows = db
      .select({
        id: StudioHistoryTable.id,
        resolution: StudioHistoryTable.resolution,
        mode: StudioHistoryTable.video_quality_mode,
        request: StudioGenerationTable.request,
        result: StudioGenerationTable.result,
      })
      .from(StudioHistoryTable)
      .leftJoin(StudioGenerationTable, and(
        eq(StudioGenerationTable.id, StudioHistoryTable.generation_id),
        eq(StudioGenerationTable.directory, StudioHistoryTable.directory),
      ))
      .where(and(
        eq(StudioHistoryTable.directory, directory),
        eq(StudioHistoryTable.kind, "video"),
        // 只挑还没写入分辨率的行：缺失时用请求/结果/历史档位补齐；修完后即离开候选集。
        isNull(StudioHistoryTable.resolution),
        isNotNull(StudioHistoryTable.video_quality_mode),
      ))
      .all()
    const updates = rows.flatMap((row) => {
      const resolution = videoResolution(row.request?.input, row.result?.videoQualityMode ?? row.mode) ?? null
      return resolution ? [{ id: row.id, resolution }] : []
    })
    if (updates.length === 0) return
    const latest = db.select({ updated: sql<number | null>`max(${StudioHistoryTable.time_updated})` })
      .from(StudioHistoryTable)
      .where(eq(StudioHistoryTable.directory, directory))
      .get()
    const updated = Math.max(Date.now(), (latest?.updated ?? 0) + 1)
    for (const row of updates) {
      db.update(StudioHistoryTable)
        .set({ resolution: row.resolution, time_updated: updated })
        .where(and(eq(StudioHistoryTable.directory, directory), eq(StudioHistoryTable.id, row.id)))
        .run()
    }
  })
}

// 修复历史行的比例：旧实现按长边/短边分桶（竖版 3:4/9:16/2:3 被写成横版 4:3/16:9/3:2），
// 且没有容差与「自定义」档，写错后没有任何路径重算 ratio，表现为详情面板显示 3:4 但筛选 3:4 落空。
// 比例可直接由行内 aspect_ratio/width/height 重算，不依赖 generation 行，会话已删除的历史也能修。
// 只对「旧实现写坏」的存量行有意义：新行一律经 toRow/mediaRatio 写入正确值，之后不存在再写错值的路径。
// 因此放进一次性回填守卫（见 backfillStudioHistory），否则候选集永远无法收敛（缺比例信息的行会一直命中），
// 每次列表/指纹查询都要全表扫描并逐行重算。
function repairLegacyRatios(directory: string) {
  Database.transaction((db) => {
    const rows = db
      .select({
        id: StudioHistoryTable.id,
        aspectRatio: StudioHistoryTable.aspect_ratio,
        width: StudioHistoryTable.width,
        height: StudioHistoryTable.height,
        ratio: StudioHistoryTable.ratio,
      })
      .from(StudioHistoryTable)
      .where(and(
        eq(StudioHistoryTable.directory, directory),
        or(
          isNull(StudioHistoryTable.ratio),
          and(
            isNotNull(StudioHistoryTable.aspect_ratio),
            sql`${StudioHistoryTable.ratio} <> ${StudioHistoryTable.aspect_ratio}`,
          ),
          and(
            isNull(StudioHistoryTable.aspect_ratio),
            isNotNull(StudioHistoryTable.width),
          ),
        ),
      ))
      .all()
    const updates = rows.flatMap((row) => {
      const ratio = mediaRatio(row.aspectRatio ?? undefined, row.width ?? undefined, row.height ?? undefined) ?? null
      return ratio === row.ratio ? [] : [{ id: row.id, ratio }]
    })
    if (updates.length === 0) return
    const latest = db.select({ updated: sql<number | null>`max(${StudioHistoryTable.time_updated})` })
      .from(StudioHistoryTable)
      .where(eq(StudioHistoryTable.directory, directory))
      .get()
    const updated = Math.max(Date.now(), (latest?.updated ?? 0) + 1)
    for (const row of updates) {
      db.update(StudioHistoryTable)
        .set({ ratio: row.ratio, time_updated: updated })
        .where(and(eq(StudioHistoryTable.directory, directory), eq(StudioHistoryTable.id, row.id)))
        .run()
    }
  })
}

export function backfillStudioHistory(directory: string) {
  // 修复每次查询都幂等执行，避免依赖进程重启；全量回填（重且只需一次）仍走下面的缓存守卫。
  repairLegacyVideoResolutions(directory)
  if (backfilledDirectories.has(directory)) return
  // 比例修复与全量回填一样只对存量数据有意义，放进同一个一次性守卫，避免每次查询都全表扫描
  // （缺比例信息的行永远无法从候选集里消失，见 repairLegacyRatios 注释）。
  repairLegacyRatios(directory)
  // 已物化的行也需要修正：旧实现把视频分辨率按宽高分桶（通常写成 NULL），
  // 且从未写入生成级文案列。只刷新分辨率与文案列，保留缩略图和媒体状态；
  // 源任务已删除时 inner join 不命中，保留快照中的值。
  Database.transaction((db) => {
    const rows = db
      .select({
        id: StudioHistoryTable.id,
        kind: StudioHistoryTable.kind,
        resolution: StudioHistoryTable.resolution,
        prompt: StudioHistoryTable.prompt,
        display_prompt: StudioHistoryTable.display_prompt,
        detail_prompt: StudioHistoryTable.detail_prompt,
        detail_title: StudioHistoryTable.detail_title,
        model: StudioHistoryTable.model,
        style_model: StudioHistoryTable.style_model,
        provider: StudioHistoryTable.provider,
        video_mode: StudioHistoryTable.video_mode,
        video_quality_mode: StudioHistoryTable.video_quality_mode,
        tool_action: StudioHistoryTable.tool_action,
        is_custom: StudioHistoryTable.is_custom,
        request: StudioGenerationTable.request,
        result: StudioGenerationTable.result,
      })
      .from(StudioHistoryTable)
      .innerJoin(StudioGenerationTable, and(
        eq(StudioGenerationTable.id, StudioHistoryTable.generation_id),
        eq(StudioGenerationTable.directory, StudioHistoryTable.directory),
      ))
      .where(eq(StudioHistoryTable.directory, directory))
      .all()
    const updates = rows.flatMap((row) => {
      const text = historyTextFields(row.result ?? undefined, row.request?.input)
      const columns = {
        prompt: text.prompt ?? null,
        display_prompt: text.displayPrompt ?? null,
        detail_prompt: text.detailPrompt ?? null,
        detail_title: text.detailTitle ?? null,
        model: text.model ?? null,
        style_model: text.styleModel ?? null,
        provider: text.provider ?? null,
        video_mode: text.videoMode ?? null,
        video_quality_mode: text.videoQualityMode ?? null,
        tool_action: text.toolAction ?? null,
        is_custom: text.isCustom === undefined ? null : (text.isCustom ? 1 : 0),
      }
      // 分辨率只对视频重算；图片行的旧宽高标签不影响筛选（筛选强制 kind=video），保持原值。
      const resolution = row.kind === "video"
        ? (videoResolution(row.request?.input, row.result?.videoQualityMode) ?? null)
        : row.resolution
      const textChanged = (Object.keys(columns) as (keyof typeof columns)[]).some((key) => columns[key] !== row[key])
      return !textChanged && resolution === row.resolution
        ? []
        : [{ id: row.id, set: { resolution, ...columns } }]
    })
    if (updates.length === 0) return
    const latest = db.select({ updated: sql<number | null>`max(${StudioHistoryTable.time_updated})` })
      .from(StudioHistoryTable)
      .where(eq(StudioHistoryTable.directory, directory))
      .get()
    const updated = Math.max(Date.now(), (latest?.updated ?? 0) + 1)
    for (const row of updates) {
      db.update(StudioHistoryTable)
        .set({ ...row.set, time_updated: updated })
        .where(and(eq(StudioHistoryTable.directory, directory), eq(StudioHistoryTable.id, row.id)))
        .run()
    }
  })
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
      row.request.input,
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
    if (query.resolutions?.length) conditions.push(
      eq(StudioHistoryTable.kind, "video"),
      inArray(StudioHistoryTable.resolution, query.resolutions),
    )
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
      row.request.input,
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
