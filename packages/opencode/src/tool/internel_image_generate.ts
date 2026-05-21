import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import type { ImageGenerateInput, ImageGenerateOutput } from "@/studio/image-provider"

const METHOD = "POST"
const DEFAULT_CREATE_TASK_URL =
  "https://octoai-api.ucd.huawei.com/octoai-web-api/prod/aiImageGeneration/create_task"
const DEFAULT_QUERY_TASK_BASE_URL =
  "https://octoai-api.ucd.huawei.com/octoai-web-api/prod/aiImageGeneration/query_task"
const DEFAULT_USER_IDX = "l00423136"
const DEFAULT_TIMEOUT_MS = 120_000

type JsonRecord = Record<string, unknown>
type InternalTaskType = "txt2img" | "img2img"
type StudioAspectRatio = "1:1" | "2:3" | "3:4" | "9:16" | "3:2" | "4:3" | "16:9"
type InternalStyleConfig = {
  taskType: string
  tagName: string
  target: string
  targetSize: {
    width: number
    height: number
  }
  loras: Array<{
    name: string
    weight: number | string
  }>
  mode: string
}

type CreateTaskResponse = {
  resp_code?: number
  resp_msg?: string
  task_id?: string | number
  taskId?: string | number
  id?: string | number
  data?: {
    task_id?: string | number
    taskId?: string | number
    id?: string | number
    [key: string]: unknown
  }
  result?: {
    task_id?: string | number
    taskId?: string | number
    id?: string | number
    [key: string]: unknown
  }
  [key: string]: unknown
}

type QueryTaskResponse = {
  resp_code?: number
  resp_msg?: string
  code?: number
  msg?: string
  message?: string
  status?: string | number
  task_status?: string | number
  state?: string | number
  progress?: number
  data?: JsonRecord
  result?: JsonRecord & {
    task_id?: string
    task_type?: string
    status?: number
    order?: number
    progress?: number
    results?: string[]
    results_clean_bg?: string[]
    results_v2?: Array<{
      timestamp?: {
        start?: number
        end?: number
        duration?: number
        pool_name?: string
      }
      status?: number
      progress?: number
      output?: {
        image?: string
        clean_bg?: string
      }
      execution_id?: string
    }>
    estimated_completion_time?: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

const Parameters = Schema.Struct({
  prompt: Schema.String,
  styleModel: Schema.optional(Schema.String),
  aspectRatio: Schema.optional(Schema.String),
  count: Schema.optional(Schema.Number),
  referenceImages: Schema.optional(Schema.Array(Schema.String)),
  sourceImage: Schema.optional(Schema.String),
  extra: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
})

type Metadata = {
  request?: unknown
  response?: unknown
  statusCode?: number
  rawBody?: string
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRetriableHttpStatus(status: number): boolean {
  return [408, 409, 425, 429, 500, 502, 503, 504].includes(status)
}

function isRetriableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return [
    "fetch failed",
    "ECONNRESET",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT",
    "UND_ERR_BODY_TIMEOUT",
    "socket hang up",
    "The operation was aborted",
    "AbortError",
  ].some((keyword) => message.includes(keyword))
}

function getBackoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** (attempt - 1), 8000) + Math.floor(Math.random() * 500)
}

function parseJson(text: string): JsonRecord {
  try {
    return JSON.parse(text) as JsonRecord
  } catch {
    throw new Error(`Internal image API returned non-JSON response:\n${text}`)
  }
}

function isSupportedImageInput(value: string) {
  return /^(https?:\/\/\S+|data:image\/[a-z0-9.+-]+;base64,\S+)$/i.test(value)
}

export function resolveReferenceImages(input: Pick<ImageGenerateInput, "referenceImages" | "sourceImage">) {
  return [...(input.referenceImages ?? []), ...(input.sourceImage ? [input.sourceImage] : [])].filter(
    (item, index, list): item is string => !!item && isSupportedImageInput(item) && list.indexOf(item) === index,
  )
}

