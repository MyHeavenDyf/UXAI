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
import { useProjectDir } from "@/hooks/use-project-dir"

import { type Attachment } from "./modules/chat/attachment_bar"
import { type OutputCard } from "./modules/chat/insight-turn"

import create_scene from "./workflow/create_scene"
import modify_scene_ai from "./workflow/modify_scene_ai"

import { appendSceneVersion, loadCurrentSceneState, listSceneVersions, type VersionEntry } from "./utils/persist"
import { rollbackToVersion } from "./utils/history"
import { detectSceneJson, type SceneDocument } from "./utils/scene-protocol"
import { ProtoIntroduction } from "./modules/chat/proto_introduction"
import { PreviewPage, type PreviewPageAPI } from "./modules/preview/index"
import { ChatPanel } from "./modules/chat/index"
import resultEmptySvg from "./assets/images/IllustrationResultEmpty.svg?url"

const AGENT_NAME = "proto_3d_triage"

export default function ThreeDPage() {
  const dir = useProjectDir()

  return (
    <Show when={dir()} keyed>
      {(directory) => (
        <SDKProvider directory={() => directory}>
          <SyncProvider>
            <LocalProvider>
              <ThreeDContent />
            </LocalProvider>
          </SyncProvider>
        </SDKProvider>
      )}
    </Show>
  )
}

function ThreeDPreviewEmpty(): JSX.Element {
  return (
    <div class="flex flex-col items-center justify-center h-full gap-3 text-center px-8" style={{ background: "#0d1117" }}>
      <img src={resultEmptySvg} width={80} height={80} alt="" draggable={false} style={{ "flex-shrink": "0" }} />
      <div class="text-[13px]" style={{ color: "rgba(255,255,255,0.6)" }}>3D 场景将在这里展示</div>
      <div class="text-[12px]" style={{ color: "rgba(255,255,255,0.35)" }}>在左侧描述需求即可生成</div>
    </div>
  )
}

