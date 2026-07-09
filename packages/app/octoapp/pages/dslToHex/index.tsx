import "./octo-tokens.css"
import "./components/slash-popover.css"
import { STEP_A_PROMPT } from "./prompts/step-a"
import { STEP_B_PROMPT } from "./prompts/step-b"
import { saveArtifact, loadArtifact, clearArtifacts, loadManifest, saveManifest, ensureApiCallScript, inlineAssetContents } from "./utils/artifact-persist"
import API_CALL_SOURCE from "./lib/api-call.ts?raw"
import { stripFollowUpTags, joinTextParts, extractSemanticLayout, extractNodeDsl } from "./utils/strip-conversational"
import { IframeBridge } from "./lib/iframe-bridge"
import { stripThinkTags } from "./lib/think-filter"

type StepPhase = "a-generating" | "a-done" | "b-generating" | "b-done" | "c-generating" | "c-done"

function debugLog(...args: unknown[]) {
  console.log("[dslToHex]", ...args)
}

/** 校验是否为合法 zip：检查 PK 魔数（本地文件头 PK\x03\x04 / 空归档 PK\x05\x06 / 跨段 PK\x07\x08） */
function isZipBuffer(buf: ArrayBuffer | null | undefined): boolean {
  if (!buf || buf.byteLength < 4) return false
  const b = new Uint8Array(buf, 0, 4)
  return b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07)
}
import type { Message, Session, SessionStatus } from "@opencode-ai/sdk/v2/client"
import type { FilePartInput, TextPartInput } from "@opencode-ai/sdk/v2/client"
import { Binary } from "@opencode-ai/core/util/binary"
import { DataProvider } from "@opencode-ai/ui/context/data"
import { createAutoScroll } from "@opencode-ai/ui/hooks"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { InlineInput } from "@opencode-ai/ui/inline-input"
import { showToast } from "@opencode-ai/ui/toast"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useCommand } from "@/context/command"
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  on,
  onCleanup,
  Show,
  type JSX,
} from "solid-js"
import { createStore, produce } from "solid-js/store"
import { useNavigate, useParams } from "@solidjs/router"
import { useGlobalSync } from "@/context/global-sync"
import { dropSessionCaches } from "@/context/global-sync/session-cache"
import { useGlobalSDK } from "@/context/global-sdk"
import { SDKProvider, useSDK } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"

import { LocalProvider, useLocal } from "@/context/local"
import { useLayout } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"
import { useProviders } from "@/hooks/use-providers"
import { useProjectDir } from "@/hooks/use-project-dir"
import { sessionTitle } from "@/utils/session-title"
import { AttachmentBar, type Attachment } from "./components/attachment-bar"
import { InsightTurn, type DeltaLogEntry } from "./components/insight-turn"
import { createArtifactParser } from "./utils/artifact-parser"
import { MakeQuestionDock } from "./components/make-question-dock"
import { sessionQuestionRequest } from "@/pages/session/composer/session-request-tree"
import type { QuestionRequest } from "@opencode-ai/sdk/v2"

import IconHost from "@/pages/_shell/icons/IconHost.svg"
import { Spinner } from "@opencode-ai/ui/spinner"
import { Icon } from "@opencode-ai/ui/icon"

import { ModelSelectorPopover } from "@/components/dialog-select-model"



import { useMakeCommands } from "./use-make-commands"

export default function MakePage() {
  const projectDir = useProjectDir({ mode: "project" })

  return (
    <Show when={projectDir()} keyed>
      {(dir) => (
        <SDKProvider directory={() => dir}>
          <SyncProvider>
            <LocalProvider>
              <MakeContent />
            </LocalProvider>
          </SyncProvider>
        </SDKProvider>
      )}
    </Show>
  )
}

function MakeContent() {
  const params = useParams<{ id?: string }>()
  const navigate = useNavigate()
  const command = useCommand()
  const sync = useSync()
  const layout = useLayout()
  const language = useLanguage()
  const settings = useSettings()
  const dialog = useDialog()
  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  const sdk = useSDK()
  const providers = useProviders()
  let bridgeRef: IframeBridge | undefined

  // Register Make slash commands
  useMakeCommands()

  const projectDir = useProjectDir()

  // ── 模型选择（复用 useLocal，与 Chat/Studio 逻辑一致） ────
  const local = useLocal()
  const currentModel = () => local.model.current()

  createEffect(
    on(
      () => globalSync.data.config.model,
      (modelStr) => {
        if (!modelStr) return
        const [providerID, modelID] = modelStr.split("/")
        if (!providerID || !modelID) return
        const cur = currentModel()
        if (cur && cur.provider.id === providerID && cur.id === modelID) return
        local.model.set({ providerID, modelID }, { recent: true })
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => {
        const connectedStr = providers.connected().map((p) => p.id).sort().join(",")
        const model = currentModel()
        return {
          connected: connectedStr,
          key: model ? `${model.provider.id}/${model.id}` : null,
        }
      },
      (next, prev) => {
        if (next.key == null || prev === undefined) return
        if (next.key === prev.key) return
        const [providerID, modelID] = next.key.split("/")
        local.model.set({ providerID, modelID })
      },
      { defer: true },
    ),
  )

  const activeModelKey = createMemo(() => {
    const m = currentModel()
    if (!m) return null
    return { providerID: m.provider.id, modelID: m.id }
  })

  // 当前 session 元数据（标题等）
  const [sessionInfo, { refetch: refetchSession }] = createResource(
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

  const [overrideTitle, setOverrideTitle] = createSignal<string | null>(null)
  createEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { sessionID: string; title: string } | undefined
      if (detail && detail.sessionID === params.id) {
        setOverrideTitle(detail.title)
      }
      void Promise.resolve(refetchSession()).then(() => setOverrideTitle(null))
    }
    window.addEventListener("octo:make:session-renamed", handler)
    onCleanup(() => window.removeEventListener("octo:make:session-renamed", handler))
  })

  // 标题编辑状态
  const [titleState, setTitleState] = createStore({
    editing: false,
    draft: "",
    menuOpen: false,
    pendingRename: false,
  })
  let titleRef: HTMLInputElement | undefined

  /** 打开标题编辑模式 */
  function openTitleEditor() {
    const sInfo = sessionInfo()
    setTitleState({ editing: true, draft: sessionTitle(overrideTitle() ?? info()?.title ?? sInfo?.title) ?? "" })
    requestAnimationFrame(() => titleRef?.focus())
  }

  /** 保存标题编辑 */
  async function saveTitleEditor() {
    const id = params.id
    if (!id) return
    const draft = titleState.draft.trim()
    if (!draft) { setTitleState("editing", false); return }
    try {
      await sdk.client.session.update({ sessionID: id, title: draft })
      void refetchSession()
    } catch (err) {
      showToast({ title: "重命名失败", description: err instanceof Error ? err.message : String(err) })
    }
    setTitleState("editing", false)
  }

  // 删除对话
  /** 删除会话 */
  async function deleteSession(sessionID: string) {
    try {
      artifactCache.delete(sessionID)
      dropHint(sessionID)
      if (dslDir) clearArtifacts(dslDir, sessionID).catch(() => {})
      await sdk.client.session.delete({ sessionID })
      navigate(`/dslToHex`)
    } catch (err) {
      showToast({ title: "删除失败", description: err instanceof Error ? err.message : String(err) })
    }
  }

  /** 弹出删除确认弹框 */
  function handleDeleteSession() {
    const id = params.id
    if (!id) return
    dialog.show(() => <MakeDialogDeleteSession sessionID={id} name={sessionTitle(sessionInfo()?.title) ?? "Octo Design"} onDelete={deleteSession} />)
  }

// 监听项目切换，清理不属于新项目的 session
  createEffect(
    on(
      projectDir,
      (newDir, oldDir) => {
        if (!newDir || !oldDir || newDir === oldDir) return
        
        const currentId = params.id
        if (!currentId) return

        // 检查当前 session 是否属于新项目
        const client = globalSDK.createClient({ directory: newDir })
        void client.session.list().then((result) => {
          const sessions = (result.data ?? []) as Session[]
          const belongsToNewProject = sessions.some(s => s.id === currentId && (s.agent === "octo_hex" || s.agent === "octo_dsl"))
          
          if (!belongsToNewProject) {
            // 清理旧 session 数据
            const [store, setStore] = globalSync.child(sdk.directory)
            dropSessionCaches(store, [currentId])
            setStore(
              produce((draft) => {
                delete draft.message[currentId]
                delete draft.session_status[currentId]
              }),
            )
            
            // 清理子 session 追踪状态
            loadedChildSessions.clear()
            setChildSessionIDs(new Set<string>())
            
            // 清除 lastSessionPerTab 记录，防止切换回来时恢复
            layout.lastSessionPerTab.setDslToHex(sdk.directory, "")
            
            // 导航到空态
            navigate(`/dslToHex`)
          }
        })
      },
    ),
  )

