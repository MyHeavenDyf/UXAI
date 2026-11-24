/**
 * 自动归档上传传输 + 解压状态轮询（独立的归档功能，非资产库通道）。
 *
 * Make 页 html 产物生成落盘后自动打包 ZIP 归档上传（登录态直连
 * POST {VITE_OCTO_BASE_URL}/userResearch/rest.root/report/asset/uploadPackage，
 * multipart: uuid + zipPackage），上传成功拿到传送 id 后轮询解压处理终态
 * （GET getDecompressStatus?id={id}，content: 0 处理中 / 1 成功 / 2 失败，
 * errorCode 400 = id 不存在）。轮询仅在 Make 页挂载期间进行，任务持久化到
 * localStorage——切走暂停、切回/刷新后恢复。
 */

import { assetUploadBaseUrl, isAssetLibraryLoggedIn, sanitizeAssetFileName } from "./asset-upload"
import { checksum } from "@opencode-ai/core/util/encode"

export interface AutoArchiveResult {
  success: boolean
  message?: string
  id?: number
}

const UPLOAD_PACKAGE_TIMEOUT_MS = 120_000

/**
 * code 工作区自动归档去重 key：`code:${路径}:${内容 checksum}`。
 *
 * - 路径规范化（反斜杠转正斜杠 + 小写——Windows 大小写不敏感）保证同文件跨轮次稳定
 * - key 含内容哈希：「同文件多轮迭代、内容变化即重新归档」，内容没变不重传
 * - 与 normal 模式的 card.id key 共用同一 localStorage 去重集（octo:make:auto-archived）
 */
export function codeArchiveDedupKey(filePath: string, content: string): string {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase()
  return `code:${normalized}:${checksum(content) ?? "empty"}`
}

/** 登录用户 uuid：localStorage.userInfo.userId（JSON）；缺失/格式异常返回 null */
function currentUserId(): string | null {
  try {
    const raw = localStorage.getItem("userInfo")
    if (!raw) return null
    const userId = (JSON.parse(raw) as { userId?: unknown }).userId
    if (typeof userId === "string" && userId) return userId
    if (typeof userId === "number" && Number.isFinite(userId)) return String(userId)
    return null
  } catch {
    return null
  }
}

/**
 * 自动归档 ZIP 上传：POST {VITE_OCTO_BASE_URL}/userResearch/rest.root/report/asset/uploadPackage
 *
 * multipart 表单：uuid = localStorage.userInfo.userId，zipPackage = ZIP 文件流
 * （filename 经 sanitizeAssetFileName 兜底清洁）。不手动设置 Content-Type——
 * fetch + FormData 由浏览器生成 `multipart/form-data; boundary=...`，手动写死
 * （无 boundary）会导致服务端无法解析。
 *
 * 响应为内网统一封装 {success, errorCode, errorMessage, content}：
 * 成功 {success:true, errorCode:0, errorMessage:null, content:<传送 id>}；
 * 失败 {success:false, errorCode:400, errorMessage:"用户uuid不存在", content:null}。
 * 上传成功仅代表服务端受理，归档完成与否由 waitArchiveProcessed 轮询终态决定。
 */
export async function uploadZipPackage(options: { name: string; zipBlob: Blob }): Promise<AutoArchiveResult> {
  if (!isAssetLibraryLoggedIn()) return { success: false, message: "未登录" }
  const uuid = currentUserId()
  if (!uuid) return { success: false, message: "用户信息缺失" }
  const baseUrl = assetUploadBaseUrl()
  if (!baseUrl) return { success: false, message: "未配置归档服务地址" }

  const form = new FormData()
  form.append("uuid", uuid)
  form.append("zipPackage", options.zipBlob, sanitizeAssetFileName(options.name))

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPLOAD_PACKAGE_TIMEOUT_MS)
  try {
    const res = await fetch(`${baseUrl}/userResearch/rest.root/report/asset/uploadPackage`, {
      method: "POST",
      body: form,
      signal: controller.signal,
    })
    if (!res.ok) return { success: false, message: `上传失败 (HTTP ${res.status})` }
    let body: { success?: boolean; errorCode?: number; errorMessage?: string | null; content?: unknown } | null = null
    try {
      body = (await res.json()) as { success?: boolean; errorCode?: number; errorMessage?: string | null; content?: unknown }
    } catch {
      body = null
    }
    if (!body || typeof body.success !== "boolean") {
      return { success: false, message: "服务端响应格式不符合约定" }
    }
    if (!body.success) {
      return { success: false, message: body.errorMessage || `上传失败 (errorCode=${body.errorCode ?? "?"})` }
    }
    if (typeof body.content !== "number" || !Number.isFinite(body.content)) {
      return { success: false, message: "服务端响应缺少传送 id" }
    }
    return { success: true, id: body.content }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return { success: false, message: "上传超时" }
    return { success: false, message: "网络异常，请检查连接后重试" }
  } finally {
    clearTimeout(timer)
  }
}

// ── 解压状态轮询 ─────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 5_000
const POLL_MAX_CONSECUTIVE_ERRORS = 3

export type ArchivePollState = "processing" | "success" | "failed" | "missing" | "unknown"

/**
 * 解压状态响应判定（纯函数，供单测）：
 * content: 0 处理中 / 1 成功 / 2 失败；errorCode 400 = 轮询 id 不存在；
 * 其他（非法 body、content 非数字、未定义取值）→ unknown，调用方按一次异常计数。
 */
