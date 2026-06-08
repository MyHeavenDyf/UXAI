import { executeJimengImageGenerate, summarizeJimengOutput } from "@/tool/jimeng_image_generate"
import {
  createInternalGeneration,
  queryInternalGeneration,
  summarizeInternalOutput,
} from "@/tool/internel_image_generate"
import * as Database from "@/storage/db"
import { and, eq, inArray, lte } from "@/storage/db"
import { MessageV2 } from "@/session/message-v2"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { MessageTable, PartTable, SessionTable } from "@/session/session.sql"
import { ModelID, ProviderID } from "@/provider/schema"
import { SyncEvent } from "@/sync"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import { registerDisposer } from "@/effect/instance-registry"
import type { ImageGenerationQuery, ImageGenerationTask, ImageGenerateOutput, StudioCapability } from "./image-provider"
import { StudioGenerationTable, type StudioGenerationStatus } from "./studio-generation.sql"

type StudioProvider = "jimeng" | "internel"
type StudioPersistedTurn = {
  assistantInfo: MessageV2.Assistant
  toolPart: MessageV2.ToolPart & { state: MessageV2.ToolStateRunning }
}

type StudioGenerationRecord = typeof StudioGenerationTable.$inferSelect

export type StudioGenerationRequest = {
  sessionID?: string
  capability: StudioCapability
  prompt: string
  styleModel?: string
  aspectRatio?: string
  count?: number
  imageTool?: StudioProvider
  referenceImages?: string[]
  sourceImage?: string
  extra?: Record<string, unknown>
}

export type StudioGenerationResult = {
  id: string
  status: StudioGenerationStatus
  capability: StudioCapability
  prompt: string
  provider: StudioProvider
  toolAction?: "generate_image" | "generate_video" | "super_resolution" | "cutout" | "inpainting" | "outpainting"
  taskType?: string
  task_type?: string
  taskId?: string
  model: string
  aspectRatio: string
  videoMode?: "text" | "first_last_frame"
  duration?: "5" | "10"
  videoQualityMode?: "std" | "pro"
  images: { id: string; kind?: "image" | "video"; url: string; thumbnailUrl?: string; remoteUrl?: string; width?: number; height?: number; duration?: number }[]
  request?: unknown
  response?: unknown
  rawBody?: string
  error?: string
  createdAt: number
  progress: number
  order?: number
  rawStatus?: number | string
  updatedAt: number
  completedAt?: number
}

export type StudioGenerationAccepted = Pick<
  StudioGenerationResult,
  "id" | "status" | "capability" | "prompt" | "provider" | "model" | "aspectRatio" | "images" | "progress" | "order" | "rawStatus" | "createdAt" | "updatedAt"
> & {
  sessionID: string
}

function resolveProvider(input: StudioGenerationRequest): StudioProvider {
  if (input.capability !== "image.generate") return "internel"
  if (input.imageTool) return input.imageTool
  if (input.extra?.imageTool === "internel") return "internel"
  return "jimeng"
}

function toolActionForCapability(capability: StudioCapability) {
  if (capability === "video.generate") return "generate_video"
  if (capability === "image.upscale") return "super_resolution"
  if (capability === "image.cutout") return "cutout"
  if (capability === "image.inpaint") return "inpainting"
  if (capability === "image.outpaint") return "outpainting"
  return "generate_image"
}

function isVideoKind(kind?: string) {
  return kind === "video"
}

function videoMode(input: StudioGenerationRequest) {
  const value = input.extra?.videoMode
  if (value === "text" || value === "first_last_frame") return value
  return (input.referenceImages?.length ?? 0) > 0 ? "first_last_frame" : "text"
}

function videoDuration(input: StudioGenerationRequest) {
  const value = input.extra?.duration
  return value === "10" ? "10" : "5"
}

function videoQualityMode(input: StudioGenerationRequest) {
  const value = input.extra?.mode
  return value === "pro" ? "pro" : "std"
}

function buildAssistantText(input: StudioGenerationRequest) {
  if (input.capability === "video.generate") {
    return [
      `我将为您创作${input.prompt}。`,
      input.aspectRatio ? `画幅比例设为 ${input.aspectRatio}` : undefined,
      "。",
    ]
      .filter((item): item is string => Boolean(item))
      .join("")
  }
  return [
    `我将为您创作${input.prompt}。`,
    input.styleModel ? `采用“${input.styleModel}”风格` : undefined,
    input.aspectRatio ? `画幅比例设为 ${input.aspectRatio}` : undefined,
    input.sourceImage ? "并在上一轮图片基础上继续编辑。" : "。",
  ]
    .filter((item): item is string => Boolean(item))
    .join("")
}

