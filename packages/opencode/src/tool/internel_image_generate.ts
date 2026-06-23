import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import type {
  ImageGenerateInput,
  ImageGenerationQuery,
  ImageGenerationTask,
  ImageGenerateOutput,
  StudioCapability,
} from "@/studio/image-provider"

const METHOD = "POST"
// const DEFAULT_CREATE_TASK_URL = "http://localhost:3000/create_task"
// const DEFAULT_QUERY_TASK_BASE_URL = "http://localhost:3000/query_task"
// const DEFAULT_CANCEL_TASK_URL = "http://localhost:3000/cancel_task"
// const DEFAULT_GET_PROMPT_TAG_URL = "http://localhost:3000/get_prompt_tags"
// const DEFAULT_CHECK_PERMISSION_URL = "http://localhost:3000/check_permissions"
// const DEFAULT_GET_HISTORY = "http://localhost:3000/get_history"
const DEFAULT_CREATE_TASK_URL = "https://octoai-api.ucd.huawei.com/octoai-web-api/prod/aiImageGeneration/create_task"
const DEFAULT_QUERY_TASK_BASE_URL = "https://octoai-api.ucd.huawei.com/octoai-web-api/prod/aiImageGeneration/query_task"
const DEFAULT_CANCEL_TASK_URL = "https://octoai-api.ucd.huawei.com/octoai-web-api/prod/aiImageGeneration/cancle_task"
const DEFAULT_GET_PROMPT_TAG_URL = "https://octoai-api.ucd.huawei.com/octoai-web-api/prod/aiImageGeneration/get_prompt_tags"
const DEFAULT_CHECK_PERMISSION_URL = "https://octoai-api.ucd.huawei.com/octoai-web-api/prod/auth/auth/check_permissions"
const DEFAULT_GET_HISTORY = "https://octoai-api.ucd.huawei.com/octoai-web-api/prod/aiImageGeneration/get_history"
const DEFAULT_USER_IDX = ""
const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_CANCEL_TIMEOUT_MS = 15_000

