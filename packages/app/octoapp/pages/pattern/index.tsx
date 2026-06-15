import "./assets/style/pattern-tokens.css"
import type { Message, Part, Session, SessionStatus } from "@opencode-ai/sdk/v2/client"
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
import { useGlobalSync } from "@/context/global-sync"
import { SDKProvider, useSDK } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"
import { LocalProvider, useLocal } from "@/context/local"
import { useLayout } from "@/context/layout"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useProjectDir } from "@/hooks/use-project-dir"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { type Attachment } from "./modules/chat/attachment_bar"
import { type OutputCard } from "./modules/chat/insight-turn"

import proto_intent from "./agents/proto_intent"
import proto_intent_audit from "./agents/proto_intent_audit"
import proto_planner_create from "./agents/proto_planner_create"
import proto_module_create from "./agents/proto_module_create"
// import { getDesignMap, readDesignFile } from "./design/load_design"

import create_json from './workflow/create_json'
import modify_json_ai from './workflow/modify_json_ai'

// import { runProtoPlannerModify } from "./agents/proto_planner_modify"
// import { runModuleModify } from "./agents/proto_module_modify"
import { mergeModules } from "./agents/merge"
import { appendPatternVersion, loadCurrentPatternState, listPatternVersions, type VersionEntry } from "./utils/persist"
import { rollbackToVersion } from "./utils/history"
import { buildIntentPrompt, detectCatalog, detectA2UIJson, type ComponentCatalog } from "./utils/a2ui-protocol"
import { ProtoIntroduction } from './modules/chat/proto_introduction'
import { PreviewPage, type PreviewPageAPI } from "./modules/preview/index"
import { ChatPanel } from "./modules/chat/index"
import resultEmptySvg from "./assets/images/IllustrationResultEmpty.svg?url"

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

function PatternPreviewEmpty(): JSX.Element {
  return (
    <div class="flex flex-col items-center justify-center h-full gap-3 text-center px-8" style={{ background: "#f9fafb" }}>
      <img src={resultEmptySvg} width={80} height={80} alt="" draggable={false} style={{ "flex-shrink": "0" }} />
      <div class="text-[13px]" style={{ color: "var(--octo-text-secondary, rgba(0,0,0,0.6))" }}>对话产出将在这里展示</div>
      <div class="text-[12px]" style={{ color: "var(--octo-text-disabled, #BFBFBF)" }}>点击左侧输出卡片即可打开</div>
    </div>
  )
}

