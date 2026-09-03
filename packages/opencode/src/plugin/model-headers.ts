import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Schema } from "effect"
import * as ModelsDev from "@/provider/models"

let modelsApi = { url: catalogUrl(Flag.OPENCODE_MODELS_URL ?? "https://models.dev") } as {
  url: string
  headers?: Record<string, string>
}
let loading: { key: string; promise: Promise<Record<string, ModelsDev.Provider>> } | undefined

const decodeCatalog = Schema.decodeUnknownSync(Schema.Record(Schema.String, ModelsDev.Provider))

function catalogUrl(value: string) {
  const url = new URL(value)
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Models API URL must use HTTP or HTTPS")
  if (url.pathname === "/") url.pathname = "/api.json"
  if (url.pathname.endsWith("/")) url.pathname = `${url.pathname}api.json`
  return url.toString()
}

export function configureModelsApi(input: { url?: string; headers?: Record<string, string> }) {
  modelsApi = {
    url: catalogUrl(input.url ?? Flag.OPENCODE_MODELS_URL ?? "https://models.dev"),
    headers: input.headers,
  }
}

export function configureModelsApiHeaders(headers: Record<string, string | undefined>) {
  if (!headers["x-opencode-models-api-url"]) return
  configureModelsApi({
    url: headers["x-opencode-models-api-url"],
    headers: headers.uiplustoken ? { uiplustoken: headers.uiplustoken } : undefined,
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
    Object.entries(input).flatMap(([key, provider]) => {
      if (!isRecord(provider)) return []
      if (isRecord(provider.models)) return [[key, provider]]
      if (!Array.isArray(provider.models)) return []
      return [
        [
          key,
          {
            ...provider,
            models: Object.fromEntries(
              provider.models.flatMap((model) =>
                isRecord(model) && typeof model.id === "string" ? [[model.id, model]] : [],
              ),
            ),
          },
        ],
      ]
    }),
  )
  if (Object.keys(direct).length > 0) return direct
  return (
    ["content", "data", "provider", "providers", "result"]
      .map((key) => apiModels(input[key]))
      .find((providers) => Object.keys(providers).length > 0) ?? {}
  )
}

export async function fetchRemoteModelCatalog(input: {
  url: string
  headers?: Record<string, string>
  signal?: AbortSignal
}) {
  console.log("[models-api] outgoing request", {
    url: input.url,
    headerNames: Object.keys(input.headers ?? {}),
    hasUiplusToken: Boolean(input.headers?.uiplustoken),
  })
  const response = await fetch(input.url, {
    headers: input.headers,
    signal: input.signal,
    cache: "no-store",
  })
  const raw = await response.text()
  console.log("[models-api] remote response", {
    url: input.url,
    status: response.status,
    contentType: response.headers.get("content-type"),
    body: raw,
  })
  if (!response.ok) throw new Error(`Failed to fetch remote model catalog: ${response.status}`)
  const models = apiModels(parseJson(raw))
  console.log("[models-api] parsed providers", {
    providerIDs: Object.keys(models),
    models,
  })
  const result = Object.fromEntries(Object.values(decodeCatalog(models)).map((provider) => [provider.id, provider]))
  if (Object.keys(result).length === 0) throw new Error("Remote model catalog is empty")
  return result
}

export async function modelsApiCatalog() {
  const key = JSON.stringify(modelsApi)
  if (loading?.key === key) return loading.promise
  const promise = fetchRemoteModelCatalog(modelsApi).finally(() => {
    if (loading?.promise === promise) loading = undefined
  })
  loading = { key, promise }
  return promise
}

export async function modelsApiProviderUrl(providerID: string) {
  const provider = (await modelsApiCatalog())[providerID]
  return provider?.api?.trim() || undefined
}

function findApiModel(api: Record<string, ModelsDev.Provider>, providerID: string, modelID: string, apiID: string) {
  const provider = api[providerID]
  if (!provider) return
  const direct = provider.models[modelID] ?? provider.models[apiID]
  if (direct) return direct
  return Object.values(provider.models).find((model) => model.id === apiID)
}

export async function ModelHeadersPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    "chat.headers": async (input, output) => {
      Object.assign(
        output.headers,
        readHeaders(findApiModel(await modelsApiCatalog(), input.model.providerID, input.model.id, input.model.api.id)),
      )
    },
  }
}
