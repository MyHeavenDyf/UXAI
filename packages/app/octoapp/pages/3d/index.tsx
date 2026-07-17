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
import { createEffect, createMemo, createResource, createSignal, on, onMount, Show, type JSX } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { SDKProvider, useSDK } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"
import { LocalProvider, useLocal } from "@/context/local"
import { useLayout } from "@/context/layout"
import { useProjectDir } from "@/hooks/use-project-dir"
import { type Attachment } from "./modules/chat/attachment-bar"
import {
  create_intent_confirm,
  create_planner_json,
  create_modules_json,
  type SceneCreateInput,
} from "./workflow/create-scene"
import modify_scene_ai from "./workflow/modify-scene-ai"
import {
  appendSceneVersion,
  updateSceneVersion,
  loadCurrentSceneState,
  listSceneVersions,
  type VersionEntry,
} from "./utils/version-history"
import {
  saveSceneReviewCheckpoint,
  loadSceneReviewCheckpoint,
  clearSceneReviewCheckpoint,
  saveIntentConfirmCheckpoint,
  loadIntentConfirmCheckpoint,
  clearIntentConfirmCheckpoint,
} from "./utils/scene-checkpoint"
import { logStartSession, clearDebugLog, saveDebugSnapshot } from "./utils/debug-log"
import { classifyAIError, saveProtoError, loadProtoError, clearProtoError } from "./utils/error-msg"
import { autoRenameSession } from "./utils/rename"
import { groupRounds } from "./utils/round-messages"
import type { SceneConfig, SceneConfigObject3D, ScenePatch } from "./utils/scene-config"
import type { ScenePlanner, SceneModuleResult } from "./agents/merge"
import { PreviewPage3D, type PreviewPageAPI } from "./modules/preview/index"
import { SceneWireframeReview, type SceneWireframeReviewResult } from "./modules/preview/SceneWireframeReview"
import { SceneGenerating } from "./modules/preview/SceneGenerating"
import { IntentConfirmReview, type IntentConfirmAnswers } from "./modules/preview/IntentConfirmReview"
import type { IntentConfirmResult } from "./agents/scene-intent-confirm"
import { ChatPanel } from "./modules/chat/index"
import { tracker } from "@/utils/tracker"
import * as sessionMap from "./utils/session-map"
import "./assets/style/pattern-tokens.css"

const AGENT_NAME = "scene_3d_triage"

// 3D 渲染引擎地址（dev=3d-templete vite 5173，prod=previewdist3d 51857，阶段3 部署时配 prod）
const PREVIEW_SRC = import.meta.env.VITE_3D_PREVIEW_URL ?? "http://127.0.0.1:5173/embed"

