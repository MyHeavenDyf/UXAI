import "./octo-tokens.css"
import type { Message, Part, Session, SessionStatus, SnapshotFileDiff } from "@opencode-ai/sdk/v2/client"
import type { FilePartInput, TextPartInput } from "@opencode-ai/sdk/v2/client"
import { DataProvider } from "@opencode-ai/ui/context/data"
import { createAutoScroll } from "@opencode-ai/ui/hooks"
import { Binary } from "@opencode-ai/core/util/binary"
import { base64Encode } from "@opencode-ai/core/util/encode"
import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  Show,
  type JSX,
} from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { useNavigate, useParams } from "@solidjs/router"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { decode64 } from "@/utils/base64"
import { AttachmentBar, type Attachment } from "./components/attachment-bar"
import { InsightTurn, type OutputCard } from "./components/insight-turn"
import { ResultViewer } from "./components/result-viewer/index"
import { createTabStore } from "./components/result-viewer/tab-store"
import { OctoSidebar } from "@/pages/_shell/sidebar"

const SKIP_PART_TYPES = new Set(["patch", "step-start", "step-finish"])

type DataStore = {
  session: Session[]
  session_status: { [sessionID: string]: SessionStatus }
  session_diff: { [sessionID: string]: SnapshotFileDiff[] }
  message: { [sessionID: string]: Message[] }
  part: { [messageID: string]: Part[] }
}

