export const MODELS_API_URL_STORAGE_KEY = "opencode.modelsApiUrl"

const DEFAULT_MODELS_API_URL = {
  beta: "",
  prod: "",
} as const

function localStorageValue(key: string) {
  if (typeof localStorage === "undefined") return ""
  return localStorage.getItem(key)?.trim() ?? ""
}

function modelsApiChannel() {
  const channel = (import.meta.env as Record<string, string | undefined>).VITE_OCTO_CHANNEL
  return channel === "prod" ? "prod" : "beta"
}

export function modelsApiUrl() {
  const env = import.meta.env as Record<string, string | undefined>
  const baseURL =
    localStorageValue(MODELS_API_URL_STORAGE_KEY) ||
    env.VITE_OCTO_MODELS_API_URL ||
    DEFAULT_MODELS_API_URL[modelsApiChannel()]
  if (!baseURL) return
  const url = new URL(baseURL)
  if (url.pathname === "/") url.pathname = "/api.json"
  if (url.pathname.endsWith("/")) url.pathname = `${url.pathname}api.json`
  return url.toString()
}

export function modelsApiHeaders(): Record<string, string> {
  const url = modelsApiUrl()
  return url ? { "x-opencode-models-api-url": url } : {}
}