/** 空场景占位：会话无已保存场景（生成未完成/失败，或历史记录缺失）时显示，避免空白无 iframe 的困惑。 */
function SceneEmptyState(props: { error?: string }) {
  return (
    <div class="relative h-full w-full overflow-hidden bg-[#1a1a2e] flex flex-col items-center justify-center text-center px-6">
      <div class="text-white/50 text-base">此会话暂无 3D 场景</div>
      <div class="text-white/30 text-xs mt-2 max-w-[320px] leading-relaxed">
        {props.error
          ? `上次生成失败：${props.error}。可在左侧重新输入需求生成。`
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

  onMount(() => { tracker.page({ module: "scene3d", name: "scene3d-page" }) })

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
  const [sessionErrors, setSessionErrors] = createSignal<Record<string, string>>({})
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
  const [embedReady, setEmbedReady] = createSignal(false)

  const needsConfirm = createMemo(() => {
    const id = params.id
    if (!id) return false
    if (!!isGenerating()[id] || !!isGeneratingReview()[id]) return false
    return intentConfirm()[id] != null || !!isPlanReview()[id]
  })

  const confirmText = createMemo<{ title: string; subtitle: string } | null>(() => {
    const id = params.id
    if (!id) return null
    if (intentConfirm()[id]) return { title: "意图分析完成", subtitle: "请在右侧确认场景需求" }
    if (isPlanReview()[id]) return { title: "场景规划审查", subtitle: "请在右侧确认空间分区" }
    return null
  })

  // 历史文件存储目录：{directory}/.octo/design-3d/history
  const sceneHistoryDir = createMemo(() => `${sdk.directory}/.octo/design-3d/history`)

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

  // 预览通信：去重 + 推送到 iframe
  const previewApi: PreviewPageAPI = { sendToPreview: () => { } }
  const lastSentPreviewJson: Record<string, string> = {}
  function sendToPreview(data: SceneConfig | null) {
    const sid = params.id
    if (!sid) return
    // 诊断：打印推送的 payload 概要
    const objCount = Array.isArray((data as any)?.objects) ? (data as any).objects.length : 0
    const objIds = Array.isArray((data as any)?.objects) ? (data as any).objects.slice(0, 5).map((o: any) => o.id) : []
    console.log(`[3d] sendToPreview payload: objects=${objCount}, ids=${JSON.stringify(objIds)}, scene.bg=${(data as any)?.scene?.background}`)
    const json = data === null ? "null" : JSON.stringify(data)
    if (json === lastSentPreviewJson[sid]) return
    lastSentPreviewJson[sid] = json
    sessionMap.set(setPendingPreviewData, sid, data)
    previewApi.sendToPreview(data)
    sessionMap.set(setHasPreviewContent, sid, data !== null)
  }

  // ── 手动编辑（属性编辑器）回写 authoritative state + 防抖持久化 ──────────────
  // 否则：iframe/local objectsById 有改动，但 lastSceneObjects/磁盘仍是编辑前 →
  //   ① 下次 agent modify 从编辑前 lastSceneObjects 重生成 → "挪动后被复位"；
  //   ② 切走切回/新会话从磁盘读回编辑前 → "编辑的东西恢复到编辑前"。
  // 注意：不动 pendingPreviewData —— 它是 PreviewPage3D 的 prop，变化会触发重建 objectsById 并
  //       关掉属性弹窗（index.tsx PreviewPage3D 内 effect），导致编辑中弹窗闪退。
  let patchPersistTimer: ReturnType<typeof setTimeout> | null = null

  function applyPatchToObjects(objects: SceneConfigObject3D[], patch: ScenePatch): SceneConfigObject3D[] {
    const byId = new Map<string, SceneConfigObject3D>()
    for (const o of objects) if (o.id) byId.set(o.id, o)
    for (const o of patch.objects?.upsert ?? []) if (o.id) byId.set(o.id, o)
    for (const id of patch.objects?.remove ?? []) byId.delete(id)
    return [...byId.values()]
  }

  function flushPatchPersist(sid: string): void {
    patchPersistTimer = null
    if (params.id !== sid) return
    const dir = sceneHistoryDir()
    if (!dir) return
    const objects = (lastSceneObjects()[sid] ?? []) as unknown as SceneConfigObject3D[]
    const planner = lastPlanner()[sid] as ScenePlanner | null | undefined
    const cfg: SceneConfig = {
      version: "1.0",
      angleUnit: "deg",
      scene: (planner as any)?.scene ?? { background: "#1a1a2e" },
      camera: (planner as any)?.camera ?? { type: "perspective", position: [10, 8, 12], lookAt: [0, 0, 0], perspective: { fov: 50, near: 0.1, far: 1000 } },
      lights: (planner as any)?.lights ?? [{ type: "ambient", intensity: 0.6 }],
      objects,
    }
    void updateSceneVersion(dir, sid, {
      lastSceneObjects: objects as unknown as SceneModuleResult[],
      mergedSceneConfig: cfg as unknown as Record<string, unknown>,
    })
  }

  function handleScenePatch(patch: ScenePatch): void {
    const sid = params.id
    if (!sid) return
    // 内存 authoritative state 立即更新：下次 agent run 基于编辑后状态（防"复位"）。
    const prevObjects = (lastSceneObjects()[sid] ?? []) as unknown as SceneConfigObject3D[]
    sessionMap.set(setLastSceneObjects, sid, applyPatchToObjects(prevObjects, patch) as unknown as SceneModuleResult[])
    // 防抖落盘：属性编辑器拖拽时每 mousemove 一个 patch，避免每帧写盘。
    if (patchPersistTimer) clearTimeout(patchPersistTimer)
    patchPersistTimer = setTimeout(() => flushPatchPersist(sid), 800)
  }

  function clearPatchPersistTimer(): void {
    if (patchPersistTimer) {
      clearTimeout(patchPersistTimer)
      patchPersistTimer = null
    }
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
              void loadProtoError(errDir, id).then((errTitle) => {
                if (errTitle && params.id === id) setSessionErrors(prev => ({ ...prev, [id]: errTitle }))
              })
            }
          })

          // 恢复持久化状态
          const dir = sceneHistoryDir()
          if (dir) {
            void (async () => {
              if (params.id !== id) return
              // 意图确认检查点
              const checkpoint = await loadIntentConfirmCheckpoint(dir, id)
              if (params.id !== id) return
              if (checkpoint) {
                console.log("[3d] 恢复分支: 命中【意图确认检查点】→ 显示意图确认，不挂 3D 预览")
                sessionMap.set(setUserInput, id, checkpoint.userInput)
                sessionMap.set(setIntentConfirm, id, { options: checkpoint.options, current_step: "intent_confirm" })
                return
              }
              // 场景规划审查检查点
              const reviewCkpt = await loadSceneReviewCheckpoint(dir, id)
              if (params.id !== id) return
              if (reviewCkpt) {
                console.log("[3d] 恢复分支: 命中【场景规划审查检查点】→ 显示规划审查，不挂 3D 预览")
                sessionMap.set(setLastPlanner, id, reviewCkpt.planner)
                sessionMap.set(setLastIntent, id, reviewCkpt.intentDescription)
                sessionMap.set(setUserInput, id, reviewCkpt.userInput)
                sessionMap.set(setIsPlanReview, id, true)
                return
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
    const rootMsgs = ((sync.data.message[id] ?? []) as Message[]).filter(m => m.role === "user")
    const result: Message[] = rootMsgs.map(m => ({ ...m }))
    for (const childID of childSessionIDs()) {
      const childMsgs = ((sync.data.message[childID] ?? []) as Message[]).filter(m => m.role === "user")
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
    const rootMsgs = (sync.data.message[id] ?? []) as Message[]
    const lastRootAssistant = rootMsgs.findLast(m => m.role === "assistant")
    if (!!lastRootAssistant && typeof lastRootAssistant.time.completed !== "number") return true
    for (const childID of childSessionIDs()) {
      const childMsgs = (sync.data.message[childID] ?? []) as Message[]
      const lastChildAssistant = childMsgs.findLast(m => m.role === "assistant")
      if (!!lastChildAssistant && typeof lastChildAssistant.time.completed !== "number") return true
      const hasUser = childMsgs.some(m => m.role === "user")
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
    void saveDebugSnapshot(sceneHistoryDir(), sessionId, "error", { error: String(err instanceof Error ? err.message : err) })
    for (const childID of childSessionIDs()) {
      await sdk.client.session.abort({ sessionID: childID }).catch(() => { })
    }
    const error = classifyAIError(err)
    if (error.title) {
      setSessionErrors(prev => ({ ...prev, [sessionId]: error.title }))
      showToast({ title: error.title, description: error.description })
      const errDir = sceneHistoryDir()
      if (errDir) void saveProtoError(errDir, sessionId, error.title)
    }
  }

  // ── 核心提交链 ──
  async function handleSubmit() {
    const text = prompt().trim()
    if (!text || sending() || !activeModelKey()) return
    // agent run 前清掉待落盘的编辑防抖：编辑已在 lastSceneObjects（内存）即时生效，
    // agent 会读到编辑后状态；此处只需避免残留定时器把编辑前状态写进 agent 新增的版本。
    clearPatchPersistTimer()
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
      setSendingSids(prev => new Set(prev).add(sid!))
      setSessionErrors(prev => {
        if (!prev[sid!]) return prev
        const next = { ...prev }
        delete next[sid!]
        return next
      })
      const startDir = sceneHistoryDir()
      if (startDir) void clearProtoError(startDir, sid!)

      const intentCtx: SceneCreateInput = {
        sdk,
        sync,
        modelKey: mk,
        rootSession: sid,
        userInput: text,
        onSessionCreated: (childID: string) => {
          if (params.id !== sid) return
          setChildSessionIDs(prev => [...prev, childID])
        },
      }

      logStartSession(sid, text)

      const onFinshed = async ({ sceneIntent, layoutPlanner, modulesJson, sceneConfig, skipped }: any) => {
        if (skipped?.length) {
          showToast({ title: `${skipped.length} 个分区生成失败已跳过`, description: `可重新生成或继续对话补齐：${skipped.join("、")}` })
        }
        // lastSceneObjects 存 merge 后的完整 objects（不是仅新分区的 modulesJson），
        // 否则下次 modify 时丢失之前累积的物体。
        const mergedObjects = (sceneConfig?.objects ?? []) as SceneModuleResult[]
        const dir = sceneHistoryDir()
        if (dir) {
          const vid = await appendSceneVersion(dir, sid!, {
            lastIntent: sceneIntent,
            lastPlanner: layoutPlanner,
            lastSceneObjects: mergedObjects,
            mergedSceneConfig: sceneConfig,
          }, text.slice(0, 80))
          if (params.id === sid) {
            sessionMap.update(setVersions, sid!, prev => [...prev, { id: vid, createdAt: Date.now(), summary: text.slice(0, 80) }], [])
            sessionMap.set(setCurrentVersionId, sid!, vid)
            clearDebugLog()
          }
          void saveDebugSnapshot(dir, sid!, "modules", {
            lastIntent: sceneIntent,
            lastPlanner: layoutPlanner as unknown as Record<string, unknown>,
            lastSceneObjects: mergedObjects,
            sceneConfig,
            summary: text.slice(0, 80),
          })
        }
        sessionMap.set(setLastIntent, sid!, sceneIntent)
        sessionMap.set(setLastPlanner, sid!, layoutPlanner)
        sessionMap.set(setLastSceneObjects, sid!, mergedObjects)
        if (params.id === sid && sceneConfig) sendToPreview(sceneConfig as SceneConfig)
      }

      // 已有场景 → AI 修改流
      if ((sid ? (lastSceneObjects()[sid] ?? []).length : 0) > 0) {
        if (!sendingSids().has(sid!)) return
        const lastData = {
          lastIntent: sid ? lastIntent()[sid] ?? null : null,
          lastPlanner: sid ? lastPlanner()[sid] ?? null : null,
          lastSceneObjects: sid ? lastSceneObjects()[sid] ?? [] : [],
        }
        if (sid) sessionMap.set(setIsModifying, sid, true)
        tracker.interaction({ module: "scene3d", name: "modify-scene" })
        const modifyResult = await modify_scene_ai(intentCtx, lastData, onFinshed)
        if (params.id !== sid) return
        if (sid) sessionMap.set(setIsModifying, sid, false)
        if ((modifyResult as any)?.reply) showToast({ title: (modifyResult as any).reply })
      } else {
        // 首次创建
        void autoRenameSession({
          sync,
          client: sdk.client,
          directory: sdk.directory,
          targetSessionID: sid!,
          userText: text,
          modelKey: mk,
        }).then(title => { if (title) mutateSession(prev => prev ? { ...prev, title } : prev) }).catch(() => {})

        tracker.interaction({ module: "scene3d", name: "create-scene" })

        // 阶段1：意图确认（暂停点1）
        if (!sendingSids().has(sid!)) return
        const confirmResult = await create_intent_confirm(intentCtx)
        void saveDebugSnapshot(sceneHistoryDir(), sid!, "intent_confirm")
        if (Object.keys(confirmResult.options).length > 0) {
          if (sid) sessionMap.set(setUserInput, sid, text)
          if (sid) sessionMap.set(setIntentConfirm, sid, confirmResult)
          startPause(sid!)
          const confirmDir = sceneHistoryDir()
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

        // 阶段2：意图扩展 + 场景规划（直接进，无 pattern 匹配）
        if (!sendingSids().has(sid!)) return
        const new_planner = await create_planner_json(intentCtx)
        void saveDebugSnapshot(sceneHistoryDir(), sid!, "planner")
        const partialDir = sceneHistoryDir()
        if (partialDir) {
          const vid = await appendSceneVersion(partialDir, sid!, {
            lastIntent: new_planner.intent.intent_description,
            lastPlanner: new_planner.planner.layout_planner,
            lastSceneObjects: [],
          }, text.slice(0, 80))
          if (params.id === sid) {
            sessionMap.update(setVersions, sid!, prev => [...prev, { id: vid, createdAt: Date.now(), summary: text.slice(0, 80) }], [])
            sessionMap.set(setCurrentVersionId, sid!, vid)
          }
        }
        const userDir = sceneHistoryDir()
        if (userDir) {
          await saveSceneReviewCheckpoint(userDir, sid!, {
            planner: new_planner.planner.layout_planner,
            intentDescription: new_planner.intent.intent_description,
            userInput: text,
            rootSessionId: sid!,
            createdAt: Date.now(),
          })
        }

        // 暂停点3：场景规划审查
        if (params.id !== sid) return
        sessionMap.set(setLastPlanner, sid!, new_planner.planner.layout_planner)
        sessionMap.set(setLastIntent, sid!, new_planner.intent.intent_description)
        if (sid) sessionMap.set(setUserInput, sid, text)
        sessionMap.set(setIsPlanReview, sid!, true)
        startPause(sid!)
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "aborted") return
      await handleWorkflowError(err, sid!, "handleSubmit")
      if (sid) sessionMap.set(setIsModifying, sid, false)
    } finally {
      setSendingSids(prev => {
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
        setChildSessionIDs(prev => [...prev, childID])
      },
    }

    const onFinshed = async ({ sceneIntent, layoutPlanner, modulesJson, sceneConfig, skipped }: any) => {
      if (skipped?.length) {
        showToast({ title: `${skipped.length} 个分区生成失败已跳过`, description: `可重新生成或继续对话补齐：${skipped.join("、")}` })
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

  // 意图确认后，带着用户补充继续阶段2
  async function handleConfirmIntent(_answers: IntentConfirmAnswers, enrichedInput: string) {
    const sid = params.id
    if (!sid) return
    const mk = activeModelKey()
    if (!mk) return
    const text = userInput()[sid] ?? ""
    const enrichedText = text + enrichedInput
    const ckptDir = sceneHistoryDir()
    if (ckptDir) await clearIntentConfirmCheckpoint(ckptDir, sid)
    setSendingSids(prev => new Set(prev).add(sid))
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
        setChildSessionIDs(prev => [...prev, childID])
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
        const vid = await appendSceneVersion(partialDir, sid, {
          lastIntent: new_planner.intent.intent_description,
          lastPlanner: new_planner.planner.layout_planner,
          lastSceneObjects: [],
        }, text.slice(0, 80))
        if (params.id === sid) {
          sessionMap.update(setVersions, sid, prev => [...prev, { id: vid, createdAt: Date.now(), summary: text.slice(0, 80) }], [])
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
      setSendingSids(prev => {
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
    void sdk.client.session.abort({ sessionID: sid }).catch(() => {})
    for (const childID of childSessionIDs()) {
      void sdk.client.session.abort({ sessionID: childID }).catch(() => {})
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      void handleSubmit()
    }
  }

  function removeAttachment(id: string) {
    setAttachments(prev => prev.filter(a => a.id !== id))
  }
  function handleDragOver(e: DragEvent) { e.preventDefault(); setIsDragOver(true) }
  function handleDragLeave() { setIsDragOver(false) }
  function handleDrop(e: DragEvent) {
    e.preventDefault()
    setIsDragOver(false)
    // 附件解析暂留空，3D 场景文本输入为主
  }
  function handleFileInputChange(_e: Event) {
    // 附件选择暂留空
  }

  const inputDisabled = () => {
    const sid = params.id
    return (sid ? sending() || isBusy() : false) || !activeModelKey() || (sid ? (!!isPlanReview()[sid] || intentConfirm()[sid] != null) : false)
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

  return (
    <DataProvider data={sync.data} directory={sdk.directory || ""}>
      <Toast.Region />
      <div class="octo-prototype octo-scene3d octo-split bg-background-base" style={{ display: "flex", width: "100%", height: "100%" }}>
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
            onTitleChanged={title => mutateSession(prev => prev ? { ...prev, title } : prev)}
          />
        </div>

        {/* 预览区 */}
        <Show when={hasContent()}>
          <div style={{ position: "relative", flex: 1, overflow: "hidden" }}>
            <Show when={intentConfirm()[params.id!] ?? null} fallback={
              <Show when={!!isPlanReview()[params.id!]} fallback={
                <Show when={!!isGeneratingReview()[params.id!]} fallback={
                  <Show
                    when={!!hasPreviewContent()[params.id!]}
                    fallback={<SceneEmptyState error={sessionErrors()[params.id!]} />}
                  >
                    <PreviewPage3D
                      api={previewApi}
                      pendingData={pendingPreviewData()[params.id!] ?? null}
                      previewSrc={PREVIEW_SRC}
                      onReady={() => setEmbedReady(true)}
                      onPatch={handleScenePatch}
                    />
                  </Show>
                }>
                  <Show when={(lastPlanner()[params.id!] ?? null) && (lastIntent()[params.id!] ?? null)} fallback={<SceneGenerating />}>
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
              }>
                <Show when={(lastPlanner()[params.id!] ?? null) && (lastIntent()[params.id!] ?? null)} fallback={<SceneGenerating />}>
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
            }>
              <div style={{ position: "relative", width: "100%", height: "100%" }}>
                <IntentConfirmReview
                  result={intentConfirm()[params.id!]!}
                  onConfirm={handleConfirmIntent}
                />
                <Show when={!!isGenerating()[params.id!]}>
                  <SceneGenerating />
                </Show>
              </div>
            </Show>
            <Show when={!!isModifying()[params.id!]}>
              <div style={{ position: "absolute", inset: 0, display: "flex", "align-items": "center", "justify-content": "center", "flex-direction": "column", gap: "8px" }}>
                <SceneGenerating />
                <div style={{ "font-size": "13px", color: "var(--octo-text-secondary, rgba(0,0,0,0.6))" }}>正在修改场景中...</div>
              </div>
            </Show>
          </div>
        </Show>
      </div>
    </DataProvider>
  )
}