function resultSummary(input: { provider: StudioProvider; raw: unknown; rawBody?: string }) {
  return input.provider === "internel"
    ? summarizeInternalOutput(input.raw, input.rawBody)
    : summarizeJimengOutput(input.raw, input.rawBody)
}

function toolName(provider: StudioProvider) {
  return provider === "internel" ? "internel_image_generate" : "jimeng_image_generate"
}

function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUndefined)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, stripUndefined(item)]),
  )
}

function persistStudioSession(input: {
  generationID: string
  sessionID: SessionID
  request: StudioGenerationRequest
  provider: StudioProvider
  createdAt: number
}): StudioPersistedTurn | undefined {
  const session = Database.use((db) =>
    db.select().from(SessionTable).where(eq(SessionTable.id, input.sessionID)).get(),
  )
  if (!session) return

  const userID = MessageID.ascending()
  const assistantID = MessageID.ascending()
  const userTextPartID = PartID.ascending()
  const assistantTextPartID = PartID.ascending()
  const toolPartID = PartID.ascending()
  const assistantText = buildAssistantText(input.request)
  const providerID = session.model ? ProviderID.make(session.model.providerID) : ProviderID.make("octo_studio")
  const modelID = session.model ? ModelID.make(session.model.id) : ModelID.make("octo_studio")
  const modelVariant = session.model?.variant
  const userInfo: MessageV2.User = {
    id: userID,
    sessionID: input.sessionID,
    role: "user",
    time: { created: input.createdAt },
    agent: session.agent ?? "octo_studio",
    model: {
      providerID,
      modelID,
      variant: modelVariant,
    },
  }
  const assistantInfo: MessageV2.Assistant = {
    id: assistantID,
    sessionID: input.sessionID,
    role: "assistant",
    time: { created: input.createdAt },
    parentID: userID,
    modelID,
    providerID,
    mode: "octo_studio",
    agent: "octo_studio",
    path: {
      cwd: session.directory,
      root: session.directory,
    },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    finish: "tool-calls",
    variant: modelVariant,
  }
  const userTextPart: MessageV2.TextPart = {
    id: userTextPartID,
    sessionID: input.sessionID,
    messageID: userID,
    type: "text",
    text: input.request.prompt,
  }
  const assistantTextPart: MessageV2.TextPart = {
    id: assistantTextPartID,
    sessionID: input.sessionID,
    messageID: assistantID,
    type: "text",
    text: assistantText,
  }
  const toolPart: StudioPersistedTurn["toolPart"] = {
    id: toolPartID,
    sessionID: input.sessionID,
    messageID: assistantID,
    type: "tool",
    callID: `studio_${toolPartID}`,
    tool: toolName(input.provider),
    state: {
      status: "running",
      input: {
        capability: input.request.capability,
        prompt: input.request.prompt,
        styleModel: input.request.styleModel,
        aspectRatio: input.request.aspectRatio,
        count: input.request.count,
        referenceImages: input.request.referenceImages,
        sourceImage: input.request.sourceImage,
        extra: input.request.extra,
      },
      title: "图片生成",
      metadata: {
        studio: {
          generationID: input.generationID,
          status: "queued",
          progress: 0,
        },
      },
      time: { start: input.createdAt },
    },
  }

  SyncEvent.run(MessageV2.Event.Updated, { sessionID: input.sessionID, info: userInfo })
  SyncEvent.run(MessageV2.Event.Updated, { sessionID: input.sessionID, info: assistantInfo })
  SyncEvent.run(MessageV2.Event.PartUpdated, { sessionID: input.sessionID, part: userTextPart, time: input.createdAt })
  SyncEvent.run(MessageV2.Event.PartUpdated, { sessionID: input.sessionID, part: assistantTextPart, time: input.createdAt })
  SyncEvent.run(MessageV2.Event.PartUpdated, { sessionID: input.sessionID, part: toolPart, time: input.createdAt })
  Database.use((db) =>
    db.update(SessionTable).set({ time_updated: input.createdAt }).where(eq(SessionTable.id, input.sessionID)).run(),
  )
  return {
    assistantInfo,
    toolPart,
  }
}

