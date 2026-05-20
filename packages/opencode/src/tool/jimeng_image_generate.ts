import { createHash, createHmac } from "node:crypto"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import type { ImageGenerateInput, ImageGenerateOutput } from "@/studio/image-provider"

const METHOD = "POST"
const HOST = "visual.volcengineapi.com"
const REGION = "cn-north-1"
const ENDPOINT = "https://visual.volcengineapi.com"
const SERVICE = "cv"
const DEFAULT_REQ_KEY = "jimeng_t2i_v40"
const DEFAULT_ACCESS_KEY = "AKLTZTZmZTRmOGJlN2EwNDRiZWI4NGY3OWIyMmMxYzgyMmU"
const DEFAULT_SECRET_KEY = "TmpabU1qZzNOVFprT0RReE5HSXhNMkpoTlRNMU1XRXdZbVJqTmpJeE16SQ=="
const DEFAULT_TIMEOUT_MS = 120_000

type JsonRecord = Record<string, unknown>

export const Parameters = Schema.Struct({
  capability: Schema.Literals([
    "image.generate",
    "video.generate",
    "image.upscale",
    "image.cutout",
    "image.inpaint",
    "image.outpaint",
    "image.fusion",
  ]),
  prompt: Schema.String,
  aspectRatio: Schema.optional(Schema.String),
  count: Schema.optional(Schema.Number),
  styleModel: Schema.optional(Schema.String),
  referenceImages: Schema.optional(Schema.Array(Schema.String)),
  sourceImage: Schema.optional(Schema.String),
  extra: Schema.optional(Schema.Record(Schema.String, Schema.Any)),
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
    throw new Error(`Jimeng API returned non-JSON response:\n${text}`)
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
  if (Array.isArray(value)) return value.flatMap((item) => collectImageUrls(item))
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
      const value = record[key]
      if (typeof value === "string" && value.length > 0) seen.add(value)
      if (Array.isArray(value)) {
        value.forEach((entry) => {
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
  if (url.includes("visual.volcengineapi.com?Action=CVProcess&Version=2022-08-31")) return false
  return /^https?:\/\/\S+|^data:image\/[a-z0-9.+-]+;base64,\S+$/i.test(url)
}

export function summarizeJimengOutput(raw: unknown, bodyText = "") {
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

function isRetriable(status: number) {
  return [408, 409, 425, 429, 500, 502, 503, 504].includes(status)
}

function backoffMs(attempt: number) {
  return Math.min(1000 * Math.pow(2, attempt - 1), 8000) + Math.floor(Math.random() * 500)
}

function env(name: string) {
  return process.env[name]
}

function timeoutMsFor(name: string, fallback: number) {
  const value = Number(env(name))
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function isSupportedImageInput(value: string) {
  return /^(https?:\/\/\S+|data:image\/[a-z0-9.+-]+;base64,\S+)$/i.test(value)
}

export function resolveReferenceImages(input: Pick<ImageGenerateInput, "referenceImages" | "sourceImage">) {
  return [...(input.referenceImages ?? []), ...(input.sourceImage ? [input.sourceImage] : [])].filter(
    (item, index, list): item is string => !!item && isSupportedImageInput(item) && list.indexOf(item) === index,
  )
}

function reqKeyFor(input: { referenceImages: string[] }) {
  if (input.referenceImages.length > 0) {
    return env("JIMENG_EDIT_REQ_KEY") ?? env("JIMENG_REQ_KEY") ?? DEFAULT_REQ_KEY
  }
  return env("JIMENG_REQ_KEY") ?? DEFAULT_REQ_KEY
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
    .filter((item): item is string => !!item)
    .join("\n")
}

export async function executeJimengImageGenerate(input: ImageGenerateInput): Promise<ImageGenerateOutput> {
  const accessKey = env("JIMENG_ACCESS_KEY") ?? DEFAULT_ACCESS_KEY
  const secretKey = env("JIMENG_SECRET_KEY") ?? DEFAULT_SECRET_KEY
  const referenceImages = resolveReferenceImages(input)
  const requestBody = {
    req_key: reqKeyFor({ referenceImages }),
    prompt: buildPrompt(input),
    scale: 0.5,
    ...(referenceImages.length > 0 ? { image_urls: referenceImages } : {}),
    ...(input.extra ?? {}),
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
    const timeout = setTimeout(() => controller.abort(), timeoutMsFor("JIMENG_TIMEOUT_MS", DEFAULT_TIMEOUT_MS))
    const signed = signV4Request({ accessKey, secretKey, reqQuery, reqBody })
    console.log("[studio.jimeng] request", JSON.stringify(debugRequest, null, 2))
    const response = await fetch(signed.requestUrl, {
      method: METHOD,
      headers: signed.headers,
      body: reqBody,
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout))
    const bodyText = (await response.text()).replace(/\\u0026/g, "&")

    if (response.ok) {
      const raw = parseJson(bodyText)
      console.log("[studio.jimeng] response", summarizeJimengOutput(raw, bodyText))
      const imageUrls = collectImageUrls(raw).filter(isRenderableImageUrl)
      const binaryImages = collectBase64Images(raw).map(base64ToDataUrl).filter(isRenderableImageUrl)
      const images = Array.from(new Set([...imageUrls, ...binaryImages]))
      return {
        provider: "jimeng",
        model: reqKeyFor({ referenceImages }),
        images: images.map((url) => ({ url })),
        request: debugRequest,
        statusCode: response.status,
        rawBody: bodyText,
        raw,
      }
    }

    if (attempt < 3 && isRetriable(response.status)) {
      await sleep(backoffMs(attempt))
      continue
    }

    throw new Error(
      [
        "Jimeng API request failed.",
        `attempt=${attempt}/3`,
        `status=${response.status}`,
        `statusText=${response.statusText}`,
        `body=${bodyText}`,
      ].join("\n"),
    )
  }

  throw new Error("Jimeng API request failed after retries.")
}

export const JimengImageGenerateTool = Tool.define<typeof Parameters, Metadata, never>(
  "jimeng_image_generate",
  Effect.succeed({
    description: "Generate or edit images through the built-in Jimeng image generation tool.",
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>) =>
      Effect.promise(async () => {
        const result = await executeJimengImageGenerate({
          ...params,
          referenceImages: params.referenceImages ? [...params.referenceImages] : undefined,
        })
        const attachments = result.images.map((image, index) => ({
          type: "file" as const,
          mime: "image/png",
          url: image.url,
          filename: `jimeng-${index + 1}.png`,
        }))
        const outputImages = attachments.map((item) => item.url).filter((url) => !url.startsWith("data:image/"))
        return {
          title: "Jimeng image generation",
          metadata: {
            request: result.request,
            response: summarizeJimengOutput(result.raw, result.rawBody),
            statusCode: result.statusCode,
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
  }),
)