type JsonRecord = Record<string, unknown>
type InternalTaskType = "txt2img" | "img2img"
type InternalToolAction = "generate_image" | "generate_video" | "super_resolution" | "cutout" | "inpainting" | "outpainting"
type StudioAspectRatio = "1:1" | "2:3" | "3:4" | "9:16" | "3:2" | "4:3" | "16:9"
type InternalStyleConfig = {
  taskType: string
  tagName: string
  target: string
  targetSize: {
    width: number
    height: number
  }
  targetSizes?: Partial<Record<StudioAspectRatio, {
    width: number
    height: number
  }>>
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

type HistoryTaskResponse = {
  resp_code?: number
  resp_msg?: string
  result?: Array<{
    task_id?: string | number
    task_type?: string
    args?: JsonRecord
    [key: string]: unknown
  }>
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

export type CancelTaskResponse = {
  resp_code?: number
  resp_msg?: string
  result?: boolean
}

export function isCancelTaskSuccess(response: CancelTaskResponse) {
  return response.resp_code === 200 && response.result === true
}

const Parameters = Schema.Struct({
  capability: Schema.optional(Schema.Literals([
    "image.generate",
    "video.generate",
    "image.upscale",
    "image.cutout",
    "image.inpaint",
    "image.outpaint",
    "image.fusion",
  ])),
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

type InternalRequestContext = {
  userIdx: string
  styleConfig: InternalStyleConfig
  targetSize: {
    width: number
    height: number
  }
  taskType: string
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function describeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const code = error && typeof error === "object" && "code" in error
    ? (error as { code?: unknown }).code
    : undefined
  const path = error && typeof error === "object" && "path" in error
    ? (error as { path?: unknown }).path
    : undefined
  const cause = error && typeof error === "object" && "cause" in error
    ? (error as { cause?: unknown }).cause
    : undefined
  return [
    message,
    code ? `code=${String(code)}` : undefined,
    path ? `path=${String(path)}` : undefined,
    cause ? `cause=${cause instanceof Error ? cause.message : String(cause)}` : undefined,
  ]
    .filter((item): item is string => Boolean(item))
    .join("; ")
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

export async function fetchPromptTags(): Promise<unknown> {
  const url = env("IMAGE_GET_PROMPT_TAG_URL") ?? DEFAULT_GET_PROMPT_TAG_URL
  const response = await fetch(url, {
    method: "GET",
    headers: {
      accept: "application/json, text/plain, */*",
      ...internalImageHeaders({ contentType: false }),
    },
  }).catch((error) => {
    throw new Error(
      [
        "get_prompt_tags network failed.",
        `url=${url}`,
        `error=${describeError(error)}`,
      ].join("\n"),
    )
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(
      [
        "get_prompt_tags failed.",
        `status=${response.status}`,
        `statusText=${response.statusText}`,
        `body=${text}`,
      ].join("\n"),
    )
  }
  return parseJson(text)
}

export async function checkStudioPermission(userIdx?: string): Promise<unknown> {
  const url = env("IMAGE_CHECK_PERMISSION_URL") ?? DEFAULT_CHECK_PERMISSION_URL
  if (!url) {
    console.warn("[studio.permission] skipped: configure DEFAULT_CHECK_PERMISSION_URL or IMAGE_CHECK_PERMISSION_URL")
    return { skipped: true }
  }
  const response = await fetch(url, {
    method: METHOD,
    headers: internalImageHeaders(),
    body: JSON.stringify({
      checkPermList: ["view:keling_entry", "view:jimeng_entry"],
      uid: userIdx ?? env("IMAGE_USER_IDX") ?? DEFAULT_USER_IDX,
    }),
  }).catch((error) => {
    throw new Error(
      [
        "check_permission network failed.",
        `url=${url}`,
        `error=${describeError(error)}`,
      ].join("\n"),
    )
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(
      [
        "check_permission failed.",
        `status=${response.status}`,
        `statusText=${response.statusText}`,
        `body=${text}`,
      ].join("\n"),
    )
  }
  const result = parseJson(text)
  console.log("[studio.permission] response", result)
  return result
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

function dataUrlToBase64(value: string) {
  return value.split(",")[1] ?? value
}

function isRemoteImageUrl(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\/\S+$/i.test(value)
}

function remoteImageUrl(value: unknown) {
  return isRemoteImageUrl(value) ? value : undefined
}

function imageUrlFromRefImage(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return remoteImageUrl((value as JsonRecord).image_base64)
}

function isRenderableImageUrl(url: string) {
  if (!url) return false
  return /^https?:\/\/\S+|^data:image\/[a-z0-9.+-]+;base64,\S+$/i.test(url)
}

function isRenderableVideoUrl(url: string) {
  if (!url) return false
  if (/^data:video\/[a-z0-9.+-]+;base64,\S+$/i.test(url)) return true
  if (!/^https?:\/\/\S+/i.test(url)) return false
  return /\.(mp4|mov|webm)$/i.test(url.split(/[?#]/)[0] ?? "")
}

function collectDirectVideoUrls(value: unknown): string[] {
  if (!value) return []
  if (typeof value === "string") {
    const normalized = value.replaceAll("\\/", "/").trim().replace(/[,.，。]+$/, "")
    return /^https?:\/\/\S+$/i.test(normalized) || /^data:video\/[a-z0-9.+-]+;base64,\S+$/i.test(normalized)
      ? [normalized]
      : []
  }
  if (Array.isArray(value)) return Array.from(new Set(value.flatMap((item) => collectDirectVideoUrls(item))))
  return []
}

function collectVideoUrls(value: unknown): string[] {
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
    const direct = isRenderableVideoUrl(normalized) ? [normalized] : []
    const embedded = [
      ...(normalized.match(/https?:\/\/[^\s"'<>\\)]+/g) ?? []),
      ...(normalized.match(/data:video\/[a-z0-9.+-]+;base64,[^\s"'<>\\)]+/gi) ?? []),
    ].filter(isRenderableVideoUrl)
    return Array.from(new Set([...direct, ...embedded, ...collectVideoUrls(parsed)])).map((url) =>
      url.replace(/[,.，。]+$/, ""),
    )
  }
  if (Array.isArray(value)) return Array.from(new Set(value.flatMap((item) => collectVideoUrls(item))))
  if (typeof value !== "object") return []

  const record = value as JsonRecord
  const direct = [
    "videos",
    "video",
    "video_url",
    "videoUrl",
    "result_video",
    "result_videos",
    "results",
    "urls",
    "primaryVideo",
    "primary_video",
  ].flatMap((key) => collectDirectVideoUrls(record[key]))
  const nested = [
    record.result,
    record.data,
    record.output,
    record.result && typeof record.result === "object" ? (record.result as JsonRecord).result : undefined,
    record.result && typeof record.result === "object" ? (record.result as JsonRecord).data : undefined,
    record.data && typeof record.data === "object" ? (record.data as JsonRecord).result : undefined,
    record.data && typeof record.data === "object" ? (record.data as JsonRecord).data : undefined,
  ].flatMap((item) => collectVideoUrls(item))

  return Array.from(new Set([...direct, ...nested]))
}

export function extractInternalImages(response: QueryTaskResponse) {
  const directResults = Array.isArray(response.result?.results)
    ? response.result.results.filter((item): item is string => typeof item === "string" && item.length > 0)
    : []
  const cleanBgResults = Array.isArray(response.result?.results_clean_bg)
    ? response.result.results_clean_bg.filter((item): item is string => typeof item === "string" && item.length > 0)
    : []
  const versionedResults = Array.isArray(response.result?.results_v2)
    ? response.result.results_v2
        .map((item) => item.output?.clean_bg ?? item.output?.image)
        .filter((item): item is string => typeof item === "string" && item.length > 0)
    : []
  const imageUrls = [...directResults, ...cleanBgResults, ...versionedResults, ...collectImageUrls(response)].filter(isRenderableImageUrl)
  const binaryImages = collectBase64Images(response).map(base64ToDataUrl).filter(isRenderableImageUrl)
  return Array.from(new Set([...imageUrls, ...binaryImages]))
}

export function extractInternalVideos(response: QueryTaskResponse) {
  const versionedResults = Array.isArray(response.result?.results_v2)
    ? response.result.results_v2
        .flatMap((item) => collectVideoUrls(item.output))
    : []
  return Array.from(new Set([...versionedResults, ...collectVideoUrls(response)]))
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
    videoUrlCount: collectVideoUrls(raw).length,
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
  const value = Number(progress)
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}

function getTaskOrder(response: QueryTaskResponse) {
  const value = Number(response.result?.order ?? response.data?.order)
  return Number.isFinite(value) && value >= 0 ? value : undefined
}

function isSuccessResponse(response: QueryTaskResponse): boolean {
  return response.resp_code === 200 && Number(getTaskStatus(response)) === 2
}

function isFailureResponse(response: QueryTaskResponse): boolean {
  const status = Number(getTaskStatus(response))
  if (response.resp_code !== undefined && response.resp_code !== 200) return true
  return ![0, 1, 2, 6].includes(status)
}

function normalizeTaskStatus(response: QueryTaskResponse): ImageGenerationQuery["status"] {
  if (isSuccessResponse(response)) return "succeeded"
  if (isFailureResponse(response)) return "failed"
  if (Number(getTaskStatus(response)) === 6) return "queued"
  return "running"
}

async function createTask(
  createTaskUrl: string,
  createPayload: unknown,
  createTimeoutMs: number,
): Promise<CreateTaskResponse> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), createTimeoutMs)
  const response = await fetch(createTaskUrl, {
    method: METHOD,
    headers: internalImageHeaders(),
    body: JSON.stringify(createPayload),
    signal: controller.signal,
  }).catch((error) => {
    throw new Error(
      [
        "create_task network failed.",
        `url=${createTaskUrl}`,
        `error=${describeError(error)}`,
      ].join("\n"),
    )
  }).finally(() => {
    clearTimeout(timeout)
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(
      [
        "create_task failed.",
        `status=${response.status}`,
        `statusText=${response.statusText}`,
        `body=${text}`,
      ].join("\n"),
    )
  }
  const json = parseJson(text) as CreateTaskResponse
  if (json.resp_code !== undefined && json.resp_code !== 200) {
    throw new Error(
      [
        "create_task returned business failure.",
        `resp_code=${json.resp_code}`,
        `resp_msg=${json.resp_msg ?? ""}`,
        `body=${JSON.stringify(json, null, 2)}`,
      ].join("\n"),
    )
  }
  return json
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
      ...internalImageHeaders({ contentType: false }),
    },
  }).catch((error) => {
    throw new Error(
      [
        "query_task network failed.",
        `url=${queryUrl}`,
        `error=${describeError(error)}`,
      ].join("\n"),
    )
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

async function getHistoryTasks(
  historyUrl: string,
  userIdx: string,
  timeoutMs: number,
) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const response = await fetch(historyUrl, {
    method: METHOD,
    headers: internalImageHeaders(),
    body: JSON.stringify({
      user: { idx: userIdx },
      page_idx: 1,
      page_size: 10,
      task_media_type: "all",
    }),
    signal: controller.signal,
  }).catch((error) => {
    throw new Error(
      [
        "get_history network failed.",
        `url=${historyUrl}`,
        `error=${describeError(error)}`,
      ].join("\n"),
    )
  }).finally(() => clearTimeout(timeout))
  const text = await response.text()
  if (!response.ok) {
    throw new Error(
      [
        "get_history failed.",
        `status=${response.status}`,
        `statusText=${response.statusText}`,
        `body=${text}`,
      ].join("\n"),
    )
  }
  const json = parseJson(text) as HistoryTaskResponse
  if (json.resp_code !== 200) {
    throw new Error(
      [
        "get_history returned business failure.",
        `resp_code=${json.resp_code ?? ""}`,
        `resp_msg=${json.resp_msg ?? ""}`,
        `body=${JSON.stringify(json, null, 2)}`,
      ].join("\n"),
    )
  }
  return Array.isArray(json.result) ? json.result : []
}

export async function cancelInternalGeneration(taskId: string): Promise<CancelTaskResponse> {
  const cancelUrl = new URL(env("IMAGE_CANCEL_TASK_URL") ?? DEFAULT_CANCEL_TASK_URL)
  cancelUrl.searchParams.set("task_id", taskId)
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(),
    timeoutMsFor("IMAGE_CANCEL_TIMEOUT_MS", DEFAULT_CANCEL_TIMEOUT_MS),
  )
  const response = await fetch(cancelUrl, {
    method: "GET",
    headers: {
      accept: "application/json, text/plain, */*",
      ...internalImageHeaders({ contentType: false }),
    },
    signal: controller.signal,
  }).catch((error) => {
    throw new Error(
      [
        "cancel_task network failed.",
        `taskId=${taskId}`,
        `url=${cancelUrl}`,
        `error=${describeError(error)}`,
      ].join("\n"),
    )
  }).finally(() => clearTimeout(timeout))
  const text = await response.text()
  if (!response.ok) {
    throw new Error(
      [
        "cancel_task failed.",
        `taskId=${taskId}`,
        `status=${response.status}`,
        `statusText=${response.statusText}`,
        `body=${text}`,
      ].join("\n"),
    )
  }
  const json = parseJson(text) as CancelTaskResponse
  if (!isCancelTaskSuccess(json)) {
    throw new Error(
      [
        "cancel_task returned business failure.",
        `taskId=${taskId}`,
        `resp_code=${json.resp_code ?? ""}`,
        `resp_msg=${json.resp_msg ?? ""}`,
        `result=${String(json.result)}`,
        `body=${JSON.stringify(json, null, 2)}`,
      ].join("\n"),
    )
  }
  return json
}

function env(name: string) {
  return process.env[name]
}

function timeoutMsFor(name: string, fallback: number) {
  const value = Number(env(name))
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function internalImageHeaders(input: { contentType?: boolean } = {}) {
  return {
    ...(input.contentType === false ? {} : { "content-type": "application/json" }),
    ...(env("IMAGE_API_TOKEN") ? { authorization: `Bearer ${env("IMAGE_API_TOKEN")}` } : {}),
    ...(env("IMAGE_API_COOKIE") ? { cookie: env("IMAGE_API_COOKIE") } : {}),
    ...(env("IMAGE_API_CLIENT_ID") ? { "x-client-id": env("IMAGE_API_CLIENT_ID") } : {}),
    ...(env("IMAGE_API_CLIENT_SECRET") ? { "x-client-secret": env("IMAGE_API_CLIENT_SECRET") } : {}),
  }
}

function redactImagePayload(value: unknown): unknown {
  if (typeof value === "string") {
    if (value.startsWith("data:image/")) return `<data-image bytes=${value.length}>`
    if (value.length > 200 && /^[A-Za-z0-9+/=]+$/.test(value)) return `<base64 bytes=${value.length}>`
    return value
  }
  if (Array.isArray(value)) return value.map(redactImagePayload)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value as JsonRecord).map(([key, item]) => [
      key,
      /token|cookie|secret|authorization/i.test(key) ? "<redacted>" : redactImagePayload(item),
    ]),
  )
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
  {
    aliases: ["Seedream 5.0 Lite", "seedream-5-lite"],
    config: {
      ...defaultInternalStyleConfig,
      taskType: "txt2img_jimeng",
      tagName: "Seedream 5.0 Lite",
      targetSizes: {
        "1:1": { width: 2048, height: 2048 },
        "2:3": { width: 1664, height: 2496 },
        "3:4": { width: 1728, height: 2304 },
        "9:16": { width: 1600, height: 2848 },
        "3:2": { width: 2496, height: 1664 },
        "4:3": { width: 2304, height: 1728 },
        "16:9": { width: 2848, height: 1600 },
      },
    },
  },
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

export function getInternalStyleConfig(styleModel?: string): InternalStyleConfig {
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

function getStudioCapability(input: ImageGenerateInput): StudioCapability {
  const settings = extractStudioToolSettings(input.prompt)
  const value =
    (typeof settings.capability === "string" ? settings.capability : undefined) ??
    input.prompt.match(/能力：([^\n]+)/)?.[1]?.trim() ??
    input.capability
  if (
    value === "image.generate" ||
    value === "video.generate" ||
    value === "image.upscale" ||
    value === "image.cutout" ||
    value === "image.inpaint" ||
    value === "image.outpaint" ||
    value === "image.fusion"
  ) return value
  return "image.generate"
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

export function getInternalTargetSize(styleModel?: string, aspectRatio?: StudioAspectRatio) {
  const config = getInternalStyleConfig(styleModel)
  const targetSize = aspectRatio ? config.targetSizes?.[aspectRatio] : undefined
  return targetSize ?? getTargetSizeForAspectRatio(config.targetSize, aspectRatio)
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

function toolActionForCapability(capability: StudioCapability): InternalToolAction {
  if (capability === "video.generate") return "generate_video"
  if (capability === "image.upscale") return "super_resolution"
  if (capability === "image.cutout") return "cutout"
  if (capability === "image.inpaint") return "inpainting"
  if (capability === "image.outpaint") return "outpainting"
  return "generate_image"
}

async function getSourceImageDataUrl(input: ImageGenerateInput) {
  const settings = extractStudioToolSettings(input.prompt)
  const sourceImage =
    input.sourceImage ??
    input.referenceImages?.[0] ??
    (typeof settings.sourceImage === "string" ? settings.sourceImage : undefined)
  if (!sourceImage) throw new Error("This Studio action requires a source image.")
  if (sourceImage.startsWith("data:image/")) {
    if (!dataUrlToBase64(sourceImage)) throw new Error("Studio source image data URL is missing base64 content.")
    return sourceImage
  }
  const response = await fetch(sourceImage)
  if (!response.ok) throw new Error(`Failed to fetch Studio source image. status=${response.status}`)
  const mime = response.headers.get("content-type") ?? "image/png"
  if (!mime.startsWith("image/")) throw new Error(`Studio source URL is not an image. content-type=${mime}`)
  return `data:${mime};base64,${Buffer.from(await response.arrayBuffer()).toString("base64")}`
}

async function resolveImageInputDataUrl(value: string) {
  if (value.startsWith("data:image/")) {
    if (!dataUrlToBase64(value)) throw new Error("Studio image data URL is missing base64 content.")
    return value
  }
  const response = await fetch(value)
  if (!response.ok) throw new Error(`Failed to fetch Studio image. status=${response.status}`)
  const mime = response.headers.get("content-type") ?? "image/png"
  if (!mime.startsWith("image/")) throw new Error(`Studio source URL is not an image. content-type=${mime}`)
  return `data:${mime};base64,${Buffer.from(await response.arrayBuffer()).toString("base64")}`
}

async function buildTextToImageRequestBody(input: ImageGenerateInput, context: InternalRequestContext) {
  const refImgList = (await Promise.all(
    (input.referenceImages ?? []).map((item) => resolveImageInputDataUrl(item).catch(() => undefined)),
  ))
    .filter((item): item is string => Boolean(item))
    .map((item) => ({
      ref_type: "kontext",
      image_base64: item,
    }))

  return {
    user: { idx: context.userIdx },
    task_type: context.taskType,
    args: {
      tag_name:
        input.extra && typeof input.extra.tagName === "string"
          ? input.extra.tagName
          : context.styleConfig.tagName,
      num_image: getStudioCount(input),
      target: input.extra && typeof input.extra.target === "string" ? input.extra.target : context.styleConfig.target,
      target_size: context.targetSize,
      loras: context.styleConfig.loras,
      mode: input.extra && typeof input.extra.mode === "string" ? input.extra.mode : context.styleConfig.mode,
      ref_img_list: refImgList,
      customer_prompt: input.prompt,
      prompt: buildPrompt(input),
    },
  }
}

async function buildUpscaleRequestBody(input: ImageGenerateInput, context: InternalRequestContext) {
  const mode = input.extra?.mode
  return {
    user: { idx: context.userIdx },
    task_type: "magnify",
    args: {
      mode:
        mode === "restoration_8k" || mode === "restoration" || mode === "super_resolution"
          ? mode
          : "restoration",
      image_base64: await getSourceImageDataUrl(input),
    },
  }
}

async function buildCutoutRequestBody(input: ImageGenerateInput, context: InternalRequestContext) {
  return {
    user: { idx: context.userIdx },
    task_type: "remove_bg",
    args: {
      num_image: 1,
      image_list: [
        {
          mode: "new",
          image_base64: await getSourceImageDataUrl(input),
        },
      ],
    },
  }
}

function extraNumber(input: ImageGenerateInput, key: string, fallback: number) {
  const value = input.extra?.[key]
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function extraString(input: ImageGenerateInput, key: string) {
  const value = input.extra?.[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function getVideoDuration(input: ImageGenerateInput) {
  const value = extraString(input, "duration")
  return value === "10" ? "10" : "5"
}

function getVideoMode(input: ImageGenerateInput) {
  const value = extraString(input, "mode")
  return value === "pro" ? "pro" : "std"
}

function getVideoAspectRatio(input: ImageGenerateInput) {
  const aspectRatio = getStudioAspectRatio(input)
  if (aspectRatio === "1:1" || aspectRatio === "9:16" || aspectRatio === "16:9") return aspectRatio
  return "16:9"
}

async function getVideoFrames(input: ImageGenerateInput) {
  const referenceImages = (await Promise.all(
    (input.referenceImages ?? []).map((item) => resolveImageInputDataUrl(item).catch(() => undefined)),
  )).filter((item): item is string => Boolean(item))
  const firstFrame = extraString(input, "firstFrame")
  const lastFrame = extraString(input, "lastFrame")
  const resolvedFirstFrame = firstFrame ? await resolveImageInputDataUrl(firstFrame) : undefined
  const resolvedLastFrame = lastFrame ? await resolveImageInputDataUrl(lastFrame) : undefined
  return {
    firstFrame: resolvedFirstFrame ?? referenceImages[0] ?? referenceImages[1],
    lastFrame: resolvedLastFrame ?? (resolvedFirstFrame ? referenceImages[1] : undefined),
  }
}

async function buildVideoRequestBody(input: ImageGenerateInput, context: InternalRequestContext) {
  const frames = await getVideoFrames(input)
  const baseArgs = {
    prompt: input.prompt,
    aspect_ratio: getVideoAspectRatio(input),
    duration: getVideoDuration(input),
    count: getStudioCount(input),
    mode: getVideoMode(input),
  }
  if (extraString(input, "videoMode") === "first_last_frame" && !frames.firstFrame) {
    throw new Error("Image-to-video generation requires a first frame.")
  }
  if (!frames.firstFrame) {
    return {
      user: { idx: context.userIdx },
      task_type: "t2v_seedance",
      args: {
        tag_name: "文生视频",
        ...baseArgs,
      },
    }
  }
  return {
    user: { idx: context.userIdx },
    task_type: "i2v_seedance",
    args: {
      tag_name: "图生视频",
      ...baseArgs,
      image: dataUrlToBase64(frames.firstFrame),
      ...(frames.lastFrame ? { image_tail: dataUrlToBase64(frames.lastFrame) } : {}),
    },
  }
}

function buildInpaintRequestBody(input: ImageGenerateInput, context: InternalRequestContext) {
  const compositeImage = extraString(input, "compositeImage")
  if (!compositeImage) throw new Error("Inpaint requires a composite image base64.")
  const generateMode = extraString(input, "generateMode")
  return resolveImageInputDataUrl(compositeImage).then((resolvedCompositeImage) => ({
    user: { idx: context.userIdx },
    task_type: "inpainting",
    args: {
      prompt: input.prompt,
      has_drawing: input.extra?.hasDrawing === true,
      image_base64: dataUrlToBase64(resolvedCompositeImage),
      generate_mode: generateMode === "erase" ? "erase" : "qwen_image_edit",
      num_image: 1,
    },
  }))
}

async function buildOutpaintRequestBody(input: ImageGenerateInput, context: InternalRequestContext) {
  const distances = {
    left: extraNumber(input, "left", 0),
    right: extraNumber(input, "right", 0),
    top: extraNumber(input, "top", 0),
    bottom: extraNumber(input, "bottom", 0),
  }
  if (Object.values(distances).some((value) => value < 0)) throw new Error("Outpaint distances must be non-negative numbers.")
  if (Object.values(distances).every((value) => value === 0)) throw new Error("Outpaint requires at least one expanded direction.")
  return {
    user: { idx: context.userIdx },
    task_type: "outpainting",
    args: {
      prompt: input.prompt,
      image_base64: await getSourceImageDataUrl(input),
      ...distances,
      num_image: getStudioCount(input),
    },
  }
}

async function buildInternalRequestBody(input: ImageGenerateInput, context: InternalRequestContext) {
  const capability = getStudioCapability(input)
  if (capability === "video.generate") return buildVideoRequestBody(input, context)
  if (capability === "image.upscale") return buildUpscaleRequestBody(input, context)
  if (capability === "image.cutout") return buildCutoutRequestBody(input, context)
  if (capability === "image.inpaint") return buildInpaintRequestBody(input, context)
  if (capability === "image.outpaint") return buildOutpaintRequestBody(input, context)
  return buildTextToImageRequestBody(input, context)
}

function normalizePersistedInput(input: ImageGenerateInput) {
  if (input.capability === "image.inpaint") {
    return {
      ...input,
      sourceImage: undefined,
    }
  }
  return input
}

function compactInputWithHistory(input: ImageGenerateInput, historyArgs?: JsonRecord) {
  if (!historyArgs) return input
  if (input.capability === "image.generate") {
    const refImgList = Array.isArray(historyArgs.ref_img_list) ? historyArgs.ref_img_list : []
    const referenceImages = refImgList.map(imageUrlFromRefImage).filter((item): item is string => Boolean(item))
    return {
      ...input,
      referenceImages: referenceImages.length > 0 ? referenceImages : input.referenceImages,
    }
  }
  if (input.capability === "video.generate") {
    const firstFrame = remoteImageUrl(historyArgs.image)
    const lastFrame = remoteImageUrl(historyArgs.image_tail)
    return {
      ...input,
      referenceImages: [firstFrame, lastFrame].filter((item): item is string => Boolean(item)).length > 0
        ? [firstFrame, lastFrame].filter((item): item is string => Boolean(item))
        : input.referenceImages,
      extra: {
        ...(input.extra ?? {}),
        ...(firstFrame ? { firstFrame } : {}),
        ...(lastFrame ? { lastFrame } : {}),
      },
    }
  }
  if (input.capability === "image.upscale") {
    return {
      ...input,
      sourceImage: remoteImageUrl(historyArgs.image_base64) ?? input.sourceImage,
    }
  }
  if (input.capability === "image.cutout") {
    const imageList = Array.isArray(historyArgs.image_list) ? historyArgs.image_list : []
    return {
      ...input,
      sourceImage: imageList.map(imageUrlFromRefImage).find((item): item is string => Boolean(item)) ?? input.sourceImage,
    }
  }
  if (input.capability === "image.inpaint") {
    const compositeImage = remoteImageUrl(historyArgs.image_base64)
    return {
      ...input,
      extra: {
        ...(input.extra ?? {}),
        ...(compositeImage ? { compositeImage } : {}),
      },
    }
  }
  if (input.capability === "image.outpaint") {
    return {
      ...input,
      sourceImage: remoteImageUrl(historyArgs.image_base64) ?? input.sourceImage,
    }
  }
  return input
}

function compactRequestWithHistory(requestBody: JsonRecord, capability: StudioCapability, historyArgs?: JsonRecord) {
  if (!historyArgs) return requestBody
  const next = structuredClone(requestBody) as JsonRecord
  const args = next.args
  if (!args || typeof args !== "object" || Array.isArray(args)) return next
  if (capability === "image.generate") {
    const refImgList = Array.isArray(historyArgs.ref_img_list) ? historyArgs.ref_img_list : []
    const current = Array.isArray((args as JsonRecord).ref_img_list) ? (args as JsonRecord).ref_img_list as unknown[] : []
    ;(args as JsonRecord).ref_img_list = current.map((item: unknown, index: number) => {
      const url = imageUrlFromRefImage(refImgList[index])
      if (!url || !item || typeof item !== "object" || Array.isArray(item)) return item
      return { ...(item as JsonRecord), image_base64: url }
    })
    return next
  }
  if (capability === "video.generate") {
    const firstFrame = remoteImageUrl(historyArgs.image)
    const lastFrame = remoteImageUrl(historyArgs.image_tail)
    if (firstFrame) (args as JsonRecord).image = firstFrame
    if (lastFrame) (args as JsonRecord).image_tail = lastFrame
    return next
  }
  if (capability === "image.upscale" || capability === "image.inpaint" || capability === "image.outpaint") {
    const image = remoteImageUrl(historyArgs.image_base64)
    if (image) (args as JsonRecord).image_base64 = image
    return next
  }
  if (capability === "image.cutout") {
    const historyImageList = Array.isArray(historyArgs.image_list) ? historyArgs.image_list : []
    const current = Array.isArray((args as JsonRecord).image_list) ? (args as JsonRecord).image_list as unknown[] : []
    ;(args as JsonRecord).image_list = current.map((item: unknown, index: number) => {
      const url = imageUrlFromRefImage(historyImageList[index])
      if (!url || !item || typeof item !== "object" || Array.isArray(item)) return item
      return { ...(item as JsonRecord), image_base64: url }
    })
    return next
  }
  return next
}

export async function createInternalGeneration(input: ImageGenerateInput): Promise<ImageGenerationTask> {
  const capability = getStudioCapability(input)
  const toolAction = toolActionForCapability(capability)
  const createTaskUrl = env("IMAGE_CREATE_TASK_URL") ?? DEFAULT_CREATE_TASK_URL
  const historyUrl = env("IMAGE_GET_HISTORY_URL") ?? DEFAULT_GET_HISTORY
  const userIdx = input.extra && typeof input.extra.userIdx === "string" ? input.extra.userIdx : env("IMAGE_USER_IDX") ?? DEFAULT_USER_IDX
  const ignoredReferenceImages = resolveReferenceImages(input)
  const generationMode: InternalTaskType = "txt2img"
  const styleModel = getStudioStyleModel(input)
  const styleConfig = getInternalStyleConfig(styleModel)
  const configuredTargetSize = getInternalTargetSize(styleModel, getStudioAspectRatio(input))

  const targetSize = {
    width: Number(input.extra && typeof input.extra.width === "number" ? input.extra.width : configuredTargetSize.width),
    height: Number(input.extra && typeof input.extra.height === "number" ? input.extra.height : configuredTargetSize.height),
  }
  const taskType = getTaskType({
    generationMode,
    taskType: input.extra && typeof input.extra.taskType === "string" ? input.extra.taskType : styleConfig.taskType,
  })

  const requestBody = await buildInternalRequestBody(input, {
    userIdx,
    styleConfig,
    targetSize,
    taskType,
  })
  const requestTaskType = typeof requestBody.task_type === "string" ? requestBody.task_type : taskType
  const debugRequest = {
    url: createTaskUrl,
    method: METHOD,
    ignoredReferenceImageCount: ignoredReferenceImages.length,
    body: requestBody,
  }

  const createTimeoutMs = timeoutMsFor(
    "IMAGE_CREATE_TIMEOUT_MS",
    Number(input.extra && typeof input.extra.createTimeoutMs === "number" ? input.extra.createTimeoutMs : DEFAULT_TIMEOUT_MS),
  )

  console.log("[studio.internel] request", JSON.stringify(redactImagePayload(debugRequest), null, 2))
  const createJson = await createTask(createTaskUrl, requestBody, createTimeoutMs)
  const taskId = getTaskId(createJson)
  const persistedInput = normalizePersistedInput(input)
  const historyArgs = await getHistoryTasks(historyUrl, userIdx, createTimeoutMs)
    .then((history) => history.find((item) => String(item.task_id ?? "") === String(taskId))?.args)
    .catch((error) => {
      console.warn("[studio.internel] get_history failed", error)
      return undefined
    })
  const compactedInput = compactInputWithHistory(persistedInput, historyArgs)
  const compactedRequest = compactRequestWithHistory(requestBody, capability, historyArgs)
  return {
    provider: "internel",
    model: requestTaskType,
    capability,
    toolAction,
    taskId,
    input: compactedInput,
    request: compactedRequest,
  }
}

export async function queryInternalGeneration(task: ImageGenerationTask): Promise<ImageGenerationQuery> {
  const queryJson = await queryTask(env("IMAGE_QUERY_TASK_BASE_URL") ?? DEFAULT_QUERY_TASK_BASE_URL, task.taskId)
  const status = normalizeTaskStatus(queryJson)
  const videos = status === "succeeded" && task.capability === "video.generate" ? extractInternalVideos(queryJson) : []
  const images = status === "succeeded"
    ? extractInternalImages(queryJson).filter((url) => task.capability !== "video.generate" || !isRenderableVideoUrl(url) && !videos.includes(url))
    : []
  return {
    provider: "internel",
    model: task.model,
    capability: task.capability,
    toolAction: task.toolAction,
    taskId: task.taskId,
    status,
    rawStatus: getTaskStatus(queryJson),
    progress: getTaskProgress(queryJson),
    order: getTaskOrder(queryJson),
    images: [
      ...images.map((url) => ({ kind: "image" as const, url })),
      ...videos.map((url) => ({ kind: "video" as const, url })),
    ],
    request: task.request,
    raw: queryJson,
  }
}

export async function executeInternelImageGenerate(input: ImageGenerateInput): Promise<ImageGenerateOutput> {
  const task = await createInternalGeneration(input)
  const pollIntervalMs = Number(input.extra && typeof input.extra.pollIntervalMs === "number" ? input.extra.pollIntervalMs : 2000)
  const maxPollCount = Number(input.extra && typeof input.extra.maxPollCount === "number" ? input.extra.maxPollCount : 900)
  let lastQuery: ImageGenerationQuery | undefined

  for (let i = 1; i <= maxPollCount; i++) {
    const query = await queryInternalGeneration(task)
    lastQuery = query
    if (query.status === "succeeded") return query

    if (query.status === "failed") {
      throw new Error(
        [
          "query_task returned failure.",
          `taskId=${task.taskId}`,
          `status=${query.rawStatus}`,
          `progress=${query.progress}`,
          `response=${JSON.stringify(query.raw, null, 2)}`,
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
      `taskId=${task.taskId}`,
      `lastResponse=${JSON.stringify(lastQuery?.raw, null, 2)}`,
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
    capability?: StudioCapability
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
        capability: params.capability ?? "image.generate",
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
      const outputImages = attachments.map((item) => item.url)
      return {
        title: "Internal image generation",
        metadata: {
          request: {
            createTaskUrl: env("IMAGE_CREATE_TASK_URL") ?? DEFAULT_CREATE_TASK_URL,
            queryTaskBaseUrl: env("IMAGE_QUERY_TASK_BASE_URL") ?? DEFAULT_QUERY_TASK_BASE_URL,
            userIdx: params.extra && typeof params.extra.userIdx === "string" ? params.extra.userIdx : env("IMAGE_USER_IDX") ?? DEFAULT_USER_IDX,
            ignoredReferenceImageCount: resolveReferenceImages(params).length,
            body: redactImagePayload(result.request),
          },
          response: summarizeInternalOutput(result.raw),
          statusCode: 200,
        },
        output: JSON.stringify(
          {
            ok: true,
            provider: result.provider,
            capability: result.capability ?? params.capability ?? "image.generate",
            toolAction: result.toolAction,
            taskId: result.taskId,
            model: result.model,
            aspectRatio: params.aspectRatio,
            width: params.extra && typeof params.extra.width === "number" ? params.extra.width : undefined,
            height: params.extra && typeof params.extra.height === "number" ? params.extra.height : undefined,
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
