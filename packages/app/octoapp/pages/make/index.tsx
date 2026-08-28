import "./octo-tokens.css"
import "./components/slash-popover.css"
import "../pattern/assets/style/chat/intent-confirm-card.css"
import { type MentionSelection } from "./components/mention-popover"
import { ProseMirrorEditor, getDocTextWithMentions, extractMentionsFromDoc, type MentionAttrs } from "./components/prosemirror-editor"
import { AddonMenu } from "./components/addon-menu"
import { encodeAssetUrl, joinUrl } from "./components/addon-menu/asset-library"
import { OctoToast, showOctoToast } from "./components/octo-toast"
import type { PanelSkill, SkillConfig } from "./components/skill-config-types"
import { loadSkillsFromPanel } from "@/utils/skill-config"
import { syncSessionModel } from "@/pages/session/session-model-helpers"
import {
  fetchArtifactList,
  fetchArtifactContent,
  formatFileSize,
  uploadArtifactFile,
  type ArtifactFile,
  type ArtifactFileKind,
} from "./utils/artifact-file-api"
import type { Message, Session, SessionStatus } from "@opencode-ai/sdk/v2/client"
import type { FilePartInput, TextPartInput } from "@opencode-ai/sdk/v2/client"
import { Binary } from "@opencode-ai/core/util/binary"
import { DataProvider } from "@opencode-ai/ui/context/data"
import { createAutoScroll, useFilteredList } from "@opencode-ai/ui/hooks"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { InlineInput } from "@opencode-ai/ui/inline-input"
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
  onMount,
  Show,
  Suspense,
  type JSX,
} from "solid-js"
import { tracker } from "@/utils/tracker"
import { onPrototypePickerSubmit, onPrototypePickerAppend } from "./utils/prototype-utils"
import { createStore, produce } from "solid-js/store"
import { useLocation, useNavigate, useParams } from "@solidjs/router"
import { useGlobalSync } from "@/context/global-sync"
import { dropSessionCaches } from "@/context/global-sync/session-cache"
import { useGlobalSDK } from "@/context/global-sdk"
import { SDKProvider, useSDK } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"

import { LocalProvider, useLocal } from "@/context/local"
import { useTabModel } from "@/hooks/use-tab-model"
import { useLayout } from "@/context/layout"
import { useMakeLayout, MAKE_CENTER_MIN, MAKE_RIGHT_MIN } from "@/context/make-layout"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"
import { useProviders } from "@/hooks/use-providers"
import { useProjectDir } from "@/hooks/use-project-dir"
import { useProjectSelection } from "@/hooks/use-project-selection"
import { sessionTitle } from "@/utils/session-title"
import { pickNextSession, sortedActiveSessions } from "@/utils/session-delete"
import { useSessionDelete } from "@/hooks/use-session-delete"
import { DialogDeleteSession } from "@/components/dialog-delete-session"
import { DialogPreviewUnavailable } from "./components/dialog-preview-unavailable"
import { directoryHeader } from "@/utils/headers"
import { AttachmentBar, type Attachment, type AttachmentStatus, type AttachmentSource } from "./components/attachment-bar"
import { uploadFile, validateFile, formatUploadsForPrompt, isImageFile, UploadError } from "../insight/lib/upload"
import { InsightTurn, type OutputCard, type OutputCardType, type DeltaLogEntry } from "./components/insight-turn"
import { type ToolCallInfo, toolFamily } from "./components/tool-call-card"
import { MakeQuestionDock } from "./components/make-question-dock"
import { sessionQuestionRequest, sessionPermissionRequest } from "@/pages/session/composer/session-request-tree"
import type { PermissionRequest, QuestionRequest } from "@opencode-ai/sdk/v2"
import { usePermission } from "@/context/permission"
import { SessionPermissionDock } from "@/pages/session/composer/session-permission-dock"
import { ResultViewer } from "./components/result-viewer/index"
import { PlanEntryBanner } from "./components/result-viewer/plan-entry-banner"
import { createTabStore } from "./components/result-viewer/tab-store"
import { DesignSystemPicker } from "./components/design-system-picker"
import { TemplatePicker } from "./components/template-picker"
import { NewSessionView } from "@/components/session"
import { Spinner } from "@opencode-ai/ui/spinner"
import { ProgressCircle } from "@opencode-ai/ui/progress-circle"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { Icon } from "@opencode-ai/ui/icon"
import { IconNotepad } from "@/pages/_shell/icons"
import { loadDesignSystem } from "./utils/design-system-loader"
import { loadCrafts } from "./utils/craft-loader"
import { createSnapshotStore } from "./utils/snapshot-store"
import { VersionPanel } from "./components/result-viewer/version-panel"
import { ModelSelectorPopover } from "@/components/dialog-select-model"
import { ANNOTATION_EVENT, type AnnotationEventDetail } from "./components/result-viewer/draw-overlay"
import { SEND_TEXT_EVENT, type SendTextEventDetail } from "./utils/agent-events"
import { autoSaveArtifact, inferArtifactFilePath } from "./utils/artifact-auto-save"
import { getFileIcon as getFileKindIcon } from "./icons/file-type-icons"
import { persistTabChanges, tabToOutputCard } from "./utils/tab-persistence"
import { scanDesignPlanFromMessages, isPlanConfirmed } from "./utils/design-plan-scanner"
import { scanStrategyFields, EMPTY_STRATEGY_FORM, type StrategyFormData } from "./utils/strategy-form-scanner"
import { useMakeCommands } from "./use-make-commands"
import { useDialogIframe } from '@/context/dialog-iframe'
import { getDesktopApi, type AssetsConfig } from "./lib/electron-api"
import { extractSubtypeFromFilename } from "./utils/subtype-extractor"
import { type VersionEntry } from "./utils/history-store"
import { createHistoryController } from "./subtype-handlers/history-controller"
import { getSessionContextMetrics } from "@/components/session/session-context-metrics"
import { IntentConfirmCard, type IntentConfirmAnswers } from "../pattern/modules/chat/intent-confirm-card"
import { type IntentConfirmResult } from "../pattern/agents/proto-intent-confirm"
import { type BlockModuleItem, getPagePatternResource, readPagePatternMd, getBlockPatternResource, getBlockContent } from "../pattern/utils/pattern-resource"
import { scanPatternMatchFromMessages, scanModuleListFromMessages, isPatternSubConfirmed, type ModuleListResult } from "./utils/pattern-sub-scanner"

export default function MakePage() {
  const projectDir = useProjectDir({ mode: "project" })
  const params = useParams<{ id?: string }>()
  const navigate = useNavigate()
  
  let lastProjectDir: string | undefined
  
  createEffect(() => {
    const dir = projectDir()
    if (lastProjectDir !== undefined && dir !== lastProjectDir && params.id) {
      navigate("/make", { replace: true })
    }
    lastProjectDir = dir
  })

  return (
    <Show when={projectDir()} keyed>
      {(dir) => (
        <SDKProvider directory={() => dir}>
          <SyncProvider>
            <LocalProvider>
              <Suspense fallback={<div class="size-full bg-background-base" />}>
                <MakeContent />
              </Suspense>
            </LocalProvider>
          </SyncProvider>
        </SDKProvider>
      )}
    </Show>
  )
}

let lastMakeDir: string | undefined
const DEFAULT_CUSTOM_CONTEXT_LIMIT = 128_000

