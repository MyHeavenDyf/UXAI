import type { Model } from "@opencode-ai/sdk/v2/client"

type Modality = keyof Model["capabilities"]["input"]

type ApiModel = {
  id?: string
  name?: string
  family?: string
  release_date?: string
  headers?: Record<string, string>
  capabilities?: Model["capabilities"]
  cost?: Model["cost"]
  status?: Model["status"]
  options?: Model["options"]
  variants?: Model["variants"]
  modalities?: {
    input?: Modality[]
    output?: Modality[]
  }
  limit?: {
    context?: number
    input?: number
    output?: number
  }
}

type ApiProvider = {
  id?: string
  name?: string
  api?: string
  models?: Record<string, ApiModel> | ApiModel[]
}

export type ApiModels = Record<string, ApiProvider | null | undefined>
type ProviderLike = { id: string; name: string }
let latestModelsApi: ApiModels | undefined
const refreshModelsApiListeners = new Set<(models: ApiModels) => void | Promise<void>>()
type ModelsApiBridge = {
  pipelineRequest?: (
    url: string,
    method: string,
    uiplusToken: string,
    body?: unknown,
    headers?: Record<string, string>,
  ) => Promise<unknown>
}

export const MODELS_API_URL_STORAGE_KEY = "opencode.modelsApiUrl"
export const MODELS_API_SOURCE_STORAGE_KEY = "opencode.modelsApiSource"
export const MODELS_API_W3_API_STORAGE_KEY = "opencode.modelsApiW3Api"

const DEFAULT_MODELS_API_URL = {
  beta: "",
  prod: "",
} as const

function localStorageValue(key: string) {
  if (typeof localStorage === "undefined") return ""
  return localStorage.getItem(key)?.trim() ?? ""
}

function uiplusToken() {
  return localStorageValue("uiplusToken")
}

function modelsApiChannel() {
  const channel = (import.meta.env as Record<string, string | undefined>).VITE_OCTO_CHANNEL
  return channel === "prod" ? "prod" : "beta"
}

export function modelsApiSource() {
  const env = import.meta.env as Record<string, string | undefined>
  const source = localStorageValue(MODELS_API_SOURCE_STORAGE_KEY) || env.VITE_OCTO_MODELS_API_SOURCE
  return source === "http" ? "http" : "local"
}

function modelsApiBaseUrl() {
  const env = import.meta.env as unknown as Record<string, string | undefined>
  return (
    localStorageValue(MODELS_API_URL_STORAGE_KEY) ||
    env.VITE_OCTO_MODELS_API_URL ||
    DEFAULT_MODELS_API_URL[modelsApiChannel()]
  )
}

export function modelsApiUrl() {
  if (modelsApiSource() !== "http") return
  const baseURL = modelsApiBaseUrl()
  if (!baseURL) return
  const url = new URL(baseURL)
  if (url.pathname === "/") url.pathname = "/api.json"
  if (url.pathname.endsWith("/")) url.pathname = `${url.pathname}api.json`
  return url.toString()
}

function cachedW3Api(modelsApiUrl: string | undefined) {
  if (!modelsApiUrl) return
  const value = localStorageValue(MODELS_API_W3_API_STORAGE_KEY)
  if (!value) return
  try {
    const cached = JSON.parse(value) as { modelsApiUrl?: unknown; api?: unknown }
    if (cached.modelsApiUrl !== modelsApiUrl || typeof cached.api !== "string") return
    return cached.api.trim() || undefined
  } catch {
    return
  }
}

function storeW3Api(api: ApiModels, modelsApiUrl: string) {
  if (typeof localStorage === "undefined") return
  const value = api.w3?.api?.trim()
  if (!value) {
    localStorage.removeItem(MODELS_API_W3_API_STORAGE_KEY)
    return
  }
  localStorage.setItem(MODELS_API_W3_API_STORAGE_KEY, JSON.stringify({ modelsApiUrl, api: value }))
}

export function modelsApiHeaders() {
  const source = modelsApiSource()
  const token = uiplusToken()
  const url = modelsApiUrl()
  const w3Api = source === "http" ? latestModelsApi?.w3?.api?.trim() || cachedW3Api(url) : undefined
  return {
    "x-opencode-models-api-source": source,
    ...(url ? { "x-opencode-models-api-url": url } : {}),
    ...(w3Api ? { "x-opencode-w3-api": w3Api } : {}),
    ...(token ? { uiplustoken: token } : {}),
  }
}

