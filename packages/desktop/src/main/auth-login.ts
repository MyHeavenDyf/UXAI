import { BrowserWindow, net, shell } from "electron"

export type LoginUserInfo = {
  uid: string | number
  [key: string]: unknown
}

export type StartLoginResult = {
  loginCode: string
  loginUrl: string
}

const loginRequired = import.meta.env.VITE_OCTO_LOGIN_REQUIRED === "true"
const authUrls = {
  loginCode: import.meta.env.OCTO_AUTH_LOGIN_CODE_URL,
  loginStatus: import.meta.env.OCTO_AUTH_LOGIN_STATUS_URL,
  loginPage: import.meta.env.OCTO_AUTH_LOGIN_PAGE_URL,
  tokenExpiration: import.meta.env.OCTO_AUTH_TOKEN_EXPIRATION_URL,
  tokenRefresh: import.meta.env.OCTO_AUTH_TOKEN_REFRESH_URL,
}
const pollingInterval = 2_000
const loginTimeout = 5 * 60 * 1_000
const tokenExpirationInterval = 10_000
const tokenRefreshInterval = 4 * 60 * 60 * 1_000

let pollingTimer: NodeJS.Timeout | undefined
let tokenExpirationTimer: NodeJS.Timeout | undefined
let tokenRefreshTimer: NodeJS.Timeout | undefined
let currentLoginCode: string | undefined
let currentUiplusToken: string | undefined
let currentMainWindow: BrowserWindow | undefined
let loginExpiringSent = false

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function authUrl(name: keyof typeof authUrls) {
  const value = authUrls[name]?.trim()
  if (!value || !URL.canParse(value)) throw new Error(`登录服务配置无效：${name}`)
  return value
}

function authConfigurationError() {
  const invalid = Object.entries(authUrls).find(([, value]) => !value?.trim() || !URL.canParse(value))
  if (!invalid) return
  return `登录服务配置缺失或无效：${invalid[0]}`
}

function responseCode(value: unknown) {
  if (!isRecord(value)) return
  return typeof value.errorCode === "number" ? value.errorCode : undefined
}

function responseMessage(value: unknown) {
  if (!isRecord(value)) return
  return typeof value.errorMessage === "string" ? value.errorMessage : undefined
}

function cookieValue(value: string | null) {
  if (!value) return ""
  return value
    .split(/,(?=\s*[^;,\s]+=)/)
    .map((item) => item.split(";")[0]?.trim())
    .filter((item): item is string => !!item)
    .join("; ")
}

function calculateLoginExpirationTime(loginTimestamp: number) {
  const minimum = loginTimestamp + 48 * 60 * 60 * 1_000
  const date = new Date(minimum)
  const expiration = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 3)
  if (expiration.getTime() <= minimum) expiration.setDate(expiration.getDate() + 1)
  return expiration.getTime()
}

async function getLoginCode() {
  const response = await net.fetch(authUrl("loginCode"), { headers: { accept: "application/json" } })
  if (!response.ok) throw new Error(`获取登录凭证失败（${response.status}）`)
  const result = await response.json() as unknown
  if (!isRecord(result) || typeof result.content !== "string" || !result.content) {
    throw new Error("获取登录凭证失败：接口未返回 loginCode")
  }
  return result.content
}

async function checkLoginStatus(loginCode: string) {
  const url = new URL(authUrl("loginStatus"))
  url.searchParams.set("loginCode", loginCode)
  const response = await net.fetch(url.href, {
    headers: { accept: "application/json" },
  })
  if (!response.ok) throw new Error(`查询登录状态失败（${response.status}）`)
  const result = await response.json() as unknown
  if (responseCode(result) !== 200) return
  if (!isRecord(result) || !isRecord(result.content) || !["string", "number"].includes(typeof result.content.uid)) {
    throw new Error("登录成功响应未返回有效用户信息")
  }
  const uiplusToken = response.headers.get("uiplustoken") ?? ""
  if (!uiplusToken) throw new Error("登录成功响应未返回 uiplustoken")
  return {
    uiplusToken,
    cookie: cookieValue(response.headers.get("set-cookie")),
    userInfo: result.content as LoginUserInfo,
  }
}

