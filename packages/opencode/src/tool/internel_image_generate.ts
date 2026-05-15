import { createHash, createHmac } from "node:crypto"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import type { ImageGenerateInput, ImageGenerateOutput } from "@/studio/image-provider"

const METHOD = "POST"
const HOST = "visual.volcengineapi.com"
const REGION = "cn-north-1"
const ENDPOINT = "https://visual.volcengineapi.com"
const SERVICE = "cv"
const DEFAULT_CREATE_TASK_URL =
  "https://octoai-api.ucd.huawei.com/octoai-web-api/prod/aiImageGeneration/create_task"
const DEFAULT_QUERY_TASK_BASE_URL =
  "https://octoai-api.ucd.huawei.com/octoai-web-api/prod/aiImageGeneration/query_task"
const DEFAULT_USER_IDX = "l00423136"
const DEFAULT_TIMEOUT_MS = 120_000

type TargetSize = {
  width: number
  height: number
}

type JsonRecord = Record<string, unknown>

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

type InternalTaskType = "txt2img" | "img2img"

const Parameters = Schema.Struct({
  prompt: Schema.String,
  styleModel: Schema.optional(Schema.String),
  aspectRatio: Schema.optional(Schema.String),
  count: Schema.optional(Schema.Number),
  referenceImages: Schema.optional(Schema.Array(Schema.String)),
  sourceImage: Schema.optional(Schema.String),
  extra: Schema.optional(Schema.Record(Schema.String, Schema.Any)),
})

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

function getUtcTimestamp() {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, "0")
  const year = now.getUTCFullYear()
  const month = pad(now.getUTCMonth() + 1)
  const day = pad(now.getUTCDate())
  const hour = pad(now.getUTCHours())
  const minute = pad(now.getUTCMinutes())
  const second = pad(now.getUTCSeconds())
  return {
    currentDate: `${year}${month}${day}T${hour}${minute}${second}Z`,
    dateStamp: `${year}${month}${day}`,
  }
}

function hmacSha256(key: Buffer | string, msg: string) {
  return createHmac("sha256", key).update(msg, "utf8").digest()
}

function sha256Hex(data: string) {
  return createHash("sha256").update(data, "utf8").digest("hex")
}

function getSignatureKey(secretKey: string, dateStamp: string) {
  const kDate = hmacSha256(Buffer.from(secretKey, "utf8"), dateStamp)
  const kRegion = hmacSha256(kDate, REGION)
  const kService = hmacSha256(kRegion, SERVICE)
  return hmacSha256(kService, "request")
}

function formatQuery(parameters: Record<string, string>) {
  return Object.keys(parameters)
    .sort()
    .map((key) => `${key}=${parameters[key]}`)
    .join("&")
}