const sessionMessagesLoaded = createMemo(() => {
    const id = params.id
    return !id || sync.data.message[id] !== undefined
  })

  // ── Effect A: session切换 — clear/reset/navigate ────────────
  // 只依赖 params.id，不依赖 message 缺失，避免 sync 完成时重触发
  createEffect(
    on(
      () => params.id,
      (id) => {
        debugLog("sessionSwitch:", { id })
        setSending(false)
        setDeltaLog([])
        // ── 用产物缓存推断初始 phase ──
        // 冷启动（无缓存）一律从 a-generating 起，由产物/消息异步驱动到正确步骤。
        const inf = inferFromCache(id)
        setStepPhase(inf.phase)
        setStepBInitiated(inf.bInitiated)
        setStepCConfirmed(inf.cConfirmed)
        setStepAMessageId(null)
        setStepBStartIdx(0)
        bridge.post("NODE_DSL_CLEAR", undefined)
        if (sendingNavigation) {
          sendingNavigation = false
        } else {
          setAttachments([])
        }
        requestAnimationFrame(() => autoScroll.forceScrollToBottom())
      },
    ),
  )

  // ── Effect B: message缺失时触发sync ────────────────────────
  // 独立依赖 message===undefined，sync完成后从true→false不再触发Effect A
  createEffect(
    on(
      () => sync.data.message[params.id ?? ""] === undefined,
      (missing) => {
        const id = params.id
        if (id) {
          layout.lastSessionPerTab.setDslToHex(sdk.directory, id)
          if (missing) void sync.session.sync(id).catch(() => {})
        }
      },
    ),
  )



  // 调试日志：打印当前 session 相关的 SSE 事件
  createEffect(() => {
    const sid = params.id
    if (!sid) return
    const unsub = sdk.event.listen((evt) => {
      const e = evt.details
      const props = e.properties as Record<string, unknown> | undefined
      const eventSessionID = props?.sessionID as string | undefined
      if (eventSessionID && eventSessionID !== sid && !childSessionIDs().has(eventSessionID)) return
      
      if (e.type === "message.part.delta") {
        setLastDeltaTime(Date.now())
        setBlockTime(0)
        setDeltaLog(prev => [
          ...prev.slice(-19),
          {
            timestamp: Date.now(),
            eventType: e.type,
            sessionID: eventSessionID ?? sid,
            messageID: props?.messageID as string,
            partID: props?.partID as string,
            field: (props as Record<string, unknown>)?.field as string,
            delta: (props as Record<string, unknown>)?.delta as string,
          }
        ])
      } else if (e.type === "session.next.reasoning.delta") {
        setLastDeltaTime(Date.now())
        setBlockTime(0)
        setDeltaLog(prev => [
          ...prev.slice(-19),
          {
            timestamp: Date.now(),
            eventType: e.type,
            sessionID: eventSessionID ?? sid,
            messageID: "",
            partID: props?.reasoningID as string,
            field: "reasoning",
            delta: (props as Record<string, unknown>)?.delta as string,
          }
        ])
      } else if (e.type === "message.part.updated") {
        const part = props?.part as Record<string, unknown> | undefined
        const partType = part?.type as string | undefined
        const partText = part?.text as string | undefined
        if (partType === "text" && partText && eventSessionID && eventSessionID !== sid) {
          setLastDeltaTime(Date.now())
          setBlockTime(0)
          setDeltaLog(prev => [
            ...prev.slice(-19),
            {
              timestamp: Date.now(),
              eventType: e.type,
              sessionID: eventSessionID,
              messageID: part?.messageID as string,
              partID: part?.id as string,
              field: "text",
              delta: partText,
            }
          ])
        } else if (partType === "reasoning" && partText && eventSessionID && eventSessionID !== sid) {
          setLastDeltaTime(Date.now())
          setBlockTime(0)
          setDeltaLog(prev => [
            ...prev.slice(-19),
            {
              timestamp: Date.now(),
              eventType: e.type,
              sessionID: eventSessionID,
              messageID: part?.messageID as string,
              partID: part?.id as string,
              field: "reasoning",
              delta: partText,
            }
          ])
        }
        } else {
        const partType = props?.part ? (props.part as Record<string, unknown>)?.type : undefined
        debugLog("SSE event:", e.type, "sessionID:", eventSessionID ?? sid, "msgID:", props?.messageID, "partType:", partType)
      }
    })
    onCleanup(unsub)
  })

  // 实时监控 sync.data 中的消息变化
  createEffect(() => {
    const id = params.id
    if (!id) return
    const msgs = sync.data.message[id]
    const parts = Object.keys(sync.data.part).filter(k => msgs?.some(m => m.id === k))
    debugLog("syncMonitor:", { id, msgCount: msgs?.length ?? 0, msgRoles: msgs?.map(m => m.role), partKeys: parts.length, status: sync.data.session_status[id]?.type })
  })

  // ── IframeBridge 初始化（只创建一次，mount到container ref） ──
  const bridge = new IframeBridge()
  bridgeRef = bridge
  bridge
    .on("STEP_CHANGED", (payload) => {
      const step = (payload as { step: number }).step
      debugLog("STEP_CHANGED:", step)
    })
    .on("DSL_NODE_UPDATED", (payload) => {
      const { nid, changes } = payload as { nid: number; changes: Record<string, string> }
      setDslNodeEdits(nid, (prev) => ({ ...prev, ...changes }))
    })
    .on("DSL_RENDER_CONFIRMED", () => {
      debugLog("DSL_RENDER_CONFIRMED received, phase:", stepPhase())
      // 只有在步骤二（b-done）才接受"确认渲染"。防止 iframe 在其它阶段发来的
      // 杂散确认推进到 c-generating 并最终存盘 zip，导致没确认却被恢复到步骤三。
      if (stepPhase() !== "b-done") {
        debugLog("DSL_RENDER_CONFIRMED 忽略：当前 phase 非 b-done")
        return
      }
      const dslJson = stepBDslJsonPatched()
      if (!dslJson) return
      // 同 NODE_DSL_JSON：进入渲染管线前内联 SVG 素材文件
      inlineAssetContents(dslDir ?? "", dslJson)
        .catch(() => dslJson)
        .then((inlined) => { try { bridgeRef?.post("NODE_DSL_PIPELINE", JSON.parse(inlined)) } catch {} })
      setStepCConfirmed(true)
      setStepPhase("c-generating")
    })
    .on("PIPELINE_LOADED", (payload) => {
      const p = payload as { success: boolean; zipData?: ArrayBuffer }
      debugLog("PIPELINE_LOADED:", p.success, "phase:", stepPhase())
      // 只有用户点击"确认渲染"(DSL_RENDER_CONFIRMED → c-generating)后才接收渲染产物。
      // 否则忽略 iframe 在步骤二自动渲染发来的 PIPELINE_LOADED：它会把 stepCConfirmed 提前置 true，
      // 触发 c-done 检测 effect，导致步骤二一生成完就跳到步骤三。
      if (stepPhase() !== "c-generating") {
        debugLog("PIPELINE_LOADED 忽略：未确认渲染（当前 phase 非 c-generating）")
        return
      }
      if (p.success && p.zipData) {
        handleZipData(p.zipData)
        setStepCConfirmed(true)
        setStepPhase("c-done")
      }
    })

  // 组件卸载时移除 iframe + window message 监听，避免泄漏
  onCleanup(() => bridge.unmount())

  // ── session restore → bridge ────────────────────────────────
  // 回灌 b/c 产物到 iframe
  createEffect(() => {
    const id = params.id
    if (!id || !dslDir) return
    const bArtifact = stepBArtifact()
    const cArtifact = stepCArtifact()
    if (bArtifact) {
      // 存盘产物只存文件引用，回灌前内联 SVG 素材
      inlineAssetContents(dslDir, bArtifact)
        .catch(() => bArtifact)
        .then((inlined) => { try { bridge.post("NODE_DSL_JSON", JSON.parse(inlined)) } catch {} })
    }
    if (isZipBuffer(cArtifact)) {
      bridge.post("PIPELINE_ZIP_DATA", cArtifact)
    }
  })

  const [childSessionIDs, setChildSessionIDs] = createSignal<Set<string>>(new Set())
  const [deltaLog, setDeltaLog] = createSignal<DeltaLogEntry[]>([])
  const loadedChildSessions = new Set<string>()

  /** 加载子会话数据 */
  async function ensureChildSession(subSessionID: string) {
    if (!subSessionID || loadedChildSessions.has(subSessionID)) return
    
    // 防护：检查主 session 是否仍然有效（属于当前 sync.data）
    const mainSessionId = params.id
    if (!mainSessionId) return
    const hasMainSession = Binary.search(sync.data.session, mainSessionId, (s) => s.id).found
    if (!hasMainSession) return
    
    loadedChildSessions.add(subSessionID)
    setChildSessionIDs((prev) => { const next = new Set(prev); next.add(subSessionID); return next })
    
    // 子 session 可能属于不同项目，sync 失败时静默忽略
    try {
      await sync.session.sync(subSessionID)
    } catch {
      // 忽略跨项目 session sync 错误
    }
  }

  const userMessages = createMemo((): Message[] => {
    const id = params.id
    if (!id) return []
    const allMsgs = (sync.data.message[id] ?? []) as Message[]
    debugLog("userMessages:", { id, total: allMsgs.length, roles: allMsgs.map(m => m.role), ids: allMsgs.map(m => m.id) })
    return allMsgs.filter((m) => m.role === "user")
  })

  const [stepAMessageId, setStepAMessageId] = createSignal<string | null>(null)

  // ── 步骤阶段状态 ────────────────────────────────────────
  const [stepPhase, setStepPhase] = createSignal<StepPhase>("a-generating")
  const [stepBInitiated, setStepBInitiated] = createSignal(false)
  const [stepBStartIdx, setStepBStartIdx] = createSignal(0)
  const [stepAArtifact, setStepAArtifact] = createSignal<string | null>(null)
  const [stepBArtifact, setStepBArtifact] = createSignal<string | null>(null)
  const [stepCArtifact, setStepCArtifact] = createSignal<ArrayBuffer | null>(null)
  const [stepCConfirmed, setStepCConfirmed] = createSignal(false)

  // ── 产物内存缓存（按 session）──────────────────────────────
  // 切回已生成过的 session 时同步恢复 phase/产物，避免经过 a-generating
  // 而让 iframe 先闪回步骤一再跳到目标步骤。
  type ArtifactSnapshot = { a: string | null; b: string | null; c: ArrayBuffer | null }
  const artifactCache = new Map<string, ArtifactSnapshot>()
  function cacheArtifact(id: string, patch: Partial<ArtifactSnapshot>) {
    artifactCache.set(id, { ...(artifactCache.get(id) ?? { a: null, b: null, c: null }), ...patch })
  }
  // ── 持久化步骤提示（manifest）──────────────────────────────
  // 冷启动时内存 artifactCache 为空，靠磁盘 manifest 给 inferFromCache 提供初始步骤，
  // 消除"切到已生成 session 先闪步骤一再跳目标步骤"。manifest 只是提示，产物到达后
  // 仍由异步校验纠正；默认只升不降，真正的回退（删除/重生成/产物丢失）显式 allowLower。
  const phaseHint = new Map<string, number>()
  let hintReady = false
  let hintDirty = false
  function flushManifest() {
    const dir = projectDir()
    if (dir) saveManifest(dir, Object.fromEntries(phaseHint)).catch(() => {})
  }
  function persistHint(id: string, step: number, opts?: { allowLower?: boolean }) {
    const cur = phaseHint.get(id)
    if (cur === step) return
    if (cur !== undefined && step < cur && !opts?.allowLower) return
    phaseHint.set(id, step)
    if (!hintReady) { hintDirty = true; return }
    flushManifest()
  }
  function dropHint(id: string) {
    if (!phaseHint.delete(id)) return
    if (!hintReady) { hintDirty = true; return }
    flushManifest()
  }
  // 挂载/切项目时预读一次 manifest 进内存（磁盘旧值不覆盖本次运行已写入的更新）
  // 切项目时先清空，避免上一个项目的条目混入新项目的 manifest。
  let hintLoadedFor = ""
  createEffect(() => {
    const dir = projectDir()
    if (!dir || hintLoadedFor === dir) return
    hintLoadedFor = dir
    phaseHint.clear()
    hintReady = false
    loadManifest(dir)
      .then((m) => { for (const k in m) if (!phaseHint.has(k)) phaseHint.set(k, m[k]) })
      .catch(() => {})
      .finally(() => { hintReady = true; if (hintDirty) { hintDirty = false; flushManifest() } })
  })

  function inferFromCache(id: string | undefined): { phase: StepPhase; bInitiated: boolean; cConfirmed: boolean } {
    const snap = id ? artifactCache.get(id) : undefined
    if (snap?.c && isZipBuffer(snap.c)) return { phase: "c-done", bInitiated: true, cConfirmed: true }
    if (snap?.b) return { phase: "b-done", bInitiated: true, cConfirmed: false }
    if (snap?.a) return { phase: "a-done", bInitiated: false, cConfirmed: false }
    const hint = id ? phaseHint.get(id) : undefined
    if (hint === 2) return { phase: "c-done", bInitiated: true, cConfirmed: true }
    if (hint === 1) return { phase: "b-done", bInitiated: true, cConfirmed: false }
    return { phase: "a-generating", bInitiated: false, cConfirmed: false }
  }

  // ── 切换 session 或 sync 数据到达时恢复 stepPhase ──────────
  // 处理 idle 和 busy 两种状态，确保切回正在生成的 session 时恢复正确 phase
  // 追踪 stepBArtifact/stepCArtifact：产物加载完成时重新评估 phase
  createEffect(() => {
    const id = params.id
    if (!id) return
    const currentPhase = stepPhase()
    if (currentPhase !== "a-generating" && currentPhase !== "a-done") return
    const bArtifact = stepBArtifact()
    const cArtifact = stepCArtifact()
    const status = sync.data.session_status[id] ?? { type: "idle" }
    const partStore = sync.data.part as Record<string, { type: string; text?: string }[]>
    const allMsgs = (sync.data.message[id] ?? []) as Message[]
    const assistantMsgs = allMsgs.filter((m) => m.role === "assistant")
    if (assistantMsgs.length === 0) return

    function extractText(msgId: string): string {
      const parts = partStore?.[msgId] ?? []
      return [...parts].find((p) => p.type === "text")?.text?.trim() ?? ""
    }

    let stepAMsg: Message | undefined
    for (const msg of [...assistantMsgs].reverse()) {
      const text = extractText(msg.id)
      if (!text) continue
      if (looksLikeJson(text)) continue
      const parts = partStore?.[msg.id] ?? []
      if (parts.some((p) => p.type === "tool")) continue
      stepAMsg = msg
      break
    }

    if (!stepAMsg) {
      setStepAMessageId(assistantMsgs[assistantMsgs.length - 1].id)
      return
    }
    setStepAMessageId(stepAMsg.id)

    // 找到 step B：step A 之后是否有 JSON/artifact 消息
    const aMsgIdFinal = stepAMessageId()
    const aMsgIdx = aMsgIdFinal ? allMsgs.findIndex((m) => m.id === aMsgIdFinal) : stepAMsg ? assistantMsgs.findIndex((m) => m.id === stepAMsg!.id) : -1
    const msgsAfterA = aMsgIdx >= 0 ? allMsgs.slice(aMsgIdx + 1) : allMsgs
    let hasStepB = false
    for (const msg of msgsAfterA) {
      if (msg.role !== "assistant") continue
      const text = extractText(msg.id)
      if (!text) continue
      if (looksLikeJson(text)) { hasStepB = true; break }
    }

    if (hasStepB) {
      if (status.type === "idle") {
        // 产物是唯一数据源：产物已删 → 不恢复到 b-done，卡在 a-done 等用户重新生成
        // 产物已加载（bArtifact !== null）→ 推进到 b-done 或 c-done
        if (cArtifact !== null && cArtifact.byteLength > 0) {
          setStepBInitiated(true)
          setStepCConfirmed(true)
          setStepPhase("c-done")
        } else if (bArtifact !== null) {
          setStepBInitiated(true)
          setStepPhase("b-done")
        } else {
          setStepPhase("a-done")
        }
      } else {
        setStepBInitiated(true)
        setStepPhase("b-generating")
      }
    } else if (msgsAfterA.length > 0 && status.type !== "idle") {
      setStepBInitiated(true)
      setStepPhase("b-generating")
    } else if (status.type === "idle") {
      setStepPhase("a-done")
    }
  })

  const VECTOR_API_BASE = import.meta.env.VITE_VECTOR_API_BASE
    || localStorage.getItem("octo:vector-api-base")
    || "https://octo-beta.hdesign.huawei.com"

  // bash 工具的 cwd 是 session 的 directory（用户打开的设计项目），不是 UXAI 仓库根目录，
  // 所以仓库相对路径命不中。首选做法：step-b 前把脚本源码落盘到项目 .octo/dslToHex/ 下，
  // 用下面这个相对项目目录的路径引用（零配置、对所有人生效）。落盘只在桌面端可用；纯 web
  // 环境写不了磁盘，退回 FALLBACK（可用 localStorage/env 覆盖，或把 UXAI 当项目打开）。
  const API_CALL_SCRIPT_MATERIALIZED = ".octo/dslToHex/api-call.ts"
  const API_CALL_SCRIPT_FALLBACK = import.meta.env.VITE_API_CALL_SCRIPT
    || localStorage.getItem("octo:api-call-script")
    || "packages/app/octoapp/pages/dslToHex/lib/api-call.ts"

  const STEP_A_DISABLED_TOOLS = {
    write: false,
    edit: false,
    apply_patch: false,
    bash: false,
    read: false,
    glob: false,
    grep: false,
    todowrite: false,
    websearch: false,
    webfetch: false,
    shell: false,
    skill: false,
    task: false,
    plan_exit: false,
    hover: false,
    jimeng_image_generate: false,
    internel_image_generate: false,
  }

  const STEP_B_TOOLS = {
    write: false,
    edit: false,
    apply_patch: false,
    bash: true,
    read: false,
    glob: false,
    grep: false,
    todowrite: false,
    websearch: false,
    webfetch: false,
    shell: true,
    skill: false,
    task: false,
    plan_exit: false,
    hover: false,
    jimeng_image_generate: false,
    internel_image_generate: false,
  }

    function extractJsonFromText(text: string): string | null {
       if (text.startsWith("{") || text.startsWith("[")) {
         try { JSON.parse(text); return text } catch {}
         const closeChar = text.startsWith("{") ? "}" : "]"
         const lastClose = text.lastIndexOf(closeChar)
         if (lastClose > 0) {
           const candidate = text.slice(0, lastClose + 1)
           try { JSON.parse(candidate); return candidate } catch {}
         }
       }
       const startBrace = text.indexOf("{")
       const startBracket = text.indexOf("[")
       const start = startBrace === -1 ? startBracket : startBracket === -1 ? startBrace : Math.min(startBrace, startBracket)
       if (start === -1) return null
       const openChar = text[start]
       const closeChar = openChar === "{" ? "}" : "]"
       let depth = 0
       let end = -1
       for (let i = start; i < text.length; i++) {
         if (text[i] === openChar) depth++
         if (text[i] === closeChar) depth--
         if (depth === 0) { end = i + 1; break }
       }
       if (end !== -1) {
         const candidate = text.slice(start, end)
         try { JSON.parse(candidate); return candidate } catch {}
         const lastClose = text.lastIndexOf(closeChar)
         if (lastClose > end) {
           try { JSON.parse(text.slice(start, lastClose + 1)); return text.slice(start, lastClose + 1) } catch {}
         }
       }
       let best: string | null = null
       let bestLen = 0
       for (let i = 0; i < text.length; i++) {
         if (text[i] !== "{" && text[i] !== "[") continue
         const oc = text[i]
         const cc = oc === "{" ? "}" : "]"
         let d = 0
         for (let j = i; j < text.length; j++) {
           if (text[j] === oc) d++
           if (text[j] === cc) d--
           if (d === 0) {
             const slice = text.slice(i, j + 1)
             try { JSON.parse(slice); if (slice.length > bestLen) { best = slice; bestLen = slice.length } } catch { break }
           }
         }
       }
       return best
     }

   function looksLikeJson(text: string): boolean {
    if (text.includes("<artifact")) return true
    let candidate = text.trim()
    if (candidate.startsWith("{") || candidate.startsWith("[")) return true
    const mdMatch = candidate.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (mdMatch) candidate = mdMatch[1].trim()
    try { JSON.parse(candidate); return true } catch {}
    return extractJsonFromText(candidate) !== null
  }

  const stepADescription = createMemo(() => {
    const id = params.id
    if (!id) return ""
    const partStore = sync.data.part as Record<string, { type: string; text?: string }[]>
    const aMsgId = stepAMessageId()
    if (aMsgId) {
      const allMsgs = (sync.data.message[id] ?? []) as Message[]
      if (allMsgs.some(m => m.id === aMsgId)) {
        const parts = partStore?.[aMsgId] ?? []
        // 合并全部 text part：部分 LLM 会把寒暄和正文拆成多个 part，只取第一个会丢正文
        const joined = joinTextParts(parts)
        if (joined) return extractSemanticLayout(stripFollowUpTags(stripThinkTags(joined)))
      }
    }
    const allMsgs = (sync.data.message[id] ?? []) as Message[]
    for (const msg of [...allMsgs].reverse()) {
      if (msg.role !== "assistant") continue
      const parts = partStore?.[msg.id] ?? []
      const hasToolCall = parts.some((p) => p.type === "tool")
      if (hasToolCall) continue
      const joined = joinTextParts(parts)
      if (!joined) continue
      const text = extractSemanticLayout(stripFollowUpTags(stripThinkTags(joined)))
      if (text.includes("<artifact")) continue
      if (looksLikeJson(text)) continue
      return text
    }
    return ""
  })

  createEffect(() => {
    const id = params.id
    if (!id) return
    const phase = stepPhase()
    if (phase !== "a-generating" && phase !== "a-done") return
    const partStore = sync.data.part as Record<string, { type: string; text?: string }[]>
    const allMsgs = (sync.data.message[id] ?? []) as Message[]
    for (const msg of [...allMsgs].reverse()) {
      if (msg.role !== "assistant") continue
      const parts = partStore?.[msg.id] ?? []
      const hasToolCall = parts.some((p) => p.type === "tool")
      if (hasToolCall) continue
      const text = joinTextParts(parts)
      if (!text) continue
      if (text.includes("<artifact")) continue
      if (looksLikeJson(text)) continue
      setStepAMessageId(msg.id)
      return
    }
  })

  // ── DSL → bridge 发送 ──────────────────────────────────────────
  createEffect(() => {
    const phase = stepPhase()
    if (phase !== "b-done") return
    const dslJson = stepBDslJsonPatched()
    debugLog("bridge-send:", { phase, dslJsonLen: dslJson?.length, bridgeRefExists: !!bridgeRef, dslJsonPreview: dslJson?.slice(0, 200) })
    if (!dslJson) return
    // 发送前把 resourceDetail.file 引用的 SVG 素材读盘内联为 icon_content/illus_content
    inlineAssetContents(dslDir ?? "", dslJson)
      .catch(() => dslJson)
      .then((inlined) => { try { bridgeRef?.post("NODE_DSL_JSON", JSON.parse(inlined)) } catch {} })
  })

   const stepBDslJson = createMemo(() => {
      const id = params.id
      if (!id) return ""
      const phase = stepPhase()
       if (phase !== "b-done" && phase !== "c-generating" && phase !== "c-done") return ""
      const partStore = sync.data.part as Record<string, { type: string; text?: string }[]>
       const allMsgs = (sync.data.message[id] ?? []) as Message[]
       const aMsgId = stepAMessageId()
       const aIdx = aMsgId ? allMsgs.findIndex(m => m.id === aMsgId) : -1
       const msgsAfterA = aIdx >= 0 ? allMsgs.slice(aIdx + 1) : allMsgs.slice(stepBStartIdx())
       const stepBMsg = [...msgsAfterA].reverse().find((m) => m.role === "assistant")
     if (!stepBMsg) { debugLog("stepBDslJson: no stepBMsg, phase=", phase); return "" }
     const parts = partStore?.[stepBMsg.id] ?? []
     const textPart = [...parts].reverse().find((p) => p.type === "text")
     if (!textPart?.text) { debugLog("stepBDslJson: no textPart, partTypes=", parts.map(p => p.type)); return "" }
      let text = stripThinkTags(textPart.text.trim())
      debugLog("stepBDslJson: raw text len=", text.length, "preview=", text.slice(0, 300))
      // 优先按 <node-dsl> 标签边界取（新契约，最稳）；无标签再走 <artifact> 兼容
      if (text.includes("<node-dsl>")) {
        text = extractNodeDsl(text)
      } else if (text.includes("<artifact")) {
       const parser = createArtifactParser()
       let artifactContent = ""
       for (const ev of parser.feed(text)) {
         if (ev.type === "artifact:end") artifactContent = ev.fullContent
       }
       for (const ev of parser.flush()) {
         if (ev.type === "artifact:end") artifactContent = ev.fullContent
       }
       if (!artifactContent) return ""
       text = artifactContent.trim()
     }

     // Strip markdown code blocks (greedy: take the LAST code block, not the first)
      const mdMatches = [...text.matchAll(/```(?:json)?\s*([\s\S]*)```/g)]
      if (mdMatches.length > 0) text = mdMatches[mdMatches.length - 1][1].trim()

      const extracted = extractJsonFromText(text)
      debugLog("stepBDslJson: extracted len=", extracted?.length ?? 0, "preview=", extracted?.slice(0, 200) ?? "null")
      return extracted ?? ""
     })


   // ── iframe 节点编辑（用户在编辑器中修改的属性） ──────────────
  const [dslNodeEdits, setDslNodeEdits] = createStore<Record<number, Record<string, string>>>({})


  // 清空编辑：session 切换或 step B 重新生成时
  createEffect(on(() => params.id, () => setDslNodeEdits({})))
  createEffect(on(() => stepPhase() === "b-generating", (isGenerating) => {
    if (isGenerating) setDslNodeEdits({})
  }))

  function applyNodeEdits(jsonStr: string): string {
    const edits = dslNodeEdits
    if (!jsonStr || Object.keys(edits).length === 0) return jsonStr
    try {
      const root = JSON.parse(jsonStr)
      function patchNode(node: Record<string, unknown>) {
        const nid = node.nid as number
        const edit = edits[nid]
        if (edit) Object.assign(node, edit)
        const children = node.children as Record<string, unknown>[] | undefined
        if (children) for (const c of children) patchNode(c)
      }
      if (Array.isArray(root)) for (const n of root) patchNode(n)
      else patchNode(root)
      return JSON.stringify(root)
    } catch {
      return jsonStr
    }
  }

   const stepBDslJsonPatched = createMemo(() => reconcileResources(applyNodeEdits(stepBDslJson())))

   const RESOURCE_DATA_FIELDS = ["resourceId", "resourceVectorText", "resourceScore", "resourceDetail", "resourceVariant"] as const

   // 资源对账：resourceId 不在工具真实返回集合里的节点剥离数据性字段（防编造）；
   // 在集合里的节点用工具真实输出程序化回填 resourceDetail（含 SVG），LLM 无需抄写。
   function reconcileResources(jsonStr: string): string {
     if (!jsonStr) return jsonStr
     const id = params.id
     if (!id) return jsonStr

      const partStore = sync.data.part as Record<string, { type: string; tool?: string; state?: { status: string; input?: { command?: string }; output?: string }; text?: string }[]>
      const allMsgs = (sync.data.message[id] ?? []) as Message[]
      const aMsgId = stepAMessageId()
      const aIdx = aMsgId ? allMsgs.findIndex(m => m.id === aMsgId) : -1
      const msgsSlice = aIdx >= 0 ? allMsgs.slice(aIdx + 1) : allMsgs.slice(stepBStartIdx())

      const realDataIds = new Set<string>()
      const realIconIds = new Set<string>()
      const realIllusIds = new Set<string>()
      const realDetailMap = new Map<string, Record<string, unknown>>()
      const realIconDetailMap = new Map<string, Record<string, unknown>>()
      const realIllusDetailMap = new Map<string, Record<string, unknown>>()
      // 素材内容（SVG 文本或 png base64）与变体级 file 条目。key 有两级：id 级（后写覆盖）
      // 与变体级（icon: "id|size|style|color"，illus: "id|theme"）。节点带 resourceVariant 时
      // 优先按变体级匹配，解决同 id 多变体互相覆盖
      const assetContentByKey = new Map<string, string>()
      const variantDetailMap = new Map<string, Record<string, unknown>>()
      const iconVariantKey = (id: string, size: unknown, style: unknown, color: unknown) => `${id}|${size ?? ""}|${style ?? ""}|${color ?? ""}`
      const illusVariantKey = (id: string, theme: unknown) => `${id}|${theme ?? ""}`
      // --save 模式的文件引用 JSON（{icon_id, file, size, style, color} / {illus_id, file, theme}）按变体建索引
      function collectVariantAssets(obj: unknown) {
        if (Array.isArray(obj)) {
          for (const item of obj) collectVariantAssets(item)
          return
        }
        if (!obj || typeof obj !== "object") return
        const rec = obj as Record<string, unknown>
        if (typeof rec.file === "string") {
          if (typeof rec.icon_id === "string") variantDetailMap.set(iconVariantKey(rec.icon_id, rec.size, rec.style, rec.color), rec)
          if (typeof rec.illus_id === "string") variantDetailMap.set(illusVariantKey(rec.illus_id, rec.theme), rec)
        }
        for (const val of Object.values(rec)) collectVariantAssets(val)
      }
      // 从命令行提取参数值（支持带引号含空格的值）
      const argValue = (cmd: string, name: string) => {
        const m = cmd.match(new RegExp(`--${name}\\s+(?:"([^"]*)"|'([^']*)'|(\\S+))`))
        return m ? (m[1] ?? m[2] ?? m[3]) : undefined
      }

      for (const msg of msgsSlice) {
        if (msg.role !== "assistant") continue
        const parts = partStore?.[msg.id] ?? []
        for (const part of parts) {
          if (part.type !== "tool") continue
          if (part.tool !== "bash" && part.tool !== "shell" && part.tool !== "webfetch") continue
          const state = part.state as Record<string, unknown> | undefined
          if (state?.status !== "completed" || typeof state.output !== "string") continue
          const input = state.input as Record<string, unknown> | undefined
          const cmd = typeof input?.command === "string" ? input.command : ""
          const url = typeof input?.url === "string" ? input.url : ""
          // 既识别直连 URL，也识别 api-call.ts 脚本调用（脚本封装了 URL，命令里只有子命令名）
          const isResourceCall = cmd.includes("/lib-resource-service/api/vector/") || url.includes("/lib-resource-service/api/vector/") || cmd.includes("/iconPlus/") || url.includes("/iconPlus/") || cmd.includes("/illusPlus/") || url.includes("/illusPlus/") || cmd.includes("api-call.ts")
          if (!isResourceCall) continue
          const out = state.output as string
          try {
            const parsed = JSON.parse(out)
            collectDataIds(parsed, realDataIds, realIconIds, realIllusIds)
            collectDetails(parsed, realDetailMap, realIconDetailMap, realIllusDetailMap)
            collectVariantAssets(parsed)
          } catch {
            // 非 JSON 输出（未带 --save 的回退路径）：裸 SVG 或 png 的 base64
            const isSvg = out.includes("<svg")
            const isPng = argValue(cmd, "fileType") === "png" && /^[A-Za-z0-9+/=\r\n]+$/.test(out.trim())
            if (!isSvg && !isPng) continue
            const content = isSvg
              ? (() => {
                  const start = out.indexOf("<svg")
                  const end = out.lastIndexOf("</svg>")
                  return end > start ? out.slice(start, end + 6) : out.slice(start).trim()
                })()
              : out.trim()
            const id = argValue(cmd, "icon_id") ?? argValue(cmd, "illus_id")
            if (!id || id.includes(",")) continue
            assetContentByKey.set(id, content)
            if (/\bgetSvg\b/.test(cmd)) {
              realIconIds.add(id)
              assetContentByKey.set(iconVariantKey(id, argValue(cmd, "size"), argValue(cmd, "style"), argValue(cmd, "color")), content)
            } else {
              realIllusIds.add(id)
              assetContentByKey.set(illusVariantKey(id, argValue(cmd, "theme") ?? "浅色"), content)
            }
          }
        }
      }

      const allValidIds = new Set([...realDataIds, ...realIconIds, ...realIllusIds])

       try {
         const root = JSON.parse(jsonStr)
         function cleanNode(node: Record<string, unknown>) {
           const rid = node.resourceId as string | undefined
           if (!rid || !allValidIds.has(rid)) {
             // resourceId 缺失或不在工具真实返回集合里 → 属于编造，剥离全部数据性字段
             for (const f of RESOURCE_DATA_FIELDS) delete node[f]
           } else {
             // 程序化回填：resourceDetail 以工具真实输出为准。LLM 不再抄写 detail（prompt 已
             // 要求省略），旧输出里抄了的也会被真实数据覆盖，抄错不再导致资源整体丢失。
             const cachedDetail = realDetailMap.get(rid) ?? realIconDetailMap.get(rid) ?? realIllusDetailMap.get(rid)
             // 节点带 resourceVariant（LLM 自己的调用参数）时按变体级精确匹配素材，
             // 避免同 id 多变体（不同 size/color/theme）被"后写覆盖"串台
             const variant = node.resourceVariant as Record<string, unknown> | undefined
             const variantKey = variant
               ? realIconIds.has(rid)
                 ? iconVariantKey(rid, variant.size, variant.style, variant.color)
                 : illusVariantKey(rid, variant.theme)
               : null
             // detail 完全由工具真实输出构成，不 spread node.resourceDetail：prompt 已禁止
             // LLM 输出该字段，它若违规塞了搜索浅记录（{data_id, vector_text, score}）会污染结果
             const detail: Record<string, unknown> = {
               ...(cachedDetail ?? {}),
               ...((variantKey ? variantDetailMap.get(variantKey) : undefined) ?? {}),
             }
             // 素材内容（SVG 文本 / png base64）来自未带 --save 的回退输出，单独回填
             const content = (variantKey ? assetContentByKey.get(variantKey) : undefined) ?? assetContentByKey.get(rid)
             if (content) {
               if (realIconIds.has(rid)) detail.icon_content = content
               else detail.illus_content = content
             }
              if (realIconIds.has(rid) && detail.icon_content === undefined && typeof detail.data === "string" && detail.data.includes("<svg")) {
                detail.icon_content = detail.data
                delete detail.data
              }
              if (!realIconIds.has(rid) && detail.illus_content === undefined && typeof detail.data === "string" && detail.data.includes("<svg")) {
                detail.illus_content = detail.data
                delete detail.data
              }
             // 有真实数据才写；否则删掉（含 LLM 违规输出的 resourceDetail），符合"无数据则省略"
             if (Object.keys(detail).length > 0) node.resourceDetail = detail
             else delete node.resourceDetail
           }
          const children = node.children as Record<string, unknown>[] | undefined
          if (children) for (const c of children) cleanNode(c)
        }
        if (Array.isArray(root)) for (const n of root) cleanNode(n)
        else cleanNode(root)
        return JSON.stringify(root)
      } catch {
        return jsonStr
      }
   }

    function collectDataIds(obj: unknown, ids: Set<string>, iconIds?: Set<string>, illusIds?: Set<string>) {
      if (Array.isArray(obj)) {
        for (const item of obj) collectDataIds(item, ids, iconIds, illusIds)
      } else if (obj && typeof obj === "object") {
        const rec = obj as Record<string, unknown>
        if (typeof rec.data_id === "string") ids.add(rec.data_id)
        if (iconIds && typeof rec.icon_id === "string") iconIds.add(rec.icon_id)
        if (illusIds && typeof rec.illus_id === "string") illusIds.add(rec.illus_id)
        for (const val of Object.values(rec)) collectDataIds(val, ids, iconIds, illusIds)
      }
    }

    // 同一 id 可能出现多次（vectorSearch 的浅记录在前、vectorDetail 的完整记录在后），
    // 作为回填数据源必须合并累积（后到覆盖先到），不能先到先得
    function collectDetails(obj: unknown, map: Map<string, Record<string, unknown>>, iconDetailMap?: Map<string, Record<string, unknown>>, illusDetailMap?: Map<string, Record<string, unknown>>) {
      if (Array.isArray(obj)) {
        for (const item of obj) collectDetails(item, map, iconDetailMap, illusDetailMap)
      } else if (obj && typeof obj === "object") {
        const rec = obj as Record<string, unknown>
        if (typeof rec.data_id === "string") {
          const { results, data_id, vector_text, score, ...detail } = rec
          if (Object.keys(detail).length > 1) map.set(rec.data_id, { ...map.get(rec.data_id) ?? {}, ...detail })
        }
        if (iconDetailMap && typeof rec.icon_id === "string") {
          const { results, score, ...detail } = rec
          if (Object.keys(detail).length > 1) iconDetailMap.set(rec.icon_id, { ...iconDetailMap.get(rec.icon_id) ?? {}, ...detail })
        }
        if (illusDetailMap && typeof rec.illus_id === "string") {
          const { results, keyword, score, ...detail } = rec
          if (Object.keys(detail).length > 1) illusDetailMap.set(rec.illus_id, { ...illusDetailMap.get(rec.illus_id) ?? {}, ...detail })
        }
        for (const val of Object.values(rec)) collectDetails(val, map, iconDetailMap, illusDetailMap)
      }
    }

  // ── 产物持久化 ─────────────────────────────────────────────
  const dslDir = projectDir()

  // 仅在本 session「真正生成完成」（a-generating → a-done 的转换）时存盘一次。
  // 切回已完成的 session 走 inferFromCache（其它 phase → a-done，prevPhase 非 a-generating），
  // 由 restore effect 从缓存/磁盘恢复，不在此重算——避免用未同步全的消息覆盖磁盘正确产物，
  // 也避免误取到步骤二 JSON 消息把步骤一产物覆盖。on 回调内读 stepADescription 不建立依赖。
  createEffect(on(stepPhase, (phase, prevPhase) => {
    const id = params.id
    if (!id || !dslDir) return
    if (phase === "a-done" && prevPhase === "a-generating" && !isBusy()) {
      const text = stepADescription()
      // ── 调试：打印 step A 捕获到的原始 part 文本 vs 清洗后文本 ──
      const partStore = sync.data.part as Record<string, { type: string; text?: string }[]>
      const aMsgId = stepAMessageId()
      const rawPart = aMsgId ? (partStore?.[aMsgId] ?? []).find((p) => p.type === "text") : undefined
      debugLog("=== STEP A 完成, 本地捕获数据 ===")
      debugLog("[raw part.text] 未清洗, length:", rawPart?.text?.length ?? 0)
      debugLog("[raw part.text] 全文:\n", rawPart?.text)
      debugLog("[stepADescription] 清洗后, length:", text?.length ?? 0)
      debugLog("[stepADescription] 全文:\n", text)
      if (text) {
        setStepAArtifact(text)
        cacheArtifact(id, { a: text })
        saveArtifact(dslDir, id, "a", text).catch(() => {})
      }
    }
  }))

  // 仅在本 session「真正生成完成」（b-generating → b-done 的转换）时存盘一次。
  // 切回已完成的 session 走 inferFromCache，是「其它 phase → b-done」，prevPhase 非 b-generating，
  // 不在此重复提取+存盘——恢复由下方 restore effect 从缓存/磁盘负责，避免用未同步全的消息
  // 重算并覆盖磁盘上已正确的产物。on 回调内读 stepBDslJson 不建立依赖，故 sync 流式变化不会反复触发。
  createEffect(on(stepPhase, (phase, prevPhase) => {
    const id = params.id
    if (!id || !dslDir) return
    if (phase !== "b-done" || prevPhase !== "b-generating") return
    if (isBusy()) return
    const json = stepBDslJson()
    if (!json) return
    // 存盘/缓存回填后的版本：恢复会话时直接发给 iframe，resourceDetail（含 SVG）完整
    const reconciled = reconcileResources(json)
    setStepBArtifact(reconciled)
    cacheArtifact(id, { b: reconciled })
    saveArtifact(dslDir, id, "b", reconciled).catch(() => {})
  }))

  function handleZipData(zipData: ArrayBuffer) {
    const id = params.id
    if (!id || !dslDir) return
    if (!isZipBuffer(zipData)) {
      debugLog("handleZipData: 收到的不是合法 zip，丢弃，bytes:", zipData?.byteLength ?? 0)
      return
    }
    setStepCArtifact(zipData)
    cacheArtifact(id, { c: zipData })
    saveArtifact(dslDir, id, "c", zipData).catch(() => {})
  }

  createEffect(on(() => params.id, (id) => {
    if (!id || !dslDir) return
    const targetId = id
    const cached = artifactCache.get(id)
    if (cached) {
      // 切回已生成过的 session：同步恢复产物（phase 已由 Effect A 从同一缓存推断）
      setStepAArtifact(cached.a)
      setStepBArtifact(cached.b)
      setStepCArtifact(cached.c)
    } else {
      // phase / bInitiated / cConfirmed 已由 Effect A 的 inferFromCache 统一决定，这里只清产物
      setStepAArtifact(null)
      setStepBArtifact(null)
      setStepCArtifact(null)
    }
    // 始终从磁盘刷新（缓存可能缺失/过期），并回填缓存
    loadArtifact(dslDir, id, "a").then((data) => {
      if (params.id !== targetId) return
      if (typeof data === "string") { setStepAArtifact(data); cacheArtifact(targetId, { a: data }) }
    }).catch(() => {})
    loadArtifact(dslDir, id, "b").then((data) => {
      if (params.id !== targetId) return
      if (typeof data === "string") {
        setStepBArtifact(data); cacheArtifact(targetId, { b: data })
      } else if (stepPhase() === "b-done") {
        // 内存缓存/inferFromCache 说 b-done，但磁盘没有有效 b 产物（0 字节/不存在）。
        // 磁盘是唯一真相源 → 清掉过期缓存/信号并回退步骤一，避免空产物却停在步骤二。
        debugLog("restore: 磁盘无有效 b 产物但 phase=b-done，回退步骤一，session:", targetId)
        setStepBArtifact(null)
        cacheArtifact(targetId, { b: null })
        persistHint(targetId, 1, { allowLower: true })
        setStepPhase("a-done")
      }
    }).catch(() => {})
    loadArtifact(dslDir, id, "c").then((data) => {
      if (params.id !== targetId) return
      if (data instanceof ArrayBuffer && isZipBuffer(data)) {
        debugLog("restore: 磁盘存在有效 zip，session:", targetId, "bytes:", data.byteLength, "→ 将恢复到步骤三")
        setStepCArtifact(data)
        setStepCConfirmed(true)
        cacheArtifact(targetId, { c: data })
      } else {
        if (data instanceof ArrayBuffer && data.byteLength > 0) {
          // 损坏 / 非 zip 的孤儿产物：清掉，避免恢复到步骤三时把坏数据发给 iframe 报错
          debugLog("restore: 磁盘 c 产物不是合法 zip，清除，session:", targetId, "bytes:", data.byteLength)
          clearArtifacts(dslDir, targetId, "c").catch(() => {})
        } else {
          debugLog("restore: 无磁盘 zip，session:", targetId)
        }
        if (stepPhase() === "c-done") {
          // 同理：phase=c-done 但磁盘无有效 zip → 以磁盘为准回退（有 b 退到步骤二，否则步骤一）
          debugLog("restore: 磁盘无有效 zip 但 phase=c-done，回退，session:", targetId)
          setStepCArtifact(null)
          setStepCConfirmed(false)
          cacheArtifact(targetId, { c: null })
          persistHint(targetId, stepBArtifact() ? 1 : 1, { allowLower: true })
          setStepPhase(stepBArtifact() ? "b-done" : "a-done")
        }
      }
    }).catch(() => {})
  }))

  // ── c-done 检测：产物加载后自动推进 ──────────────────────
  createEffect(() => {
    const id = params.id
    if (!id) return
    if (stepPhase() === "b-done" && stepCConfirmed()) {
      setStepPhase("c-done")
    }
  })

  const info = createMemo(() => (params.id ? sync.session.get(params.id) : undefined))

  const sessionStatus = createMemo((): SessionStatus => {
    const id = params.id
    if (!id) return { type: "idle" }
    if (sync.data.message[id] === undefined) return { type: "busy" }
    const status = sync.data.session_status[id] ?? { type: "idle" }
    debugLog("sessionStatus:", { id, status: status.type })
    return status
  })

  const isBusy = createMemo(() => sessionStatus().type !== "idle")

  // ── 结算后的 phase → 持久化 manifest 提示 ────────────────────
  // 只在 idle 完成态(a/b/c-done)写入，generating 态不写；默认只升不降，
  // 让冷启动 inferFromCache 能直达目标步骤。真正的回退在各自的回退点显式 allowLower。
  createEffect(() => {
    const id = params.id
    if (!id || isBusy()) return
    const phase = stepPhase()
    const step = phase === "c-done" ? 2 : phase === "b-done" ? 1 : phase === "a-done" ? 1 : 0
    if (step > 0) persistHint(id, step)
  })

  const hasStepBData = createMemo(() => {
    const id = params.id
    if (!id) return false
    const aMsgId = stepAMessageId()
    const partStore = sync.data.part as Record<string, { type: string; text?: string }[]>
    const allMsgs = (sync.data.message[id] ?? []) as Message[]
    const aIdx = aMsgId ? allMsgs.findIndex(m => m.id === aMsgId) : -1
    const msgsAfterA = aIdx >= 0 ? allMsgs.slice(aIdx + 1) : allMsgs.slice(stepBStartIdx())
    for (const msg of [...msgsAfterA].reverse()) {
      if (msg.role !== "assistant") continue
      const parts = partStore?.[msg.id] ?? []
      const textPart = [...parts].find((p) => p.type === "text")
      if (!textPart?.text) continue
      return looksLikeJson(stripThinkTags(textPart.text.trim()))
    }
    return false
  })

   createEffect(() => {
    const id = params.id
    if (!id) return
    const busy = isBusy()
    if (busy) { debugLog("phase-advance: busy, skip"); return }
    const phase = stepPhase()
    const partStore = sync.data.part as Record<string, { type: string; text?: string }[]>
    const allMsgs = (sync.data.message[id] ?? []) as Message[]
    const lastAssistant = [...allMsgs].reverse().find((m) => m.role === "assistant")
    if (!lastAssistant) { debugLog("phase-advance: no lastAssistant, phase=", phase); return }
    const lastParts = partStore?.[lastAssistant.id] ?? []
    const hasToolCall = lastParts.some((p) => p.type === "tool")
    const hasStepB = hasStepBData()
    debugLog("phase-advance:", { phase, hasStepB, hasToolCall, partTypes: lastParts.map(p => p.type), lastMsgId: lastAssistant.id })
    if (phase === "a-generating") {
      if (hasToolCall) { debugLog("phase-advance: a-generating hasToolCall, skip"); return }
      if (hasStepB) {
        if (stepBInitiated() || stepBArtifact() !== null) {
          setStepBInitiated(true)
          setStepPhase("b-done")
        } else {
          setStepPhase("a-done")
        }
      } else {
        setStepPhase("a-done")
      }
    } else if (phase === "b-generating") {
      if (hasStepB) {
        debugLog("phase-advance: b-generating + hasStepB → advancing to b-done (hasToolCall=", hasToolCall, ")")
        if (stepBInitiated() || stepBArtifact() !== null) setStepPhase("b-done")
      } else {
        if (hasToolCall) { debugLog("phase-advance: b-generating no stepB data + hasToolCall, skip"); return }
        debugLog("phase-advance: b-generating no stepB data, staying")
      }
    }
  })

  async function sendStepB(text: string) {
    const sessionId = params.id
    debugLog("sendStepB called:", { sessionId, textLen: text?.length, textPreview: text?.slice(0, 100), isBusy: isBusy() })
    if (!sessionId) return
    if (isBusy()) return
    const allMsgs = (sync.data.message[sessionId] ?? []) as Message[]
    setStepBStartIdx(allMsgs.length)
    setStepBArtifact(null)
    setStepCArtifact(null)
    setStepCConfirmed(false)
    cacheArtifact(sessionId, { b: null, c: null })
    // 重新生成步骤二会清掉步骤三产物：若原本停在 c-done(hint=3)，显式把提示降到 2
    persistHint(sessionId, 1, { allowLower: true })
    if (dslDir) clearArtifacts(dslDir, sessionId, "b", "c").catch(() => {})
    setStepBInitiated(true)
    setStepPhase("b-generating")
    // 清空 iframe 步骤二里残留的上一份线框，否则 b-done 前会一直显示旧 DSL
    bridgeRef?.post("NODE_DSL_CLEAR", undefined)
    try {
      const textPart: TextPartInput = { type: "text", text }
      const modelKey = activeModelKey()
      if (!modelKey) return
      // 把 api-call.ts 落盘到项目 .octo/dslToHex/ 下，agent 用相对项目目录的路径即可命中；
      // 桌面端落盘成功走相对路径，纯 web 写不了盘则回退。
      const wroteScript = dslDir ? await ensureApiCallScript(dslDir, API_CALL_SOURCE).catch(() => false) : false
      const apiCallScript = wroteScript ? API_CALL_SCRIPT_MATERIALIZED : API_CALL_SCRIPT_FALLBACK
      // SVG 素材落盘目录（api-call.ts --save），与该 session 的产物同级
      const assetsDir = `.octo/dslToHex/${sessionId}/assets`
      const systemPrompt = STEP_B_PROMPT
        .replace(/\$\{VECTOR_API_BASE\}/g, VECTOR_API_BASE)
        .replace(/\$\{API_CALL_SCRIPT\}/g, apiCallScript)
        .replace(/\$\{ASSETS_DIR\}/g, assetsDir)
      await sdk.client.session.prompt({
        sessionID: sessionId,
        agent: "octo_dsl",
        system: systemPrompt,
        tools: STEP_B_TOOLS,
        ...(modelKey ? { model: modelKey } : {}),
        parts: [textPart],
      })
    } catch (err) {
      console.error("[MakePage] stepB prompt failed", err)
      setStepPhase("a-done")
    }
  }

  // ── 会话进度条动画状态 ────────────────────────────────────
  const [timeoutDone, setTimeoutDone] = createSignal(true)
  const workingStatus = createMemo<"hidden" | "showing" | "hiding">((prev) => {
    if (isBusy()) return "showing"
    if (prev === "showing" || !timeoutDone()) return "hiding"
    return "hidden"
  })
  createEffect(() => {
    if (workingStatus() !== "hiding") return
    setTimeoutDone(false)
    const id = setTimeout(() => setTimeoutDone(true), 260)
    onCleanup(() => clearTimeout(id))
  })

  const [bar, setBar] = createStore({ ms: 1800 })

  // ── 执行计时器 ────────────────────────────────────────────
  const [elapsedText, setElapsedText] = createSignal("")
  let elapsedTimer: ReturnType<typeof setInterval> | undefined
  createEffect(() => {
    if (isBusy()) {
      const id = params.id
      if (id) {
        const messages = (sync.data.message[id] ?? []) as Message[]
        const pending = [...messages].reverse().find((m) => m.role === "assistant" && typeof m.time.completed !== "number")
        if (pending) {
          const start = pending.time.created
          const fmt = () => {
            const secs = Math.round((Date.now() - start) / 1000)
            const m = Math.floor(secs / 60)
            const s = secs % 60
            setElapsedText(m > 0 ? `${m}分${s}秒` : `${s}秒`)
          }
          fmt()
          elapsedTimer = setInterval(fmt, 1000)
        }
      }
    } else {
      if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = undefined }
      setElapsedText("")
    }
    onCleanup(() => { if (elapsedTimer) clearInterval(elapsedTimer) })
  })

  // ── 阻塞检测计时器 ────────────────────────────────────────────
  const [lastDeltaTime, setLastDeltaTime] = createSignal(Date.now())
  const [blockTime, setBlockTime] = createSignal(0)
  let blockTimer: ReturnType<typeof setInterval> | undefined
  createEffect(() => {
    if (isBusy()) {
      setLastDeltaTime(Date.now())
      blockTimer = setInterval(() => {
        const blockedMs = Date.now() - lastDeltaTime()
        if (blockedMs > 3000) {
          setBlockTime(Math.floor(blockedMs / 1000))
        }
      }, 1000)
    } else {
      if (blockTimer) { clearInterval(blockTimer); blockTimer = undefined }
      setLastDeltaTime(Date.now())
      setBlockTime(0)
    }
    onCleanup(() => { if (blockTimer) clearInterval(blockTimer) })
  })

  const [prompt, setPrompt] = createSignal("")
  const [sending, setSending] = createSignal(false)
  const hasContent = () => !!(params.id && userMessages().length > 0)
  const [attachments, setAttachments] = createSignal<Attachment[]>([])
  let sendingNavigation = false
  const [isDragOver, setIsDragOver] = createSignal(false)

  // ── Slash Command Popover State ──
  const [slashState, setSlashState] = createSignal<{ query: string; cursor: number } | null>(null)
  const [slashIndex, setSlashIndex] = createSignal(0)
  let textareaRef!: HTMLTextAreaElement

  // ── Slash Command List ──
  interface SlashCommand {
    trigger: string
    title: string
    description?: string
    id: string
    source: "builtin" | "command" | "mcp"
  }

  const slashCommands = createMemo<SlashCommand[]>(() => {
    const list: SlashCommand[] = []

    // Builtin commands - TEMPORARILY HIDDEN (keep system configuration intact)
    // const builtinCommands = command.options.filter(opt => opt.slash)
    // for (const opt of builtinCommands) {
    //   list.push({
    //     trigger: opt.slash!,
    //     title: opt.title,
    //     description: opt.description,
    //     id: opt.id,
    //     source: "builtin",
    //   })
    // }

    // Custom commands from sync.data.command - Only show MCP commands
    const customCommands = sync.data?.command ?? []
    for (const cmd of customCommands) {
      // Temporary filter: hide project-level commands, only show MCP
      if (cmd.source !== "mcp") continue
      list.push({
        trigger: cmd.name,
        title: cmd.name,
        description: cmd.description,
        id: cmd.name,
        source: cmd.source as "command" | "mcp",
      })
    }

    // Sort alphabetically
    list.sort((a, b) => a.trigger.localeCompare(b.trigger))
    return list
  })

  const filteredSlash = createMemo(() => {
    const query = slashState()?.query ?? ""
    if (!query) return slashCommands()

    const lowerQuery = query.toLowerCase()
    return slashCommands().filter(cmd =>
      (cmd.trigger?.toLowerCase() ?? "").includes(lowerQuery) ||
      (cmd.title?.toLowerCase() ?? "").includes(lowerQuery) ||
      (cmd.description?.toLowerCase() ?? "").includes(lowerQuery)
    )
  })
  const DS_KEY_PREFIX = "octo:make:design-system:"
  const PROMPT_KEY_PREFIX = "octo:make:prompt:"
  const dsKey = () => params.id ? DS_KEY_PREFIX + params.id : null
  const [selectedDesignSystem, setSelectedDesignSystem] = createSignal<string | null>(null)
  createEffect(() => {
    const key = dsKey()
    if (!key) return
    const id = selectedDesignSystem()
    if (id) localStorage.setItem(key, id)
    else localStorage.removeItem(key)
  })
  createEffect(on(() => params.id, (id) => {
    if (!id) return
    const saved = localStorage.getItem(DS_KEY_PREFIX + id)
    setSelectedDesignSystem(saved ?? null)
  }))

  // 保存 prompt 到 localStorage
  function savePromptToStorage(sessionId: string | undefined, text: string) {
    if (!sessionId) return
    const key = PROMPT_KEY_PREFIX + sessionId
    if (text.trim()) localStorage.setItem(key, text)
    else localStorage.removeItem(key)
  }
  // 加载 prompt from localStorage
  function loadPromptFromStorage(sessionId: string | undefined): string {
    if (!sessionId) return ""
    return localStorage.getItem(PROMPT_KEY_PREFIX + sessionId) ?? ""
  }

  // 追踪当前 session ID 用于保存 prompt
  let currentSessionIdForPrompt: string | undefined = params.id
  // prompt 变化时立即保存到当前 session
  createEffect(on(prompt, (text) => {
    savePromptToStorage(currentSessionIdForPrompt, text)
  }, { defer: true }))
  // 切换 session 时：更新追踪 ID 并加载新 prompt
  createEffect(on(() => params.id, (newId) => {
    currentSessionIdForPrompt = newId
    setPrompt(loadPromptFromStorage(newId))
  }))
  // 对话面板宽度：从 localStorage 恢复，无存储值时取默认 460px
  const CHAT_WIDTH_KEY = "octo:make:chat-width"
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

  /** 聊天面板分隔线拖拽调整宽度 */
  function handleDividerMouseDown(e: MouseEvent) {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = chatWidth()
    
    const overlay = document.createElement("div")
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 9999;
      cursor: col-resize;
      background: transparent;
    `
    document.body.appendChild(overlay)
    
    const onMove = (ev: MouseEvent) => {
      setChatWidth(Math.max(MIN_CHAT, Math.min(MAX_CHAT, startWidth + ev.clientX - startX)))
    }
    const onUp = () => {
      overlay.remove()
      localStorage.setItem(CHAT_WIDTH_KEY, String(chatWidth()))
      overlay.removeEventListener("mousemove", onMove)
      overlay.removeEventListener("mouseup", onUp)
      dragCleanup = null
    }
    overlay.addEventListener("mousemove", onMove)
    overlay.addEventListener("mouseup", onUp)
    dragCleanup = () => {
      overlay.remove()
      overlay.removeEventListener("mousemove", onMove)
      overlay.removeEventListener("mouseup", onUp)
      dragCleanup = null
    }
  }

  onCleanup(() => { dragCleanup?.() })



  // 自动滚动：session busy 时保持对话区随新内容跟随到底部
  const autoScroll = createAutoScroll({ working: isBusy })





  // ── session 操作 ──────────────────────────────────────────

  /** 创建新 session 并导航 */
  async function createAndNavigate(): Promise<string | undefined> {
    const dir = sdk.directory
    console.log("[MakePage] createAndNavigate dir:", dir)
    if (!dir) return
    setSending(true)
    try {
      const result = await sdk.client.session.create({ directory: dir, agent: "octo_hex" })
      const session = result.data as Session | undefined
      console.log("[MakePage] session created:", { id: session?.id, agent: session?.agent, directory: session?.directory })
      if (session) {
        navigate(`/dslToHex/${session.id}`)
        return session.id
      }
    } catch (err) {
      console.error("[MakePage] session.create failed", err)
    } finally {
      setSending(false)
    }
    return undefined
  }

  /** 发送消息：组装 Step A 提示词，调用 session.prompt */
  async function sendMessage(sessionId: string, text: string) {
    // 重新生成步骤一会让下游产物（步骤二 DSL / 步骤三 zip）全部失效，
    // 必须连同 signal / 缓存 / 磁盘一起清掉，否则切走再切回会被旧产物带到步骤二/三。
    setStepPhase("a-generating")
    setStepBInitiated(false)
    setStepCConfirmed(false)
    setStepBArtifact(null)
    setStepCArtifact(null)
    setStepAMessageId(null)
    setStepBStartIdx(0)
    cacheArtifact(sessionId, { b: null, c: null })
    if (dslDir) clearArtifacts(dslDir, sessionId, "b", "c").catch(() => {})
    bridgeRef?.post("NODE_DSL_CLEAR", undefined)
    try {
      const fileParts: FilePartInput[] = attachments().map((a) => ({
        type: "file",
        mime: a.mime,
        filename: a.filename,
        url: a.dataUrl,
      }))
      const textPart: TextPartInput = { type: "text", text }
      const modelKey = activeModelKey()
      if (!modelKey) return
      debugLog("sendMessage STEP_A_DISABLED_TOOLS:", STEP_A_DISABLED_TOOLS)
      await sdk.client.session.prompt({
        sessionID: sessionId,
        agent: "octo_hex",
        system: STEP_A_PROMPT,
        tools: STEP_A_DISABLED_TOOLS,
        ...(modelKey ? { model: modelKey } : {}),
        parts: [textPart, ...fileParts],
      })
      setAttachments([])
    } catch (err) {
      console.error("[MakePage] prompt failed", err)
    }
  }

  /** 提交 prompt：自动创建 session → 发送消息 */
  async function handleSubmit() {
    const text = prompt().trim()
    if (!text || sending() || !activeModelKey()) return
    setSending(true)
    setPrompt("")
    const submitSessionId = params.id
    try {
      let sid = submitSessionId
      if (!sid) {
        const dir = sdk.directory
        if (!dir) return
const result = await sdk.client.session.create({ directory: dir, agent: "octo_hex" })
      const session = result.data as Session | undefined
      if (!session) return
      const dsId = selectedDesignSystem()
if (dsId) {
          localStorage.setItem(DS_KEY_PREFIX + session.id, dsId)
        }
        sendingNavigation = true
        navigate(`/dslToHex/${session.id}`)
        sid = session.id
      }
      await sendMessage(sid, text)
    } catch (err) {
      console.error("[MakePage] handleSubmit failed", err)
    } finally {
      // Only reset if we're still on the same session (or still on no session)
      if (!submitSessionId || params.id === submitSessionId) {
        setSending(false)
      }
    }
  }

  /** 终止当前生成 */
  async function halt() {
    const sid = params.id
    if (!sid) return
    await sdk.client.session.abort({ sessionID: sid }).catch(() => {})
  }

  /** Handle keyboard events including slash command navigation */
  function handleKeyDown(e: KeyboardEvent) {
    const slash = slashState()

    // Slash command navigation
    if (slash) {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        e.stopPropagation()
        setSlashIndex(i => Math.min(i + 1, filteredSlash().length - 1))
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        e.stopPropagation()
        setSlashIndex(i => Math.max(i - 1, 0))
        return
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault()
        e.stopPropagation()
        const cmds = filteredSlash()
        if (cmds.length > 0) {
          pickSlash(cmds[slashIndex()])
        }
        return
      }
      if (e.key === "Escape") {
        e.preventDefault()
        e.stopPropagation()
        setSlashState(null)
        return
      }
    }

    // Enter to send (only when slash popover is closed)
    if (e.key === "Enter" && !e.shiftKey && !slash) {
      e.preventDefault()
      void handleSubmit()
    }
  }

  /** Handle input changes and detect slash trigger */
  function handleInput(e: InputEvent) {
    const ta = e.currentTarget as HTMLTextAreaElement
    const value = ta.value
    const cursor = ta.selectionStart

    setPrompt(value)

    // Detect slash trigger: /^\/([^\s/]*)$/
    const slashMatch = value.match(/^\/([^\s/]*)$/)
    if (slashMatch && cursor === value.length) {
      setSlashState({ query: slashMatch[1] ?? "", cursor })
      setSlashIndex(0)
    } else {
      setSlashState(null)
    }
  }

  /** Pick a slash command and insert into textarea */
  function pickSlash(cmd: SlashCommand) {
    if (!slashState()) return

    const ta = textareaRef
    const before = prompt()
    
    // Replace `/query` with `/trigger `
    const replaced = before.replace(/^\/([^\s/]*)$/, `/${cmd.trigger} `)
    setPrompt(replaced)
    setSlashState(null)

    // Focus textarea and position cursor at end
    requestAnimationFrame(() => {
      ta.focus()
      ta.setSelectionRange(replaced.length, replaced.length)
    })
  }

  // ── 附件管理 ─────────────────────────────────────────────

  let fileInputRef!: HTMLInputElement

  /** 添加文件附件（最多 5 个） */
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

  /** 移除附件 */
  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  /** 文件选择回调 */
  function handleFileInputChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement
    if (input.files?.length) {
      addAttachments(Array.from(input.files))
      input.value = ""
    }
  }

  /** 拖拽悬停 */
  function handleDragOver(e: DragEvent) {
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"
    setIsDragOver(true)
  }

  /** 拖拽离开 */
  function handleDragLeave() {
    setIsDragOver(false)
  }

  /** 拖拽放置 → 添加文件附件 */
  function handleDrop(e: DragEvent) {
    e.preventDefault()
    setIsDragOver(false)
    const files = Array.from(e.dataTransfer?.files ?? [])
    if (files.length > 0) addAttachments(files)
  }



  const questionRequest = createMemo<QuestionRequest | undefined>(() => {
    if (!params.id) return
    return sessionQuestionRequest(sync.data.session, sync.data.question, params.id)
  })

  const inputDisabled = () => sending() || isBusy() || !activeModelKey() || !!questionRequest()
  const maxAttachments = () => attachments().length >= 5

  return (
    <DataProvider data={sync.data} directory={sdk.directory || ""}>
      <div
        class="octo-dslToHex octo-split bg-background-base"
        data-focus={focusMode() ? "true" : undefined}
        style={{
          "grid-template-columns": !focusMode()
            ? hasContent()
              ? `${chatWidth()}px 8px minmax(0, 1fr)`
              : "1fr"
            : undefined,
        }}
      >

        {/* ── 左栏：对话面板 ──── */}
        <Show when={!focusMode()}>
          <div
            class="flex flex-col overflow-hidden"
            style={{
              background: isDragOver() ? "var(--octo-brand-a3)" : "#fff",
              outline: isDragOver() ? "inset 0 0 0 2px var(--octo-brand-a25)" : "none",
            }}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {/* 标题栏 */}
            <Show when={hasContent()}>
              <div style={{ position: "relative" }}>
                <Show when={workingStatus() !== "hidden" && settings.general.showSessionProgressBar()}>
                  <div
                    data-component="session-progress"
                    data-state={workingStatus()}
                    aria-hidden="true"
                    style={{
                      "--session-progress-color": "var(--octo-brand)",
                      "--session-progress-ms": `${bar.ms}ms`,
                    }}
                  >
                    <div data-component="session-progress-bar" />
                  </div>
                </Show>
                <div
                  class="shrink-0 flex items-center justify-between"
                  style={{ padding: "12px 24px", height: "56px", background: "#fff", "border-bottom": "1px solid rgba(0,0,0,0.1)" }}
                >
                <div class="flex items-center gap-2 min-w-0 flex-1 pr-3">
                  <Show when={isBusy()}>
                    <div class="shrink-0 flex items-center gap-1.5">
                      <Spinner class="size-4" />
                    </div>
                  </Show>
                  <Show
                    when={!titleState.editing}
                    fallback={
                      <InlineInput
                        ref={(el) => { titleRef = el }}
                        value={titleState.draft}
                        class="text-14-medium text-text-strong grow-1 min-w-0 rounded-[6px] pl-1 -ml-1"
                        onInput={(e) => setTitleState("draft", e.currentTarget.value)}
                        onKeyDown={(e) => {
                          e.stopPropagation()
                          if (e.key === "Enter") { e.preventDefault(); void saveTitleEditor() }
                          if (e.key === "Escape") { e.preventDefault(); setTitleState("editing", false) }
                        }}
                        onBlur={() => void saveTitleEditor()}
                      />
                    }
                  >
                    <h1
                      class="truncate min-w-0"
                      style={{ "font-size": "14px", "line-height": "22px", "font-weight": "600", color: "#191919" }}
                      onDblClick={openTitleEditor}
                    >
                      {sessionTitle(overrideTitle() ?? info()?.title ?? sessionInfo()?.title) ?? "Octo Design"}
                    </h1>
                  </Show>
                </div>
                <DropdownMenu
                  gutter={4}
                  placement="bottom-end"
                  open={titleState.menuOpen}
                  onOpenChange={(open) => setTitleState("menuOpen", open)}
                >
                  <DropdownMenu.Trigger
                    as="button"
                    class="flex items-center justify-center size-7 rounded-[4px] transition-colors hover:bg-[rgba(0,0,0,0.03)] data-[expanded]:bg-[rgba(0,0,0,0.03)]"
                    aria-label={language.t("common.moreOptions")}
                    style={{ color: "rgba(0,0,0,0.6)" }}
                  >
                    <Icon name="ellipsis" class="size-5" />
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      style={{ "min-width": "104px" }}
                      onCloseAutoFocus={(event) => {
                        if (titleState.pendingRename) {
                          event.preventDefault()
                          setTitleState("pendingRename", false)
                          openTitleEditor()
                        }
                      }}
                    >
                      <DropdownMenu.Item
                        onSelect={() => setTitleState({ pendingRename: true, menuOpen: false })}
                      >
                        <DropdownMenu.ItemLabel>{language.t("common.rename")}</DropdownMenu.ItemLabel>
                      </DropdownMenu.Item>
                      <DropdownMenu.Separator />
                      <DropdownMenu.Item onSelect={handleDeleteSession}>
                        <DropdownMenu.ItemLabel>{language.t("common.delete")}</DropdownMenu.ItemLabel>
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu>
              </div>
              </div>
            </Show>
            <Show when={hasContent()} fallback={
              <Show when={sessionMessagesLoaded()} fallback={
                <div class="size-full flex items-center justify-center">
                  <div class="octo-spinner" />
                </div>
              }>
                <div class="flex-1 flex flex-col items-center justify-center min-h-0 px-6 py-6">
                  <ChatEmptyState />
                <div class="w-full max-w-[800px]">
                  <AttachmentBar
                    attachments={attachments()}
                    onRemove={removeAttachment}
                  />
                  <div
                    class="rounded-[24px] flex flex-col transition-all duration-300 relative group"
                    style={{
                      border: "1px solid transparent",
                      background: `
                        linear-gradient(var(--octo-surface-page), var(--octo-surface-page)) padding-box,
                        linear-gradient(135deg,
                          rgba(246, 97, 23, 0.7) 1%,
                          rgba(95, 45, 255, 0.7) 8%,
                          rgba(61, 93, 255, 0.7) 22%,
                          rgba(104, 138, 255, 0.7) 43%,
                          rgba(28, 171, 111, 0.7) 54%,
                          rgba(61, 93, 255, 0.7) 87%,
                          rgba(206, 7, 232, 0.7) 92%) border-box`,
                      "box-shadow": "0 0 5px rgba(0, 0, 0, 0.08), 0 0 10px rgba(74, 81, 255, 0.18), 0 0 20px rgba(89, 74, 255, 0.12)",
                      "margin-top": attachments().length > 0 ? "6px" : "0",
                      height: "150px",
                    }}
                  >
                    {/* Slash Command Popover（新建对话） */}
                    <Show when={slashState() && filteredSlash().length > 0}>
                      <div class="slash-popover">
                        <div class="slash-popover-head">
                          <span class="slash-popover-title">命令</span>
                          <span class="slash-popover-hint">↑↓ 选择 · Enter/Tab 确认 · Esc 关闭</span>
                        </div>
                        <For each={filteredSlash()}>
                          {(cmd, i) => {
                            const active = i() === slashIndex()
                            return (
                              <button
                                type="button"
                                class={`slash-item ${active ? "active" : ""}`}
                                onMouseDown={(e) => e.preventDefault()}
                                onMouseEnter={() => setSlashIndex(i())}
                                onClick={() => pickSlash(cmd)}
                              >
                                <span class="slash-trigger">/{cmd.trigger}</span>
                                <span class="slash-desc">{cmd.description ?? cmd.title}</span>
                                <Show when={cmd.source !== "builtin"}>
                                  <span class={`slash-source badge-${cmd.source}`}>
                                    {cmd.source === "mcp" ? "MCP" : "自定义"}
                                  </span>
                                </Show>
                              </button>
                            )
                          }}
                        </For>
                      </div>
                    </Show>

                    <textarea
                      ref={textareaRef}
                      value={prompt()}
                      onInput={handleInput}
                      onKeyDown={handleKeyDown}
                      placeholder="输入指令，按 Enter 发送…"
                      disabled={inputDisabled()}
                      class="w-full flex-1 resize-none bg-transparent text-14-regular text-text-strong outline-none relative z-10 px-4 pt-3"
                      style={{
                        "font-family": "var(--octo-font)",
                        "overflow-y": "auto",
                      }}
                    />
                   <div class="flex items-center justify-between px-4 pb-4 relative z-10 overflow-hidden">
                       <div class="flex items-center gap-1 min-w-0">
                       <input
                          ref={fileInputRef!}
                          type="file"
                          multiple
                          class="hidden"
                          accept="*/*"
                          onChange={handleFileInputChange}
                        />
                        <Tooltip placement="top" value="添加附件">
                          <Button
                            type="button"
                            variant="ghost"
                            class="size-8 p-0"
                            disabled={maxAttachments()}
                            onClick={() => { if (!maxAttachments()) fileInputRef.click() }}
                          >
                            <Icon name="plus" class="size-5" />
                          </Button>
                        </Tooltip>
                        <ModelSelectorPopover
                          model={local.model}
                          triggerAs="button"
                          triggerProps={{
                             class: "flex items-center gap-1.5 min-w-0 bg-[#f3f3f3] hover:bg-[#e8e8e8] active:bg-[#dedede] transition-colors px-3 py-1.5 rounded-full text-[13px] text-gray-800 font-medium group overflow-hidden focus-visible:outline-none",
                             "data-action": "prompt-model",
                           }}
                        >
                          <span class="truncate">
                            {currentModel()?.name ?? "选择模型"}
                          </span>
                          <Icon name="chevron-down" class="size-3.5 shrink-0 transition-transform duration-150 group-aria-[expanded=true]:-rotate-180" style="color: #000" />
                        </ModelSelectorPopover>
                      </div>
                      <IconButton
                        data-action="prompt-submit"
                        type="submit"
                        icon={isBusy() ? "stop" : "arrow-up"}
                        class="size-8 flex-shrink-0"
                        onClick={isBusy() ? () => void halt() : () => void handleSubmit()}
                        disabled={!isBusy() && (!prompt().trim() || inputDisabled())}
                        aria-label={isBusy() ? "停止生成" : undefined}
/>
                    </div>
                   </div>
                 </div>
               </div>
             </Show>
           }>
              {/* 消息列表 */}
              <ScrollView
                class="flex-1 min-h-0"
                style={{ background: "#fff", padding: "0 12px", }}
                viewportRef={autoScroll.scrollRef}
                onScroll={autoScroll.handleScroll}
                onMouseUp={autoScroll.handleInteraction}
              >
                <div ref={autoScroll.contentRef} class="py-3 flex flex-col gap-0">
                  <For each={userMessages()}>
                    {(msg) => (
                      <InsightTurn
                        sessionID={params.id!}
                        messageID={msg.id}
                        status={sessionStatus()}
                        active={isBusy()}
                        elapsedText={elapsedText()}
                        blockTime={blockTime()}
                        onAbort={halt}
                        onChildSession={ensureChildSession}
                        deltaLog={deltaLog()}
                        onFormSubmit={(text) => {
                          setPrompt(text)
                        }}
                        hasQuestionRequest={!!questionRequest()}
                        onConfirmGenerate={() => sendStepB(stepADescription())}
                      />
                    )}
                  </For>
                </div>
              </ScrollView>

              {/* 输入区 */}
              <div class="shrink-0" style={{ padding: "24px", background: "#fff" }}>
                <AttachmentBar
                  attachments={attachments()}
                  onRemove={removeAttachment}
                />

                {/* Question dock - 阻塞式提问 UI */}
                <Show when={questionRequest()} keyed>
                  {(request) => (
                    <div class="w-full pb-3">
                      <MakeQuestionDock request={request} onSubmitted={() => sync.session.sync(params.id!)} />
                    </div>
                  )}
                </Show>


                <div
                  class="rounded-[16px] transition-all duration-300 relative group"
                  style={{
                    border: "1px solid transparent",
                    background: `
                      linear-gradient(var(--octo-surface-page), var(--octo-surface-page)) padding-box,
                      linear-gradient(135deg,
                        rgba(246, 97, 23, 0.7) 1%,
                        rgba(95, 45, 255, 0.7) 8%,
                        rgba(61, 93, 255, 0.7) 22%,
                        rgba(104, 138, 255, 0.7) 43%,
                        rgba(28, 171, 111, 0.7) 54%,
                        rgba(61, 93, 255, 0.7) 87%,
                        rgba(206, 7, 232, 0.7) 92%) border-box`,
                    "box-shadow": "0 0 5px rgba(0, 0, 0, 0.08), 0 0 10px rgba(74, 81, 255, 0.18), 0 0 20px rgba(89, 74, 255, 0.12)",
                    "margin-top": attachments().length > 0 ? "6px" : "0",
                  }}
                >
                  {/* Slash Command Popover */}
                  <Show when={slashState() && filteredSlash().length > 0}>
                    <div class="slash-popover">
                      <div class="slash-popover-head">
                        <span class="slash-popover-title">命令</span>
                        <span class="slash-popover-hint">↑↓ 选择 · Enter/Tab 确认 · Esc 关闭</span>
                      </div>
                      <For each={filteredSlash()}>
                        {(cmd, i) => {
                          const active = i() === slashIndex()
                          return (
                            <button
                              type="button"
                              class={`slash-item ${active ? "active" : ""}`}
                              onMouseDown={(e) => e.preventDefault()}
                              onMouseEnter={() => setSlashIndex(i())}
                              onClick={() => pickSlash(cmd)}
                            >
                              <span class="slash-trigger">/{cmd.trigger}</span>
                              <span class="slash-desc">{cmd.description ?? cmd.title}</span>
                              <Show when={cmd.source !== "builtin"}>
                                <span class={`slash-source badge-${cmd.source}`}>
                                  {cmd.source === "mcp" ? "MCP" : "自定义"}
                                </span>
                              </Show>
                            </button>
                          )
                        }}
                      </For>
                    </div>
                  </Show>

                  <textarea
                    ref={textareaRef}
                    value={prompt()}
                    onInput={handleInput}
                    onKeyDown={handleKeyDown}
                    placeholder="输入指令，按 Enter 发送…"
                    rows={3}
                    disabled={inputDisabled()}
                    class="w-full resize-none bg-transparent text-14-regular text-text-strong outline-none relative z-10 p-4"
                    style={{
                      "font-family": "var(--octo-font)",
                      "max-height": "120px",
                      "overflow-y": "auto",
                    }}
                  />
                    <div class="flex items-center justify-between px-4 pb-4 relative z-10 overflow-hidden">
                        <div class="flex items-center gap-1 min-w-0">
                        <input
                         ref={fileInputRef!}
                        type="file"
                        multiple
                        class="hidden"
                        accept="*/*"
                        onChange={handleFileInputChange}
                      />
                      <Tooltip placement="top" value="添加附件">
                        <Button
                          type="button"
                          variant="ghost"
                          class="size-8 p-0"
                          disabled={maxAttachments()}
                          onClick={() => { if (!maxAttachments()) fileInputRef.click() }}
                        >
                          <Icon name="plus" class="size-5" />
                        </Button>
                      </Tooltip>
                       <ModelSelectorPopover
                        model={local.model}
                        triggerAs="button"
                        triggerProps={{
                          class: "flex items-center gap-1.5 min-w-0 bg-[#f3f3f3] hover:bg-[#e8e8e8] active:bg-[#dedede] transition-colors px-3 py-1.5 rounded-full text-[13px] text-gray-800 font-medium group overflow-hidden",
                          "data-action": "prompt-model",
                        }}
                      >
                        <span class="truncate" style="color: rgba(0, 0, 0, 0.9)">
                          {currentModel()?.name ?? "选择模型"}
                        </span>
                        <Icon name="chevron-down" class="size-3.5 shrink-0 transition-transform duration-150 group-aria-[expanded=true]:-rotate-180" style="color: #000" />
                      </ModelSelectorPopover>
                    </div>
                    <IconButton
                      data-action="prompt-submit"
                      type="submit"
                      icon={isBusy() ? "stop" : "arrow-up"}
                      variant="primary"
                      class="size-8 flex-shrink-0"
                      onClick={isBusy() ? () => void halt() : () => void handleSubmit()}
                      disabled={!isBusy() && (!prompt().trim() || inputDisabled())}
                      aria-label={isBusy() ? "停止生成" : undefined}
                    />
                  </div>
                </div>
              </div>
            </Show>

        </div>
        </Show>

        {/* ── 拖拽分隔线（Grid 中间列） ──── */}
        <Show when={hasContent() && !focusMode()}>
          <div class="octo-split-handle" onMouseDown={handleDividerMouseDown} />
        </Show>

        {/* ── 右栏：单一持久化 iframe ──── */}
        {/* iframe 只负责渲染、不承载逻辑：全程挂载一次、永不卸载。
            切 session / 进空态只用 CSS 显隐，避免 detach 触发整页 reload 白屏。
            隐藏时 display:none 不占 grid 轨道，空态网格仍是单列。 */}
        <div
          class="flex flex-col overflow-hidden relative"
          style={{ background: "#fff", display: hasContent() ? "flex" : "none" }}
        >
          <div ref={(el) => { if (!el.firstChild) bridge.mount(el) }} style={{ width: "100%", height: "100%" }} />
        </div>
      </div>
    </DataProvider>
  )
}

function ChatEmptyState(): JSX.Element {
  return (
    <div class="flex flex-col items-center gap-6 text-center pb-20 px-6">
      <img src={IconHost} width={166} height={166} alt="" draggable={false} style={{ "flex-shrink": "0" }} />
      <div class="flex flex-col items-center gap-2">
        <div style={{ color: "rgba(0, 0, 0, 0.9)", "font-size": "36px", "font-weight": "600", "line-height": "42px" }}>Octo Design</div>
        <div style={{ color: "rgba(0, 0, 0, 0.6)", "font-size": "16px", "line-height": "24px" }}>
          描述需求，开始生成原型
        </div>
      </div>
    </div>
  )
}

function MakeDialogDeleteSession(props: { sessionID: string; name: string; onDelete: (id: string) => Promise<void> }): JSX.Element {
  const language = useLanguage()
  const dialog = useDialog()
  return (
    <Dialog title={language.t("session.delete.title")} fit class="delete-dialog">
      <span class="text-[14px] leading-[22px]" style={{ color: "rgba(0,0,0,0.9)" }}>
        {language.t("session.delete.confirm", { name: props.name })}
      </span>
      <div class="flex justify-end gap-2" style={{ "margin-top": "12px" }}>
        <Button
          variant="ghost"
          size="large"
          class="delete-dialog-btn"
          onClick={() => dialog.close()}
        >
          {language.t("common.cancel")}
        </Button>
        <Button
          variant="primary"
          size="large"
          class="delete-dialog-btn delete-dialog-btn-primary"
          onClick={() => void props.onDelete(props.sessionID).then(() => dialog.close())}
        >
          {language.t("session.delete.button")}
        </Button>
      </div>
    </Dialog>
  )
}
