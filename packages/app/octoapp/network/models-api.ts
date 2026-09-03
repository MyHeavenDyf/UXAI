export const MODELS_API_URL_STORAGE_KEY = "opencode.modelsApiUrl"

function localStorageValue(key: string) {
  if (typeof localStorage === "undefined") return ""
  return localStorage.getItem(key)?.trim() ?? ""
}

function developmentModelsApiUrl() {
  if (!import.meta.env.DEV || typeof window === "undefined") return ""
  if (window.location.protocol !== "http:" && window.location.protocol !== "https:") return ""
  return new URL("/mock/models/api.json", window.location.origin).toString()
}

export function modelsApiUrl() {
  const env = import.meta.env as Record<string, string | undefined>
  const baseURL =
    localStorageValue(MODELS_API_URL_STORAGE_KEY) || env.VITE_OCTO_MODELS_API_URL || developmentModelsApiUrl()
  if (!baseURL) return
  const url = new URL(baseURL)
  if (url.pathname === "/") url.pathname = "/api.json"
  if (url.pathname.endsWith("/")) url.pathname = `${url.pathname}api.json`
  return url.toString()
}

export function modelsApiHeaders(): Record<string, string> {
  const url = modelsApiUrl()
  const token = localStorageValue("uiplusToken")
  return {
    ...(url ? { "x-opencode-models-api-url": url } : {}),
    ...(token ? { uiplustoken: token } : {}),
  }
}