export default function CoworkPage() {
  const params = useParams<{ id?: string; dir?: string }>()
  const navigate = useNavigate()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()

  const projectDir = () => {
    if (params.dir) {
      const decoded = decode64(params.dir)
      if (decoded) return decoded
    }
    return globalSync.data.path.home
  }

  const slug = createMemo(() => {
    const dir = projectDir()
    if (!dir) return ""
    return base64Encode(dir)
  })

  const [sidebarWidth, setSidebarWidth] = createSignal(300)

  function handleSidebarResize(e: MouseEvent) {
    e.preventDefault()
    const startX = e.clientX
    const startW = sidebarWidth()
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    const onMove = (ev: MouseEvent) => setSidebarWidth(Math.max(160, Math.min(360, startW + ev.clientX - startX)))
    const onUp = () => {
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
    }
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
  }

  const [dataStore, setDataStore] = createStore<DataStore>({
    session: [],
    session_status: {},
    session_diff: {},
    message: {},
    part: {},
  })

  createEffect(
    on(
      () => params.id,
      (id) => {
        if (!id) return
        globalSDK.client.session.messages({ sessionID: id })
          .then((result) => {
            const items = result.data ?? []
            const msgs: Message[] = []
            const partMap: { [msgId: string]: Part[] } = {}
            for (const { info, parts } of items as { info: Message; parts: Part[] }[]) {
              msgs.push(info)
              const visible = parts.filter((p) => !SKIP_PART_TYPES.has(p.type))
              if (visible.length > 0) partMap[info.id] = visible
            }
            batch(() => {
              setDataStore("message", id, reconcile(msgs, { key: "id" }))
              for (const [msgId, ps] of Object.entries(partMap)) {
                setDataStore("part", msgId, reconcile(ps, { key: "id" }))
              }
            })
          })
          .catch((err) => {
            console.error("[CoworkPage] messages load failed", err)
          })
      },
    ),
  )

  const unsub = globalSDK.event.listen((e) => {
    const sessionId = params.id
    if (!sessionId) return
    const event = e.details

    if (event.type === "message.updated") {
      const info = event.properties.info
      if (info.sessionID !== sessionId) return
      const messages = dataStore.message[sessionId]
      if (!messages) { setDataStore("message", sessionId, [info]); return }
      const result = Binary.search(messages, info.id, (m: Message) => m.id)
      if (result.found) {
        setDataStore("message", sessionId, result.index, reconcile(info))
      } else {
        setDataStore("message", sessionId, produce((d) => { d.splice(result.index, 0, info) }))
      }
      return
    }

    if (event.type === "message.part.updated") {
      const part = event.properties.part
      if (part.sessionID !== sessionId) return
      if (SKIP_PART_TYPES.has(part.type)) return
      const parts = dataStore.part[part.messageID]
      if (!parts) { setDataStore("part", part.messageID, [part]); return }
      const result = Binary.search(parts, part.id, (p: Part) => p.id)
      if (result.found) {
        setDataStore("part", part.messageID, result.index, reconcile(part))
      } else {
        setDataStore("part", part.messageID, produce((d) => { d.splice(result.index, 0, part) }))
      }
      return
    }

    if (event.type === "session.status") {
      const { sessionID, status } = event.properties
      if (sessionID !== sessionId) return
      setDataStore("session_status", sessionID, reconcile(status))
      return
    }

    const raw = event as unknown as { type: string; properties: Record<string, unknown> }
    if (raw.type === "message.part.delta") {
      const { messageID, partID, field, delta } = raw.properties as {
        messageID: string; partID: string; field: string; delta: string
      }
      const parts = dataStore.part[messageID]
      if (!parts) return
      const result = Binary.search(parts, partID, (p: Part) => p.id)
      if (!result.found) return
      setDataStore("part", messageID, produce((d) => {
        const p = d[result.index] as Record<string, unknown>
        p[field] = ((p[field] as string) ?? "") + delta
      }))
    }
  })
  onCleanup(unsub)

  const userMessages = createMemo((): Message[] => {
    const id = params.id
    if (!id) return []
    return (dataStore.message[id] ?? []).filter((m) => m.role === "user")
  })

  const sessionStatus = createMemo((): SessionStatus => {
    const id = params.id
    if (!id) return { type: "idle" }
    return dataStore.session_status[id] ?? { type: "idle" }
  })

  const isBusy = createMemo(() => sessionStatus().type === "busy")

  const [prompt, setPrompt] = createSignal("")
  const [sending, setSending] = createSignal(false)
  const [attachments, setAttachments] = createSignal<Attachment[]>([])
  const [isDragOver, setIsDragOver] = createSignal(false)
  // 对话面板宽度，可拖拽，范围 200–520px
  const [chatWidth, setChatWidth] = createSignal(468)

  function handleDividerMouseDown(e: MouseEvent) {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = chatWidth()
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    document.body.style.overflow = "hidden"
    const onMove = (ev: MouseEvent) => {
      setChatWidth(Math.max(240, Math.min(Math.floor(window.innerWidth * 0.45), startWidth + ev.clientX - startX)))
    }
    const onUp = () => {
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      document.body.style.overflow = ""
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
    }
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
  }

  const tabStore = createTabStore()

  // 自动滚动：session busy 时保持对话区随新内容跟随到底部
  const autoScroll = createAutoScroll({ working: isBusy })

  // Bug 修复 B：切换 session 时重置 ResultViewer 的 Tabs
  createEffect(on(() => params.id, () => { tabStore.reset() }, { defer: true }))

  // ── session 操作 ──────────────────────────────────────────

  async function createAndNavigate(): Promise<string | undefined> {
    const dir = projectDir()
    if (!dir) return
    setSending(true)
    try {
      const result = await globalSDK.client.session.create({ directory: dir })
      const session = result.data as Session | undefined
      if (session) {
        navigate(`/${slug()}/cowork/${session.id}`)
        return session.id
      }
    } catch (err) {
      console.error("[CoworkPage] session.create failed", err)
    } finally {
      setSending(false)
    }
    return undefined
  }

  async function sendMessage(sessionId: string, text: string) {
    setSending(true)
    try {
      const fileParts: FilePartInput[] = attachments().map((a) => ({
        type: "file",
        mime: a.mime,
        filename: a.filename,
        url: a.dataUrl,
      }))
      const textPart: TextPartInput = { type: "text", text }
      await globalSDK.client.session.prompt({
        sessionID: sessionId,
        parts: [textPart, ...fileParts],
      })
      setAttachments([])
    } catch (err) {
      console.error("[CoworkPage] prompt failed", err)
    } finally {
      setSending(false)
    }
  }

  async function handleSubmit() {
    const text = prompt().trim()
    if (!text || sending()) return
    setPrompt("")
    let sid = params.id
    if (!sid) {
      sid = await createAndNavigate()
      if (!sid) return
    }
    await sendMessage(sid, text)
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      void handleSubmit()
    }
  }

  // ── 附件管理 ─────────────────────────────────────────────

  let fileInputRef!: HTMLInputElement

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
    tabStore.openTab(card)
  }

  const inputDisabled = () => sending() || isBusy()
  const maxAttachments = () => attachments().length >= 5

  return (
    <DataProvider data={dataStore} directory={projectDir() || ""}>
      <div class="size-full flex overflow-hidden min-h-0">

        {/* ── 左栏：OctoSidebar ─────────────────────────── */}
        <OctoSidebar
          width={sidebarWidth()}
          directory={projectDir()}
          slug={slug()}
          dataCoworkArea="sidebar"
        />
        {/* sidebar 拖拽句柄 */}
        <div
          style={{
            width: "5px",
            cursor: "col-resize",
            "flex-shrink": "0",
            "align-self": "stretch",
            "z-index": "10",
          }}
          onMouseDown={handleSidebarResize}
        />

        {/* ── 左栏：对话面板（固定宽度，始终可拖拽） ──── */}
        <div
          class="flex flex-col overflow-hidden flex-shrink-0"
          style={{
            width: `${chatWidth()}px`,
            flex: "0 0 auto",
            background: isDragOver() ? "var(--octo-brand-a3)" : "var(--octo-surface-page)",
            outline: isDragOver() ? "inset 0 0 0 2px var(--octo-brand-a25)" : "none",
          }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
            {/* 消息列表（autoScroll 挂在 scrollRef 容器，contentRef 挂在内容 div） */}
            <div
              class="flex-1 overflow-y-auto min-h-0"
              ref={autoScroll.scrollRef}
              onScroll={autoScroll.handleScroll}
              onMouseUp={autoScroll.handleInteraction}
            >
              <Show
                when={params.id && userMessages().length > 0}
                fallback={<CoworkEmptyState />}
              >
                <div ref={autoScroll.contentRef} class="py-3 flex flex-col gap-0">
                  <For each={userMessages()}>
                    {(msg) => (
                      <InsightTurn
                        sessionID={params.id!}
                        messageID={msg.id}
                        status={sessionStatus()}
                        active={isBusy()}
                        onOpenResult={handleOpenResult}
                      />
                    )}
                  </For>
                </div>
              </Show>
            </div>

            {/* 输入区 */}
            <div data-cowork-area="input-wrap" class="shrink-0" style={{ opacity: inputDisabled() ? "0.6" : "1" }}>
              <AttachmentBar
                attachments={attachments()}
                onRemove={removeAttachment}
              />

              <div data-cowork-area="input">
                <textarea
                  value={prompt()}
                  onInput={(e) => setPrompt(e.currentTarget.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="输入指令，按 Enter 发送…"
                  rows={3}
                  disabled={inputDisabled()}
                />

                <input
                  ref={fileInputRef!}
                  type="file"
                  multiple
                  class="hidden"
                  accept="*/*"
                  onChange={handleFileInputChange}
                />

                <button
                  type="button"
                  onClick={() => { if (!maxAttachments()) fileInputRef.click() }}
                  disabled={maxAttachments()}
                  title={maxAttachments() ? "最多 5 个文件" : "添加附件"}
                  class="absolute flex items-center justify-center"
                  style={{
                    left: "16px",
                    bottom: "16px",
                    width: "32px",
                    height: "32px",
                    "border-radius": "8px",
                    background: "transparent",
                    border: "none",
                    color: maxAttachments() ? "rgba(0,0,0,0.25)" : "rgba(0,0,0,0.45)",
                    cursor: maxAttachments() ? "not-allowed" : "pointer",
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <path d="M9 3V15M3 9H15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                  </svg>
                </button>

                <button
                  type="button"
                  onClick={() => void handleSubmit()}
                  disabled={!prompt().trim() || inputDisabled()}
                  class="absolute flex items-center justify-center"
                  style={{
                    right: "16px",
                    bottom: "16px",
                    width: "32px",
                    height: "32px",
                    "border-radius": "50%",
                    background: (!prompt().trim() || inputDisabled())
                      ? "rgba(0,0,0,0.1)"
                      : "linear-gradient(135deg, rgb(31,75,215), rgb(51,147,247))",
                    border: "none",
                    color: "#fff",
                    cursor: (!prompt().trim() || inputDisabled()) ? "default" : "pointer",
                    transition: "opacity 0.2s",
                  }}
                >
                  {sending() ? (
                    <span style={{ "font-size": "14px" }}>…</span>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M8 2L8 14M3 7L8 2L13 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

        </div>

        {/* ── 聊天/结果 拖拽分隔线（始终渲染，1px 线 + 4px 两侧可拖区） */}
        <div
          class="flex-shrink-0 flex items-stretch"
          style={{ width: "9px", cursor: "col-resize" }}
          onMouseDown={handleDividerMouseDown}
          onMouseEnter={(e) => {
            const bar = e.currentTarget.querySelector(".divider-bar") as HTMLElement | null
            if (bar) bar.style.background = "var(--octo-brand-a40)"
          }}
          onMouseLeave={(e) => {
            const bar = e.currentTarget.querySelector(".divider-bar") as HTMLElement | null
            if (bar) bar.style.background = "var(--octo-border-divider)"
          }}
        >
          <div
            class="divider-bar"
            style={{
              width: "1px",
              height: "100%",
              margin: "0 4px",
              background: "var(--octo-border-divider)",
              transition: "background var(--octo-dur-fast)",
            }}
          />
        </div>

        {/* ── 中栏：ResultViewer（始终渲染，无 tab 时显示空态） */}
        <ResultViewer
          tabs={tabStore.tabs()}
          activeId={tabStore.activeId()}
          onActivate={tabStore.activate}
          onClose={tabStore.closeTab}
          dataCoworkArea="result"
        />

        {/* ── 右栏：Workspace 占位 (P2) ──────────────── */}
        <div />
      </div>
    </DataProvider>
  )
}

function CoworkEmptyState(): JSX.Element {
  return (
    <div class="flex flex-col items-center h-full text-center" style={{ padding: "80px 24px 0" }}>
      <img src="/IllustrationInsightEmpty.svg" alt="" style={{ width: "80px", height: "80px", "margin-bottom": "20px", "flex-shrink": "0" }} />
      <div style={{ "font-size": "28px", "font-weight": "700", color: "rgba(0,0,0,0.9)", "margin-bottom": "12px" }}>
        Octo AI
      </div>
      <div style={{ "font-size": "16px", "line-height": "24px", color: "rgb(110,115,112)", "margin-bottom": "32px" }}>
        您的全能设计与调研专家
      </div>

      {/* 专项能力矩阵 */}
      <div class="flex items-center gap-[12px]" style={{ "margin-bottom": "24px" }}>
        <div style={{ width: "100px", height: "2px", background: "linear-gradient(90deg, transparent, rgba(10,89,247,0.3))" }} />
        <span style={{ "font-size": "14px", "font-weight": "600", color: "rgba(0,0,0,0.9)", "white-space": "nowrap" }}>
          专项能力矩阵
        </span>
        <div style={{ width: "100px", height: "2px", background: "linear-gradient(90deg, rgba(10,89,247,0.3), transparent)" }} />
      </div>

      {/* 能力介绍 */}
      <div class="flex flex-col gap-[8px]" style={{ "margin-bottom": "32px" }}>
        <CapabilityItem
          title="Octo Insight"
          desc="调研与竞品分析交付"
        />
        <CapabilityItem
          title="Octo Make"
          desc="设计方案交付"
        />
      </div>

      <div style={{ "font-size": "14px", "line-height": "22px", color: "rgba(0,0,0,0.45)", "max-width": "300px" }}>
        有任何问题直接在下方提问<br />
        我将根据具体需求匹配不同能力进行完成~
      </div>
    </div>
  )
}

function CapabilityItem(props: { title: string; desc: string }): JSX.Element {
  return (
    <div class="flex items-center gap-[20px] text-left">
      <div
        style={{
          width: "24px",
          height: "24px",
          "border-radius": "6px",
          background: "rgba(10,89,247,0.08)",
          "flex-shrink": "0",
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          color: "rgb(10,89,247)",
        }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M11.5 3.5L5.5 10.5L2.5 7.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </div>
      <div class="flex flex-col gap-[2px]">
        <span style={{ "font-size": "14px", "font-weight": "600", color: "rgba(0,0,0,0.9)" }}>{props.title}</span>
        <span style={{ "font-size": "12px", color: "rgba(0,0,0,0.45)" }}>{props.desc}</span>
      </div>
    </div>
  )
}
