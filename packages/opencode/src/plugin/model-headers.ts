import type { Hooks, PluginInput } from "@opencode-ai/plugin"

const CACHE_DURATION = 60_000
let modelsApi: { source: "http" | "local"; url?: string; token?: string; account?: string } | undefined
let cache: { api: Record<string, unknown>; expires: number } | undefined
let loading: Promise<Record<string, unknown> | undefined> | undefined

export function configureModelsApi(input: { source?: string; url?: string; token?: string; account?: string }) {
  const source = input.source === "local" ? "local" : "http"
  if (source === "local") {
    cache = undefined
    modelsApi = { source, token: input.token, account: input.account }
    return
  }
  if (!input.url) {
    cache = undefined
    modelsApi = { source, token: input.token, account: input.account }
    return
  }
  try {
    const url = new URL(input.url)
    if (url.protocol !== "http:" && url.protocol !== "https:") return
    const next = { source, url: url.toString(), token: input.token, account: input.account } as const
    if (
      modelsApi?.source !== next.source ||
      modelsApi.url !== next.url ||
      modelsApi.token !== next.token ||
      modelsApi.account !== next.account
    ) {
      cache = undefined
    }
    modelsApi = next
  } catch {}
}

export function configureModelsApiHeaders(headers: Record<string, string | undefined>) {
  if (!headers["x-opencode-models-api-source"] && !headers["x-opencode-models-api-url"]) return
  configureModelsApi({
    source: headers["x-opencode-models-api-source"],
    url: headers["x-opencode-models-api-url"],
    token: headers.uiplustoken,
    account: headers["x-opencode-w3-account"],
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function readHeaders(value: unknown) {
  if (!isRecord(value)) return
  const headers = value.headers
  if (!isRecord(headers)) return
  return Object.fromEntries(
    Object.entries(headers).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  )
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function normalizeModels(value: unknown) {
  const entries = Array.isArray(value)
    ? value.flatMap((model) => (isRecord(model) && typeof model.id === "string" ? [[model.id, model] as const] : []))
    : isRecord(value)
      ? Object.entries(value)
      : []

  return Object.fromEntries(
    entries.flatMap(([key, model]) => {
      if (!isRecord(model)) return []
      const id = typeof model.id === "string" && model.id ? model.id : key
      const limit = isRecord(model.limit) ? model.limit : {}
      return [
        [
          id,
          {
            ...model,
            id,
            name: typeof model.name === "string" && model.name ? model.name : id,
            release_date: typeof model.release_date === "string" ? model.release_date : "",
            attachment: model.attachment === true,
            reasoning: model.reasoning === true,
            temperature: model.temperature === true,
            tool_call: model.tool_call !== false,
            limit: {
              ...limit,
              context: typeof limit.context === "number" ? limit.context : 0,
              output: typeof limit.output === "number" ? limit.output : 0,
            },
          },
        ] as const,
      ]
    }),
  )
}

export function parseModelsApi(value: unknown): Record<string, unknown> {
  const input = parseJson(value)
  if (!isRecord(input)) return {}

  const direct = Object.fromEntries(
    Object.entries(input).flatMap(([key, provider]) => {
      if (!isRecord(provider) || (!isRecord(provider.models) && !Array.isArray(provider.models))) return []
      const id = typeof provider.id === "string" && provider.id ? provider.id : key
      return [
        [
          id,
          {
            ...provider,
            id,
            name: typeof provider.name === "string" && provider.name ? provider.name : id,
            env: Array.isArray(provider.env)
              ? provider.env.filter((item): item is string => typeof item === "string")
              : [],
            models: normalizeModels(provider.models),
          },
        ] as const,
      ]
    }),
  )
  if (Object.keys(direct).length > 0) return direct

  return (
    ["content", "data", "provider", "providers", "result"]
      .map((key) => parseModelsApi(input[key]))
      .find((providers) => Object.keys(providers).length > 0) ?? {}
  )
}

async function loadApi() {
  if (!modelsApi || modelsApi.source !== "http" || !modelsApi.url) return
  if (cache && cache.expires > Date.now()) return cache.api
  if (loading) return loading

  loading = fetch(modelsApi.url, {
    headers: modelsApi.token ? { uiplustoken: modelsApi.token } : {},
  })
    .then(async (response) => (response.ok ? parseModelsApi(await response.json()) : undefined))
    .catch(() => undefined)
    .finally(() => {
      loading = undefined
    })
  const api = await loading
  if (api) cache = { api, expires: Date.now() + CACHE_DURATION }
  return api
}

export function modelsApiCatalog() {
  return loadApi()
}

export async function modelsApiProviderUrl(providerID: string) {
  const api = await loadApi()
  const provider = api?.[providerID]
  if (!isRecord(provider)) return
  if (typeof provider.api !== "string") return
  return provider.api.trim() || undefined
}

function findApiModel(api: Record<string, unknown>, providerID: string, modelID: string, apiID: string) {
  const provider = api[providerID]
  if (!isRecord(provider) || !isRecord(provider.models)) return
  const direct = provider.models[modelID] ?? provider.models[apiID]
  if (direct) return direct
  return Object.values(provider.models).find((model) => isRecord(model) && model.id === apiID)
}

export function modelRequestBody(body: unknown, isExternal?: boolean) {
  if (!isRecord(body)) return body
  return {
    ...body,
    isExternal: isExternal ?? false,
    ...(modelsApi?.account ? { w3Account: modelsApi.account } : {}),
  }
}

export async function ModelHeadersPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    "chat.headers": async (input, output) => {
      const api = await loadApi()
      Object.assign(
        output.headers,
        api ? readHeaders(findApiModel(api, input.model.providerID, input.model.id, input.model.api.id)) : undefined,
        modelsApi?.token ? { uiplustoken: modelsApi.token } : {},
      )
    },
  }
}
