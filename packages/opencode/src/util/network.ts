export function online() {
  const nav = globalThis.navigator
  if (!nav || typeof nav.onLine !== "boolean") return true
  return nav.onLine
}

export function proxied() {
  return !!(process.env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.https_proxy)
}

// undici 全局 dispatcher 槽(与 Node 内建 undici、npm undici 共享同一 Symbol.for 注册表)
const GLOBAL_DISPATCHER_SLOT = Symbol.for("undici.globalDispatcher.1")

export function globalDispatcherName(): string | undefined {
  const slot = (globalThis as unknown as Record<symbol, { constructor?: { name?: string } } | undefined>)[
    GLOBAL_DISPATCHER_SLOT
  ]
  return slot?.constructor?.name
}

// 网络失败自诊断后缀,附带在 webfetch 等工具的错误信息里,一眼区分三类故障:
//   proxy=off                            → 本进程无 proxy env,请求必直连(内网环境需配置代理/检查运行环境)
//   proxy=on + dispatcher≠EnvHttpProxyAgent → env 有但全局 dispatcher 没装上(setGlobalProxyFromEnv 未生效或被覆盖)
//   proxy=on + dispatcher=EnvHttpProxyAgent  → 代理已生效,失败为连接层问题(看 cause 链)
// runtime 用于区分报错来源进程:desktop sidecar=electron,TUI=bun(bun 的原生 fetch 不走 undici dispatcher)。
export function networkDiag(): string {
  let dispatcher: string
  try {
    dispatcher = globalDispatcherName() ?? "<unset>"
  } catch {
    dispatcher = "<error>"
  }
  return `[net-diag: proxy=${proxied() ? "on" : "off"} dispatcher=${dispatcher} runtime=${runtimeName()}]`
}

function runtimeName(): string {
  if (typeof (globalThis as { Bun?: unknown }).Bun !== "undefined") return "bun"
  if (process.versions.electron) return `electron/${process.versions.electron}`
  return `node/${process.versions.node}`
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

