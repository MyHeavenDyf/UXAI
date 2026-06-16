// Insight 错误信标 / 事故黑匣子 —— SPEC-INS-011 §9（阶段4）
// 自包含于 insight/lib/；不动上游核心；无自动上报。
// 与 debug-observer 的 SSE 旁路互补:这里只抓「真实高频 bug」——HTTP 4xx/5xx(含响应体)、
// 未捕获异常、整页崩——出错那一刻同步写 localStorage(抗刷新/抗关 app/抗整页崩)。
// 文档:docs/specs/ui/insight-debug-toolkit.md §9、docs/insight-debugging.md §3.4
import { getDesktopApi } from "./electron-api"

const STORAGE_KEY = "octo:insight:error-beacons"
const MAX_BEACONS = 5 // 环形:只留最近 5 条
const BODY_CAP = 2000 // 响应体/错误文本截断
const STACK_CAP = 2000 // stack 截断

export type Beacon = {
  ts: number
  type: "http" | "uncaught" | "boundary"
  // http
  method?: string
  url?: string
  status?: number // 0 = 网络错误(请求未拿到响应)
  body?: string
  // uncaught / boundary
  message?: string
  stack?: string
  // 上下文(§4.8:每条标当时来源)
  sessionID?: string
  directory?: string
}

type BeaconInput = Omit<Beacon, "ts" | "sessionID" | "directory"> & {
  sessionID?: string
  directory?: string
}

// ── 上下文:InsightContent 在 effect 里随响应式值更新,使每条 beacon 带当时来源 ──
let ctx: { sessionID?: string; directory?: string } = {}
export function setBeaconContext(next: { sessionID?: string; directory?: string }) {
  ctx = { ...ctx, ...next }
}

function truncate(s: string, cap: number): string {
  return s.length > cap ? s.slice(0, cap) + `…(截断,共${s.length}字符)` : s
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  return (
    String(d.getHours()).padStart(2, "0") + ":" +
    String(d.getMinutes()).padStart(2, "0") + ":" +
    String(d.getSeconds()).padStart(2, "0")
  )
}

export function readBeacons(): Beacon[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? (arr as Beacon[]) : []
  } catch {
    return []
  }
}

/** 同步写入一条 beacon;localStorage 不可用时静默吞掉(观测层永不影响主流程)。 */
export function recordBeacon(entry: BeaconInput) {
  try {
    const beacon: Beacon = {
      ts: Date.now(),
      sessionID: ctx.sessionID,
      directory: ctx.directory,
      ...entry,
    }
    const list = readBeacons()
    list.push(beacon)
    while (list.length > MAX_BEACONS) list.shift()
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    /* storage 满/禁用:忽略 */
  }
}

// ── 钩子1:patch window.fetch,抓 HTTP 失败 + 响应体 ───────────────
// 桌面 platform.fetch 本质包了一层 window.fetch,SDK(sdk.client.*)与裸 fetch
// (upload/resource-link)最终都走这里 → 一处 patch 统一覆盖。
// 读响应体用 res.clone().text(),绝不消费原始 body。
export function installFetchBeacon(): () => void {
  if (typeof window === "undefined" || typeof window.fetch !== "function") return () => {}
  const orig = window.fetch.bind(window)

  const patched = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const method = String(
      init?.method ?? (input instanceof Request ? input.method : undefined) ?? "GET",
    ).toUpperCase()
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input instanceof Request
            ? input.url
            : String(input)

    let res: Response
    try {
      res = await orig(input as RequestInfo | URL, init)
    } catch (e) {
      // 正常 abort 不算错误,不记(避免噪音)
      if ((e as { name?: string })?.name !== "AbortError") {
        recordBeacon({ type: "http", method, url, status: 0, body: truncate(String((e as Error)?.message ?? e), BODY_CAP) })
      }
      throw e
    }

    if (res.status >= 400) {
      try {
        const body = await res.clone().text()
        recordBeacon({ type: "http", method, url, status: res.status, body: truncate(body, BODY_CAP) })
      } catch {
        recordBeacon({ type: "http", method, url, status: res.status })
      }
    }
    return res
  }

  const slot = window as unknown as { fetch: typeof fetch }
  slot.fetch = patched as typeof fetch
  return () => {
    if (slot.fetch === (patched as typeof fetch)) slot.fetch = orig
  }
}

// ── 导出:格式化 + 复制到剪贴板(面向 Claude:信息全、不内联症状字典)──
export function formatBeacons(beacons: Beacon[]): string {
  if (beacons.length === 0) return "== Octo Insight 错误信标 == (无记录)"
  const latest = beacons[beacons.length - 1]
  const lines: string[] = []
  lines.push(`== Octo Insight 错误信标 · 最近 ${beacons.length} 条 @ ${fmtTime(Date.now())} ==`)
  lines.push(`环境: dir=${latest.directory ?? "?"}  session=${latest.sessionID ?? "?"}`)
  lines.push("")
  beacons.forEach((b, i) => {
    const idx = `[${i + 1}] ${fmtTime(b.ts)}`
    if (b.type === "http") {
      lines.push(`${idx}  HTTP ${b.status}  ${b.method ?? ""} ${b.url ?? ""}`.trimEnd())
      if (b.body) lines.push(`    响应体: ${b.body}`)
    } else {
      const label = b.type === "boundary" ? "整页崩(ErrorBoundary)" : "未捕获异常"
      lines.push(`${idx}  ${label}: ${b.message ?? ""}`.trimEnd())
      if (b.stack) lines.push(b.stack.split("\n").map((l) => `    ${l}`).join("\n"))
    }
  })
  return lines.join("\n")
}

/** 带出最近 n 条 beacon:返回纯文本并尽力复制到剪贴板(供 octoDebug.lastError 与崩溃 fallback 共用)。 */
export function copyLastError(n = 1): string {
  const all = readBeacons()
  const sel = n >= all.length ? all : all.slice(-n)
  const text = formatBeacons(sel)
  const api = getDesktopApi()
  if (api?.writeClipboardText) {
    void api.writeClipboardText(text).catch(() => {})
  } else {
    try {
      void navigator.clipboard?.writeText?.(text)?.catch?.(() => {})
    } catch {
      /* 剪贴板不可用:从返回值取 */
    }
  }
  return text
}

/** 把未捕获错误/整页崩归一化成 {message, stack} 再记 beacon。 */
export function recordError(type: "uncaught" | "boundary", err: unknown, fallbackMessage?: string) {
  const e = err as { message?: string; stack?: string } | undefined
  const message = e?.message ?? (typeof err === "string" ? err : fallbackMessage ?? String(err))
  const stack = e?.stack ? truncate(e.stack, STACK_CAP) : undefined
  recordBeacon({ type, message, stack })
}
