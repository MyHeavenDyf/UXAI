import "./assets/style/pattern-tokens.css"
import type { Message, Session, SessionStatus } from "@opencode-ai/sdk/v2/client"
import { DataProvider } from "@opencode-ai/ui/context/data"
import { createAutoScroll } from "@opencode-ai/ui/hooks"
import { showToast, Toast } from "@opencode-ai/ui/toast"
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  on,
  onCleanup,
  Show,
  type JSX,
} from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { SDKProvider, useSDK } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"
import { LocalProvider, useLocal } from "@/context/local"
import { useLayout } from "@/context/layout"
import { useProjectDir } from "@/hooks/use-project-dir"
import { type Attachment } from "./modules/chat/attachment_bar"
import { type OutputCard } from "./modules/chat/insight-turn"
import { create_planner_json, create_modules_json, type ProtoCreateJsonInput } from './workflow/create_json'
import modify_json_ai from './workflow/modify_json_ai'
import { mergeModules } from "./agents/merge"
import { appendPatternVersion, loadCurrentPatternState, listPatternVersions, type VersionEntry } from "./utils/version-history"
import { saveReviewCheckpoint, loadReviewCheckpoint, clearReviewCheckpoint } from "./utils/review-checkpoint"
import { logStartSession, getDebugSnapshot, clearDebugLog, saveDebugLog } from "./utils/debug-log"
import { rollbackToVersion } from "./utils/version-history"
import { classifyAIError } from "./utils/error-msg"
import { detectA2UIJson } from "./utils/a2ui-protocol"
import { autoRenameSession } from "./utils/rename-session"
import { exportZip } from "./utils/previewHandler/zip"
import { handleModifyElement as runQuickModify, type QuickModifyContext, type ModifyElementData } from './workflow/modify_json_quick'
import { handleLivePreview as livePreview, handlePixsoPreview as pixsoPreview, handleDownload as download, handleSelectVersion as selectVersion } from "./utils/previewHandler"
import { PreviewPage, type PreviewPageAPI } from "./modules/preview/index"
import { WireframeReview, type WireframeReviewResult } from "./modules/preview/WireframeReview"
import { ChatPanel } from "./modules/chat/index"
import resultEmptySvg from "./assets/images/IllustrationResultEmpty.svg?url"
import { PatternPreviewEmpty } from "./modules/preview/PatternPreviewEmpty"

const AGENT_NAME = "proto_triage"

export default function PatternPage() {
  const dir = useProjectDir()

  return (
    <Show when={dir()} keyed>
      {(directory) => (
        <SDKProvider directory={() => directory}>
          <SyncProvider>
            <LocalProvider>
              <PatternContent />
            </LocalProvider>
          </SyncProvider>
        </SDKProvider>
      )}
    </Show>
  )
}

