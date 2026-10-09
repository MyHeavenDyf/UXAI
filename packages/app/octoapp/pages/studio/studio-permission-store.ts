import { createStore } from "solid-js/store"
import { authTokenFromCredentials } from "@/utils/server"

const [state, setState] = createStore<{
  status: "idle" | "loading" | "ready" | "error"
  video: boolean
  seedream: boolean
  createStyleTemplate: boolean
}>({ status: "idle", video: false, seedream: false, createStyleTemplate: false })

let pending: { controller: AbortController; promise: Promise<void> } | undefined
const loginSuccessListeners = new Set<() => void>()

/** Call after the new user's account and credentials have been saved.
 * Only mounted Studio pages query permissions; otherwise entry remains lazy.
 */
export function notifyStudioLoginSuccess() {
  loginSuccessListeners.forEach((listener) => listener())
}

export function onStudioLoginSuccess(listener: () => void) {
  loginSuccessListeners.add(listener)
  return () => { loginSuccessListeners.delete(listener) }
}

/** Call on logout/account switch before installing the next user's login state.
 * Clears permissions without starting another request, even while Studio is mounted.
 */
export function clearStudioPermissionCache() {
  const request = pending
  pending = undefined
  request?.controller.abort()
  setState({ status: "idle", video: false, seedream: false, createStyleTemplate: false })
}

export const studioPermissionState = state

// Module-owned state survives route unmounts. Only explicit retry/clear invalidates it.
export function ensureStudioPermission(
  http: { url: string; username?: string; password?: string },
  uid?: string,
) {
  if (pending) return pending.promise
  if (state.status !== "idle") return Promise.resolve()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
  }
  if (http.password) headers.Authorization = `Basic ${authTokenFromCredentials({ username: http.username, password: http.password })}`
  setState({ status: "loading", video: false, seedream: false, createStyleTemplate: false })
  const request = {
    controller,
    promise: Promise.resolve().then(async () => {
      if (controller.signal.aborted) return
      const response = await fetch(new URL("/global/studio/permissions/check", http.url), {
        method: "POST",
        headers,
        body: JSON.stringify({ uid }),
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`check_permission failed: ${response.status}`)
      const result = await response.json() as { code?: number; resp_code?: number; data?: unknown }
      if (pending !== request) return
      if (
        !result || (result.code !== 200 && result.resp_code !== 200) ||
        !Array.isArray(result.data) || result.data.length < 3 ||
        !result.data.slice(0, 3).every((value) => typeof value === "boolean")
      ) throw new Error("Invalid Studio permission response")
      setState({
        status: "ready",
        video: result.data[0],
        seedream: result.data[1],
        createStyleTemplate: result.data[2],
      })
    }).catch((error: unknown) => {
      if (pending !== request) return
      setState({ status: "error", video: false, seedream: false, createStyleTemplate: false })
      console.error("[StudioPermission] permission check failed", error)
    }).finally(() => {
      clearTimeout(timeout)
      if (pending === request) pending = undefined
    }),
  }
  pending = request
  return request.promise
}
