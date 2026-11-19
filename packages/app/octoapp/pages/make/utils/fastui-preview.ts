/**
 * fastui 预览面板的状态机(SPEC-DES-004 §3.6)
 *
 * 卡片只记产物(fastui://<产物名>),打开时向主进程当场取地址。这里负责「取地址 → 挂 iframe →
 * 等 load」这一段,**只允许两种结局:出页面,或出明确的错误** —— 取地址与页面加载各有超时,
 * 超时一律进错误态,不允许无限转圈或白屏。
 *
 * 不依赖 Solid:渲染组件只负责把状态镜像成 signal、把事件转发进来,状态迁移本身可以单测。
 */

import type { FastuiTarget } from "../lib/electron-api"

export type FastuiOpenResult =
  | { ok: true; port: number; reused?: boolean }
  | { ok: false; error: string; logTail?: string; needsPrepare?: boolean }

export type FastuiPrepareResult = { ok: true; adopted?: boolean } | { ok: false; error: string; logTail?: string }

export type FastuiPreviewApi = {
  fastuiPreviewOpen?: (target: FastuiTarget) => Promise<FastuiOpenResult>
  fastuiPreviewRestart?: (target: FastuiTarget) => Promise<FastuiOpenResult>
  /** 分享导入的工程在本机接手(octo-agent SPEC-DES-009):open / restart 返回 needsPrepare 时调 */
  fastuiPreviewPrepare?: (target: FastuiTarget) => Promise<FastuiPrepareResult>
}

export type FastuiPreviewError = { phase: "error"; message: string; logTail?: string }
export type FastuiPreviewState =
  /** 正在向主进程取地址(服务可能正在编译) */
  | { phase: "resolving" }
  /** 分享导入的工程正在本机接手:补环境、改写标记、建链接(首装可能要几分钟) */
  | { phase: "preparing" }
  /** 地址已挂到 iframe 上,等页面加载 */
  | { phase: "loading"; url: string }
  /** 页面已出 */
  | { phase: "ready"; url: string }
  | FastuiPreviewError

export type FastuiPreviewRequest = {
  api: FastuiPreviewApi | undefined
  /** 工作区(= sdk.directory)与会话 id;工程在哪由主进程按 SPEC-DES-008 §3.7 查,这里不拼路径 */
  workspaceDir: string | null
  sessionId: string | null
  /** 产物名;空串表示「产物未知」(旧版卡片),由主进程在对话只有一个工程时确定 */
  name: string
  /** 「重新编译」:结束当前服务并重起 */
  restart?: boolean
}

/** 主进程自身有 90 秒起服务上限,这里再兜一层,防 IPC 本身没有回音 */
export const FASTUI_OPEN_TIMEOUT_MS = 120_000
export const FASTUI_LOAD_TIMEOUT_MS = 90_000
/** 接手含首装环境(下 node、装依赖),内网实测几分钟;主进程安装脚本上限 15 分钟,这里与之对齐 */
export const FASTUI_PREPARE_TIMEOUT_MS = 15 * 60_000