function completeStudioSession(input: {
  sessionID: SessionID
  turn: StudioPersistedTurn
  result: StudioGenerationResult & { completedAt: number }
}) {
  const assistantInfo: MessageV2.Assistant = {
    ...input.turn.assistantInfo,
    time: {
      ...input.turn.assistantInfo.time,
      completed: input.result.completedAt,
    },
  }
  const toolPart: MessageV2.ToolPart = {
    ...input.turn.toolPart,
    state: {
      status: "completed",
      title: "图片生成",
      input: input.turn.toolPart.state.input,
      output: JSON.stringify(
        {
          ok: true,
          provider: input.result.provider,
          capability: input.result.capability,
          toolAction: input.result.toolAction ?? toolActionForCapability(input.result.capability),
          taskId: input.result.taskId,
          model: input.result.model,
          aspectRatio: input.result.aspectRatio,
          videoMode: input.result.videoMode,
          duration: input.result.duration,
          videoQualityMode: input.result.videoQualityMode,
          width: input.result.images[0]?.width,
          height: input.result.images[0]?.height,
          imageCount: input.result.images.length,
          images: input.result.images.filter((image) => !isVideoKind(image.kind)).map((image) => image.remoteUrl ?? image.url),
          videos: input.result.images.filter((image) => isVideoKind(image.kind)).map((image) => image.remoteUrl ?? image.url),
          primaryImage: input.result.images.find((image) => !isVideoKind(image.kind))?.remoteUrl ?? input.result.images.find((image) => !isVideoKind(image.kind))?.url ?? null,
          primaryVideo: input.result.images.find((image) => isVideoKind(image.kind))?.remoteUrl ?? input.result.images.find((image) => isVideoKind(image.kind))?.url ?? null,
          progress: input.result.progress,
          order: input.result.order,
          rawStatus: input.result.rawStatus,
          response: input.result.response,
        },
        null,
        2,
      ),
      metadata: stripUndefined({
        request: input.result.request,
        response: input.result.response,
        statusCode: 200,
        studio: {
          generationID: input.result.id,
          status: "succeeded",
          rawStatus: input.result.rawStatus,
          progress: 100,
        },
      }) as Record<string, unknown>,
      time: {
        start: input.turn.toolPart.state.time.start,
        end: input.result.completedAt,
      },
      attachments: input.result.images.map((image, index) => ({
        id: PartID.ascending(),
        sessionID: input.sessionID,
        messageID: input.turn.toolPart.messageID,
        type: "file" as const,
        mime: isVideoKind(image.kind) ? "video/mp4" : "image/png",
        filename: `${input.result.prompt.slice(0, 24).replace(/[\\/:*?"<>|]/g, "-") || (isVideoKind(image.kind) ? "studio-video" : "studio-image")}-${index + 1}.${isVideoKind(image.kind) ? "mp4" : "png"}`,
        url: image.remoteUrl ?? image.url,
      })),
    },
  }
  SyncEvent.run(MessageV2.Event.Updated, { sessionID: input.sessionID, info: assistantInfo })
  SyncEvent.run(MessageV2.Event.PartUpdated, { sessionID: input.sessionID, part: toolPart, time: input.result.completedAt })
  Database.use((db) =>
    db.update(SessionTable).set({ time_updated: input.result.completedAt }).where(eq(SessionTable.id, input.sessionID)).run(),
  )
}

function failStudioSession(input: {
  sessionID: SessionID
  turn: StudioPersistedTurn
  error: unknown
}) {
  const completedAt = Date.now()
  const message = input.error instanceof Error ? input.error.message : String(input.error)
  const assistantInfo: MessageV2.Assistant = {
    ...input.turn.assistantInfo,
    time: {
      ...input.turn.assistantInfo.time,
      completed: completedAt,
    },
    finish: "error",
  }
  const toolPart: MessageV2.ToolPart = {
    ...input.turn.toolPart,
    state: {
      status: "error",
      input: input.turn.toolPart.state.input,
      error: message,
      metadata: {
        ...input.turn.toolPart.state.metadata,
        statusCode: 500,
        studio: {
          ...((input.turn.toolPart.state.metadata?.studio as Record<string, unknown> | undefined) ?? {}),
          status: "failed",
        },
      },
      time: {
        start: input.turn.toolPart.state.time.start,
        end: completedAt,
      },
    },
  }
  SyncEvent.run(MessageV2.Event.Updated, { sessionID: input.sessionID, info: assistantInfo })
  SyncEvent.run(MessageV2.Event.PartUpdated, { sessionID: input.sessionID, part: toolPart, time: completedAt })
  Database.use((db) =>
    db.update(SessionTable).set({ time_updated: completedAt }).where(eq(SessionTable.id, input.sessionID)).run(),
  )
}

