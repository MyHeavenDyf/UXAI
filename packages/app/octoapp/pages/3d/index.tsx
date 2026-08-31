/**
 * 3D 页面（阶段2：对话 + Agent）
 *
 * 克隆 pattern 页面的对话流架构（Provider 链 + session-map 状态机 + 三阶段编排 +
 * 2 个暂停点 + checkpoint 持久化 + 轮次分组 + chat 面板），适配 3D 语义：
 *   - 渲染目标：A2UI Document → SceneConfig（发 SCENE_UPDATE 给 iframe）
 *   - 去掉 pattern 的 Pattern 模板匹配暂停点（3D 无模板库）
 *   - 去掉 design-system/picker/reorder/quick-modify（2D+DOM 专属）
 *
 * 对话触发链（详见 3D_PAGE_DESIGN.md §1.2 / 计划文件 C.3）：
 *   首次：create_intent_confirm → 暂停点1（意图确认）
 *         → create_planner_json → 暂停点3（场景规划审查）
 *         → create_modules_json → mergeSceneObjects → sendToPreview(SCENE_UPDATE)
 *   修改：modify_scene_ai（scene_triage → scene_planner_modify → module_* → merge）
 *
 * 通信协议（与 3d-templete embed.vue）：
 *   父→子 SCENE_UPDATE { payload: SceneConfig }
 *   子→父 SCENE_READY（握手）/ SCENE_ERROR
 */
import type { Message, Session, SessionStatus } from "@opencode-ai/sdk/v2/client"
import { DataProvider } from "@opencode-ai/ui/context/data"
import { createAutoScroll } from "@opencode-ai/ui/hooks"
import { showToast, Toast } from "@opencode-ai/ui/toast"
import { exportZip } from "./utils/preview-handler/zip"
import { exportProject } from "./utils/preview-handler/export-project"
import { getDesktopApi } from "./utils/desktop-api"
import { createEffect, createMemo, createResource, createSignal, on, onCleanup, onMount, Show, type JSX } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { SDKProvider, useSDK } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"
import { LocalProvider, useLocal } from "@/context/local"
import { useLayout } from "@/context/layout"
import { useProjectDir } from "@/hooks/use-project-dir"
import { useTabModel } from "@/hooks/use-tab-model"
import { type Attachment } from "./modules/chat/attachment-bar"
import {
  create_intent_confirm,
  create_planner_json,
  create_modules_json,
  type SceneCreateInput,
} from "./workflow/create-scene"
import modify_scene_ai from "./workflow/modify-scene-ai"
import { codegen_scene } from "./workflow/codegen-scene"
import {
  appendSceneVersion,
  updateSceneVersion,
  loadCurrentSceneState,
  listSceneVersions,
  rollbackToVersion,
  codeDirPath,
  type VersionEntry,
  type SceneSessionState,
} from "./utils/version-history"
import * as workspace from "./utils/workspace"
import {
  saveCheckpoint,
  saveSceneReviewCheckpoint,
  loadSceneReviewCheckpoint,
  clearSceneReviewCheckpoint,
  saveIntentConfirmCheckpoint,
  loadIntentConfirmCheckpoint,
  clearIntentConfirmCheckpoint,
  loadSceneCheckpoint,
  clearSceneCheckpoint,
  type SceneCheckpoint,
} from "./utils/scene-checkpoint"
import { logStartSession, clearDebugLog, saveDebugSnapshot } from "./utils/debug-log"
import { classifyAIError, saveProtoError, loadProtoError, clearProtoError, type ProtoError } from "./utils/error-msg"
import { runSceneGate, type GateFinding, type ConsoleEntry } from "./utils/scene-gate"
import type { PlanResult } from "./agents/scene-plan"
import { autoRenameSession } from "./utils/rename"
import { groupRounds } from "./utils/round-messages"
import type { SceneConfig } from "./utils/scene-config"
import type { ScenePlanner, SceneModuleResult } from "./agents/merge"
import { PreviewPage3D, type PreviewPageAPI } from "./modules/preview/index"
import { SceneWireframeReview, type SceneWireframeReviewResult } from "./modules/preview/SceneWireframeReview"
import { SceneGenerating } from "./modules/preview/SceneGenerating"
import type { IntentConfirmAnswers } from "./modules/chat/intent-confirm-card"
import type { IntentConfirmResult } from "./agents/scene-intent-confirm"
import type { PatternMatchItem } from "./utils/scene-resource"
import { ChatPanel } from "./modules/chat/index"
import scene_3d_triage from "./agents/scene-triage"
import { tracker } from "@/utils/tracker"
import * as sessionMap from "./utils/session-map"
import "./assets/style/pattern-tokens.css"

const AGENT_NAME = "scene_3d_triage"

// 3D 渲染引擎地址（dev=3d-templete vite 5173，prod=previewdist3d 51857，阶段3 部署时配 prod）
const PREVIEW_SRC = import.meta.env.VITE_3D_PREVIEW_URL ?? "http://127.0.0.1:5173/embed"

/** 空场景占位：会话无已保存场景（生成未完成/失败，或历史记录缺失）时显示，避免空白无 iframe 的困惑。 */
function SceneEmptyState(props: { error?: ProtoError }) {
  return (
    <div class="relative h-full w-full overflow-hidden bg-[#1a1a2e] flex flex-col items-center justify-center text-center px-6">
      <div class="text-white/50 text-base">此会话暂无 3D 场景</div>
      <div class="text-white/30 text-xs mt-2 max-w-[320px] leading-relaxed">
        {props.error
          ? `上次生成失败：${props.error.agentLabel ? props.error.agentLabel + " — " : ""}${props.error.title}。可在左侧重新输入需求生成。`
          : "场景生成未完成或未保存。可在左侧输入需求重新生成。"}
      </div>
    </div>
  )
}

export default function Scene3DPage() {
  const dir = useProjectDir()

  return (
    <Show when={dir()} keyed>
      {(directory) => (
        <SDKProvider directory={() => directory}>
          <SyncProvider>
            <LocalProvider>
              <Scene3DContent />
            </LocalProvider>
          </SyncProvider>
        </SDKProvider>
      )}
    </Show>
  )
}

