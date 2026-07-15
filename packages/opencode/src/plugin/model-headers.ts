import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import * as Log from "@opencode-ai/core/util/log"

const CACHE_DURATION = 60_000
const log = Log.create({ service: "models-api" })
let modelsApi: { source: "http" | "local"; url?: string; w3Api?: string; token?: string } | undefined
let cache: { key: string; api: Record<string, unknown>; expires: number } | undefined
let loading: { key: string; promise: Promise<Record<string, unknown> | undefined> } | undefined

function modelsApiKey(input = modelsApi) {
  if (!input) return ""
  return JSON.stringify([input.source, input.url, input.w3Api, input.token])
}

export function configureModelsApi(input: { source?: string; url?: string; w3Api?: string; token?: string }) {
  const source = input.source === "local" ? "local" : "http"
  if (source === "local") {
    cache = undefined
    modelsApi = { source, token: input.token }
    return
  }
  if (!input.url) {
    cache = undefined
    modelsApi = { source, token: input.token }
    return
  }
  try {
    const url = new URL(input.url)
    if (url.protocol !== "http:" && url.protocol !== "https:") return
    const w3Api = input.w3Api ? new URL(input.w3Api) : undefined
    if (w3Api && w3Api.protocol !== "http:" && w3Api.protocol !== "https:") return
    const next = { source, url: url.toString(), w3Api: w3Api?.toString(), token: input.token } as const
    if (
      modelsApi?.source !== next.source ||
      modelsApi.url !== next.url ||
      modelsApi.w3Api !== next.w3Api ||
      modelsApi.token !== next.token
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
    w3Api: headers["x-opencode-w3-api"],
    token: headers.uiplustoken,
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

function apiModels(value: unknown): Record<string, unknown> {
  const input = parseJson(value)
  if (!isRecord(input)) return {}

  const direct = Object.fromEntries(
    Object.entries(input).filter(
      ([, provider]) => isRecord(provider) && (isRecord(provider.models) || Array.isArray(provider.models)),
    ),
  )
  if (Object.keys(direct).length > 0) return direct

  return ["content", "data", "provider", "providers", "result"]
    .map((key) => apiModels(input[key]))
    .find((providers) => Object.keys(providers).length > 0) ?? {}
}

async function loadApi(force = false) {
  if (!modelsApi || modelsApi.source !== "http" || !modelsApi.url) return
  const current = { ...modelsApi, url: modelsApi.url }
  const key = modelsApiKey(current)
  if (!force && cache?.key === key && cache.expires > Date.now()) return cache.api
  if (loading?.key === key) return loading.promise

  const promise = fetch(current.url, {
    headers: current.token ? { uiplustoken: current.token } : {},
  })
    .then(async (response) => {
      if (!response.ok) {
        log.warn("request failed", { url: current.url, status: response.status, statusText: response.statusText })
        return
      }
      const api = apiModels(await response.json())
      log.info("request completed", { url: current.url, providers: Object.keys(api).length })
      return api
    })
    .catch((error: unknown) => {
      log.error("request error", {
        url: current.url,
        error: error instanceof Error ? error.message : String(error),
      })
      return undefined
    })
  loading = { key, promise }
  const api = await promise
  if (api && modelsApiKey() === key) cache = { key, api, expires: Date.now() + CACHE_DURATION }
  if (loading?.key === key) loading = undefined
  return api
}

export function modelsApiSource() {
  return modelsApi?.source
}

export function loadModelsApi(force = false) {
  return loadApi(force)
}

export async function modelsApiProviderUrl(providerID: string) {
  if (providerID === "w3" && modelsApi?.w3Api) return modelsApi.w3Api
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