function collectImageUrls(value: unknown): string[] {
  if (!value) return []

  if (typeof value === "string") {
    const normalized = value.replaceAll("\\/", "/").trim()
    const parsed = (() => {
      try {
        return JSON.parse(normalized) as unknown
      } catch {
        return undefined
      }
    })()

    const direct = /^(https?:\/\/\S+|data:image\/[a-z0-9.+-]+;base64,\S+)$/i.test(normalized)
      ? [normalized]
      : []
    const embedded = [
      ...(normalized.match(/https?:\/\/[^\s"'<>\\)]+/g) ?? []),
      ...(normalized.match(/data:image\/[a-z0-9.+-]+;base64,[^\s"'<>\\)]+/gi) ?? []),
    ]

    return Array.from(new Set([...direct, ...embedded, ...collectImageUrls(parsed)])).map((url) =>
      url.replace(/[,.，。]+$/, ""),
    )
  }

  if (Array.isArray(value)) {
    return Array.from(new Set(value.flatMap((item) => collectImageUrls(item))))
  }

  if (typeof value !== "object") return []

  const record = value as JsonRecord
  const direct = [
    "ImageUrls",
    "image_urls",
    "imageUrls",
    "images",
    "result_urls",
    "urls",
    "primaryImage",
    "primary_image",
  ].flatMap((key) => collectImageUrls(record[key]))
  const nested = [
    record.result,
    record.data,
    record.output,
    record.result && typeof record.result === "object" ? (record.result as JsonRecord).result : undefined,
    record.result && typeof record.result === "object" ? (record.result as JsonRecord).data : undefined,
    record.data && typeof record.data === "object" ? (record.data as JsonRecord).result : undefined,
    record.data && typeof record.data === "object" ? (record.data as JsonRecord).data : undefined,
  ].flatMap((item) => collectImageUrls(item))

  return Array.from(new Set([...direct, ...nested]))
}

function collectBase64Images(value: unknown): string[] {
  const seen = new Set<string>()

  const walk = (item: unknown) => {
    if (typeof item === "string") {
      const normalized = item.replaceAll("\\/", "/").trim()
      if (normalized.startsWith("data:image/")) {
        seen.add(normalized)
        return
      }
      if (normalized.length >= 100 && /^[A-Za-z0-9+/=]+$/.test(normalized)) {
        seen.add(normalized)
        return
      }
      try {
        walk(JSON.parse(normalized))
      } catch {
        return
      }
      return
    }

    if (!item || typeof item !== "object") return

    if (Array.isArray(item)) {
      item.forEach(walk)
      return
    }

    const record = item as JsonRecord
    for (const key of ["binary_data_base64", "binaryDataBase64"]) {
      const field = record[key]
      if (typeof field === "string" && field.length > 0) seen.add(field)
      if (Array.isArray(field)) {
        field.forEach((entry) => {
          if (typeof entry === "string" && entry.length > 0) seen.add(entry)
        })
      }
    }

    Object.values(record).forEach(walk)
  }

  walk(value)
  return [...seen]
}

function base64ToDataUrl(value: string) {
  if (value.startsWith("data:")) return value
  return `data:image/png;base64,${value}`
}

function isRenderableImageUrl(url: string) {
  if (!url) return false
  return /^https?:\/\/\S+|^data:image\/[a-z0-9.+-]+;base64,\S+$/i.test(url)
}

export function extractInternalImages(response: QueryTaskResponse) {
  const directResults = Array.isArray(response.result?.results)
    ? response.result.results.filter((item): item is string => typeof item === "string" && item.length > 0)
    : []
  const versionedResults = Array.isArray(response.result?.results_v2)
    ? response.result.results_v2
        .map((item) => item.output?.image)
        .filter((item): item is string => typeof item === "string" && item.length > 0)
    : []
  const imageUrls = [...directResults, ...versionedResults, ...collectImageUrls(response)].filter(isRenderableImageUrl)
  const binaryImages = collectBase64Images(response).map(base64ToDataUrl).filter(isRenderableImageUrl)
  return Array.from(new Set([...imageUrls, ...binaryImages]))
}

export function summarizeInternalOutput(raw: unknown, bodyText = "") {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { bodyBytes: bodyText.length }
  }

  const record = raw as JsonRecord
  const base64Images = collectBase64Images(raw)
  return {
    code: record.code,
    status: record.status,
    message: record.message,
    requestId: record.request_id,
    timeElapsed: record.time_elapsed,
    imageUrlCount: collectImageUrls(raw).length,
    binaryImageCount: base64Images.length,
    binaryImageBytes: base64Images.map((item) => item.length),
    bodyBytes: bodyText.length,
  }
}

function getTaskId(response: CreateTaskResponse): string {
  const taskId =
    response.task_id ??
    response.taskId ??
    response.id ??
    response.data?.task_id ??
    response.data?.taskId ??
    response.data?.id ??
    response.result?.task_id ??
    response.result?.taskId ??
    response.result?.id

  if (taskId === undefined || taskId === null || taskId === "") {
    throw new Error(
      `create_task succeeded but no task_id was found in response:\n${JSON.stringify(response, null, 2)}`,
    )
  }

  return String(taskId)
}

function asStatus(value: unknown): number | string | undefined {
  return typeof value === "number" || typeof value === "string" ? value : undefined
}

function getTaskStatus(response: QueryTaskResponse): number | string {
  return (
    asStatus(response.result?.status) ??
    asStatus(response.data?.status) ??
    asStatus(response.status) ??
    asStatus(response.task_status) ??
    asStatus(response.state) ??
    ""
  )
}

function getTaskProgress(response: QueryTaskResponse): number {
  const progress = response.result?.progress ?? response.data?.progress ?? response.progress ?? 0
  return Number(progress)
}

function isSuccessResponse(response: QueryTaskResponse): boolean {
  return response.resp_code === 200 && Number(getTaskStatus(response)) === 2 && getTaskProgress(response) >= 100
}

function isFailureResponse(response: QueryTaskResponse): boolean {
  const status = Number(getTaskStatus(response))
  if (response.resp_code !== undefined && response.resp_code !== 200) return true
  return [3, 4, -1].includes(status)
}

async function createTaskWithRetry(
  createTaskUrl: string,
  createPayload: unknown,
  maxCreateRetries: number,
  createTimeoutMs: number,
): Promise<CreateTaskResponse> {
  let lastError: unknown = null

  for (let attempt = 1; attempt <= maxCreateRetries; attempt++) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), createTimeoutMs)

      const response = await fetch(createTaskUrl, {
        method: METHOD,
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(createPayload),
        signal: controller.signal,
      }).finally(() => {
        clearTimeout(timeout)
      })

      const text = await response.text()

      if (!response.ok) {
        if (isRetriableHttpStatus(response.status) && attempt < maxCreateRetries) {
          await sleep(getBackoffMs(attempt))
          continue
        }

        throw new Error(
          [
            "create_task failed.",
            `attempt=${attempt}/${maxCreateRetries}`,
            `status=${response.status}`,
            `statusText=${response.statusText}`,
            `body=${text}`,
          ].join("\n"),
        )
      }

      const json = parseJson(text) as CreateTaskResponse

      if (json.resp_code !== undefined && json.resp_code !== 200) {
        if (attempt < maxCreateRetries) {
          await sleep(getBackoffMs(attempt))
          continue
        }

        throw new Error(
          [
            "create_task returned business failure.",
            `attempt=${attempt}/${maxCreateRetries}`,
            `resp_code=${json.resp_code}`,
            `resp_msg=${json.resp_msg ?? ""}`,
            `body=${JSON.stringify(json, null, 2)}`,
          ].join("\n"),
        )
      }

      return json
    } catch (error) {
      lastError = error
      if (attempt < maxCreateRetries && isRetriableError(error)) {
        await sleep(getBackoffMs(attempt))
        continue
      }
      throw error
    }
  }

  throw new Error(`create_task failed after retries: ${String(lastError)}`)
}

async function queryTask(
  queryTaskBaseUrl: string,
  taskId: string,
): Promise<QueryTaskResponse> {
  const queryUrl = `${queryTaskBaseUrl}?task_id=${encodeURIComponent(taskId)}`
  const response = await fetch(queryUrl, {
    method: "GET",
    headers: {
      accept: "application/json, text/plain, */*",
    },
  })
  const text = await response.text()

  if (!response.ok) {
    throw new Error(
      [
        "query_task failed.",
        `status=${response.status}`,
        `statusText=${response.statusText}`,
        `body=${text}`,
      ].join("\n"),
    )
  }

  return parseJson(text) as QueryTaskResponse
}

function env(name: string) {
  return process.env[name]
}

function timeoutMsFor(name: string, fallback: number) {
  const value = Number(env(name))
  return Number.isFinite(value) && value > 0 ? value : fallback
}

const defaultInternalStyleConfig = {
  taskType: "txt2img_qwen",
  tagName: "Qwen-Image",
  target: "flux1-dev",
  targetSize: { width: 1024, height: 1024 },
  loras: [],
  mode: "performance",
} satisfies InternalStyleConfig

const internalStyleConfigs = [
  { aliases: ["千问", "qwen", "Qwen-Image"], config: defaultInternalStyleConfig },
  {
    aliases: ["BDIcon", "bd-icon", "DBID"],
    config: {
      taskType: "txt2img_v2_performance",
      tagName: "BDIcon",
      target: "flux1-dev",
      targetSize: { width: 1024, height: 1024 },
      loras: [{ name: "F.1_BDicon", weight: 0.8 }],
      mode: "performance",
    },
  },
  {
    aliases: ["质感人像", "质感人物", "portrait"],
    config: {
      taskType: "txt2img_v2_performance",
      tagName: "质感人像",
      target: "flux1-krea-dev-fp8",
      targetSize: { width: 1024, height: 1024 },
      loras: [{ name: "F.1_textured_portrait", weight: 0.8 }],
      mode: "performance",
    },
  },
  {
    aliases: ["开发者人物形象", "developer"],
    config: {
      taskType: "txt2img_v2_performance",
      tagName: "开发者人物形象",
      target: "flux1-dev",
      targetSize: { width: 1280, height: 1280 },
      loras: [{ name: "F.1_hwc3dcharacter_latest", weight: "0.8" }],
      mode: "performance",
    },
  },
  {
    aliases: ["小艺agent", "xiaoyi"],
    config: {
      taskType: "txt2img_qwen",
      tagName: "小艺agent",
      target: "flux1-dev",
      targetSize: { width: 1024, height: 1024 },
      loras: [{ name: "F.1_xiaoyi_agent", weight: 0.85 }],
      mode: "performance",
    },
  },
  {
    aliases: ["智慧3D", "smart-3d"],
    config: {
      taskType: "txt2img_v2_performance",
      tagName: "智慧3D",
      target: "flux1-dev",
      targetSize: { width: 1024, height: 1024 },
      loras: [{ name: "F.1_intelligent3d", weight: 1 }],
      mode: "hd",
    },
  },
  {
    aliases: ["抽象几何背景", "abstract"],
    config: {
      taskType: "txt2img_v2_performance",
      tagName: "抽象几何背景",
      target: "flux1-dev",
      targetSize: { width: 1024, height: 1024 },
      loras: [{ name: "F.1_abstract_wallpaper", weight: 1 }],
      mode: "performance",
    },
  },
  {
    aliases: ["云宝", "yunbao"],
    config: {
      taskType: "txt2img_v2_performance",
      tagName: "云宝",
      target: "flux1-dev",
      targetSize: { width: 1024, height: 1024 },
      loras: [{ name: "yunbao", weight: 1 }],
      mode: "performance",
    },
  },
  {
    aliases: ["H Design 3D", "HDesign", "hdesign"],
    config: {
      taskType: "txt2img_v2_performance",
      tagName: "H Design 3D",
      target: "flux1-dev",
      targetSize: { width: 1024, height: 1024 },
      loras: [{ name: "F.1_hdesign_3d", weight: 1 }],
      mode: "hd",
    },
  },
  {
    aliases: ["鸿蒙插画", "hongmeng"],
    config: {
      taskType: "txt2img_v2_performance",
      tagName: "鸿蒙插画",
      target: "flux1-dev",
      targetSize: { width: 1024, height: 1024 },
      loras: [{ name: "F.1_harmonyOSIllustration", weight: 1 }],
      mode: "performance",
    },
  },
  {
    aliases: ["H Design插画", "hdesign-illustration"],
    config: {
      taskType: "txt2img_v2_performance",
      tagName: "H Design插画",
      target: "flux1-dev",
      targetSize: { width: 1024, height: 1024 },
      loras: [{ name: "F.1_hdesign", weight: 1 }],
      mode: "performance",
    },
  },
  {
    aliases: ["3D抽象元素", "3d-abstract"],
    config: {
      taskType: "txt2img_v2_performance",
      tagName: "3D抽象元素",
      target: "flux1-dev",
      targetSize: { width: 1024, height: 1024 },
      loras: [{ name: "F.1_hwcbanner", weight: 0.8 }],
      mode: "performance",
    },
  },
] satisfies Array<{ aliases: string[]; config: InternalStyleConfig }>

export function getInternalStyleConfig(styleModel?: string) {
  return (
    internalStyleConfigs.find((item) => item.aliases.some((alias) => alias.toLowerCase() === styleModel?.trim().toLowerCase()))
      ?.config ?? defaultInternalStyleConfig
  )
}

function extractStudioToolSettings(prompt: string): JsonRecord {
  const match = prompt.match(/工具参数JSON：(\{[^\n]+\})/)
  if (!match) return {}

  try {
    return JSON.parse(match[1]!) as JsonRecord
  } catch {
    return {}
  }
}

function getStudioAspectRatio(input: ImageGenerateInput): StudioAspectRatio | undefined {
  const settings = extractStudioToolSettings(input.prompt)
  const value =
    input.aspectRatio ??
    (typeof settings.aspectRatio === "string" ? settings.aspectRatio : undefined) ??
    input.prompt.match(/画幅比例：([0-9]+:[0-9]+)/)?.[1]
  if (["1:1", "2:3", "3:4", "9:16", "3:2", "4:3", "16:9"].includes(value ?? "")) return value as StudioAspectRatio
  return undefined
}

function getStudioStyleModel(input: ImageGenerateInput) {
  const settings = extractStudioToolSettings(input.prompt)
  return (
    input.styleModel ??
    (typeof settings.styleModel === "string" ? settings.styleModel : undefined) ??
    input.prompt.match(/风格模型：([^\n]+)/)?.[1]?.trim()
  )
}

function getStudioCount(input: ImageGenerateInput) {
  const settings = extractStudioToolSettings(input.prompt)
  const value =
    input.count ??
    (typeof settings.count === "number" ? settings.count : undefined) ??
    Number(input.prompt.match(/生成数量：([1-4])/)?.[1])
  if (value === 1 || value === 2 || value === 3 || value === 4) return value
  return 1
}

function roundToMultiple(value: number, multiple: number) {
  return Math.max(multiple, Math.round(value / multiple) * multiple)
}

export function getTargetSizeForAspectRatio(base: { width: number; height: number }, aspectRatio?: string) {
  const longSide = Math.max(base.width, base.height)
  if (aspectRatio === "1:1") return { width: longSide, height: longSide }
  if (aspectRatio === "2:3") return { width: roundToMultiple(longSide * 2 / 3, 64), height: longSide }
  if (aspectRatio === "3:4") return { width: roundToMultiple(longSide * 3 / 4, 64), height: longSide }
  if (aspectRatio === "9:16") return { width: roundToMultiple(longSide * 9 / 16, 64), height: longSide }
  if (aspectRatio === "3:2") return { width: longSide, height: roundToMultiple(longSide * 2 / 3, 64) }
  if (aspectRatio === "4:3") return { width: longSide, height: roundToMultiple(longSide * 3 / 4, 64) }
  if (aspectRatio === "16:9") return { width: longSide, height: roundToMultiple(longSide * 9 / 16, 64) }
  return base
}

function buildPrompt(input: ImageGenerateInput) {
  const conversationContext =
    input.extra && typeof input.extra.conversationContext === "string" && input.extra.conversationContext.trim().length > 0
      ? input.extra.conversationContext.trim()
      : undefined

  return [
    input.prompt,
    conversationContext ? `上一轮生成摘要：\n${conversationContext}` : undefined,
    input.styleModel ? `风格模型：${input.styleModel}` : undefined,
    input.aspectRatio ? `画幅比例：${input.aspectRatio}` : undefined,
    input.count ? `生成数量：${input.count}` : undefined,
  ]
    .filter((item): item is string => Boolean(item))
    .join("\n")
}

export function getTaskType(input: { generationMode: InternalTaskType; taskType?: string }) {
  const txt2img = env("IMAGE_TXT2IMG_TASK_TYPE") ?? "txt2img_qwen"
  return input.taskType ?? txt2img
}

export async function executeInternelImageGenerate(input: ImageGenerateInput): Promise<ImageGenerateOutput> {
  const createTaskUrl = env("IMAGE_CREATE_TASK_URL") ?? DEFAULT_CREATE_TASK_URL
  const queryTaskBaseUrl = env("IMAGE_QUERY_TASK_BASE_URL") ?? DEFAULT_QUERY_TASK_BASE_URL
  const userIdx = input.extra && typeof input.extra.userIdx === "string" ? input.extra.userIdx : env("IMAGE_USER_IDX") ?? DEFAULT_USER_IDX
  const ignoredReferenceImages = resolveReferenceImages(input)
  const generationMode: InternalTaskType = "txt2img"
  const styleConfig = getInternalStyleConfig(getStudioStyleModel(input))
  const configuredTargetSize = getTargetSizeForAspectRatio(styleConfig.targetSize, getStudioAspectRatio(input))

  const targetSize = {
    width: Number(input.extra && typeof input.extra.width === "number" ? input.extra.width : configuredTargetSize.width),
    height: Number(input.extra && typeof input.extra.height === "number" ? input.extra.height : configuredTargetSize.height),
  }
  const taskType = getTaskType({
    generationMode,
    taskType: input.extra && typeof input.extra.taskType === "string" ? input.extra.taskType : styleConfig.taskType,
  })

  const requestBody = {
    user: { idx: userIdx },
    task_type: taskType,
    args: {
      tag_name:
        input.extra && typeof input.extra.tagName === "string"
          ? input.extra.tagName
          : styleConfig.tagName,
      num_image: getStudioCount(input),
      target: input.extra && typeof input.extra.target === "string" ? input.extra.target : styleConfig.target,
      target_size: targetSize,
      loras: styleConfig.loras,
      mode: input.extra && typeof input.extra.mode === "string" ? input.extra.mode : styleConfig.mode,
      ref_img_list: [],
      customer_prompt: input.prompt,
      prompt: buildPrompt(input),
    },
  }
  const debugRequest = {
    url: createTaskUrl,
    method: METHOD,
    ignoredReferenceImageCount: ignoredReferenceImages.length,
    body: requestBody,
  }

  const maxCreateRetries = Number(input.extra && typeof input.extra.maxCreateRetries === "number" ? input.extra.maxCreateRetries : 3)
  const createTimeoutMs = timeoutMsFor(
    "IMAGE_CREATE_TIMEOUT_MS",
    Number(input.extra && typeof input.extra.createTimeoutMs === "number" ? input.extra.createTimeoutMs : DEFAULT_TIMEOUT_MS),
  )

  console.log("[studio.internel] request", JSON.stringify(debugRequest, null, 2))
  const createJson = await createTaskWithRetry(createTaskUrl, requestBody, maxCreateRetries, createTimeoutMs)
  const taskId = getTaskId(createJson)

  const pollIntervalMs = Number(input.extra && typeof input.extra.pollIntervalMs === "number" ? input.extra.pollIntervalMs : 2000)
  const maxPollCount = Number(input.extra && typeof input.extra.maxPollCount === "number" ? input.extra.maxPollCount : 60)

  let lastQueryJson: QueryTaskResponse | null = null

  for (let i = 1; i <= maxPollCount; i++) {
    const queryJson = await queryTask(queryTaskBaseUrl, taskId)
    lastQueryJson = queryJson

    const status = getTaskStatus(queryJson)
    const progress = getTaskProgress(queryJson)

    if (isSuccessResponse(queryJson)) {
      const images = extractInternalImages(queryJson)
      return {
        provider: "internel",
        model: taskType,
        images: images.map((url) => ({ url })),
        raw: queryJson,
      }
    }

    if (isFailureResponse(queryJson)) {
      throw new Error(
        [
          "query_task returned failure.",
          `taskId=${taskId}`,
          `status=${status}`,
          `progress=${progress}`,
          `response=${JSON.stringify(queryJson, null, 2)}`,
        ].join("\n"),
      )
    }

    if (i < maxPollCount) {
      await sleep(pollIntervalMs)
    }
  }

  throw new Error(
    [
      "query_task timed out.",
      `taskId=${taskId}`,
      `lastResponse=${JSON.stringify(lastQueryJson, null, 2)}`,
    ].join("\n"),
  )
}

export const InternelImageGenerateTool = Tool.define<
  typeof Parameters,
  Metadata,
  never
>("internel_image_generate", Effect.succeed({
  description: "Generate or edit images through the built-in internal image generation tool.",
  parameters: Parameters,
  execute: (params: {
    prompt: string
    styleModel?: string
    aspectRatio?: string
    count?: number
    referenceImages?: string[]
    sourceImage?: string
    extra?: Record<string, unknown>
  }) =>
    Effect.promise(async () => {
      const result = await executeInternelImageGenerate({
        capability: "image.generate",
        prompt: params.prompt,
        styleModel: params.styleModel,
        aspectRatio: params.aspectRatio,
        count: params.count,
        referenceImages: params.referenceImages ? [...params.referenceImages] : undefined,
        sourceImage: params.sourceImage,
        extra: params.extra,
      })
      const attachments = result.images.map((image, index) => ({
        type: "file" as const,
        mime: "image/png",
        url: image.url,
        filename: `internel-${index + 1}.png`,
      }))
      const outputImages = attachments.map((item) => item.url).filter((url) => !url.startsWith("data:image/"))
      return {
        title: "Internal image generation",
        metadata: {
          request: {
            createTaskUrl: env("IMAGE_CREATE_TASK_URL") ?? DEFAULT_CREATE_TASK_URL,
            queryTaskBaseUrl: env("IMAGE_QUERY_TASK_BASE_URL") ?? DEFAULT_QUERY_TASK_BASE_URL,
            userIdx: params.extra && typeof params.extra.userIdx === "string" ? params.extra.userIdx : env("IMAGE_USER_IDX") ?? DEFAULT_USER_IDX,
            ignoredReferenceImageCount: resolveReferenceImages(params).length,
          },
          response: summarizeInternalOutput(result.raw),
          statusCode: 200,
        },
        output: JSON.stringify(
          {
            ok: true,
            provider: result.provider,
            model: result.model,
            imageCount: result.images.length,
            images: outputImages,
            primaryImage: outputImages[0] ?? null,
          },
          null,
          2,
        ),
        attachments,
      }
    }).pipe(Effect.orDie),
}))
