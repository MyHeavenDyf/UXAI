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
  onMount,
  Show,
  type JSX,
} from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { SDKProvider, useSDK } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"
import { LocalProvider, useLocal } from "@/context/local"
import { useLayout } from "@/context/layout"
import { useProjectDir } from "@/hooks/use-project-dir"
import { type Attachment } from "./modules/chat/attachment-bar"
import { create_intent_confirm, create_planner_json, create_modules_json, type ProtoCreateJsonInput } from './workflow/create-json'
import modify_json_ai from './workflow/modify-json-ai'
import { appendPatternVersion, updatePatternVersion, loadCurrentPatternState, listPatternVersions, type VersionEntry } from "./utils/version-history"
import { saveReviewCheckpoint, loadReviewCheckpoint, clearReviewCheckpoint } from "./utils/review-checkpoint"
import { logStartSession, clearDebugLog, saveDebugSnapshot } from "./utils/debug-log"
import { classifyAIError, saveProtoError, loadProtoError, clearProtoError } from "./utils/error-msg"
import { autoRenameSession } from "./utils/rename"
import { groupRounds } from "./utils/round-messages"
import { createSplitDrag } from "./utils/drag-split"
import { exportZip } from "./utils/preview-handler/zip"
import { handleModifyElement as runQuickModify, type QuickModifyContext, type ModifyElementData } from './workflow/modify-json-quick'
import { handleLivePreview as livePreview, handlePixsoPreview as pixsoPreview, handleDownload as download, handleSelectVersion as selectVersion } from "./utils/preview-handler"
import { PreviewPage, type PreviewPageAPI } from "./modules/preview/index"
import { WireframeReview, type WireframeReviewResult } from "./modules/preview/wireframe-review"
import { PatternMatchPage } from "./modules/preview/pattern-match-page"
import type { PatternMatchItem } from "./utils/pattern-resource"
import { readPatternFile } from "./utils/pattern-resource"
import { IntentConfirmReview, type IntentConfirmAnswers } from "./modules/preview/Intent-confirm-review"
import { PatternGenerating }  from "./modules/preview/pattern-generating"
import type { IntentConfirmResult } from "./agents/proto-intent-confirm"
import { ChatPanel } from "./modules/chat/index"
import resultEmptySvg from "./assets/images/IllustrationResultEmpty.svg?url"
import { PatternPreviewEmpty } from "./modules/preview/pattern-preview-empty"
import { saveIntentConfirmCheckpoint, loadIntentConfirmCheckpoint, clearIntentConfirmCheckpoint } from "./utils/intent-checkpoint"
import { saveTheme, loadTheme } from "./utils/theme"
import { tracker } from "@/utils/tracker"
import { truncateSync } from "fs"
import { createReorderHandler } from "./utils/reorder"

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
          setUserInput("")
        }

        // ── 2. 无条件同步重置 ──
        setChildSessionIDs([])
        setSessionSynced(false)
        discoverVersion++
        setPendingPreviewData(null)
        previewApi.sendToPreview(null)
        lastSentPreviewJson = ""
        setIsPlanReview(false)
        setShowPatternMatch(false)
        setIntentConfirm(null)

        // ── 3. 进入新 session：追踪 + 清空 + 异步加载 ──
        if (id) {
          layout.lastSessionPerTab.setPattern(id)
          setLastIntent(null)
          setLastPlanner(null)
          setLastModules([])
          setPatternMatches([])
          setVersions([])
          setCurrentVersionId(null)
          setHasPreviewContent(false)
          setIsModifying(false)
          setIsPlanReview(false)
          setShowPatternMatch(false)

          // 同步子 session 消息，全部加载完成后才标记 synced
          void sync.session.sync(id).then(async () => {
            if (params.id !== id) return
            await discoverChildSessions(id)
            if (params.id !== id) return
            setSessionSynced(true)
            // 加载持久化的 workflow 错误
            const errDir = patternHistoryDir()
            if (errDir) {
              void loadProtoError(errDir, id).then((errTitle) => {
                if (errTitle && params.id === id) setSessionErrors((prev) => ({ ...prev, [id]: errTitle }))
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
              // 读取该会话持久化的设计系统主题
              const savedTheme = await loadTheme(dir, id)
              if (params.id !== id) return
              setSelectedDesignSystem(savedTheme ?? "ICT3.1")
              // 意图确认数据读取
              const checkpoint = await loadIntentConfirmCheckpoint(dir, id)
              if (params.id !== id) return
              if (checkpoint) {
                setUserInput(checkpoint.userInput)
                setIntentConfirm({ options: checkpoint.options, current_step: "intent_confirm" })
                return
              }
              // 线框审查数据读取
              const reviewCkpt = await loadReviewCheckpoint(dir, id)
              if (params.id !== id) return
              if (reviewCkpt) {
                setLastPlanner(reviewCkpt.planner)
                setLastIntent(reviewCkpt.intentDescription)
                const matches= reviewCkpt.pattern
                setPatternMatches(matches)
                setUserInput(reviewCkpt.userInput)
                if (matches?.length > 0) {
                  setShowPatternMatch(true)
                } else {
                  setIsPlanReview(true)
                }
                return
              }
              // 已完成状态数据读取
              const state = await loadCurrentPatternState(dir, id)
              if (!state || params.id !== id) return
              if (state.lastIntent) setLastIntent(state.lastIntent)
              if (state.lastPlanner) setLastPlanner(state.lastPlanner)
              if (state.lastModules.length > 0) {
                setLastModules(state.lastModules)
                const a2uiJSON = state.mergedA2UI
                if (a2uiJSON) sendToPreview(a2uiJSON)
              }
            }()
            // 版本列表独立并行加载
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

  const [sessionErrors, setSessionErrors] = createSignal<Record<string, string>>({})

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
    const error = sessionErrors()[id]
    if (error && rounds.length > 0) {
      rounds[rounds.length - 1] = { ...rounds[rounds.length - 1], error }
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
  const [lastIntent, setLastIntent] = createSignal<Record<string, unknown> | null>(null)
  const [lastPlanner, setLastPlanner] = createSignal<Record<string, unknown> | null>(null)
  const [lastModules, setLastModules] = createSignal<Array<Record<string, unknown>>>([])
  const [versions, setVersions] = createSignal<VersionEntry[]>([])
  const [currentVersionId, setCurrentVersionId] = createSignal<string | null>(null)
  const [hasPreviewContent, setHasPreviewContent] = createSignal(false)
  const [pendingPreviewData, setPendingPreviewData] = createSignal<unknown>(null)
  const [isModifying, setIsModifying] = createSignal(false)

  // 用户原始输入（意图确认 / 线框审查阶段复用）
  const [userInput, setUserInput] = createSignal<string>("")
  // 是否处于线框审查阶段
  const [isPlanReview, setIsPlanReview] = createSignal(false)
  // 是否正在生成（意图确认后 → pattern匹配之间）
  const [isGenerating, setIsGenerating] = createSignal(false)
  // 是否正在生成模块（线框审查确认后 → 预览之间）
  const [isGeneratingReview, setIsGeneratingReview] = createSignal(false)
  // 页面级 Pattern 匹配结果
  const [patternMatches, setPatternMatches] = createSignal<import("./utils/pattern-resource").PatternMatchItem[]>([])
  // 是否展示 Pattern 匹配结果页
  const [showPatternMatch, setShowPatternMatch] = createSignal(false)
  // 意图确认阶段：null = 未激活，非 null = 带选项结果
  const [intentConfirm, setIntentConfirm] = createSignal<IntentConfirmResult | null>(null)

  const needsConfirm = createMemo(() => intentConfirm() !== null || isPlanReview() || showPatternMatch())

  const confirmText = createMemo<{ title: string; subtitle: string } | null>(() => {
    if (intentConfirm()) return { title: "意图分析完成", subtitle: "请在右侧进一步确认需求" }
    if (isPlanReview() || showPatternMatch()) return { title: "线框审查", subtitle: "请在右侧进一步确认需求" }
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
  function handlePickerSubmit(text: string, domPickerId: string) {
    setPrompt(`[选中元素: ${domPickerId}] ${text}`)
    void handleSubmit()
  }

  const handleReorder = createReorderHandler({
    getPendingData: pendingPreviewData,
    sendToPreview,
    getSessionId: () => params.id,
    getHistoryDir: () => patternHistoryDir(),
    getLastIntent: lastIntent,
    getLastPlanner: lastPlanner,
    getLastModules: lastModules,
    setVersions,
    setCurrentVersionId,
  })

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
      tracker.interaction({ module: "prototype", name: "modify-element" })
      await runQuickModify(quickModifyCtx, data)
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "aborted") return
      console.error("[PatternPage] handleModifyElement failed", err)
      const error = classifyAIError(err)
      if (error.title) {
        const sid = params.id
        if (sid) setSessionErrors((prev) => ({ ...prev, [sid]: error.title }))
        showToast({ title: error.title, description: error.description })
      }
    }
  }

  async function handleWorkflowError(err: unknown, sessionId: string, label: string) {
    console.error(`[PatternPage] ${label} failed`, err)
    void saveDebugSnapshot(patternHistoryDir(), sessionId, "error", { error: String(err instanceof Error ? err.message : err) })
    for (const childID of childSessionIDs()) {
      await sdk.client.session.abort({ sessionID: childID }).catch(() => { })
    }
    const error = classifyAIError(err)
    if (error.title) {
      setSessionErrors((prev) => ({ ...prev, [sessionId]: error.title }))
      showToast({ title: error.title, description: error.description })
      const errDir = patternHistoryDir()
      if (errDir) void saveProtoError(errDir, sessionId, error.title)
    }
  }

  const { chatWidth, focusMode, setFocusMode, onDividerMouseDown } = createSplitDrag()

  const autoScroll = createAutoScroll({ working: isBusy })

  const previewApi: PreviewPageAPI = { sendToPreview: () => { }, postMessage: () => { }, refresh: () => { }, setEditingOff: () => { } }

  let lastSentPreviewJson = ""
  function sendToPreview(data: unknown) {
    const json = typeof data === "string" ? data : JSON.stringify(data)
    if (json === lastSentPreviewJson) return
    lastSentPreviewJson = json
    setPendingPreviewData(data)
    previewApi.sendToPreview(data)
    setHasPreviewContent(true)
  }

  // 从 Pattern 匹配页进入线框审查
  function handleEnterWireframe() {
    setShowPatternMatch(false)
    setIsPlanReview(true)
  }

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
            void saveDebugSnapshot(dir, sid!, "modules", {
              lastIntent: pageIntent,
              lastPlanner: layoutPlanner,
              lastModules: modulesJson,
              mergedA2UI: pageJson as unknown as Record<string, unknown>,
              summary: text.slice(0, 80),
            })
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
        tracker.interaction({ module: "prototype", name: "modify-page" })
        const modifyResult = await modify_json_ai(intentCtx, lastData, onFinshed);
        if (params.id !== sid) return
        setIsModifying(false)
        if ((modifyResult as any)?.reply) {
          showToast({ title: (modifyResult as any).reply })
        }
      }else{
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
        const confirmResult = await create_intent_confirm(intentCtx)
        void saveDebugSnapshot(patternHistoryDir(), sid!, "intent_confirm")
        if (Object.keys(confirmResult.options).length > 0) {
          setUserInput(text)
          setIntentConfirm(confirmResult)
          const confirmDir = patternHistoryDir()
          if (confirmDir) {
            await saveIntentConfirmCheckpoint(confirmDir, sid!, {
              options: confirmResult.options,
              userInput: text,
              rootSessionId: sid!,
              createdAt: Date.now(),
            })
          }
          return
        }


        const new_planner = await create_planner_json(intentCtx)
        void saveDebugSnapshot(patternHistoryDir(), sid!, "planner")
        // 保存部分版本（intent + planner），模块生成完成后追加补全
        const partialDir = patternHistoryDir()
        if (partialDir) {
          const vid = await appendPatternVersion(partialDir, sid!, {
            lastIntent: new_planner.intent.intent_description,
            lastPlanner: new_planner.planner.layout_planner,
            lastModules: [],
          }, text.slice(0, 80))
          if (params.id === sid) {
            setVersions((prev) => [...prev, { id: vid, createdAt: Date.now(), summary: text.slice(0, 80) }])
            setCurrentVersionId(vid)
          }
        }
        // 持久化线框审查检查点
        const userDir = patternHistoryDir()
        if (userDir) {
          await saveReviewCheckpoint(userDir, sid, {
            pattern: new_planner.patternPageResult.matches,
            planner: new_planner.planner.layout_planner,
            intentDescription: new_planner.intent.intent_description,
            userInput: text,
            rootSessionId: sid,
            createdAt: Date.now(),
          })
        }

        // 展示 Pattern 匹配结果页
        if (params.id !== sid) return
        setLastPlanner(new_planner.planner.layout_planner)
        setLastIntent(new_planner.intent.intent_description)
        const matches = new_planner.patternPageResult.matches
        setPatternMatches(matches)
        setUserInput(text)
        if (matches?.length > 0) {
          setShowPatternMatch(true)
        } else {
          setIsPlanReview(true)
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "aborted") return
      await handleWorkflowError(err, sid!, "handleSubmit")
      setIsModifying(false)
    } finally {
      setSendingSids((prev) => {
        if (!prev.has(sid!)) return prev
        const next = new Set(prev)
        next.delete(sid!)
        return next
      })
    }
  }

  // 用户点击「选择当前模板」时，加载 pattern 文件内容并触发渲染
  async function handleSelectTemplate(match: PatternMatchItem) {
    const sid = params.id
    if (!sid) return
    const ds = selectedDesignSystem()
    const content = await readPatternFile("page", match.pattern.path, ds)
    if (!content) return
    const { lastIntent, lastPlanner, lastModules, mergedA2UI } = JSON.parse(content)

    setShowPatternMatch(false)

    const dir = patternHistoryDir()
    if (dir) {
      await clearReviewCheckpoint(dir, sid)
      await updatePatternVersion(dir, sid, {
        lastModules,
        mergedA2UI,
      })
      void saveDebugSnapshot(dir, sid, "template", {
        lastIntent,
        lastPlanner,
        lastModules,
        mergedA2UI,
        summary: userInput().slice(0, 80),
      })
      clearDebugLog()
    }

    if (params.id !== sid) return
    sendToPreview(mergedA2UI)
    setLastIntent(lastIntent)
    setLastPlanner(lastPlanner)
    setLastModules(lastModules)
  }

  // 线框审查确认后，继续执行阶段 2：模块生成
  async function handleConfirmReview(result: WireframeReviewResult) {
    const sid = params.id
    if (!sid) return
    const mk = activeModelKey()
    if (!mk) return

    const planner = lastPlanner()
    if (!planner) return

    const text = userInput()
    // 把设计师编辑后的意图合并回 lastIntent
    setLastIntent(result.intentDescription)

    // 删除检查点（阶段 2 启动后不再需要回退到审查）
    const ckptDir = patternHistoryDir()
    if (ckptDir) await clearReviewCheckpoint(ckptDir, sid)

    tracker.interaction({ module: "prototype", name: "confirm-review" })

    setIsGeneratingReview(true)

    const ds = selectedDesignSystem()
    const intentCtx: ProtoCreateJsonInput = {
      sdk,
      sync,
      modelKey: mk,
      rootSession: sid,
      userInput: text,
      extra: ds ? { designSystem: ds } as Record<string, unknown> : undefined,
      onSessionCreated: (childID: string) => {
        if (params.id !== sid) return
        setChildSessionIDs((prev) => [...prev, childID])
      },
    }

    let onFinshed = async ({ pageIntent, layoutPlanner, modulesJson, pageJson }: any) => {
        // 历史保存始终执行（与当前查看的 session 无关）
          const dir = patternHistoryDir()
          if (dir) {
            await updatePatternVersion(dir, sid, {
                lastModules: modulesJson,
                mergedA2UI: pageJson as unknown as Record<string, unknown>,
            })
            void saveDebugSnapshot(dir, sid, "modules", {
              lastIntent: pageIntent,
              lastPlanner: layoutPlanner,
              lastModules: modulesJson,
              mergedA2UI: pageJson as unknown as Record<string, unknown>,
              summary: text.slice(0, 80),
            })
            clearDebugLog()
          }
        // 视图状态仅在仍在该 session 时更新
        if (params.id !== sid) return
        // 触发页面渲染
        if (pageJson) sendToPreview(pageJson)
        // 内存数据更新
        setLastIntent(pageIntent)
        setLastPlanner(layoutPlanner)
        setLastModules(modulesJson)
        // 切换到预览页
        setIsGeneratingReview(false)
        setIsPlanReview(false)
    }
    
    try {
      await create_modules_json(intentCtx, planner, result.intentDescription, onFinshed)
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "aborted") return
      setIsGeneratingReview(false)
      await handleWorkflowError(err, sid, "handleConfirmReview")
      setIsPlanReview(true)
    } finally {
      setIsGeneratingReview(false)
      setUserInput("")
    }
  }

  // 意图确认后，带着用户的补充继续执行pattern匹配和线框生成
  async function handleConfirmIntent(_answers: IntentConfirmAnswers, enrichedInput: string) {
    const sid = params.id
    if (!sid) return
    const mk = activeModelKey()
    if (!mk) return
    const text = userInput()
    const enrichedText = text + enrichedInput
    const ckptDir = patternHistoryDir()
    if (ckptDir) await clearIntentConfirmCheckpoint(ckptDir, sid)
    setSendingSids((prev) => new Set(prev).add(sid))
    setIsGenerating(true)
    try {
      const intentCtx: ProtoCreateJsonInput = {
        sdk,
        sync,
        modelKey: mk,
        rootSession: sid,
        userInput: enrichedText,
        extra: { designSystem: selectedDesignSystem() },
        onSessionCreated: (childID: string) => {
          setChildSessionIDs((prev) => [...prev, childID])
        },
      }
      const new_planner = await create_planner_json(intentCtx)
      void saveDebugSnapshot(patternHistoryDir(), sid!, "planner")
      // 保存部分版本（intent + planner），模块生成完成后追加补全
      const partialDir = patternHistoryDir()
      if (partialDir) {
        const vid = await appendPatternVersion(partialDir, sid!, {
          lastIntent: new_planner.intent.intent_description,
          lastPlanner: new_planner.planner.layout_planner,
          lastModules: [],
        }, enrichedText.slice(0, 80))
        if (params.id === sid) {
          setVersions((prev) => [...prev, { id: vid, createdAt: Date.now(), summary: enrichedText.slice(0, 80) }])
          setCurrentVersionId(vid)
        }
      }
      const userDir = patternHistoryDir()
      if (userDir) {
        await saveReviewCheckpoint(userDir, sid, {
          pattern: new_planner.patternPageResult.matches,
          planner: new_planner.planner.layout_planner,
          intentDescription: new_planner.intent.intent_description,
          userInput: enrichedText,
          rootSessionId: sid,
          createdAt: Date.now(),
        })
      }
      if (params.id !== sid) return
      setIntentConfirm(null)
      setLastPlanner(new_planner.planner.layout_planner)
      setLastIntent(new_planner.intent.intent_description)
      const matches = new_planner.patternPageResult.matches
      setPatternMatches(matches)
      setUserInput(enrichedText)
      if (matches?.length > 0) {
        setShowPatternMatch(true)
      } else {
        setIsPlanReview(true)
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "aborted") return
      await handleWorkflowError(err, sid!, "handleConfirmIntent")
    } finally {
      setIsGenerating(false)
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
    setSessionErrors((prev) => { const next = { ...prev }; delete next[sid]; return next })
    const haltDir = patternHistoryDir()
    if (haltDir) void clearProtoError(haltDir, sid)
  }

  // 监听对话框回车键
  function handleKeyDown(e: KeyboardEvent) {
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
      setCurrentVersionId,
      onStateRestored: (state) => {
        if (state.lastIntent) setLastIntent(state.lastIntent)
        if (state.lastPlanner) setLastPlanner(state.lastPlanner)
        if (state.lastModules.length > 0) setLastModules(state.lastModules)
      },
    })
  }

  // 下载页面代码
  async function handleDownload() {
    tracker.interaction({ module: "prototype", name: "download-result" })
    await download({ planner: lastPlanner(), mergedA2UI: pendingPreviewData() })
  }

  // 分享 — 打包 intent / planner / modules / preview JSON 为 ZIP
  async function handleShare() {
    tracker.interaction({ module: "prototype", name: "share-result" })
    await exportZip({historyDir: patternHistoryDir(), sessionId: params.id ?? "", title: sessionInfo()?.title ?? params.id ?? "export" })
  }

  // 实时预览
  async function handleLivePreview() {
    tracker.interaction({ module: "prototype", name: "live-preview" })
    await livePreview(pendingPreviewData())
  }

  // Pixso预览
  async function handlePixsoPreview() {
    tracker.interaction({ module: "prototype", name: "pixso-preview" })
    await pixsoPreview(pendingPreviewData())
  }

  const inputDisabled = () => sending() || isBusy() || !activeModelKey() || isPlanReview() || showPatternMatch() || intentConfirm() !== null

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
            onDeleteSession={deleteSession}
            onTitleChanged={(title) => mutateSession(prev => prev ? { ...prev, title } : prev)}
          />
        </Show>

        <Show when={hasContent() && !focusMode()}>
          <div class="octo-split-handle" onMouseDown={onDividerMouseDown} />
        </Show>

        {/* 预览页 */}
        <Show when={hasContent()}>
          <div style={{ position: "relative", overflow: "hidden" }}>
            <Show when={intentConfirm()} fallback={
              <Show when={showPatternMatch()} fallback={
                <Show when={isPlanReview()} fallback={
                  <Show when={hasPreviewContent()} fallback={<PatternPreviewEmpty />}>
                    <PreviewPage
                      api={previewApi}
                      pendingData={pendingPreviewData()}
                      sessionId={params.id}
                      onModifyElement={handleModifyElement}
                      onPickerSubmit={handlePickerSubmit}
                      onDownload={handleDownload}
                      onShare={handleShare}
                      onReorder={handleReorder}
                      onLivePreview={handleLivePreview}
                      onPixsoPreview={handlePixsoPreview}
                      versions={versions()}
                      currentVersionId={currentVersionId()}
                      onSelectVersion={(vid) => { void handleSelectVersion(vid) }}
                    />
                  </Show>
                }>
                  <Show when={lastPlanner() && lastIntent()} fallback={<PatternPreviewEmpty />}>
                    <div style={{ position: "relative", width: "100%", height: "100%" }}>
                      <WireframeReview
                        planner={lastPlanner()!}
                        intentDescription={lastIntent()!}
                        userInput={userInput()}
                        onConfirm={handleConfirmReview}
                      />
                      <Show when={isGeneratingReview()}>
                        <PatternGenerating />
                      </Show>
                    </div>
                  </Show>
                </Show>
              }>
                <PatternMatchPage
                  planner={lastPlanner() ?? {}}
                  intentDescription={lastIntent() ?? {}}
                  patternMatches={patternMatches()}
                  onEnterWireframe={handleEnterWireframe}
                  onSelectTemplate={handleSelectTemplate}
                />
              </Show>
            }>
              <div style={{ position: "relative", width: "100%", height: "100%" }}>
                <IntentConfirmReview
                  result={intentConfirm()!}
                  onConfirm={handleConfirmIntent}
                />
                <Show when={isGenerating()}>
                  <PatternGenerating />
                </Show>
              </div>
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

