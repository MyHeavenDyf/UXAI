import { createMemo, createSignal, type Accessor } from "solid-js"
import {
  getUiplusCookie,
  getUiplusToken,
  removeUiplusCookie,
  removeUiplusToken,
  setUiplusCookie,
  setUiplusToken,
} from "@/utils/uiplus-token"

export type UserInfo = {
  uid: string | number
  userID?: string
  account?: string
  nickName?: string
  dept?: string[]
  deptCode?: string[]
  loginId?: number
  loginTime?: number
  expireTime?: number
  accessKey?: string
  roleID?: string
  roles?: number[]
  [key: string]: unknown
}

type AuthState = {
  token: string | null
  cookie: string | null
  user: UserInfo | null
  scopes: string[]
}

function storedUser() {
  const value = localStorage.getItem("userInfo")
  if (!value) return null
  try {
    const user = JSON.parse(value) as unknown
    if (!user || typeof user !== "object" || !("uid" in user)) return null
    return user as UserInfo
  } catch {
    return null
  }
}

function storedAuth(): AuthState {
  return {
    token: getUiplusToken() ?? null,
    cookie: getUiplusCookie() ?? null,
    user: storedUser(),
    scopes: [],
  }
}

const [authState, setAuthState] = createSignal(storedAuth())

function updateState(partial: Partial<AuthState>) {
  setAuthState((state) => ({ ...state, ...partial }))
  if (partial.token !== undefined) partial.token ? setUiplusToken(partial.token) : removeUiplusToken()
  if (partial.cookie !== undefined) partial.cookie ? setUiplusCookie(partial.cookie) : removeUiplusCookie()
  if (partial.user !== undefined) {
    partial.user
      ? localStorage.setItem("userInfo", JSON.stringify(partial.user))
      : localStorage.removeItem("userInfo")
  }
  window.dispatchEvent(new CustomEvent("octo:auth-changed", { detail: authState().user }))
}

export function getToken() {
  return authState().token
}

export function getCookie() {
  return authState().cookie
}

export function getUser() {
  return authState().user
}

export function getScopes() {
  return authState().scopes
}

export function isLoggedIn() {
  return !!authState().token
}

export function setAuth(partial: Partial<AuthState>) {
  updateState(partial)
}

export function clearAuth() {
  updateState({ token: null, cookie: null, user: null, scopes: [] })
  localStorage.removeItem("loginTimestamp")
  ;(window as unknown as { api?: { stopTokenExpirationCheck?: () => void } }).api?.stopTokenExpirationCheck?.()
}

export function syncFromStorage() {
  setAuthState(storedAuth())
}

export function syncAuthFromLoginSuccess(uiplusToken: string, cookie: string, userInfo: UserInfo) {
  updateState({ token: uiplusToken, cookie, user: userInfo, scopes: [] })
}

export function useAuth(): Accessor<AuthState> {
  return authState
}

export function getUserAvatar(): Accessor<string | null> {
  return createMemo(() => {
    const account = authState().user?.account
    const base = import.meta.env.VITE_OCTO_AUTH_AVATAR_BASE_URL?.replace(/\/$/, "")
    if (!account || !base) return null
    const abbreviation = account.substring(1)
    if (!abbreviation) return null
    const url = new URL(`${base}/${encodeURIComponent(abbreviation)}/120`)
    url.searchParams.set("ts", String(Date.now()))
    return url.href
  })
}