function PatternContent() {
  const globalSync = useGlobalSync()
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

  const [sessionInfo, { refetch: refetchSession }] = createResource(
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
  let discoverVersion = 0

  // session 切换：按顺序执行清理 → 重置 → 异步加载 → 滚动
  createEffect(
    on(
      () => params.id,
      (id, prevId) => {
        // ── 1. 切换 session 时同步清理 ──
        if (prevId !== undefined) {
          setSending(false)
          setPhase("idle")
          setSelectedDesignSystem("ICT-3.1")
        }

        // ── 2. 无条件同步重置 ──
        setChildSessionIDs([])
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

          // 同步子 session 消息
          void sync.session.sync(id).then(() => {
            if (params.id === id) discoverChildSessions(id)
          })

          // 恢复历史版本状态并推送到预览
          const dir = patternHistoryDir()
          if (dir) {
            void loadCurrentPatternState(dir, id).then((state) => {
              if (!state || params.id !== id) return
              if (state.lastIntent) setLastIntent(state.lastIntent)
              if (state.lastPlanner) setLastPlanner(state.lastPlanner)
              if (state.lastModules.length > 0) {
                setLastModules(state.lastModules)
                const a2ui = state.mergedA2UI
                  ?? (() => {
                    const shell =
                      (state.lastPlanner?.layout_planner as Record<string, unknown> | undefined) ??
                      state.lastPlanner
                    return mergeModules(
                      { rootId: (shell?.rootId as string) ?? "", elements: ((shell?.elements ?? []) as never) },
                      // @ts-expect-error pre-existing type mismatch in mergeModules
                      state.lastModules,
                    )
                  })()
                const mergedJson = detectA2UIJson(JSON.stringify(a2ui))
                if (mergedJson) sendToPreview(mergedJson)
              }
            })
            void listPatternVersions(dir, id).then(({ versions, current }) => {
              if (params.id !== id) return
              setVersions(versions)
              setCurrentVersionId(current)
            })
          }
        }

        // ── 4. 滚动到底部 ──
        requestAnimationFrame(() => autoScroll.forceScrollToBottom())
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
    }
    return false
  })

  const [prompt, setPrompt] = createSignal("")
  const [sending, setSending] = createSignal(false)
  const [phase, setPhase] = createSignal<"idle" | "intent" | "audit" | "planner" | "module">("idle")
  const [detectedCatalog, setDetectedCatalog] = createSignal<ComponentCatalog>("desktop")
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

  // 历史文件存储目录，优先使用关联目录下的 .octo/design/history
  const patternHistoryDir = createMemo(() => {
    const home = sdk.directory;
    return `${home}/.octo/design/history`;
  })

  const getModuleResults = () => {
    const mods = lastModules()
    return mods.length > 0 ? mods : null
  }

  const hasContent = () => {
    const id = params.id
    if (!id) return false
    if (userMessages().length > 0) return true
    if (sending()) return true
    const rootMsgs = sync.data.message[id]
    if (rootMsgs && rootMsgs.length > 0) return true
    return false
  }

  // 从预览页选中元素后触发的修改回调
  function handlePickerSubmit(text: string, domPickerId: string) {
    setPrompt(`[选中元素: ${domPickerId}] ${text}`)
    void handleSubmit()
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

  const previewApi: PreviewPageAPI = { sendToPreview: () => { }, postMessage: () => { }, refresh: () => { } }

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
    setSending(true)
    setPrompt("")
    const submitSessionId = params.id
    const controller = new AbortController()
    const mk = activeModelKey()!
    try {
      let sid = submitSessionId
      if (!sid) {
        const dir = sdk.directory
        if (!dir) return
        const result = await sdk.client.session.create({ directory: dir, agent: AGENT_NAME })
        const session = result.data as Session | undefined
        if (!session) return
        setPhase("intent")
        setSelectedDesignSystem("ICT-3.1")
        navigate(`/pattern/${session.id}`)
        sid = session.id
      }

      const existing = sessionInfo()?.title
      if (!existing || existing.startsWith("New session")) {
        await sdk.client.session.update({ sessionID: sid, title: text.slice(0, 60) }).catch(() => { })
      }

      // 执行流程的基础上下文
      let intentCtx = {
        sdk: sdk,
        sync: sync,
        modelKey: mk,
        rootSession: sid,
        userInput: text,
        onSessionCreated: (childID: string) => setChildSessionIDs((prev) => [...prev, childID]),
      }
      // 流程执行完毕后的回调
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
                lastIntent: lastIntent(),
                lastPlanner: lastPlanner(),
                lastModules: lastModules(),
                mergedA2UI: pageJson as unknown as Record<string, unknown>,
            }, text.slice(0, 80))
            setVersions((prev) => [...prev, { id: vid, createdAt: Date.now(), summary: text.slice(0, 80) }])
            setCurrentVersionId(vid)
          }
      }

      if(lastIntent()){
        let lastData = {
          lastIntent: lastIntent(),
          lastPlanner: lastPlanner(),
          lastModules: lastModules(),
        }
        // AI 修改页面 — 先切到加载态
        setIsModifying(true)
        await modify_json_ai(intentCtx, lastData, onFinshed);
        setIsModifying(false)
      }else{
        // 首次创建页面
        await create_json(intentCtx, onFinshed);
      }

      const genDuration = ((performance.now() - genStartTime)/1000).toFixed(0)
      console.log(`[Pattern] 第一次生成页面耗时: ${genDuration}s`)
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "aborted") return
      console.error("[PatternPage] handleSubmit failed", err)
    } finally {
      if (!submitSessionId || params.id === submitSessionId) {
        setSending(false)
      }
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
    setSending(false)
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
    const id = params.id
    const dir = patternHistoryDir()
    if (!id || !dir) return
    const state = await rollbackToVersion(dir, id, versionId, sendToPreview)
    if (!state) return
    setCurrentVersionId(versionId)
    if (state.lastIntent) setLastIntent(state.lastIntent)
    if (state.lastPlanner) setLastPlanner(state.lastPlanner)
    if (state.lastModules.length > 0) setLastModules(state.lastModules)
  }

  const inputDisabled = () => sending() || isBusy() || !activeModelKey()

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
            hasPreview={lastModules().length > 0 && !isBusy()}
            onOpenPreview={handleOpenPreview}
            onDeleteSession={deleteSession}
            onTitleChanged={() => void refetchSession()}
          />
        </Show>

        <Show when={hasContent() && !focusMode()}>
          <div class="octo-split-handle" onMouseDown={handleDividerMouseDown} />
        </Show>

        {/* 预览页 */}
        <Show when={hasContent()}>
          <div style={{ position: "relative", overflow: "hidden" }}>
            <Show when={hasPreviewContent()} fallback={<PatternPreviewEmpty />}>
              <PreviewPage
                api={previewApi}
                pendingData={pendingPreviewData()}
                onPickerSubmit={handlePickerSubmit}
                versions={versions()}
                currentVersionId={currentVersionId()}
                onSelectVersion={(vid) => { void handleSelectVersion(vid) }}
              />
            </Show>
            <Show when={isModifying()}>
              <div
                style={{
                  position: "absolute",
                  inset: "0",
                  "z-index": "50",
                  background: "rgba(249, 250, 251, 0.85)",
                  display: "flex",
                  "flex-direction": "column",
                  "align-items": "center",
                  "justify-content": "center",
                  gap: "12px",
                }}
              >
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

