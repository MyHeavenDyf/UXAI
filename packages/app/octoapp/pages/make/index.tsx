import "./octo-tokens.css"
import "./components/starter-cards.css"
import "./components/slash-popover.css"
import "./components/mention-popover.css"
import { FEATURED_STARTERS } from "./utils/starter-prompts"
import {
  fetchArtifactList,
  fetchArtifactContent,
  formatFileSize,
  type ArtifactFile,
  type ArtifactFileKind,
} from "./utils/artifact-file-api"
import { StarterCards } from "./components/starter-cards"
import type { Message, Session, SessionStatus } from "@opencode-ai/sdk/v2/client"
import type { FilePartInput, TextPartInput } from "@opencode-ai/sdk/v2/client"
import { Binary } from "@opencode-ai/core/util/binary"
import { DataProvider } from "@opencode-ai/ui/context/data"
import { createAutoScroll, useFilteredList } from "@opencode-ai/ui/hooks"
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
import { InsightTurn, type OutputCard, type DeltaLogEntry } from "./components/insight-turn"
import { MakeQuestionDock } from "./components/make-question-dock"
import { sessionQuestionRequest } from "@/pages/session/composer/session-request-tree"
import type { QuestionRequest } from "@opencode-ai/sdk/v2"
import { ResultViewer } from "./components/result-viewer/index"
import { createTabStore } from "./components/result-viewer/tab-store"
import { DesignSystemPicker } from "./components/design-system-picker"
import { TemplatePicker } from "./components/template-picker"
import IconHost from "@/pages/_shell/icons/IconHost.svg"
import { Spinner } from "@opencode-ai/ui/spinner"
import { Icon } from "@opencode-ai/ui/icon"
import { loadDesignSystem } from "./utils/design-system-loader"
import { loadCrafts } from "./utils/craft-loader"
import { createSnapshotStore } from "./utils/snapshot-store"
import { VersionPanel } from "./components/result-viewer/version-panel"
import { ModelSelectorPopover } from "@/components/dialog-select-model"
import { ANNOTATION_EVENT, type AnnotationEventDetail } from "./components/result-viewer/draw-overlay"
import { autoSaveArtifact } from "./utils/artifact-auto-save"
import { persistTabChanges } from "./utils/tab-persistence"
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
      await sdk.client.session.delete({ sessionID })
      navigate("/make")
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
    return !id || sync.data.message[id] !== undefined
  })

  createEffect(
    on(
      () => [params.id, sync.data.message[params.id ?? ""] === undefined] as const,
      ([id, missing]) => {
        if (id) {
          layout.lastSessionPerTab.setMake(sdk.directory, id)
          if (missing) void sync.session.sync(id).catch(() => {})
        }

        setSending(false)
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

  // ── Annotation event listener (from DrawOverlay) ────────────────────────────────
  createEffect(() => {
    const handleAnnotation = async (e: Event) => {
      const detail = (e as CustomEvent<AnnotationEventDetail>).detail
      
      // Convert File to Attachment (synchronously)
      if (detail.file) {
        const file = detail.file
        const dataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.readAsDataURL(file)
        })
        
        const att: Attachment = {
          id: crypto.randomUUID(),
          filename: file.name,
          mime: 'image/png',
          dataUrl
        }
        setAttachments(prev => [...prev, att])
      }
      
      // Build message text (note only)
      const messageText = detail.note || ""
      
      // Send immediately if requested and not busy
      if (detail.action === 'send' && !sending()) {
        const sessionId = params.id
        if (sessionId) {
          await sendMessage(sessionId, messageText)
          
          // Clear attachments after send
          setAttachments([])
          setPrompt("")
        }
      }
      
      // Acknowledge success
      if (detail.ack) {
        detail.ack({ ok: true })
      }
    }
    
    window.addEventListener(ANNOTATION_EVENT, handleAnnotation)
    onCleanup(() => window.removeEventListener(ANNOTATION_EVENT, handleAnnotation))
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
        console.log(`[make:event] ${e.type || partType}`, props) // eslint-disable-line 
      }
    })
    onCleanup(unsub)
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
    return ((sync.data.message[id] ?? []) as Message[]).filter((m) => m.role === "user")
  })

  const info = createMemo(() => (params.id ? sync.session.get(params.id) : undefined))

  const sessionStatus = createMemo((): SessionStatus => {
    const id = params.id
    if (!id) return { type: "idle" }
    return sync.data.session_status[id] ?? { type: "idle" }
  })

  const isBusy = createMemo(() => sessionStatus().type !== "idle")

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

  // ── Mention (@) Popover State ──
  const [mentionState, setMentionState] = createSignal<{ query: string; cursor: number } | null>(null)
  const [mentionIndex, setMentionIndex] = createSignal(0)

  // ── Artifact Files Resource (for @ mention) ──
  const [artifactFiles] = createResource(
    () => ({ sessionId: params.id, url: globalSDK.url, directory: sdk.directory }),
    async ({ sessionId, url, directory }) => {
      if (!sessionId) return []
      try {
        const result = await fetchArtifactList(url, directory ?? "", sessionId)
        return result.files
      } catch {
        return []
      }
    },
  )

  const mentionFiles = createMemo(() => {
    const state = mentionState()
    if (!state) return []
    const query = state.query.toLowerCase()
    const files = artifactFiles() ?? []
    return files.filter(f => f.name.toLowerCase().includes(query)).slice(0, 12)
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

  const tabStore = createTabStore()
  const snapshotStore = createSnapshotStore(() => params.id)
  const [showVersionPanel, setShowVersionPanel] = createSignal(false)
  const [snapshotList, setSnapshotList] = createSignal<import("./utils/snapshot-store").ArtifactSnapshot[]>([])
  const [snapshotVersion, setSnapshotVersion] = createSignal(0)

  /** 刷新版本快照列表 */
  function refreshSnapshots() {
    setSnapshotList(snapshotStore.snapshots())
    setSnapshotVersion((v) => v + 1)
  }

  // 自动滚动：session busy 时保持对话区随新内容跟随到底部
  const autoScroll = createAutoScroll({ working: isBusy })

  // Bug 修复 B：切换 session 时重置 ResultViewer 的 Tabs 和关闭 popover
  createEffect(on(() => params.id, () => {
    tabStore.reset()
    setMentionState(null)
    setSlashState(null)
  }, { defer: true }))

  /** 处理 ResultViewer 内容编辑保存 */
  async function handleContentChange(tabId: string, content: string) {
    tabStore.updateTabContent(tabId, content)
    const tab = tabStore.tabs().find((t) => t.id === tabId)
    
    if (tab) {
      await persistTabChanges(tab, {
        sessionId: params.id!,
        projectDir: projectDir(),
        sdkUrl: sdk.url,
        sdkDirectory: sdk.directory || "",
        snapshotStore: snapshotStore,
        refreshSnapshots: refreshSnapshots,
      })
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
  async function sendMessage(sessionId: string, text: string) {
    try {
      const fileParts: FilePartInput[] = attachments().map((a) => ({
        type: "file",
        mime: a.mime,
        filename: a.filename,
        url: a.dataUrl,
      }))
      let promptText = text

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

      const textPart: TextPartInput = { type: "text", text: promptText }
      const modelKey = activeModelKey()
      if (!modelKey) return
      await sdk.client.session.prompt({
        sessionID: sessionId,
        agent: "octo_make",
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
const result = await sdk.client.session.create({ directory: dir, agent: "octo_make" })
      const session = result.data as Session | undefined
      if (!session) return
      const dsId = selectedDesignSystem()
if (dsId) {
          localStorage.setItem(DS_KEY_PREFIX + session.id, dsId)
        }
        sendingNavigation = true
        navigate(`/make/${session.id}`)
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

  /** Handle keyboard events including slash command/mention navigation */
  function handleKeyDown(e: KeyboardEvent) {
    const slash = slashState()
    const mention = mentionState()

    // Mention navigation (优先于 slash，因为两者互斥)
    if (mention && mentionFiles().length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        e.stopPropagation()
        setMentionIndex(i => Math.min(i + 1, mentionFiles().length - 1))
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        e.stopPropagation()
        setMentionIndex(i => Math.max(i - 1, 0))
        return
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault()
        e.stopPropagation()
        const files = mentionFiles()
        if (files.length > 0) {
          pickMention(files[mentionIndex()])
        }
        return
      }
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
      e.preventDefault()
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
      setMentionIndex(0)
    } else {
      setMentionState(null)
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

    // Check if already added
    if (attachments().some(a => a.path === file.path)) {
      showToast({ title: "已添加", description: file.name })
      return
    }

    // Check attachment limit (复用现有 maxAttachments)
    if (maxAttachments()) return

    // Load file content
    try {
      const content = await fetchArtifactContent(globalSDK.url, sdk.directory ?? "", file.path)
      const mime = getMimeForKind(file.kind)
      const dataUrl = file.kind === "image"
        ? content.content
        : `data:${mime};base64,${btoa(unescape(encodeURIComponent(content.content)))}`

      setAttachments(prev => [...prev, {
        id: crypto.randomUUID(),
        filename: file.name,
        mime,
        dataUrl,
        path: file.path,
      }])
      showToast({ title: "已添加附件", description: file.name })
    } catch (err) {
      showToast({
        title: "添加失败",
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      })
    }

    requestAnimationFrame(() => {
      ta.focus()
      ta.setSelectionRange(before.length, before.length)
    })
  }

  function getMimeForKind(kind: ArtifactFileKind): string {
    const map: Record<ArtifactFileKind, string> = {
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

  function getFileIcon(kind: ArtifactFileKind): "photo" | "code" | "file-tree" {
    if (kind === "image" || kind === "svg" || kind === "video" || kind === "audio") return "photo"
    if (kind === "html" || kind === "code") return "code"
    return "file-tree"
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

  /** 打开结果到 ResultViewer（优先恢复 localStorage 编辑版本） */
  async function handleOpenResult(card: OutputCard) {
    // Check if card is from Design Files (filePath exists and in artifacts directory)
    const isFromDesignFiles = card.filePath && card.filePath.includes(".octo/artifacts/make")
    
    // For Design Files: try to match existing tab by title (without extension)
    if (isFromDesignFiles) {
      const fileTitleWithoutExt = card.title.replace(/\.[^.]+$/, '')
      const existingTab = tabStore.tabs().find(t => t.title === fileTitleWithoutExt)
      if (existingTab) {
        tabStore.activate(existingTab.id)
        return
      }
    }
    
    // ★ Step 1: Check localStorage snapshot (edited version - highest priority)
    const snapshots = snapshotStore.snapshots()
    const latestSnapshot = snapshots.find((s) => s.tab.id === card.id)
    
    if (latestSnapshot) {
      // Use edited version from localStorage
      card = {
        id: latestSnapshot.tab.id,
        title: latestSnapshot.tab.title,
        type: latestSnapshot.tab.type,
        content: latestSnapshot.tab.content,
        filePath: latestSnapshot.tab.filePath,
        artifactIdentifier: latestSnapshot.tab.artifactIdentifier,
        createdAt: new Date(latestSnapshot.timestamp),
      }
      console.log("[MakePage] Restored edited version from localStorage:", card.id)
    } else if (card.filePath) {
      // ★ Step 2: Load from file (original version - fallback)
      try {
        const response = await fetch(`${sdk.url}/file/content?path=${encodeURIComponent(card.filePath)}`, {
          headers: {
            "x-opencode-directory": sdk.directory || "",
          },
        })
        if (response.ok) {
          const data = await response.json()
          if (data.content && typeof data.content === "string") {
            card = { ...card, content: data.content }
            console.log("[MakePage] Loaded from file:", card.filePath)
          }
        }
      } catch (err) {
        console.error("[MakePage] Failed to load file content:", err)
      }
    }
    
    tabStore.openTab(card)
    if (card.artifactIdentifier?.endsWith("-composed")) {
      tabStore.activate(card.id)
    }
    const tab = tabStore.tabs().find((t) => t.id === card.id)
    
    if (tab) {
      await persistTabChanges(tab, {
        sessionId: params.id!,
        projectDir: projectDir(),
        sdkUrl: sdk.url,
        sdkDirectory: sdk.directory || "",
        snapshotStore: snapshotStore,
        refreshSnapshots: refreshSnapshots,
      })
    }

    // Skip autoSave if file is from Design Files panel (already exists on disk)
    if (projectDir() && !isFromDesignFiles) {
      autoSaveArtifact(params.id!, card, projectDir()!).catch((err) => {
        console.error("[MakePage] auto-save artifact failed:", err)
      })
    }
  }

  /** 继续生成（追加被截断的内容作为 prompt） */
  function handleContinue(card: OutputCard) {
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

  const inputDisabled = () => sending() || isBusy() || !activeModelKey() || !!questionRequest()
  const maxAttachments = () => attachments().length >= 5

  return (
    <DataProvider data={sync.data} directory={sdk.directory || ""}>
      <div
        class="octo-make octo-split bg-background-base"
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
                  {/* 预置提示词按钮:放在输入框白卡片之外,视觉层级:辅助操作浮在输入框上方 */}
                  <StarterCards
                    prompts={FEATURED_STARTERS}
                    onClick={(starter) => setPrompt(starter.prompt)}
                  />
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

                    {/* Mention Popover（新建对话） */}
                    <Show when={mentionState() && mentionFiles().length > 0}>
                      <div class="mention-popover">
                        <div class="mention-popover-head">
                          <span class="mention-popover-title">Design Files</span>
                          <span class="mention-popover-hint">↑↓ 选择 · Enter/Tab 确认 · Esc 关闭</span>
                        </div>
                        <For each={mentionFiles()}>
                          {(file, i) => {
                            const active = i() === mentionIndex()
                            return (
                              <button
                                type="button"
                                class={`mention-item ${active ? "active" : ""}`}
                                onMouseDown={(e) => e.preventDefault()}
                                onMouseEnter={() => setMentionIndex(i())}
                                onClick={() => pickMention(file)}
                              >
                                <Icon name={getFileIcon(file.kind)} class="size-4" />
                                <span class="mention-item-name">{file.name}</span>
                                <span class="mention-item-size">{formatFileSize(file.size)}</span>
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
                        onOpenResult={handleOpenResult}
                        onContinue={handleContinue}
                        onChildSession={ensureChildSession}
                        deltaLog={deltaLog()}
                        onFormSubmit={(text) => {
                          setPrompt(text)
                        }}
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

                {/* 预置提示词按钮:放在输入框白卡片之外,视觉层级:辅助操作浮在输入框上方 */}
                <StarterCards
                  prompts={FEATURED_STARTERS}
                  onClick={(starter) => setPrompt(starter.prompt)}
                />

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

                  {/* Mention Popover */}
                  <Show when={mentionState() && mentionFiles().length > 0}>
                    <div class="mention-popover">
                      <div class="mention-popover-head">
                        <span class="mention-popover-title">项目文件</span>
                        <span class="mention-popover-hint"> Enter/Tab 确认 · Esc 关闭</span>
                      </div>
                      <For each={mentionFiles()}>
                        {(file, i) => {
                          const active = i() === mentionIndex()
                          return (
                            <button
                              type="button"
                              class={`mention-item ${active ? "active" : ""}`}
                              onMouseDown={(e) => e.preventDefault()}
                              onMouseEnter={() => setMentionIndex(i())}
                              onClick={() => pickMention(file)}
                            >
                              <Icon name={getFileIcon(file.kind)} class="size-4" />
                              <span class="mention-item-name">{file.name}</span>
                              <span class="mention-item-size">{formatFileSize(file.size)}</span>
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

        {/* ── 右栏：ResultViewer + Version Panel ──── */}
        <Show when={hasContent()}>
        <div class="flex flex-col overflow-hidden" >
          <div class="flex flex-1 min-h-0 overflow-auto">
            <div class="flex flex-col flex-1" style="min-width:800px">
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
                  onClick={() => setFocusMode(!focusMode())}
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
                onActivate={tabStore.activate}
                onClose={tabStore.closeTab}
                onContentChange={handleContentChange}
                sessionId={params.id}
                onOpenArtifact={handleOpenResult}
              />
            </div>
            <Show when={showVersionPanel()}>
              <VersionPanel
                snapshots={snapshotList()}
                onRestore={(id) => {
                  const tab = snapshotStore.restore(id)
                  if (tab) {
                    tabStore.openTab(tab)
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
