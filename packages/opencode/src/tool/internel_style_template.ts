const METHOD = "POST"
const DEFAULT_TIMEOUT_MS = 120_000

type ImportMetaWithEnv = ImportMeta & {
  env?: {
    OCTO_CHANNEL?: string
  }
}
type InternalStyleTemplateEndpointPreset = {
  styleDescriptionGenUrl: string
  styleTemplatePublishUrl: string
}

const LOCAL_STYLE_TEMPLATE_ENDPOINTS = {
  styleDescriptionGenUrl: "http://localhost:3000/style_description_gen",
  styleTemplatePublishUrl: "http://localhost:3000/image_template",
} satisfies InternalStyleTemplateEndpointPreset

const BETA_STYLE_TEMPLATE_ENDPOINTS = {
  styleDescriptionGenUrl: "https://octoai-api-test.ucd.huawei.com/nexo-api-test/pixso/aiImageGeneration/image_template/style_description",
  styleTemplatePublishUrl: "https://octoai-api-test.ucd.huawei.com/nexo-api-test/pixso/aiImageGeneration/image_template",
} satisfies InternalStyleTemplateEndpointPreset

const PROD_STYLE_TEMPLATE_ENDPOINTS = {
  styleDescriptionGenUrl: "https://octoai-api.ucd.huawei.com/nexo-api/pixso/aiImageGeneration/image_template/style_description",
  styleTemplatePublishUrl: "https://octoai-api.ucd.huawei.com/nexo-api/pixso/aiImageGeneration/image_template",
} satisfies InternalStyleTemplateEndpointPreset

const DEFAULT_USER_IDX = ""

export type StudioStyleDimensionId =
  | "tonal"
  | "composition"
  | "volume"
  | "surface"
  | "color"
  | "linework"
  | "shape_structure"
  | "role_design"
  | "lettering"
  | "post_processing"

export type StyleDescriptionGenRequest = {
  style_keywords: string
  style_images: Array<{ url: string }>
  style_dimensions: StudioStyleDimensionId[]
}

export type StyleDescriptionGenStreamEvent = {
  type: string
  content?: string
}

export type StyleTemplateBusinessResponse = {
  resp_code?: number
  resp_msg?: string
  result?: unknown
}

type TemplateUploadImage = {
  url: string
}

type StyleTemplatePublishBaseRequest = {
  allowed_user_id: string | null
  creator_user_id: string
  example_images: ReadonlyArray<TemplateUploadImage>
  permission_type: "all_users" | "specified_users"
  prompt_setting: "required" | "optional" | "not_supported"
  reference_image_count: 0 | 1 | 2 | 3
  reference_image_setting: "fixed" | "optional" | "not_supported"
  template_type: "extract_style" | "preset_recipe"
  title: string
  usage_instructions: string
}

type StyleTemplateDescription = {
  overview: string
} & Partial<Record<StudioStyleDimensionId, string>>

export type StyleTemplatePublishRequest =
  | (StyleTemplatePublishBaseRequest & {
    template_type: "extract_style"
    style_description: StyleTemplateDescription
    style_images: ReadonlyArray<TemplateUploadImage>
    style_keywords: string
  })
  | (StyleTemplatePublishBaseRequest & {
    template_type: "preset_recipe"
    fixed_reference_images: ReadonlyArray<TemplateUploadImage>
    play_description: string
  })

function octoChannel() {
  return (import.meta as ImportMetaWithEnv).env?.OCTO_CHANNEL ?? process.env.OCTO_CHANNEL ?? "prod"
}

function internalStyleTemplateEndpoints() {
  if (octoChannel() === "prod") return PROD_STYLE_TEMPLATE_ENDPOINTS
  if (octoChannel() === "beta") return BETA_STYLE_TEMPLATE_ENDPOINTS
  return LOCAL_STYLE_TEMPLATE_ENDPOINTS
}

const DEFAULT_STYLE_DESCRIPTION_GEN = internalStyleTemplateEndpoints().styleDescriptionGenUrl
const DEFAULT_STYLE_TEMPLATE_PUBLISH = internalStyleTemplateEndpoints().styleTemplatePublishUrl

function env(name: string) {
  return process.env[name]
}

function internalStyleTemplateHeaders(input: { accept?: string } = {}) {
  return {
    "content-type": "application/json",
    accept: input.accept ?? "application/json",
    ...(env("IMAGE_API_TOKEN") ? { authorization: `Bearer ${env("IMAGE_API_TOKEN")}` } : {}),
    ...(env("IMAGE_API_COOKIE") ? { cookie: env("IMAGE_API_COOKIE") } : {}),
    ...(env("IMAGE_API_CLIENT_ID") ? { "x-client-id": env("IMAGE_API_CLIENT_ID") } : {}),
    ...(env("IMAGE_API_CLIENT_SECRET") ? { "x-client-secret": env("IMAGE_API_CLIENT_SECRET") } : {}),
  }
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

function parseJson(text: string) {
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error(`style_template returned non-JSON response:\n${text}`)
  }
}