function generationRequest(record: StudioGenerationRecord) {
  const data = record.request as { input?: StudioGenerationRequest; task?: ImageGenerationTask }
  if (!data.input) throw new Error(`Studio generation ${record.id} has no request input.`)
  return data as { input: StudioGenerationRequest; task?: ImageGenerationTask }
}

function loadPersistedTurn(record: StudioGenerationRecord): StudioPersistedTurn {
  const assistant = Database.use((db) =>
    db.select({ data: MessageTable.data }).from(MessageTable).where(eq(MessageTable.id, record.assistant_message_id)).get(),
  )
  const part = Database.use((db) =>
    db.select({ data: PartTable.data }).from(PartTable).where(eq(PartTable.id, record.tool_part_id)).get(),
  )
  if (!assistant || !part) throw new Error(`Studio generation ${record.id} session turn is missing.`)
  const assistantInfo = { ...assistant.data, id: record.assistant_message_id, sessionID: record.session_id } as MessageV2.Assistant
  const toolPart = {
    ...part.data,
    id: record.tool_part_id,
    sessionID: record.session_id,
    messageID: record.assistant_message_id,
  } as MessageV2.ToolPart
  if (toolPart.state.status !== "running") throw new Error(`Studio generation ${record.id} tool part is not running.`)
  return {
    assistantInfo,
    toolPart: toolPart as MessageV2.ToolPart & { state: MessageV2.ToolStateRunning },
  }
}

function generationSnapshot(record: StudioGenerationRecord): StudioGenerationAccepted {
  const data = generationRequest(record)
  const result = record.result as StudioGenerationResult | undefined
  return {
    id: record.id,
    sessionID: record.session_id,
    status: record.status,
    capability: record.capability,
    prompt: data.input.prompt,
    provider: record.provider,
    model: result?.model ?? data.input.styleModel ?? "internel",
    aspectRatio: result?.aspectRatio ?? data.input.aspectRatio ?? "3:4",
    images: result?.images ?? [],
    progress: record.progress,
    order: record.queue_order ?? undefined,
    rawStatus: record.raw_status ?? undefined,
    createdAt: record.time_created,
    updatedAt: record.time_updated,
  }
}

function updateStudioGenerationProgress(record: StudioGenerationRecord, query: ImageGenerationQuery) {
  const turn = loadPersistedTurn(record)
  const toolPart: MessageV2.ToolPart = {
    ...turn.toolPart,
    state: {
      ...turn.toolPart.state,
      metadata: {
        ...turn.toolPart.state.metadata,
        studio: {
          generationID: record.id,
          status: query.status,
          rawStatus: query.rawStatus,
          progress: query.progress,
          order: query.order,
        },
      },
    },
  }
  SyncEvent.run(MessageV2.Event.PartUpdated, {
    sessionID: record.session_id,
    part: toolPart,
    time: Date.now(),
  })
}

function buildGenerationResult(
  record: StudioGenerationRecord,
  output: ImageGenerationQuery | ImageGenerateOutput,
) {
  const input = generationRequest(record).input
  const completedAt = Date.now()
  return stripUndefined({
    id: record.id,
    status: "succeeded",
    capability: input.capability,
    prompt: input.prompt,
    provider: output.provider,
    toolAction: output.toolAction ?? toolActionForCapability(input.capability),
    taskId: output.taskId,
    model: output.model,
    aspectRatio: input.aspectRatio ?? "3:4",
    ...(input.capability === "video.generate"
      ? {
          videoMode: videoMode(input),
          duration: videoDuration(input),
          videoQualityMode: videoQualityMode(input),
        }
      : {}),
    images: output.images.map((image, index) => ({
      id: `studio_img_${record.id}_${index}`,
      ...(image.kind ? { kind: image.kind } : {}),
      url: image.url,
      thumbnailUrl: image.thumbnailUrl ?? image.url,
      remoteUrl: image.url,
      ...(image.width !== undefined ? { width: image.width } : {}),
      ...(image.height !== undefined ? { height: image.height } : {}),
      ...(image.duration !== undefined ? { duration: image.duration } : {}),
    })),
    request: stripUndefined(output.request),
    response: stripUndefined(resultSummary({ provider: record.provider, raw: output.raw, rawBody: output.rawBody })),
    progress: 100,
    rawStatus: "rawStatus" in output ? output.rawStatus : 2,
    createdAt: record.time_created,
    updatedAt: completedAt,
    completedAt,
  }) as StudioGenerationResult & { completedAt: number }
}