function modelsApiBridge() {
  if (typeof window === "undefined") return undefined
  return (window as unknown as { api?: ModelsApiBridge }).api?.pipelineRequest
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function isApiModels(value: unknown): value is Record<string, ApiModel> | ApiModel[] {
  return isRecord(value) || Array.isArray(value)
}

function isApiProvider(value: unknown): value is ApiProvider {
  return isRecord(value) && isApiModels(value.models)
}

function parseJson(value: string) {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

function apiContent(value: unknown) {
  if (!isRecord(value)) return value
  return value.content ?? value
}

function apiModels(value: unknown): ApiModels {
  const input = typeof value === "string" ? parseJson(value) : value
  if (!isRecord(input)) return {}

  const direct = Object.fromEntries(
    Object.entries(input).flatMap(([key, provider]) => {
      if (!isApiProvider(provider)) return []
      return [[typeof provider.id === "string" && provider.id ? provider.id : key, provider] as const]
    }),
  )
  if (Object.keys(direct).length > 0) return direct

  return (
    ["content", "data", "provider", "providers", "result"]
      .map((key) => apiModels(input[key]))
      .find((providers) => Object.keys(providers).length > 0) ?? {}
  )
}

function withUiplusToken(api: ApiModels, token: string): ApiModels {
  return Object.fromEntries(
    Object.entries(api).map(([providerID, provider]) => {
      if (!isApiProvider(provider)) return [providerID, provider]
      if (!provider.models) return [providerID, provider]
      return [
        providerID,
        {
          ...provider,
          models: Object.fromEntries(
            Object.entries(provider.models).map(([modelID, model]) => {
              if (!isRecord(model)) return [modelID, model]
              return [
                modelID,
                {
                  ...model,
                  headers: {
                    ...(isRecord(model.headers) ? model.headers : {}),
                    uiplustoken: token,
                  },
                },
              ]
            }),
          ),
        },
      ]
    }),
  )
}

export function hasApiModels(api: ApiModels | undefined) {
  return !!api && Object.keys(api).length > 0
}

export async function fetchModelsApi() {
  if (modelsApiSource() !== "http") {
    latestModelsApi = undefined
    if (typeof localStorage !== "undefined") localStorage.removeItem(MODELS_API_W3_API_STORAGE_KEY)
    return {}
  }
  const token = uiplusToken()
  const headers: Record<string, string> = token ? { uiplustoken: token } : {}
  const bridge = modelsApiBridge()
  const url = modelsApiUrl()
  if (!url) throw new Error("Models API URL is not configured")

  if (bridge) {
    const data = await bridge(url, "GET", token, undefined, headers)
    const content = apiContent(data)
    const api = apiModels(content)
    console.log("[models-api] api.json received", api)
    latestModelsApi = withUiplusToken(api, token)
    storeW3Api(latestModelsApi, url)
    return latestModelsApi
  }

  const response = await fetch(url, {
    headers,
    cache: "no-store",
  })
  if (!response.ok) throw new Error(`Failed to fetch models api: ${response.status} ${response.statusText}`)
  const data = await response.json()
  const content = apiContent(data)
  const api = apiModels(content)
  console.log("[models-api] api.json received", api)
  latestModelsApi = withUiplusToken(api, token)
  storeW3Api(latestModelsApi, url)
  return latestModelsApi
}

export function registerModelsApiRefresh(listener: (models: ApiModels) => void | Promise<void>) {
  refreshModelsApiListeners.add(listener)
  return () => {
    refreshModelsApiListeners.delete(listener)
  }
}

export async function refreshModelsApi() {
  const models = await fetchModelsApi()
  await Promise.all(Array.from(refreshModelsApiListeners, (listener) => listener(models)))
  return models
}

export function modelsLocalListForProviders<TProvider extends ProviderLike & { models: Record<string, Model> }>(
  providers: TProvider[],
) {
  return providers.flatMap((provider) => Object.values(provider.models).map((model) => ({ ...model, provider })))
}

function capabilitiesFromModalities(modalities: Modality[]) {
  return {
    text: modalities.includes("text"),
    audio: modalities.includes("audio"),
    image: modalities.includes("image"),
    video: modalities.includes("video"),
    pdf: modalities.includes("pdf"),
  }
}

export function modelsApiListForProviders<TProvider extends ProviderLike>(api: ApiModels | undefined, providers: TProvider[]) {
  if (!api) return []
  const apiProviders = new Map(
    Object.entries(api).flatMap(([key, provider]) => {
      if (!isRecord(provider)) {
        return []
      }
      return [[typeof provider.id === "string" && provider.id ? provider.id : key, provider as ApiProvider] as const]
    }),
  )

  const result = providers.flatMap((provider) => {
    const apiProvider = apiProviders.get(provider.id)
    if (!apiProvider) return []

    return Object.entries(isApiModels(apiProvider.models) ? apiProvider.models : {}).flatMap(([modelKey, model]) => {
      if (!isRecord(model)) {
        return []
      }
      const item = model as ApiModel
      const id = typeof item.id === "string" && item.id ? item.id : modelKey
      return [
        {
          ...item,
          id,
          providerID: provider.id,
          api: { id, url: "", npm: "" },
          name: typeof item.name === "string" && item.name ? item.name : modelKey,
          family: typeof item.family === "string" ? item.family : "",
          capabilities: {
            temperature: item.capabilities?.temperature ?? false,
            reasoning: item.capabilities?.reasoning ?? false,
            attachment: item.capabilities?.attachment ?? false,
            toolcall: item.capabilities?.toolcall ?? false,
            input: item.modalities?.input
              ? capabilitiesFromModalities(item.modalities.input)
              : (item.capabilities?.input ?? capabilitiesFromModalities(["text"])),
            output: item.modalities?.output
              ? capabilitiesFromModalities(item.modalities.output)
              : (item.capabilities?.output ?? capabilitiesFromModalities(["text"])),
            interleaved: item.capabilities?.interleaved ?? false,
          },
          cost: item.cost ?? { input: 0, output: 0, cache: { read: 0, write: 0 } },
          limit: {
            context: item.limit?.context ?? 0,
            input: item.limit?.input,
            output: item.limit?.output ?? 0,
          },
          status: item.status ?? "active",
          options: item.options ?? {},
          headers: item.headers ?? {},
          release_date: typeof item.release_date === "string" ? item.release_date : "",
          variants: item.variants,
          provider,
        } satisfies Model & { provider: TProvider },
      ]
    })
  })
  return result
}