export function createFastuiPreviewController(opts: {
  onState: (state: FastuiPreviewState) => void
  openTimeoutMs?: number
  loadTimeoutMs?: number
  prepareTimeoutMs?: number
}) {
  const openTimeoutMs = opts.openTimeoutMs ?? FASTUI_OPEN_TIMEOUT_MS
  const loadTimeoutMs = opts.loadTimeoutMs ?? FASTUI_LOAD_TIMEOUT_MS
  const prepareTimeoutMs = opts.prepareTimeoutMs ?? FASTUI_PREPARE_TIMEOUT_MS

  let state: FastuiPreviewState = { phase: "resolving" }
  /** 当前状态对应哪个(工作区, 会话, 产物名) —— 换了目标就不能沿用旧页面 */
  let target: string | null = null
  /** 每次取地址 +1;晚到的旧结果一律丢弃(例如切了会话之后,上一个会话的结果才回来) */
  let generation = 0
  let openTimer: ReturnType<typeof setTimeout> | undefined
  let loadTimer: ReturnType<typeof setTimeout> | undefined

  const clearTimers = () => {
    if (openTimer) clearTimeout(openTimer)
    if (loadTimer) clearTimeout(loadTimer)
    openTimer = undefined
    loadTimer = undefined
  }

  const set = (next: FastuiPreviewState) => {
    state = next
    if (next.phase !== "loading" && loadTimer) {
      clearTimeout(loadTimer)
      loadTimer = undefined
    }
    if (next.phase === "loading") {
      if (loadTimer) clearTimeout(loadTimer)
      const gen = generation
      loadTimer = setTimeout(() => {
        if (gen === generation && state.phase === "loading") {
          set({ phase: "error", message: "预览页面加载超时，请重新编译" })
        }
      }, loadTimeoutMs)
    }
    opts.onState(next)
  }

  return {
    get state() {
      return state
    },

    /**
     * 取(或重新确认)地址。
     *
     * 同一个目标、页面已经出来时做**静默确认**:不切回「编译中」、不卸掉 iframe。文件一变就会
     * 触发刷新,而 dev server 自己有热更新 —— 每次都走一遍覆盖层只会让预览闪一下。确认结果是同一个
     * 地址就保持不动;地址变了(服务被重起过)才重新加载;出错才进错误态。
     */
    request(req: FastuiPreviewRequest) {
      const key = `${req.workspaceDir ?? ""}\u0000${req.sessionId ?? ""}\u0000${req.name}`
      const soft = !req.restart && key === target && state.phase === "ready"
      target = key
      const gen = ++generation
      clearTimers()

      const openCall = req.api?.fastuiPreviewOpen
      if (!req.workspaceDir || !req.sessionId || !req.api || !openCall) {
        set({ phase: "error", message: "当前环境不支持本地预览" })
        return
      }
      const api = req.api
      const t: FastuiTarget = { workspaceDir: req.workspaceDir, sessionId: req.sessionId, name: req.name || undefined }
      const armOpenTimer = () => {
        openTimer = setTimeout(() => {
          if (gen === generation) set({ phase: "error", message: "预览服务长时间未响应，请重新编译" })
        }, openTimeoutMs)
      }
      const settle = () => {
        if (openTimer) clearTimeout(openTimer)
        openTimer = undefined
      }

      /** `mayPrepare`:接手完成后的那次 open 不再进接手,仍报 needsPrepare 就是错误,不循环 */
      const open = (call: (target: FastuiTarget) => Promise<FastuiOpenResult>, mayPrepare: boolean): Promise<void> =>
        call(t)
          .then((res) => {
            if (gen !== generation) return
            settle()
            if (!res.ok) {
              if (res.needsPrepare && mayPrepare && api.fastuiPreviewPrepare) return prepare(api.fastuiPreviewPrepare)
              set({ phase: "error", message: res.error, logTail: res.logTail })
              return
            }
            const url = `http://127.0.0.1:${res.port}/`
            if (soft && state.phase === "ready" && state.url === url) return
            set({ phase: "loading", url })
          })
          .catch((error: unknown) => {
            if (gen !== generation) return
            settle()
            set({ phase: "error", message: `预览服务启动失败：${String(error)}` })
          })

      // 接手不计入取地址的超时:首装几分钟,120 秒的上限会先把它判死(SPEC-DES-009 §3.5)
      const prepare = (call: (target: FastuiTarget) => Promise<FastuiPrepareResult>): Promise<void> => {
        set({ phase: "preparing" })
        openTimer = setTimeout(() => {
          if (gen === generation) set({ phase: "error", message: "预览环境准备超时，请重新编译" })
        }, prepareTimeoutMs)
        return call(t)
          .then((res) => {
            if (gen !== generation) return
            settle()
            if (!res.ok) {
              set({ phase: "error", message: res.error, logTail: res.logTail })
              return
            }
            set({ phase: "resolving" })
            armOpenTimer()
            return open(openCall, false)
          })
          .catch((error: unknown) => {
            if (gen !== generation) return
            settle()
            set({ phase: "error", message: `预览环境准备失败：${String(error)}` })
          })
      }

      if (!soft) {
        set({ phase: "resolving" })
        armOpenTimer()
      }
      void open(req.restart && api.fastuiPreviewRestart ? api.fastuiPreviewRestart : openCall, true)
    },

    /** iframe 触发 load。挂地址之前 iframe 自己加载 about:blank 也会触发 —— 没有 src 的不算 */
    frameLoaded(hasSrc: boolean) {
      if (!hasSrc || state.phase !== "loading") return
      set({ phase: "ready", url: state.url })
    },

    dispose() {
      generation++
      clearTimers()
    },
  }
}