function PatternContent() {
  const params = useParams<{ id?: string }>()
  const navigate = useNavigate()
  const sdk = useSDK()
  const sync = useSync()
  const layout = useLayout()
  const local = useLocal()
  const currentModel = () => local.model.current()
  const activeModelKey = createMemo(() => {
    const m = currentModel()
    if (!m) return null
    return { providerID: m.provider.id, modelID: m.id }
  })

  const [sessionInfo, { refetch: refetchSession, mutate: mutateSession }] = createResource(
    () => params.id ?? "",
    async (id) => {
      if (!id) return null as Session | null
      try {
        const result = await sdk.client.session.get({ sessionID: id })
        setSelectedDesignSystem("ICT-3.1")
        return (result.data as Session | undefined) ?? null
      } catch {
        return null as Session | null
      }
    },
  )

  async function deleteSession(sessionID: string) {
    try {
      await sdk.client.session.delete({ sessionID })
      navigate("/pattern")
    } catch (err) {
      showToast({ title: "删除失败", description: err instanceof Error ? err.message : String(err) })
    }
  }

  const [childSessionIDs, setChildSessionIDs] = createSignal<string[]>([])
  const [sessionSynced, setSessionSynced] = createSignal(false)
  let discoverVersion = 0

  // session 切换：按顺序执行清理 → 重置 → 异步加载 → 滚动
  createEffect(
    on(
      () => params.id,
      (id, prevId) => {
        // ── 1. 切换 session 时同步清理 ──
        if (prevId !== undefined) {
          setSelectedDesignSystem("ICT-3.1")
          setReviewUserInput("")
        }

        // ── 2. 无条件同步重置 ──
        setChildSessionIDs([])
        setSessionSynced(false)
        discoverVersion++
        setPendingPreviewData(null)
        previewApi.sendToPreview(null)

        // ── 3. 进入新 session：追踪 + 清空 + 异步加载 ──
        if (id) {
          layout.lastSessionPerTab.setPattern(id)
          setLastIntent(null)
          setLastPlanner(null)
          setLastModules([])
          setVersions([])
          setCurrentVersionId(null)
          setHasPreviewContent(false)
          setIsModifying(false)

          // 同步子 session 消息，全部加载完成后才标记 synced
          void sync.session.sync(id).then(async () => {
            if (params.id !== id) return
            await discoverChildSessions(id)
            if (params.id !== id) return
            setSessionSynced(true)
            // 滚动到底部
            requestAnimationFrame(() => autoScroll.forceScrollToBottom())
          })

          // 恢复历史版本状态并推送到预览
          const dir = patternHistoryDir()
          if (dir) {
            // 优先检查线框审查检查点
            void loadReviewCheckpoint(dir, id).then(async (checkpoint) => {
              if (params.id !== id) return
              if (checkpoint) {
                // 恢复到线框审查阶段，复用 lastPlanner/lastIntent
                setLastPlanner(checkpoint.planner)
                setLastIntent(checkpoint.intentDescription)
                setReviewUserInput(checkpoint.userInput)
                setIsPlanReview(true)
                return
              }
              // 无检查点，加载已完成状态
              const state = await loadCurrentPatternState(dir, id)
              if (!state || params.id !== id) return
              if (state.lastIntent) setLastIntent(state.lastIntent)
              if (state.lastPlanner) setLastPlanner(state.lastPlanner)
              if (state.lastModules.length > 0) {
                setLastModules(state.lastModules)
                const a2uiJSON = state.mergedA2UI
                if (a2uiJSON) sendToPreview(a2uiJSON)
              }
            })
            void listPatternVersions(dir, id).then(({ versions, current }) => {
              if (params.id !== id) return
              setVersions(versions)
              setCurrentVersionId(current)
            })
          }
        }
      },
    ),
  )

  async function discoverChildSessions(rootID: string) {
    const version = discoverVersion
    try {
      const res = await sdk.client.session.list({ directory: sdk.directory })
      if (version !== discoverVersion) return
      const all = res.data ?? []
      const children = all.filter((s: any) => s.parentID === rootID)
      const childIDs: string[] = []
      for (const child of children) {
        await sync.session.sync(child.id)
        if (version !== discoverVersion) return
        childIDs.push(child.id)
      }
      setChildSessionIDs(childIDs)
    } catch {}
  }

  const userMessages = createMemo((): Message[] => {
    const id = params.id
    if (!id) return []
    const rootMsgs = ((sync.data.message[id] ?? []) as Message[]).filter((m) => m.role === "user")
    const result: (Message & { _sessionID: string })[] = rootMsgs.map((m) => ({ ...m, _sessionID: id }))
    for (const childID of childSessionIDs()) {
      const childMsgs = ((sync.data.message[childID] ?? []) as Message[]).filter((m) => m.role === "user")
      for (const m of childMsgs) {
        result.push({ ...m, _sessionID: childID })
      }
    }
    return result.sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0))
  })

  const roundMessages = createMemo(() => {
    const id = params.id
    if (!id) return []
    const allRootMsgs = (sync.data.message[id] ?? []) as Message[]
    const rootUserMsgs = allRootMsgs.filter((m) => m.role === "user")
    const childIDs = childSessionIDs()
    if (childIDs.length === 0 && rootUserMsgs.length === 0) return []

    type Item = { sessionID: string; messageID: string; time: number }
    type Round = { startTime: number; endTime?: number; items: Item[]; cancelled: boolean }

    // Collect all round boundary timestamps.
    // Create mode (round 1): no root user messages, child sessions exist → boundary at 0.
    // Modify mode (round 2+): each root user message (triage prompt) is a boundary.
    const roundStarts: number[] = []
    const firstRootTime = rootUserMsgs.length > 0 ? (rootUserMsgs[0].time?.created ?? Infinity) : Infinity
    const hasEarlyChildren = childIDs.some((cid) => {
      const msgs = (sync.data.message[cid] ?? []) as Message[]
      return (msgs[0]?.time?.created ?? Infinity) < firstRootTime
    })
    if (hasEarlyChildren) roundStarts.push(0)
    for (const m of rootUserMsgs) roundStarts.push(m.time?.created ?? 0)
    if (roundStarts.length === 0) return []

    return roundStarts.map((roundStart, ri): Round => {
      const roundEnd = ri < roundStarts.length - 1 ? roundStarts[ri + 1] : Infinity
      const items: Item[] = []
      let startTime = roundStart === 0 ? Infinity : roundStart
      let endTime: number | undefined
      let cancelled = false

      const checkCancelled = (m: Message) => {
        if (cancelled || m.role !== "assistant") return
        const msgError = (m as Record<string, unknown>).error as Record<string, unknown> | undefined
        if (msgError?.name === "MessageAbortedError") {
          cancelled = true
          return
        }
        const parts = sync.data.part[m.id] as Array<Record<string, unknown>> | undefined
        if (!parts) return
        for (const p of parts) {
          if (p.type !== "tool") continue
          const st = p.state as Record<string, unknown> | undefined
          if (st?.status === "error" && (st.error === "Cancelled" || st.error === "Tool execution aborted")) {
            cancelled = true
            return
          }
        }
      }

      // Track earliest created & latest completed across all messages in this round
      const trackTime = (m: Message) => {
        const t = m.time as { created: number; completed?: number }
        if (t.created < startTime) startTime = t.created
        if (typeof t.completed === "number" && (!endTime || t.completed > endTime)) endTime = t.completed
      }

      // Root session: only user messages go into items; track time from user + its assistant response
      for (const m of rootUserMsgs) {
        const t = m.time?.created ?? 0
        if (t < roundStart || t >= roundEnd) continue
        items.push({ sessionID: id, messageID: m.id, time: t })
        trackTime(m)
        const idx = allRootMsgs.findIndex((mm) => mm.id === m.id)
        const assistant = allRootMsgs.slice(idx + 1).find((mm) => mm.role === "assistant")
        if (assistant) { trackTime(assistant); checkCancelled(assistant) }
      }

      // Child sessions in this round's time window: user messages → items, all messages → timing
      for (const childID of childIDs) {
        const childMsgs = (sync.data.message[childID] ?? []) as Message[]
        const childCreated = childMsgs[0]?.time?.created ?? Infinity
        if (childCreated < roundStart || childCreated >= roundEnd) continue
        for (const m of childMsgs) {
          if (m.role === "user") items.push({ sessionID: childID, messageID: m.id, time: m.time?.created ?? 0 })
          trackTime(m)
          checkCancelled(m)
        }
      }

      items.sort((a, b) => a.time - b.time)
      if (startTime === Infinity) startTime = items.length > 0 ? items[0].time : Date.now()
      return { startTime, endTime, items, cancelled }
    })
  })

  const sessionStatus = createMemo((): SessionStatus => {
    const id = params.id
    if (!id) return { type: "idle" }
    return sync.data.session_status[id] ?? { type: "idle" }
  })

  const isBusy = createMemo(() => {
    if (sessionStatus().type !== "idle") return true
    const id = params.id
    if (!id) return false
    // check root session
    const rootMsgs = (sync.data.message[id] ?? []) as Message[]
    const lastRootAssistant = rootMsgs.findLast((m) => m.role === "assistant")
    if (!!lastRootAssistant && typeof lastRootAssistant.time.completed !== "number") return true
    // check child sessions
    for (const childID of childSessionIDs()) {
      const childMsgs = (sync.data.message[childID] ?? []) as Message[]
      const lastChildAssistant = childMsgs.findLast((m) => m.role === "assistant")
      if (!!lastChildAssistant && typeof lastChildAssistant.time.completed !== "number") return true
      // 有 user 消息但还没有 assistant 消息 → agent 刚启动，还在生成
      const hasUser = childMsgs.some((m) => m.role === "user")
      if (hasUser && !lastChildAssistant) return true
    }
    return false
  })

  const [prompt, setPrompt] = createSignal("")
  const [sendingSid, setSendingSid] = createSignal<string | null>(null)
  const sending = () => sendingSid() != null && sendingSid() === params.id
  const [attachments, setAttachments] = createSignal<Attachment[]>([])
  const [isDragOver, setIsDragOver] = createSignal(false)
  const [selectedDesignSystem, setSelectedDesignSystem] = createSignal<string | null>(null)
  const [lastIntent, setLastIntent] = createSignal<Record<string, unknown> | null>(null)
  const [lastPlanner, setLastPlanner] = createSignal<Record<string, unknown> | null>(null)
  const [lastModules, setLastModules] = createSignal<Array<Record<string, unknown>>>([])
  const [versions, setVersions] = createSignal<VersionEntry[]>([])
  const [currentVersionId, setCurrentVersionId] = createSignal<string | null>(null)
  const [hasPreviewContent, setHasPreviewContent] = createSignal(false)
  const [pendingPreviewData, setPendingPreviewData] = createSignal<unknown>(null)
  const [isModifying, setIsModifying] = createSignal(false)

  // 线框审查阶段的用户原始输入（planner/intent 复用 lastPlanner/lastIntent）
  const [reviewUserInput, setReviewUserInput] = createSignal<string>("")
  // 是否处于线框审查阶段
  const [isPlanReview, setIsPlanReview] = createSignal(false)

  // 历史文件存储目录，优先使用关联目录下的 .octo/design/history
  const patternHistoryDir = createMemo(() => {
    const home = sdk.directory;
    return `${home}/.octo/design/history`;
  })

  const hasContent = () => !!(params.id && userMessages().length > 0)
  const sessionMessagesLoaded = () => !params.id || sessionSynced()

  // 从预览页选中元素后触发的修改回调
  function handlePickerSubmit(text: string, domPickerId: string) {
    setPrompt(`[选中元素: ${domPickerId}] ${text}`)
    void handleSubmit()
  }

  const quickModifyCtx: QuickModifyContext = {
    getPendingData: pendingPreviewData,
    sendToPreview,
    refreshPreview: () => previewApi.refresh(),
    getHistoryDir: () => patternHistoryDir(),
    getSessionId: () => params.id,
    getLastIntent: lastIntent,
    getLastPlanner: lastPlanner,
    getLastModules: lastModules,
    setVersions,
    setCurrentVersionId,
  }

  async function handleModifyElement(data: ModifyElementData) {
    try {
      await runQuickModify(quickModifyCtx, data)
    } catch (err: unknown) {
      console.error("[PatternPage] handleModifyElement failed", err)
      const error = classifyAIError(err)
      if (error.title) showToast({ title: error.title, description: error.description })
    }
  }


  const CHAT_WIDTH_KEY = "octo:pattern:chat-width"
  function getInitialChatWidth(): number {
    const stored = localStorage.getItem(CHAT_WIDTH_KEY)
    if (stored) {
      const n = parseInt(stored, 10)
      if (!isNaN(n) && n >= 345 && n <= 720) return n
    }
    return 460
  }
  const [chatWidth, setChatWidth] = createSignal(getInitialChatWidth())
  const [focusMode, setFocusMode] = createSignal(false)
  const MIN_CHAT = 345
  const MAX_CHAT = 720

  let dragCleanup: (() => void) | null = null

  function handleDividerMouseDown(e: MouseEvent) {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = chatWidth()
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    document.body.style.overflow = "hidden"
    const resetBody = () => {
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      document.body.style.overflow = ""
      dragCleanup = null
    }
    const onMove = (ev: MouseEvent) => {
      setChatWidth(Math.max(MIN_CHAT, Math.min(MAX_CHAT, startWidth + ev.clientX - startX)))
    }
    const onUp = () => {
      resetBody()
      localStorage.setItem(CHAT_WIDTH_KEY, String(chatWidth()))
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
    }
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
    dragCleanup = () => {
      resetBody()
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
    }
  }

  onCleanup(() => { dragCleanup?.() })

  const autoScroll = createAutoScroll({ working: isBusy })

  const previewApi: PreviewPageAPI = { sendToPreview: () => { }, postMessage: () => { }, refresh: () => { }, setEditingOff: () => { } }

  function sendToPreview(data: unknown) {
    setPendingPreviewData(data)
    previewApi.sendToPreview(data)
    setHasPreviewContent(true)
  }

  async function handleSubmit() {
    const text = prompt().trim()
    if (!text || sending() || !activeModelKey()) return
    const genStartTime = performance.now()
    console.log("[Pattern] 开始生成页面:", text)
    const submitSessionId = params.id
    setPrompt("")
    const mk = activeModelKey()!
    // const desktopApi = (window as unknown as { api?: { tailwindToCss?: (className: string) => Promise<Record<string, string>> } }).api
    //  const css = await desktopApi?.tailwindToCss?.("flex items-center justify-between px-inset py-inline bg-surface-container-highest shadow-sm z-10")
    //   console.log("[Pattern] tailwind css:", css)
    let sid = submitSessionId
    try {
      if (!sid) {
        const dir = sdk.directory
        if (!dir) return
        const result = await sdk.client.session.create({ directory: dir, agent: AGENT_NAME })
        const session = result.data as Session | undefined
        if (!session) return
        setSelectedDesignSystem("ICT-3.1")
        navigate(`/pattern/${session.id}`)
        sid = session.id
      }
      setSendingSid(sid)

      // 执行流程的基础上下文
      let intentCtx = {
        sdk: sdk,
        sync: sync,
        modelKey: mk,
        rootSession: sid,
        userInput: text,
        onSessionCreated: (childID: string) => {
          if (params.id !== sid) return
          setChildSessionIDs((prev) => [...prev, childID])
        },
        refreshPreview: () => previewApi.refresh(),
      }

      // 开启本次调试日志
      logStartSession(sid, text)
      // 流程执行完毕后的回调
      let onFinshed = async ({ pageIntent, layoutPlanner, modulesJson, pageJson }: any) => {
          // 历史保存始终执行（与当前查看的 session 无关）
          const dir = patternHistoryDir()
          if (dir) {
            const debug = getDebugSnapshot()
            const vid = await appendPatternVersion(dir, sid!, {
                lastIntent: pageIntent,
                lastPlanner: layoutPlanner,
                lastModules: modulesJson,
                mergedA2UI: pageJson as unknown as Record<string, unknown>,
            }, text.slice(0, 80))
            if (params.id === sid) {
              setVersions((prev) => [...prev, { id: vid, createdAt: Date.now(), summary: text.slice(0, 80) }])
              setCurrentVersionId(vid)
              clearDebugLog()
            }
            void saveDebugLog(dir, sid!, {
              lastIntent: pageIntent,
              lastPlanner: layoutPlanner,
              lastModules: modulesJson,
              mergedA2UI: pageJson as unknown as Record<string, unknown>,
              debug,
            }, text.slice(0, 80))
          }
          // 视图状态仅在仍在该 session 时更新
          if (params.id !== sid) return
          // 触发页面渲染
          if (pageJson) sendToPreview(pageJson)
          // 内存数据更新
          setLastIntent(pageIntent)
          setLastPlanner(layoutPlanner)
          setLastModules(modulesJson)
      }

      if(lastModules().length > 0){
        let lastData = {
          lastIntent: lastIntent(),
          lastPlanner: lastPlanner(),
          lastModules: lastModules(),
        }
        // AI 修改页面 — 先切到加载态
        setIsModifying(true)
        const modifyResult = await modify_json_ai(intentCtx, lastData, onFinshed);
        setIsModifying(false)
        if ((modifyResult as any)?.reply) {
          showToast({ title: (modifyResult as any).reply })
        }
      }else{
        // 首次创建页面：异步获取标题（不阻塞 pipeline）
        void autoRenameSession({
          client: sdk.client,
          directory: sdk.directory,
          targetSessionID: sid!,
          userText: text,
          modelKey: mk,
        }).then((title) => {
          if (title && params.id === sid) mutateSession(prev => prev ? { ...prev, title } : prev)
        }).catch(() => {})

        // 首次创建页面 — 阶段 1：意图扩展 + 布局规划
        const new_planner = await create_planner_json(intentCtx)
        // 持久化线框审查检查点
        const userDir = patternHistoryDir()
        if (userDir) {
          await saveReviewCheckpoint(userDir, sid, {
            planner: new_planner.planner.layout_planner,
            intentDescription: new_planner.intent.intent_description,
            userInput: text,
            rootSessionId: sid,
            createdAt: Date.now(),
          })
        }

        // 进入线框审查阶段，planner/intent 复用 lastPlanner/lastIntent
        setLastPlanner(new_planner.planner.layout_planner)
        setLastIntent(new_planner.intent.intent_description)
        setReviewUserInput(text)
        setIsPlanReview(true)
      }

      const genDuration = ((performance.now() - genStartTime)/1000).toFixed(0)
      console.log(`[Pattern] 第一次生成页面耗时: ${genDuration}s`)
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "aborted") return
      console.error("[PatternPage] handleSubmit failed", err)
      setIsModifying(false)
      const error = classifyAIError(err)
      if (error.title) showToast({ title: error.title, description: error.description })
    } finally {
      setSendingSid((prev) => (prev === sid ? null : prev))
    }
  }

  // 线框审查确认后，继续执行阶段 2：模块生成
  async function handleConfirmReview(result: WireframeReviewResult) {
    const sid = params.id
    if (!sid) return
    const mk = activeModelKey()
    if (!mk) return

    const planner = lastPlanner()
    if (!planner) return

    const userInput = reviewUserInput()

    // 把设计师编辑后的意图合并回 lastIntent
    setLastIntent(result.intentDescription)

    // 删除检查点（阶段 2 启动后不再需要回退到审查）
    const ckptDir = patternHistoryDir()
    if (ckptDir) await clearReviewCheckpoint(ckptDir, sid)

    setIsPlanReview(false)

    const intentCtx: ProtoCreateJsonInput = {
      sdk,
      sync,
      modelKey: mk,
      rootSession: sid,
      userInput: userInput,
      onSessionCreated: (childID: string) => {
        setChildSessionIDs((prev) => [...prev, childID])
      },
    }

    let onFinshed = async ({ pageIntent, layoutPlanner, modulesJson, pageJson }: any) => {
        // 触发页面渲染
        if (pageJson) sendToPreview(pageJson)
        // 内存数据更新
        setLastIntent(pageIntent)
        setLastPlanner(layoutPlanner)
        setLastModules(modulesJson)
        // 历史文件
        const dir = patternHistoryDir()
        if (dir) {
          const vid = await appendPatternVersion(dir, sid, {
              lastIntent: pageIntent,
              lastPlanner: layoutPlanner,
              lastModules: modulesJson,
              mergedA2UI: pageJson as unknown as Record<string, unknown>,
          }, userInput.slice(0, 80))
          setVersions((prev) => [...prev, { id: vid, createdAt: Date.now(), summary: userInput.slice(0, 80) }])
          setCurrentVersionId(vid)
          const debug = getDebugSnapshot()
          void saveDebugLog(dir, sid, {
            lastIntent: pageIntent,
            lastPlanner: layoutPlanner,
            lastModules: modulesJson,
            mergedA2UI: pageJson as unknown as Record<string, unknown>,
            debug,
          }, userInput.slice(0, 80))
          clearDebugLog()
        }
    }
    
    try {
      await create_modules_json(intentCtx, planner, result.intentDescription, onFinshed)
    } catch (err: unknown) {
      console.error("[PatternPage] handleConfirmReview failed", err)
      const error = classifyAIError(err)
      if (error.title) showToast({ title: error.title, description: error.description })
      setIsPlanReview(true)
    } finally {
      setReviewUserInput("")
    }
  }

  async function halt() {
    const sid = params.id
    if (!sid) return
    // abort 根 session
    await sdk.client.session.abort({ sessionID: sid }).catch(() => { })
    // abort 所有正在运行的子 session
    for (const childID of childSessionIDs()) {
      const msgs = (sync.data.message[childID] ?? []) as Message[]
      const pending = msgs.findLast((m) => m.role === "assistant" && typeof m.time.completed !== "number")
      if (pending) {
        await sdk.client.session.abort({ sessionID: childID }).catch(() => { })
      }
    }
    setSendingSid((prev) => (prev === sid ? null : prev))
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      void handleSubmit()
    }
  }

  function addAttachments(files: File[]) {
    const slots = 5 - attachments().length
    const toAdd = files.slice(0, slots)
    for (const file of toAdd) {
      const reader = new FileReader()
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string
        setAttachments((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            filename: file.name,
            mime: file.type || "application/octet-stream",
            dataUrl,
          },
        ])
      }
      reader.readAsDataURL(file)
    }
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  function handleFileInputChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement
    if (input.files?.length) {
      addAttachments(Array.from(input.files))
      input.value = ""
    }
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"
    setIsDragOver(true)
  }

  function handleDragLeave() {
    setIsDragOver(false)
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault()
    setIsDragOver(false)
    const files = Array.from(e.dataTransfer?.files ?? [])
    if (files.length > 0) addAttachments(files)
  }

  function handleOpenResult(card: OutputCard) {
    const doc = detectA2UIJson(card.content)
    if (doc) {
      sendToPreview(doc)
    } else if (lastModules().length > 0) {
      // Card isn't raw A2UI JSON but we have generated content — reshow it
      const shell = lastPlanner()
      const shellLayout = (shell?.layout_planner as Record<string, unknown> | undefined) ?? shell
      const merged = mergeModules(
        { rootId: (shellLayout?.rootId as string) ?? "", elements: ((shellLayout?.elements ?? []) as never) },
        // @ts-expect-error pre-existing type mismatch in mergeModules
        lastModules(),
        (shellLayout?.slots as any[]) ?? undefined,
      )
      const mergedJson = detectA2UIJson(JSON.stringify(merged))
      if (mergedJson) sendToPreview(mergedJson)
    }
  }

  function handleOpenPreview() {
    if (lastModules().length > 0) {
      const shell = lastPlanner()
      const shellLayout = (shell?.layout_planner as Record<string, unknown> | undefined) ?? shell
      const merged = mergeModules(
        { rootId: (shellLayout?.rootId as string) ?? "", elements: ((shellLayout?.elements ?? []) as never) },
        // @ts-expect-error pre-existing type mismatch in mergeModules
        lastModules(),
        (shellLayout?.slots as any[]) ?? undefined,
      )
      const mergedJson = detectA2UIJson(JSON.stringify(merged))
      if (mergedJson) sendToPreview(mergedJson)
    }
  }

  // 生成完成后自动发送预览
  let wasBusy = false
  createEffect(() => {
    const busy = isBusy() || sending()
    if (wasBusy && !busy && lastModules().length > 0) {
      handleOpenPreview()
    }
    wasBusy = busy
  })

  // 回退到指定历史版本
  async function handleSelectVersion(versionId: string) {
    await selectVersion({
      versionId,
      sessionId: params.id,
      historyDir: patternHistoryDir(),
      previewApi,
      sendToPreview,
      setCurrentVersionId,
      onStateRestored: (state) => {
        if (state.lastIntent) setLastIntent(state.lastIntent)
        if (state.lastPlanner) setLastPlanner(state.lastPlanner)
        if (state.lastModules.length > 0) setLastModules(state.lastModules)
      },
    })
  }

  function handleDownload() {
    download(pendingPreviewData(), params.id ?? "export")
  }

  // 分享 — 打包 session 历史版本目录为 ZIP
  async function handleShare() {
    await exportZip({
      historyDir: patternHistoryDir(),
      sessionId: params.id ?? "",
      title: sessionInfo()?.title ?? params.id ?? "export",
    })
  }

  async function handleLivePreview() {
    await livePreview(pendingPreviewData())
  }

  async function handlePixsoPreview() {
    await pixsoPreview(pendingPreviewData())
  }

  const inputDisabled = () => sending() || isBusy() || !activeModelKey() || isPlanReview()

  const chartInputProps = () => ({
    value: prompt(),
    onValueChange: setPrompt,
    onKeyDown: handleKeyDown,
    disabled: inputDisabled(),
    busy: isBusy(),
    onSubmit: () => void handleSubmit(),
    onHalt: () => void halt(),
    attachments: attachments(),
    maxAttachments: attachments().length >= 5,
    onFileChange: handleFileInputChange,
    selectedDesignSystem: selectedDesignSystem(),
    onSelectDesignSystem: setSelectedDesignSystem,
    model: local.model,
    rows:undefined
  })

  return (
    <DataProvider data={sync.data} directory={sdk.directory || ""}>
      <Toast.Region />
      <div
        class="octo-prototype octo-split bg-background-base"
        data-focus={focusMode() ? "true" : undefined}
        style={{
          "grid-template-columns": !focusMode()
            ? hasContent()
              ? `${chatWidth()}px 8px minmax(400px, 1fr)`
              : "1fr"
            : undefined,
        }}
      >
        {/* 对话 */}
        <Show when={!focusMode()}>
          <ChatPanel
            hasContent={hasContent()}
            sessionMessagesLoaded={sessionMessagesLoaded()}
            isBusy={isBusy()}
            sessionInfo={sessionInfo() ?? null}
            userMessages={userMessages()}
            sessionStatus={sessionStatus()}
            autoScroll={autoScroll}
            inputProps={chartInputProps()}
            attachments={attachments()}
            onRemoveAttachment={removeAttachment}
            isDragOver={isDragOver()}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onOpenResult={handleOpenResult}
            pipelineBusy={isBusy() || sending()}
            roundMessages={roundMessages()}
            hasPreview={lastModules().length > 0 && !isBusy()}
            onOpenPreview={handleOpenPreview}
            onDeleteSession={deleteSession}
            onTitleChanged={(title) => mutateSession(prev => prev ? { ...prev, title } : prev)}
          />
        </Show>

        <Show when={hasContent() && !focusMode()}>
          <div class="octo-split-handle" onMouseDown={handleDividerMouseDown} />
        </Show>

        {/* 预览页 */}
        <Show when={hasContent()}>
          <div style={{ position: "relative", overflow: "hidden" }}>
            {/* 线框审查阶段 */}
            <Show when={isPlanReview()} fallback={
              <Show when={hasPreviewContent()} fallback={<PatternPreviewEmpty />}>
                <PreviewPage
                  api={previewApi}
                  pendingData={pendingPreviewData()}
                  onModifyElement={handleModifyElement}
                  onPickerSubmit={handlePickerSubmit}
                  onDownload={handleDownload}
                  onShare={handleShare}
                  onLivePreview={handleLivePreview}
                  onPixsoPreview={handlePixsoPreview}
                  versions={versions()}
                  currentVersionId={currentVersionId()}
                  onSelectVersion={(vid) => { void handleSelectVersion(vid) }}
                />
              </Show>
            }>
              <Show when={lastPlanner() && lastIntent()} fallback={<PatternPreviewEmpty />}>
                <WireframeReview
                  planner={lastPlanner()!}
                  intentDescription={lastIntent()!}
                  userInput={reviewUserInput()}
                  onConfirm={handleConfirmReview}
                />
              </Show>
            </Show>
            <Show when={isModifying()}>
              <div class="change-content">
                <img src={resultEmptySvg} width={80} height={80} alt="" draggable={false} style={{ "flex-shrink": "0" }} />
                <div class="text-[13px]" style={{ color: "var(--octo-text-secondary, rgba(0,0,0,0.6))" }}>正在修改页面中...</div>
              </div>
            </Show>
          </div>
        </Show>
      </div>
    </DataProvider>
  )
}

