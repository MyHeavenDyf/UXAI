import "./assets/style/pattern-tokens.css"
import type { Message, Session, SessionStatus, UserMessage, FilePartInput } from "@opencode-ai/sdk/v2/client"
import { DataProvider } from "@opencode-ai/ui/context/data"
import { createAutoScroll } from "@opencode-ai/ui/hooks"
import { showToast, Toast } from "@opencode-ai/ui/toast"
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  on,
  onMount,
  Show,
  type JSX,
} from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { SDKProvider, useSDK } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"
import { LocalProvider, useLocal } from "@/context/local"
import { useTabModel } from "@/hooks/use-tab-model"
import { syncSessionModel } from "@/pages/session/session-model-helpers"
import { useLayout } from "@/context/layout"
import { useProjectDir } from "@/hooks/use-project-dir"
import { type Attachment } from "./modules/chat/attachment-bar"
import { create_intent_confirm, create_block_match, create_planner_json, create_modules_json, type ProtoCreateJsonInput } from './workflow/create-json'
import modify_json_ai from './workflow/modify-json-ai'
import { appendPatternVersion, updatePatternVersion, listPatternVersions, type VersionEntry } from "./utils/version-history"
import { saveCheckpoint, loadCheckpoint, clearCheckpoint } from "./checkpoint/checkpoint"
import { restoreSession } from "./checkpoint/session-restore"
import { logStartSession, clearDebugLog, saveDebugSnapshot } from "./utils/debug-log"
import { classifyAIError, saveProtoError, loadProtoError, clearProtoError, type ProtoError } from "./utils/error-msg"
import { autoRenameSession } from "./utils/rename"
import { groupRounds } from "./utils/round-messages"
import { createSplitDrag } from "./utils/drag-split"
import { exportZip } from "./utils/preview-handler/zip"
import { handleModifyElement as runQuickModify, type QuickModifyContext, type ModifyElementData } from './workflow/modify-json-quick'
import { handleLivePreview as livePreview, handlePixsoPreview as pixsoPreview, handleCodeToHtml as codeToHtmlHandler, handleDownload as download, handleSelectVersion as selectVersion } from "./utils/preview-handler"
import { PreviewPage, type PreviewPageAPI } from "./modules/preview/index"
import proto_triage from "./agents/proto-triage"
import proto_replanner from "./agents/proto-replanner"
import { PatternGenerating }  from "./modules/preview/pattern-generating"
import type { BlockModuleItem } from "./utils/pattern-resource"
import { type IntentConfirmAnswers } from "./modules/chat/intent-confirm-card"
import type { IntentConfirmDimension, IntentConfirmResult } from "./agents/proto-intent-confirm"
import { ChatPanel } from "./modules/chat/index"
import resultEmptySvg from "./assets/images/IllustrationResultEmpty.svg?url"
import { PatternPreviewEmpty } from "./modules/preview/pattern-preview-empty"
import { saveTheme, loadTheme } from "./utils/theme"
import { tracker } from "@/utils/tracker"
import { createReorderHandler } from "./utils/reorder"
import { useArchive } from "./utils/archive-module"
import { getArchiveBaseUrl } from "./utils/pattern-archive-utils"
import { getDesktopApi } from "./utils/desktop-api"
import { ArchiveDialog } from "@/components/dialog-archive"
import { DialogArchiveSuccess } from "@/components/dialog-archive-success"
import * as sessionMap from "./utils/session-map"

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
  useTabModel("pattern")

  onMount(() => { tracker.page({ module: "prototype", name: "pattern-page" }) })

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
        return (result.data as Session | undefined) ?? null
      } catch {
        return null as Session | null
      }
    },
  )

  async function deleteSession(sessionID: string) {
    try {
      await sdk.client.session.delete({ sessionID })
      tracker.interaction({ module: "prototype", name: "delete-session" })
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
          setSelectedDesignSystem("ICT3.1")
          if (prevId) delete lastSentPreviewJson[prevId]
        }

        // ── 2. 无条件同步重置（仅重置当前视图状态，各 session 独立数据保留在 map 中）──
        setChildSessionIDs([])
        setSessionSynced(false)
        setCardInitialStep(undefined)
        discoverVersion++
        previewApi.sendToPreview(null)
        if (id) delete lastSentPreviewJson[id]

        // ── 3. 进入新 session：追踪 + 清空 + 异步加载 ──
        if (id) {
          layout.lastSessionPerTab.setPattern(id)
          sessionMap.set(setLastModules, id, [])
          sessionMap.set(setVersions, id, [])
          sessionMap.set(setCurrentVersionId, id, null)
          sessionMap.set(setIsModifying, id, false)
          // 正在生成的 session 保留原有数据，切换回来后继续显示 loading
          if (!isGeneratingReview()[id]) {
            sessionMap.set(setLastIntent, id, null)
            sessionMap.set(setLastPlanner, id, null)
            sessionMap.set(setHasPreviewContent, id, false)
          }

          // 同步子 session 消息，全部加载完成后才标记 synced
          void sync.session.sync(id).then(async () => {
            if (params.id !== id) return
            await discoverChildSessions(id)
            if (params.id !== id) return
            setSessionSynced(true)
            // 加载持久化的 workflow 错误
            const errDir = patternHistoryDir()
            if (errDir) {
              void loadProtoError(errDir, id).then((protoErr) => {
                if (protoErr && params.id === id) setSessionErrors((prev) => ({ ...prev, [id]: protoErr }))
              })
            }
            // 滚动到底部
            requestAnimationFrame(() => autoScroll.forceScrollToBottom())
          })

          // 恢复历史版本状态并推送到预览
          const dir = patternHistoryDir()
          if (dir) {
            void async function() {
              if (params.id !== id) return
              // pipeline 正在运行时跳过 restore，内存状态已正确
              if (sendingSids().has(id)) return
              // 读取该会话持久化的设计系统主题
              const savedTheme = await loadTheme(dir, id)
              if (params.id !== id) return
              setSelectedDesignSystem(savedTheme ?? "ICT3.1")

              const result = await restoreSession(dir, id)
              if (params.id !== id) return

              switch (result.type) {
                case "pipeline_error": {
                  setSessionErrors(prev => ({ ...prev, [id]: { title: "生成异常，请重试" } }))
                  return
                }
                case "intent_confirm": {
                  const ckpt = result.checkpoint
                  sessionMap.set(setUserInput, id, ckpt.userInput)
                  sessionMap.set(setIntentConfirm, id, {
                    results: (ckpt.options as { results?: IntentConfirmResult["results"] })?.results ?? [],
                    current_step: "intent_confirm",
                  })
                  return
                }
                case "block_matching": {
                  const ckpt = result.checkpoint
                  sessionMap.set(setUserInput, id, ckpt.userInput)
                  sessionMap.set(setIntentConfirm, id, {
                    results: (ckpt.options as { results?: IntentConfirmResult["results"] })?.results ?? [],
                    current_step: "intent_confirm",
                  })
                  sessionMap.set(setBlockMatches, id, ckpt.blockMatches ?? [])
                  sessionMap.set(setCachedPagePattern, id, ckpt.pagePattern ?? "")
                  sessionMap.set(setBlockMatchError, id, !ckpt.blockMatches)
                  setCardInitialStep("blocks")
                  return
                }
                case "planner_create": {
                  const ckpt = result.checkpoint
                  sessionMap.set(setLastPlanner, id, ckpt.planner ?? null)
                  sessionMap.set(setLastIntent, id, ckpt.intentResult?.intent_description ?? null)
                  sessionMap.set(setUserInput, id, ckpt.userInput)
                  return
                }
                case "completed": {
                  const state = result.state
                  if (state.lastIntent) sessionMap.set(setLastIntent, id, state.lastIntent)
                  if (state.lastPlanner) sessionMap.set(setLastPlanner, id, state.lastPlanner)
                  if (state.lastModules.length > 0) {
                    sessionMap.set(setLastModules, id, state.lastModules)
                    if (state.mergedA2UI) sendToPreview(state.mergedA2UI)
                  }
                  return
                }
                case "empty":
                  return
              }
            }()
            // 版本列表独立并行加载
            void listPatternVersions(dir, id).then(({ versions: versionEntries, current }) => {
              if (params.id !== id) return
              sessionMap.set(setVersions, id, versionEntries)
              sessionMap.set(setCurrentVersionId, id, current)
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

  const [sessionErrors, setSessionErrors] = createSignal<Record<string, ProtoError>>({})
  // per-session 暂停计时（需求确认 / 线框审查等待期间不计时）
  const [pauseMs, setPauseMs] = createSignal<Record<string, number>>({})
  const [pauseStart, setPauseStart] = createSignal<Record<string, number | undefined>>({})

  function startPause(sid: string) {
    setPauseStart(prev => prev[sid] === undefined ? { ...prev, [sid]: Date.now() } : prev)
  }
  function endPause(sid: string) {
    setPauseStart(prev => {
      const at = prev[sid]
      if (at === undefined) return prev
      const elapsed = Date.now() - at
      setPauseMs(p => ({ ...p, [sid]: (p[sid] ?? 0) + elapsed }))
      return { ...prev, [sid]: undefined }
    })
  }

  const roundMessages = createMemo(() => {
    const id = params.id
    if (!id) return []
    const rounds = groupRounds(
      id,
      childSessionIDs(),
      (sid) => (sync.data.message[sid] ?? []) as Message[],
      (mid) => sync.data.part[mid] as Array<Record<string, unknown>> | undefined,
    )
    // 运行时 workflow 错误
    const protoErr = sessionErrors()[id]
    if (protoErr && rounds.length > 0) {
      rounds[rounds.length - 1] = { ...rounds[rounds.length - 1], error: protoErr.title, errorAgent: protoErr.agentLabel, errorCallId: protoErr.agentCallId }
    }
    return rounds
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
  const [sendingSids, setSendingSids] = createSignal<Set<string>>(new Set())
  const sending = () => !!params.id && sendingSids().has(params.id)
  const [attachments, setAttachments] = createSignal<Attachment[]>([])
  const [isDragOver, setIsDragOver] = createSignal(false)
  const [selectedDesignSystem, setSelectedDesignSystem] = createSignal<string>("ICT3.1")

  // 归档:状态和事件处理由 useArchive composable 封装,此处只注入依赖
  const archive = useArchive({
    sessionId: () => params.id,
    projectDir: () => sdk.directory,
    sessionTitle: () => sessionInfo()?.title,
    pendingData: () => pendingPreviewData()[params.id ?? ""] ?? null,
  })

  // ── per-session 状态 Map（按 session ID 隔离，互不干扰）──
  const [lastIntent, setLastIntent] = sessionMap.createSessionMap<Record<string, unknown> | null>()
  const [lastPlanner, setLastPlanner] = sessionMap.createSessionMap<Record<string, unknown> | null>()
  const [lastModules, setLastModules] = sessionMap.createSessionMap<Array<Record<string, unknown>>>()
  const [versions, setVersions] = sessionMap.createSessionMap<VersionEntry[]>()
  const [currentVersionId, setCurrentVersionId] = sessionMap.createSessionMap<string | null>()
  const [hasPreviewContent, setHasPreviewContent] = sessionMap.createSessionMap<boolean>()
  const [pendingPreviewData, setPendingPreviewData] = sessionMap.createSessionMap<unknown>()
  const [isModifying, setIsModifying] = sessionMap.createSessionMap<boolean>()
  // 用户原始输入（意图确认 / 线框审查阶段复用）
  const [userInput, setUserInput] = sessionMap.createSessionMap<string>()
  // 是否正在生成（意图确认后 → pattern匹配之间）
  const [isGenerating, setIsGenerating] = sessionMap.createSessionMap<boolean>()
  // 是否正在生成模块（线框审查确认后 → 预览之间）
  const [isGeneratingReview, setIsGeneratingReview] = sessionMap.createSessionMap<boolean>()
  // 意图确认阶段：null = 未激活，非 null = 带选项结果
  const [intentConfirm, setIntentConfirm] = sessionMap.createSessionMap<IntentConfirmResult | null>()
  // block 匹配到的模板列表
  const [blockMatches, setBlockMatches] = sessionMap.createSessionMap<BlockModuleItem[]>()
  // 是否正在匹配 block 模板
  const [blockMatching, setBlockMatching] = sessionMap.createSessionMap<boolean>()
  // block 匹配是否出错
  const [blockMatchError, setBlockMatchError] = sessionMap.createSessionMap<boolean>()
  // 缓存的 page pattern 规范 MD（首次选择时缓存，重试时复用，checkpoint 恢复时回填）
  const [cachedPagePattern, setCachedPagePattern] = sessionMap.createSessionMap<string>()
  // 卡片初始步骤（恢复 block_matching 时直接跳到 blocks）
  const [cardInitialStep, setCardInitialStep] = createSignal<"patterns" | "blocks" | undefined>()

  const needsConfirm = createMemo(() => {
    const id = params.id
    if (!id) return false
    if (!!isGenerating()[id] || !!isGeneratingReview()[id]) return false
    return intentConfirm()[id] != null
  })

  const confirmText = createMemo<{ title: string; subtitle: string } | null>(() => {
    const id = params.id
    if (!id) return null
    if (intentConfirm()[id]) return { title: "意图分析完成", subtitle: "请在下方确认需求" }
    return null
  })

  // 历史文件存储目录，优先使用关联目录下的 .octo/design/history
  const patternHistoryDir = createMemo(() => {
    const home = sdk.directory
    return `${home}/.octo/design/history`
  })

  createEffect(() => {
    const home = sdk.directory
    if (!home) return
    const api = (window as unknown as { api?: { setUploadsDir?: (dir: string) => Promise<void> } }).api
    api?.setUploadsDir?.(`${home}/.octo/design/history`)
  })

  // pipeline 忙状态（用于生成卡片状态）
  const pipelineBusy = createMemo(() => isBusy() || sending())

  const hasContent = () => !!(params.id && userMessages().length > 0)
  const sessionMessagesLoaded = () => !params.id || sessionSynced()

  // 从预览页选中元素后触发的修改回调
  function handlePickerSubmit(text: string, id: string) {
    const line = text ? `[选中元素: ${id}] ${text};` : ""
    const prev = prompt()
    const next = line ? (prev ? `${prev}\n${line}` : line) : prev
    setPrompt(next)
    if (next.trim()) handleSubmit()
  }

  function handlePickerAppend(text: string, id: string) {
    const line = `[选中元素: ${id}] ${text};`
    const prev = prompt()
    setPrompt(prev ? `${prev}\n${line}` : line)
  }

  const handleReorder = createReorderHandler({
    getPendingData: () => {
      const sid = params.id
      return sid ? pendingPreviewData()[sid] : null
    },
    sendToPreview,
    getSessionId: () => params.id,
    getHistoryDir: () => patternHistoryDir(),
    getLastIntent: () => {
      const sid = params.id
      return sid ? lastIntent()[sid] ?? null : null
    },
    getLastPlanner: () => {
      const sid = params.id
      return sid ? lastPlanner()[sid] ?? null : null
    },
    getLastModules: () => {
      const sid = params.id
      return sid ? lastModules()[sid] ?? [] : []
    },
    setVersions: (fn: (prev: VersionEntry[]) => VersionEntry[]) => {
      const sid = params.id
      if (sid) sessionMap.update(setVersions, sid, fn, [])
    },
    setCurrentVersionId: (id: string) => {
      const sid = params.id
      if (sid) sessionMap.set(setCurrentVersionId, sid, id)
    },
  })

  const quickModifyCtx: QuickModifyContext = {
    getPendingData: () => {
      const sid = params.id
      return sid ? pendingPreviewData()[sid] : null
    },
    sendToPreview,
    refreshPreview: () => previewApi.refresh(),
    getHistoryDir: () => patternHistoryDir(),
    getSessionId: () => params.id,
    getLastIntent: () => {
      const sid = params.id
      return sid ? lastIntent()[sid] ?? null : null
    },
    getLastPlanner: () => {
      const sid = params.id
      return sid ? lastPlanner()[sid] ?? null : null
    },
    getLastModules: () => {
      const sid = params.id
      return sid ? lastModules()[sid] ?? [] : []
    },
    setVersions: (fn: (prev: VersionEntry[]) => VersionEntry[]) => {
      const sid = params.id
      if (sid) sessionMap.update(setVersions, sid, fn, [])
    },
    setCurrentVersionId: (id: string) => {
      const sid = params.id
      if (sid) sessionMap.set(setCurrentVersionId, sid, id)
    },
  }

  async function handleModifyElement(data: ModifyElementData) {
    try {
      tracker.interaction({ module: "prototype", name: "modify-element" })
      await runQuickModify(quickModifyCtx, data)
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "aborted") return
      console.error("[PatternPage] handleModifyElement failed", err)
      const error = classifyAIError(err)
      if (error.title) {
        const sid = params.id
        if (sid) setSessionErrors((prev) => ({ ...prev, [sid]: { title: error.title, agentLabel: error.agentLabel, agentCallId: error.agentCallId } }))
        showToast({ title: error.title, description: error.description })
      }
    }
  }

  async function handleWorkflowError(err: unknown, sessionId: string, label: string) {
    console.error(`[PatternPage] ${label} failed`, err)
    void saveDebugSnapshot(patternHistoryDir(), sessionId, "error", { error: String(err instanceof Error ? err.message : err) })
    await sdk.client.session.abort({ sessionID: sessionId }).catch(() => { })
    for (const childID of childSessionIDs()) {
      await sdk.client.session.abort({ sessionID: childID }).catch(() => { })
    }
    const error = classifyAIError(err)
    if (error.title) {
      setSessionErrors((prev) => ({ ...prev, [sessionId]: { title: error.title, agentLabel: error.agentLabel, agentCallId: error.agentCallId } }))
      showToast({ title: error.title, description: error.description })
      const errDir = patternHistoryDir()
      if (errDir) void saveProtoError(errDir, sessionId, { title: error.title, agentLabel: error.agentLabel, agentCallId: error.agentCallId })
    }
  }

  // 重试：从 checkpoint 恢复断点续传
  async function handleRetry() {
    const sid = params.id
    if (!sid) return
    const mk = activeModelKey()
    if (!mk) return
    const dir = patternHistoryDir()
    if (!dir) return

    const ckpt = await loadCheckpoint(dir, sid)
    if (!ckpt) {
      showToast({ title: "无断点记录", description: "未找到可恢复的进度，请重新生成" })
      return
    }
    setSessionErrors(prev => { const n = { ...prev }; delete n[sid]; return n })
    await clearProtoError(dir, sid)
    setSendingSids(prev => new Set(prev).add(sid))

    const ds = ckpt.designSystem || "ICT3.1"
    const text = ckpt.userInput
    const extra: Record<string, unknown> = { designSystem: ds }
    if (ckpt.patterns) extra.patterns = ckpt.patterns
    const intentCtx: ProtoCreateJsonInput = {
      sdk,
      sync,
      modelKey: mk,
      rootSession: sid,
      userInput: text,
      extra,
      checkpointDir: dir,
      onSessionCreated: (childID: string) => {
        if (params.id !== sid) return
        setChildSessionIDs(prev => [...prev, childID])
      },
    }

    try {
      if (ckpt.stage === "modules_create" && ckpt.planner) {
        // Stage 2 失败，从模块生成重试
        sessionMap.set(setIsGeneratingReview, sid, true)
        const planner = ckpt.planner
        const intent = ckpt.intentResult?.intent_description ?? {}
        const onFinshed = async ({ pageIntent, layoutPlanner, modulesJson, pageJson }: any) => {
          if (dir) {
            await updatePatternVersion(dir, sid, { lastModules: modulesJson, mergedA2UI: pageJson })
            void saveDebugSnapshot(dir, sid, "modules", { lastIntent: pageIntent, lastPlanner: layoutPlanner, lastModules: modulesJson, mergedA2UI: pageJson, summary: text.slice(0, 80) })
            clearDebugLog()
          }
          sessionMap.set(setLastIntent, sid, pageIntent)
          sessionMap.set(setLastPlanner, sid, layoutPlanner)
          sessionMap.set(setLastModules, sid, modulesJson)
          sessionMap.set(setIsGeneratingReview, sid, false)
          if (params.id === sid && pageJson) sendToPreview(pageJson)
        }
        await create_modules_json(intentCtx, planner, intent, onFinshed)
      } else {
        if (ckpt.stage === "intent_confirm") {
          // intent_confirm 报错，先重跑意图确认
          const confirmResult = await create_intent_confirm(intentCtx)
          setCardInitialStep(undefined)
          // 无论是否匹配到 Pattern，都弹卡片暂停；空结果时卡片显示「未匹配到」+ 跳过
          sessionMap.set(setUserInput, sid, text)
          sessionMap.set(setIntentConfirm, sid, confirmResult)
          startPause(sid)
          return
        }

        // Stage 1 失败，从 planner 生成重试
        sessionMap.set(setIsGenerating, sid, true)
        const new_planner = await create_planner_json(intentCtx)
        void saveDebugSnapshot(dir, sid, "planner")
        const partialDir = patternHistoryDir()
        if (partialDir) {
          const vid = await appendPatternVersion(partialDir, sid, {
            lastIntent: new_planner.intent.intent_description,
            lastPlanner: new_planner.planner.layout_planner,
            lastModules: [],
          }, text.slice(0, 80))
          sessionMap.update(setVersions, sid, prev => [...prev, { id: vid, createdAt: Date.now(), summary: text.slice(0, 80) }], [])
          sessionMap.set(setCurrentVersionId, sid, vid)
        }
        if (params.id !== sid) return
        sessionMap.set(setLastPlanner, sid, new_planner.planner.layout_planner)
        sessionMap.set(setLastIntent, sid, new_planner.intent.intent_description)
        sessionMap.set(setUserInput, sid, text)

        // 直接进入 modules_create
        sessionMap.set(setIsGeneratingReview, sid, true)
        const retryOnFinished = async ({ pageIntent, layoutPlanner, modulesJson, pageJson }: any) => {
          if (dir) {
            await updatePatternVersion(dir, sid, { lastModules: modulesJson, mergedA2UI: pageJson })
            clearDebugLog()
          }
          sessionMap.set(setLastIntent, sid, pageIntent)
          sessionMap.set(setLastPlanner, sid, layoutPlanner)
          sessionMap.set(setLastModules, sid, modulesJson)
          sessionMap.set(setIsGeneratingReview, sid, false)
          if (params.id === sid && pageJson) sendToPreview(pageJson)
        }
        await create_modules_json(intentCtx, new_planner.planner.layout_planner, new_planner.intent.intent_description, retryOnFinished)
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "aborted") return
      await handleWorkflowError(err, sid, "handleRetry")
    } finally {
      setSendingSids(prev => { const n = new Set(prev); n.delete(sid); return n })
      sessionMap.set(setIsGenerating, sid, false)
      sessionMap.set(setIsGeneratingReview, sid, false)
    }
  }

  const { chatWidth, focusMode, setFocusMode, onDividerMouseDown } = createSplitDrag()

  const autoScroll = createAutoScroll({ working: isBusy })

  const previewApi: PreviewPageAPI = { sendToPreview: () => { }, postMessage: () => { }, refresh: () => { }, setEditingOff: () => { } }

  const lastSentPreviewJson: Record<string, string> = {}
  function sendToPreview(data: unknown) {
    const sid = params.id
    if (!sid) return
    const json = typeof data === "string" ? data : JSON.stringify(data)
    if (json === lastSentPreviewJson[sid]) return
    lastSentPreviewJson[sid] = json
    sessionMap.set(setPendingPreviewData, sid, data)
    previewApi.sendToPreview(data)
    sessionMap.set(setHasPreviewContent, sid, true)
  }

  // 用户提交输入
  async function handleSubmit() {
    const text = prompt().trim()
    if (!text || sending() || !activeModelKey()) return
    const genStartTime = performance.now()
    console.log("[Pattern] 开始生成页面:", text)
    const submitSessionId = params.id
    setPrompt("")
    const mk = activeModelKey()!
    let sid = submitSessionId
    try {
      if (!sid) {
        const dir = sdk.directory
        if (!dir) return
        const result = await sdk.client.session.create({ directory: dir, agent: AGENT_NAME })
        const session = result.data as Session | undefined
        if (!session) return
        tracker.interaction({ module: "prototype", name: "new-session" })
        navigate(`/pattern/${session.id}`)
        sid = session.id
      }
      setSendingSids((prev) => new Set(prev).add(sid!))
      // 清理该 session 的持久化错误
      setSessionErrors((prev) => {
        if (!prev[sid!]) return prev
        const next = { ...prev }
        delete next[sid!]
        return next
      })
      const startDir = patternHistoryDir()
      if (startDir) {
        void clearProtoError(startDir, sid!)
        void clearCheckpoint(startDir, sid!)
        void saveTheme(startDir, sid!, selectedDesignSystem())
      }

      // 执行流程的基础上下文
      const ds = selectedDesignSystem()
      let intentCtx = {
        sdk: sdk,
        sync: sync,
        modelKey: mk,
        rootSession: sid,
        userInput: text,
        extra: { designSystem: ds },
        checkpointDir: patternHistoryDir() ?? undefined,
        onSessionCreated: (childID: string) => {
          if (params.id !== sid) return
          setChildSessionIDs((prev) => [...prev, childID])
        },
        refreshPreview: () => previewApi.refresh(),
        fileParts: attachments().length > 0
          ? attachments().map(a => ({ type: "file" as const, mime: a.mime, filename: a.filename, url: a.dataUrl }))
          : undefined,
      }

      setAttachments([])

      // 开启本次调试日志
      logStartSession(sid, text)
      // 流程执行完毕后的回调
      let onFinshed = async ({ pageIntent, layoutPlanner, modulesJson, pageJson }: any) => {
          // 历史保存始终执行（与当前查看的 session 无关）
          const dir = patternHistoryDir()
          if (dir) {
            const vid = await appendPatternVersion(dir, sid!, {
                lastIntent: pageIntent,
                lastPlanner: layoutPlanner,
                lastModules: modulesJson,
                mergedA2UI: pageJson as unknown as Record<string, unknown>,
            }, text.slice(0, 80))
            if (params.id === sid) {
              sessionMap.update(setVersions, sid!, prev => [...prev, { id: vid, createdAt: Date.now(), summary: text.slice(0, 80) }], [])
              sessionMap.set(setCurrentVersionId, sid!, vid)
              clearDebugLog()
            }
            void saveDebugSnapshot(dir, sid!, "modules", {
              lastIntent: pageIntent,
              lastPlanner: layoutPlanner,
              lastModules: modulesJson,
              mergedA2UI: pageJson as unknown as Record<string, unknown>,
              summary: text.slice(0, 80),
            })
          }
          // 内存数据更新（始终写入该 session 的 slot，与当前视图 session 无关）
          sessionMap.set(setLastIntent, sid!, pageIntent)
          sessionMap.set(setLastPlanner, sid!, layoutPlanner)
          sessionMap.set(setLastModules, sid!, modulesJson)
          // 仅当前仍在该 session 时才推送到 iframe
          if (params.id === sid && pageJson) sendToPreview(pageJson)
      }

      if((sid ? lastModules()[sid] ?? [] : []).length > 0){
        if (!sendingSids().has(sid!)) return
        let lastData = {
          lastIntent: sid ? lastIntent()[sid] ?? null : null,
          lastPlanner: sid ? lastPlanner()[sid] ?? null : null,
          lastModules: sid ? lastModules()[sid] ?? [] : [],
        }
        // AI 修改页面 — 先切到加载态
        if (sid) sessionMap.set(setIsModifying, sid!, true)
        tracker.interaction({ module: "prototype", name: "modify-page" })
        const modifyResult = await modify_json_ai(intentCtx, lastData, onFinshed);
        if (params.id !== sid) return
        if (sid) sessionMap.set(setIsModifying, sid!, false)
      }else{
        // 新会话先做分诊，判断是否为闲聊
        if (!sendingSids().has(sid!)) return
        const triageCtx = {
          sdk: intentCtx.sdk,
          sync: intentCtx.sync,
          modelKey: intentCtx.modelKey,
          rootSession: intentCtx.rootSession,
          userInput: intentCtx.userInput,
          lastIntent: null,
          lastPlanner: null,
          lastModules: [],
          fileParts: intentCtx.fileParts,
          onSessionCreated: intentCtx.onSessionCreated,
        }
        const triage = await proto_triage(triageCtx as any)
        if (triage.routing === "chat") {
          return
        }
        if (triage.attachment_description) {
          intentCtx.userInput = `[参考内容]: ${triage.attachment_description}\n[用户需求]: ${text}`
        }

        // 首次创建页面：异步获取标题（不阻塞 pipeline）
        void autoRenameSession({
          sync: sync,
          client: sdk.client,
          directory: sdk.directory,
          targetSessionID: sid!,
          userText: text,
          modelKey: mk,
        }).then((title) => {
          if (title) mutateSession(prev => prev ? { ...prev, title } : prev)
        }).catch(() => {})

        // 无需确认，直接进入阶段 1：意图扩展 + 布局规划
        tracker.interaction({ module: "prototype", name: "create-page" })
        // 首次创建页面 — 阶段 0：意图确认（暂停等用户选择）
        if (!sendingSids().has(sid!)) return
        const confirmResult = await create_intent_confirm(intentCtx)
        void saveDebugSnapshot(patternHistoryDir(), sid!, "intent_confirm")
        setCardInitialStep(undefined)
        // 无论是否匹配到 Pattern，都弹卡片暂停；空结果时卡片显示「未匹配到」+ 跳过
        if (sid) sessionMap.set(setUserInput, sid!, intentCtx.userInput)
        if (sid) sessionMap.set(setIntentConfirm, sid!, confirmResult)
        startPause(sid!)
        return
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "aborted") return
      await handleWorkflowError(err, sid!, "handleSubmit")
      if (sid) sessionMap.set(setIsModifying, sid!, false)
    } finally {
      setSendingSids((prev) => {
        if (!prev.has(sid!)) return prev
        const next = new Set(prev)
        next.delete(sid!)
        return next
      })
    }
  }

  // 卡片第一步：page pattern 选定后触发 block 匹配（selectedItem 后续用于精准匹配）
  async function handleMatchPatternInCard(selectedItem: IntentConfirmDimension | null) {
    const sid = params.id
    if (!sid) return
    const mk = activeModelKey()
    if (!mk) return
    const text = userInput()[sid] ?? ""
    const enrichedText = text
    const ds = selectedDesignSystem()
    // 首次选择时缓存 pagePattern，重试时（selectedItem = null）复用缓存
    const pagePattern = selectedItem?.content ?? cachedPagePattern()[sid] ?? ""
    if (selectedItem) sessionMap.set(setCachedPagePattern, sid, pagePattern)
    sessionMap.set(setBlockMatching, sid, true)
    sessionMap.set(setBlockMatchError, sid, false)
    sessionMap.set(setBlockMatches, sid, [])
    try {
      const result = await create_block_match({
        sdk,
        sync,
        modelKey: mk,
        rootSession: sid,
        userInput: enrichedText,
        extra: {
          ...(ds ? { designSystem: ds } : {}),
          pagePattern,
        } as Record<string, unknown>,
        checkpointDir: patternHistoryDir() ?? undefined,
        onSessionCreated: (childID: string) => {
          if (params.id !== sid) return
          setChildSessionIDs((prev) => [...prev, childID])
        },
      })
      sessionMap.set(setBlockMatches, sid, result.matches)
    } catch (err) {
      console.error("[Pattern Block] 匹配失败:", err)
      sessionMap.set(setBlockMatchError, sid, true)
    } finally {
      sessionMap.set(setBlockMatching, sid, false)
    }
  }

  // 卡片第二步：点「确认并继续生成」→ proto_intent → planner_create → modules_create
  async function handleConfirmIntent(_answers: IntentConfirmAnswers, enrichedInput: string, selectedBlocks: BlockModuleItem[]) {
    debugger
    const sid = params.id
    if (!sid) return
    const mk = activeModelKey()
    if (!mk) return
    const text = userInput()[sid] ?? ""
    const enrichedText = text + enrichedInput
    sessionMap.set(setIntentConfirm, sid, null)
    setSendingSids((prev) => new Set(prev).add(sid))
    endPause(sid)
    sessionMap.set(setIsGenerating, sid, true)
    try {
      const ds = selectedDesignSystem()

      // 读取每个选中 pattern 的外层信息 + 核心描述
      const patterns: Array<{
        name: string
        category: string
        description: string
        structure: string
        patternId: string
        content?: any
        rootContainer: { id: string; component: string; className: string }
      }> = []
      for (const block of selectedBlocks) {
        if (!block.content) continue
        const json = block.content
        const rootEl = json.elements?.find((e: any) => e.id === json.rootId) ?? json.elements?.[0]
        if (!rootEl) continue
        patterns.push({
          name: block.name,
          category: block.category ?? "",
          description: block.description ?? "",
          structure: block.structure ?? "",
          patternId: block.id,
          content: block.content,
          rootContainer: {
            id: json.rootId ?? rootEl.id ?? "",
            component: rootEl.component ?? "",
            className: rootEl.props?.className ?? "",
          },
        })
      }

      const intentCtx: ProtoCreateJsonInput = {
        sdk,
        sync,
        modelKey: mk,
        rootSession: sid,
        userInput: enrichedText,
        extra: { designSystem: ds, patterns } as Record<string, unknown>,
        checkpointDir: patternHistoryDir() ?? undefined,
        onSessionCreated: (childID: string) => {
          setChildSessionIDs((prev) => [...prev, childID])
        },
      }
      if (!sendingSids().has(sid)) return

      // proto_intent → planner_create（去掉 pattern_page 和线框审查）
      const new_planner = await create_planner_json(intentCtx)
      void saveDebugSnapshot(patternHistoryDir(), sid!, "planner")
      const partialDir = patternHistoryDir()
      if (partialDir) {
        const vid = await appendPatternVersion(partialDir, sid!, {
          lastIntent: new_planner.intent.intent_description,
          lastPlanner: new_planner.planner.layout_planner,
          lastModules: [],
        }, enrichedText.slice(0, 80))
        sessionMap.update(setVersions, sid!, prev => [...prev, { id: vid, createdAt: Date.now(), summary: enrichedText.slice(0, 80) }], [])
        sessionMap.set(setCurrentVersionId, sid!, vid)
      }

      sessionMap.set(setLastPlanner, sid!, new_planner.planner.layout_planner)
      sessionMap.set(setLastIntent, sid!, new_planner.intent.intent_description)
      sessionMap.set(setUserInput, sid!, enrichedText)

      // 直接进入 modules_create，不暂停审查
      sessionMap.set(setIsGeneratingReview, sid, true)
      const onFinshed = async ({ pageIntent, layoutPlanner, modulesJson, pageJson }: any) => {
        const dir = patternHistoryDir()
        if (dir) {
          await updatePatternVersion(dir, sid, { lastModules: modulesJson, mergedA2UI: pageJson })
          void saveDebugSnapshot(dir, sid, "modules", { lastIntent: pageIntent, lastPlanner: layoutPlanner, lastModules: modulesJson, mergedA2UI: pageJson, summary: enrichedText.slice(0, 80) })
          clearDebugLog()
        }
        sessionMap.set(setLastIntent, sid, pageIntent)
        sessionMap.set(setLastPlanner, sid, layoutPlanner)
        sessionMap.set(setLastModules, sid, modulesJson)
        sessionMap.set(setIsGeneratingReview, sid, false)
        if (params.id === sid && pageJson) sendToPreview(pageJson)
      }
      await create_modules_json(intentCtx, new_planner.planner.layout_planner, new_planner.intent.intent_description, onFinshed)
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "aborted") return
      await handleWorkflowError(err, sid!, "handleConfirmIntent")
    } finally {
      sessionMap.set(setIsGenerating, sid, false)
      sessionMap.set(setIsGeneratingReview, sid, false)
      setSendingSids((prev) => {
        if (!prev.has(sid)) return prev
        const next = new Set(prev)
        next.delete(sid)
        return next
      })
    }
  }

  async function halt() {
    const sid = params.id
    if (!sid) return
    tracker.interaction({ module: "prototype", name: "stop-generation" })
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
    setSendingSids((prev) => {
      if (!prev.has(sid)) return prev
      const next = new Set(prev)
      next.delete(sid)
      return next
    })
    // 清理该 session 的 workflow 状态
    sessionMap.set(setIsGenerating, sid, false)
    sessionMap.set(setIsGeneratingReview, sid, false)
    sessionMap.set(setIsModifying, sid, false)
    sessionMap.set(setIntentConfirm, sid, null)
    // 取消时保留已累计的 pauseMs（扣除暂停时间），只停止实时暂停
    endPause(sid)
    setSessionErrors((prev) => { const next = { ...prev }; delete next[sid]; return next })
    const haltDir = patternHistoryDir()
    if (haltDir) {
      void clearProtoError(haltDir, sid)
      void clearCheckpoint(haltDir, sid)
    }
  }

  // 监听对话框回车键
  function handleKeyDown(e: KeyboardEvent) {
    // 输入法合成期间(如拼音待选)的回车用于确认候选词,不应触发发送
    if (e.isComposing || e.keyCode === 229) return
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      void handleSubmit()
    }
  }

  // 对话框文件上传 - 暂未支持文件上传
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
    if (toAdd.length > 0) {
      tracker.interaction({ module: "prototype", name: "add-attachment", extend: JSON.stringify({ count: toAdd.length }) })
    }
  }

  // 对话框文件上传 - 暂未支持文件上传
  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  // 对话框文件上传 - 暂未支持文件上传
  function handleFileInputChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement
    if (input.files?.length) {
      addAttachments(Array.from(input.files))
      input.value = ""
    }
  }

  // 对话框UI拖拽
  function handleDragOver(e: DragEvent) {
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"
    setIsDragOver(true)
  }

  // 对话框UI拖拽
  function handleDragLeave() {
    setIsDragOver(false)
  }

  // 对话框UI拖拽
  function handleDrop(e: DragEvent) {
    e.preventDefault()
    setIsDragOver(false)
    const files = Array.from(e.dataTransfer?.files ?? [])
    if (files.length > 0) addAttachments(files)
  }

  // 回退到指定历史版本
  async function handleSelectVersion(versionId: string) {
    tracker.interaction({ module: "prototype", name: "select-version", extend: JSON.stringify({ versionId }) })
    await selectVersion({
      versionId,
      sessionId: params.id,
      historyDir: patternHistoryDir(),
      previewApi,
      sendToPreview,
      setCurrentVersionId: (id: string) => {
        const sid = params.id
        if (sid) sessionMap.set(setCurrentVersionId, sid, id)
      },
      onStateRestored: (state) => {
        const sid = params.id
        if (!sid) return
        if (state.lastIntent) sessionMap.set(setLastIntent, sid, state.lastIntent)
        if (state.lastPlanner) sessionMap.set(setLastPlanner, sid, state.lastPlanner)
        if (state.lastModules.length > 0) sessionMap.set(setLastModules, sid, state.lastModules)
      },
    })
  }

  // 下载页面代码
  async function handleDownload() {
    const sid = params.id
    if (!sid) return
    tracker.interaction({ module: "prototype", name: "download-result" })
    const mk = activeModelKey()
    if (!mk) {
      showToast({ title: "请先选择模型" })
      return
    }
    const mergedA2UI = pendingPreviewData()[sid] as Record<string, unknown> | null
    if (!mergedA2UI) {
      showToast({ title: "暂无可下载的内容" })
      return
    }

    // 独立流程：重新生成 planner 后下载，不影响主流程数据
    let planner: Record<string, unknown> | null = null
    let replannerSessionId: string | undefined
    try {
      const result = await proto_replanner({
        sdk,
        sync,
        modelKey: mk,
        rootSession: sid,
        finalA2UIJson: mergedA2UI,
        onSessionCreated: (childID: string) => { replannerSessionId = childID },
      })
      planner = result as unknown as Record<string, unknown>
    } catch (err) {
      console.error("[PatternPage] proto_replanner failed", err)
      if (err instanceof Error && err.message === "aborted") return
      const error = classifyAIError(err)
      showToast({ title: error.title || "重新生成失败" })
      return
    } finally {
      if (replannerSessionId) await sdk.client.session.delete({ sessionID: replannerSessionId }).catch(() => {})
    }

    await download({ planner, mergedA2UI, sessionId: sid })
  }

  // 分享 — 打包 intent / planner / modules / preview JSON 为 ZIP
  async function handleShare() {
    tracker.interaction({ module: "prototype", name: "share-result" })
    await exportZip({historyDir: patternHistoryDir(), sessionId: params.id ?? "", title: sessionInfo()?.title ?? params.id ?? "export" })
  }

  // 画布编辑  跳转pixso
  function handleCanvasEditing() {
    console.log('跳转pixso')
  }

  // 实时预览
  async function handleLivePreview() {
    const sid = params.id
    if (!sid) return
    tracker.interaction({ module: "prototype", name: "live-preview" })
    await livePreview(pendingPreviewData()[sid] ?? null)
  }

  // Pixso预览
  async function handlePixsoPreview() {
    const sid = params.id
    if (!sid) return
    tracker.interaction({ module: "prototype", name: "pixso-preview" })
    await pixsoPreview(pendingPreviewData()[sid] ?? null)
  }

  // 页面捕获转 HTML
  async function handleCodeToHtml() {
    const sid = params.id
    if (!sid) return
    tracker.interaction({ module: "prototype", name: "code-to-html" })
    await codeToHtmlHandler(pendingPreviewData()[sid] ?? null)
  }

  const inputDisabled = () => {
    const sid = params.id
    return (sid ? sending() || isBusy() : false) || !activeModelKey() || (sid ? intentConfirm()[sid] != null : false)
  }

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
    designSystemLocked: hasContent(),
    model: local.model,
    onModelClose: (cause: string) => {
      if (cause === "select") {
        const m = currentModel()
        if (m) {
          tracker.interaction({ module: "prototype", name: "select-model", extend: JSON.stringify({ modelId: m.id, provider: m.provider.id }) })
        }
      }
    },
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
            pipelineBusy={pipelineBusy()}
            roundMessages={roundMessages()}
            needsConfirm={needsConfirm()}
            confirmText={confirmText()}
            pauseMs={pauseMs()[params.id!] ?? 0}
            pauseStartedAt={pauseStart()[params.id!]}
            onDeleteSession={deleteSession}
            onTitleChanged={(title) => mutateSession(prev => prev ? { ...prev, title } : prev)}
            onRetry={handleRetry}
            pageMatches={intentConfirm()[params.id!] ?? null}
            blockMatches={blockMatches()[params.id!] ?? []}
            blockMatching={blockMatching()[params.id!] ?? false}
            blockMatchError={blockMatchError()[params.id!] ?? false}
            initialStep={cardInitialStep()}
            onMatchPattern={handleMatchPatternInCard}
            onConfirmIntent={handleConfirmIntent}
          />
        </Show>

        <Show when={hasContent() && !focusMode()}>
          <div class="octo-split-handle" onMouseDown={onDividerMouseDown} />
        </Show>

        {/* 预览页 */}
        <Show when={hasContent()}>
          <div style={{ position: "relative", overflow: "hidden" }}>
            <Show when={intentConfirm()[params.id!] ?? null} fallback={
              <Show when={!!isGeneratingReview()[params.id!]} fallback={
                <Show when={!!hasPreviewContent()[params.id!]} fallback={<PatternPreviewEmpty />}>
                  <PreviewPage
                    api={previewApi}
                    pendingData={pendingPreviewData()[params.id!] ?? null}
                    sessionId={params.id}
                    dir={sdk.directory}
                    onModifyElement={handleModifyElement}
                    onPickerSubmit={handlePickerSubmit}
                    onPickerAppend={handlePickerAppend}
                    onDownload={handleDownload}
                    onShare={handleShare}
                    onCanvasEditing={handleCanvasEditing}
                    onReorder={handleReorder}
                    onLivePreview={handleLivePreview}
                    onPixsoPreview={handlePixsoPreview}
                    onCodeToHtml={handleCodeToHtml}
                    versions={versions()[params.id!] ?? []}
                    currentVersionId={currentVersionId()[params.id!] ?? null}
                    onSelectVersion={(vid) => { void handleSelectVersion(vid) }}
                    archiving={archive.archiving()}
                    onArchiveToggle={archive.toggleArchiving}
                  />
                </Show>
              }>
                <PatternGenerating />
              </Show>
            }>
              <PatternPreviewEmpty />
            </Show>
            <Show when={!!isModifying()[params.id!]}>
              <div class="change-content">
                <img src={resultEmptySvg} width={80} height={80} alt="" draggable={false} style={{ "flex-shrink": "0" }} />
                <div class="text-[13px]" style={{ color: "var(--octo-text-secondary, rgba(0,0,0,0.6))" }}>正在修改页面中...</div>
              </div>
            </Show>
          </div>
        </Show>
        {/* 归档弹窗:选择空间/产品/版本/文件夹后上传 ZIP 到交付物系统 */}
        <Show when={archive.archiving()}>
          <ArchiveDialog
            open={archive.archiving()}
            onClose={archive.closeArchive}
            onResetArchiving={archive.closeArchive}
            onConfirm={archive.handleArchiveConfirm}
            sessionId={params.id ?? ""}
            filePath=""
            tabTitle={sessionInfo()?.title ?? params.id ?? "pattern"}
          />
        </Show>
        {/* 归档成功弹窗:展示归档路径,「跳转查看」打开交付物预览分享给开发(与 make 一致) */}
        <Show when={archive.archiveSuccessOpen()}>
          <DialogArchiveSuccess
            open={archive.archiveSuccessOpen()}
            onClose={archive.closeArchiveSuccess}
            archivePath={archive.archiveSuccessPath()}
            shareLink={archive.archiveSuccessUniqueId()
              ? `${getArchiveBaseUrl()}/developerPreview/designAgent/index.html?uniqueId=${archive.archiveSuccessUniqueId()}`
              : undefined}
            onViewClick={() => {
              const uniqueId = archive.archiveSuccessUniqueId()
              if (uniqueId) {
                const url = `${getArchiveBaseUrl()}/developerPreview/designAgent/index.html?uniqueId=${uniqueId}`
                getDesktopApi()?.openLink?.(url)
              }
            }}
          />
        </Show>
      </div>
    </DataProvider>
  )
}