function parseBusinessResponse(text: string, action: string): StyleTemplateBusinessResponse {
  const json = parseJson(text) as StyleTemplateBusinessResponse
  if (json.resp_code === 200) return json
  throw new Error(
    [
      `${action} returned business failure.`,
      `resp_code=${json.resp_code ?? ""}`,
      `resp_msg=${json.resp_msg ?? ""}`,
      `body=${JSON.stringify(json, null, 2)}`,
    ].join("\n"),
  )
}

function parseStyleDescriptionStreamEvent(data: string): StyleDescriptionGenStreamEvent {
  const parsed = (() => {
    try {
      return JSON.parse(data) as unknown
    } catch {
      throw new Error(`style_description_gen returned non-JSON event:\n${data}`)
    }
  })()
  if (!parsed || typeof parsed !== "object" || !("type" in parsed) || typeof parsed.type !== "string") {
    throw new Error(`style_description_gen returned invalid event:\n${data}`)
  }
  return {
    type: parsed.type,
    content: "content" in parsed && typeof parsed.content === "string" ? parsed.content : "",
  }
}

function sseDataBlocks(buffer: string) {
  const normalized = buffer.replaceAll("\r\n", "\n")
  const parts = normalized.split("\n\n")
  return {
    blocks: parts.slice(0, -1),
    rest: parts.at(-1) ?? "",
  }
}

function sseData(block: string) {
  return block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
}

async function readStyleDescriptionEventStream(
  body: ReadableStream<Uint8Array>,
  handlers: {
    onEvent: (event: StyleDescriptionGenStreamEvent) => void | Promise<void>
    signal?: AbortSignal
  },
) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  while (!handlers.signal?.aborted) {
    const chunk = await reader.read()
    if (chunk.done) break
    buffer += decoder.decode(chunk.value, { stream: true })
    const blocks = sseDataBlocks(buffer)
    buffer = blocks.rest
    for (const block of blocks.blocks) {
      const data = sseData(block)
      if (data) await handlers.onEvent(parseStyleDescriptionStreamEvent(data))
    }
  }

  buffer += decoder.decode()
  const data = sseData(buffer)
  if (data && !handlers.signal?.aborted) await handlers.onEvent(parseStyleDescriptionStreamEvent(data))
}

export async function generateStyleDescriptionStream(
  input: StyleDescriptionGenRequest,
  handlers: {
    onEvent: (event: StyleDescriptionGenStreamEvent) => void | Promise<void>
    signal?: AbortSignal
  },
) {
  const url = env("IMAGE_STYLE_DESCRIPTION_GEN_URL") ?? DEFAULT_STYLE_DESCRIPTION_GEN
  if (!url || url === "xx") throw new Error("style_description_gen url is not configured.")

  const controller = new AbortController()
  const signal = handlers.signal ? AbortSignal.any([controller.signal, handlers.signal]) : controller.signal
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)
  const response = await fetch(url, {
    method: METHOD,
    headers: internalStyleTemplateHeaders({ accept: "text/event-stream" }),
    body: JSON.stringify(input),
    signal,
  }).catch((error) => {
    if (signal.aborted) throw error
    throw new Error(
      [
        "style_description_gen network failed.",
        `url=${url}`,
        `error=${describeError(error)}`,
      ].join("\n"),
    )
  }).finally(() => clearTimeout(timeout))

  if (!response.ok) {
    const text = await response.text()
    throw new Error(
      [
        "style_description_gen failed.",
        `status=${response.status}`,
        `statusText=${response.statusText}`,
        `body=${text}`,
      ].join("\n"),
    )
  }
  if (!response.body) throw new Error("style_description_gen returned empty stream.")

  await readStyleDescriptionEventStream(response.body, { ...handlers, signal })
}

export async function publishInternalStyleTemplate(input: StyleTemplatePublishRequest): Promise<unknown> {
  const url = env("IMAGE_STYLE_TEMPLATE_PUBLISH_URL") ?? DEFAULT_STYLE_TEMPLATE_PUBLISH
  if (!url || url === "xx") throw new Error("style_template_publish url is not configured.")

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)
  const response = await fetch(url, {
    method: METHOD,
    headers: internalStyleTemplateHeaders(),
    body: JSON.stringify({
      ...input,
      creator_user_id: input.creator_user_id || env("IMAGE_USER_IDX") || DEFAULT_USER_IDX,
    }),
    signal: controller.signal,
  }).catch((error) => {
    throw new Error(
      [
        "style_template_publish network failed.",
        `url=${url}`,
        `error=${describeError(error)}`,
      ].join("\n"),
    )
  }).finally(() => clearTimeout(timeout))

  const text = await response.text()
  if (!response.ok) {
    throw new Error(
      [
        "style_template_publish failed.",
        `status=${response.status}`,
        `statusText=${response.statusText}`,
        `body=${text}`,
      ].join("\n"),
    )
  }
  if (!text.trim()) throw new Error("style_template_publish returned empty response.")
  return parseBusinessResponse(text, "style_template_publish")
}