export function cancelLogin() {
  if (pollingTimer) clearTimeout(pollingTimer)
  pollingTimer = undefined
  currentLoginCode = undefined
}

export function stopTokenExpirationCheck() {
  if (tokenExpirationTimer) clearInterval(tokenExpirationTimer)
  tokenExpirationTimer = undefined
  loginExpiringSent = false
}

export function stopTokenRefresh() {
  if (tokenRefreshTimer) clearInterval(tokenRefreshTimer)
  tokenRefreshTimer = undefined
  currentUiplusToken = undefined
  currentMainWindow = undefined
}

async function refreshToken() {
  if (!currentUiplusToken || !currentMainWindow || currentMainWindow.isDestroyed()) return
  const response = await net.fetch(authUrl("tokenRefresh"), {
    headers: { accept: "application/json", uiplustoken: currentUiplusToken },
  })
  if (!response.ok) throw new Error(`刷新登录凭证失败（${response.status}）`)
  const token = response.headers.get("uiplustoken")
  if (!token) return
  currentUiplusToken = token
  currentMainWindow.webContents.send("auth:token-refreshed", { uiplusToken: token })
}

function startTokenRefresh(uiplusToken: string, mainWindow: BrowserWindow) {
  stopTokenRefresh()
  currentUiplusToken = uiplusToken
  currentMainWindow = mainWindow
  tokenRefreshTimer = setInterval(() => {
    void refreshToken().catch((error) => console.error("[Auth] token refresh failed", error))
  }, tokenRefreshInterval)
}

async function checkLoginTimeExpiration(mainWindow: BrowserWindow) {
  const raw = await mainWindow.webContents.executeJavaScript('localStorage.getItem("loginTimestamp")') as unknown
  if (typeof raw !== "string" || !raw) return { expired: true, warning: false }
  const loginTimestamp = Number.parseInt(raw, 10)
  if (!Number.isFinite(loginTimestamp)) return { expired: true, warning: false }
  const expiration = calculateLoginExpirationTime(loginTimestamp)
  const now = Date.now()
  return {
    expired: now >= expiration,
    warning: now < expiration && now >= expiration - 60 * 60 * 1_000,
  }
}

function expireLogin(mainWindow: BrowserWindow, message: string) {
  stopTokenExpirationCheck()
  stopTokenRefresh()
  mainWindow.webContents.send("auth:token-expired", { message })
}

async function checkTokenExpiration(uiplusToken: string, mainWindow: BrowserWindow) {
  const loginTime = await checkLoginTimeExpiration(mainWindow)
  if (loginTime.expired) {
    expireLogin(mainWindow, "登录已过期，请重新登录")
    return
  }
  if (loginTime.warning && !loginExpiringSent) {
    loginExpiringSent = true
    mainWindow.webContents.send("auth:login-expiring", { message: "登录即将到期，请尽快重新登录" })
  }

  const response = await net.fetch(authUrl("tokenExpiration"), {
    headers: { accept: "application/json", uiplustoken: currentUiplusToken ?? uiplusToken },
  })
  const result = await response.json() as unknown
  if (response.ok && responseCode(result) !== 400 && (!isRecord(result) || result.success !== false)) return
  expireLogin(mainWindow, responseMessage(result) ?? "登录已过期，请重新登录")
}

export function startTokenExpirationCheck(uiplusToken: string, mainWindow: BrowserWindow) {
  stopTokenExpirationCheck()
  currentUiplusToken = uiplusToken
  currentMainWindow = mainWindow
  tokenExpirationTimer = setInterval(() => {
    void checkTokenExpiration(uiplusToken, mainWindow).catch((error) =>
      console.error("[Auth] token expiration check failed", error),
    )
  }, tokenExpirationInterval)
  void checkTokenExpiration(uiplusToken, mainWindow).catch((error) =>
    console.error("[Auth] token expiration check failed", error),
  )
}

