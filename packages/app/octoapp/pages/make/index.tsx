import "./octo-tokens.css"
import type { Message, Part, Session, SessionStatus, SnapshotFileDiff } from "@opencode-ai/sdk/v2/client"
import type { FilePartInput, TextPartInput } from "@opencode-ai/sdk/v2/client"
import { DataProvider } from "@opencode-ai/ui/context/data"
import { createAutoScroll } from "@opencode-ai/ui/hooks"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { InlineInput } from "@opencode-ai/ui/inline-input"
import { showToast } from "@opencode-ai/ui/toast"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Binary } from "@opencode-ai/core/util/binary"
import { base64Encode } from "@opencode-ai/core/util/encode"
import {
  batch,
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
import { createStore, produce, reconcile } from "solid-js/store"
import { useNavigate, useParams } from "@solidjs/router"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLayout } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { useProjectDir } from "@/hooks/use-project-dir"
import { sessionTitle } from "@/utils/session-title"
import { AttachmentBar, type Attachment } from "./components/attachment-bar"
import { InsightTurn, type OutputCard } from "./components/insight-turn"
import { ResultViewer } from "./components/result-viewer/index"
import { createTabStore } from "./components/result-viewer/tab-store"
import { DesignSystemPicker } from "./components/design-system-picker"
import { IconAttach, IconSend } from "./icons"
import { IllustrationInsightEmpty } from "./icons/illustrations"
import { Spinner } from "@opencode-ai/ui/spinner"
import { Icon } from "@opencode-ai/ui/icon"
import { loadDesignSystem } from "./utils/design-system-loader"
import { useModels } from "@/context/models"
import { useLocal } from "@/context/local"
import { ModelSelectorPopover } from "@/components/dialog-select-model"
import { Persist, persisted } from "@/utils/persist"

const SKIP_PART_TYPES = new Set(["patch", "step-start", "step-finish"])

type DataStore = {
  session: Session[]
  session_status: { [sessionID: string]: SessionStatus }
  session_diff: { [sessionID: string]: SnapshotFileDiff[] }
  message: { [sessionID: string]: Message[] }
  part: { [messageID: string]: Part[] }
}

