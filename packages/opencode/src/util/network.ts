export function online() {
  const nav = globalThis.navigator
  if (!nav || typeof nav.onLine !== "boolean") return true
  return nav.onLine
}

export function proxied() {
  return !!(process.env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.https_proxy)
}

// 本地预配 provider 直连兜底：追加 NO_PROXY，让 Node 在使用 EnvHttpProxyAgent 时
// 跳过华为内网域名（octoai-llm.ucd.huawei.com 等）。配合 provider.ts 中的
// bypass dispatcher 双保险。
//
// 可通过 OPENCODE_DISABLE_BYPASS_DISPATCHER=1 关闭。
const BYPASS_PROXY_HOSTS = [
  "octoai-llm.ucd.huawei.com",
  "octoai-api.ucd.huawei.com",
  "aigateway.huawei.com",
  "aigateway.his-beta.huawei.com",
  ".huawei.com",
  "localhost",
  "127.0.0.1",
]

export function setupBypassProxyForLocalProviders() {
  if (process.env.OPENCODE_DISABLE_BYPASS_DISPATCHER === "1") return
  const existing = process.env.NO_PROXY ?? process.env.no_proxy ?? ""
  const existingList = existing.split(",").map((s) => s.trim()).filter(Boolean)
  const merged = BYPASS_PROXY_HOSTS.filter((h) => !existingList.includes(h))
  if (merged.length === 0) return
  const combined = [...existingList, ...merged].join(",")
  process.env.NO_PROXY = combined
  process.env.no_proxy = combined
}