function signV4Request(input: { accessKey: string; secretKey: string; reqQuery: string; reqBody: string }) {
  const timestamp = getUtcTimestamp()
  const payloadHash = sha256Hex(input.reqBody)
  const signedHeaders = "content-type;host;x-content-sha256;x-date"
  const canonicalHeaders =
    `content-type:application/json\n` +
    `host:${HOST}\n` +
    `x-content-sha256:${payloadHash}\n` +
    `x-date:${timestamp.currentDate}\n`
  const canonicalRequest = [METHOD, "/", input.reqQuery, canonicalHeaders, signedHeaders, payloadHash].join("\n")
  const credentialScope = `${timestamp.dateStamp}/${REGION}/${SERVICE}/request`
  const stringToSign = ["HMAC-SHA256", timestamp.currentDate, credentialScope, sha256Hex(canonicalRequest)].join("\n")
  const signature = createHmac("sha256", getSignatureKey(input.secretKey, timestamp.dateStamp))
    .update(stringToSign, "utf8")
    .digest("hex")

  return {
    requestUrl: `${ENDPOINT}?${input.reqQuery}`,
    headers: {
      "X-Date": timestamp.currentDate,
      Authorization:
        `HMAC-SHA256 Credential=${input.accessKey}/${credentialScope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
      "X-Content-Sha256": payloadHash,
      "Content-Type": "application/json",
    },
  }
}

function parseJson(text: string): JsonRecord {
  try {
    return JSON.parse(text) as JsonRecord
  } catch {
    throw new Error(`Internal image API returned non-JSON response:\n${text}`)
  }
}

function collectImageUrls(value: unknown): string[] {
  if (!value) return []
  if (typeof value === "string") {
    const normalized = value.replaceAll("\\/", "/")
    const parsed = (() => {
      try {
        return JSON.parse(normalized) as unknown
      } catch {
        return undefined
      }
    })()
    const direct = /^(https?:\/\/\S+|data:image\/[a-z0-9.+-]+;base64,\S+)$/i.test(normalized) ? [normalized] : []
    const embedded = [
      ...(normalized.match(/https?:\/\/[^\s"'<>\\)]+/g) ?? []),
      ...(normalized.match(/data:image\/[a-z0-9.+-]+;base64,[^\s"'<>\\)]+/gi) ?? []),
    ]
    return Array.from(new Set([...direct, ...embedded, ...collectImageUrls(parsed)])).map((url) =>
      url.replace(/[,.，。]+$/, ""),
    )
  }
  if (Array.isArray(value)) return Array.from(new Set(value.flatMap((item) => collectImageUrls(item))))
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
  if (!value || typeof value !== "object") return []
  if (Array.isArray(value)) return Array.from(new Set(value.flatMap((item) => collectBase64Images(item))))
  const record = value as JsonRecord
  const direct = ["binary_data_base64", "binaryDataBase64"].flatMap((key) => {
    const item = record[key]
    if (!Array.isArray(item)) return []
    return item.filter((candidate): candidate is string => typeof candidate === "string" && candidate.length > 0)
  })
  return Array.from(new Set([...direct, ...Object.values(record).flatMap((item) => collectBase64Images(item))]))
}

function base64ToDataUrl(value: string) {
  if (value.startsWith("data:")) return value
  return `data:image/png;base64,${value}`
}

function isRenderableImageUrl(url: string) {
  if (!url) return false
  if (url.includes("visual.volcengineapi.com?Action=CVProcess&Version=2022-08-31")) return false
  return /^https?:\/\/\S+|^data:image\/[a-z0-9.+-]+;base64,\S+$/i.test(url)
}

function summarizeInternalOutput(raw: unknown, bodyText = "") {
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
    throw new Error(`create_task succeeded but no task_id was found in response:\n${JSON.stringify(response, null, 2)}`)
  }

  return String(taskId)
}

function asStatus(value: unknown): number | string | undefined {
  if (typeof value === "number" || typeof value === "string") return value
  return undefined
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

function extractImages(response: QueryTaskResponse): string[] {
  const directResults = response.result?.results
  if (Array.isArray(directResults)) {
    return directResults.filter((item): item is string => typeof item === "string" && item.length > 0)
  }

  const resultsV2 = response.result?.results_v2
  if (Array.isArray(resultsV2)) {
    return resultsV2
      .map((item) => item?.output?.image)
      .filter((item): item is string => typeof item === "string" && item.length > 0)
  }

  return []
}

async function createTaskWithRetry(input: {
  createTaskUrl: string
  createPayload: unknown
  maxCreateRetries: number
  createTimeoutMs: number
}): Promise<CreateTaskResponse> {
  let lastError: unknown = null

  for (let attempt = 1; attempt <= input.maxCreateRetries; attempt++) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), input.createTimeoutMs)

      const response = await fetch(input.createTaskUrl, {
        method: METHOD,
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(input.createPayload),
        signal: controller.signal,
      }).finally(() => {
        clearTimeout(timeout)
      })

      const text = await response.text()

      if (!response.ok) {
        if (isRetriableHttpStatus(response.status) && attempt < input.maxCreateRetries) {
          await sleep(getBackoffMs(attempt))
          continue
        }
        throw new Error(
          [
            "create_task failed.",
            `attempt=${attempt}/${input.maxCreateRetries}`,
            `status=${response.status}`,
            `statusText=${response.statusText}`,
            `body=${text}`,
          ].join("\n"),
        )
      }

      let json: CreateTaskResponse
      try {
        json = JSON.parse(text)
      } catch {
        throw new Error(`create_task returned non-JSON response:\n${text}`)
      }

      if (json.resp_code !== undefined && json.resp_code !== 200) {
        if (attempt < input.maxCreateRetries) {
          await sleep(getBackoffMs(attempt))
          continue
        }
        throw new Error(
          [
            "create_task returned business failure.",
            `attempt=${attempt}/${input.maxCreateRetries}`,
            `resp_code=${json.resp_code}`,
            `resp_msg=${json.resp_msg ?? ""}`,
            `body=${JSON.stringify(json, null, 2)}`,
          ].join("\n"),
        )
      }

      return json
    } catch (error) {
      lastError = error
      if (attempt < input.maxCreateRetries && isRetriableError(error)) {
        await sleep(getBackoffMs(attempt))
        continue
      }
      throw error
    }
  }

  throw new Error(`create_task failed after retries: ${String(lastError)}`)
}

async function queryTask(input: { queryTaskBaseUrl: string; taskId: string }): Promise<QueryTaskResponse> {
  const queryUrl = `${input.queryTaskBaseUrl}?task_id=${encodeURIComponent(input.taskId)}`
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

  try {
    return JSON.parse(text) as QueryTaskResponse
  } catch {
    throw new Error(`query_task returned non-JSON response:\n${text}`)
  }
}

function env(name: string) {
  return process.env[name]
}

function timeoutMsFor(name: string, fallback: number) {
  const value = Number(env(name))
  return Number.isFinite(value) && value > 0 ? value : fallback
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

function reqKeyFor(input: ImageGenerateInput) {
  if (input.sourceImage || (input.referenceImages?.length ?? 0) > 0) {
    return env("IMAGE_EDIT_REQ_KEY") ?? env("IMAGE_REQ_KEY") ?? "txt2img_qwen"
  }
  return env("IMAGE_REQ_KEY") ?? "txt2img_qwen"
}

function getTaskType(input: { generationMode: InternalTaskType; taskType?: string }) {
  const txt2img = env("IMAGE_TXT2IMG_TASK_TYPE") ?? "txt2img_qwen"
  const img2img = env("IMAGE_IMG2IMG_TASK_TYPE") ?? "img2img_qwen"
  return input.taskType ?? (input.generationMode === "img2img" ? img2img : txt2img)
}

export async function executeInternelImageGenerate(input: ImageGenerateInput): Promise<ImageGenerateOutput> {
  const createTaskUrl = env("IMAGE_CREATE_TASK_URL") ?? DEFAULT_CREATE_TASK_URL
  const queryTaskBaseUrl = env("IMAGE_QUERY_TASK_BASE_URL") ?? DEFAULT_QUERY_TASK_BASE_URL
  const userIdx = input.extra && typeof input.extra.userIdx === "string" ? input.extra.userIdx : env("IMAGE_USER_IDX") ?? DEFAULT_USER_IDX
  const generationMode: InternalTaskType = input.sourceImage || (input.referenceImages?.length ?? 0) > 0 ? "img2img" : "txt2img"
  const referenceImages = [...(input.referenceImages ?? []), ...(input.sourceImage ? [input.sourceImage] : [])].filter(
    (item, index, list) => item && list.indexOf(item) === index,
  )

  if (generationMode === "txt2img" && referenceImages.length > 0) {
    throw new Error(
      [
        "Invalid internal image generation arguments.",
        "generationMode is txt2img, but referenceImages is not empty.",
        `referenceImages=${JSON.stringify(referenceImages)}`,
      ].join("\n"),
    )
  }

  const targetSize: TargetSize = {
    width: Number(input.extra && typeof input.extra.width === "number" ? input.extra.width : 1024),
    height: Number(input.extra && typeof input.extra.height === "number" ? input.extra.height : 1024),
  }
  const taskType = getTaskType({
    generationMode,
    taskType: input.extra && typeof input.extra.taskType === "string" ? input.extra.taskType : undefined,
  })
  const requestBody = {
    user: { idx: userIdx },
    task_type: taskType,
    args: {
      tag_name: input.styleModel ?? "Qwen-Image",
      num_image: input.count ?? 2,
      target: input.extra && typeof input.extra.target === "string" ? input.extra.target : "flux1-dev",
      target_size: targetSize,
      loras: Array.isArray(input.extra?.loras) ? input.extra.loras : [],
      mode: input.extra && typeof input.extra.mode === "string" ? input.extra.mode : "performance",
      ref_img_list: referenceImages,
      customer_prompt: input.prompt,
      prompt: buildPrompt(input),
    },
  }
  const reqBody = JSON.stringify(requestBody)
  const reqQuery = formatQuery({ Action: "CVProcess", Version: "2022-08-31" })
  const debugRequest = {
    url: `${ENDPOINT}?${reqQuery}`,
    method: METHOD,
    query: { Action: "CVProcess", Version: "2022-08-31" },
    body: requestBody,
  }

  for (const attempt of [1, 2, 3]) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMsFor("IMAGE_CREATE_TIMEOUT_MS", DEFAULT_TIMEOUT_MS))
    const signed = signV4Request({
      accessKey: env("IMAGE_ACCESS_KEY") ?? "",
      secretKey: env("IMAGE_SECRET_KEY") ?? "",
      reqQuery,
      reqBody,
    })
    console.log("[studio.internel] request", JSON.stringify(debugRequest, null, 2))
    const response = await fetch(signed.requestUrl, {
      method: METHOD,
      headers: signed.headers,
      body: reqBody,
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout))
    const bodyText = (await response.text()).replace(/\\u0026/g, "&")

    if (response.ok) {
      const raw = parseJson(bodyText)
      console.log("[studio.internel] response", summarizeInternalOutput(raw, bodyText))
      const imageUrls = collectImageUrls(raw).filter(isRenderableImageUrl)
      const binaryImages = collectBase64Images(raw).map(base64ToDataUrl).filter(isRenderableImageUrl)
      const images = Array.from(new Set([...imageUrls, ...binaryImages]))
      return {
        provider: "internel",
        model: taskType,
        images: images.map((url) => ({ url })),
        request: debugRequest,
        statusCode: response.status,
        rawBody: bodyText,
        raw,
      }
    }

    if (attempt < 3 && isRetriableHttpStatus(response.status)) {
      await sleep(getBackoffMs(attempt))
      continue
    }

    throw new Error(
      [
        "Internal image API request failed.",
        `attempt=${attempt}/3`,
        `status=${response.status}`,
        `statusText=${response.statusText}`,
        `body=${bodyText}`,
      ].join("\n"),
    )
  }

  throw new Error("Internal image API request failed after retries.")
}

export const InternelImageGenerateTool = Tool.define<
  typeof Parameters,
  { request?: unknown; response?: unknown; statusCode?: number; rawBody?: string },
  never
>(
  "internel_image_generate",
  Effect.succeed({
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
        return {
          title: "Internal image generation",
          metadata: {
            request: result.request,
            response: summarizeInternalOutput(result.raw, result.rawBody),
            statusCode: result.statusCode,
          },
          output: JSON.stringify(
            {
              ok: true,
              provider: result.provider,
              model: result.model,
              imageCount: result.images.length,
              primaryImage: attachments[0]?.filename ?? null,
            },
            null,
            2,
          ),
          attachments,
        }
      }).pipe(Effect.orDie),
  }),
)