async function failGeneration(record: StudioGenerationRecord, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  Database.use((db) =>
    db
      .update(StudioGenerationTable)
      .set({
        status: "failed",
        error: message,
        completed_at: Date.now(),
        next_poll_at: Number.MAX_SAFE_INTEGER,
        time_updated: Date.now(),
      })
      .where(eq(StudioGenerationTable.id, record.id))
      .run(),
  )
  failStudioSession({ sessionID: record.session_id, turn: loadPersistedTurn(record), error })
}

async function completeGeneration(record: StudioGenerationRecord, output: ImageGenerationQuery | ImageGenerateOutput) {
  if (output.images.length === 0) {
    throw new Error(
      [
        `${record.provider} image generation returned no image URLs.`,
        `request=${JSON.stringify(output.request)}`,
        `response=${JSON.stringify(resultSummary({ provider: record.provider, raw: output.raw, rawBody: output.rawBody }))}`,
      ].join("\n"),
    )
  }
  const result = buildGenerationResult(record, output)
  completeStudioSession({ sessionID: record.session_id, turn: loadPersistedTurn(record), result })
  Database.use((db) =>
    db
      .update(StudioGenerationTable)
      .set({
        status: "succeeded",
        raw_status: String(result.rawStatus ?? 2),
        progress: 100,
        queue_order: null,
        result: result as unknown as Record<string, unknown>,
        completed_at: result.completedAt,
        next_poll_at: Number.MAX_SAFE_INTEGER,
        time_updated: result.completedAt,
      })
      .where(eq(StudioGenerationTable.id, record.id))
      .run(),
  )
}