function ThreeDContent() {
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
        return (result.data as Session | undefined) ?? null
      } catch {
        return null as Session | null
      }
    },
  )

  async function deleteSession(sessionID: string) {
    try {
      await sdk.client.session.delete({ sessionID })
      navigate("/3d")
    } catch (err) {
      showToast({ title: "删除失败", description: err instanceof Error ? err.message : String(err) })
    }
  }

  const [childSessionIDs, setChildSessionIDs] = createSignal<string[]>([])
  let discoverVersion = 0

  // session 切换：清理 → 重置 → 异步加载 → 滚动
  createEffect(
    on(
      () => params.id,
      (id, prevId) => {
        if (prevId !== undefined) {
          setSending(false)
          setPhase("idle")
        }
        setChildSessionIDs([])
        discoverVersion++
        setSceneDoc(null)

        if (id) {
          layout.lastSessionPerTab.setThreeD(id)
          setLastIntent(null)
          setLastPlanner(null)
          setVersions([])
          setCurrentVersionId(null)
          setIsModifying(false)

          // 同步子 session 消息
          void sync.session.sync(id).then(() => {
            if (params.id === id) discoverChildSessions(id)
          })

          // 恢复历史版本场景
          const dir = sceneHistoryDir()
          if (dir) {
            void loadCurrentSceneState(dir, id).then((state) => {
              if (!state || params.id !== id) return
              if (state.sceneIntent) setLastIntent(state.sceneIntent)
              if (state.scenePlanner) setLastPlanner(state.scenePlanner)
              if (state.sceneJson) setSceneDoc(state.sceneJson)
            })
            void listSceneVersions(dir, id).then(({ versions, current }) => {
              if (params.id !== id) return
              setVersions(versions)
              setCurrentVersionId(current)
            })
          }
        }

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

  const roundMessages = createMemo(() => {
    const id = params.id
    if (!id) return []
    const allRootMsgs = (sync.data.message[id] ?? []) as Message[]
    const rootUserMsgs = allRootMsgs.filter((m) => m.role === "user")
    const childIDs = childSessionIDs()
    if (childIDs.length === 0 && rootUserMsgs.length === 0) return []

    type Item = { sessionID: string; messageID: string; time: number }
    type Round = { startTime: number; endTime?: number; items: Item[] }

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
      const trackTime = (m: Message) => {
        const t = m.time as { created: number; completed?: number }
        if (t.created < startTime) startTime = t.created
        if (typeof t.completed === "number" && (!endTime || t.completed > endTime)) endTime = t.completed
      }
      for (const m of rootUserMsgs) {
        const t = m.time?.created ?? 0
        if (t < roundStart || t >= roundEnd) continue
        items.push({ sessionID: id, messageID: m.id, time: t })
        trackTime(m)
      }
      for (const childID of childIDs) {
        const childMsgs = (sync.data.message[childID] ?? []) as Message[]
        const childCreated = childMsgs[0]?.time?.created ?? Infinity
        if (childCreated < roundStart || childCreated >= roundEnd) continue
        for (const m of childMsgs) {
          if (m.role === "user") items.push({ sessionID: childID, messageID: m.id, time: m.time?.created ?? 0 })
          trackTime(m)
        }
      }
      items.sort((a, b) => a.time - b.time)
      if (startTime === Infinity) startTime = items.length > 0 ? items[0].time : Date.now()
      return { startTime, endTime, items }
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

  const [prompt, setPrompt] = createSignal("")
  const [sending, setSending] = createSignal(false)
  const [phase, setPhase] = createSignal<"idle" | "intent" | "planner" | "object">("idle")
  const [attachments, setAttachments] = createSignal<Attachment[]>([])
  const [isDragOver, setIsDragOver] = createSignal(false)
  const [lastIntent, setLastIntent] = createSignal<Record<string, unknown> | null>(null)
  const [lastPlanner, setLastPlanner] = createSignal<Record<string, unknown> | null>(null)
  const [sceneDoc, setSceneDoc] = createSignal<SceneDocument | null>(null)
  const [versions, setVersions] = createSignal<VersionEntry[]>([])
  const [currentVersionId, setCurrentVersionId] = createSignal<string | null>(null)
  const [isModifying, setIsModifying] = createSignal(false)

  // 历史文件存储目录
  const sceneHistoryDir = createMemo(() => {
    const home = sdk.directory
    return `${home}/.octo/3d/history`
  })

  const hasContent = () => {
    const id = params.id
    if (!id) return false
    if (userMessages().length > 0) return true
    if (sending()) return true
    const rootMsgs = sync.data.message[id]
    if (rootMsgs && rootMsgs.length > 0) return true
    return false
  }

  // 从预览画布点选物体后,把选中信息带入输入框,用户描述后走修改流程
  function handlePickObject(id: string | null) {
    if (!id) return
    setPrompt(`[选中物体: ${id}] `)
  }

  const CHAT_WIDTH_KEY = "octo:threed:chat-width"
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

  const previewApi: PreviewPageAPI = { refresh: () => { } }

  function sendToPreview(doc: unknown) {
    const parsed = detectSceneJson(typeof doc === "string" ? doc : JSON.stringify(doc))
    if (parsed) setSceneDoc(parsed)
    else if (doc && typeof doc === "object") setSceneDoc(doc as SceneDocument)
  }

  async function handleSubmit() {
    const text = prompt().trim()
    if (!text || sending() || !activeModelKey()) return
    const genStartTime = performance.now()
    console.log("[3D] 开始生成场景:", text)
    setSending(true)
    setPrompt("")
    const submitSessionId = params.id
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
        navigate(`/3d/${session.id}`)
        sid = session.id
      }

      const existing = sessionInfo()?.title
      if (!existing || existing.startsWith("New session")) {
        await sdk.client.session.update({ sessionID: sid, title: text.slice(0, 60) }).catch(() => { })
      }

      const intentCtx = {
        sdk,
        sync,
        modelKey: mk,
        rootSession: sid,
        userInput: text,
        onSessionCreated: (childID: string) => setChildSessionIDs((prev) => [...prev, childID]),
      }

      // 生成完成回调:推送预览 + 落盘历史
      const onFinished = async ({ sceneIntent, scenePlanner, sceneJson }: any) => {
        if (sceneJson) sendToPreview(sceneJson)
        setLastIntent(sceneIntent)
        setLastPlanner(scenePlanner)
        const dir = sceneHistoryDir()
        if (dir) {
          const vid = await appendSceneVersion(dir, sid, {
            sceneIntent: sceneIntent ?? null,
            scenePlanner: scenePlanner ?? null,
            sceneJson: sceneJson ?? null,
          }, text.slice(0, 80))
          setVersions((prev) => [...prev, { id: vid, createdAt: Date.now(), summary: text.slice(0, 80) }])
          setCurrentVersionId(vid)
        }
      }

      if (lastIntent()) {
        // AI 修改已有场景
        setIsModifying(true)
        await modify_scene_ai(intentCtx, {
          lastIntent: lastIntent(),
          lastPlanner: lastPlanner(),
          sceneJson: sceneDoc(),
        }, onFinished)
        setIsModifying(false)
      } else {
        // 首次创建
        await create_scene(intentCtx, onFinished)
      }

      const genDuration = ((performance.now() - genStartTime) / 1000).toFixed(0)
      console.log(`[3D] 生成场景耗时: ${genDuration}s`)
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "aborted") return
      console.error("[ThreeDPage] handleSubmit failed", err)
    } finally {
      if (!submitSessionId || params.id === submitSessionId) {
        setSending(false)
      }
    }
  }

  async function halt() {
    const sid = params.id
    if (!sid) return
    await sdk.client.session.abort({ sessionID: sid }).catch(() => { })
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
          { id: crypto.randomUUID(), filename: file.name, mime: file.type || "application/octet-stream", dataUrl },
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

  function handleOpenResult(_card: OutputCard) {
    // 3D 场景已在 sceneDoc 中,直接展示即可(无需 A2UI 合并)
    if (sceneDoc()) return
  }

  function handleOpenPreview() {
    // sceneDoc 已是完整场景,PreviewPage 响应式渲染,无需额外处理
  }

  // 实时预览:把当前场景写成 live-data.json,新开独立窗口(preview-server 51857 托管)渲染
  async function handleLivePreview() {
    const data = sceneDoc()
    if (!data) return showToast({ title: "暂无可预览的内容" })
    const api = (window as any).api
    const dir = await api?.getPreviewDist3dDir?.()
    if (!dir || !api?.writeFileBuffer) return showToast({ title: "当前环境不支持实时预览" })
    const buffer = new TextEncoder().encode(JSON.stringify(data)).buffer
    await api.writeFileBuffer(`${dir}/live-data.json`, buffer)
    window.open("http://127.0.0.1:51857/?fetch=live-data.json")
  }

  // 生成完成后确保预览展示
  let wasBusy = false
  createEffect(() => {
    const busy = isBusy() || sending()
    if (wasBusy && !busy && sceneDoc()) {
      handleOpenPreview()
    }
    wasBusy = busy
  })

  // 回退到指定历史版本
  async function handleSelectVersion(versionId: string) {
    const id = params.id
    const dir = sceneHistoryDir()
    if (!id || !dir) return
    const state = await rollbackToVersion(dir, id, versionId, sendToPreview)
    if (!state) return
    setCurrentVersionId(versionId)
    if (state.sceneIntent) setLastIntent(state.sceneIntent)
    if (state.scenePlanner) setLastPlanner(state.scenePlanner)
    previewApi.refresh()
  }

  function handleDownload() {
    const data = sceneDoc()
    if (!data) {
      showToast({ title: "暂无可下载的内容" })
      return
    }
    const jsonStr = JSON.stringify(data, null, 2)
    const blob = new Blob([jsonStr], { type: "application/json;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `scene-${params.id ?? "export"}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
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
    model: local.model,
    rows: undefined,
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
            roundMessages={roundMessages()}
            hasPreview={!!sceneDoc() && !isBusy()}
            onOpenPreview={handleOpenPreview}
            onDeleteSession={deleteSession}
            onTitleChanged={() => void refetchSession()}
          />
        </Show>

        <Show when={hasContent() && !focusMode()}>
          <div class="octo-split-handle" onMouseDown={handleDividerMouseDown} />
        </Show>

        {/* 3D 预览 */}
        <Show when={hasContent()}>
          <div style={{ position: "relative", overflow: "hidden" }}>
            <Show when={sceneDoc()} fallback={<ThreeDPreviewEmpty />}>
              <PreviewPage
                api={previewApi}
                doc={sceneDoc()}
                onPickObject={handlePickObject}
                onDownload={handleDownload}
                onLivePreview={handleLivePreview}
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
                  background: "rgba(13, 17, 23, 0.85)",
                  display: "flex",
                  "flex-direction": "column",
                  "align-items": "center",
                  "justify-content": "center",
                  gap: "12px",
                }}
              >
                <img src={resultEmptySvg} width={80} height={80} alt="" draggable={false} style={{ "flex-shrink": "0" }} />
                <div class="text-[13px]" style={{ color: "rgba(255,255,255,0.7)" }}>正在修改场景中...</div>
              </div>
            </Show>
          </div>
        </Show>
      </div>
    </DataProvider>
  )
}