export default function MakePage() {
  const params = useParams<{ id?: string }>()
  const navigate = useNavigate()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const layout = useLayout()
  const language = useLanguage()
  const dialog = useDialog()

  const homeDir = useProjectDir()

  // ── 模型选择（与 Chat/Studio 隔离，workspace 级持久化） ────
  const models = useModels()
  const [modelStore, setModelStore] = persisted(
    Persist.workspace(homeDir() ?? "", "make-model"),
    createStore<{ providerID: string; modelID: string } | Record<string, never>>({}),
  )
  const selectedModelKey = createMemo<{ providerID: string; modelID: string } | null>(
    () => {
      const s = modelStore
      return "providerID" in s && "modelID" in s ? s as { providerID: string; modelID: string } : null
    },
  )
  const modelState = {
    list: () => models.list(),
    visible: (key: { modelID: string; providerID: string }) => models.visible(key),
    current: () => {
      const key = selectedModelKey()
      if (!key) return undefined
      return models.find(key) ?? undefined
    },
    set: (key: { modelID: string; providerID: string } | undefined) => {
      if (key) {
        setModelStore(reconcile({ providerID: key.providerID, modelID: key.modelID }))
      } else {
        setModelStore(reconcile({}))
      }
    },
    ready: models.ready,
    recent: (() => []) as ReturnType<typeof useLocal>["model"]["recent"],
    variant: {
      configured: () => undefined as string | undefined,
      selected: () => undefined as string | undefined,
      current: () => undefined as string | undefined,
      list: () => [] as string[],
      set: (_value: string | undefined) => {},
      cycle: () => {},
    },
    cycle: () => {},
    setVisibility: models.setVisibility,
  }

  // 当前 session 元数据（标题等）
  const [sessionInfo, { refetch: refetchSession }] = createResource(
    () => params.id ?? "",
    async (id) => {
      if (!id) return null as Session | null
      try {
        const result = await globalSDK.client.session.get({ sessionID: id })
        return (result.data as Session | undefined) ?? null
      } catch {
        return null as Session | null
      }
    },
  )

  // 标题编辑状态
  const [titleState, setTitleState] = createStore({
    editing: false,
    draft: "",
    menuOpen: false,
  })
  let titleRef: HTMLInputElement | undefined

  function openTitleEditor() {
    const info = sessionInfo()
    setTitleState({ editing: true, draft: sessionTitle(info?.title) ?? "" })
    requestAnimationFrame(() => titleRef?.focus())
  }

  async function saveTitleEditor() {
    const id = params.id
    if (!id) return
    const draft = titleState.draft.trim()
    if (!draft) { setTitleState("editing", false); return }
    try {
      await globalSDK.client.session.update({ sessionID: id, title: draft })
      void refetchSession()
    } catch (err) {
      showToast({ title: "重命名失败", description: err instanceof Error ? err.message : String(err) })
    }
    setTitleState("editing", false)
  }

  // 删除对话
  async function deleteSession(sessionID: string) {
    try {
      await globalSDK.client.session.delete({ sessionID })
      navigate("/make")
    } catch (err) {
      showToast({ title: "删除失败", description: err instanceof Error ? err.message : String(err) })
    }
  }

  function handleDeleteSession() {
    const id = params.id
    if (!id) return
    dialog.show(() => <MakeDialogDeleteSession sessionID={id} name={sessionTitle(sessionInfo()?.title) ?? "Octo Make"} onDelete={deleteSession} />)
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
        if (id) layout.lastSessionPerTab.setCowork(id, "make")
        setSending(false)
      },
    ),
  )

  createEffect(
    on(
      () => params.id,
      async (id) => {
        if (!id) return
        try {
          const result = await globalSDK.client.session.messages({ sessionID: id })
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
        } catch (err) {
          console.error("[InsightPage] messages load failed", err)
        }
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
      const result = Binary.search(messages, info.id, (m) => m.id)
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
      const result = Binary.search(parts, part.id, (p) => p.id)
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
      const result = Binary.search(parts, partID, (p) => p.id)
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
  const [selectedDesignSystem, setSelectedDesignSystem] = createSignal<string | null>(null)
  // 对话面板宽度：从 localStorage 恢复，无存储值时取约 45% 可用宽
  const CHAT_WIDTH_KEY = "octo:make:chat-width"
  function getInitialChatWidth(): number {
    const stored = localStorage.getItem(CHAT_WIDTH_KEY)
    if (stored) {
      const n = parseInt(stored, 10)
      if (!isNaN(n) && n >= 240) return n
    }
    return Math.max(360, Math.floor((window.innerWidth - 240) * 0.45))
  }
  const [chatWidth, setChatWidth] = createSignal(getInitialChatWidth())

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
      setChatWidth(Math.max(240, Math.min(Math.floor(window.innerWidth * 0.45), startWidth + ev.clientX - startX)))
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

  const tabStore = createTabStore()

  // 自动滚动：session busy 时保持对话区随新内容跟随到底部
  const autoScroll = createAutoScroll({ working: isBusy })

  // Bug 修复 B：切换 session 时重置 ResultViewer 的 Tabs
  createEffect(on(() => params.id, () => { tabStore.reset() }, { defer: true }))

  async function handleContentChange(tabId: string, content: string) {
    tabStore.updateTabContent(tabId, content)
    const tab = tabStore.tabs().find((t) => t.id === tabId)
    if (tab?.filePath) {
      try {
        const dir = homeDir()
        if (dir) {
          await fetch(`${globalSDK.url}/content`, {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              "x-opencode-directory": dir,
            },
            body: JSON.stringify({ path: tab.filePath, content }),
          })
        }
      } catch (err) {
        console.error("[MakePage] failed to save file:", err)
      }
    }
  }

  // ── session 操作 ──────────────────────────────────────────

  async function createAndNavigate(): Promise<string | undefined> {
    const dir = homeDir()
    console.log("[MakePage] createAndNavigate dir:", dir)
    if (!dir) return
    setSending(true)
    try {
      const result = await globalSDK.client.session.create({ directory: dir, agent: "octo_make" })
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

  async function sendMessage(sessionId: string, text: string) {
    try {
      const fileParts: FilePartInput[] = attachments().map((a) => ({
        type: "file",
        mime: a.mime,
        filename: a.filename,
        url: a.dataUrl,
      }))
      let promptText = text

      // Design system prompt injection
      const dsId = selectedDesignSystem()
      if (dsId) {
        try {
          const ds = await loadDesignSystem(dsId)
          promptText = [
            `[Design System: ${dsId}]`,
            `The active design system is "${dsId}". Its full specification follows.`,
            `You MUST:`,
            `1. Paste the :root CSS custom properties block below VERBATIM as the FIRST thing inside your <style> tag`,
            `2. Use var(--fg), var(--bg), var(--accent), var(--surface), var(--border), var(--font-display), var(--font-body), var(--radius-*), var(--elev-*) etc. throughout your CSS instead of hard-coded colors/values`,
            `3. Follow the DESIGN.md rules for component styling, typography hierarchy, spacing, shadows, and radius`,
            `4. Do NOT invent CSS variables that don't exist in the :root block below`,
            ``,
            `## DESIGN.md (authoritative visual rules)`,
            ds.design,
            ``,
            `## :root tokens (paste verbatim into <style>)`,
            "```css",
            ds.tokens,
            "```",
            "",
            `---`,
            text,
          ].join("\n")
        } catch (err) {
          console.error("[MakePage] design system load failed", err)
        }
      }

      const textPart: TextPartInput = { type: "text", text: promptText }
      const modelKey = selectedModelKey()
      await globalSDK.client.session.prompt({
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

  async function handleSubmit() {
    const text = prompt().trim()
    if (!text || sending()) return
    setSending(true)
    setPrompt("")
    const submitSessionId = params.id
    try {
      let sid = submitSessionId
      if (!sid) {
        const dir = homeDir()
        if (!dir) return
        const result = await globalSDK.client.session.create({ directory: dir, agent: "octo_make" })
        const session = result.data as Session | undefined
        if (!session) return
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
    <DataProvider data={dataStore} directory={homeDir() || ""}>
      <div class="size-full flex overflow-hidden relative">

        {/* ── 左栏：对话面板（固定宽度，始终可拖拽） ──── */}
        <div
          class="flex flex-col overflow-hidden flex-shrink-0"
          style={{
            width: `${chatWidth()}px`,
            flex: "0 0 auto",
            background: isDragOver() ? "var(--octo-brand-a3)" : "var(--octo-shell-bg)",
            outline: isDragOver() ? "inset 0 0 0 2px var(--octo-brand-a25)" : "none",
          }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
            {/* 标题栏 */}
            <Show when={params.id}>
              <div
                class="shrink-0 h-12 flex items-center justify-between px-4"
                style={{ "border-bottom": "1px solid var(--octo-border-divider)" }}
              >
                <div class="flex items-center gap-2 min-w-0 flex-1 pr-3">
                  <Show when={isBusy()}>
                    <div class="shrink-0">
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
                      class="text-14-medium text-text-strong truncate min-w-0"
                      onDblClick={openTitleEditor}
                    >
                      {sessionTitle(sessionInfo()?.title) ?? "Octo Make"}
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
                    as={IconButton}
                    icon="dot-grid"
                    variant="ghost"
                    class="size-6 rounded-md data-[expanded]:bg-surface-base-active"
                    aria-label={language.t("common.moreOptions")}
                  />
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content style={{ "min-width": "104px" }}>
                      <DropdownMenu.Item
                        onSelect={() => {
                          setTitleState("menuOpen", false)
                          openTitleEditor()
                        }}
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
            </Show>
            {/* 消息列表（autoScroll 挂在 scrollRef 容器，contentRef 挂在内容 div） */}
            <div
              class="flex-1 overflow-y-auto min-h-0"
              ref={autoScroll.scrollRef}
              onScroll={autoScroll.handleScroll}
              onMouseUp={autoScroll.handleInteraction}
            >
              <Show
                when={params.id && userMessages().length > 0}
                fallback={<ChatEmptyState />}
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
            <div class="shrink-0 p-4">
              <AttachmentBar
                attachments={attachments()}
                onRemove={removeAttachment}
              />

              <div
                class="rounded-[var(--octo-radius-lg)] overflow-hidden"
                style={{
                  background: "var(--octo-surface-page)",
                  "box-shadow": "0 2px 12px rgba(0, 0, 0, 0.08)",
                  "margin-top": attachments().length > 0 ? "6px" : "0",
                }}
              >
                <textarea
                  value={prompt()}
                  onInput={(e) => setPrompt(e.currentTarget.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="输入指令，按 Enter 发送…"
                  rows={3}
                  disabled={inputDisabled()}
                  class="w-full resize-none px-3 pt-2.5 pb-2 bg-transparent text-sm outline-none"
                  style={{
                    color: inputDisabled() ? "var(--octo-text-disabled)" : "var(--octo-text-primary)",
                    "font-family": "var(--octo-font)",
                    "max-height": "120px",
                    "overflow-y": "auto",
                  }}
                />

                <div class="flex items-center justify-between px-2.5 pb-2.5">
                  <div class="flex items-center gap-1">
                    <DesignSystemPicker
                      selected={selectedDesignSystem()}
                      onSelect={setSelectedDesignSystem}
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
                      class="flex items-center gap-1 px-2 py-1 text-xs transition-colors octo-btn-attachment"
                      title={maxAttachments() ? "最多 5 个文件" : "添加附件"}
                    >
                      <IconAttach size={14} />
                    </button>
                    <ModelSelectorPopover
                      model={modelState}
                      triggerAs={Button}
                      triggerProps={{
                        variant: "ghost",
                        size: "normal",
                        class: "min-w-0 max-w-[320px] text-13-regular text-text-base group",
                        "data-action": "prompt-model",
                      }}
                    >
                      <span class="truncate">
                        {modelState.current()?.name ?? "选择模型"}
                      </span>
                      <Icon name="chevron-down" size="small" class="shrink-0" />
                    </ModelSelectorPopover>
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleSubmit()}
                    disabled={!prompt().trim() || inputDisabled()}
                    class="octo-btn-send flex-shrink-0"
                  >
                    {sending() ? "…" : <IconSend size={14} />}
                  </button>
                </div>
              </div>
            </div>

        </div>

        {/* ── 聊天/结果 拖拽分隔线（半侧贴边胶囊） */}
        <div
          class="absolute top-0 bottom-0 flex items-center justify-center group"
          style={{ left: `${chatWidth() - 10}px`, width: "20px", cursor: "col-resize", "z-index": 10 }}
          onMouseDown={handleDividerMouseDown}
        >
          <div
            class="absolute right-[10px] flex items-center justify-center bg-white transition-shadow duration-200"
            style={{
              width: "12px",
              height: "36px",
              "border-radius": "10px 0 0 10px",
              "box-shadow": "-2px 0 4px rgba(0,0,0,0.04), inset 1px 0 0 rgba(0,0,0,0.02)",
              border: "1px solid var(--octo-border-divider)",
              "border-right": "none",
            }}
          >
            <div
              class="w-[2px] h-[14px] rounded-full mr-[2px]"
              style={{ background: "var(--octo-border-input, #c9c9c9)" }}
            />
          </div>
        </div>

        {/* ── 中栏：ResultViewer（始终渲染，无 tab 时显示空态） */}
        <ResultViewer
          tabs={tabStore.tabs()}
          activeId={tabStore.activeId()}
          onActivate={tabStore.activate}
          onClose={tabStore.closeTab}
          onContentChange={handleContentChange}
        />

        {/* ── 右栏：Workspace 占位 (P2) ──────────────── */}
        <div />
      </div>
    </DataProvider>
  )
}

function ChatEmptyState(): JSX.Element {
  return (
    <div class="size-full flex flex-col items-center justify-center gap-3 text-center px-8">
      <IllustrationInsightEmpty width={120} height={120} />
      <div class="text-[15px] font-semibold" style={{ color: "var(--octo-text-strong)" }}>Octo Make</div>
      <div class="text-[13px] max-w-[200px] leading-relaxed" style={{ color: "var(--octo-text-secondary)" }}>
        描述需求，开始生成原型
      </div>
    </div>
  )
}

function MakeDialogDeleteSession(props: { sessionID: string; name: string; onDelete: (id: string) => Promise<void> }): JSX.Element {
  const language = useLanguage()
  const dialog = useDialog()
  return (
    <Dialog title={language.t("session.delete.title")} fit>
      <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
        <span class="text-14-regular text-text-strong">
          {language.t("session.delete.confirm", { name: props.name })}
        </span>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="large" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            size="large"
            onClick={() => void props.onDelete(props.sessionID).then(() => dialog.close())}
          >
            {language.t("session.delete.button")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