async function processGeneration(record: StudioGenerationRecord) {
  try {
    if (Date.now() - record.time_created > 30 * 60_000) {
      throw new Error(`Studio generation timed out after 30 minutes. id=${record.id}`)
    }
    const data = generationRequest(record)
    if (record.provider === "jimeng") {
      await completeGeneration(
        record,
        await executeJimengImageGenerate({
          capability: data.input.capability,
          prompt: data.input.prompt,
          styleModel: data.input.styleModel,
          aspectRatio: data.input.aspectRatio,
          count: data.input.count,
          referenceImages: data.input.referenceImages,
          sourceImage: data.input.sourceImage,
          extra: data.input.extra,
        }),
      )
      return
    }

    const task = data.task ?? await createInternalGeneration({
      capability: data.input.capability,
      prompt: data.input.prompt,
      styleModel: data.input.styleModel,
      aspectRatio: data.input.aspectRatio,
      count: data.input.count,
      referenceImages: data.input.referenceImages,
      sourceImage: data.input.sourceImage,
      extra: data.input.extra,
    })
    if (!data.task) {
      Database.use((db) =>
        db
          .update(StudioGenerationTable)
          .set({
            provider_task_id: task.taskId,
            request: stripUndefined({ input: data.input, task }) as Record<string, unknown>,
            status: "running",
            time_updated: Date.now(),
          })
          .where(eq(StudioGenerationTable.id, record.id))
          .run(),
      )
    }
    const query = await queryInternalGeneration(task)
    updateStudioGenerationProgress(record, query)
    if (query.status === "succeeded") {
      await completeGeneration(record, query)
      return
    }
    if (query.status === "failed") {
      throw new Error(`query_task returned failure. taskId=${task.taskId} status=${query.rawStatus}`)
    }
    Database.use((db) =>
      db
        .update(StudioGenerationTable)
        .set({
          status: query.status,
          raw_status: String(query.rawStatus),
          progress: query.progress,
          queue_order: query.order,
          poll_attempts: record.poll_attempts + 1,
          next_poll_at: Date.now() + (query.status === "queued" ? 4000 : 2500),
          time_updated: Date.now(),
        })
        .where(eq(StudioGenerationTable.id, record.id))
        .run(),
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (
      Date.now() - record.time_created < 30 * 60_000 &&
      (/network failed/i.test(message) || /status=(408|409|425|429|500|502|503|504)/.test(message))
    ) {
      Database.use((db) =>
        db
          .update(StudioGenerationTable)
          .set({
            error: message,
            poll_attempts: record.poll_attempts + 1,
            next_poll_at: Date.now() + Math.min(30_000, 1000 * 2 ** Math.min(record.poll_attempts, 5)),
            time_updated: Date.now(),
          })
          .where(eq(StudioGenerationTable.id, record.id))
          .run(),
      )
      return
    }
    await failGeneration(record, error)
  }
}

const workerTimers = new Map<string, ReturnType<typeof setInterval>>()
const activeGenerations = new Set<string>()

async function tickStudioGenerationWorker(directory: string) {
  const now = Date.now()
  const records = Database.use((db) =>
    db
      .select()
      .from(StudioGenerationTable)
      .where(
        and(
          eq(StudioGenerationTable.directory, directory),
          inArray(StudioGenerationTable.status, ["queued", "running"]),
          lte(StudioGenerationTable.next_poll_at, now),
        ),
      )
      .limit(4)
      .all(),
  )
  await Promise.all(
    records
      .filter((record) => !activeGenerations.has(record.id))
      .map(async (record) => {
        const claimed = Database.transaction(
          (db) => {
            const current = db
              .select({ next_poll_at: StudioGenerationTable.next_poll_at })
              .from(StudioGenerationTable)
              .where(eq(StudioGenerationTable.id, record.id))
              .get()
            if (!current || current.next_poll_at > now) return false
            db
              .update(StudioGenerationTable)
              .set({ next_poll_at: now + 60_000, time_updated: now })
              .where(eq(StudioGenerationTable.id, record.id))
              .run()
            return true
          },
          { behavior: "immediate" },
        )
        if (!claimed) return
        activeGenerations.add(record.id)
        await processGeneration(record).finally(() => activeGenerations.delete(record.id))
      }),
  )
}

export function startStudioGenerationWorker() {
  const directory = Instance.directory
  if (workerTimers.has(directory)) return
  const tick = Instance.bind(() => tickStudioGenerationWorker(directory).catch((error) => {
    console.error("[studio.worker] tick failed", error)
  }))
  workerTimers.set(directory, setInterval(tick, 1000))
  void tick()
}

registerDisposer(async (directory) => {
  const timer = workerTimers.get(directory)
  if (!timer) return
  clearInterval(timer)
  workerTimers.delete(directory)
})

export async function createGeneration(input: StudioGenerationRequest): Promise<StudioGenerationAccepted> {
  const sessionID = SessionID.zod.parse(input.sessionID)
  const session = Database.use((db) =>
    db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get(),
  )
  if (!session) throw new Error(`Studio session not found: ${sessionID}`)
  if (session.directory !== Instance.directory) throw new Error(`Studio session does not belong to the current directory: ${sessionID}`)
  const createdAt = Date.now()
  const id = Identifier.create("studio_gen", "ascending")
  const provider = resolveProvider(input)
  const turn = persistStudioSession({
    generationID: id,
    sessionID,
    request: input,
    provider,
    createdAt,
  })
  if (!turn) throw new Error(`Unable to create Studio session turn: ${sessionID}`)
  Database.use((db) =>
    db.insert(StudioGenerationTable).values({
      id,
      session_id: sessionID,
      directory: session.directory,
      assistant_message_id: turn.assistantInfo.id,
      tool_part_id: turn.toolPart.id,
      provider,
      capability: input.capability,
      status: "queued",
      progress: 0,
      request: stripUndefined({ input }) as Record<string, unknown>,
      next_poll_at: createdAt,
      time_created: createdAt,
      time_updated: createdAt,
    }).run(),
  )
  startStudioGenerationWorker()
  const record = Database.use((db) =>
    db
      .select()
      .from(StudioGenerationTable)
      .where(and(eq(StudioGenerationTable.id, id), eq(StudioGenerationTable.directory, Instance.directory)))
      .get(),
  )
  if (!record) throw new Error(`Unable to load Studio generation: ${id}`)
  return generationSnapshot(record)
}

export async function getGeneration(id: string): Promise<StudioGenerationResult & { sessionID: string }> {
  const record = Database.use((db) =>
    db
      .select()
      .from(StudioGenerationTable)
      .where(and(eq(StudioGenerationTable.id, id), eq(StudioGenerationTable.directory, Instance.directory)))
      .get(),
  )
  if (!record) throw new Error(`Studio generation not found: ${id}`)
  const snapshot = generationSnapshot(record)
  return {
    ...snapshot,
    ...(record.result as StudioGenerationResult | undefined),
    sessionID: record.session_id,
    status: record.status,
    progress: record.progress,
    order: record.queue_order ?? undefined,
    rawStatus: record.raw_status ?? undefined,
    error: record.error ?? undefined,
    updatedAt: record.time_updated,
    completedAt: record.completed_at ?? undefined,
  }
}
