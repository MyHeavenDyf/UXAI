import "./octo-tokens.css"
import type { Message, Part, Session, SessionStatus, SnapshotFileDiff } from "@opencode-ai/sdk/v2/client"
import type { FilePartInput, TextPartInput } from "@opencode-ai/sdk/v2/client"
import { DataProvider } from "@opencode-ai/ui/context/data"
import { createAutoScroll } from "@opencode-ai/ui/hooks"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
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
import { TemplatePicker } from "./components/template-picker"
import { IconSend } from "./icons"
import IconHost from "@/pages/_shell/icons/IconHost.svg"
import { Spinner } from "@opencode-ai/ui/spinner"
import { Icon } from "@opencode-ai/ui/icon"
import { loadDesignSystem } from "./utils/design-system-loader"
import { loadCrafts } from "./utils/craft-loader"
import { createSnapshotStore } from "./utils/snapshot-store"
import { VersionPanel } from "./components/result-viewer/version-panel"
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
        const dir = homeDir()
        if (id && dir) layout.lastSessionPerTab.setMake(dir, id)
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

      // First time seeing parts for this message — always insert
      if (!parts) {
        setDataStore("part", part.messageID, [part])
        return
      }

      const result = Binary.search(parts, part.id, (p) => p.id)
      if (!result.found) {
        // New part — always insert
        setDataStore("part", part.messageID, produce((d) => { d.splice(result.index, 0, part) }))
      } else {
        // Existing text part during streaming: skip reconcile, let deltas drive the text
        // to avoid duplicated content. Final part.updated (when idle) sets canonical text.
        if (part.type === "text" && isBusy()) return
        setDataStore("part", part.messageID, result.index, reconcile(part))
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
  const hasContent = () => !!(params.id && userMessages().length > 0)

  const [prompt, setPrompt] = createSignal("")
  const [sending, setSending] = createSignal(false)
  const [attachments, setAttachments] = createSignal<Attachment[]>([])
  const [isDragOver, setIsDragOver] = createSignal(false)
  const DS_KEY_PREFIX = "octo:make:design-system:"
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

  const tabStore = createTabStore()
  const snapshotStore = createSnapshotStore(() => params.id)
  const [showVersionPanel, setShowVersionPanel] = createSignal(false)
  const [snapshotList, setSnapshotList] = createSignal<import("./utils/snapshot-store").ArtifactSnapshot[]>([])
  const [snapshotVersion, setSnapshotVersion] = createSignal(0)

  function refreshSnapshots() {
    setSnapshotList(snapshotStore.snapshots())
    setSnapshotVersion((v) => v + 1)
  }

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

  async function halt() {
    const sid = params.id
    if (!sid) return
    await globalSDK.client.session.abort({ sessionID: sid }).catch(() => {})
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
    // Auto-activate composed artifact tab (identifier ends with "-composed")
    if (card.artifactIdentifier?.endsWith("-composed")) {
      tabStore.activate(card.id)
    }
    // Auto-save snapshot when a new result is opened
    const tab = tabStore.tabs().find((t) => t.id === card.id)
    if (tab) {
      snapshotStore.save(tab)
      refreshSnapshots()
    }
  }

  const inputDisabled = () => sending() || isBusy()
  const maxAttachments = () => attachments().length >= 5

  return (
    <DataProvider data={dataStore} directory={homeDir() || ""}>
      <div
        class="octo-split bg-background-base"
        data-focus={focusMode() ? "true" : undefined}
        style={{
          "grid-template-columns": !focusMode()
            ? hasContent()
              ? `${chatWidth()}px 8px minmax(400px, 1fr)`
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
              <div
                class="shrink-0 flex items-center justify-between"
                style={{ padding: "12px 24px", background: "#fff" }}
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
                      class="truncate min-w-0"
                      style={{ "font-size": "14px", "line-height": "22px", "font-weight": "600", color: "#191919" }}
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
            <Show when={hasContent()} fallback={
              <div class="flex-1 flex flex-col items-center justify-center min-h-0">
                <ChatEmptyState />
                <div class="w-full max-w-[800px] px-8">
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
                    <textarea
                      value={prompt()}
                      onInput={(e) => setPrompt(e.currentTarget.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="输入指令，按 Enter 发送…"
                      disabled={inputDisabled()}
                      class="w-full flex-1 resize-none bg-transparent text-14-regular text-text-strong outline-none relative z-10 px-4 pt-3"
                      style={{
                        "font-family": "var(--octo-font)",
                        "overflow-y": "auto",
                      }}
                    />
                    <div class="flex items-center justify-between px-2.5 pb-2.5 relative z-10 overflow-hidden">
                      <div class="flex items-center gap-1 min-w-0">
                        <div class="flex-1 min-w-0">
                          <DesignSystemPicker
                            selected={selectedDesignSystem()}
                            onSelect={setSelectedDesignSystem}
                          />
                        </div>
                        <div class="flex-1 min-w-0">
                          <TemplatePicker
                            onSelect={(content) => setPrompt((prev) => prev ? prev + "\n\n" + content : content)}
                          />
                        </div>
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
                          class="flex flex-shrink-0 items-center justify-center size-8 rounded-full transition-colors hover:bg-black/5 active:bg-black/10 text-gray-800 hover:text-black disabled:text-gray-400"
                          title={maxAttachments() ? "最多 5 个文件" : "添加附件"}
                        >
                          <Icon name="plus" class="size-5" />
                        </button>
                        <ModelSelectorPopover
                          model={modelState}
                          triggerAs="button"
                          triggerProps={{
                            class: "flex items-center gap-1.5 min-w-0 max-w-[200px] bg-[#f3f3f3] hover:bg-[#e8e8e8] active:bg-[#dedede] transition-colors px-3 py-1.5 rounded-full text-[13px] text-gray-800 font-medium group overflow-hidden",
                            "data-action": "prompt-model",
                          }}
                        >
                          <span class="truncate">
                            {modelState.current()?.name ?? "选择模型"}
                          </span>
                          <Icon name="chevron-down" class="size-3.5 shrink-0 opacity-60" />
                        </ModelSelectorPopover>
                      </div>
                      <button
                        type="button"
                        onClick={isBusy() ? () => void halt() : () => void handleSubmit()}
                        disabled={!isBusy() && (!prompt().trim() || inputDisabled())}
                        class="octo-btn-send flex-shrink-0"
                        classList={{ "octo-btn-stop": isBusy() }}
                        title={isBusy() ? "停止生成" : undefined}
                      >
                        {isBusy() ? <Icon name="stop" size="small" /> : (sending() ? "…" : <IconSend size={14} />)}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            }>
              {/* 消息列表 */}
              <ScrollView
                class="flex-1 min-h-0"
                style={{ background: "#fff" }}
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
                        onOpenResult={handleOpenResult}
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
                  <textarea
                    value={prompt()}
                    onInput={(e) => setPrompt(e.currentTarget.value)}
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
                  <div class="flex items-center justify-between px-2.5 pb-2.5 relative z-10 overflow-hidden">
                      <div class="flex items-center gap-1 min-w-0">
                        <div class="flex-1 min-w-0">
                          <DesignSystemPicker
                            selected={selectedDesignSystem()}
                            onSelect={setSelectedDesignSystem}
                          />
                        </div>
                        <div class="flex-1 min-w-0">
                          <TemplatePicker
                            onSelect={(content) => setPrompt((prev) => prev ? prev + "\n\n" + content : content)}
                          />
                        </div>
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
                        class="flex flex-shrink-0 items-center justify-center size-8 rounded-full transition-colors hover:bg-black/5 active:bg-black/10 text-gray-800 hover:text-black disabled:text-gray-400"
                        title={maxAttachments() ? "最多 5 个文件" : "添加附件"}
                      >
                        <Icon name="plus" class="size-5" />
                      </button>
                      <ModelSelectorPopover
                        model={modelState}
                        triggerAs="button"
                        triggerProps={{
                          class: "flex items-center gap-1.5 min-w-0 max-w-[200px] bg-[#f3f3f3] hover:bg-[#e8e8e8] active:bg-[#dedede] transition-colors px-3 py-1.5 rounded-full text-[13px] text-gray-800 font-medium group overflow-hidden",
                          "data-action": "prompt-model",
                        }}
                      >
                        <span class="truncate">
                          {modelState.current()?.name ?? "选择模型"}
                        </span>
                        <Icon name="chevron-down" class="size-3.5 shrink-0 opacity-60" />
                      </ModelSelectorPopover>
                    </div>
                    <button
                      type="button"
                      onClick={isBusy() ? () => void halt() : () => void handleSubmit()}
                      disabled={!isBusy() && (!prompt().trim() || inputDisabled())}
                      class="octo-btn-send flex-shrink-0"
                      classList={{ "octo-btn-stop": isBusy() }}
                      title={isBusy() ? "停止生成" : undefined}
                    >
                      {isBusy() ? <Icon name="stop" size="small" /> : (sending() ? "…" : <IconSend size={14} />)}
                    </button>
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
        <div class="flex flex-col min-w-0 overflow-hidden">
          <div class="flex flex-1 min-h-0 overflow-hidden">
            <div class="flex flex-col flex-1 min-w-0 overflow-hidden">
              {/* 焦点模式 + 版本历史 切换按钮 */}
              <div class="flex items-center justify-end px-2 shrink-0 gap-1" style={{ "min-height": "32px" }}>
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
    <div class="flex flex-col items-center gap-4 text-center pb-8 px-6">
      <img src={IconHost} width={120} height={120} alt="" style={{ "flex-shrink": "0" }} />
      <div class="flex flex-col items-center gap-2">
        <div style={{ color: "#191919", "font-size": "24px", "font-weight": "600", "line-height": "36px" }}>Octo Make</div>
        <div style={{ color: "#6e737a", "font-size": "14px", "line-height": "20px" }}>
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