export async function checkAuthOnStartup(mainWindow: BrowserWindow) {
  if (!loginRequired) return { loginRequired: false }
  const configurationError = authConfigurationError()
  if (configurationError) return { loginRequired: true, message: configurationError }
  const token = await mainWindow.webContents.executeJavaScript('localStorage.getItem("uiplusToken")') as unknown
  if (typeof token !== "string" || !token) {
    stopTokenExpirationCheck()
    stopTokenRefresh()
    return { loginRequired: true, message: "请先登录" }
  }

  const loginTime = await checkLoginTimeExpiration(mainWindow)
  if (loginTime.expired) {
    stopTokenExpirationCheck()
    stopTokenRefresh()
    return { loginRequired: true, message: "登录已过期，请重新登录" }
  }
  if (loginTime.warning) {
    loginExpiringSent = true
    mainWindow.webContents.send("auth:login-expiring", { message: "登录即将到期，请尽快重新登录" })
  }

  const response = await net.fetch(authUrl("tokenExpiration"), {
    headers: { accept: "application/json", uiplustoken: token },
  })
  const result = await response.json() as unknown
  if (!response.ok || responseCode(result) === 400 || (isRecord(result) && result.success === false)) {
    stopTokenExpirationCheck()
    stopTokenRefresh()
    return { loginRequired: true, message: responseMessage(result) ?? "登录已过期，请重新登录" }
  }

  const refresh = await net.fetch(authUrl("tokenRefresh"), {
    headers: { accept: "application/json", uiplustoken: token },
  })
  const activeToken = refresh.headers.get("uiplustoken") ?? token
  if (activeToken !== token) mainWindow.webContents.send("auth:token-refreshed", { uiplusToken: activeToken })
  startTokenExpirationCheck(activeToken, mainWindow)
  startTokenRefresh(activeToken, mainWindow)
  return { loginRequired: false }
}

function pollLoginStatus(mainWindow: BrowserWindow, loginCode: string, startedAt: number) {
  if (currentLoginCode !== loginCode) return
  pollingTimer = setTimeout(() => {
    if (Date.now() - startedAt > loginTimeout) {
      cancelLogin()
      mainWindow.webContents.send("auth:login-timeout", { message: "登录已超时，请重试" })
      return
    }
    void checkLoginStatus(loginCode).then(async (result) => {
      if (currentLoginCode !== loginCode) return
      if (!result?.uiplusToken) {
        pollLoginStatus(mainWindow, loginCode, startedAt)
        return
      }
      cancelLogin()
      await mainWindow.webContents.executeJavaScript(`localStorage.setItem("loginTimestamp", ${JSON.stringify(String(Date.now()))})`)
      mainWindow.webContents.send("auth:login-success", result)
      startTokenExpirationCheck(result.uiplusToken, mainWindow)
      startTokenRefresh(result.uiplusToken, mainWindow)
    }).catch((error) => {
      mainWindow.webContents.send("auth:login-poll-error", { message: errorMessage(error) })
      pollLoginStatus(mainWindow, loginCode, startedAt)
    })
  }, pollingInterval)
}

export async function startLogin(mainWindow: BrowserWindow): Promise<StartLoginResult> {
  cancelLogin()
  const loginCode = await getLoginCode()
  const loginUrl = new URL(authUrl("loginPage"))
  loginUrl.searchParams.set("model", loginCode)
  loginUrl.searchParams.set("root", "sketch")
  loginUrl.searchParams.set("tip", "请在Octo Agent客户端开始使用")
  currentLoginCode = loginCode
  await shell.openExternal(loginUrl.href)
  mainWindow.webContents.send("auth:login-opened", { loginCode, loginUrl: loginUrl.href })
  pollLoginStatus(mainWindow, loginCode, Date.now())
  return { loginCode, loginUrl: loginUrl.href }
}