function Scene3DContent() {
  const params = useParams<{ id?: string }>()
  const navigate = useNavigate()
  const sdk = useSDK()
  const sync = useSync()
  const layout = useLayout()
  const local = useLocal()
  useTabModel("3d")

  onMount(() => {
    tracker.page({ module: "scene3d", name: "scene3d-page" })
  })

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
      tracker.interaction({ module: "scene3d", name: "delete-session" })
      navigate("/3d")
    } catch (err) {
      showToast({ title: "删除失败", description: err instanceof Error ? err.message : String(err) })
    }
  }

  const [childSessionIDs, setChildSessionIDs] = createSignal<string[]>([])
  const [sessionSynced, setSessionSynced] = createSignal(false)
  let discoverVersion = 0

  // ── 全局 signal ──
  const [prompt, setPrompt] = createSignal("")
  const [sendingSids, setSendingSids] = createSignal<Set<string>>(new Set())
  const sending = () => !!params.id && sendingSids().has(params.id)
  const [attachments, setAttachments] = createSignal<Attachment[]>([])
  const [isDragOver, setIsDragOver] = createSignal(false)
  const [sessionErrors, setSessionErrors] = createSignal<Record<string, ProtoError>>({})
  // 9a 门控：iframe 运行时错误 buffer（gate 期间收集，供 runSceneGate 读）+ 上轮 findings（喂回重试）
  const [consoleBuffer, setConsoleBuffer] = createSignal<ConsoleEntry[]>([])
  const [lastGateFindings, setLastGateFindings] = createSignal<Record<string, GateFinding[]>>({})
  /** SCENE_READY resolver：gate 的 awaitSceneSettled 安装、onReady 触发 resolve（非 gate 期为 null） */
  let sceneReadyResolver: (() => void) | null = null
  const [pauseMs, setPauseMs] = createSignal<Record<string, number>>({})
  const [pauseStart, setPauseStart] = createSignal<Record<string, number | undefined>>({})

  // ── per-session 状态 Map（按 session ID 隔离）──
  const [lastIntent, setLastIntent] = sessionMap.createSessionMap<Record<string, unknown> | null>()
  const [lastPlanner, setLastPlanner] = sessionMap.createSessionMap<ScenePlanner | null>()
  const [lastSceneObjects, setLastSceneObjects] = sessionMap.createSessionMap<SceneModuleResult[]>()
  const [versions, setVersions] = sessionMap.createSessionMap<VersionEntry[]>()
  const [currentVersionId, setCurrentVersionId] = sessionMap.createSessionMap<string | null>()
  const [hasPreviewContent, setHasPreviewContent] = sessionMap.createSessionMap<boolean>()
  const [pendingPreviewData, setPendingPreviewData] = sessionMap.createSessionMap<SceneConfig | null>()
  const [isModifying, setIsModifying] = sessionMap.createSessionMap<boolean>()
  const [userInput, setUserInput] = sessionMap.createSessionMap<string>()
  const [isPlanReview, setIsPlanReview] = sessionMap.createSessionMap<boolean>()
  const [isGenerating, setIsGenerating] = sessionMap.createSessionMap<boolean>()
  const [isGeneratingReview, setIsGeneratingReview] = sessionMap.createSessionMap<boolean>()
  const [intentConfirm, setIntentConfirm] = sessionMap.createSessionMap<IntentConfirmResult | null>()
  const [blockMatches, setBlockMatches] = sessionMap.createSessionMap<PatternMatchItem[]>()
  const [blockMatching, setBlockMatching] = sessionMap.createSessionMap<boolean>()
  const [blockMatchError, setBlockMatchError] = sessionMap.createSessionMap<boolean>()
  const [cardInitialStep, setCardInitialStep] = createSignal<"dimensions" | "blocks" | undefined>()
  const [embedReady, setEmbedReady] = createSignal(false)

  // ── 3D workspace（Step 6）── 全局唯一 workspace dev server 活动标志 + iframe 强制重载 nonce
  const [workspaceActive, setWorkspaceActive] = createSignal(false)
  const [wsNonce, setWsNonce] = createSignal(0)
  /** materializePatch 的 wsNonce 兜底定时器：vite 未 full-reload 时硬重载 iframe（SCENE_READY 到达即 clearTimeout） */
  let patchReloadTimer: number | undefined
  // workspace 活动时预览指向 51857（workspace 副本 dev server），否则回退母版 5173（PREVIEW_SRC）。
  // wsNonce bump → previewSrc 字符串变 → iframe src 重设 → 强制重载（避免切版本时旧 bundle）。
  const previewSrc = createMemo(() =>
    workspaceActive() ? `http://127.0.0.1:${workspace.WORKSPACE_PORT}/embed?ws=${wsNonce()}` : PREVIEW_SRC,
  )

  // ── workspace 所有权（单例 workspace 并发互踩防护）──
  // 全局唯一 workspace 跨同 app 所有会话共享：一会话 switchVersion 会杀掉另一会话刚 ready 的 vite。
  // acquireWorkspace 显式标记 owner：接管方 toast 提醒；被接管方据 owner!==sid 显示「被接管」横幅。
  const [workspaceOwnerSid, setWorkspaceOwnerSid] = createSignal<string | null>(null)
  // owner=null（无人持有）或 owner=当前会话 → 视为「我方持有预览」；否则预览被另一会话接管。
  const isWorkspaceOwner = createMemo(() => {
    const owner = workspaceOwnerSid()
    return owner === null || owner === params.id
  })
  onMount(() => {
    // 初始化为当前 owner（可能已被别的会话持有）+ 订阅后续变化（被接管方实时更新横幅）
    setWorkspaceOwnerSid(workspace.workspaceOwner())
    workspace.onWorkspaceOwnerChange(setWorkspaceOwnerSid)
  })
  // 组件卸载：若当前 owner 是本会话则释放，避免锁残留挡其他会话
  onCleanup(() => {
    if (params.id) workspace.releaseWorkspace(params.id)
  })

  const needsConfirm = createMemo(() => {
    const id = params.id
    if (!id) return false
    if (!!isGenerating()[id] || !!isGeneratingReview()[id]) return false
    return intentConfirm()[id] != null || !!isPlanReview()[id]
  })

  const confirmText = createMemo<{ title: string; subtitle: string } | null>(() => {
    const id = params.id
    if (!id) return null
    if (intentConfirm()[id]) return { title: "意图分析完成", subtitle: "请在下方确认需求" }
    if (isPlanReview()[id]) return { title: "场景规划审查", subtitle: "请在右侧确认空间分区" }
    return null
  })

  // 历史文件存储目录：{directory}/.octo/design-3d/history
  const sceneHistoryDir = createMemo(() => `${sdk.directory}/.octo/design-3d/history`)

  function startPause(sid: string) {
    setPauseStart((prev) => (prev[sid] === undefined ? { ...prev, [sid]: Date.now() } : prev))
  }
  function endPause(sid: string) {
    setPauseStart((prev) => {
      const at = prev[sid]
      if (at === undefined) return prev
      const elapsed = Date.now() - at
      setPauseMs((p) => ({ ...p, [sid]: (p[sid] ?? 0) + elapsed }))
      return { ...prev, [sid]: undefined }
    })
  }

  // 预览通信：去重 + 推送到 iframe
  const previewApi: PreviewPageAPI = { sendToPreview: () => {} }
  const lastSentPreviewJson: Record<string, string> = {}
  function sendToPreview(data: SceneConfig | null) {
    const sid = params.id
    if (!sid) return
    // 诊断：打印推送的 payload 概要
    const objCount = Array.isArray((data as any)?.objects) ? (data as any).objects.length : 0
    const objIds = Array.isArray((data as any)?.objects) ? (data as any).objects.slice(0, 5).map((o: any) => o.id) : []
    console.log(
      `[3d] sendToPreview payload: objects=${objCount}, ids=${JSON.stringify(objIds)}, scene.bg=${(data as any)?.scene?.background}`,
    )
    const json = data === null ? "null" : JSON.stringify(data)
    if (json === lastSentPreviewJson[sid]) return
    lastSentPreviewJson[sid] = json
    sessionMap.set(setPendingPreviewData, sid, data)
    previewApi.sendToPreview(data)
    sessionMap.set(setHasPreviewContent, sid, data !== null)
  }

  // session 切换：清理 → 重置 → 异步加载 → 恢复
  createEffect(
    on(
      () => params.id,
      (id, prevId) => {
        if (prevId !== undefined && prevId) delete lastSentPreviewJson[prevId]
        setChildSessionIDs([])
        setSessionSynced(false)
        discoverVersion++
        previewApi.sendToPreview(null)

        if (id) {
          layout.lastSessionPerTab.setThreedimension(id)
          sessionMap.set(setLastSceneObjects, id, [])
          sessionMap.set(setVersions, id, [])
          sessionMap.set(setCurrentVersionId, id, null)
          sessionMap.set(setIsModifying, id, false)
          if (!isGeneratingReview()[id]) {
            sessionMap.set(setLastIntent, id, null)
            sessionMap.set(setLastPlanner, id, null)
            sessionMap.set(setHasPreviewContent, id, false)
            sessionMap.set(setIsPlanReview, id, false)
          }

          void sync.session.sync(id).then(async () => {
            if (params.id !== id) return
            await discoverChildSessions(id)
            if (params.id !== id) return
            setSessionSynced(true)
            const errDir = sceneHistoryDir()
            if (errDir) {
              void loadProtoError(errDir, id).then((protoErr) => {
                if (protoErr && params.id === id) setSessionErrors((prev) => ({ ...prev, [id]: protoErr }))
              })
            }
          })

          // 恢复持久化状态
          const dir = sceneHistoryDir()
          if (dir) {
            void (async () => {
              if (params.id !== id) return
              // 统一检查点恢复（优先 checkpoint.json，回退旧格式）
              const ckpt = await loadSceneCheckpoint(dir, id)
              if (params.id !== id) return
              if (ckpt) {
                if (ckpt.stage === "intent_confirm" && ckpt.options && Object.keys(ckpt.options).length > 0) {
                  console.log("[3d] 恢复分支: 命中【意图确认检查点】→ 显示意图确认，不挂 3D 预览")
                  sessionMap.set(setUserInput, id, ckpt.userInput)
                  sessionMap.set(setIntentConfirm, id, { options: ckpt.options, current_step: "intent_confirm" })
                  return
                }
                if (ckpt.stage === "planner_create" && ckpt.planner) {
                  console.log("[3d] 恢复分支: 命中【场景规划审查检查点】→ 显示规划审查，不挂 3D 预览")
                  sessionMap.set(setLastPlanner, id, ckpt.planner)
                  sessionMap.set(setLastIntent, id, ckpt.intentDescription ?? {})
                  sessionMap.set(setUserInput, id, ckpt.userInput)
                  sessionMap.set(setIsPlanReview, id, true)
                  return
                }
                // 其他 stage (intent_create/modules_create) = pipeline 中断，当作错误态
                console.log("[3d] 恢复分支: 命中【pipeline 中断检查点】stage=", ckpt.stage)
              }
              // 已完成状态
              const state = await loadCurrentSceneState(dir, id)
              console.log(
                "[3d] 恢复分支: 已完成态 loadCurrentSceneState =>",
                state
                  ? `lastSceneObjects=${state.lastSceneObjects?.length ?? 0}, hasMergedConfig=${!!state.mergedSceneConfig}`
                  : "null（无已保存状态）",
              )
              if (!state || params.id !== id) return
              if (state.lastIntent) sessionMap.set(setLastIntent, id, state.lastIntent as Record<string, unknown>)
              if (state.lastPlanner) sessionMap.set(setLastPlanner, id, state.lastPlanner)
              if ((state.lastSceneObjects ?? []).length > 0) {
                sessionMap.set(setLastSceneObjects, id, state.lastSceneObjects ?? [])
                const cfg = state.mergedSceneConfig as unknown
                if (cfg) {
                  console.log("[3d] 恢复分支: 推送 mergedSceneConfig 到预览")
                  sendToPreview(cfg as SceneConfig)
                } else {
                  console.log("[3d] 恢复分支: lastSceneObjects 非空但 mergedSceneConfig 缺失，未推送预览")
                }
              } else {
                console.log("[3d] 恢复分支: lastSceneObjects 为空，无 3D 内容可显示")
              }
              // Step 6：当前版本带 code 维度 → 恢复 workspace（re-materialize + 铺 code delta + 启 dev）
              if (state.codeDir) {
                acquireWorkspaceWithToast(id)
                void workspace
                  .switchVersion(sdk.directory, state.codeDir)
                  .then(() => {
                    if (params.id !== id) return
                    setWorkspaceActive(true)
                    setWsNonce((n) => n + 1)
                  })
                  .catch((err) => {
                    console.log("[3d] 恢复 workspace 失败:", err instanceof Error ? err.message : String(err))
                  })
              } else if (workspaceActive()) {
                // 切到无 code 维度的版本/会话：停 dev，回退母版 5173 预览
                void workspace.stopDev().then(() => {
                  if (params.id === id) setWorkspaceActive(false)
                })
              }
            })()
            void listSceneVersions(dir, id).then(({ versions: versionEntries, current }) => {
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
    const result: Message[] = rootMsgs.map((m) => ({ ...m }))
    for (const childID of childSessionIDs()) {
      const childMsgs = ((sync.data.message[childID] ?? []) as Message[]).filter((m) => m.role === "user")
      for (const m of childMsgs) result.push({ ...m })
    }
    return result.sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0))
  })

  const roundMessages = createMemo(() => {
    const id = params.id
    if (!id) return []
    const rounds = groupRounds(
      id,
      childSessionIDs(),
      (sid) => (sync.data.message[sid] ?? []) as Message[],
      (mid) => sync.data.part[mid] as Array<Record<string, unknown>> | undefined,
    )
    const protoErr = sessionErrors()[id]
    if (protoErr && rounds.length > 0) {
      rounds[rounds.length - 1] = {
        ...rounds[rounds.length - 1],
        error: protoErr.title,
        errorDescription: protoErr.description,
        errorAgent: protoErr.agentLabel,
        errorCallId: protoErr.agentCallId,
      }
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
    const rootMsgs = (sync.data.message[id] ?? []) as Message[]
    const lastRootAssistant = rootMsgs.findLast((m) => m.role === "assistant")
    if (!!lastRootAssistant && typeof lastRootAssistant.time.completed !== "number") return true
    for (const childID of childSessionIDs()) {
      const childMsgs = (sync.data.message[childID] ?? []) as Message[]
      const lastChildAssistant = childMsgs.findLast((m) => m.role === "assistant")
      if (!!lastChildAssistant && typeof lastChildAssistant.time.completed !== "number") return true
      const hasUser = childMsgs.some((m) => m.role === "user")
      if (hasUser && !lastChildAssistant) return true
    }
    return false
  })

  const pipelineBusy = createMemo(() => isBusy() || sending())
  const hasContent = () => !!(params.id && userMessages().length > 0)
  const sessionMessagesLoaded = () => !params.id || sessionSynced()
  const autoScroll = createAutoScroll({ working: isBusy })

  async function handleWorkflowError(err: unknown, sessionId: string, label: string) {
    console.error(`[Scene3D] ${label} failed`, err)
    void saveDebugSnapshot(sceneHistoryDir(), sessionId, "error", {
      error: String(err instanceof Error ? err.message : err),
    })
    for (const childID of childSessionIDs()) {
      await sdk.client.session.abort({ sessionID: childID }).catch(() => {})
    }
    const error = classifyAIError(err)
    if (error.title) {
      setSessionErrors((prev) => ({
        ...prev,
        [sessionId]: { title: error.title, description: error.description, agentLabel: error.agentLabel, agentCallId: error.agentCallId },
      }))
      showToast({ title: error.title, description: error.description })
      const errDir = sceneHistoryDir()
      if (errDir)
        void saveProtoError(errDir, sessionId, {
          title: error.title,
          description: error.description,
          agentLabel: error.agentLabel,
          agentCallId: error.agentCallId,
        })
    }
  }

  // 重试：从检查点恢复断点续传
  async function handleRetry() {
    const sid = params.id
    if (!sid) return
    const mk = activeModelKey()
    if (!mk) return
    const dir = sceneHistoryDir()
    if (!dir) return

    // 统一检查点：优先读 checkpoint.json，回退读旧格式
    const ckpt = await loadSceneCheckpoint(dir, sid)

    if (!ckpt) {
      // 检查是否有已保存的版本状态可恢复
      const state = await loadCurrentSceneState(dir, sid)
      if (!state) {
        showToast({ title: "无断点记录", description: "未找到可恢复的进度，请重新生成" })
        return
      }
    }

    // 9a codegen 重试分支：stage==="codegen" → 用原 userInput + lastGateFindings 喂回 codegen_scene
    if (ckpt?.stage === "codegen") {
      await retryCodegen(sid, ckpt.userInput)
      return
    }

    // 兼容：从统一检查点提取旧格式数据
    const intentCkpt =
      ckpt?.stage === "intent_confirm" && ckpt.options
        ? {
            options: ckpt.options,
            userInput: ckpt.userInput,
            rootSessionId: ckpt.rootSessionId,
            createdAt: ckpt.createdAt,
          }
        : null
    const reviewCkpt =
      ckpt?.stage === "planner_create" && ckpt.planner
        ? {
            planner: ckpt.planner,
            intentDescription: ckpt.intentDescription ?? {},
            userInput: ckpt.userInput,
            rootSessionId: ckpt.rootSessionId,
            createdAt: ckpt.createdAt,
          }
        : null

    setSessionErrors((prev) => {
      const n = { ...prev }
      delete n[sid]
      return n
    })
    await clearProtoError(dir, sid)
    setSendingSids((prev) => new Set(prev).add(sid))

    const intentCtx: SceneCreateInput = {
      sdk,
      sync,
      modelKey: mk,
      rootSession: sid,
      userInput: intentCkpt?.userInput ?? reviewCkpt?.userInput ?? "",
      onSessionCreated: (childID: string) => {
        if (params.id !== sid) return
        setChildSessionIDs((prev) => [...prev, childID])
      },
    }

    try {
      if (reviewCkpt) {
        // 场景规划审查阶段失败：重新从 planner 开始
        sessionMap.set(setIsGeneratingReview, sid, true)
        const planner = reviewCkpt.planner
        const intentDescription = reviewCkpt.intentDescription

        const onFinshed = async ({ sceneIntent, layoutPlanner, modulesJson, sceneConfig, skipped }: any) => {
          if (skipped?.length) {
            showToast({
              title: `${skipped.length} 个分区生成失败已跳过`,
              description: `可重新生成或继续对话补齐：${skipped.join("、")}`,
            })
          }
          const mergedObjects = (sceneConfig?.objects ?? []) as SceneModuleResult[]
          const finishedDir = sceneHistoryDir()
          if (finishedDir) {
            await updateSceneVersion(finishedDir, sid, {
              lastSceneObjects: mergedObjects,
              mergedSceneConfig: sceneConfig,
            })
            void saveDebugSnapshot(finishedDir, sid, "modules", {
              lastIntent: sceneIntent,
              lastPlanner: layoutPlanner as unknown as Record<string, unknown>,
              lastSceneObjects: mergedObjects,
              sceneConfig,
              summary: intentCtx.userInput.slice(0, 80),
            })
            clearDebugLog()
          }
          sessionMap.set(setLastIntent, sid, sceneIntent)
          sessionMap.set(setLastPlanner, sid, layoutPlanner)
          sessionMap.set(setLastSceneObjects, sid, mergedObjects)
          sessionMap.set(setIsGeneratingReview, sid, false)
          sessionMap.set(setIsPlanReview, sid, false)
          if (params.id === sid && sceneConfig) sendToPreview(sceneConfig as SceneConfig)
        }

        await clearSceneReviewCheckpoint(dir, sid)
        await create_modules_json(intentCtx, planner, intentDescription, onFinshed)
      } else if (intentCkpt) {
        // 意图确认阶段失败：重新跑意图确认
        const confirmResult = await create_intent_confirm(intentCtx)
        void saveDebugSnapshot(sceneHistoryDir(), sid, "intent_confirm")
        if (Object.keys(confirmResult.options).length > 0) {
          sessionMap.set(setUserInput, sid, intentCkpt.userInput)
          sessionMap.set(setIntentConfirm, sid, confirmResult)
          startPause(sid)
          const confirmDir = sceneHistoryDir()
          if (confirmDir) {
            await saveIntentConfirmCheckpoint(confirmDir, sid, {
              options: confirmResult.options,
              userInput: intentCkpt.userInput,
              rootSessionId: sid,
              createdAt: Date.now(),
            })
          }
          return
        }

        // 无需确认，继续走 planner 流程
        await clearIntentConfirmCheckpoint(dir, sid)
        if (!sendingSids().has(sid)) return
        const new_planner = await create_planner_json(intentCtx)
        sessionMap.set(setIsGenerating, sid, false)
        const partialDir = sceneHistoryDir()
        if (partialDir) {
          const vid = await appendSceneVersion(
            partialDir,
            sid,
            {
              lastIntent: new_planner.intent.intent_description,
              lastPlanner: new_planner.planner.layout_planner,
              lastSceneObjects: [],
            },
            intentCtx.userInput.slice(0, 80),
          )
          if (params.id === sid) {
            sessionMap.update(
              setVersions,
              sid,
              (prev) => [...prev, { id: vid, createdAt: Date.now(), summary: intentCtx.userInput.slice(0, 80) }],
              [],
            )
            sessionMap.set(setCurrentVersionId, sid, vid)
          }
        }
        const userDir = sceneHistoryDir()
        if (userDir) {
          await saveSceneReviewCheckpoint(userDir, sid, {
            planner: new_planner.planner.layout_planner,
            intentDescription: new_planner.intent.intent_description,
            userInput: intentCtx.userInput,
            rootSessionId: sid,
            createdAt: Date.now(),
          })
        }
        if (params.id !== sid) return
        sessionMap.set(setLastPlanner, sid, new_planner.planner.layout_planner)
        sessionMap.set(setLastIntent, sid, new_planner.intent.intent_description)
        sessionMap.set(setIsPlanReview, sid, true)
        startPause(sid)
      } else {
        // 有版本状态但无检查点：从 planner 重试
        sessionMap.set(setIsGenerating, sid, true)
        const new_planner = await create_planner_json(intentCtx)
        void saveDebugSnapshot(dir, sid, "planner")
        const partialDir = sceneHistoryDir()
        if (partialDir) {
          const vid = await appendSceneVersion(
            partialDir,
            sid,
            {
              lastIntent: new_planner.intent.intent_description,
              lastPlanner: new_planner.planner.layout_planner,
              lastSceneObjects: [],
            },
            intentCtx.userInput.slice(0, 80),
          )
          if (params.id === sid) {
            sessionMap.update(
              setVersions,
              sid,
              (prev) => [...prev, { id: vid, createdAt: Date.now(), summary: intentCtx.userInput.slice(0, 80) }],
              [],
            )
            sessionMap.set(setCurrentVersionId, sid, vid)
          }
        }

        if (params.id !== sid) return
        sessionMap.set(setLastPlanner, sid, new_planner.planner.layout_planner)
        sessionMap.set(setLastIntent, sid, new_planner.intent.intent_description)

        // 直接进入 modules_create
        sessionMap.set(setIsGeneratingReview, sid, true)
        const retryOnFinished = async ({ sceneIntent, layoutPlanner, modulesJson, sceneConfig, skipped }: any) => {
          if (skipped?.length) {
            showToast({
              title: `${skipped.length} 个分区生成失败已跳过`,
              description: `可重新生成或继续对话补齐：${skipped.join("、")}`,
            })
          }
          const mergedObjects = (sceneConfig?.objects ?? []) as SceneModuleResult[]
          const finishedDir = sceneHistoryDir()
          if (finishedDir) {
            await updateSceneVersion(finishedDir, sid, {
              lastSceneObjects: mergedObjects,
              mergedSceneConfig: sceneConfig,
            })
            clearDebugLog()
          }
          sessionMap.set(setLastIntent, sid, sceneIntent)
          sessionMap.set(setLastPlanner, sid, layoutPlanner)
          sessionMap.set(setLastSceneObjects, sid, mergedObjects)
          sessionMap.set(setIsGeneratingReview, sid, false)
          if (params.id === sid && sceneConfig) sendToPreview(sceneConfig as SceneConfig)
        }
        await create_modules_json(
          intentCtx,
          new_planner.planner.layout_planner,
          new_planner.intent.intent_description,
          retryOnFinished,
        )
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "aborted") return
      await handleWorkflowError(err, sid, "handleRetry")
    } finally {
      setSendingSids((prev) => {
        const n = new Set(prev)
        n.delete(sid)
        return n
      })
      sessionMap.set(setIsGenerating, sid, false)
      sessionMap.set(setIsGeneratingReview, sid, false)
    }
  }

  // ── 9a 门控：确定性结构健全性检查的 host 编排 ──
  /** 等 iframe SCENE_READY + 1s settle（捕获异步模型加载错），15s 超时 → scene-not-ready */
  function awaitSceneSettled(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        sceneReadyResolver = null
        reject(new Error("场景就绪超时（15s 未收到 SCENE_READY）"))
      }, 15000)
      sceneReadyResolver = () => {
        clearTimeout(timer)
        // settle 1s 再放行，捕获异步模型加载 console 错
        setTimeout(() => {
          sceneReadyResolver = null
          resolve()
        }, 1000)
      }
    })
  }

  /** codegen 成功物化预览后跑 9a 门控：失败写 sessionErrors+saveProtoError+stash findings；全过清 */
  async function runGateAndPersist(
    sid: string,
    plan: PlanResult,
    sceneData: Record<string, unknown> | null,
  ): Promise<void> {
    const dir = sceneHistoryDir()
    const sdkDir = sdk.directory
    if (!dir || !sdkDir) return
    setConsoleBuffer([])
    const gate = await runSceneGate({
      plan,
      sceneData,
      awaitSceneSettled,
      readConsoleBuffer: () => consoleBuffer(),
    })
    console.log("[3d] 9a 门控结果:", gate.passed ? "PASS" : "FAIL", gate.findings)
    if (gate.passed) {
      setLastGateFindings((prev) => {
        const n = { ...prev }
        delete n[sid]
        return n
      })
      await clearProtoError(dir, sid)
      await clearSceneCheckpoint(dir, sid)
    } else {
      const errs = gate.findings.filter((f) => f.level === "error")
      // title 直接用根因 message（去「9a 门控」内部代号 + code 代号，让用户看懂「为什么渲染不出来」）
      const title = errs.length > 0 ? errs.map((f) => f.message).join("；") : "场景渲染未通过"
      setSessionErrors((prev) => ({ ...prev, [sid]: { title, agentLabel: "场景渲染失败" } }))
      setLastGateFindings((prev) => ({ ...prev, [sid]: gate.findings }))
      await saveProtoError(dir, sid, { title, agentLabel: "场景渲染失败" })
    }
  }

  /** 9a 门控失败重试：从 codegen 检查点恢复原 userInput + 喂回 lastGateFindings 重跑 codegen_scene */
  async function retryCodegen(sid: string, userInput: string): Promise<void> {
    const mk = activeModelKey()
    if (!mk) return
    const priorGateFindings = lastGateFindings()[sid] ?? []
    setSessionErrors((prev) => {
      const n = { ...prev }
      delete n[sid]
      return n
    })
    const clearDir = sceneHistoryDir()
    if (clearDir) await clearProtoError(clearDir, sid)
    setSendingSids((prev) => new Set(prev).add(sid))

    const hasScene = (lastSceneObjects()[sid] ?? []).length > 0
    if (hasScene) sessionMap.set(setIsModifying, sid, true)
    const intentCtx: SceneCreateInput = {
      sdk,
      sync,
      modelKey: mk,
      rootSession: sid,
      userInput,
      onSessionCreated: (childID: string) => {
        if (params.id !== sid) return
        setChildSessionIDs((prev) => [...prev, childID])
      },
    }
    try {
      const codegenResult = await codegen_scene({
        ...intentCtx,
        hasScene,
        sceneDir: sceneHistoryDir(),
        sdkDir: sdk.directory,
        priorGateFindings,
        onCodeReady: async (files, sceneData, summary) => {
          await onCodeVersionReady(files, summary, sceneData)
        },
        onMaterialize: materializePatch,
      })
      if (params.id !== sid) return
      if (sid) sessionMap.set(setIsModifying, sid, false)
      if (codegenResult.error) {
        setSessionErrors((prev) => ({
          ...prev,
          [sid]: { title: codegenResult.error!, agentLabel: "3D 代码生成" },
        }))
        const errDir = sceneHistoryDir()
        if (errDir) void saveProtoError(errDir, sid, { title: codegenResult.error!, agentLabel: "3D 代码生成" })
      } else if (codegenResult.routing === "chat" && codegenResult.reply) {
        showToast({ title: codegenResult.reply })
      } else if (codegenResult.routing === "patch") {
        // patch 已在 codegen_scene 内轻量物化（无 plan / 无 9a 门控）
        showToast({ title: codegenResult.summary ?? "已应用 patch" })
      } else if (codegenResult.plan) {
        await runGateAndPersist(sid, codegenResult.plan, codegenResult.sceneData ?? null)
      }
    } catch (err) {
      if (err instanceof Error && err.message === "aborted") return
      await handleWorkflowError(err, sid, "retryCodegen")
    } finally {
      setSendingSids((prev) => {
        const n = new Set(prev)
        n.delete(sid)
        return n
      })
      if (sid) sessionMap.set(setIsModifying, sid, false)
    }
  }

  // ── 核心提交链 ──
  async function handleSubmit() {
    const text = prompt().trim()
    if (!text || sending() || !activeModelKey()) return
    console.log("[Scene3D] 开始生成场景:", text)
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
        tracker.interaction({ module: "scene3d", name: "new-session" })
        navigate(`/3d/${session.id}`)
        sid = session.id
      }
      setSendingSids((prev) => new Set(prev).add(sid!))
      setSessionErrors((prev) => {
        if (!prev[sid!]) return prev
        const next = { ...prev }
        delete next[sid!]
        return next
      })
      const startDir = sceneHistoryDir()
      if (startDir) {
        void clearProtoError(startDir, sid!)
        void clearIntentConfirmCheckpoint(startDir, sid!)
        void clearSceneReviewCheckpoint(startDir, sid!)
      }

      const intentCtx: SceneCreateInput = {
        sdk,
        sync,
        modelKey: mk,
        rootSession: sid,
        userInput: text,
        onSessionCreated: (childID: string) => {
          if (params.id !== sid) return
          setChildSessionIDs((prev) => [...prev, childID])
        },
        fileParts:
          attachments().length > 0
            ? attachments().map((a) => ({ type: "file" as const, mime: a.mime, filename: a.filename, url: a.dataUrl }))
            : undefined,
      }

      setAttachments([])
      logStartSession(sid, text)

      // 3-agent codegen 流（Step 7）：triage→plan→codegen→onCodeVersionReady 物化+预览。
      // 替换旧 8-agent JSON 流水线（intent_confirm / 线框审查 暂停点全砍，代码先行）。
      // chat 路由在 codegen_scene 内判定（triage），返回 reply 由此处 toast 展示，不进 plan/codegen。
      const hasScene = (sid ? (lastSceneObjects()[sid] ?? []).length : 0) > 0
      if (!sendingSids().has(sid!)) return
      if (hasScene) sessionMap.set(setIsModifying, sid, true)
      tracker.interaction({ module: "scene3d", name: hasScene ? "modify-scene" : "create-scene" })

      // 首次创建自动重命名会话（modify 不重命名）
      if (!hasScene) {
        void autoRenameSession({
          sync,
          client: sdk.client,
          directory: sdk.directory,
          targetSessionID: sid!,
          userText: text,
          modelKey: mk,
        })
          .then((title) => {
            if (title) mutateSession((prev) => (prev ? { ...prev, title } : prev))
          })
          .catch(() => {})
      }

      // 9a：保存 codegen 检查点（供门控失败后重试喂回 priorGateFindings）
      const ckptDir = sceneHistoryDir()
      if (ckptDir) {
        void saveCheckpoint(ckptDir, sid!, {
          stage: "codegen",
          userInput: text,
          rootSessionId: sid!,
          createdAt: Date.now(),
        })
      }
      const codegenResult = await codegen_scene({
        ...intentCtx,
        hasScene,
        sceneDir: sceneHistoryDir(),
        sdkDir: sdk.directory,
        onCodeReady: async (files, sceneData, summary) => {
          await onCodeVersionReady(files, summary, sceneData)
        },
        onMaterialize: materializePatch,
      })
      if (params.id !== sid) return
      if (sid) sessionMap.set(setIsModifying, sid, false)
      // codegen 失败（API 错误 / 限流 / 解析空 / LLM 未产代码块）→ 写进 sessionErrors + saveProtoError，
      // 由 roundMessages → GenerationCard 持久显示失败卡片（带重试），扛 reload，不靠会消失的 toast。
      if (codegenResult.error) {
        setSessionErrors((prev) => ({
          ...prev,
          [sid!]: { title: codegenResult.error!, agentLabel: "3D 代码生成" },
        }))
        const errDir = sceneHistoryDir()
        if (errDir) void saveProtoError(errDir, sid!, { title: codegenResult.error!, agentLabel: "3D 代码生成" })
      } else if (codegenResult.routing === "chat" && codegenResult.reply) {
        showToast({ title: codegenResult.reply })
      } else if (codegenResult.routing === "patch") {
        // patch 已在 codegen_scene 内轻量物化（无 plan / 无 9a 门控）
        showToast({ title: codegenResult.summary ?? "已应用 patch" })
      } else if (codegenResult.plan) {
        // 9a 门控：codegen 成功物化预览后跑确定性门控（完整性 + vue-tsc + 运行时 console）
        await runGateAndPersist(sid!, codegenResult.plan, codegenResult.sceneData ?? null)
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "aborted") return
      await handleWorkflowError(err, sid!, "handleSubmit")
      if (sid) sessionMap.set(setIsModifying, sid, false)
    } finally {
      setSendingSids((prev) => {
        if (!prev.has(sid!)) return prev
        const next = new Set(prev)
        next.delete(sid!)
        return next
      })
    }
  }

  // 场景规划审查确认后 → 阶段3：并行生成各分区物体 + 合并
  async function handleConfirmReview(result: SceneWireframeReviewResult) {
    const sid = params.id
    if (!sid) return
    const mk = activeModelKey()
    if (!mk) return
    const planner = lastPlanner()[sid]
    if (!planner) return
    const text = userInput()[sid] ?? ""
    sessionMap.set(setLastIntent, sid, result.intentDescription)

    const ckptDir = sceneHistoryDir()
    if (ckptDir) await clearSceneReviewCheckpoint(ckptDir, sid)
    tracker.interaction({ module: "scene3d", name: "confirm-review" })
    endPause(sid)
    sessionMap.set(setIsGeneratingReview, sid, true)

    const intentCtx: SceneCreateInput = {
      sdk,
      sync,
      modelKey: mk,
      rootSession: sid,
      userInput: text,
      onSessionCreated: (childID: string) => {
        if (params.id !== sid) return
        setChildSessionIDs((prev) => [...prev, childID])
      },
    }

    const onFinshed = async ({ sceneIntent, layoutPlanner, modulesJson, sceneConfig, skipped }: any) => {
      if (skipped?.length) {
        showToast({
          title: `${skipped.length} 个分区生成失败已跳过`,
          description: `可重新生成或继续对话补齐：${skipped.join("、")}`,
        })
      }
      const mergedObjects = (sceneConfig?.objects ?? []) as SceneModuleResult[]
      const dir = sceneHistoryDir()
      if (dir) {
        await updateSceneVersion(dir, sid, {
          lastSceneObjects: mergedObjects,
          mergedSceneConfig: sceneConfig,
        })
        void saveDebugSnapshot(dir, sid, "modules", {
          lastIntent: sceneIntent,
          lastPlanner: layoutPlanner as unknown as Record<string, unknown>,
          lastSceneObjects: mergedObjects,
          sceneConfig,
          summary: text.slice(0, 80),
        })
        clearDebugLog()
      }
      sessionMap.set(setLastIntent, sid, sceneIntent)
      sessionMap.set(setLastPlanner, sid, layoutPlanner)
      sessionMap.set(setLastSceneObjects, sid, mergedObjects)
      sessionMap.set(setIsGeneratingReview, sid, false)
      sessionMap.set(setIsPlanReview, sid, false)
      if (params.id === sid && sceneConfig) sendToPreview(sceneConfig as SceneConfig)
    }

    try {
      await create_modules_json(intentCtx, planner, result.intentDescription as Record<string, unknown>, onFinshed)
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "aborted") return
      sessionMap.set(setIsGeneratingReview, sid, false)
      await handleWorkflowError(err, sid, "handleConfirmReview")
      sessionMap.set(setIsPlanReview, sid, true)
    } finally {
      sessionMap.set(setIsGeneratingReview, sid, false)
      sessionMap.set(setUserInput, sid, "")
    }
  }

  // 3D 无模板库，IntentConfirmCard skipBlocks=true 不会调用此函数，但 ChatPanel prop 类型要求
  function handleMatchPatternInCard(_enrichedInput: string) {
    // no-op: 3D skips block matching entirely
  }

  // 意图确认后，带着用户补充继续阶段2
  async function handleConfirmIntent(
    _answers: IntentConfirmAnswers,
    enrichedInput: string,
    _selectedBlocks?: PatternMatchItem[],
  ) {
    const sid = params.id
    if (!sid) return
    const mk = activeModelKey()
    if (!mk) return
    const text = userInput()[sid] ?? ""
    const enrichedText = text + enrichedInput
    const ckptDir = sceneHistoryDir()
    if (ckptDir) await clearIntentConfirmCheckpoint(ckptDir, sid)
    setSendingSids((prev) => new Set(prev).add(sid))
    endPause(sid)
    sessionMap.set(setIsGenerating, sid, true)
    sessionMap.set(setIntentConfirm, sid, null)

    const intentCtx: SceneCreateInput = {
      sdk,
      sync,
      modelKey: mk,
      rootSession: sid,
      userInput: enrichedText,
      onSessionCreated: (childID: string) => {
        if (params.id !== sid) return
        setChildSessionIDs((prev) => [...prev, childID])
      },
    }

    try {
      const new_planner = await create_planner_json(intentCtx)
      sessionMap.set(setIsGenerating, sid, false)
      // 与 handleSubmit 首次创建路径一致：planner 完成后写一个 partial 版本（建立 _versions.json 的 current 指针）。
      // 否则后续 handleConfirmReview 的 updateSceneVersion 会因 index.current 为空而空操作 → 场景不落盘，
      // 表现为"首次生成能预览（内存 cfg），但切走再切回 loadCurrentSceneState 返回 null、场景丢失"。
      const partialDir = sceneHistoryDir()
      if (partialDir) {
        const vid = await appendSceneVersion(
          partialDir,
          sid,
          {
            lastIntent: new_planner.intent.intent_description,
            lastPlanner: new_planner.planner.layout_planner,
            lastSceneObjects: [],
          },
          text.slice(0, 80),
        )
        if (params.id === sid) {
          sessionMap.update(
            setVersions,
            sid,
            (prev) => [...prev, { id: vid, createdAt: Date.now(), summary: text.slice(0, 80) }],
            [],
          )
          sessionMap.set(setCurrentVersionId, sid, vid)
        }
      }
      const userDir = sceneHistoryDir()
      if (userDir) {
        await saveSceneReviewCheckpoint(userDir, sid, {
          planner: new_planner.planner.layout_planner,
          intentDescription: new_planner.intent.intent_description,
          userInput: text,
          rootSessionId: sid,
          createdAt: Date.now(),
        })
      }
      if (params.id !== sid) return
      sessionMap.set(setLastPlanner, sid, new_planner.planner.layout_planner)
      sessionMap.set(setLastIntent, sid, new_planner.intent.intent_description)
      sessionMap.set(setIsPlanReview, sid, true)
      startPause(sid)
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "aborted") return
      sessionMap.set(setIsGenerating, sid, false)
      await handleWorkflowError(err, sid, "handleConfirmIntent")
    } finally {
      setSendingSids((prev) => {
        if (!prev.has(sid)) return prev
        const next = new Set(prev)
        next.delete(sid)
        return next
      })
    }
  }

  function halt() {
    const sid = params.id
    if (!sid) return
    tracker.interaction({ module: "scene3d", name: "stop-generation" })
    // abort 根 session
    void sdk.client.session.abort({ sessionID: sid }).catch(() => {})
    // abort 所有正在运行的子 session
    for (const childID of childSessionIDs()) {
      void sdk.client.session.abort({ sessionID: childID }).catch(() => {})
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
    setSessionErrors((prev) => {
      const next = { ...prev }
      delete next[sid]
      return next
    })
    const haltDir = sceneHistoryDir()
    if (haltDir) {
      void clearProtoError(haltDir, sid)
      void clearIntentConfirmCheckpoint(haltDir, sid)
      void clearSceneReviewCheckpoint(haltDir, sid)
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    // 输入法合成期间(如拼音待选)的回车用于确认候选词,不应触发发送
    if (e.isComposing || e.keyCode === 229) return
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      void handleSubmit()
    }
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
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
    if (toAdd.length > 0) {
      tracker.interaction({
        module: "scene3d",
        name: "add-attachment",
        extend: JSON.stringify({ count: toAdd.length }),
      })
    }
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault()
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
  function handleFileInputChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement
    if (input.files?.length) {
      addAttachments(Array.from(input.files))
      input.value = ""
    }
  }

  const inputDisabled = () => {
    const sid = params.id
    return (
      (sid ? sending() || isBusy() : false) ||
      !activeModelKey() ||
      (sid ? !!isPlanReview()[sid] || intentConfirm()[sid] != null : false)
    )
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
    model: local.model,
    onModelClose: (_cause: string) => {},
    rows: undefined,
  })

  // ── 阶段 B：TitleBar 数据功能 handler ──

  /** 历史版本回退（Step 6：带 code 维度的版本额外走 workspace re-materialize + 重启 dev） */
  function handleSelectVersion(versionId: string): void {
    const sid = params.id
    if (!sid) return
    const dir = sceneHistoryDir()
    // 关编辑态
    previewApi.sendPickMode?.(false)
    // rollbackToVersion 内部 switchToVersion（切 current）+ 合并推送历史版本 SceneConfig，并返回 {state, codeDir}
    rollbackToVersion(dir, sid, versionId, (data) => {
      previewApi.sendToPreview(data as SceneConfig | null)
    }).then(async (result) => {
      if (!result || params.id !== sid) return
      setCurrentVersionId((prev) => ({ ...prev, [sid]: versionId }))
      // 同步 pendingPreviewData 为历史版本，后续操作基于此；workspace 重载后 iframe onLoad 推送
      const merged = result.mergedSceneConfig ?? null
      if (merged) setPendingPreviewData((prev) => ({ ...prev, [sid]: merged as unknown as SceneConfig }))
      // Step 6：版本带 code 维度 → workspace re-materialize + 铺 code delta + 重启 dev → bump nonce 强制 iframe 重载
      if (result.codeDir) {
        try {
          acquireWorkspaceWithToast(sid)
          await workspace.switchVersion(sdk.directory, result.codeDir)
          if (params.id !== sid) return
          setWorkspaceActive(true)
          setWsNonce((n) => n + 1)
        } catch (err) {
          showToast({ title: "切换工作空间失败", description: err instanceof Error ? err.message : String(err) })
        }
      }
    })
  }

  /**
   * 归档一个带 code 维度的版本 + 切 workspace 到该版本 + bump nonce 重载 iframe 预览。
   * - codegen 路径传 sceneData（分组 TreeScene）：先回填 pendingPreviewData（供 SCENE_READY 重发）+
   *   mergedSceneConfig（供版本恢复）+ lastSceneObjects 哨兵（供下次 modify 判定），再 wsNonce++。
   */
  async function onCodeVersionReady(
    codeFiles: { path: string; content: string }[],
    summary: string,
    sceneData?: Record<string, unknown> | null,
  ): Promise<void> {
    const sid = params.id
    if (!sid) return
    const dir = sceneHistoryDir()
    const cur = await loadCurrentSceneState(dir, sid)
    const base = cur ?? { lastIntent: null, lastPlanner: null, lastSceneObjects: [] }
    // codegen 路径：注入分组 sceneData 供预览 + 版本恢复 + modify 判定
    const state: SceneSessionState = sceneData
      ? {
          ...base,
          mergedSceneConfig: sceneData,
          // 哨兵：让下次 handleSubmit 走 modify 路径（lastSceneObjects().length > 0）。
          // 哨兵不参与渲染（iframe 读分组 key，不读 lastSceneObjects）。
          lastSceneObjects:
            base.lastSceneObjects.length > 0
              ? base.lastSceneObjects
              : [{ scene_objects: [], section_id: "__codegen", element_id: "__codegen", id_prefix: "__codegen" }],
        }
      : base
    if (sceneData) {
      // 先于 wsNonce++：iframe 重载后 onLoad + SCENE_READY 各发一次，Embed 去重，pendingData 须已就位
      sessionMap.set(setPendingPreviewData, sid, sceneData as unknown as SceneConfig)
      sessionMap.set(setHasPreviewContent, sid, true)
    }
    // 哨兵同步到内存 signal：handleSubmit 读 lastSceneObjects()[sid].length 判 hasScene，
    // 仅写 sessionState（持久化）不 set signal → 同会话连续提交 hasScene 恒 false → 永远 create 重建（用户「无论输入什么都重建」即此）。
    if (state.lastSceneObjects.length > 0) {
      sessionMap.set(setLastSceneObjects, sid, state.lastSceneObjects)
    }
    const vid = await appendSceneVersion(dir, sid, state, summary, codeFiles)
    console.log(
      `[onCodeVersionReady] appendSceneVersion vid=${vid} codeFiles=${codeFiles?.length ?? 0}个 codeDir=${codeDirPath(dir, sid, vid)}`,
    )
    // 刷新版本菜单
    const { versions: versionEntries, current } = await listSceneVersions(dir, sid)
    if (params.id === sid) {
      sessionMap.set(setVersions, sid, versionEntries)
      sessionMap.set(setCurrentVersionId, sid, current)
    }
    // workspace re-materialize + 铺该版本 code delta + 启 dev（await ready 后再 bump nonce，否则 iframe 加载死链）
    acquireWorkspaceWithToast(sid)
    const devUrl = await workspace.switchVersion(sdk.directory, codeDirPath(dir, sid, vid))
    console.log(
      `[onCodeVersionReady] switchVersion ok devUrl=${devUrl} pendingData keys=${sceneData ? Object.keys(sceneData).join(",") : "无"} → 即将 workspaceActive+wsNonce++ 触发 iframe 重载`,
    )
    if (params.id !== sid) return
    setWorkspaceActive(true)
    setWsNonce((n) => n + 1)
  }

  /**
   * 轻量物化（patch 路径 + 编辑态提交共用）：避开 switchVersion 的 materialize+startDev（240s startDev 卡顿源）。
   *
   * - 归档全量 codeFiles（appendSceneVersion，否则版本不可恢复）+ 刷新版本菜单
   * - workspaceActive：overlayVersionCode 只铺改动 handler（workspace 已有上一轮全量，不 materialize 不重启 dev）
   *   → vite chokidar fire → full-reload iframe → SCENE_READY 重发 pendingData → handler.create 读新 SUB_OVERRIDES
   * - 500ms 未收到 SCENE_READY（vite 没触发 full-reload / HMR 未重置 lastRenderedJson）→ wsNonce++ 兜底硬重载
   *   （硬导航使 Embed.vue 重挂、lastRenderedJson 重置 → 即使 pendingData 同也重跑，绕过 renderScene 去重）
   * - !workspaceActive（dev 没跑 / 冷启动 / 异常）→ 降级委托 onCodeVersionReady（switchVersion 全路径，可接受慢）
   */
  async function materializePatch(
    codeFiles: { path: string; content: string }[],
    summary: string,
    sceneData?: Record<string, unknown> | null,
  ): Promise<void> {
    const sid = params.id
    if (!sid) return
    const dir = sceneHistoryDir()
    if (!dir) return
    const cur = await loadCurrentSceneState(dir, sid)
    const base = cur ?? { lastIntent: null, lastPlanner: null, lastSceneObjects: [] }
    const state: SceneSessionState = sceneData
      ? {
          ...base,
          mergedSceneConfig: sceneData,
          // 哨兵：让下次 handleSubmit 走 modify 路径（lastSceneObjects().length > 0）
          lastSceneObjects:
            base.lastSceneObjects.length > 0
              ? base.lastSceneObjects
              : [{ scene_objects: [], section_id: "__codegen", element_id: "__codegen", id_prefix: "__codegen" }],
        }
      : base
    if (sceneData) {
      // 先于重载：iframe 重载后 SCENE_READY 重发，pendingData 须已就位
      sessionMap.set(setPendingPreviewData, sid, sceneData as unknown as SceneConfig)
      sessionMap.set(setHasPreviewContent, sid, true)
    }
    // 哨兵同步到内存 signal（同 onCodeVersionReady）：patch 后下次提交须 hasScene=true 才走 patch/modify 而非 create。
    if (state.lastSceneObjects.length > 0) {
      sessionMap.set(setLastSceneObjects, sid, state.lastSceneObjects)
    }
    const vid = await appendSceneVersion(dir, sid, state, summary, codeFiles)
    const { versions: versionEntries, current } = await listSceneVersions(dir, sid)
    if (params.id === sid) {
      sessionMap.set(setVersions, sid, versionEntries)
      sessionMap.set(setCurrentVersionId, sid, current)
    }
    // 冷启动 / dev 没跑 → 降级全量 switchVersion（materialize + overlay + startDev）
    if (!workspaceActive()) {
      await onCodeVersionReady(codeFiles, summary, sceneData ?? null)
      return
    }
    // 轻量：只 overlay 改动文件（不 materialize、不重启 dev → 不卡 startDev）
    // 仍要 acquire：overlay 改 workspace 代码，若别会话正持有 dev，会与其 overlay 互踩
    acquireWorkspaceWithToast(sid)
    await workspace.overlayVersionCode(sdk.directory, codeDirPath(dir, sid, vid))
    // 500ms 兜底：vite 未 full-reload（SCENE_READY 未到）→ wsNonce++ 硬重载（重挂 Embed、重置 lastRenderedJson）
    window.clearTimeout(patchReloadTimer)
    patchReloadTimer = window.setTimeout(() => {
      console.log("[materializePatch] 500ms 无 SCENE_READY，wsNonce++ 兜底硬重载")
      setWsNonce((n) => n + 1)
    }, 500)
  }

  /**
   * 接管 workspace 所有权（每次 switchVersion/overlay 前 call）。
   * tookOver=true（从另一会话手里抢过来）→ toast 提醒「已接管，另一会话预览将失效」。
   * 非强制锁（不阻塞接管，仍 last-writer-wins），只把静默互踩变显式 + 可恢复。
   */
  function acquireWorkspaceWithToast(sid: string): void {
    const { tookOver, prevOwner } = workspace.acquireWorkspace(sid)
    if (tookOver) {
      showToast({
        title: "已接管 3D 预览",
        description: `另一会话${prevOwner ? "（" + prevOwner.slice(-6) + "）" : ""}的预览将失效，切回该会话可恢复`,
      })
    }
  }

  /**
   * 被接管方「在此会话恢复」：重新 acquire（抢回所有权）+ switchVersion 到当前版本 codeDir
   * （重启被另一会话杀掉的 vite）+ wsNonce++ 重载 iframe + 重推场景数据。
   */
  async function handleRestoreWorkspace(): Promise<void> {
    const sid = params.id
    if (!sid) return
    const dir = sceneHistoryDir()
    acquireWorkspaceWithToast(sid)
    try {
      const state = dir ? await loadCurrentSceneState(dir, sid) : null
      if (state?.mergedSceneConfig) {
        sessionMap.set(setPendingPreviewData, sid, state.mergedSceneConfig as unknown as SceneConfig)
        sessionMap.set(setHasPreviewContent, sid, true)
      }
      if (state?.codeDir) {
        await workspace.switchVersion(sdk.directory, state.codeDir)
        if (params.id !== sid) return
        setWorkspaceActive(true)
        setWsNonce((n) => n + 1)
        if (state.mergedSceneConfig) sendToPreview(state.mergedSceneConfig as unknown as SceneConfig)
      } else {
        await workspace.stopDev()
        if (params.id === sid) setWorkspaceActive(false)
      }
    } catch (err) {
      console.log("[3d] handleRestoreWorkspace 失败:", err instanceof Error ? err.message : String(err))
      showToast({ title: "恢复预览失败", description: err instanceof Error ? err.message : String(err) })
    }
  }

  /** 分享：导出历史目录为 zip */
  async function handleShare(): Promise<void> {
    const sid = params.id
    if (!sid) return
    const dir = sceneHistoryDir()
    const title = sessionInfo()?.title ?? sid
    await exportZip({ historyDir: dir, sessionId: sid, title })
  }

  /** 预览：另开独立窗口显示当前场景（运行态，无编辑栏） */
  function handleLivePreview(): void {
    const sid = params.id
    if (!sid) return
    const data = pendingPreviewData()[sid]
    if (!data) {
      showToast({ title: "暂无可预览的场景数据" })
      return
    }
    const desktopApi = getDesktopApi()
    if (!desktopApi?.writeFileBuffer) {
      showToast({ title: "当前环境不支持实时预览" })
      return
    }
    // 写场景 JSON 到 3d-templete 的 public/live-data.json（vite dev server 5173 自动 serve），
    // 然后用 ?fetch=live-data.json 让 Scene3D.vue 的 loadLiveDataConfig 读取（与 pattern 实时预览协议一致）。
    const templateSrc = import.meta.env.VITE_3D_TEMPLATE_SRC ?? "D:/cyc/project/octo/3d-templete"
    const jsonStr = JSON.stringify(data, null, 2)
    const encoder = new TextEncoder()
    desktopApi
      .writeFileBuffer(`${templateSrc}/public/live-data.json`, encoder.encode(jsonStr).buffer as ArrayBuffer)
      .then(() => {
        // 3d-templete 运行态 URL（不带 /embed），?fetch= 指向 public/live-data.json
        const baseUrl = import.meta.env.VITE_3D_BASE ?? "http://127.0.0.1:5173"
        window.open(`${baseUrl}/?fetch=live-data.json`)
      })
      .catch(() => {
        showToast({ title: "写入预览文件失败" })
      })
  }

  /** 下载：导出 3d-templete 工程（开发者 npm i && npm run dev 可运行） */
  async function handleDownload(): Promise<void> {
    const sid = params.id
    if (!sid) return
    const data = pendingPreviewData()[sid]
    if (!data) {
      showToast({ title: "暂无可导出的场景数据" })
      return
    }
    const templateSrc = import.meta.env.VITE_3D_TEMPLATE_SRC ?? "D:/cyc/project/octo/3d-templete"
    const componentsSrc = import.meta.env.VITE_3D_COMPONENTS_SRC ?? "D:/cyc/project/octo/3d-components"
    if (!templateSrc || !componentsSrc) {
      showToast({ title: "未配置工程源码路径（VITE_3D_TEMPLATE_SRC / VITE_3D_COMPONENTS_SRC）" })
      return
    }
    const sceneState = await loadCurrentSceneState(sceneHistoryDir(), sid)
    const title = sessionInfo()?.title ?? `3d-scene-${sid}`
    await exportProject({
      templateSrc,
      componentsSrc,
      sceneConfig: data,
      codeDir: sceneState?.codeDir,
      defaultName: title,
    })
  }

  return (
    <DataProvider data={sync.data} directory={sdk.directory || ""}>
      <Toast.Region />
      <div
        class="octo-prototype octo-scene3d octo-split bg-background-base"
        style={{ display: "flex", width: "100%", height: "100%" }}
      >
        {/* 对话面板 */}
        <div style={{ width: hasContent() ? "420px" : "100%", height: "100%", "flex-shrink": "0" }}>
          <ChatPanel
            hasContent={hasContent()}
            sessionMessagesLoaded={sessionMessagesLoaded()}
            isBusy={isBusy()}
            sessionInfo={sessionInfo() ?? null}
            userMessages={userMessages()}
            sessionStatus={sessionStatus()}
            autoScroll={autoScroll}
            inputProps={chartInputProps() as any}
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
            onTitleChanged={(title) => mutateSession((prev) => (prev ? { ...prev, title } : prev))}
            onRetry={handleRetry}
            intentConfirmResult={intentConfirm()[params.id!] ?? null}
            blockMatches={blockMatches()[params.id!] ?? []}
            blockMatching={blockMatching()[params.id!] ?? false}
            blockMatchError={blockMatchError()[params.id!] ?? false}
            initialStep={cardInitialStep()}
            onMatchPattern={handleMatchPatternInCard}
            onConfirmIntent={handleConfirmIntent}
            skipBlocks={true}
          />
        </div>

        {/* 预览区 */}
        <Show when={hasContent()}>
          <div style={{ position: "relative", flex: 1, overflow: "hidden" }}>
            <Show
              when={!!isPlanReview()[params.id!]}
              fallback={
                <Show
                  when={!!isGeneratingReview()[params.id!]}
                  fallback={
                    <Show
                      when={!!hasPreviewContent()[params.id!]}
                      fallback={
                        <SceneEmptyState error={sessionErrors()[params.id!]} />
                      }
                    >
                      <div style={{ position: "relative", width: "100%", height: "100%" }}>
                        <PreviewPage3D
                          api={previewApi}
                          pendingData={pendingPreviewData()[params.id!] ?? null}
                          previewSrc={previewSrc()}
                          sceneDir={sceneHistoryDir()}
                          sessionId={params.id!}
                          onCodeVersionReady={onCodeVersionReady}
                          onMaterializePatch={materializePatch}
                          onReady={() => {
                            setEmbedReady(true)
                            sceneReadyResolver?.()
                            // materializePatch 的 vite full-reload 已到达 → 取消 wsNonce 兜底定时器
                            window.clearTimeout(patchReloadTimer)
                          }}
                          onConsoleError={(entry) => setConsoleBuffer((prev) => [...prev, entry])}
                          versions={versions()[params.id!] ?? []}
                          currentVersionId={currentVersionId()[params.id!] ?? null}
                          onSelectVersion={handleSelectVersion}
                          onPreview={handleLivePreview}
                          onShare={handleShare}
                          onDownload={handleDownload}
                        />
                        {/* 被另一会话接管：workspace 全局唯一，对方切换 dev server 致本会话预览失效 */}
                        <Show when={!isWorkspaceOwner()}>
                          <div
                            style={{
                              position: "absolute",
                              inset: 0,
                              "z-index": 50,
                              "pointer-events": "none",
                              display: "flex",
                              "align-items": "center",
                              "justify-content": "center",
                              background: "rgba(26, 26, 46, 0.72)",
                              "backdrop-filter": "blur(2px)",
                            }}
                          >
                            <div style={{ "pointer-events": "auto", "text-align": "center", color: "#fff", "max-width": "340px", padding: "0 16px" }}>
                              <div style={{ "font-size": "14px", "font-weight": 600, "margin-bottom": "4px" }}>
                                3D 预览被另一会话接管
                              </div>
                              <div style={{ "font-size": "12px", opacity: 0.7, "margin-bottom": "12px", "line-height": "1.5" }}>
                                workspace 全局唯一，另一会话切换了 dev server，本会话预览已失效。切回该会话或点此恢复。
                              </div>
                              <button
                                type="button"
                                onClick={() => void handleRestoreWorkspace()}
                                style={{
                                  "pointer-events": "auto",
                                  padding: "6px 14px",
                                  "font-size": "13px",
                                  border: "1px solid rgba(255,255,255,0.4)",
                                  "border-radius": "6px",
                                  background: "rgba(255,255,255,0.12)",
                                  color: "#fff",
                                  cursor: "pointer",
                                }}
                              >
                                在此会话恢复
                              </button>
                            </div>
                          </div>
                        </Show>
                      </div>
                    </Show>
                  }
                >
                  <Show
                    when={(lastPlanner()[params.id!] ?? null) && (lastIntent()[params.id!] ?? null)}
                    fallback={<SceneGenerating />}
                  >
                    <div style={{ position: "relative", width: "100%", height: "100%" }}>
                      <SceneWireframeReview
                        planner={lastPlanner()[params.id!]!}
                        intentDescription={lastIntent()[params.id!]!}
                        userInput={userInput()[params.id!] ?? ""}
                        onConfirm={handleConfirmReview}
                      />
                      <SceneGenerating />
                    </div>
                  </Show>
                </Show>
              }
            >
              <Show
                when={(lastPlanner()[params.id!] ?? null) && (lastIntent()[params.id!] ?? null)}
                fallback={<SceneGenerating />}
              >
                <div style={{ position: "relative", width: "100%", height: "100%" }}>
                  <SceneWireframeReview
                    planner={lastPlanner()[params.id!]!}
                    intentDescription={lastIntent()[params.id!]!}
                    userInput={userInput()[params.id!] ?? ""}
                    onConfirm={handleConfirmReview}
                  />
                  <Show when={!!isGeneratingReview()[params.id!]}>
                    <SceneGenerating />
                  </Show>
                </div>
              </Show>
            </Show>
            <Show when={!!isModifying()[params.id!]}>
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  "align-items": "center",
                  "justify-content": "center",
                  "flex-direction": "column",
                  gap: "8px",
                }}
              >
                <SceneGenerating />
                <div style={{ "font-size": "13px", color: "var(--octo-text-secondary, rgba(0,0,0,0.6))" }}>
                  正在修改场景中...
                </div>
              </div>
            </Show>
          </div>
        </Show>
      </div>
    </DataProvider>
  )
}