export function interpretDecompressStatus(
  body: { content?: unknown; errorCode?: unknown } | null | undefined,
): ArchivePollState {
  if (body && body.errorCode === 400) return "missing"
  if (body && body.content === 1) return "success"
  if (body && body.content === 2) return "failed"
  if (body && body.content === 0) return "processing"
  return "unknown"
}

/**
 * 轮询解压状态直到终态（成功/失败/id 不存在）、熔断或取消。
 *
 * - 间隔 5s，无总超时（依赖服务端必达终态）
 * - 单次请求异常 / unknown 计入连续异常，连续 3 次熔断为失败
 * - signal abort（Make 页卸载暂停）→ cancelled: true——不触发终态回调、不清 store
 */
export async function waitArchiveProcessed(
  id: number,
  signal?: AbortSignal,
): Promise<AutoArchiveResult & { cancelled?: boolean }> {
  const baseUrl = assetUploadBaseUrl()
  if (!baseUrl) return { success: false, message: "未配置归档服务地址" }
  let consecutiveErrors = 0
  for (;;) {
    if (signal?.aborted) return { cancelled: true, success: false }
    try {
      const res = await fetch(`${baseUrl}/userResearch/rest.root/report/asset/getDecompressStatus?id=${id}`, {
        method: "GET",
        signal,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = (await res.json()) as { content?: unknown; errorCode?: unknown }
      const state = interpretDecompressStatus(body)
      if (state === "success") return { success: true }
      if (state === "failed") return { success: false, message: "归档处理失败" }
      if (state === "missing") return { success: false, message: "传送 id 不存在" }
      if (state === "processing") {
        consecutiveErrors = 0
      } else {
        consecutiveErrors++
      }
    } catch (err) {
      if (signal?.aborted || (err instanceof Error && err.name === "AbortError")) {
        return { cancelled: true, success: false }
      }
      consecutiveErrors++
    }
    if (consecutiveErrors >= POLL_MAX_CONSECUTIVE_ERRORS) {
      return { success: false, message: "轮询归档状态失败（连续异常）" }
    }
    // 可中断 sleep：abort 时提前唤醒，下一轮循环顶检测 signal 返回 cancelled
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, POLL_INTERVAL_MS)
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer)
          resolve()
        },
        { once: true },
      )
    })
  }
}

// ── 轮询任务管理器（仅 Make 页生命周期 + localStorage 持久化恢复） ────────────

const ARCHIVE_POLLS_LS_KEY = "octo:make:auto-archive-polls"
const ARCHIVE_POLLS_MAX = 20

export type PendingArchivePoll = {
  /** 传送 id（uploadPackage 响应 content） */
  id: number
  /** 终态 toast/tracker 用的产物名（剥后缀页面名/文件名） */
  name: string
  mode: "normal" | "code"
  startedAt: number
  /** 恢复启动的任务标记（tracker 区分刷新/切回恢复） */
  resumed?: boolean
}

export function loadArchivePolls(): PendingArchivePoll[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(ARCHIVE_POLLS_LS_KEY) ?? "[]") as PendingArchivePoll[]
    if (!Array.isArray(parsed)) return []
    return parsed.filter((t) => t && typeof t.id === "number" && Number.isFinite(t.id))
  } catch {
    return []
  }
}

export function saveArchivePolls(tasks: PendingArchivePoll[]) {
  try {
    // FIFO 截断：保留最新 ARCHIVE_POLLS_MAX 条（服务端永不到终态的孤儿任务防无限累积）
    localStorage.setItem(ARCHIVE_POLLS_LS_KEY, JSON.stringify(tasks.slice(-ARCHIVE_POLLS_MAX)))
  } catch {
    // localStorage 不可用（配额满等）：轮询仍进行，仅失去跨刷新恢复能力
  }
}

function upsertArchivePoll(task: PendingArchivePoll) {
  const tasks = loadArchivePolls().filter((t) => t.id !== task.id)
  tasks.push(task)
  saveArchivePolls(tasks)
}

function removeArchivePoll(id: number) {
  saveArchivePolls(loadArchivePolls().filter((t) => t.id !== id))
}

const activePolls = new Map<number, AbortController>()

/**
 * 启动轮询任务：同步持久化 → 轮询到终态 → 从 store 删除 → onTerminal(task, result)。
 * cancelled（Make 页卸载暂停）时保留 store、不回调；同 id 双跑守卫。
 */
export function startArchivePoll(
  task: PendingArchivePoll,
  onTerminal: (task: PendingArchivePoll, result: AutoArchiveResult) => void,
) {
  if (activePolls.has(task.id)) return
  upsertArchivePoll(task)
  const controller = new AbortController()
  activePolls.set(task.id, controller)
  void waitArchiveProcessed(task.id, controller.signal).then((result) => {
    activePolls.delete(task.id)
    if (result.cancelled) return
    removeArchivePoll(task.id)
    onTerminal(task, result)
  })
}

/** 暂停全部轮询（MakeContent 卸载时调用）：取消 in-flight 循环，任务保留在 store，
 *  切回/刷新后由 resumeArchivePolls 恢复——「仅 Make 页轮询」的生命周期边界。 */
export function pauseArchivePolls() {
  for (const controller of activePolls.values()) controller.abort()
  activePolls.clear()
}

/** 恢复 store 中全部未终态任务（MakeContent 挂载时调用），任务标记 resumed。 */
export function resumeArchivePolls(
  onTerminal: (task: PendingArchivePoll, result: AutoArchiveResult) => void,
) {
  for (const task of loadArchivePolls()) {
    startArchivePoll({ ...task, resumed: true }, onTerminal)
  }
}
