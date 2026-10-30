const STORAGE_KEY_TOKEN = "uiplusToken"
const STORAGE_KEY_COOKIE = "uiplusCookie"

export function getUiplusToken() {
  return localStorage.getItem(STORAGE_KEY_TOKEN) ?? undefined
}

export function setUiplusToken(token: string) {
  localStorage.setItem(STORAGE_KEY_TOKEN, token)
}

export function removeUiplusToken() {
  localStorage.removeItem(STORAGE_KEY_TOKEN)
}

export function getUiplusCookie() {
  return localStorage.getItem(STORAGE_KEY_COOKIE) ?? undefined
}

export function setUiplusCookie(cookie: string) {
  localStorage.setItem(STORAGE_KEY_COOKIE, cookie)
}

export function removeUiplusCookie() {
  localStorage.removeItem(STORAGE_KEY_COOKIE)
}