function MakeContent() {
  const params = useParams<{ id?: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const command = useCommand()
  const sync = useSync()
  const layout = useLayout()
  const ml = useMakeLayout()
  const language = useLanguage()
  const settings = useSettings()
  const dialog = useDialog()
  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  const sdk = useSDK()
  const providers = useProviders()
  const permission = usePermission()
  const removeSession = useSessionDelete()

  // Register Make slash commands
  useMakeCommands()

  // 消息时间追踪：sessionId → { startTime, inputText, firstTokenTime }
  const messageTimingMap = new Map<string, { startTime: number; inputText: string; firstTokenTime?: number }>()

  // 切换项目目录只触发 keyed 重挂，不会自动改路由——url 仍停在旧目录的
  // /make:oldId。这里用模块级变量检测"重挂 + 目录确实变了"，不依赖 store 水合时序。
  const prevMakeDir = lastMakeDir
  lastMakeDir = sdk.directory
  onMount(() => {
    if (prevMakeDir === undefined || prevMakeDir === sdk.directory || !params.id) return
    navigate("/make", { replace: true })
  })

  onMount(() => { tracker.page({ module: "design", name: "design-page" }) })

  const projectDir = useProjectDir()
  const projectSelection = useProjectSelection()

  const local = useLocal()
  useTabModel("make")
  const currentModel = () => local.model.current()

  function findMultimodalModel() {
    const recent = local.model.recent()
    for (const m of recent) {
      if (m?.capabilities?.input?.image === true) return m
    }
    return local.model.list()
      .filter(m => m.capabilities?.input?.image === true)
      .filter(m => local.model.visible({ providerID: m.provider.id, modelID: m.id }))[0]
  }

  function hasImageAttachments() {
    return attachments().some(a => a.mime?.startsWith('image/'))
  }

  function supportsImageInput() {
    return currentModel()?.capabilities?.input?.image === true
  }

  function ensureMultimodalModel(): boolean {
    if (supportsImageInput()) return true
    const multimodalModel = findMultimodalModel()
    if (multimodalModel) {
      local.model.set(
        { providerID: multimodalModel.provider.id, modelID: multimodalModel.id },
        { recent: true }
      )
      return true
    }
    return false
  }

  const dialogPop = useDialogIframe()
  const [selectedSpecDisplay, setSelectedSpecDisplay] = createSignal<string | null>(null)
  const [selectedSpecName, setSelectedSpecName] = createSignal<string | null>(null)

  let configFetched = false

  // 获取存量配置并设置状态
  function fetchAndSetConfig() {
    const api = getDesktopApi()
    if (!api?.getAssetsConfig) return
    api.getAssetsConfig()
      .then((data) => {
        const config = data as AssetsConfig
        if (config?.user) {
          const designSpec = config.user.designSpec
          const placeholder = config.user.placeholder
          if (designSpec && typeof designSpec === 'string') {
            setSelectedSpecName(designSpec)
          }
          if (placeholder && typeof placeholder === 'string') {
            setSelectedSpecDisplay(placeholder)
          }
          // 写入临时文件
          const projectDirValue = projectDir()
          if (projectDirValue && api?.writeFileBuffer) {
            const sep = projectDirValue.includes("\\") ? "\\" : "/"
            const configPath = [projectDirValue, ".octo", "tmps", "make", "resource", "assets_config.json"].join(sep)
            const encoder = new TextEncoder()
            const str = JSON.stringify(data)
            const buffer = encoder.encode(str).buffer as ArrayBuffer
            api.writeFileBuffer(configPath, buffer).catch(err => {
              console.error("[MakePage] Failed to save assets_config.json:", err)
            })
          }
        }
      })
      .catch((err) => {
        console.error("[MakePage] Failed to get assets config:", err)
      })
  }

  // 1. 挂载时获取（只在空态且未获取过时）
  onMount(() => {
    if (!params.id && !configFetched) {
      configFetched = true
      fetchAndSetConfig()
    }
  })

  // 2. 参数变化时获取（变为空态且未获取过时）
  createEffect(on(
    () => params.id,
    (id) => {
      // 离开空态时重置标志
      if (id) {
        configFetched = false
        return
      }
      // 变为空态时，如果未获取过，则获取
      if (!id && !configFetched) {
        configFetched = true
        fetchAndSetConfig()
      }
    }
  ))

  createEffect(
    on(
      () => globalSync.data.config.model,
      (modelStr) => {
        if (!modelStr) return
        const [providerID, modelID] = modelStr.split("/")
        if (!providerID || !modelID) return
        const cur = currentModel()
        if (cur && cur.provider.id === providerID && cur.id === modelID) return
        local.model.set({ providerID, modelID })
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

  // 追踪会话页面上的最新模型选择，在切换到空态（新建对话）时回填
  let lastSessionModel: { providerID: string; modelID: string } | null = null
  createEffect(() => {
    if (!params.id) return
    const m = currentModel()
    if (m) lastSessionModel = { providerID: m.provider.id, modelID: m.id }
  })
  createEffect(
    on(
      () => params.id,
      (id, prevId) => {
        // 只在真正切换 session 时重置（两个都不为 null）
        if (id !== prevId && prevId !== null) {
          setSelectedSpecDisplay(null)
          setSelectedSpecName(null)
        }
        
        // 回填模型选择
        if (!id && prevId && lastSessionModel) {
          local.model.set(lastSessionModel)
        }
      },
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

  const [sessionInfoMirror, setSessionInfoMirror] = createSignal<Session | null>(null)
  createEffect(on(sessionInfo, (v) => setSessionInfoMirror(v ?? null), { defer: true }))

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
    const sInfo = sessionInfoMirror()
    setTitleState({ editing: true, draft: sessionTitle(overrideTitle() ?? info()?.title ?? sInfo?.title) ?? "" })
    requestAnimationFrame(() => {
      titleRef?.focus()
      titleRef?.select()
    })
  }

  /** 保存标题编辑 */
  async function saveTitleEditor() {
    const id = params.id
    if (!id) return
    const draft = titleState.draft.trim()
    if (!draft) { setTitleState("editing", false); return }
    try {
      await sdk.client.session.update({ sessionID: id, title: draft })
      tracker.interaction({ module: "design", name: "rename-session" })
      void refetchSession()
    } catch (err) {
      showOctoToast({ title: "重命名失败", description: err instanceof Error ? err.message : String(err) })
    }
    setTitleState("editing", false)
  }

  // 删除对话
  /** 删除会话 */
  async function deleteSession(sessionID: string) {
    const listResult = await sdk.client.session.list({ directory: sdk.directory })
    const nextSession = pickNextSession(sortedActiveSessions((listResult.data ?? []) as Session[], "octo_make"), sessionID)

    const ok = await removeSession(sdk.client, sessionID)
    if (!ok) return

    tracker.interaction({ module: "design", name: "delete-session" })
    sync.set(
      produce((draft) => {
        const i = draft.session.findIndex((s) => s.id === sessionID)
        if (i !== -1) draft.session.splice(i, 1)
      }),
    )
    if (layout.lastSessionPerTab.make(sdk.directory) === sessionID) layout.lastSessionPerTab.setMake(sdk.directory, "")
    navigate(nextSession ? `/make/${nextSession.id}` : "/make")
  }

  /** 弹出删除确认弹框 */
  function handleDeleteSession() {
    const id = params.id
    if (!id) return
    dialog.show(() => <DialogDeleteSession name={sessionTitle(sessionInfoMirror()?.title) ?? language.t("command.session.new")} onDelete={() => deleteSession(id)} />)
  }

// 监听项目切换，清理不属于新项目的 session
  createEffect(
    on(
      projectDir,
      (newDir, oldDir) => {
        if (!newDir || newDir === oldDir) return
        
        const currentId = params.id
        if (!currentId) return

        // 检查当前 session 是否属于新项目
        const client = globalSDK.createClient({ directory: newDir })
        void client.session.list().then((result) => {
          const sessions = (result.data ?? []) as Session[]
          const belongsToNewProject = sessions.some(s => s.id === currentId && s.agent === "octo_make")
          
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
            layout.lastSessionPerTab.setMake(sdk.directory, "")
            
            // 导航到空态
            navigate("/make")
          }
        })
      },
    ),
  )

const sessionMessagesLoaded = createMemo(() => {
    const id = params.id
    return !id || sync.data.message?.[id] !== undefined
  })

  createEffect(
    on(
      () => [params.id, sync.data.message?.[params.id ?? ""] === undefined] as const,
      ([id, missing]) => {
        if (id) {
          layout.lastSessionPerTab.setMake(sdk.directory, id)
          // 之前用 `id !== prev?.[0]` 限制只在 session 切换时 sync,但 app 长时间放置后
          // 重新激活时,store 可能被 evict 导致 sync.data.message[id] 变 undefined,
          // 此时 session ID 没变但 missing=true,旧条件不会重新 sync → 永远卡在 spinner。
          // sync.session.sync 内部已有 cached 去重 + loading 防并发,重复调用安全。
          if (missing) void sync.session.sync(id).catch(() => {})
        }

        setSending(false)
        setComposing(false)
        setDeltaLog([])

        if (sendingNavigation) {
          sendingNavigation = false
        } else {
          setAttachments([])
        }

        requestAnimationFrame(() => autoScroll.forceScrollToBottom())
      },
    ),
  )

  // app 长时间放置后重新激活时,SSE 可能已断开 + 鉴权过期 + DNS 不可达(ERR_NAME_NOT_RESOLVED),
  // 此时 sync.session.sync 的请求可能失败被 .catch 吞掉,sync.data.message[id] 仍是 undefined,
  // 但 missing 状态没变化(从 true 到 true),上面的 createEffect 不会重新触发 → 卡在 spinner。
  // 监听 visibilitychange(切回前台)+ online(网络恢复):任一事件触发时,
  // 如果当前 session 仍 missing,主动重试 sync。
  // sync.session.sync 内部有 cached 去重 + loading 防并发,网络未恢复时请求会失败但不影响后续重试。
  onMount(() => {
    const retrySyncIfMissing = () => {
      const id = params.id
      if (!id) return
      if (sync.data.message?.[id] === undefined) {
        void sync.session.sync(id).catch(() => {})
      }
    }
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") return
      retrySyncIfMissing()
    }
    document.addEventListener("visibilitychange", handleVisibility)
    window.addEventListener("online", retrySyncIfMissing)
    onCleanup(() => {
      document.removeEventListener("visibilitychange", handleVisibility)
      window.removeEventListener("online", retrySyncIfMissing)
    })
  })

  // ── Annotation event listener (from DrawOverlay) ────────────────────────────────
  createEffect(() => {
    const handleAnnotation = async (e: Event) => {
      const detail = (e as CustomEvent<AnnotationEventDetail>).detail
      
      let contextMessage = ""
      if (detail.tabContext?.title) {
        contextMessage = `[当前页面: ${detail.tabContext.title}]`
        if (detail.tabContext.filePath) {
          contextMessage += `\n[文件路径: ${detail.tabContext.filePath}]`
        }
        contextMessage += "\n\n"
      }
      const messageText = contextMessage + (detail.note || "")
      
      if (detail.action === 'send' && !sending()) {
        if (!ensureMultimodalModel()) {
          showOctoToast({ title: "当前模型不支持图像输入", description: "请手动切换到支持多模态的模型", variant: "error" })
          return
        }

        const sessionId = params.id
        const modelKey = activeModelKey()
        if (sessionId && modelKey) {
          if (detail.file) {
            const file = detail.file
            const id = crypto.randomUUID()
            const previewUrl = URL.createObjectURL(file)
            filesById.set(id, file)

            setAttachments(prev => [...prev, {
              id,
              filename: file.name,
              mime: 'image/png',
              size: file.size,
              status: 'uploading',
              source: 'external',
              previewUrl
            }])

            try {
              const result = await uploadFile(file)
              setAttachments(prev => prev.map(a =>
                a.id === id ? { ...a, status: 'done' as const, url: result.url } : a
              ))
              await sendMessage(sessionId, messageText, modelKey)
              setAttachments([])
              setPrompt("")
            } catch (err) {
              const message = err instanceof UploadError ? err.message : '上传失败'
              setAttachments(prev => prev.map(a =>
                a.id === id ? { ...a, status: 'error' as const, error: message, retriable: true } : a
              ))
              setPrompt(messageText)
            }
          } else {
            await new Promise(resolve => setTimeout(resolve, 100))
            const att = attachments().find(a => a.id === filesById.keys().next().value)
            if (att?.status === 'done' || attachments().length === 0) {
              await sendMessage(sessionId, messageText, modelKey)
              setAttachments([])
              setPrompt("")
            }
          }
        }
      } else if (detail.action === 'queue') {
        if (detail.file) {
          const file = detail.file
          const id = crypto.randomUUID()
          const previewUrl = URL.createObjectURL(file)
          filesById.set(id, file)
          
          setAttachments(prev => [...prev, {
            id,
            filename: file.name,
            mime: 'image/png',
            size: file.size,
            status: 'uploading',
            source: 'external',
            previewUrl
          }])
          
          uploadFile(file)
            .then(result => {
              setAttachments(prev => prev.map(a => 
                a.id === id ? { ...a, status: 'done' as const, url: result.url } : a
              ))
            })
            .catch(err => {
              const message = err instanceof UploadError ? err.message : '上传失败'
              setAttachments(prev => prev.map(a =>
                a.id === id ? { ...a, status: 'error' as const, error: message, retriable: true } : a
              ))
            })
        }
        
        if (messageText) {
          setPrompt(prev => prev ? prev + "\n" + messageText : messageText)
        }
      }
      
      if (detail.ack) {
        detail.ack({ ok: true })
      }
    }
    
    window.addEventListener(ANNOTATION_EVENT, handleAnnotation)
    onCleanup(() => window.removeEventListener(ANNOTATION_EVENT, handleAnnotation))
  })

  // ── Send-text event listener (direct text → agent) ────────────────────────────
  createEffect(() => {
    const handleSendText = async (e: Event) => {
      const detail = (e as CustomEvent<SendTextEventDetail>).detail

      if (sending()) {
        detail.ack?.({ ok: false, message: '正在发送中' })
        return
      }

      const sessionId = params.id
      const modelKey = activeModelKey()
      if (!sessionId || !modelKey) {
        detail.ack?.({ ok: false, message: '会话未就绪' })
        return
      }

      try {
        await sendMessage(sessionId, detail.text, modelKey)
        tracker.interaction({
          module: 'design',
          name: 'send-text-event',
          extend: JSON.stringify({
            textLength: detail.text.length,
            source: detail.source ?? 'unknown',
          }),
        })
        detail.ack?.({ ok: true })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        showOctoToast({ title: '发送失败', description: message, variant: 'error' })
        detail.ack?.({ ok: false, message })
      }
    }

    window.addEventListener(SEND_TEXT_EVENT, handleSendText)
    onCleanup(() => window.removeEventListener(SEND_TEXT_EVENT, handleSendText))
  })

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
        
        // 记录首次回复时间（只记录第一次）
        const targetSessionID = eventSessionID ?? sid
        const timing = messageTimingMap.get(targetSessionID)
        if (timing && !timing.firstTokenTime) {
          timing.firstTokenTime = Date.now()
        }
        
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
      } else if (e.type === "session.next.tool.called") {
        const callID = props?.callID as string | undefined
        const toolName = props?.tool as string | undefined
        if (callID && toolName) {
          toolCallMap.set(callID, toolName)
        }
      } else if (e.type === "session.next.tool.success") {
        const callID = props?.callID as string | undefined
        if (callID) {
          const toolName = toolCallMap.get(callID)
          if (toolName) {
            setFilesRefreshKey(k => k + 1)
            void historyController.onFileRefresh(tabStore.tabs())
            toolCallMap.delete(callID)
          }
        }
      } else if (e.type === "session.next.step.ended") {
        setFilesRefreshKey(k => k + 1)
        void historyController.onFileRefresh(tabStore.tabs())
      } else if (e.type === "file.edited" || e.type === "file.watcher.updated") {
        setFilesRefreshKey(k => k + 1)
        void historyController.onFileRefresh(tabStore.tabs())
      } else {
        const partType = props?.part ? (props.part as Record<string, unknown>)?.type : undefined
        console.log(`[make:event] ${e.type || partType}`, props) // eslint-disable-line 
      }
    })
    onCleanup(unsub)
  })

  const [childSessionIDs, setChildSessionIDs] = createSignal<Set<string>>(new Set())
  const [planChildSessionIDs, setPlanChildSessionIDs] = createSignal<Set<string>>(new Set())
  const [deltaLog, setDeltaLog] = createSignal<DeltaLogEntry[]>([])
  const loadedChildSessions = new Set<string>()
  const toolCallMap = new Map<string, string>()

  const PLAN_CHILD_LOCALSTORAGE_PREFIX = "octo_make_plan_child:"
  const PLAN_ENDED_LOCALSTORAGE_PREFIX = "octo_make_plan_ended:"
  const PLAN_SKILL_HANDOFF_LOCALSTORAGE_PREFIX = "octo_make_plan_skill_handoff:"

  type PlanSkillHandoff = {
    childSessionId: string
    skills: Array<{ name: string; label: string }>
  }

  function readPlanSkillHandoff(sessionId: string): PlanSkillHandoff | null {
    const value = localStorage.getItem(PLAN_SKILL_HANDOFF_LOCALSTORAGE_PREFIX + sessionId)
    if (!value) return null
    try {
      const parsed = JSON.parse(value) as PlanSkillHandoff
      if (!parsed.childSessionId || !Array.isArray(parsed.skills)) return null
      return parsed
    } catch {
      return null
    }
  }

  function savePlanSkillHandoff(sessionId: string, childSessionId: string, skills: Array<{ name: string; label: string }>) {
    if (skills.length === 0) {
      clearPlanSkillHandoff(sessionId)
      return
    }
    localStorage.setItem(
      PLAN_SKILL_HANDOFF_LOCALSTORAGE_PREFIX + sessionId,
      JSON.stringify({ childSessionId, skills } satisfies PlanSkillHandoff),
    )
  }

  function clearPlanSkillHandoff(sessionId: string) {
    localStorage.removeItem(PLAN_SKILL_HANDOFF_LOCALSTORAGE_PREFIX + sessionId)
  }

  /** 当前输入框中的设计规划胶囊状态，仅用于初始页待提交意图 */
  const [planComposerCapsule, setPlanComposerCapsule] = createSignal(false)
  const planComposerActive = () => !params.id && planComposerCapsule()

  function clearPlanComposerCapsule() {
    setPlanComposerCapsule(false)
  }

  function handleCancelPlanComposer() {
    clearPlanComposerCapsule()
    setOptimisticIntentResolved(false)
  }

  /** 当前活跃的设计规划子 session ID（存在时表示正在规划阶段） */
  const [activePlanSessionId, setActivePlanSessionId] = createSignal<string | null>(null)
  /** plan session 所属的主 session ID，用于 handleSubmit 校验（防止 session 切换后 planSid 污染） */
  const [planParentSessionId, setPlanParentSessionId] = createSignal<string | null>(null)
  /** 跨 session 切换缓存: { mainSessionId: childSessionId }，切回时立即恢复 */
  const _planChildSessionCache: Record<string, string> = {}

  /** 设计规划是否已结束（退出或确认），用于控制 plan 视图只读模式 */
  // 从 localStorage 同步初始化，确保页面刷新/路由切换后立即生效
  const [planEnded, setPlanEnded] = createSignal(false)

  /** 两步走工作流：当前阶段 */
  const [planPhase, setPlanPhase] = createSignal<"strategy" | "generate">("strategy")

  // ── PatternPage 模式状态（子 session 模式，类 plan 流程） ───
  const PATTERN_SUB_CHILD_LS = "ict_pattern_child:"
  const PATTERN_SUB_ENDED_LS = "ict_pattern_ended:"
  const [activePatternSessionId, setActivePatternSessionId] = createSignal<string | null>(null)
  const [patternSubParentSessionId, setPatternSubParentSessionId] = createSignal<string | null>(null)
  const [patternSubPhase, setPatternSubPhase] = createSignal<"match" | "module">("match")
  const _patternSubChildCache: Record<string, string> = {}
  const [showPatternPageConfirm, setShowPatternPageConfirm] = createSignal(false)
  const [patternMatches, setPatternMatches] = createSignal<IntentConfirmResult | null>(null)
  const [patternSubEnriching, setPatternSubEnriching] = createSignal(false)
  const [patternBlockMatches, setPatternBlockMatches] = createSignal<BlockModuleItem[]>([])
  const [patternBlockMatching, setPatternBlockMatching] = createSignal(false)
  const [patternBlockMatchError, setPatternBlockMatchError] = createSignal(false)
  const [patternUserInput, setPatternUserInput] = createSignal("")
  const [optimisticPatternIntent, setOptimisticPatternIntent] = createSignal(false)
  const [patternEnded, setPatternEnded] = createSignal(false)
  /** 输入框中的 PatternPage 胶囊状态，用户提交后才创建子 session */
  const [patternPageCapsule, setPatternPageCapsule] = createSignal(false)
  const patternPageCapsuleActive = () => patternPageCapsule() && !activePatternSessionId() && !patternEnded()

  // 用于跟踪用户是否手动切换了 phase，防止 effect 自动切回
  const [userChangedPhase, setUserChangedPhase] = createSignal(false)

  /** 策略表单数据（从子 agent artifact 中扫描 + 用户手动编辑） */
  const [manualStrategyFormData, setManualStrategyFormData] = createSignal<Partial<StrategyFormData>>({})

  const strategyFormData = createMemo(() => {
    // 优先从活跃的子 session 获取
    const activePlanSid = activePlanSessionId()
    if (activePlanSid) {
      const messages = sync.data.message?.[activePlanSid]
      const parts = sync.data.part
      const scanned = scanStrategyFields(messages, parts)
      const manual = manualStrategyFormData()
      return { ...EMPTY_STRATEGY_FORM, ...scanned, ...manual }
    }
    // 对于已确认的 session，从 childSessionIDs 中找第一个有数据的
    const childIds = childSessionIDs()
    if (childIds.size > 0) {
      for (const childId of childIds) {
        const messages = sync.data.message?.[childId]
        const parts = sync.data.part
        const scanned = scanStrategyFields(messages, parts)
        const manual = manualStrategyFormData()
        const result = { ...EMPTY_STRATEGY_FORM, ...scanned, ...manual }
        // 如果有实际数据，返回
        if (Object.values(result).some(v => v)) {
          return result
        }
      }
    }
    return { ...EMPTY_STRATEGY_FORM }
  })

  /**
   * 跨重启恢复：从 API 全量拉取 session 列表，找到当前主 session 的 octo_make_plan 子 session。
   * sync.data.session 只包含根 session（roots:true），子 session 不会出现在里面，
   * 所以需要额外从 API 拉取全量 session 列表来检测。
   */
  const [hasChildPlanSession, setHasChildPlanSession] = createSignal(false)
  async function detectChildPlanSession(sid: string): Promise<string | null> {
    if (!sdk.directory) return null
    try {
      const res = await sdk.client.session.list({ directory: sdk.directory })
      const sessions = (res.data ?? []).filter((s: any) => !!s?.id)
      const children = sessions.filter((s: any) => s.parentID === sid && !s.time?.archived)
      const planChild = children.find((s: any) => s.agent === "octo_make_plan")

      for (const child of children) {
        await sync.session.sync(child.id)
        loadedChildSessions.add(child.id)
        setChildSessionIDs((prev) => {
          const next = new Set(prev)
          next.add(child.id)
          return next
        })
        if (child.agent === "octo_make_plan") {
          setPlanChildSessionIDs((prev) => {
            const next = new Set(prev)
            next.add(child.id)
            return next
          })
        }
      }

      if (planChild) {
        setHasChildPlanSession(true)
        return planChild.id
      }
    } catch {
      // 静默失败
    }
    return null
  }

  async function detectChildPatternSubSession(sid: string): Promise<string | null> {
    if (!sdk.directory) return null
    try {
      const res = await sdk.client.session.list({ directory: sdk.directory })
      const sessions = (res.data ?? []).filter((s: any) => !!s?.id)
      const child = sessions.find((s: any) => s.parentID === sid && s.agent === "ict_pattern" && !s.time?.archived)
      if (child) {
        loadedChildSessions.add(child.id)
        setChildSessionIDs((prev) => { const n = new Set(prev); n.add(child.id); return n })
        await sync.session.sync(child.id)
        return child.id
      }
    } catch { /* 静默失败 */ }
    return null
  }

  /** 加载子会话数据 */
  async function ensureChildSession(subSessionID: string) {
    if (!subSessionID || loadedChildSessions.has(subSessionID)) return

    loadedChildSessions.add(subSessionID)
    try {
      await sync.session.sync(subSessionID)
      setChildSessionIDs((prev) => {
        const next = new Set(prev)
        next.add(subSessionID)
        return next
      })
    } catch {
      loadedChildSessions.delete(subSessionID)
    }
  }

  const discoverChildSessions = async (sid: string) => {
    if (!sdk.directory) return
    try {
      const res = await sdk.client.session.list({ directory: sdk.directory })
      const children = (res.data ?? []).filter((s: any) => s.parentID === sid && !s.time?.archived)
      const discovered = new Set<string>()
      const discoveredPlans = new Set<string>()
      for (const child of children) {
        await sync.session.sync(child.id)
        if (params.id !== sid) return
        discovered.add(child.id)
        if (child.agent === "octo_make_plan") discoveredPlans.add(child.id)
      }
      setChildSessionIDs(discovered)
      setPlanChildSessionIDs(discoveredPlans)
    } catch {
      // 静默失败
    }
  }

  const sortMessages = (messages: Message[]) => messages.sort((a, b) => {
    const aTime = (a as any).time?.created ?? 0
    const bTime = (b as any).time?.created ?? 0
    if (aTime !== bTime) return aTime - bTime
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  const userMessages = createMemo((): Message[] => {
    const sid = params.id
    if (!sid) return []
    const mainMsgs = ((sync.data.message?.[sid] ?? []) as Message[]).filter((m) => m.role === "user")
    const allMsgs: Message[] = [...mainMsgs]
    for (const childId of childSessionIDs()) {
      const childMsgs = ((sync.data.message?.[childId] ?? []) as Message[]).filter((m) => m.role === "user")
      allMsgs.push(...childMsgs)
    }
    return sortMessages(allMsgs)
  })

  const lastUserMessage = createMemo(() => userMessages().at(-1))

  createEffect(
    on(
      () => lastUserMessage()?.id,
      () => {
        const msg = lastUserMessage()
        if (!msg) return
        syncSessionModel(local, msg as any)
        // Sync tab key so new conversations inherit this session's model.
        if ((msg as any).model?.providerID && (msg as any).model?.modelID) {
          local.model.set((msg as any).model, { recent: true })
        }
      },
    ),
  )

  const info = createMemo(() => (params.id ? sync.session.get(params.id) : undefined))
  const contextMetrics = createMemo(
    () => getSessionContextMetrics(params.id ? (sync.data.message[params.id] ?? []) : [], providers.all()).context,
  )
  const contextLimit = createMemo(() => {
    if (contextMetrics()?.limit) return contextMetrics()!.limit!
    if (currentModel()?.limit.context) return currentModel()!.limit.context
    return DEFAULT_CUSTOM_CONTEXT_LIMIT
  })
  const contextUsage = createMemo(() => {
    if (contextMetrics()?.usage !== null && contextMetrics()?.usage !== undefined) return contextMetrics()!.usage!
    return contextLimit() ? Math.round(((contextMetrics()?.total ?? 0) / contextLimit()) * 100) : 0
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

    const rootMessages = (sync.data.message?.[id] ?? []) as Message[]
    const lastRootAssistant = rootMessages.findLast((message) => message.role === "assistant")
    if (lastRootAssistant && typeof lastRootAssistant.time.completed !== "number") return true

    for (const childID of childSessionIDs()) {
      const childMessages = (sync.data.message?.[childID] ?? []) as Message[]
      const lastChildAssistant = childMessages.findLast((message) => message.role === "assistant")
      if (lastChildAssistant && typeof lastChildAssistant.time.completed !== "number") return true
      if (childMessages.some((message) => message.role === "user") && !lastChildAssistant) return true
    }
    return false
  })

  const childBusy = createMemo(() => {
    for (const childID of childSessionIDs()) {
      if (sync.data.session_status[childID]?.type === "busy") return true
    }
    return false
  })

  const effectiveBusy = createMemo(() => isBusy() || childBusy() || patternBlockMatching())

  // ── 会话进度条动画状态 ────────────────────────────────────
  const [timeoutDone, setTimeoutDone] = createSignal(true)
  const workingStatus = createMemo<"hidden" | "showing" | "hiding">((prev) => {
    if (effectiveBusy()) return "showing"
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
    if (effectiveBusy()) {
      const id = params.id
      if (id) {
        const messages = (sync.data.message?.[id] ?? []) as Message[]
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

  // ── 消息完整耗时追踪（从发送到对话框恢复可发送）────────────
  let lastBusyState = false
  createEffect(on(effectiveBusy, (busy) => {
    const id = params.id
    
    // 检测从 busy → idle 的转换
    if (lastBusyState && !busy && id) {
      // agent 一轮结束：刷新文件视图，让 iframe 重载拿到最新磁盘内容（no-store 保证 data.js 不命中缓存）
      setFilesRefreshKey(k => k + 1)
      const timing = messageTimingMap.get(id)
      if (timing) {
        const elapsed = Date.now() - timing.startTime
        const date = new Date()
        const timeStr = date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '')
        const elapsedStr = `${(elapsed / 1000).toFixed(1)}s`
        
        // 使用记录的首次回复时间
        if (timing.firstTokenTime) {
          const ttft = (timing.firstTokenTime - timing.startTime) / 1000
          const ttftStr = `${ttft.toFixed(1)}s`
          console.log(`[${timeStr}] ${timing.inputText}, 总耗时 ${elapsedStr}, 首次回复 ${ttftStr}`)
        } else {
          console.log(`[${timeStr}] ${timing.inputText}, 总耗时 ${elapsedStr}`)
        }
        
        messageTimingMap.delete(id)
      }
    }
    
    lastBusyState = busy
  }, { defer: true }))

  // ── 阻塞检测计时器 ────────────────────────────────────────────
  const [lastDeltaTime, setLastDeltaTime] = createSignal(Date.now())
  const [blockTime, setBlockTime] = createSignal(0)
  let blockTimer: ReturnType<typeof setInterval> | undefined
  createEffect(() => {
    const hasQuestion = sessionQuestionRequest(sync.data.session, sync.data.question, params.id)
    if (effectiveBusy() && !hasQuestion) {
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
  const unsubPickerSubmit = onPrototypePickerSubmit(({ text, id }) => {
    const line = text ? `[选中元素: ${id}] ${text};` : ""
    const ref = hasContent() ? proseMirrorRef2 : proseMirrorRef1
    const prev = ref?.getText?.() ?? ""
    if (text) {
      ref?.clear?.()
      ref?.insertText?.(prev ? `${prev}\n${line}` : line)
    }
    void handleSubmit()
  })
  const unsubPickerAppend = onPrototypePickerAppend(({ text, id }) => {
    const line = `[选中元素: ${id}] ${text};`
    const ref = hasContent() ? proseMirrorRef2 : proseMirrorRef1
    const prev = ref?.getText?.() ?? ""
    ref?.clear?.()
    ref?.insertText?.(prev ? `${prev}\n${line}` : line)
  })
  onCleanup(() => { unsubPickerSubmit(); unsubPickerAppend() })
  const [composing, setComposing] = createSignal(false)
  const [sending, setSending] = createSignal(false)
  const hasContent = () => !!(params.id && userMessages().length > 0)
  const hasSessionView = () => !!params.id
  // During session transition, keep split layout to avoid flash (messages not yet loaded)
  const gridHasContent = () => hasSessionView() || !!(params.id && !sessionMessagesLoaded())
  const [attachments, setAttachments] = createSignal<Attachment[]>([])
  const filesById = new Map<string, File>()
  const maxAttachments = () => attachments().length >= 5
  let sendingNavigation = false
  const [isDragOver, setIsDragOver] = createSignal(false)

  // ── Slash Command Popover State ──
  const [slashState, setSlashState] = createSignal<{ query: string; cursor: number } | null>(null)
  const [slashIndex, setSlashIndex] = createSignal(0)
  let textareaRef!: HTMLTextAreaElement
  let proseMirrorRef1: { getText: () => string; getMentions: () => MentionAttrs[]; clear: () => void; insertText: (text: string) => void; replaceSlashCommand: (text: string) => void; insertMention: (selection: MentionSelection) => void; removeMention: (selection: MentionSelection) => void; updateMentionPath: (filename: string, path: string) => void; isAlive: () => boolean } | undefined
  let proseMirrorRef2: { getText: () => string; getMentions: () => MentionAttrs[]; clear: () => void; insertText: (text: string) => void; replaceSlashCommand: (text: string) => void; insertMention: (selection: MentionSelection) => void; removeMention: (selection: MentionSelection) => void; updateMentionPath: (filename: string, path: string) => void; isAlive: () => boolean } | undefined

  // ── Mention (@) Popover State ──
  const [mentionState, setMentionState] = createSignal<{ query: string; cursor: number } | null>(null)
  const [mentionSelections, setMentionSelections] = createSignal<MentionSelection[]>([])
  const [mentionIndex, setMentionIndex] = createSignal(0)
  const [filesRefreshKey, setFilesRefreshKey] = createSignal(0)

  // Mention selections are now managed by ProseMirrorEditor's sync plugin

  // ── Artifact Files Resource (for @ mention) ──
  const [artifactFiles] = createResource(
    () => ({ sessionId: params.id, url: globalSDK.url, directory: sdk.directory, refreshKey: filesRefreshKey() }),
    async ({ sessionId, url, directory }) => {
      if (!sessionId) return null
      try {
        const [gen, upl] = await Promise.all([
          fetchArtifactList(url, directory ?? "", sessionId, "generated", undefined, true),
          fetchArtifactList(url, directory ?? "", sessionId, "uploaded", undefined, true),
        ])
        return { generated: gen.files.filter(f => !f.isFolder), uploaded: upl.files.filter(f => !f.isFolder) }
      } catch {
        return null
      }
    },
  )

  const [artifactFilesMirror, setArtifactFilesMirror] = createSignal<{ generated: ArtifactFile[]; uploaded: ArtifactFile[] } | null>(null)
  createEffect(on(artifactFiles, (v) => setArtifactFilesMirror(v ?? null), { defer: true }))

  const mentionFiles = createMemo(() => {
    const state = mentionState()
    if (!state) return null
    const query = state.query.toLowerCase()
    const data = artifactFilesMirror()
    if (!data) return null
    
    const generated = data.generated.filter(f => !f.isFolder && f.name.toLowerCase().includes(query))
    const uploaded = data.uploaded.filter(f => !f.isFolder && f.name.toLowerCase().includes(query))
    
    if (generated.length === 0 && uploaded.length === 0) return null
    return { generated, uploaded }
  })

  function getUploadFileDirectory(relativePath: string): string {
    const withoutPrefix = relativePath.replace(/^upload-files\//, "")
    const lastSlash = withoutPrefix.lastIndexOf("/")
    if (lastSlash === -1) return ""
    return withoutPrefix.slice(0, lastSlash + 1)
  }

  // ── Mention popover click-outside ──
  createEffect(() => {
    const state = mentionState()
    if (!state) return
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest(".mention-popover-container")) {
        setMentionState(null)
      }
    }
    document.addEventListener("mousedown", handler)
    onCleanup(() => document.removeEventListener("mousedown", handler))
  })

  // ── Skills Config (from skill_config.json) ──
  const [skillConfig, setSkillConfig] = createSignal<SkillConfig>({})
  const [skillsLoading, setSkillsLoading] = createSignal(false)
  const [skillToolCalls, setSkillToolCalls] = createSignal<ToolCallInfo[]>([])
  const [pendingSkill, setPendingSkill] = createSignal<{ name: string; content: string } | null>(null)

  async function loadSkillConfig() {
    if (skillsLoading()) return
    setSkillsLoading(true)

    try {
      const api = (window as unknown as { api?: { getSkillConfig?: () => Promise<import("./components/skill-config-types").SkillConfig> } }).api
      const fullConfig = await api?.getSkillConfig?.()
      
      if (fullConfig) {
        setSkillConfig(fullConfig)
      } else {
        // Fallback: only load panel if full config failed
        const platformSkills = await loadSkillsFromPanel("octo_make")
        const customSkills = await loadSkillsFromPanel("common")
        
        setSkillConfig({
          panel: {
            octo_make: platformSkills,
            common: customSkills
          }
        })
      }
    } catch (err) {
      console.error("[MakePage] Failed to load skill config:", err)
    } finally {
      setSkillsLoading(false)
    }
  }
  
  // 组件挂载时预加载 skill 配置
  createEffect(() => {
    if (params.id && !skillConfig().skill) {
      loadSkillConfig()
    }
  })

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

    // Builtin: /preview command
    list.push({
      trigger: "preview",
      title: "预览文件",
      description: "预览本地 HTML 文件或 URL",
      id: "builtin.preview",
      source: "builtin",
    })

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

  // Get active skills from panel.octo_make array
  const activeSkills = createMemo(() => {
    const config = skillConfig()
    const panelSkills = config.panel?.octo_make ?? []

    return panelSkills
      .filter(skill => skill.enable !== false)
      .map(skill => ({
        name: skill.label,
        description: skill.description ?? "",
        path: skill.path ?? `skill/${skill.label}/SKILL.md`
      }))
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

  createEffect(on(() => params.id, (id) => {
    if (!id) return
    const dir = projectDir()
    const api = getDesktopApi()
    if (!dir || !api?.writeFileBuffer) return
    const sep = dir.includes("\\") ? "\\" : "/"
    const sessionInitPath = [dir, ".octo", id, ".gitkeep"].join(sep)
    const outputsInitPath = [dir, ".octo", id, "outputs", ".gitkeep"].join(sep)
    const buffer = new TextEncoder().encode("").buffer as ArrayBuffer
    api.writeFileBuffer(sessionInitPath, buffer)
      .catch((err) => console.warn("[MakePage] failed to ensure session dir", err))
    api.writeFileBuffer(outputsInitPath, buffer)
      .catch((err) => console.warn("[MakePage] failed to ensure outputs dir", err))
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
    setMentionSelections([])
    requestAnimationFrame(() => {
      const ref = proseMirrorRef1 ?? proseMirrorRef2
      if (ref?.isAlive()) {
        ref.clear()
      }
    })
  }, { defer: true }))
  const focusMode = layout.focusMode.get
  const hideChat = () => focusMode()

  let gridEl: HTMLDivElement | undefined

  function handleDividerMouseDown(e: MouseEvent) {
    e.preventDefault()
    if (!gridEl) return
    const rect = gridEl.getBoundingClientRect()
    const free = rect.width
    if (free <= 0) return
    const overlay = document.createElement("div")
    overlay.style.cssText = "position:fixed;inset:0;z-index:9999;cursor:col-resize;background:transparent;"
    document.body.appendChild(overlay)
    const onMove = (ev: MouseEvent) => ml.setCRatio((ev.clientX - rect.left) / free)
    const onUp = () => {
      overlay.remove()
      overlay.removeEventListener("mousemove", onMove)
      overlay.removeEventListener("mouseup", onUp)
    }
    overlay.addEventListener("mousemove", onMove)
    overlay.addEventListener("mouseup", onUp)
  }

  const tabStore = createTabStore()
  const snapshotStore = createSnapshotStore(() => params.id)
  const [showVersionPanel, setShowVersionPanel] = createSignal(false)
  const [snapshotList, setSnapshotList] = createSignal<import("./utils/snapshot-store").ArtifactSnapshot[]>([])
  const [snapshotVersion, setSnapshotVersion] = createSignal(0)
  const [showHistoryPanel, setShowHistoryPanel] = createSignal(false)
  const [versionList, setVersionList] = createSignal<VersionEntry[]>([])
  const [currentVersionId, setCurrentVersionId] = createSignal<string | null>(null)
  const [resultViewMode, setResultViewMode] = createSignal<"tabs" | "files" | "plan">("files")

  const historyController = createHistoryController({
    setVersionList: (updater) => setVersionList(updater),
    setCurrentVersionId: (updater) => setCurrentVersionId(updater),
    updateTabContent: (id, content) => tabStore.updateTabContent(id, content),
    setFilesRefreshKey: (updater) => setFilesRefreshKey(updater),
  })

  /** 刷新版本快照列表 */
  function refreshSnapshots() {
    setSnapshotList(snapshotStore.snapshots())
    setSnapshotVersion((v) => v + 1)
  }

  // Tab 激活时加载版本列表（仅在 activeId 变化时触发，不追踪 tabs 内容变化）
  createEffect(on(tabStore.activeId, async (id) => {
    if (!id) return
    const tab = tabStore.tabs().find((t) => t.id === id)
    if (tab) await historyController.loadVersions(tab)
  }))

  // Agent 路径 B：直接调 write/edit 工具改文件时记录版本
  createEffect(async () => {
    const key = filesRefreshKey()
    if (key === 0) return
    await historyController.onFileRefresh(tabStore.tabs())
  })

  // Prototype 用户编辑路径：applyPrototypeModify → 防抖 persistA2uiData 写 data.js 后
  // 派发 prototype:a2ui-persisted。这里监听并按 tab.filePath 定位对应 prototype tab，
  // 用 beginWrite/endWrite 包住 onUserEdit，防止 SSE file.edited 把这次写入误记为 agent 编辑。
  createEffect(() => {
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent<{ filePath: string }>).detail
      if (!detail?.filePath) return
      const target = tabStore.tabs().find((t) => t.filePath === detail.filePath)
      if (!target || target.subtype !== "prototype") return
      historyController.beginWrite(target.id)
      try {
        await historyController.onUserEdit(target)
      } finally {
        historyController.endWrite(target.id)
      }
    }
    window.addEventListener("prototype:a2ui-persisted", handler)
    onCleanup(() => window.removeEventListener("prototype:a2ui-persisted", handler))
  })

  // ── 设计方案(design-plan)扫描 ─────────────────────────────
  // 方案 artifact 从子 session 的消息流中提取（如果存在子 session），
  // 否则回退到主 session（兼容旧流程）。
  // 方案 artifact 从子 session 的消息流中提取（如果存在子 session）。
  // 只在活跃的 plan 模式下回退到主 session 扫描，
  // 避免主 session 中 agent 输出的 design-plan artifact 被重复捕获。
  const planCard = createMemo(() => {
    // 优先从活跃的子 session 扫描
    const activePlanSid = activePlanSessionId()
    if (activePlanSid) {
      const card = scanDesignPlanFromMessages(sync.data.message?.[activePlanSid], sync.data.part, activePlanSid)
      if (card) return card
    }
    // 从 childSessionIDs 中找第一个有 design-plan 的（已确认的 session 用此路径）
    const childIds = childSessionIDs()
    if (childIds.size > 0) {
      for (const childId of childIds) {
        const card = scanDesignPlanFromMessages(sync.data.message?.[childId], sync.data.part, childId)
        if (card) return card
      }
    }
    // 只有在活跃的 plan 模式下才回退到主 session 扫描
    if (!activePlanSid) return null
    const mainSid = params.id
    if (!mainSid) return null
    return scanDesignPlanFromMessages(sync.data.message?.[mainSid], sync.data.part, mainSid)
  })

  const planConfirmed = createMemo(() => {
    const ident = planCard()?.artifactIdentifier
    if (!ident) return false
    // 从 planCard 对应的 session 检测确认状态
    const planSid = planCard()?.id?.split(":")[1] || activePlanSessionId() || params.id
    if (!planSid) return false
    return isPlanConfirmed(sync.data.message?.[planSid], sync.data.part, ident)
  })

  // 子 agent 最终状态：根据子 session 消息流检测 plan 是否已被确认。
  // 与 planConfirmed 不同，这个状态直接基于 childSessionIDs 中的消息扫描，
  // 不依赖 planCard / activePlanSessionId，跨重启后也能正确恢复。
  // 依赖消息内容变化，确保异步同步完成后自动更新。
  const childPlanConfirmed = createMemo(() => {
    const childIds = [...childSessionIDs()]
    for (const childId of childIds) {
      const messages = sync.data.message?.[childId]
      if (!messages) continue
      // 显式依赖消息内容，确保消息同步完成后重新计算
      const msgLen = messages.length
      const card = scanDesignPlanFromMessages(messages, sync.data.part, childId)
      if (!card) continue
      const ident = card.artifactIdentifier
      if (!ident) continue
      if (isPlanConfirmed(messages, sync.data.part, ident)) return true
    }
    // 如果 childSessionIDs 不为空但没有消息，返回 undefined 而不是 false，
    // 以便在消息加载前保持 pending 状态
    return childIds.length > 0 && childIds.every(id => !sync.data.message?.[id]) ? undefined : false
  })

  // 乐观锁:用户点 [确认开始生成] 后立即永久 disable,直到 childPlanConfirmed 翻为 true 或 session 切换。
  // 避免 sendMessage 飞行期间(session 还没进入 busy)用户连点重复发送。
  const [optimisticConfirmed, setOptimisticConfirmed] = createSignal(false)
  const planButtonDisabled = createMemo(() => {
    const confirmed = childPlanConfirmed()
    // 当 childPlanConfirmed 为 undefined（消息未加载完）时，返回当前 disabled 状态不变
    if (confirmed === undefined) return optimisticConfirmed()
    return confirmed || optimisticConfirmed()
  })

  // 确认后等待主 agent 响应的过渡状态
  const [planConfirmPending, setPlanConfirmPending] = createSignal(false)
  // confirm-plan 发送时的界面显示文本（仅显示指令，不显示方案内容）
  let _confirmPlanDisplayText: string | undefined

  // Phase 2 异步检测子 session 期间阻止 banner 闪现（跨重启恢复时的过渡状态）
  const [phase2Pending, setPhase2Pending] = createSignal(false)

  /** 策略生成阶段按钮是否正在加载（phase 1 → phase 2 过渡） */
  const [isGenerating, setIsGenerating] = createSignal(false)

  // 切换 session 时复位乐观锁,允许新 session 重新走方案流程
  createEffect(on(() => params.id, () => setOptimisticConfirmed(false), { defer: true }))
  // 当新的 plan 出现(identifier 变化)时复位确认乐观锁,允许用户再次确认新方案
  createEffect(on(() => planCard()?.artifactIdentifier, (id, prev) => {
    if (id && id !== prev) {
      setOptimisticConfirmed(false)
    }
    if (id) setIsGenerating(false)  // plan 出现时复位 isGenerating
  }, { defer: true }))

  // 当模型输出 text/design-plan artifact 时，自动切换到 generate 阶段
  // 注意：不检测 [strategy-complete]（handleGenerateStrategy 已同步设置 phase，不需要自动检测）
  createEffect(on(
    () => {
      const planSid = activePlanSessionId()
      if (!planSid) return null
      // 如果用户手动切换了 phase，不自动切换
      if (userChangedPhase()) return null
      const currentPhase = planPhase()
      // 如果已经是 generate 阶段，不需要再检测
      if (currentPhase === "generate") return null
      const msgs = sync.data.message?.[planSid]
      if (!msgs) return null
      // 只检测助手消息中的 text/design-plan artifact
      for (const m of msgs) {
        if (m.role !== "assistant") continue
        const text = (sync.data.part?.[m.id] ?? []).filter((p: any) => p.type === "text").map((p: any) => p.text).join("\n")
        if (text?.includes('type="text/design-plan"')) {
          return "generate"
        }
      }
      return null
    },
    (phase) => {
      if (phase === "generate") setPlanPhase("generate")
    },
    { defer: true }
  ))

  // ── ict_pattern 子 session memos + effects ──────────────
  const patternSubMatchScanned = createMemo(() => {
    const sid = activePatternSessionId(); if (!sid) return null
    return scanPatternMatchFromMessages(sync.data.message?.[sid], sync.data.part)
  })
  const moduleListScanned = createMemo(() => {
    const sid = activePatternSessionId(); if (!sid) return null
    return scanModuleListFromMessages(sync.data.message?.[sid], sync.data.part)
  })
  // <module-list> 出现时自动切到 module 阶段
  createEffect(on(() => {
    const sid = activePatternSessionId(); if (!sid || patternSubPhase() === "module") return null
    return moduleListScanned()
  }, (ml) => { if (ml) setPatternSubPhase("module") }, { defer: true }))
  // <pattern-match> 扫描到后 enrich file/preview
  createEffect(on(() => patternSubMatchScanned(), async (scanned, prev) => {
    if (!scanned || scanned === prev) return
    if (scanned.results.length === 0) { setPatternMatches(null); return }
    setPatternSubEnriching(true)
    try {
      const enriched = await getPagePatternResource({ results: scanned.results })
      setPatternMatches({ results: enriched.results as any, current_step: "intent_confirm" })
    } catch (err) { console.error("[MakePage] enrich pattern match failed", err); setPatternMatches({ results: scanned.results as any, current_step: "intent_confirm" }) }
    finally { setPatternSubEnriching(false) }
  }, { defer: true }))
  // <module-list> 扫描到后调 getBlockPatternResource 搜索向量库补全预览图
  createEffect(on(() => moduleListScanned(), async (ml, prev) => {
    if (!ml || ml === prev) return
    setPatternBlockMatching(true)
    setPatternBlockMatchError(false)
    setPatternBlockMatches([])
    try {
      const result = await getBlockPatternResource({ modules: ml.modules })
      setPatternBlockMatches(result.results ?? [])
    } catch (err) { console.error("[MakePage] block pattern resource failed", err); setPatternBlockMatchError(true) }
    finally { setPatternBlockMatching(false) }
  }, { defer: true }))

  /** 用户点击 [策略生成] → 把表单数据发给子 agent，切换到第二阶段 */
  function handleGenerateStrategy() {
    const planSid = activePlanSessionId()
    const key = activeModelKey()
    if (!planSid || !key) return
    setIsGenerating(true)  // 立即禁用按钮
    const data = strategyFormData()
    const prompt = `[strategy-complete]\n\n以下是已填写的设计策略信息：\n\n## 设计需求\n- 需求背景：${data.需求背景 || "（未填写）"}\n- 设计目标：${data.设计目标 || "（未填写）"}\n- 设计方法：${data.设计方法 || "（未填写）"}\n- 其他：${data.其他 || "（未填写）"}\n\n## 洞察&研究\n- 用户画像：${data.用户画像 || "（未填写）"}\n- 用户旅程：${data.用户旅程 || "（未填写）"}\n- 研究报告：${data.研究报告 || "（未填写）"}\n\n请根据以上信息输出完整的设计策略文档。`
    sendMessage(planSid, prompt, key).catch((err) => {
      console.error("[MakePage] generate strategy failed", err)
      setIsGenerating(false)  // 失败时恢复
      setPlanPhase("strategy")  // 失败时回滚到策略准备阶段
    })
    setUserChangedPhase(false)  // 重置手动切换标记
    setPlanPhase("generate")
  }

  /** 用户点击 [上一步] / [返回策略准备] → 返回策略准备阶段 */
  function handleBackToStrategy() {
    const planSid = activePlanSessionId()
    const key = activeModelKey()
    setUserChangedPhase(true)  // 标记用户手动切换
    setPlanPhase("strategy")
    setIsGenerating(false)  // 复位生成状态，让按钮可点击、表单可填写
    // 通知子 agent 回到策略准备阶段，让后续对话上下文正确
    if (planSid && key) {
      sendMessage(planSid, "[back-to-strategy]\n\n我们已回到策略准备阶段，之前的策略生成已取消，请忽略之前生成的设计规划文档，继续帮助用户填写策略表单字段。", key).catch(() => {})
    }
  }

  /** 用户点击 [确认开始生成] → 向主 session 发送确认指令，通知主 agent 设计规划已完成，开始生成 HTML */
  async function handleConfirmPlan(identifier?: string) {
    const planSid = activePlanSessionId()
    const modelKey = activeModelKey()
    const mainSid = params.id
    if (!planSid || !modelKey || !mainSid) return
    if (planButtonDisabled()) return   // 防重复
    setOptimisticConfirmed(true)
    setPlanConfirmPending(true)  // 过渡状态：保持 plan 视图显示"正在生成 HTML..."
    const cmd = identifier ? `[confirm-plan ${identifier}]` : `[confirm-plan]`

    // 获取方案内容，让主 agent 能看到方案上下文
    const plan = planCard()
    const planContent = plan?.content ?? ""
    const message = planContent
      ? `${cmd}\n\n以下是已确认的设计方案，请基于此方案生成 HTML：\n\n${planContent}`
      : cmd
    const handoff = readPlanSkillHandoff(mainSid)

    try {
      if (handoff && handoff.childSessionId === planSid && handoff.skills.length > 0) {
        const model = `${modelKey.providerID}/${modelKey.modelID}`
        const skillPrompt = `${message}\n\n用户选择的 Skill：\n${handoff.skills.map((skill) => `/${skill.name}`).join("\n")}\n\n请执行并应用上述 Skill，同时严格遵循已确认的设计方案。`
        for (const skill of handoff.skills) {
          await sdk.client.session.command({
            sessionID: mainSid,
            command: skill.name,
            arguments: skillPrompt,
            agent: "octo_make",
            model,
          })
        }
      } else {
        // 无 Skill 时走普通 prompt；避免确认消息被 command 分支误拆。
        _confirmPlanDisplayText = cmd
        await sdk.client.session.prompt({
          sessionID: mainSid,
          agent: "octo_make",
          model: modelKey,
          parts: [{ type: "text", text: message, metadata: { displayText: cmd } }],
        })
      }
    } catch (err) {
      console.error("[MakePage] confirm plan to main session failed", err)
      setOptimisticConfirmed(false)
      setPlanConfirmPending(false)
      return
    }

    clearPlanSkillHandoff(mainSid)
    clearPlanComposerCapsule()

    // 清理子 session 状态，保留子 session 的记录（不清理 childSessionIDs）
    localStorage.removeItem(PLAN_CHILD_LOCALSTORAGE_PREFIX + mainSid)
    delete _planChildSessionCache[mainSid]
    // 持久化"已结束"标记，确保切换 session / 重启后 plan 视图只读
    localStorage.setItem(PLAN_ENDED_LOCALSTORAGE_PREFIX + mainSid, "true")
    const currentPhase = planPhase()
    setPlanEndedForSession(mainSid)
    setPlanEnded(true)
    setActivePlanSessionId(null)
    setPlanParentSessionId(null)
    setHasChildPlanSession(false)
    setManualStrategyFormData({})
    setPlanPhase(currentPhase)
    // 不切视图：保持 plan 模式，让用户看到按钮已禁用的状态
    // 等到主 agent 进入 busy 状态后再自动切回 files 视图
  }

  /** 用户点击 [调整方案] → 焦点切到输入框,预填引导文字 */
  function handleAdjustPlan() {
    setPrompt("请按以下方向调整方案:")
    requestAnimationFrame(() => textareaRef?.focus())
  }

  /** 用户点击 [结束子agent] → 中止子 agent 运行 + 退出 plan 模式，保留子 session 的对话数据 */
  function handleEndPlan() {
    const currentChildId = activePlanSessionId()
    if (currentChildId) {
      // 中止子 session 正在运行的 agent
      sdk.client.session.abort({ sessionID: currentChildId }).catch(() => {})
      // 注意：不归档子 session，保留其消息数据供后续查看
    }
    setActivePlanSessionId(null)
    setPlanParentSessionId(null)
    setHasChildPlanSession(false)
    setManualStrategyFormData({})
    setResultViewMode("files")
    setPlanPhase("strategy")
    setSending(false)
    // 提前退出规划时保留 Skill 暂存，只有确认成功后才清理。
    // 这样重新进入规划时可继续将当前方案与原 Skill 一起交接。
    setPlanEnded(true)
    const mainSid = params.id
    if (mainSid) {
      localStorage.setItem(PLAN_ENDED_LOCALSTORAGE_PREFIX + mainSid, "true")
    }
    clearPlanComposerCapsule()
    // 注意：不清除 localStorage 缓存和 _planChildSessionCache，
    // 保留子 session 的引用以便跨重启恢复和消息历史查看
    // end 不关闭规划通道，后续仍可再次触发设计规划
  }

  // ── PatternPage 模式（子 session 模式，agent = ict_pattern） ──
  // AddonMenu → 直接创建 ict_pattern 子 session（无确认弹窗）
  // Phase 1 (match): ict_pattern 输出 <pattern-match> → enrich → IntentConfirmCard Step 1
  // Phase 2 (module): 前端发 [模块匹配] + 页面规范 → ict_pattern 输出 <module-list> → getBlockPatternResource → IntentConfirmCard Step 2
  // 确认 → [confirm-pattern-page] + 模块列表 + block 内容发给主 agent

  /** AddonMenu「进入patternPage模式」→ 显示输入框胶囊，用户提交后才创建子 session */
  function handleOpenPatternPageConfirm() {
    if (activePatternSessionId() || patternPageCapsule()) return
    setPatternEnded(false)
    setPatternPageCapsule(true)
    requestAnimationFrame(() => textareaRef?.focus())
  }

  function handleCancelPatternPageComposer() {
    setPatternPageCapsule(false)
    setOptimisticPatternIntent(false)
  }

  /** 用户点击 [进入] → 创建 ict_pattern 子 session */
  async function handleEnterPatternPage() {
    const sid = params.id
    const modelKey = activeModelKey()
    if (!sid || !modelKey) return
    if (optimisticPatternIntent()) return
    setOptimisticPatternIntent(true)
    setPatternEnded(false)
    if (sid) localStorage.removeItem(PATTERN_SUB_ENDED_LS + sid)
    try {
      const dir = sdk.directory
      if (!dir) throw new Error("No directory")
      const userMsgs = userMessages()
      const lastUserMsg = userMsgs[userMsgs.length - 1]
      const rawText = lastUserMsg ? (sync.data.part[lastUserMsg.id] ?? []).filter((p: any) => p.type === "text").map((p: any) => p.text).join("\n") : ""
      const userInput = rawText.replace(/^[\s\S]*?---\n/, "").trim()
      setPatternUserInput(userInput)

      const result = await sdk.client.session.create({ directory: dir, parentID: sid, agent: "ict_pattern" })
      const childSession = result.data as Session | undefined
      if (!childSession) throw new Error("Failed to create ict_pattern session")
      loadedChildSessions.add(childSession.id)
      setChildSessionIDs((prev) => { const n = new Set(prev); n.add(childSession.id); return n })
      setActivePatternSessionId(childSession.id)
      localStorage.setItem(PATTERN_SUB_CHILD_LS + sid, childSession.id)
      _patternSubChildCache[sid] = childSession.id
      setPatternSubParentSessionId(sid)
      setPatternSubPhase("match")
      setPatternMatches(null)
      setPatternBlockMatches([])
      setPatternBlockMatching(false)
      sync.session.sync(childSession.id).catch((err: any) => console.warn("[MakePage] sync ict_pattern child failed", err))

      // 有输入直接发，无输入等用户提交
      if (userInput) {
        sdk.client.session.prompt({ sessionID: childSession.id, agent: "ict_pattern", model: modelKey, parts: [{ type: "text", text: userInput }] })
          .catch((err: any) => { console.error("[MakePage] prompt ict_pattern failed", err); setOptimisticPatternIntent(false) })
      } else {
        requestAnimationFrame(() => textareaRef?.focus())
      }
    } catch (err) { console.error("[MakePage] enter ict_pattern failed", err); setOptimisticPatternIntent(false) }
  }

  /** IntentConfirmCard onMatchPattern：用户选定 Pattern → 拉页面规范 MD → 发 [模块匹配] */
  async function handleMatchPattern(selectedItem: any) {
    const subSid = activePatternSessionId()
    const mk = activeModelKey()
    if (!subSid || !mk) return
    setPatternSubPhase("module")
    setPatternBlockMatching(true)
    setPatternBlockMatchError(false)
    setPatternBlockMatches([])
    let pageSpecMd = ""
    if (selectedItem?.file) {
      const mdResult = await readPagePatternMd(selectedItem.file)
      if (mdResult.success && mdResult.content) pageSpecMd = mdResult.content
    }
    const ui = patternUserInput() || selectedItem?.name || ""
    const prompt = `[模块匹配]\n\nPattern: ${selectedItem?.name ?? ""} (ID: ${selectedItem?.id ?? ""})\n\n【1.典型页面规范】\n${pageSpecMd || "（未获取到页面规范，请基于 Pattern 名称自行推演）"}\n\n【2.用户业务需求描述】\n${ui}`
    sendMessage(subSid, prompt, mk).catch((err) => { console.error("[MakePage] select pattern sub failed", err); setPatternBlockMatching(false); setPatternSubPhase("match") })
  }

  /** IntentConfirmCard onConfirm：用户选定 block → 下载 content → 保存 pattern 数据到 outputs（不生成 HTML） */
  async function handleConfirmPatternPage(_answers?: IntentConfirmAnswers, _enrichedInput?: string, selectedBlocks?: BlockModuleItem[]) {
    const mainSid = patternSubParentSessionId() ?? params.id
    // 立即关闭弹框
    setPatternMatches(null)
    setPatternBlockMatches([])
    setPatternBlockMatching(false)
    if (!mainSid) return
    let blocksToSend: BlockModuleItem[] = []
    if (selectedBlocks && selectedBlocks.length > 0) {
      try { blocksToSend = (await getBlockContent({ results: selectedBlocks }, mainSid)).results } catch (err) { console.error("[MakePage] getBlockContent failed", err) }
    }
    // 保存 pattern 数据到 session 的 outputs 目录（不生成 HTML，不调用 agent）
    const folderProjDir = projectDir()
    if (folderProjDir) {
      const api = getDesktopApi()
      if (api?.writeFileBuffer) {
        const sep = folderProjDir.includes("\\") ? "\\" : "/"
        const outputsDir = [folderProjDir, ".octo", mainSid, "outputs"].join(sep)
        const encoder = new TextEncoder()
        // 保存每个 block 的 content（data.json）
        for (const block of blocksToSend) {
          if (!block.content) continue
          try {
            const filePath = [outputsDir, `${block.id}.json`].join(sep)
            const buffer = encoder.encode(JSON.stringify(block.content, null, 2)).buffer as ArrayBuffer
            await api.writeFileBuffer(filePath, buffer)
          } catch (err) { console.error("[MakePage] write block json failed:", block.id, err) }
        }
        // 保存完整的 pattern 数据（modules + blocks）
        const ml = moduleListScanned()
        const payload = JSON.stringify({ modules: ml?.modules ?? [], blocks: blocksToSend }, null, 2)
        try {
          const dataPath = [outputsDir, `${mainSid}.json`].join(sep)
          const buffer = encoder.encode(payload).buffer as ArrayBuffer
          await api.writeFileBuffer(dataPath, buffer)
        } catch (err) { console.error("[MakePage] write pattern-data.json failed:", err) }
      }
    }
    // 完全退出 patternPage 模式
    setPatternEnded(true)
    setActivePatternSessionId(null)
    setPatternSubParentSessionId(null)
    setPatternSubPhase("match")
    setOptimisticPatternIntent(false)
    setPatternPageCapsule(false)
    setResultViewMode("files")
    if (mainSid) localStorage.setItem(PATTERN_SUB_ENDED_LS + mainSid, "true")
  }

  /** 用户点击 [退出] → 中止子 session + 退出 */
  function handleEndPatternPage() {
    const subSid = activePatternSessionId()
    if (subSid) sdk.client.session.abort({ sessionID: subSid }).catch(() => {})
    setActivePatternSessionId(null)
    setPatternSubParentSessionId(null)
    setPatternSubPhase("match")
    setOptimisticPatternIntent(false)
    setPatternMatches(null)
    setPatternBlockMatches([])
    setPatternBlockMatching(false)
    setPatternBlockMatchError(false)
    setPatternSubEnriching(false)
    setPatternEnded(true)
    setShowPatternPageConfirm(false)
    const sid = params.id
    if (sid) localStorage.setItem(PATTERN_SUB_ENDED_LS + sid, "true")
  }

  // ── 设计规划阶段引导 ─────────────────────────────
  // 进入设计规划：用户点击 AddonMenu「进入设计规划」→ 弹出确认弹窗 → 确认后创建子 session

  // 进入规划后立即置位，防止 API 请求期间重复创建子 session。
  const [optimisticIntentResolved, setOptimisticIntentResolved] = createSignal(false)
  // 记录用户已结束该 session 的规划状态,防止下次 AddonMenu 重新进入
  const [planEndedForSession, setPlanEndedForSession] = createSignal<string | null>(null)
  // 控制已有 session 的确认弹窗是否显示
  const [showPlanConfirm, setShowPlanConfirm] = createSignal(false)
  createEffect(on(() => params.id, () => {
    setOptimisticIntentResolved(false)
    setOptimisticPatternIntent(false)
    if (params.id) clearPlanComposerCapsule()
  }, { defer: true }))

  /** AddonMenu「进入设计规划」→ 初始页显示胶囊，已有 session 显示确认弹窗 */
  function handleOpenPlanConfirm() {
    if (!activeModelKey()) return
    if (!params.id) {
      if (planComposerActive()) return
      setPlanComposerCapsule(true)
      return
    }
    if (activePlanSessionId() || optimisticIntentResolved()) return
    setShowPlanConfirm(true)
  }

  /** 用户确认进入规划 → 创建已有主 session 的规划子 session */
  async function handleEnterPlan() {
    const sid = params.id
    const modelKey = activeModelKey()
    if (!sid || !modelKey) return
    if (optimisticIntentResolved()) return

    const editor = proseMirrorRef1?.isAlive() ? proseMirrorRef1 : proseMirrorRef2?.isAlive() ? proseMirrorRef2 : undefined
    const skills = editor?.getMentions?.().filter((mention) => mention.type === "skill") ?? []
    const composerText = editor?.getText?.() ?? ""

    setOptimisticIntentResolved(true)
    setPlanEnded(false)
    localStorage.removeItem(PLAN_ENDED_LOCALSTORAGE_PREFIX + sid)

    try {
      const dir = sdk.directory
      if (!dir) throw new Error("No directory")

      const userMsgs = userMessages()
      const lastUserMsg = userMsgs[userMsgs.length - 1]
      const rawText = lastUserMsg
        ? (sync.data.part[lastUserMsg.id] ?? []).filter((p: any) => p.type === "text").map((p: any) => p.text).join("\n")
        : composerText
      const userInput = rawText.replace(/^[\s\S]*?---\n/, "").trim()
      const initialPrompt = userInput
        ? `请分析以下用户需求，提取有用信息填写到策略表单字段中：\n\n${userInput}`
        : "请分析当前会话上下文，提取有用信息填写到策略表单字段中。"

      const result = await sdk.client.session.create({ directory: dir, parentID: sid, agent: "octo_make_plan" })
      const childSession = result.data as Session | undefined
      if (!childSession) throw new Error("Failed to create plan session")

      await sync.session.sync(childSession.id)
      setChildSessionIDs((prev) => {
        const next = new Set(prev)
        next.add(childSession.id)
        return next
      })
      setPlanChildSessionIDs((prev) => {
        const next = new Set(prev)
        next.add(childSession.id)
        return next
      })
      setActivePlanSessionId(childSession.id)
      localStorage.setItem(PLAN_CHILD_LOCALSTORAGE_PREFIX + sid, childSession.id)
      _planChildSessionCache[sid] = childSession.id
      setPlanParentSessionId(sid)
      savePlanSkillHandoff(sid, childSession.id, skills.map((skill) => ({ name: skill.name, label: skill.label })))

      setResultViewMode("plan")
      setPlanPhase("strategy")
      setUserChangedPhase(false)
      setManualStrategyFormData({})
      sync.session.sync(childSession.id).catch((err: any) => console.warn("[MakePage] sync child session failed", err))
      sdk.client.session.prompt({
        sessionID: childSession.id,
        agent: "octo_make_plan",
        model: modelKey,
        parts: [{ type: "text", text: initialPrompt }],
      }).catch((err: any) => {
        console.error("[MakePage] prompt child agent failed", err)
        setOptimisticIntentResolved(false)
      })
    } catch (err) {
      console.error("[MakePage] enter plan failed", err)
      setOptimisticIntentResolved(false)
      setActivePlanSessionId(null)
      setPlanParentSessionId(null)
      setPlanChildSessionIDs(new Set<string>())
      setHasChildPlanSession(false)
    }
  }

  // 自动滚动：保持对话区随新内容跟随到底部（用户手动上滑则不抢）
  const autoScroll = createAutoScroll({ working: () => true })

  // Bug 修复 B：切换 session 时重置 ResultViewer 的 Tabs 和关闭 popover
  // 同时尝试恢复当前主 session 的设计规划子 session（包括初次渲染和切换时）
  createEffect(on(
    () => [params.id, sync.data.session] as const,
    ([newSid, allSessions], prev) => {
      const prevSid = prev?.[0] ?? null
      const preservingPlanNavigation = sendingNavigation && !!newSid
      // 导航到 /make（无 session）时清除规划状态,防止泄漏到新会话
      if (!newSid) {
        if (prevSid) {
          setActivePlanSessionId(null)
          setPlanParentSessionId(null)
          clearPlanComposerCapsule()
          setPlanChildSessionIDs(new Set<string>())
        setHasChildPlanSession(false)
          setResultViewMode("files")
          setPlanPhase("strategy")
          setManualStrategyFormData({})
          setPhase2Pending(false)
          // 清理 patternPage 状态
          setActivePatternSessionId(null)
          setPatternSubParentSessionId(null)
          setPatternSubPhase("match")
          setPatternMatches(null)
          setPatternBlockMatches([])
          setPatternBlockMatching(false)
          setPatternBlockMatchError(false)
          setPatternSubEnriching(false)
          setPatternEnded(false)
          setPatternPageCapsule(false)
          setOptimisticPatternIntent(false)
          setShowPatternPageConfirm(false)
        }
        return
      }
      // 把当前 session 的 design-plan 编辑持久化到 snapshotStore（由 updateTabContent 覆盖），
      // 这样 tabStore.reset() 后，切回时 plan tab 能恢复用户上次的编辑，而不是被 agent 重新输出覆盖。
      persistActivePlanDraft()
      // 仅在 session 实际切换时清理规划状态,避免 handleEnterPlan 等操作
      // 触发 sync.data.session 更新后重新进入此 effect 时错误地清除状态。
      tabStore.reset()
      // preservingPlanNavigation 时也要清理 patternPage 状态（新建 session 场景）
      if (newSid !== prevSid && preservingPlanNavigation) {
        setPatternEnded(false)
        setPatternPageCapsule(false)
        setOptimisticPatternIntent(false)
        setActivePatternSessionId(null)
        setPatternSubParentSessionId(null)
        setPatternSubPhase("match")
        setPatternMatches(null)
        setPatternBlockMatches([])
        setPatternBlockMatching(false)
        setPatternBlockMatchError(false)
        setPatternSubEnriching(false)
      }
      if (newSid !== prevSid && !preservingPlanNavigation) {
        // 缓存前一个 session 的规划子 session，切回时立即恢复
        if (prevSid && activePlanSessionId()) {
          _planChildSessionCache[prevSid] = activePlanSessionId()!
          localStorage.setItem(PLAN_CHILD_LOCALSTORAGE_PREFIX + prevSid, activePlanSessionId()!)
        }
        // 缓存前一个 session 的 patternPage 子 session，切回时立即恢复
        if (prevSid && activePatternSessionId()) {
          _patternSubChildCache[prevSid] = activePatternSessionId()!
          localStorage.setItem(PATTERN_SUB_CHILD_LS + prevSid, activePatternSessionId()!)
        }
        // 清理前一个 session 的子 session 记录
        setChildSessionIDs(new Set<string>())
        loadedChildSessions.clear()
        setActivePlanSessionId(null)
        setPlanParentSessionId(null)
        clearPlanComposerCapsule()
        setPlanChildSessionIDs(new Set<string>())
        setHasChildPlanSession(false)
        setResultViewMode("files")
        setPlanPhase("strategy")
        setUserChangedPhase(false)  // 重置手动切换标记
        setManualStrategyFormData({})
        setPhase2Pending(false)
        setPlanEnded(false)  // 复位结束状态，新 session 的恢复逻辑会重新设置
        // 清理 patternPage 状态
        setActivePatternSessionId(null)
        setPatternSubParentSessionId(null)
        setPatternSubPhase("match")
        setPatternMatches(null)
        setPatternBlockMatches([])
        setPatternBlockMatching(false)
        setPatternBlockMatchError(false)
        setPatternSubEnriching(false)
        setPatternEnded(false)
        setShowPatternPageConfirm(false)
        setPatternPageCapsule(false)
      }
      // 尝试恢复当前主 session 的设计规划子 session
      let restoredPlanSid: string | null = null
      // 从 session 切换缓存中恢复（即时恢复，无需等 Phase 2 异步）
      if (newSid && _planChildSessionCache[newSid]) {
        restoredPlanSid = _planChildSessionCache[newSid]
      }
      // 第一阶段：从 sync.data.session 同步扫描（同会话内切换生效）
      // 只恢复非归档的活跃子 session
      if (allSessions) {
        for (const s of allSessions) {
          if ((s as any).parentID === newSid && (s as any).agent === "octo_make_plan" && !(s as any).time?.archived) {
            loadedChildSessions.add(s.id)
            setChildSessionIDs((prev) => { const next = new Set(prev); next.add(s.id); return next })
            sync.session.sync(s.id).catch(() => {})
            restoredPlanSid = s.id
            break
          }
        }
      }
      if (restoredPlanSid) {
        // 规划子 session 已被当前恢复流程识别，先恢复为进行中状态；只有明确的结束标记才进入只读状态。
        setPlanEndedForSession(null)
        setPlanEnded(false)
        // 检查是否已被用户退出（持久化标记）
        const isEnded = !!localStorage.getItem(PLAN_ENDED_LOCALSTORAGE_PREFIX + newSid)
        if (isEnded) {
          // 已退出：只保留历史记录，不恢复为活跃状态
          if (!loadedChildSessions.has(restoredPlanSid)) {
            loadedChildSessions.add(restoredPlanSid)
            setChildSessionIDs((prev) => { const next = new Set(prev); next.add(restoredPlanSid); return next })
            sync.session.sync(restoredPlanSid).catch(() => {})
          }
          setPlanEndedForSession(newSid)
          setPlanEnded(true)
          return
        }

        if (!loadedChildSessions.has(restoredPlanSid)) {
          loadedChildSessions.add(restoredPlanSid)
          setChildSessionIDs((prev) => { const next = new Set(prev); next.add(restoredPlanSid); return next })
          sync.session.sync(restoredPlanSid).catch(() => {})
        }
        // 检测子 session 是否已被确认
        // 已确认的子 session 只保留历史记录，不恢复为活跃状态
        const childMessages = sync.data.message?.[restoredPlanSid]
        const childParts = sync.data.part

        // 扫描 design-plan artifact
        const planArtifact = scanDesignPlanFromMessages(childMessages, childParts, restoredPlanSid)
        const planIdent = planArtifact?.artifactIdentifier

        // 使用 isPlanConfirmed 检测确认状态（包括 [confirm-plan] 和 text/html artifact）
        const isConfirmed = planIdent ? isPlanConfirmed(childMessages, childParts, planIdent) : false

        // 检测子 session 消息流中是否已有 design-plan artifact
        const hasDesignPlan = childMessages?.some((m: any) => {
          if (m.role !== "assistant") return false
          const text = (childParts?.[m.id] ?? []).filter((p: any) => p.type === "text").map((p: any) => p.text).join("\n")
          return text?.includes('type="text/design-plan"')
        })

        if (isConfirmed) {
          // 已确认：只保留历史记录，不设为活跃
          setPlanChildSessionIDs(new Set<string>())
        setHasChildPlanSession(false)
          setPlanEndedForSession(newSid)
          setPlanEnded(true)
          localStorage.setItem(PLAN_ENDED_LOCALSTORAGE_PREFIX + newSid, "true")
          // 设置 planPhase 为 generate，以便用户点击 tab 时正确显示第二阶段内容
          setPlanPhase(hasDesignPlan ? "generate" : "strategy")
          // 清理 localStorage 缓存
          localStorage.removeItem(PLAN_CHILD_LOCALSTORAGE_PREFIX + newSid)
          delete _planChildSessionCache[newSid]
        } else {
          // 未确认：恢复为活跃状态
          setActivePlanSessionId(restoredPlanSid)
          setPlanParentSessionId(newSid)
          setHasChildPlanSession(true)
          setResultViewMode("plan")
          setPlanPhase(hasDesignPlan ? "generate" : "strategy")
        }
      }
      setMentionState(null)
      setSlashState(null)

      // ── ict_pattern 子 session 恢复 ──────────────────
      let restoredPatternSubSid: string | null = null
      if (newSid && _patternSubChildCache[newSid]) restoredPatternSubSid = _patternSubChildCache[newSid]
      // 从 sync.data.session 同步扫描
      if (allSessions) {
        for (const s of allSessions) {
          if ((s as any).parentID === newSid && (s as any).agent === "ict_pattern" && !(s as any).time?.archived) {
            loadedChildSessions.add((s as any).id)
            setChildSessionIDs((prev) => { const n = new Set(prev); n.add((s as any).id); return n })
            sync.session.sync((s as any).id).catch(() => {})
            restoredPatternSubSid = (s as any).id
            break
          }
        }
      }
      if (restoredPatternSubSid) {
        if (localStorage.getItem(PATTERN_SUB_ENDED_LS + newSid)) {
          setPatternEnded(true)
        } else {
          setActivePatternSessionId(restoredPatternSubSid)
          setPatternSubParentSessionId(newSid)
          const subMsgs = sync.data.message?.[restoredPatternSubSid]
          const hasModuleList = subMsgs?.some((m: any) => {
            if (m.role !== "assistant") return false
            const text = (sync.data.part?.[m.id] ?? []).filter((p: any) => p.type === "text").map((p: any) => p.text).join("\n")
            return text?.includes("<module-list>")
          })
          setPatternSubPhase(hasModuleList ? "module" : "match")
        }
      }

      // 第一阶段：主 session 数据同步完成后，通过 API 发现并同步全部子 session。
      // sync.data.session 只包含根 session，不能用它发现子 session。
      const capturedSid = newSid
      setPhase2Pending(true)
      void discoverChildSessions(capturedSid).then(() => {
        if (params.id !== capturedSid) return
        setPhase2Pending(false)
      }).catch(() => {
        if (params.id === capturedSid) setPhase2Pending(false)
      })

      // 根据已缓存的规划 session 立即恢复视图；子 session 数据由 discovery 负责同步。
      if (!restoredPlanSid) {
        setPhase2Pending(true)
        detectChildPlanSession(newSid).then((childId) => {
          if (params.id !== newSid || !childId) return
          setActivePlanSessionId(childId)
          setPlanParentSessionId(newSid)
          setHasChildPlanSession(true)
          setResultViewMode("plan")
          setPlanPhase("strategy")
        }).finally(() => {
          if (params.id === newSid) setPhase2Pending(false)
        })
      }

      // ict_pattern 子 session 异步恢复（跨重启 fallback）
      if (!restoredPatternSubSid) {
        detectChildPatternSubSession(newSid).then((childId) => {
          if (!childId || activePatternSessionId() || params.id !== newSid) return
          if (localStorage.getItem(PATTERN_SUB_ENDED_LS + newSid)) { setPatternEnded(true); return }
          loadedChildSessions.add(childId)
          setChildSessionIDs((prev) => { const n = new Set(prev); n.add(childId); return n })
          sync.session.sync(childId).catch(() => {})
          setActivePatternSessionId(childId)
          setPatternSubParentSessionId(newSid)
        }).catch(() => {})
      }
      return

    },
  ))

  // 当子 session 消息流更新时检测确认状态（异步恢复后的延迟检测）
  // 同时也用于 planConfirmPending 期间检测子 agent 的最终状态
  // 以及跨重启后子 agent 最终状态的持久化检测
  // 这个 effect 触发 childPlanConfirmed memo 重新计算
  createEffect(on(
    () => {
      // 依赖 childSessionIDs 中所有子 session 的消息流，确保跨重启也能检测到
      const childIds = [...childSessionIDs()]
      return childIds.map(id => sync.data.message?.[id]?.length).filter(v => v !== undefined)
    },
    () => {
      const mainSid = params.id
      if (!mainSid) return

      // 遍历所有子 session 检测确认状态
      const childIds = [...childSessionIDs()]
      for (const childId of childIds) {
        const messages = sync.data.message?.[childId]
        if (!messages) continue
        const planCardFromChild = scanDesignPlanFromMessages(messages, sync.data.part, childId)
        if (!planCardFromChild) continue
        const ident = planCardFromChild.artifactIdentifier
        if (!ident) continue
        const isConfirmed = isPlanConfirmed(messages, sync.data.part, ident)

        // 子 agent 最终状态已确认，清理状态
        // 无论 planConfirmPending 还是跨重启恢复，只要子 session 消息流中出现了确认标记就处理
        if (isConfirmed) {
          if (planConfirmPending()) {
            setPlanConfirmPending(false)
          }
          // 清除 localStorage 缓存，防止下次恢复时重新进入 plan 模式
          if (mainSid) {
            localStorage.removeItem(PLAN_CHILD_LOCALSTORAGE_PREFIX + mainSid)
            delete _planChildSessionCache[mainSid]
          }
          setPlanChildSessionIDs(new Set<string>())
        setHasChildPlanSession(false)
          setPlanEndedForSession(mainSid)
          clearPlanComposerCapsule()
          if (activePlanSessionId() === childId) {
            setPlanEnded(true)
            setActivePlanSessionId(null)
            setPlanParentSessionId(null)
          }
          break
        }
      }
    }
  ))

  // 监控主 session 状态：确认后等待主 agent 进入 busy 再切换视图
  createEffect(on(
    () => sync.data.session_status[params.id ?? ""],
    (status) => {
      if (planConfirmPending() && status?.type === "busy") {
        // 主 agent 已开始工作，清理子 session 状态并切换视图
        const mainSid = params.id
        if (mainSid) {
          localStorage.removeItem(PLAN_CHILD_LOCALSTORAGE_PREFIX + mainSid)
          delete _planChildSessionCache[mainSid]
        }
        setPlanConfirmPending(false)
        setPlanEndedForSession(mainSid ?? null)
        setPlanEnded(true)
        setActivePlanSessionId(null)
        setPlanParentSessionId(null)
        setPlanChildSessionIDs(new Set<string>())
        setHasChildPlanSession(false)
        setManualStrategyFormData({})
        setResultViewMode("files")
      }
    },
    { defer: true }
  ))

    // 监控子 session 状态：子 agent 空闲但无有效 plan 时复位 isGenerating（弱模型格式异常兜底）
  createEffect(on(
    () => {
      const planSid = activePlanSessionId()
      return planSid ? sync.data.session_status[planSid]?.type : null
    },
    (statusType) => {
      if (statusType === "idle" && isGenerating()) {
        // 子 agent 空闲了但 isGenerating 仍为 true，说明模型未输出有效 design-plan
        // 检查是否确实没有 planCard
        const planSid = activePlanSessionId()
        if (!planSid) return
        const card = scanDesignPlanFromMessages(sync.data.message?.[planSid], sync.data.part, planSid)
        if (!card) {
          // 无有效 plan，安全复位
          setIsGenerating(false)
          setPlanPhase("strategy")
          setUserChangedPhase(true)
        }
      }
    },
    { defer: true }
  ))

  // 设计方案(design-plan)显示策略:plan 不再自动占用右侧 ResultViewer。
  // 而是显示为输入框上方的横条(banner),用户主动点击后才把 plan 放进 ResultViewer。
  // 用户一旦查看过(plan tab 已存在),后续 plan 内容更新会通过 openTab 的 existing 分支自动刷新。

  /** 持久化当前 session 中 design-plan tab 的编辑内容到 snapshotStore，
   *  确保切换 session 再切回后用户编辑不被 agent 重新输出覆盖。 */
  function persistActivePlanDraft() {
    const planSid = activePlanSessionId()
    if (!planSid) return
    const planTabPrefix = `plan:${planSid}:`
    for (const tab of tabStore.tabs()) {
      if (tab.type === "design-plan" && tab.id.startsWith(planTabPrefix)) {
        snapshotStore.save(tab)
        refreshSnapshots()
        return
      }
    }
  }
  /** 用户点击 plan 横条/TabBar 按钮 → 切换到 plan 模式,直接在 ResultViewer 渲染设计规划内容 */
  function handleViewPlan() {
    const plan = planCard()
    if (plan?.id) {
      // 确保 plan tab 存在于 tabStore,以便编辑内容能被持久化
      tabStore.addTabSilently(plan)
    }
    setResultViewMode("plan")
  }

  /** 处理 ResultViewer 内容编辑保存 */
  async function handleContentChange(tabId: string, content: string) {
    // design-plan 在 plan 模式下渲染时,tab 可能未通过 openTab 注册到 tabStore,
    // 导致 updateTabContent 是空操作。首次编辑时先注册。
    if (!tabStore.tabs().find((t) => t.id === tabId)) {
      const plan = planCard()
      if (plan?.id === tabId) {
        tabStore.addTabSilently(plan)
      }
    }
    // 先更新 tabStore
    tabStore.updateTabContent(tabId, content)
    const tab = tabStore.tabs().find((t) => t.id === tabId)

    if (tab) {
      const isDesignPlan = tab.type === "design-plan"
      historyController.beginWrite(tab.id)
      try {
        await persistTabChanges(tab, {
          sessionId: params.id!,
          projectDir: projectDir(),
          sdkUrl: sdk.url,
          sdkDirectory: sdk.directory || "",
          snapshotStore: snapshotStore,
          refreshSnapshots: refreshSnapshots,
          skipSnapshot: !isDesignPlan,
        })
        if (!isDesignPlan) {
          await historyController.onUserEdit(tab)
        }
      } finally {
        historyController.endWrite(tab.id)
      }
    }
    // 注：design-plan tab 的编辑不走 persistTabChanges(finalContent 是 draft,
    // 且 agent 端没有对应的 [update-plan] 指令).编辑内容已存在 tabStore +
    // snapshotStore(见 persistActivePlanDraft),切回时从 snapshot 恢复即可,
    // 不需要发消息回灌给 agent,避免 agent 重写 artifact 覆盖用户编辑。
  }

  /** 切换历史版本：交由 controller 处理 */
  async function handleHistorySwitch(entry: VersionEntry) {
    const tab = tabStore.tabs().find((t) => t.id === tabStore.activeId())
    if (!tab) return
    await historyController.switchVersion(entry, tab)
  }

  /** 关闭 tab：关闭最后一个时切换到 files 视图 */
  function handleCloseTab(id: string) {
    const tab = tabStore.tabs().find((t) => t.id === id)
    if (tab) {
      tracker.interaction({ module: "design", name: "close-tab", extend: JSON.stringify({ type: tab.type }) })
    }
    tabStore.closeTab(id)
    setShowHistoryPanel(false)
    if (tabStore.tabs().length === 0) {
      layout.focusMode.set(false)
      setResultViewMode("files")
    }
  }

  // ── session 操作 ──────────────────────────────────────────

  /** 创建新 session 并导航 */
  async function createAndNavigate(): Promise<string | undefined> {
    const dir = sdk.directory
    console.log("[MakePage] createAndNavigate dir:", dir)
    if (!dir) return
    setSending(true)
    try {
      const result = await sdk.client.session.create({ directory: dir, agent: "octo_make" })
      const session = result.data as Session | undefined
      console.log("[MakePage] session created:", { id: session?.id, agent: session?.agent, directory: session?.directory })
      if (session) {
        tracker.interaction({ module: "design", name: "new-session" })
        navigate(`/make/${session.id}`)
        return session.id
      }
    } catch (err) {
      console.error("[MakePage] session.create failed", err)
    } finally {
      setSending(false)
    }
    return undefined
  }

  /** 发送消息：组装 DesignSystem + Craft 上下文，调用 session.prompt */
  async function sendMessage(sessionId: string, text: string, modelKey: { providerID: string; modelID: string }, mentions?: MentionAttrs[]) {
    try {
      // Process mention selections: replace chip text with model format
      let processedText = text
      let displayText = text
      const selections = mentions ?? []
      
      console.log("[sendMessage] mentions:", mentions)
      console.log("[sendMessage] skillToolCalls:", skillToolCalls())

      for (const sel of selections) {
        if (sel.type === 'skill') {
          processedText = processedText.replace(`@${sel.name}`, ` /${sel.name} `)
          // chip 在输入框里渲染成 displayName,但 getText 返回的是 @skillName(getDocTextWithMentions 用 attrs.name)。
          // 这里把 displayText 里的 @skillName 同步替换成 @displayName,聊天记录里显示的就跟输入框一致。
          if (sel.label && sel.label !== sel.name) {
            displayText = displayText.replace(`@${sel.name}`, () => `@${sel.label}`)
          }
        } else {
          processedText = processedText.replace(`@${sel.name}`, ` 读取${sel.path} 这个文件 `)
        }
      }
      // Clean up extra spaces
      processedText = processedText.replace(/  +/g, ' ').trim()
      
      console.log("[sendMessage] displayText:", displayText)
      console.log("[sendMessage] processedText:", processedText)
      
      // Clear mention selections after processing
      setMentionSelections([])
      
      const done = attachments().filter(a => a.status === "done")
      
      // 本地文件 → [附件] 清单
      const localFiles = done.filter(a => a.source === "local" && a.path)
      const localManifest = localFiles.map(a => ({ filename: a.filename, path: a.path! }))
      
      // 外部文件 → FilePart
      const externalFiles = done.filter(a => a.source === "external")
      const fileParts: FilePartInput[] = externalFiles.map(a => ({
        type: "file",
        mime: a.mime,
        filename: a.filename,
        url: a.url ?? a.dataUrl!,
      }))

      // 附件已快照到 fileParts/localManifest，立即清空 UI；
      // 否则要等 await session.prompt 完成才会清空，造成"附件要等模型回复完成才消失"的现象
      setAttachments([])

      // ── Artifact folder context（无论命令还是 prompt 路径，都在最开头注入） ──
      // 告诉 agent 用 write 工具时的目标目录绝对路径，以及当前会话已有的产物文件列表（供 edit 工具使用）。
      // 文件列表每轮 sendMessage 都重新扫盘，保证新鲜。
      let artifactFolderPrefix = ""
      const folderProjDir = projectDir()
      if (folderProjDir && sessionId) {
        const sep = folderProjDir.includes("\\") ? "\\" : "/"
        const artifactFolder = [folderProjDir, ".octo", sessionId, "outputs"].join(sep)
        let existingList = ""
        try {
          const relPath = `.octo/${sessionId}/outputs`
          const result = await sdk.client.file.list({ path: relPath })
          const files = (result.data ?? []).filter((n) => n.type === "file")
          if (files.length > 0) {
            const lines = files.map((n) => `- ${n.absolute}`)
            existingList = [
              ``,
              `[Existing artifacts in this session]`,
              ...lines,
              `When the user references a previously-generated artifact in this session for modification, use the edit tool on the matching file path above. If the file is not listed, re-output a full <artifact> instead; do not edit files outside this list.`,
            ].join("\n")
          }
        } catch {
          // 目录可能还没创建(还没生成过产物),忽略
        }
        artifactFolderPrefix = [
          `[Artifact Folder]: ${artifactFolder}`,
          `Prefer the <artifact> tag for output; do NOT use the write tool by default. Only if the user EXPLICITLY asks to use the write tool, you MUST write files inside this folder and nowhere else.`,
          existingList,
          `---`,
          ``,
        ].filter(Boolean).join("\n")
      }

      // ── Multi-slash-command detection ──
      // Scan all tokens in processedText for /cmd patterns, match against sync.data.command,
      // execute each via session.command(). Each command gets the text between itself
      // and the next /cmd as its arguments. Commands are self-contained (no follow-up prompt).
      console.log("[MakePage] slash-detect input:", {
        processedText,
        cmdCount: sync.data?.command?.length ?? 0,
        cmdNames: sync.data?.command?.map((c) => `${c.name}(${c.source})`) ?? [],
      })
      const segments = processedText.split(/(?=\/\S)/)
      const cmdSegments: { cmd: string; args: string }[] = []
      let hasCommand = false
      for (const seg of segments) {
        const trimmed = seg.trim()
        if (!trimmed) continue
        const m = trimmed.match(/^\/(\S+)([\s\S]*)$/)
        if (m) {
          const cmdName = m[1]
          const matched = cmdName ? sync.data.command.find((c) => c.name === cmdName) : undefined
          if (cmdName && matched) {
            console.log("[MakePage] slash-detect matched command:", {
              cmdName,
              source: matched.source,
              args: m[2].trim(),
            })
            cmdSegments.push({ cmd: cmdName, args: m[2].trim() })
            hasCommand = true
            continue
          }
          // /cmd 存在但不在 sync.data.command 中 → 会落入 prompt 纯文本，不触发 skill.used
          console.log("[MakePage] slash-detect NOT in sync.data.command:", {
            cmdName,
            fallbackToPrompt: !hasCommand,
          })
        }
        // Non-command segment: only keep if no commands found (for prompt fallback)
        if (!hasCommand) {
          cmdSegments.push({ cmd: "", args: trimmed })
        }
      }
      console.log("[MakePage] slash-detect result:", { hasCommand, cmdSegments })

      if (hasCommand) {
        const modelStr = `${modelKey.providerID}/${modelKey.modelID}`
        
        // Find skill mentions to preserve display text for chips
        const skillMentions = selections.filter(s => s.type === 'skill')
        
        // Save full display text (contains all text and @mentions)
        const fullDisplayText = displayText
        let isFirstSkillCommand = true
        let artifactFolderInjected = false
        
        // 添加本地文件清单
        const manifestPart = localManifest.length > 0 
          ? { type: "text" as const, text: formatUploadsForPrompt(localManifest), synthetic: true as const }
          : null
        
        for (const seg of cmdSegments) {
          if (!seg.cmd) continue

          // Build parts: file parts + local manifest + optional text part with metadata for skill chips
          const cmdParts: Array<FilePartInput | TextPartInput> = [...fileParts]
          if (manifestPart) cmdParts.push(manifestPart)

          // 注入 artifact folder context（仅注入一次）
          if (artifactFolderPrefix && !artifactFolderInjected) {
            cmdParts.unshift({ type: "text", text: artifactFolderPrefix, synthetic: true })
            artifactFolderInjected = true
          }
          
          // If this command is a skill from @mention, add metadata for chip display
          const isSkillMention = skillMentions.some(s => s.name === seg.cmd)
          if (isSkillMention) {
            cmdParts.push({
              type: "text",
              text: seg.args || " ",
              metadata: { displayText: isFirstSkillCommand ? fullDisplayText : "" }
            })
            isFirstSkillCommand = false
          }
          
          try {
            await sdk.client.session.command({
              sessionID: sessionId,
              command: seg.cmd,
              arguments: seg.args,
              agent: sessionId === activePlanSessionId() ? "octo_make_plan" : sessionId === activePatternSessionId() ? "ict_pattern" : "octo_make",
              model: modelStr,
              parts: cmdParts.length > 0 ? cmdParts : undefined,
            })
          } catch (err) {
            console.error(`[MakePage] command /${seg.cmd} failed`, err)
          }
        }

        setAttachments([])
        return  // Commands are self-contained, skip prompt
      }
      // ── End command detection ──

      // Store display text for rendering (user's visible text with @mentions)
      const hasMentions = selections.length > 0
      const userDisplayText = _confirmPlanDisplayText ?? (hasMentions ? displayText : undefined)
      _confirmPlanDisplayText = undefined

      let promptText = processedText

      const loadedSkills = skillToolCalls()
      if (loadedSkills.length > 0) {
        const skillPrefix = loadedSkills
          .filter(call => call.status === "done" && call.output)
          .map(call => [
            `<skill_content name="${call.input?.name}">`,
            call.output,
            "</skill_content>",
            ""
          ].join("\n"))
          .join("\n")
        
        promptText = skillPrefix + "\n" + processedText
        setSkillToolCalls([])
      }

      // Design system prompt injection (prepended as hidden context, user text preserved)
      const dsId = selectedDesignSystem()
      if (dsId) {
        let dsPrefix = ""
        try {
          const ds = await loadDesignSystem(dsId)
          if (!ds.design && !ds.tokens) {
            console.warn("[MakePage] design system loaded but empty:", dsId)
          }
          dsPrefix = [
            `[Design System: ${dsId}]`,
            `The active design system is "${dsId}". Its full specification follows below.`,
            `You MUST apply this design system to every artifact you create in this session:`,
            `1. Paste the :root CSS custom properties block below VERBATIM as the FIRST thing inside your <style> tag`,
            `2. Use var(--fg), var(--bg), var(--accent), var(--surface), var(--border), var(--font-display), var(--font-body), var(--radius-*), var(--elev-*) etc. throughout your CSS instead of hard-coded colors/values`,
            `3. Follow the DESIGN.md rules for component styling, typography hierarchy, spacing, shadows, and radius`,
            `4. Do NOT invent CSS variables that don't exist in the :root block below`,
            `5. The design system content below is authoritative — it is not empty, use ALL of it`,
            ``,
            `## DESIGN.md (authoritative visual rules for ${dsId})`,
            ``,
            ds.design,
            ``,
            `## :root tokens (paste verbatim into <style>)`,
            ``,
            "```css",
            ds.tokens,
            "```",
            "",
            "---",
          ].join("\n")
        } catch (err) {
          console.error("[MakePage] design system load failed", err)
        }

        // Craft document injection (design quality guides)
        try {
          const crafts = await loadCrafts(["anti-ai-slop", "typography", "color"])
          if (crafts) {
            dsPrefix += [
              "",
              "## Design Quality Guides (mandatory)",
              "",
              crafts,
              "",
              "---",
            ].join("\n")
          }
        } catch (err) {
          console.error("[MakePage] craft load failed", err)
        }

        if (dsPrefix) {
          promptText = dsPrefix + "\n" + text
        }
      }

      // Artifact folder injection（使用前面已构建的 artifactFolderPrefix）
      if (artifactFolderPrefix) {
        promptText = artifactFolderPrefix + "\n" + promptText
      }

      // jk-j60099994-replace-with-60062650-octoapp-make-index-1-start
      // jk-j60099994-replace-with-60062650-octoapp-make-index-1-end

      const textPart: TextPartInput = { 
        type: "text", 
        text: promptText,
        ...(userDisplayText ? { metadata: { displayText: userDisplayText } } : {}),
      }
      
      console.log("[sendMessage] textPart:", textPart)
      console.log("[sendMessage] userDisplayText:", userDisplayText)
      
      // 本地文件清单 (synthetic)
      const manifestPart = localManifest.length > 0 
        ? { type: "text" as const, text: formatUploadsForPrompt(localManifest), synthetic: true as const }
        : null
      
      if (!modelKey) {
        setAttachments([])
        return
      }
      tracker.interaction({
        module: "design",
        name: "send-message",
        extend: JSON.stringify({ 
          hasAttachment: fileParts.length > 0 || localManifest.length > 0, 
          designSystem: dsId ?? null 
        }),
      })
      
      const parts: Array<TextPartInput | FilePartInput> = [textPart]
      if (manifestPart) parts.push(manifestPart)
      parts.push(...fileParts)
      
      // 记录发送开始时间
      messageTimingMap.set(sessionId, {
        startTime: Date.now(),
        inputText: text.slice(0, 30)
      })
      
      await sdk.client.session.prompt({
        sessionID: sessionId,
        agent: sessionId === activePlanSessionId() ? "octo_make_plan" : sessionId === activePatternSessionId() ? "ict_pattern" : "octo_make",
        ...(modelKey ? { model: modelKey } : {}),
        parts,
      })
      setAttachments([])
      requestAnimationFrame(() => autoScroll.forceScrollToBottom())
    } catch (err) {
      console.error("[MakePage] prompt failed", err)
      setAttachments([])
    }
  }

  /** 提交 prompt：自动创建 session → 发送消息 */
  async function handleSubmit() {
    // 基于 hasContent() 选择正确的编辑器
    let text: string
    let mentions: MentionAttrs[]
    
    if (hasContent()) {
      text = proseMirrorRef2?.getText?.() || ""
      mentions = proseMirrorRef2?.getMentions?.() || []
    } else {
      text = proseMirrorRef1?.getText?.() || ""
      mentions = proseMirrorRef1?.getMentions?.() || []
    }
    
    // 注入 specSelector 的 skill
    const specName = selectedSpecName()
    const specDisplay = selectedSpecDisplay()
    if (specName && specDisplay) {
      text = `@${specName} ` + text
      mentions = [{ type: 'skill', name: specName, label: specDisplay, id: specName, path: "" }, ...mentions]
    }
    
    if (effectiveBusy() || !activeModelKey()) return

    if (hasImageAttachments() && !ensureMultimodalModel()) {
      showOctoToast({ title: "当前模型不支持图像输入", description: "请手动切换到支持多模态的模型", variant: "error" })
      return
    }

    // 在异步操作前捕获 model key，避免后续被其他 effect 修改
    const capturedModelKey = activeModelKey()
    if (!capturedModelKey) return

    if (!text.trim()) return

    const shouldStartInitialPlan = !params.id && planComposerActive()
    const shouldStartPatternPage = patternPageCapsuleActive()
    setSending(true)
    setPrompt("")
    if (shouldStartInitialPlan) clearPlanComposerCapsule()
    if (shouldStartPatternPage) setPatternPageCapsule(false)
    setPatternUserInput(text.replace(/^[\s\S]*?---\n/, "").trim())
    proseMirrorRef1?.clear()
    proseMirrorRef2?.clear()
    const planSid = activePlanSessionId() && planParentSessionId() === params.id ? activePlanSessionId() : null
    const patternSubSid = activePatternSessionId() && patternSubParentSessionId() === params.id ? activePatternSessionId() : null
    const submitSessionId = planSid || patternSubSid || params.id
    // patternPage 模式：记录用户输入用于后续 Phase 2 拼装
    if (patternSubSid) setPatternUserInput(text)
    try {
      let sid = submitSessionId
      if (!sid) {
        const dir = sdk.directory
        if (!dir) return
        const result = await sdk.client.session.create({ directory: dir, agent: "octo_make" })
        const session = result.data as Session | undefined
        if (!session) return

        if (shouldStartInitialPlan) {
          const dir = sdk.directory
          const skills = mentions
            .filter((mention) => mention.type === "skill")
            .map((skill) => ({ name: skill.name, label: skill.label }))
          const userInput = text.replace(/^[\\s\\S]*?---\\n/, "").trim()
          const initialPrompt = userInput
            ? `请分析以下用户需求，提取有用信息填写到策略表单字段中：\\n\\n${userInput}`
            : "请分析当前会话上下文，提取有用信息填写到策略表单字段中。"

          await movePendingUploadsToSession(session.id)
          await moveAssetsConfigToSession(session.id)

          const planResult = await sdk.client.session.create({
            directory: dir,
            parentID: session.id,
            agent: "octo_make_plan",
          })
          const childSession = planResult.data as Session | undefined
          if (!childSession) throw new Error("Failed to create plan session")

          loadedChildSessions.add(childSession.id)
          setChildSessionIDs((prev) => {
            const next = new Set(prev)
            next.add(childSession.id)
            return next
          })
          setPlanChildSessionIDs((prev) => {
            const next = new Set(prev)
            next.add(childSession.id)
            return next
          })
          setActivePlanSessionId(childSession.id)
          setPlanParentSessionId(session.id)
          setPlanEndedForSession(null)
          setPlanEnded(false)
          localStorage.removeItem(PLAN_ENDED_LOCALSTORAGE_PREFIX + session.id)
          setPlanChildSessionIDs((prev) => { const next = new Set(prev); next.add(childSession.id); return next })
          localStorage.setItem(PLAN_CHILD_LOCALSTORAGE_PREFIX + session.id, childSession.id)
          _planChildSessionCache[session.id] = childSession.id
          savePlanSkillHandoff(session.id, childSession.id, skills)
          setResultViewMode("plan")
          setPlanPhase("strategy")
          setUserChangedPhase(false)
          setManualStrategyFormData({})

          local.session.promote(sdk.directory, session.id)
          await sync.session.sync(childSession.id)
          sendingNavigation = true
          navigate(`/make/${session.id}`)
          await sdk.client.session.prompt({
            sessionID: childSession.id,
            agent: "octo_make_plan",
            model: capturedModelKey,
            parts: [{ type: "text", text: initialPrompt }],
          })
          return
        }

        // 无 session + PatternPage 胶囊：创建主 session + ict_pattern 子 session
        if (shouldStartPatternPage) {
          const dir2 = sdk.directory
          const userInput2 = text.replace(/^[\s\S]*?---\n/, "").trim()
          const patternChild = await sdk.client.session.create({ directory: dir2, parentID: session.id, agent: "ict_pattern" })
          const patternChildSession = patternChild.data as Session | undefined
          if (patternChildSession) {
            loadedChildSessions.add(patternChildSession.id)
            setChildSessionIDs((prev) => { const n = new Set(prev); n.add(patternChildSession.id); return n })
            setActivePatternSessionId(patternChildSession.id)
            setPatternSubParentSessionId(session.id)
            localStorage.setItem(PATTERN_SUB_CHILD_LS + session.id, patternChildSession.id)
            _patternSubChildCache[session.id] = patternChildSession.id
            setPatternSubPhase("match")
            setPatternMatches(null)
            await sync.session.sync(patternChildSession.id)
          }
          local.session.promote(sdk.directory, session.id)
          sendingNavigation = true
          navigate(`/make/${session.id}`)
          if (patternChildSession && userInput2) {
            await sdk.client.session.prompt({
              sessionID: patternChildSession.id, agent: "ict_pattern", model: capturedModelKey,
              parts: [{ type: "text", text: userInput2 }],
            })
          }
          return
        }

        await movePendingUploadsToSession(session.id)

      // 如果用户没有手动选择 spec，检查是否有存量配置
      if (!selectedSpecDisplay()) {
        const api = getDesktopApi()
        if (api?.getAssetsConfig) {
          try {
            const info = await api.getAssetsConfig() as AssetsConfig
            
            // 设置显示值和技能名称
            const designSpec = info?.user?.designSpec
            const placeholder = info?.user?.placeholder
            if (designSpec) setSelectedSpecName(designSpec)
            if (placeholder) setSelectedSpecDisplay(placeholder)
            
            // 保存 sessionJson 到临时文件
            const sessionJson = info?.user?.sessionJson
            const projectDirValue = projectDir()
            if (sessionJson && projectDirValue && api?.writeFileBuffer) {
              const sep = projectDirValue.includes("\\") ? "\\" : "/"
              const configPath = [projectDirValue, ".octo", "tmps", "make", "resource", "assets_config.json"].join(sep)
              const encoder = new TextEncoder()
              const buffer = encoder.encode(sessionJson).buffer as ArrayBuffer
              await api.writeFileBuffer(configPath, buffer)
            }
          } catch (err) {
            console.error("[handleSubmit] Failed to get assets config:", err)
          }
        }
      }
      
      await moveAssetsConfigToSession(session.id)

      local.session.promote(sdk.directory, session.id)
      const dsId = selectedDesignSystem()
if (dsId) {
          localStorage.setItem(DS_KEY_PREFIX + session.id, dsId)
        }
        sendingNavigation = true
        navigate(`/make/${session.id}`)
        sid = session.id
      }
      autoScroll.forceScrollToBottom()
      // 有 session + PatternPage 胶囊：创建 ict_pattern 子 session，消息发给子 session
      if (shouldStartPatternPage && sid && !shouldStartInitialPlan) {
        const dir2 = sdk.directory
        if (dir2) {
          const patternChild = await sdk.client.session.create({ directory: dir2, parentID: sid, agent: "ict_pattern" })
          const patternChildSession = patternChild.data as Session | undefined
          if (patternChildSession) {
            loadedChildSessions.add(patternChildSession.id)
            setChildSessionIDs((prev) => { const n = new Set(prev); n.add(patternChildSession.id); return n })
            setActivePatternSessionId(patternChildSession.id)
            setPatternSubParentSessionId(sid)
            localStorage.setItem(PATTERN_SUB_CHILD_LS + sid, patternChildSession.id)
            _patternSubChildCache[sid] = patternChildSession.id
            setPatternSubPhase("match")
            setPatternMatches(null)
            sync.session.sync(patternChildSession.id).catch(() => {})
            await sendMessage(patternChildSession.id, text, capturedModelKey, mentions)
          }
        }
      } else {
        await sendMessage(sid, text, capturedModelKey, mentions)
      }
    } catch (err) {
      console.error("[MakePage] handleSubmit failed", err)
    } finally {
      // 重置 sending：如果是主 session 或 plan 子 session 且未切换，则允许重置
      if (!submitSessionId || params.id === submitSessionId || (planSid && activePlanSessionId() === planSid) || (patternSubSid && activePatternSessionId() === patternSubSid)) {
        setSending(false)
      }
    }
  }

  /** 终止当前生成 */
  async function halt() {
    const childId = activePlanSessionId() ?? activePatternSessionId()
    if (childId && childBusy()) {
      tracker.interaction({ module: "design", name: "stop-generation" })
      await sdk.client.session.abort({ sessionID: childId }).catch(() => {})
      return
    }
    const sid = params.id
    if (!sid) return
    tracker.interaction({ module: "design", name: "stop-generation" })
    await sdk.client.session.abort({ sessionID: sid }).catch(() => {})
  }

  function handleCompositionStart() {
    setComposing(true)
  }
  function handleCompositionEnd() {
    setComposing(false)
  }

  /** Handle keyboard events including slash command navigation */
  function handleKeyDown(e: KeyboardEvent) {
    // 输入法合成期间(如拼音待选)的回车用于确认候选词,不应触发发送
    // isComposing / keyCode 229 兼容各平台输入法(macOS 拼音回车补偿尤其需要)
    if (e.isComposing || e.keyCode === 229) return

    // Backspace to delete chip markers
    if (e.key === "Backspace") {
      const ta = textareaRef
      const cursor = ta.selectionStart
      const text = prompt()
      
      // Check if cursor is right after a chip (@name format)
      const beforeCursor = text.slice(0, cursor)
      const chipMatch = beforeCursor.match(/@[^\s@]+\s*$/)
      if (chipMatch) {
        e.preventDefault()
        const chipStart = cursor - chipMatch[0]!.length
        const after = text.slice(cursor)
        const next = text.slice(0, chipStart) + after
        setPrompt(next)
        
        // Also remove from mentionSelections
        const chipName = chipMatch[0]!.replace(/@\s*/g, '').trim()
        setMentionSelections(prev => prev.filter(s => 
          s.type === 'skill' ? s.name !== chipName : s.filename !== chipName
        ))
        
        // Update cursor position
        requestAnimationFrame(() => {
          ta.focus()
          ta.setSelectionRange(chipStart, chipStart)
        })
        return
      }
    }

    const slash = slashState()
    const mention = mentionState()

    // Mention popover close on Escape
    if (mention && artifactFilesMirror()) {
      if (e.key === "Escape") {
        e.preventDefault()
        e.stopPropagation()
        setMentionState(null)
        return
      }
    }

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

    // Enter to send (only when both popovers are closed)
    if (e.key === "Enter" && !e.shiftKey && !slash && !mention) {
      if (e.isComposing || composing() || e.keyCode === 229) return
      e.preventDefault()

      // Check for /preview command
      const previewMatch = prompt().match(/^\/preview\s+(.+)$/)
      if (previewMatch) {
        const target = previewMatch[1].trim()
        handleOpenLocalFile(target)
        setPrompt("")
        return
      }

      void handleSubmit()
    }
  }

  /** Handle input changes and detect slash/@ mention trigger */
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
      setMentionState(null)
      return
    }
    setSlashState(null)

    // Detect @ mention trigger: @ after word boundary
    const before = value.slice(0, cursor)
    const mentionMatch = /(?:^|\s)@([^\s@]*)$/.exec(before)
    if (mentionMatch) {
      setMentionState({ query: mentionMatch[1] ?? "", cursor })
      loadSkillConfig()
    } else {
      setMentionState(null)
    }
  }

  /** Pick a slash command and insert into editor */
  function pickSlash(cmd: SlashCommand) {
    if (!slashState()) return

    const ref = hasContent() ? proseMirrorRef2 : proseMirrorRef1
    ref?.replaceSlashCommand?.(`/${cmd.trigger} `)

    setSlashState(null)
  }

  /** Remove pending skill */
  function removePendingSkill() {
    setPendingSkill(null)
  }

  /** Handle addon menu selection (skill or file) — inserts a chip via ProseMirrorEditor ref */
  function getAliveEditor() {
    if (proseMirrorRef1?.isAlive()) return proseMirrorRef1
    if (proseMirrorRef2?.isAlive()) return proseMirrorRef2
    return undefined
  }

  function handleAddonSelect(selection: MentionSelection) {
    getAliveEditor()?.insertMention(selection)
  }

  function handleAddonDeselect(selection: MentionSelection) {
    getAliveEditor()?.removeMention(selection)
  }

  function handleAddonUpdateMentionPath(filename: string, path: string) {
    getAliveEditor()?.updateMentionPath(filename, path)
  }

  /** Pick a Design Files file and add as attachment */
  async function pickMention(file: ArtifactFile) {
    const state = mentionState()
    if (!state) return

    const ta = textareaRef
    const value = prompt()

    // Remove @query text from prompt
    const before = value.slice(0, state.cursor - state.query.length - 1)
    const after = value.slice(ta.selectionStart)
    const next = before + after
    setPrompt(next)
    setMentionState(null)

    await addArtifactToSession(file)

    requestAnimationFrame(() => {
      ta.focus()
      ta.setSelectionRange(before.length, before.length)
    })
  }

  /** Add artifact file to session attachments (仅记录路径，不发内容) */
  function addArtifactToSession(file: ArtifactFile) {
    if (attachments().some(a => a.path === file.path)) {
      showOctoToast({ title: "已添加", description: file.name })
      return
    }

    if (maxAttachments()) {
      showOctoToast({ title: "附件数量已达上限", description: "最多添加 5 个附件" })
      return
    }

    setAttachments(prev => [...prev, {
      id: crypto.randomUUID(),
      filename: file.name,
      mime: file.mime || getMimeForKind(file.kind),
      size: file.size,
      status: 'done',
      source: 'local',
      path: file.path,
      kind: file.kind,
    }])
    showOctoToast({ title: "已添加附件", description: file.name })
  }

  function getMimeForKind(kind: ArtifactFileKind): string {
    const map: Record<ArtifactFileKind, string> = {
      folder: "",
      image: "image/png",
      html: "text/html",
      svg: "image/svg+xml",
      markdown: "text/markdown",
      code: "text/plain",
      text: "text/plain",
      pdf: "application/pdf",
      document: "application/octet-stream",
      video: "video/mp4",
      audio: "audio/mp3",
      binary: "application/octet-stream",
    }
    return map[kind] ?? "application/octet-stream"
  }

  // ── 附件管理 ─────────────────────────────────────────────

  let fileInputRef!: HTMLInputElement

  function handleAddFiles(files: File[], method: "picker" | "drop" | "paste") {
    const slots = 5 - attachments().length
    if (files.length > slots) {
      showOctoToast({ title: "最多添加5个附件" })
    }
    const toAdd = files.slice(0, slots)
    for (const file of toAdd) {
      tracker.interaction({ 
        module: "design", 
        name: "add-attachment", 
        extend: JSON.stringify({ method, filename: file.name }) 
      })
      
      if (isImageFile(file.name)) {
        addImageAttachment(file)
      } else {
        addLocalFileAttachment(file)
      }
    }
  }

  async function addImageAttachment(file: File) {
    const id = crypto.randomUUID()
    const previewUrl = URL.createObjectURL(file)
    filesById.set(id, file)
    
    setAttachments(prev => [...prev, {
      id,
      filename: file.name,
      mime: file.type || 'image/png',
      size: file.size,
      status: 'uploading',
      source: 'external',
      previewUrl
    }])
    
    try {
      const result = await uploadFile(file)
      setAttachments(prev => prev.map(a => 
        a.id === id ? { ...a, status: 'done' as const, url: result.url } : a
      ))
    } catch (err) {
      const message = err instanceof UploadError ? err.message : '上传失败'
      setAttachments(prev => prev.map(a =>
        a.id === id ? { ...a, status: 'error' as const, error: message, retriable: true } : a
      ))
    }
  }

  async function addLocalFileAttachment(file: File) {
    const id = crypto.randomUUID()
    const sid = params.id
    
    if (!sid) {
      setAttachments(prev => [...prev, {
        id,
        filename: file.name,
        mime: file.type || 'application/octet-stream',
        size: file.size,
        status: 'uploading',
        source: 'pending',
      }])
      
      try {
        const projectDirValue = projectDir()
        if (!projectDirValue) {
          showOctoToast({ title: "无法添加附件", description: "未选择项目目录", variant: "error" })
          return
        }
        
        const api = getDesktopApi()
        if (!api?.writeFileBuffer) {
          showOctoToast({ title: "无法添加附件", description: "不支持文件操作", variant: "error" })
          return
        }
        
        const buffer = await file.arrayBuffer()
        const sep = projectDirValue.includes("\\") ? "\\" : "/"
        const tempPath = [projectDirValue, ".octo", "tmps", "make", "uploads", file.name].join(sep)
        
        await api.writeFileBuffer(tempPath, buffer)
        
        setAttachments(prev => prev.map(a => 
          a.id === id ? { 
            ...a, 
            status: 'done' as const,
            source: 'pending' as const,
            path: tempPath,
          } : a
        ))
        
        showOctoToast({ title: "已添加附件", description: file.name })
      } catch (err) {
        const message = err instanceof Error ? err.message : '保存失败'
        setAttachments(prev => prev.map(a =>
          a.id === id ? { ...a, status: 'error' as const, error: message } : a
        ))
      }
      return
    }
    
    setAttachments(prev => [...prev, {
      id,
      filename: file.name,
      mime: file.type || 'application/octet-stream',
      size: file.size,
      status: 'uploading',
      source: 'external',
    }])
    
    try {
      const reader = new FileReader()
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const result = reader.result as string
          resolve(result.split(",")[1] || result)
        }
        reader.onerror = () => reject(new Error("读取文件失败"))
        reader.readAsDataURL(file)
      })
      
      const result = await uploadArtifactFile(
        globalSDK.url,
        sdk.directory || "",
        sid,
        file.name,
        base64,
      )
      
      setAttachments(prev => prev.map(a => 
        a.id === id ? { 
          ...a, 
          status: 'done' as const, 
          source: 'local' as const,
          path: result.path,
        } : a
      ))
    } catch (err) {
      const message = err instanceof Error ? err.message : '上传失败'
      setAttachments(prev => prev.map(a =>
        a.id === id ? { ...a, status: 'error' as const, error: message } : a
      ))
    }
  }

  /**
   * Download a URL and save it into the current session's uploads directory,
   * then add it as an attachment. Reports progress via onProgress (0-100).
   * Filename is taken from the URL's hash fragment if present, else from pathname.
   */
  async function downloadUrlToSession(
    url: string,
    onProgress: (pct: number) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const sid = params.id

    const projectDirValue = projectDir()
    if (!projectDirValue) throw new Error("未选择项目目录")

    const api = getDesktopApi()
    if (!api?.writeFileBuffer) throw new Error("不支持文件操作")

    onProgress(0)
    const response = await fetch(url, { signal })
    if (!response.ok) throw new Error(`下载失败: ${response.status}`)
    const blob = await response.blob()
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError")
    const buffer = await blob.arrayBuffer()

    // Filename: prefer URL hash fragment, else pathname basename, else fallback
    const parsed = new URL(url)
    let filename: string
    if (parsed.hash && parsed.hash.length > 1) {
      filename = decodeURIComponent(parsed.hash.slice(1))
    } else {
      const basename = parsed.pathname.split("/").filter(Boolean).pop() || ""
      filename = basename || `download-${crypto.randomUUID().slice(0, 8)}`
    }
    // Strip any path separators in filename to prevent traversal
    filename = filename.split(/[\\/]/).pop() || filename

    const sep = projectDirValue.includes("\\") ? "\\" : "/"
    // No session yet → stage in tmps (same as addLocalFileAttachment); session ready → land in uploads/
    const destPath = sid
      ? [projectDirValue, ".octo", sid, "uploads", filename].join(sep)
      : [projectDirValue, ".octo", "tmps", "make", "uploads", filename].join(sep)

    await api.writeFileBuffer(destPath, buffer)
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

    onProgress(60)
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

    if (maxAttachments()) {
      showOctoToast({ title: "附件数量已达上限", description: "最多添加 5 个附件" })
      return
    }

    setAttachments(prev => [...prev, {
      id: crypto.randomUUID(),
      filename,
      mime: blob.type || 'application/octet-stream',
      size: blob.size,
      status: 'done',
      // pending = staged in tmps, moved into session uploads when session is created;
      // local = already in the session uploads directory
      source: sid ? 'local' : 'pending',
      path: destPath,
    }])

    // Refresh file management panel so the new file appears in the uploaded list
    setFilesRefreshKey(k => k + 1)

    onProgress(100)
    showOctoToast({ title: "已添加附件", description: filename })
  }

  /**
   * Download a product-asset-library file (s3BaseUrl + convertHtmlUrl) into the
   * current session's uploads directory (or tmps if no session yet), with simple
   * numeric suffix for rename collisions. Returns the local destination path.
   * Does NOT add as attachment — only downloads. The chip insertion is handled
   * separately by AddonMenu via insertMention.
   */
  async function downloadProductAsset(
    file: { fileName: string; snapshot: string; s3BaseUrl: string; convertHtmlUrl: string },
    onProgress: (pct: number) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    const sid = params.id
    const projectDirValue = projectDir()
    if (!projectDirValue) throw new Error("未选择项目目录")
    const api = getDesktopApi()
    if (!api?.writeFileBuffer) throw new Error("不支持文件操作")

    // Build full URL + local filename (encode non-ASCII path segments for fetch)
    const fileUrl = encodeAssetUrl(joinUrl(file.s3BaseUrl, file.convertHtmlUrl))
    const ext = extractExtension(file.convertHtmlUrl)
    const baseName = file.fileName
    const filename = ext ? `${baseName}.${ext}` : baseName

    onProgress(0)
    const response = await fetch(fileUrl, { signal })
    if (!response.ok) throw new Error(`下载失败: ${response.status}`)
    const blob = await response.blob()
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError")
    const buffer = await blob.arrayBuffer()

    // Resolve unique path (simple suffix on collision)
    const sep = projectDirValue.includes("\\") ? "\\" : "/"
    const dir = sid
      ? [projectDirValue, ".octo", sid, "uploads"].join(sep)
      : [projectDirValue, ".octo", "tmps", "make", "uploads"].join(sep)
    const finalName = await resolveUniqueFilename(dir, filename)
    const destPath = [dir, finalName].join(sep)

    await api.writeFileBuffer(destPath, buffer)
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

    onProgress(100)
    // Refresh file management panel so the downloaded file appears in the uploaded list
    setFilesRefreshKey(k => k + 1)
    return destPath
  }

  function extractExtension(urlPath: string): string {
    const clean = urlPath.split("?")[0].split("#")[0]
    const basename = clean.split("/").pop() || ""
    const dot = basename.lastIndexOf(".")
    if (dot <= 0 || dot === basename.length - 1) return ""
    return basename.slice(dot + 1)
  }

  async function resolveUniqueFilename(dir: string, filename: string): Promise<string> {
    const api = getDesktopApi()
    if (!api?.fileExists) return filename
    const dot = filename.lastIndexOf(".")
    const base = dot > 0 ? filename.slice(0, dot) : filename
    const ext = dot > 0 ? filename.slice(dot) : ""
    const sep = dir.includes("\\") ? "\\" : "/"
    let candidate = filename
    let i = 1
    while (await api.fileExists([dir, candidate].join(sep))) {
      candidate = `${base} (${i})${ext}`
      i++
    }
    return candidate
  }

  function handlePaste(e: ClipboardEvent) {
    const files = Array.from(e.clipboardData?.items ?? [])
      .filter(item => item.kind === "file")
      .map(item => item.getAsFile())
      .filter((file): file is File => Boolean(file))
    if (files.length === 0) return
    e.preventDefault()
    handleAddFiles(files, "paste")
  }

  function retryUpload(id: string) {
    const file = filesById.get(id)
    const att = attachments().find(a => a.id === id)
    if (!file || !att) return
    
    setAttachments(prev => prev.map(a => 
      a.id === id ? { ...a, status: 'uploading' as const, error: undefined } : a
    ))
    
    uploadFile(file)
      .then(result => {
        setAttachments(prev => prev.map(a => 
          a.id === id ? { ...a, status: 'done' as const, url: result.url } : a
        ))
      })
      .catch(err => {
        const message = err instanceof UploadError ? err.message : '上传失败'
        setAttachments(prev => prev.map(a =>
          a.id === id ? { ...a, status: 'error' as const, error: message, retriable: true } : a
        ))
      })
  }

  function removeAttachment(id: string) {
    const att = attachments().find(a => a.id === id)
    if (att?.previewUrl) URL.revokeObjectURL(att.previewUrl)
    filesById.delete(id)
    setAttachments(prev => prev.filter(a => a.id !== id))
  }

  function removeAttachmentsByPath(paths: string[]) {
    const normalizedPaths = new Set(paths.map(p => p.replace(/\\/g, "/")))
    setAttachments(prev => prev.filter(a => {
      if (!a.path) return true
      return !normalizedPaths.has(a.path.replace(/\\/g, "/"))
    }))
  }

  function renameAttachmentPath(oldPath: string, newPath: string, newFilename: string) {
    const normalizedOld = oldPath.replace(/\\/g, "/")
    setAttachments(prev => prev.map(a => {
      if (!a.path || a.path.replace(/\\/g, "/") !== normalizedOld) return a
      return { ...a, path: newPath, filename: newFilename }
    }))
  }

  function handleSpecSelect() {
    dialogPop.show(async () => {
      const api = getDesktopApi()
      if (!api?.getAssetsConfig) return
      
      try {
        const info = await api.getAssetsConfig() as AssetsConfig
        
        // 设置显示值和技能名称
        const designSpec = info?.user?.designSpec
        const placeholder = info?.user?.placeholder
        if (designSpec) setSelectedSpecName(designSpec)
        if (placeholder) setSelectedSpecDisplay(placeholder)
        
        // 保存 sessionJson 到临时文件
        const sessionJson = info?.user?.sessionJson
        const projectDirValue = projectDir()
        if (sessionJson && projectDirValue && api?.writeFileBuffer) {
          const sep = projectDirValue.includes("\\") ? "\\" : "/"
          const configPath = [projectDirValue, ".octo", "tmps", "make", "resource", "assets_config.json"].join(sep)
          const encoder = new TextEncoder()
          const buffer = encoder.encode(sessionJson).buffer as ArrayBuffer
          await api.writeFileBuffer(configPath, buffer)
        }
      } catch (err) {
        console.error("[handleSpecSelect] Failed:", err)
      }
    })
  }

  async function movePendingUploadsToSession(sessionId: string) {
    const projectDirValue = projectDir()
    if (!projectDirValue) return
    
    const api = getDesktopApi()
    if (!api?.readFileBuffer || !api?.writeFileBuffer) return
    
    const pendingAttachments = attachments().filter(a => a.source === 'pending' && a.path)
    
    for (const att of pendingAttachments) {
      try {
        const sep = projectDirValue.includes("\\") ? "\\" : "/"
        
        const tempPath = att.path!
        const buffer = await api.readFileBuffer(tempPath)
        if (!buffer) continue
        
        const finalPath = [projectDirValue, ".octo", sessionId, "uploads", att.filename].join(sep)
        await api.writeFileBuffer(finalPath, buffer)
        
        setAttachments(prev => prev.map(a => 
          a.id === att.id ? { ...a, path: finalPath, source: 'local' as const } : a
        ))
      } catch (err) {
        console.error(`[movePendingUploadsToSession] Failed to move ${att.filename}:`, err)
      }
    }
  }

  async function moveAssetsConfigToSession(sessionId: string) {
    const projectDirValue = projectDir()
    if (!projectDirValue) return
    
    const api = getDesktopApi()
    if (!api?.readFileBuffer || !api?.writeFileBuffer) return
    
    const sep = projectDirValue.includes("\\") ? "\\" : "/"
    const tempPath = [projectDirValue, ".octo", "tmps", "make", "resource", "assets_config.json"].join(sep)
    
    try {
      const buffer = await api.readFileBuffer(tempPath)
      if (!buffer) return
      
      const finalPath = [projectDirValue, ".octo", sessionId, "resource", "assets_config.json"].join(sep)
      await api.writeFileBuffer(finalPath, buffer)
    } catch (err) {
      console.error("[moveAssetsConfigToSession] Failed to move assets_config.json:", err)
    }
  }

  function handleFileInputChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement
    if (input.files?.length) {
      handleAddFiles(Array.from(input.files), "picker")
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
    if (files.length > 0) handleAddFiles(files, "drop")
  }

  /** 打开结果到 ResultViewer（优先恢复 localStorage 编辑版本） */
  async function handleOpenResult(card: OutputCard) {
    // 不支持预览的 file 类型:弹窗提示 + 提供下载入口,不打开 result-viewer tab。
    // 必须在 setResultViewMode/ml.showRight 之前拦截,否则会切到 tabs 模式显示空 ResultViewer。
    // link 类型的磁盘路径会经 inferOutputType 推断,只有真正无法预览的扩展名才会落到 'file'。
    if (card.type === "file") {
      dialog.show(() => (
        <DialogPreviewUnavailable
          filename={card.title}
          filePath={card.filePath}
          sdkUrl={sdk.url}
          sdkDirectory={sdk.directory || ""}
        />
      ))
      tracker.interaction({ module: "design", name: "preview-unavailable", extend: JSON.stringify({ title: card.title }) })
      return
    }

    setResultViewMode("tabs")
    ml.showRight()

    // link 类型:content 是 URL 或磁盘路径,不保存,直接打开
    // URL:        创建 html tab,filePath=URL(复用 preview URL 工作流,ActionBar 行为一致)
    // 磁盘路径:   转绝对路径,按扩展名推断 type(复用本地文件渲染逻辑)
    if (card.type === "link") {
      const linkContent = (card.content ?? "").trim()
      if (!linkContent) return

      if (/^https?:\/\//i.test(linkContent)) {
        const tabId = `link-url-${linkContent.replace(/[/\\:?#&=]/g, "-")}`
        tabStore.openTab({
          id: tabId,
          title: card.title,
          type: "html",
          subtype: "url",
          content: "",
          filePath: linkContent,
          artifactIdentifier: card.artifactIdentifier,
          createdAt: card.createdAt,
        })
        tracker.interaction({ module: "design", name: "preview-link", extend: JSON.stringify({ type: "url" }) })
        return
      }

      // 磁盘路径:转绝对路径
      const normalizedPath = linkContent.replace(/\\/g, "/")
      const isAbsolute = /^([A-Za-z]:[/\\]|\/)/.test(linkContent)
      let absolutePath: string
      if (isAbsolute) {
        absolutePath = normalizedPath
      } else {
        const dir = projectDir()
        if (!dir) return
        const normalizedDir = dir.replace(/\\/g, "/")
        absolutePath = normalizedDir
        if (!absolutePath.endsWith("/") && !normalizedPath.startsWith("/")) {
          absolutePath += "/"
        }
        absolutePath += normalizedPath
      }
      absolutePath = absolutePath.replace(/\/+/g, "/")

      const tabId = `link-file-${absolutePath.replace(/[/\\:]/g, "-")}`
      const inferredType = inferOutputType(absolutePath)
      tabStore.openTab({
        id: tabId,
        title: card.title,
        type: inferredType,
        subtype: card.subtype,
        content: "",
        filePath: absolutePath,
        artifactIdentifier: card.artifactIdentifier,
        createdAt: card.createdAt,
      })
      tracker.interaction({ module: "design", name: "preview-link", extend: JSON.stringify({ type: "local", ext: absolutePath.split(".").pop() }) })
      return
    }

    // URL 类型：跳过文件推断和加载
    const isUrl = card.filePath?.match(/^https?:\/\//i)

    // 标记：内容是否从文件加载（用于跳过不必要的持久化）
    let contentLoadedFromFile = false
    
    // ★ Step -1: 如果 card.filePath 不存在（artifact 标签来源），尝试推断 filePath
    if (!isUrl && !card.filePath && projectDir() && params.id) {
      const saveable = ["html", "deck", "svg", "markdown-document", "markdown", "code-snippet"]
      if (saveable.includes(card.type)) {
        const inferred = await inferArtifactFilePath(card.title, card.type, params.id!, projectDir()!)
        if (inferred.filePath) {
          card.filePath = inferred.filePath
          console.log("[MakePage] Inferred filePath for artifact:", inferred.filePath, "exists:", inferred.exists)
          
          // 如果文件不存在，先 autoSave 创建文件
          if (!inferred.exists) {
            await autoSaveArtifact(params.id!, card, projectDir()!)
            console.log("[MakePage] Created new file for artifact:", inferred.filePath)
          }
        }
      }
    }
    
    // ★ Step 0: 如果已有匹配的 tab，直接激活（但先检查文件内容是否变化，变化则记录 agent 版本）
    if (card.filePath) {
      const existingTab = tabStore.tabs().find(t => {
        if (t.type === "html" && isUrl) return t.filePath === card.filePath
        if (t.type === "html" || t.type === "svg") return t.filePath === card.filePath
        if (["image", "video", "audio", "pdf", "text"].includes(t.type)) return t.filePath === card.filePath
        return false
      })
      if (existingTab) {
        if (!isUrl && existingTab.type !== "design-plan") {
          const api = getDesktopApi()
          const buf = await api?.readFileBuffer?.(existingTab.filePath!)
          if (buf) {
            const fileContent = new TextDecoder().decode(buf)
            if (fileContent && fileContent !== existingTab.content) {
              tabStore.updateTabContent(existingTab.id, fileContent)
              await historyController.onTabOpen({ ...existingTab, content: fileContent }, existingTab)
            }
          }
        }
        tabStore.activate(existingTab.id)
        return
      }
    }
    
    // ★ Step 1: 从文件加载内容（编辑已保存到文件）
    if (card.filePath && !isUrl) {
      const skipContentLoad = ["image", "video", "audio", "pdf", "svg"].includes(card.type)
      if (!skipContentLoad) {
        try {
          const response = await fetch(`${sdk.url}/file/content?path=${encodeURIComponent(card.filePath)}`, {
            headers: { ...directoryHeader(sdk.directory || "") },
          })
          if (response.ok) {
            const data = await response.json()
            if (data.content && typeof data.content === "string") {
              card = { ...card, content: data.content }
              contentLoadedFromFile = true
              console.log("[MakePage] Loaded from file:", card.filePath)
            }
          }
        } catch (err) {
          console.error("[MakePage] Failed to load file content:", err)
        }
      }
    }
    
    const existingBefore = tabStore.tabs().find((t) => t.id === card.id)
    tabStore.openTab(card)
    if (card.artifactIdentifier?.endsWith("-composed")) {
      tabStore.activate(card.id)
    }
    const tab = tabStore.tabs().find((t) => t.id === card.id)

    if (tab) {
      const isDesignPlan = tab.type === "design-plan"
      const shouldPersist = !["image", "video", "audio", "pdf", "text"].includes(tab.type)
      // 跳过从文件加载的内容（已存在于文件中，无需重复持久化）
      if (shouldPersist && !isUrl && tab.content && !contentLoadedFromFile) {
        await persistTabChanges(tab, {
          sessionId: params.id!,
          projectDir: projectDir(),
          sdkUrl: sdk.url,
          sdkDirectory: sdk.directory || "",
          snapshotStore: snapshotStore,
          refreshSnapshots: refreshSnapshots,
          skipSnapshot: !isDesignPlan,
        })
      }
      if (!isDesignPlan) {
        await historyController.onTabOpen(tab, existingBefore)
      }
    }
  }

  function inferOutputType(filePath: string): OutputCardType {
    const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
    if (ext === 'html' || ext === 'htm') return 'html'
    if (ext === 'svg') return 'svg'
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico'].includes(ext)) return 'image'
    if (ext === 'pdf') return 'pdf'
    if (['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext)) return 'video'
    if (['mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(ext)) return 'audio'
    if (ext === 'md' || ext === 'markdown') return 'markdown'
    if (ext === 'json') return 'json'
    if (['ts', 'tsx', 'js', 'jsx', 'css', 'scss', 'less', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'h'].includes(ext)) return 'code-snippet'
    return 'text'
  }

  function handleOpenLocalFile(filePath: string) {
    const dir = projectDir()

    // URL 处理
    if (/^https?:\/\//i.test(filePath)) {
      const tabId = `local-file-${filePath.replace(/[/\\:?#&=]/g, '-')}`
      let title: string
      try {
        const url = new URL(filePath)
        const pathSegments = url.pathname.split('/').filter(Boolean)
        title = pathSegments.length > 0 ? `${url.host}/${pathSegments[pathSegments.length - 1]}` : url.host
      } catch {
        title = filePath
      }

      handleOpenResult({
        id: tabId,
        title,
        type: 'html',
        subtype: 'url',
        content: '',
        filePath,
        createdAt: new Date(),
      })
      tracker.interaction({ module: "design", name: "preview-local-file", extend: JSON.stringify({ type: "url" }) })
      return
    }

    // 本地文件处理
    const normalizedPath = filePath.replace(/\\/g, '/')
    const isAbsolute = /^([A-Za-z]:[/\\]|\/)/.test(filePath)

    let absolutePath: string
    if (isAbsolute) {
      absolutePath = normalizedPath
    } else {
      if (!dir) return
      const normalizedDir = dir.replace(/\\/g, '/')
      absolutePath = normalizedDir
      if (!absolutePath.endsWith('/') && !normalizedPath.startsWith('/')) {
        absolutePath += '/'
      }
      absolutePath += normalizedPath
    }
    absolutePath = absolutePath.replace(/\/+/g, '/')

    const tabId = `local-file-${absolutePath.replace(/[/\\:]/g, '-')}`
    const type = inferOutputType(filePath)
    const title = filePath.split(/[/\\]/).pop() ?? filePath
    
    handleOpenResult({
      id: tabId,
      title,
      type,
      subtype: extractSubtypeFromFilename(title),
      content: '',
      filePath: absolutePath,
      createdAt: new Date(),
    })
    tracker.interaction({ module: "design", name: "preview-local-file", extend: JSON.stringify({ type: "local", ext: filePath.split('.').pop() }) })
  }

  /** Continue generation (append truncated content as prompt) */
  function handleContinue(card: OutputCard) {
    tracker.interaction({ module: "design", name: "continue-generation" })
    const sid = params.id
    if (!sid) return
    const lastChars = card.content.slice(-300)
    setPrompt(`请继续完成上一个设计。上次的输出在以下位置被截断：\n\`\`\`\n${lastChars}\n\`\`\`\n\n请从截断点继续，输出完整 HTML。`)
    void handleSubmit()
  }

  const questionRequest = createMemo<QuestionRequest | undefined>(() => {
    if (!params.id) return
    return sessionQuestionRequest(sync.data.session, sync.data.question, params.id)
  })

  const permissionRequest = createMemo<PermissionRequest | undefined>(() => {
    return sessionPermissionRequest(sync.data.session, sync.data.permission, params.id, (item) => {
      return !permission.autoResponds(item, sdk.directory)
    })
  })

  const [permissionResponding, setPermissionResponding] = createSignal(false)

  const decidePermission = (response: "once" | "always" | "reject") => {
    const perm = permissionRequest()
    if (!perm || permissionResponding()) return
    setPermissionResponding(true)
    sdk.client.permission
      .respond({ sessionID: perm.sessionID, permissionID: perm.id, response })
      .catch((err: unknown) => {
        const description = err instanceof Error ? err.message : String(err)
        console.error("[MakePage] permission respond failed:", description)
      })
      .finally(() => {
        setPermissionResponding(false)
      })
  }

  const inputDisabled = () => !activeModelKey() || !!questionRequest() || !!permissionRequest()

  return (
    <DataProvider data={sync.data} directory={sdk.directory || ""}>
      <div
        class="octo-make octo-split bg-background-base"
        data-focus={hideChat() ? "true" : undefined}
        ref={(el) => { gridEl = el }}
        style={{ display: "flex", position: "relative" }}
      >

        {/* ── 左栏：对话面板 ──── */}
        <Show when={!hideChat()}>
          <div
            classList={{ "flex": true, "flex-col": true, "overflow-hidden": true, "make-chat-folded": ml.rightCollapsed() || ml.rightManuallyHidden() }}
            style={{
              background: isDragOver() ? "var(--octo-brand-a3)" : "#fff",
              outline: isDragOver() ? "inset 0 0 0 2px var(--octo-brand-a25)" : "none",
              flex: (gridHasContent() && !ml.rightCollapsed() && !ml.rightManuallyHidden()) ? `${ml.cRatio()} 1 0%` : "1 1 0%",
              "min-width": `${MAKE_CENTER_MIN}px`,
            }}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {/* 标题栏 */}
            <Show when={hasSessionView()}>
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
                  style={{ padding: "12px", height: "56px", background: "#fff", "border-bottom": "1px solid rgba(0,0,0,0.1)" }}
                >
                <div class="flex items-center gap-2 min-w-0 flex-1 pr-3">
                  <Show when={ml.leftCollapsed()}>
                    <button
                      type="button"
                      data-drawer-toggle="make-left"
                      class="make-icon-btn"
                      style={{ display: "flex", "align-items": "center", "justify-content": "center", width: "24px", height: "24px", cursor: "pointer", background: "none", border: "none", padding: "0", "border-radius": "4px", flex: "none" }}
                      onClick={ml.toggleLeftDrawer}
                      title="对话列表"
                    >
                      <IconNotepad size={16} />
                    </button>
                  </Show>
                  <Show when={effectiveBusy()}>
                    <div class="shrink-0 flex items-center gap-1.5">
                      <Spinner class="size-4" style={{ color: "#0a59f7" }} />
                    </div>
                  </Show>
                  <Show
                    when={!titleState.editing}
                    fallback={
                      <InlineInput
                        ref={(el) => { titleRef = el }}
                        value={titleState.draft}
                        class="text-14-medium text-text-strong grow-1 min-w-0 rounded-[6px] pl-1 -ml-1"
                        style={{ "font-weight": "600" }}
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
                      {sessionTitle(overrideTitle() ?? info()?.title ?? sessionInfoMirror()?.title) ?? "Octo Design"}
                    </h1>
                  </Show>
                  <Show when={!titleState.editing && params.id}>
                    <Tooltip
                      placement="top"
                      gutter={8}
                      contentClass="make-token-tooltip"
                      value={
                        <span>
                          当前session已使用： {(contextMetrics()?.total ?? 0).toLocaleString(language.intl())} /{" "}
                          {contextLimit() ? contextLimit().toLocaleString(language.intl()) : "--"} 个token
                        </span>
                      }
                    >
                      <div
                        class="shrink-0 flex items-center justify-center"
                        style={{
                          "--border-active": "var(--octo-brand)",
                          "--border-weak-base": "rgba(0,0,0,0.1)",
                        }}
                        aria-label={`Token ${contextUsage()}%`}
                      >
                        <ProgressCircle size={16} strokeWidth={2} percentage={contextUsage()} />
                      </div>
                    </Tooltip>
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
                    class="make-icon-btn flex items-center justify-center size-4"
                    aria-label={language.t("common.moreOptions")}
                  >
                    <Icon name="ellipsis" class="size-4" />
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
                <button
                  type="button"
                  data-drawer-toggle="make-right"
                  class="make-icon-btn"
                  style={{ display: "flex", "align-items": "center", "justify-content": "center", width: "24px", height: "24px", cursor: "pointer", background: "none", border: "none", padding: "0", "border-radius": "4px", flex: "none", "margin-left": "4px" }}
                  onClick={ml.toggleRight}
                  title="文件管理"
                >
                  <IconNotepad size={16} />
                </button>
              </div>
              </div>
            </Show>
              <Show when={hasSessionView()} fallback={
                <Show when={sessionMessagesLoaded()} fallback={
                <div class="size-full flex items-center justify-center">
                  <div class="octo-spinner" />
                </div>
              }>
                <div class="flex-1 flex flex-col items-center justify-center min-h-0 px-6 py-6">
                  <div class="w-full">
                    <NewSessionView worktree="" title="Octo Design" subtitle="描述需求，开始生成原型" />
                  </div>
                <div class="w-full max-w-[800px]">
                  {/* Pending skill tag */}
                    <Show when={pendingSkill()}>
                      {(skill) => (
                        <div class="flex items-center gap-2 px-4 pt-3">
                          <div class="flex items-center gap-1 px-2 py-1 bg-[#f1f1f1] rounded-full text-xs text-black/60">
                            <span>{skill().name}</span>
                            <button
                              type="button"
                              onClick={removePendingSkill}
                              class="hover:text-black/80"
                            >
                              ×
                            </button>
                          </div>
                        </div>
                      )}
                    </Show>

                    {/* Pattern 等待用户输入 / 匹配中 - empty state */}
                    <Show when={activePatternSessionId() && !patternEnded() && !patternMatches()}>
                      <div class="pt-3">
                        <div class="w-full rounded-[12px] flex items-center gap-2 px-4 py-3" style={{ background: "rgba(74,81,255,0.06)", border: "1px solid rgba(74,81,255,0.15)" }}>
                          <Show when={patternUserInput()} fallback={<span style={{ "font-size": "13px", color: "var(--octo-text-secondary)" }}>PatternPage 模式 · 请输入页面需求后提交</span>}>
                            <span class="i-svg-spinners-clock size-4 shrink-0" />
                            <span style={{ "font-size": "13px", color: "var(--octo-text-secondary)" }}>{patternSubEnriching() ? "正在加载预览..." : "Pattern 正在匹配..."}</span>
                          </Show>
                          <button onClick={handleEndPatternPage} class="shrink-0 ml-auto transition-colors cursor-pointer" style={{ "font-size": "14px", color: "#0a59f7", background: "transparent", border: "none" }}>{patternUserInput() ? "取消" : "退出"}</button>
                        </div>
                      </div>
                    </Show>

                    {/* IntentConfirmCard (prototype 弹窗) — 跨 match + module 两阶段 - empty state */}
                    <Show when={patternMatches() && !patternEnded()}>
                      <div class="ic-card-overlay">
                        <IntentConfirmCard
                          sessionId={params.id ?? ""}
                          result={patternMatches()!}
                          blockMatches={patternBlockMatches()}
                          blockMatching={patternBlockMatching()}
                          blockMatchError={patternBlockMatchError()}
                          initialStep={patternSubPhase() === "module" ? "blocks" : "patterns"}
                          onMatchPattern={handleMatchPattern}
                          onConfirm={handleConfirmPatternPage}
                        />
                      </div>
                    </Show>

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
                      "min-height": "150px",
                    }}
                  >
                    <Show when={planComposerActive()}>
                      <div class="make-plan-capsule-row">
                        <button type="button" class="make-plan-capsule" onClick={handleCancelPlanComposer}>
                          <span class="make-plan-capsule-icon">✦</span>
                          <span>设计策略模式</span>
                          <span class="make-plan-capsule-close">×</span>
                        </button>
                      </div>
                    </Show>
                    <Show when={patternPageCapsuleActive()}>
                      <div class="make-plan-capsule-row">
                        <button type="button" class="make-plan-capsule" onClick={handleCancelPatternPageComposer}>
                          <span class="make-plan-capsule-icon">✦</span>
                          <span>PatternPage 模式</span>
                          <span class="make-plan-capsule-close">×</span>
                        </button>
                      </div>
                    </Show>
                    {/* Slash Command Popover（新建对话） */}
                    <Show when={slashState() && filteredSlash().length > 0}>
                      <div class="slash-popover">
                        <div class="slash-popover-head">
                          <span class="slash-popover-title">命令</span>
                          <span class="slash-popover-hint">Esc 关闭</span>
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

                    <AttachmentBar
                      attachments={attachments()}
                      onRemove={removeAttachment}
                      onRetry={retryUpload}
                    />

                    <div class="flex-1 min-h-0 overflow-hidden rounded-[inherit]">
<ProseMirrorEditor
                        sessionId={params.id ?? ""}
                        skillConfig={skillConfig() ?? {}}
                        artifactFiles={artifactFilesMirror()}
                        mentionSelections={mentionSelections()}
                        setMentionSelections={setMentionSelections}
                        disabled={inputDisabled()}
                        busy={effectiveBusy()}
                        autofocus
                        onTriggerMention={loadSkillConfig}
                        onContentChange={setPrompt}
                        onSubmit={() => void handleSubmit()}
                        onPaste={handlePaste}
                        onSlashTrigger={(query) => {
                          setSlashState({ query, cursor: 0 })
                          setSlashIndex(0)
                        }}
                        onSlashClose={() => setSlashState(null)}
                       onPreview={(url) => {
                         handleOpenLocalFile(url)
                         proseMirrorRef1?.clear()
                         proseMirrorRef2?.clear()
                       }}
                       ref={(el) => { proseMirrorRef1 = el }}
                     />
                    </div>
                    <div class="flex items-center justify-between px-4 pb-4 relative z-10 overflow-hidden">
                      <div class="flex items-center gap-1 min-w-0">
                        <span class="hidden">
                          <DesignSystemPicker
                            selected={selectedDesignSystem()}
                            onSelect={setSelectedDesignSystem}
                          />
                        </span>
                        <span class="hidden">
                          <TemplatePicker
                            onSelect={(content) => setPrompt((prev) => prev ? prev + "\n\n" + content : content)}
                          />
                        </span>
                        <input
                          ref={fileInputRef!}
                          type="file"
                          multiple
                          class="hidden"
                          accept="*/*"
                          onChange={handleFileInputChange}
                        />
                        <AddonMenu
                          skillConfig={skillConfig() ?? {}}
                          artifactFiles={artifactFilesMirror()}
                          selections={mentionSelections()}
                          onSelect={handleAddonSelect}
                          onDeselect={handleAddonDeselect}
                          onAddAttachment={() => { if (!maxAttachments()) fileInputRef.click() }}
                          onAddAttachmentFromUrl={downloadUrlToSession}
                          onDownloadProductAsset={downloadProductAsset}
                          onUpdateMentionPath={handleAddonUpdateMentionPath}
                          productId={projectSelection()?.product?.id}
                          onEnterDesignStrategy={handleOpenPlanConfirm}
                          planActive={params.id ? activePlanSessionId() !== null : planComposerActive()}
                          onEnterPatternPage={handleOpenPatternPageConfirm}
                          patternPageActive={activePatternSessionId() !== null || patternBlockMatching()}
                          onOpen={loadSkillConfig}
                          disabled={maxAttachments()}
                        />
<ModelSelectorPopover
                           model={local.model}
                           triggerAs="button"
                           triggerProps={{
                              class: "flex items-center gap-1.5 min-w-0 bg-[#f3f3f3] hover:bg-[#e8e8e8] active:bg-[#dedede] transition-colors px-3 py-1.5 rounded-full text-[13px] text-gray-800 font-medium group overflow-hidden focus-visible:outline-none",
                              "data-action": "prompt-model",
                            }}
                           onClose={(cause) => {
                             if (cause === "select") {
                               const m = currentModel()
                               if (m) {
                                 tracker.interaction({ module: "design", name: "select-model", extend: JSON.stringify({ modelId: m.id, provider: m.provider.id }) })
                               }
                             }
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
                         icon={effectiveBusy() ? "stop" : "arrow-up"}
                         class="size-8 flex-shrink-0"
                         onClick={effectiveBusy() ? () => void halt() : () => void handleSubmit()}
                         disabled={!effectiveBusy() && (!prompt().trim() || inputDisabled())}
                         aria-label={effectiveBusy() ? "停止生成" : undefined}
/>
                    </div>
                   </div>
                 </div>
               </div>
             </Show>
           }>
              {/* 消息列表：消息按主 session 与所有子 session 的创建时间统一排序 */}
              <div class="relative flex-1 min-h-0">
              <ScrollView
                class="h-full"
                style={{ background: "#fff", padding: "0 12px 16px 12px", }}
                viewportRef={autoScroll.scrollRef}
                onScroll={autoScroll.handleScroll}
                onMouseUp={autoScroll.handleInteraction}
              >
                <div ref={autoScroll.contentRef} class="make-chat-content pt-4 flex flex-col gap-4">
                    <Show when={resultViewMode() === "plan" && activePlanSessionId()}>
                      <div
                        class="flex items-center justify-between mx-3"
                        style={{
                          height: "48px",
                          padding: "0 16px",
                          "border-radius": "12px",
                          border: "1px solid rgba(0,0,0,0.1)",
                          "border-style": "solid",
                          "border-color": "rgba(0,0,0,0.1)",
                          background: "linear-gradient(90deg, rgb(245, 248, 255), rgb(255, 255, 255) 50%)",
                        }}
                      >
                        <div class="flex items-center gap-[8px]">
                          <svg width="24" height="24" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class="shrink-0">
                            <path d="M3.66642 1.23337C3.63087 1.1667 3.59531 1.12892 3.55976 1.12003C3.5242 1.11114 3.48865 1.12003 3.45309 1.1467C3.42198 1.17337 3.40198 1.20225 3.39309 1.23337C3.27309 1.85114 2.9842 2.3867 2.52642 2.84003C2.06865 3.29337 1.5242 3.58892 0.89309 3.7267C0.85309 3.74003 0.824201 3.7667 0.806423 3.8067C0.79309 3.85114 0.795312 3.89114 0.81309 3.9267C0.835312 3.9667 0.861979 3.9867 0.89309 3.9867C1.5242 4.11114 2.06865 4.40448 2.52642 4.8667C2.9842 5.32448 3.27309 5.86226 3.39309 6.48003C3.41531 6.53337 3.44642 6.56892 3.48642 6.5867C3.53087 6.60003 3.56865 6.59559 3.59976 6.57337C3.63087 6.55559 3.65309 6.52448 3.66642 6.48003C3.8042 5.84892 4.09753 5.3067 4.54642 4.85337C4.99087 4.40003 5.52865 4.11114 6.15976 3.9867C6.2042 3.97337 6.23531 3.94892 6.25309 3.91337C6.27531 3.87337 6.27531 3.83559 6.25309 3.80003C6.23531 3.76448 6.2042 3.74003 6.15976 3.7267C5.54198 3.58892 5.00642 3.29337 4.55309 2.84003C4.09976 2.3867 3.8042 1.85114 3.66642 1.23337Z" fill="rgb(10,89,247)" />
                            <path d="M13.6664 9.55337C13.6531 9.50892 13.6353 9.48448 13.6131 9.48003C13.5953 9.47559 13.5775 9.48003 13.5598 9.49337C13.542 9.51114 13.5286 9.53114 13.5198 9.55337C13.4442 9.91337 13.2753 10.2245 13.0131 10.4867C12.7553 10.7489 12.4398 10.9223 12.0664 11.0067C12.0309 11.02 12.0109 11.0356 12.0064 11.0534C12.002 11.0756 12.0042 11.0978 12.0131 11.12C12.0264 11.1423 12.0442 11.1534 12.0664 11.1534C12.4264 11.2378 12.7398 11.4111 13.0064 11.6734C13.2731 11.9356 13.4442 12.2423 13.5198 12.5934C13.5286 12.6245 13.5442 12.6445 13.5664 12.6534C13.5886 12.6667 13.6109 12.6667 13.6331 12.6534C13.6553 12.6445 13.6664 12.6245 13.6664 12.5934C13.7509 12.2289 13.9242 11.9156 14.1864 11.6534C14.4442 11.3956 14.7553 11.2289 15.1198 11.1534C15.1509 11.1534 15.1731 11.14 15.1864 11.1134C15.1953 11.0867 15.1953 11.0623 15.1864 11.04C15.1731 11.0178 15.1509 11.0067 15.1198 11.0067C14.7553 10.9311 14.4442 10.76 14.1864 10.4934C13.9242 10.2267 13.7509 9.91337 13.6664 9.55337Z" fill="rgb(10,89,247)" />
                            <path d="M10.3864 12.5734C10.3731 12.5334 10.3531 12.5156 10.3264 12.52C10.2998 12.5245 10.282 12.5423 10.2731 12.5734C10.2286 12.8311 10.1131 13.0534 9.92642 13.24C9.73976 13.4267 9.51309 13.5467 9.24642 13.6C9.21531 13.6089 9.20198 13.6267 9.20642 13.6534C9.21087 13.68 9.2242 13.6934 9.24642 13.6934C9.5042 13.7467 9.72864 13.8711 9.91976 14.0667C10.1109 14.2578 10.2286 14.4756 10.2731 14.72C10.282 14.7645 10.2998 14.7823 10.3264 14.7734C10.3531 14.7689 10.3731 14.7511 10.3864 14.72C10.4398 14.4623 10.5598 14.24 10.7464 14.0534C10.9331 13.8667 11.1531 13.7467 11.4064 13.6934C11.4375 13.6934 11.4531 13.68 11.4531 13.6534C11.4531 13.6267 11.4375 13.6089 11.4064 13.6C11.1531 13.5467 10.9331 13.4267 10.7464 13.24C10.5598 13.0534 10.4398 12.8311 10.3864 12.5734Z" fill="rgb(10,89,247)" />
                            <path d="M12.4934 2.44669C12.1956 2.14003 11.8334 1.98669 11.4067 1.98669C10.9801 1.98669 10.6134 2.14003 10.3067 2.44669L2.92673 9.84003C2.82007 9.92447 2.72896 10.0578 2.6534 10.24L1.76007 12.48C1.63118 12.8 1.6334 13.1111 1.76673 13.4134C1.90007 13.72 2.11562 13.94 2.4134 14.0734C2.71562 14.2067 3.02673 14.2089 3.34673 14.08L5.58673 13.1667C5.75562 13.0911 5.8934 13.0067 6.00007 12.9134L13.3734 5.52003C13.5778 5.31558 13.7156 5.08003 13.7867 4.81336C13.8531 4.54669 13.8531 4.28447 13.7867 4.02669C13.7156 3.76447 13.5778 3.53114 13.3734 3.32669L12.4934 2.44669ZM11.0401 3.18669C11.1467 3.08003 11.269 3.02669 11.4067 3.02669C11.5445 3.02669 11.6623 3.08003 11.7601 3.18669L12.6401 4.06669C12.7467 4.16003 12.8001 4.28003 12.8001 4.42669C12.8001 4.56892 12.7467 4.68892 12.6401 4.78669L11.4534 5.92003L9.88673 4.33336L11.0401 3.18669Z" fill="rgb(10,89,247)" />
                          </svg>
                          <span style={{ "font-size": "14px", "line-height": "22px", color: "rgba(0,0,0,0.9)" }}>进入设计策略模式</span>
                        </div>
                        <button type="button" onClick={handleEndPlan} class="shrink-0 transition-colors cursor-pointer" style={{ "font-size": "14px", "line-height": "22px", color: "#0a59f7", background: "transparent", border: "none" }}>
                          退出
                        </button>
                      </div>
                    </Show>
                    <Show when={userMessages().length > 0}>
                      <InsightTurn
                        sessionID={userMessages()[0].sessionID || params.id!}
                        messageID={userMessages()[0].id}
                        status={sync.data.session_status[userMessages()[0].sessionID] ?? sessionStatus()}
                        active={sync.data.session_status[userMessages()[0].sessionID ?? params.id!]?.type === "busy"}
                        elapsedText={elapsedText()}
                        blockTime={blockTime()}
                        onAbort={halt}
                        onOpenResult={handleOpenResult}
                        onOpenLocalFile={handleOpenLocalFile}
                        projectDir={projectDir()}
                        onContinue={handleContinue}
                        onChildSession={ensureChildSession}
                        deltaLog={deltaLog()}
                        onFormSubmit={(text) => setPrompt(text)}
                        hasQuestionRequest={!!questionRequest()}
                        onFilesRefresh={() => {
                          setFilesRefreshKey(k => k + 1)
                          void historyController.onFileRefresh(tabStore.tabs())
                        }}
                        skillToolCalls={skillToolCalls()}
                        skillConfig={skillConfig()}
                      />
                    </Show>
                    <For each={userMessages().slice(1)}>
                      {(msg) => {
                        const messageSessionID = msg.sessionID || params.id!
                        return (
                          <InsightTurn
                            sessionID={messageSessionID}
                            messageID={msg.id}
                            status={sync.data.session_status[messageSessionID] ?? sessionStatus()}
                            active={sync.data.session_status[messageSessionID]?.type === "busy"}
                            elapsedText={elapsedText()}
                            blockTime={blockTime()}
                            onAbort={halt}
                            onOpenResult={handleOpenResult}
                            onOpenLocalFile={handleOpenLocalFile}
                            projectDir={projectDir()}
                            onContinue={handleContinue}
                            onChildSession={ensureChildSession}
                            deltaLog={deltaLog()}
                            onFormSubmit={(text) => setPrompt(text)}
                            hasQuestionRequest={!!questionRequest()}
                            onFilesRefresh={() => {
                              setFilesRefreshKey(k => k + 1)
                              void historyController.onFileRefresh(tabStore.tabs())
                            }}
                            skillToolCalls={skillToolCalls()}
                            skillConfig={skillConfig()}
                          />
                        )
                      }}
                    </For>
                </div>
              </ScrollView>
              <div
                class="absolute bottom-0 left-0 right-0 pointer-events-none z-[1]"
                style={{
                  height: "24px",
                  background: "linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,1) 100%)",
                }}
              />
              </div>

              {/* 输入区 */}
              <div class="shrink-0 relative" style={{ padding: "24px", background: "#fff" }}>

                  {/* Plan entry banner - AddonMenu 进入设计策略模式时的确认弹窗 */}
                  <Show when={showPlanConfirm() && !optimisticIntentResolved()}>
                    <PlanEntryBanner
                      onEnter={() => { setShowPlanConfirm(false); void handleEnterPlan() }}
                      onSkip={() => setShowPlanConfirm(false)}
                    />
                  </Show>

                  {/* Pattern 等待用户输入 / 匹配中 */}
                  <Show when={activePatternSessionId() && !patternEnded() && !patternMatches()}>
                    <div class="w-full rounded-[12px] flex items-center gap-2 px-4 py-3 mb-2" style={{ background: "rgba(74,81,255,0.06)", border: "1px solid rgba(74,81,255,0.15)" }}>
                      <Show when={patternUserInput()} fallback={<span style={{ "font-size": "13px", color: "var(--octo-text-secondary)" }}>PatternPage 模式 · 请输入页面需求后提交</span>}>
                        <span class="i-svg-spinners-clock size-4 shrink-0" />
                        <span style={{ "font-size": "13px", color: "var(--octo-text-secondary)" }}>{patternSubEnriching() ? "正在加载预览..." : "Pattern 正在匹配..."}</span>
                      </Show>
                      <button onClick={handleEndPatternPage} class="shrink-0 ml-auto transition-colors cursor-pointer" style={{ "font-size": "14px", color: "#0a59f7", background: "transparent", border: "none" }}>{patternUserInput() ? "取消" : "退出"}</button>
                    </div>
                  </Show>

                  {/* IntentConfirmCard (prototype 弹窗) — 跨 match + module 两阶段 */}
                  <Show when={patternMatches() && !patternEnded()}>
                    <div class="ic-card-overlay">
                      <IntentConfirmCard
                        sessionId={params.id ?? ""}
                        result={patternMatches()!}
                        blockMatches={patternBlockMatches()}
                        blockMatching={patternBlockMatching()}
                        blockMatchError={patternBlockMatchError()}
                        initialStep={patternSubPhase() === "module" ? "blocks" : "patterns"}
                        onMatchPattern={handleMatchPattern}
                        onConfirm={handleConfirmPatternPage}
                      />
                    </div>
                  </Show>

                  {/* Permission dock - 权限授权 UI */}
                  <Show when={permissionRequest()} keyed>
                    {(request) => (
                    <div class="w-full max-w-[800px] mx-auto pb-3">
                      <SessionPermissionDock
                        request={request}
                        responding={permissionResponding()}
                        onDecide={decidePermission}
                      />
                    </div>
                  )}
                </Show>

                {/* Question dock - 阻塞式提问 UI */}
                <Show when={questionRequest()} keyed>
                  {(request) => (
                    <div class="w-full pb-3">
                      <MakeQuestionDock request={request} onSubmitted={() => sync.session.sync(params.id!)} />
                    </div>
                  )}
                </Show>

                {/* Pending skill tag */}
                <Show when={pendingSkill()}>
                  {(skill) => (
                    <div class="flex items-center gap-2 px-4 pt-3">
                      <div class="flex items-center gap-1 px-2 py-1 bg-[#f1f1f1] rounded-full text-xs text-black/60">
                        <span>{skill().name}</span>
                        <button
                          type="button"
                          onClick={removePendingSkill}
                          class="hover:text-black/80"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  )}
                </Show>

                <div
                  class="make-composer rounded-[16px] transition-all duration-300 relative group"
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
                  }}
                >
                  {/* Slash Command Popover */}
                  <Show when={slashState() && filteredSlash().length > 0}>
                    <div class="slash-popover">
                      <div class="slash-popover-head">
                        <span class="slash-popover-title">命令</span>
                        <span class="slash-popover-hint">Esc 关闭</span>
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

                  <AttachmentBar
                    attachments={attachments()}
                    onRemove={removeAttachment}
                    onRetry={retryUpload}
                  />

<ProseMirrorEditor
                       sessionId={params.id ?? ""}
                       skillConfig={skillConfig() ?? {}}
                       artifactFiles={artifactFilesMirror()}
                       mentionSelections={mentionSelections()}
                       setMentionSelections={setMentionSelections}
                       disabled={inputDisabled()}
                       busy={effectiveBusy()}
                       autofocus
                       onTriggerMention={loadSkillConfig}
                      onContentChange={setPrompt}
                      onSubmit={() => void handleSubmit()}
                      onPaste={handlePaste}
 onSlashTrigger={(query) => {
                         setSlashState({ query, cursor: 0 })
                         setSlashIndex(0)
                       }}
                       onSlashClose={() => setSlashState(null)}
                      onPreview={(url) => {
                        handleOpenLocalFile(url)
                        proseMirrorRef1?.clear()
                        proseMirrorRef2?.clear()
                      }}
                      ref={(el) => { proseMirrorRef2 = el }}
                   />
                  <div class="flex items-center justify-between px-4 pb-4 relative z-10 overflow-hidden">
                      <div class="flex items-center gap-1 min-w-0">
                         <span class="hidden">
                          <DesignSystemPicker
                            selected={selectedDesignSystem()}
                            onSelect={setSelectedDesignSystem}
                          />
                        </span>
                        <span class="hidden">
                          <TemplatePicker
                            onSelect={(content) => setPrompt((prev) => prev ? prev + "\n\n" + content : content)}
                          />
                        </span>
                      <input
                        ref={fileInputRef!}
                        type="file"
                        multiple
                        class="hidden"
                        accept="*/*"
                        onChange={handleFileInputChange}
                      />
                      <AddonMenu
                        skillConfig={skillConfig() ?? {}}
                        artifactFiles={artifactFilesMirror()}
                        selections={mentionSelections()}
                        onSelect={handleAddonSelect}
                        onDeselect={handleAddonDeselect}
                        onAddAttachment={() => { if (!maxAttachments()) fileInputRef.click() }}
                        onAddAttachmentFromUrl={downloadUrlToSession}
                        onDownloadProductAsset={downloadProductAsset}
                        onUpdateMentionPath={handleAddonUpdateMentionPath}
                        productId={projectSelection()?.product?.id}
                        onEnterDesignStrategy={handleOpenPlanConfirm}
                        planActive={params.id ? activePlanSessionId() !== null : planComposerActive()}
                        onEnterPatternPage={handleOpenPatternPageConfirm}
                        patternPageActive={activePatternSessionId() !== null || patternBlockMatching()}
                        onOpen={loadSkillConfig}
                        disabled={maxAttachments()}
                      />
<ModelSelectorPopover
                         model={local.model}
                         triggerAs="button"
                         triggerProps={{
                           class: "flex items-center gap-1.5 min-w-0 bg-[#f3f3f3] hover:bg-[#e8e8e8] active:bg-[#dedede] transition-colors px-3 py-1.5 rounded-full text-[13px] text-gray-800 font-medium group overflow-hidden",
                           "data-action": "prompt-model",
                         }}
                         onClose={(cause) => {
                           if (cause === "select") {
                             const m = currentModel()
                             if (m) {
                               tracker.interaction({ module: "design", name: "select-model", extend: JSON.stringify({ modelId: m.id, provider: m.provider.id }) })
                             }
                           }
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
                       icon={effectiveBusy() ? "stop" : "arrow-up"}
                       variant="primary"
                       class="size-8 flex-shrink-0"
                       onClick={effectiveBusy() ? () => void halt() : () => void handleSubmit()}
                       disabled={!effectiveBusy() && (!prompt().trim() || inputDisabled())}
                       aria-label={effectiveBusy() ? "停止生成" : undefined}
                     />
                  </div>
                </div>
              </div>
            </Show>

        </div>
        </Show>

        {/* ── 拖拽分隔线（Grid 中间列） ──── */}
        <Show when={gridHasContent() && !hideChat() && !ml.rightCollapsed() && !ml.rightManuallyHidden()}>
          <div class="octo-split-handle" style={{ position: "absolute", left: `${ml.centerW() - 4}px`, top: "0", bottom: "0", width: "8px", margin: "0" }} onMouseDown={handleDividerMouseDown} />
        </Show>

        {/* ── 右栏：ResultViewer + Version Panel ──── */}
        <Show when={gridHasContent()}>
        <Show when={!focusMode()}>
          <div class="make-right-overlay" onClick={() => ml.toggleRightDrawer()} />
        </Show>
        <div
          class="flex flex-col overflow-hidden"
          classList={{ "make-right-panel": true, "is-collapsed": !hideChat() && (ml.rightCollapsed() || ml.rightManuallyHidden()) }}
          style={hideChat() ? { flex: "1", "min-width": "0" } : (ml.rightCollapsed() || ml.rightManuallyHidden()) ? { background: "#fff", "border-left": "1px solid var(--border-weak-base)" } : { flex: `${1 - ml.cRatio()} 1 0%`, "min-width": `${MAKE_RIGHT_MIN}px` }}
        >
          <div class="flex flex-1 min-h-0 min-w-0">
            <div class="flex flex-col flex-1 min-w-0">
              {/* 焦点模式 + 版本历史 切换按钮 */}
              <div class="flex hidden items-center justify-end px-2 shrink-0 gap-1" style={{ "min-height": "32px" }}>
                <button
                  type="button"
                  class="octo-focus-btn"
                  data-active={showVersionPanel() ? "true" : undefined}
                  onClick={() => { refreshSnapshots(); setShowVersionPanel(!showVersionPanel()) }}
                  title="版本历史"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                    <circle cx="8" cy="8" r="6" />
                    <path d="M8 5v3l2 2" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </button>
                <button
                  type="button"
                  class="octo-focus-btn"
                  data-active={focusMode() ? "true" : undefined}
                  onClick={() => layout.focusMode.toggle()}
                  title={focusMode() ? "退出焦点模式" : "焦点模式"}
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                    <Show when={focusMode()} fallback={
                      <>
                        <path d="M2 2h3.5M2 2v3.5" stroke-linecap="round" stroke-linejoin="round" />
                        <path d="M14 2h-3.5M14 2v3.5" stroke-linecap="round" stroke-linejoin="round" />
                        <path d="M2 14h3.5M2 14v-3.5" stroke-linecap="round" stroke-linejoin="round" />
                        <path d="M14 14h-3.5M14 14v-3.5" stroke-linecap="round" stroke-linejoin="round" />
                      </>
                    }>
                      <path d="M5 5h6M5 5v6M5 5L11 11" stroke-linecap="round" stroke-linejoin="round" />
                    </Show>
                  </svg>
                </button>
              </div>
              <ResultViewer
                tabs={tabStore.tabs()}
                activeId={tabStore.activeId()}
                onActivate={(id) => {
                  const tab = tabStore.tabs().find((t) => t.id === id)
                  if (tab && id !== tabStore.activeId()) {
                    tracker.interaction({ module: "design", name: "switch-tab", extend: JSON.stringify({ type: tab.type }) })
                  }
                  tabStore.activate(id)
                }}
                onClose={handleCloseTab}
                onContentChange={handleContentChange}
                sessionId={params.id}
                onOpenArtifact={handleOpenResult}
                viewMode={resultViewMode()}
                onViewModeChange={setResultViewMode}
                onAddArtifactToSession={addArtifactToSession}
                onRemoveAttachmentsByPath={removeAttachmentsByPath}
                onRenameTabByPath={tabStore.renameTabByPath}
                onRenameAttachmentPath={renameAttachmentPath}
                sdkDirectory={sdk.directory || ""}
                focusMode={focusMode()}
                onFocusModeToggle={() => layout.focusMode.toggle()}
                historyActive={showHistoryPanel()}
                historyEntries={versionList()}
                currentVersionId={currentVersionId()}
                onHistorySwitch={handleHistorySwitch}
                onModeChange={(mode) => {
                  if (mode === "edit") setShowHistoryPanel(false)
                }}
                onHistoryToggle={async () => {
                  if (!showHistoryPanel()) {
                    const tab = tabStore.tabs().find((t) => t.id === tabStore.activeId())
                    if (tab) await historyController.refreshVersions(tab)
                  }
                  setShowHistoryPanel(!showHistoryPanel())
                }}
                onCollapseDrawer={
                  !focusMode() && ml.rightCollapsed() && ml.rightDrawerOpen()
                    ? ml.toggleRightDrawer
                    : undefined
                }
                onConfirmPlan={handleConfirmPlan}
                onAdjustPlan={handleAdjustPlan}
                isPlanConfirmed={planButtonDisabled}
                filesRefreshKey={filesRefreshKey()}
                onFilesRefresh={() => {
                  setFilesRefreshKey(k => k + 1)
                  void historyController.onFileRefresh(tabStore.tabs())
                }}
                planCard={planCard()}
                planPhase={planPhase()}
                strategyFormData={strategyFormData()}
                onStrategyFieldChange={(field, value) => {
                  setManualStrategyFormData((prev) => ({ ...prev, [field]: value }))
                }}
                onGenerateStrategy={handleGenerateStrategy}
                onBackToStrategy={handleBackToStrategy}
                isGenerating={isGenerating()}
                planConfirmPending={planConfirmPending()}
                childPlanConfirmed={childPlanConfirmed()}
                childSessionStatus={sync.data.session_status[activePlanSessionId() ?? ""]}
                childBusy={childBusy()}
                planEnded={planEnded()}
                planActive={params.id ? activePlanSessionId() !== null : planComposerActive()}
              />
            </div>
            <Show when={showVersionPanel()}>
              <VersionPanel
                snapshots={snapshotList()}
                onRestore={(id) => {
                  const tab = snapshotStore.restore(id)
                  if (tab && tab.type !== "local-file") {
                    tabStore.openTab({
                      id: tab.id,
                      title: tab.title,
                      type: tab.type as OutputCardType,
                      content: tab.content,
                      filePath: tab.filePath,
                      artifactIdentifier: tab.artifactIdentifier,
                      createdAt: tab.createdAt,
                    })
                  }
                }}
                onRemove={(id) => {
                  snapshotStore.remove(id)
                  refreshSnapshots()
                }}
                onClose={() => setShowVersionPanel(false)}
              />
            </Show>
          </div>
        </div>
        </Show>
      </div>
      <OctoToast />
    </DataProvider>
  )
}
