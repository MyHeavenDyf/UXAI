const METHOD = "POST"
const DEFAULT_TIMEOUT_MS = 120_000

type ImportMetaWithEnv = ImportMeta & {
  env?: {
    OCTO_CHANNEL?: string
  }
}
type InternalStyleTemplateEndpointPreset = {
  styleDescriptionGenUrl: string
}

const LOCAL_STYLE_TEMPLATE_ENDPOINTS = {
  styleDescriptionGenUrl: "http://localhost:3000/style_description_gen",
} satisfies InternalStyleTemplateEndpointPreset

const BETA_STYLE_TEMPLATE_ENDPOINTS = {
  styleDescriptionGenUrl: "xx",
} satisfies InternalStyleTemplateEndpointPreset

const PROD_STYLE_TEMPLATE_ENDPOINTS = {
  styleDescriptionGenUrl: "xx",
} satisfies InternalStyleTemplateEndpointPreset

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

function octoChannel() {
  return (import.meta as ImportMetaWithEnv).env?.OCTO_CHANNEL ?? process.env.OCTO_CHANNEL ?? "prod"
}

function internalStyleTemplateEndpoints() {
  if (octoChannel() === "prod") return PROD_STYLE_TEMPLATE_ENDPOINTS
  if (octoChannel() === "beta") return BETA_STYLE_TEMPLATE_ENDPOINTS
  return LOCAL_STYLE_TEMPLATE_ENDPOINTS
}

const DEFAULT_STYLE_DESCRIPTION_GEN = internalStyleTemplateEndpoints().styleDescriptionGenUrl

function env(name: string) {
  return process.env[name]
}

function internalStyleTemplateHeaders() {
  return {
    "content-type": "application/json",
    accept: "text/event-stream",
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
    headers: internalStyleTemplateHeaders(),
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
