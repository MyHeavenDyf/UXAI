import "./pattern-tokens.css"
import type { Message, Part, Session, SessionStatus } from "@opencode-ai/sdk/v2/client"
import { DataProvider } from "@opencode-ai/ui/context/data"
import { createAutoScroll } from "@opencode-ai/ui/hooks"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { InlineInput } from "@opencode-ai/ui/inline-input"
import { showToast, Toast } from "@opencode-ai/ui/toast"
import { useDialog } from "@opencode-ai/ui/context/dialog"
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
import { createStore, reconcile } from "solid-js/store"
import { useNavigate, useParams } from "@solidjs/router"
import { useGlobalSync } from "@/context/global-sync"
import { SDKProvider, useSDK } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"
import { LocalProvider, useLocal } from "@/context/local"
import { useLayout } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { octoSessionsDir } from "@/hooks/use-project-dir"
import { sessionTitle } from "@/utils/session-title"
import { AttachmentBar, type Attachment } from "./components/attachment-bar"
import { InsightTurn, type OutputCard } from "./components/insight-turn"
import { DesignSystemPicker } from "./components/design-system-picker"
import { Spinner } from "@opencode-ai/ui/spinner"
import { Icon } from "@opencode-ai/ui/icon"
import { ModelSelectorPopover } from "@/components/dialog-select-model"
import { runProtoTriage } from "./agents/proto_triage"
import { runProtoIntent } from "./agents/proto_intent"
import { runProtoIntentAudit } from "./agents/proto_intent_audit"
import { runProtoPlannerCreate } from "./agents/proto_planner_create"
import { runProtoModuleCreate } from "./agents/proto_module_create"
import { mergeModules } from "./agents/merge"
import { buildIntentPrompt, detectCatalog, detectA2UIJson, type ComponentCatalog } from "./utils/a2ui-protocol"

const AGENT_NAME = "octo_pattern_intent"

export default function PatternPage() {
  const globalSync = useGlobalSync()
  const homeDir = () => globalSync.data.path.home

  return (
    <Show when={homeDir()} keyed>
      {(dir) => (
        <SDKProvider directory={() => dir}>
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

function PatternContent() {
  const params = useParams<{ id?: string }>()
  const navigate = useNavigate()
  const sdk = useSDK()
  const sync = useSync()
  const layout = useLayout()
  const language = useLanguage()
  const dialog = useDialog()
  const globalSync = useGlobalSync()

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

  const [titleState, setTitleState] = createStore({
    editing: false,
    draft: "",
    menuOpen: false,
    pendingRename: false,
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
      await sdk.client.session.update({ sessionID: id, title: draft })
      void refetchSession()
    } catch (err) {
      showToast({ title: "重命名失败", description: err instanceof Error ? err.message : String(err) })
    }
    setTitleState("editing", false)
  }

  async function deleteSession(sessionID: string) {
    try {
      await sdk.client.session.delete({ sessionID })
      navigate("/pattern")
    } catch (err) {
      showToast({ title: "删除失败", description: err instanceof Error ? err.message : String(err) })
    }
  }

  function handleDeleteSession() {
    const id = params.id
    if (!id) return
    dialog.show(() => <PatternDialogDeleteSession sessionID={id} name={sessionTitle(sessionInfo()?.title) ?? "Pattern"} onDelete={deleteSession} />)
  }

  createEffect(
    on(
      () => params.id,
      (id) => {
        if (id) layout.lastSessionPerTab.setPattern(id)
        setSending(false)
        setPhase("idle")
        requestAnimationFrame(() => autoScroll.forceScrollToBottom())
      },
    ),
  )

  createEffect(
    on(
      () => params.id,
      (id) => {
        if (!id) return
        void sync.session.sync(id)
      },
    ),
  )

  const userMessages = createMemo((): Message[] => {
    const id = params.id
    if (!id) return []
    return ((sync.data.message[id] ?? []) as Message[]).filter((m) => m.role === "user")
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
    const msgs = (sync.data.message[id] ?? []) as Message[]
    const lastAssistant = msgs.findLast((m) => m.role === "assistant")
    return !!lastAssistant && typeof lastAssistant.time.completed !== "number"
  })

  const [prompt, setPrompt] = createSignal("")
  const [sending, setSending] = createSignal(false)
  const [phase, setPhase] = createSignal<"idle" | "intent" | "audit" | "planner" | "module">("idle")
  const [detectedCatalog, setDetectedCatalog] = createSignal<ComponentCatalog>("desktop")
  const [attachments, setAttachments] = createSignal<Attachment[]>([])
  const [isDragOver, setIsDragOver] = createSignal(false)
  const [selectedDesignSystem, setSelectedDesignSystem] = createSignal<string | null>(null)
  const hasContent = () => !!(params.id && userMessages().length > 0)

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

  let previewIframeRef: HTMLIFrameElement | undefined
  let previewPaneRef: HTMLDivElement | undefined
  const [previewScale, setPreviewScale] = createSignal(1)

  const TARGET_WIDTH = 1920
  const TARGET_HEIGHT = 1080

  function updatePreviewScale() {
    if (!previewPaneRef) return
    const containerWidth = previewPaneRef.clientWidth - 40
    const containerHeight = previewPaneRef.clientHeight - 40
    const scaleX = containerWidth / TARGET_WIDTH
    const scaleY = containerHeight / TARGET_HEIGHT
    setPreviewScale(Math.min(scaleX, scaleY, 1))
  }

  let previewResizeObserver: ResizeObserver | undefined
  onCleanup(() => previewResizeObserver?.disconnect())

  function bindPreviewPaneRef(el: HTMLDivElement) {
    previewPaneRef = el
    updatePreviewScale()
    previewResizeObserver?.disconnect()
    previewResizeObserver = new ResizeObserver(() => updatePreviewScale())
    previewResizeObserver.observe(el)
  }

  function sendToPreview(data: unknown) {
    if (!previewIframeRef?.contentWindow) return
    previewIframeRef.contentWindow.postMessage({ type: "A2UI_UPDATE", payload: data }, "*")
  }

  function getLastAssistantText(sessionId: string): string | null {
    const messages = (sync.data.message[sessionId] ?? []) as Message[]
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.role !== "assistant") continue
      const parts = (sync.data.part[msg.id] ?? []) as Array<{ type: string; text?: string }>
      for (const p of [...parts].reverse()) {
        if (p.type === "text" && p.text) return p.text
      }
    }
    return null
  }

  function extractJsonFromText(text: string): Record<string, unknown> | null {
    try {
      const raw = text.includes("```json")
        ? text.match(/```json\s*\n([\s\S]*?)\n?```/)?.[1] ?? text
        : text
      const parsed = JSON.parse(raw.trim())
      if (parsed && typeof parsed === "object") return parsed
    } catch {}
    return null
  }

  async function waitForAssistant(sessionId: string, signal: AbortSignal): Promise<string> {
    while (!signal.aborted) {
      await new Promise((r) => setTimeout(r, 2000))
      if (signal.aborted) throw new Error("aborted")
      try {
        const res = await sdk.client.session.messages({ sessionID: sessionId, limit: 10 })
        const items = res.data as Array<{ info: Message; parts: Part[] }> | undefined
        if (!items) continue
        for (let i = items.length - 1; i >= 0; i--) {
          const msg = items[i].info
          if (msg.role !== "assistant") continue
          if (msg.time.completed == null) continue
          const parts = items[i].parts
          for (let j = parts.length - 1; j >= 0; j--) {
            // @ts-ignore
            if (parts[j].type === "text" && parts[j].text) return parts[j].text
          }
        }
      } catch (err) {
        console.warn("[Pattern] poll error:", err)
      }
    }
    throw new Error("aborted")
  }

  async function callSubAgent(parentSid: string, agentName: string, promptText: string, signal: AbortSignal): Promise<string> {
    const modelKey = activeModelKey()
    if (!modelKey) throw new Error("no model")

    const childResult = await sdk.client.session.create({
      directory: sdk.directory!,
      parentID: parentSid,
      agent: agentName,
    })
    const childSession = childResult.data as Session | undefined
    if (!childSession) throw new Error("failed to create child session")

    await sdk.client.session.promptAsync({
      sessionID: childSession.id,
      agent: agentName,
      ...(modelKey ? { model: modelKey } : {}),
      parts: [{ type: "text", text: promptText }],
    })

    const text = await waitForAssistant(childSession.id, signal)
    return text
  }

  async function handleSubmit() {
    const text = prompt().trim()
    if (!text || sending() || !activeModelKey()) return
    console.log("开始--------------------", text)
    setSending(true)
    setPrompt("")
    const submitSessionId = params.id
    const controller = new AbortController()
    const mk = activeModelKey()!
    try {
      let sid = submitSessionId
      if (!sid) {
        const dir = sdk.directory
        if (!dir) { console.log("[Pattern] no directory, abort"); return }
        const result = await sdk.client.session.create({ directory: dir, agent: AGENT_NAME })
        const session = result.data as Session | undefined
        if (!session) { console.log("[Pattern] session.create returned no session"); return }
        navigate(`/pattern/${session.id}`)
        sid = session.id
      }

      const existing = sessionInfo()?.title
      if (!existing || existing.startsWith("New session")) {
        await sdk.client.session.update({ sessionID: sid, title: text.slice(0, 60) }).catch(() => {})
      }

      const ctx = {
        sdk: { client: sdk.client },
        directory: sdk.directory!,
        modelKey: mk,
        parentSessionId: sid,
        abortSignal: controller.signal,
      }

      // ── Step 0: triage → 判断首次还是修改 ──
      const existingText = getLastAssistantText(sid)
      const genuiJson = existingText ? extractJsonFromText(existingText) : null
      debugger
      const triage = await runProtoTriage({
        sdk: { client: sdk.client },
        directory: sdk.directory!,
        modelKey: mk,
        userRequest: text,
        genuiJson,
        layoutPlanner: null,
        moduleResults: null,
        abortSignal: controller.signal,
      })
      console.log("[Pattern] triage:", triage.routing, triage.reason)
      console.log("[Pattern] triage output:", JSON.stringify(triage, null, 2))

      if (triage.routing === "modify") {
        console.log("[Pattern] modify flow (not implemented)")
        setPhase("idle")
        return
      }

      // ── Step 1: proto_intent → 生成蓝图 ──
      setPhase("intent")
      debugger
      const intentResult = await runProtoIntent({ ...ctx, input: { userRequest: text } })

      console.log("[Pattern] intent done, sections:", intentResult.sections.length)
      console.log("[Pattern] intent output:", JSON.stringify(intentResult, null, 2))

      // ── Step 2: proto_intent_audit → 审核（最多重试 2 次）──
      setPhase("audit")
      let currentIntent = intentResult
      for (let attempt = 0; attempt < 2; attempt++) {
        debugger
        const audit = await runProtoIntentAudit({
          ...ctx,
          input: { userRequest: text, blueprint: JSON.stringify(currentIntent) },
        })
        console.log("[Pattern] audit:", audit.isPass, audit.feedback.slice(0, 80))
        console.log("[Pattern] audit output:", JSON.stringify(audit, null, 2))
        if (audit.isPass) break
        debugger
        currentIntent = await runProtoIntent({
          ...ctx,
          input: { userRequest: text, previousBlueprint: currentIntent, auditFeedback: audit.feedback },
        })
        console.log("[Pattern] intent retry", attempt + 1)
      }

      // ── Step 3: proto_planner_create → 生成布局 + slots ──
      setPhase("planner")
      debugger

      const planner = await runProtoPlannerCreate({
        ...ctx,
        input: { blueprint: currentIntent as unknown as Record<string, unknown> },
      })
      console.log("[Pattern] planner done, slots:", planner.slots.length)
      console.log("[Pattern] planner output:", JSON.stringify(planner, null, 2))

      const plannerJson = detectA2UIJson(JSON.stringify(planner))
      // if (plannerJson) sendToPreview(plannerJson)

      // ── Step 4: proto_module_create → 逐模块生成 A2UI JSON ──
      setPhase("module")
      const modules: Array<{ rootId: string; elements: Array<{ id: string; component: string; props?: Record<string, unknown>; children?: string[] }>; state?: Record<string, unknown> }> = []
      for (const slot of planner.slots) {
        console.log("[Pattern] module_create:", slot.section_id)
        debugger
        const moduleResult = await runProtoModuleCreate({
          ...ctx,
          input: {
            intentDescription: currentIntent,
            layoutPlanner: planner as unknown as Record<string, unknown>,
            sectionId: slot.section_id,
            elementId: slot.element_id,
            idPrefix: slot.id_prefix,
          },
        })
        console.log("[Pattern] module_create output [" + slot.section_id + "]:", JSON.stringify(moduleResult.uiJson, null, 2))
        console.log(JSON.stringify(moduleResult, null, 2))
        modules.push(moduleResult.uiJson as typeof modules[number])
      }
      const merged = mergeModules(
        { rootId: planner.rootId, elements: planner.elements },
        modules,
      )
      console.log("[Pattern] ========== MERGED A2UI JSON ==========")
      console.log(JSON.stringify(merged, null, 2))
      const mergedJson = detectA2UIJson(JSON.stringify(merged))
      if (mergedJson) sendToPreview(mergedJson)

      setPhase("idle")
      console.log("结束---------------")
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "aborted") return
      console.error("[PatternPage] handleSubmit failed", err)
      setPhase("idle")
    } finally {
      if (!submitSessionId || params.id === submitSessionId) {
        setSending(false)
      }
    }
  }

  async function halt() {
    const sid = params.id
    if (!sid) return
    await sdk.client.session.abort({ sessionID: sid }).catch(() => {})
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      void handleSubmit()
    }
  }

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
    const doc = detectA2UIJson(card.content)
    if (doc) sendToPreview(doc)
  }

  const inputDisabled = () => sending() || isBusy() || !activeModelKey()
  const maxAttachments = () => attachments().length >= 5

  const inputBox = (rows: number | undefined) => (
    <div
      class="rounded-[16px] transition-all duration-300 relative group"
      style={{
        border: "1px solid transparent",
        background: `
          linear-gradient(var(--octo-surface-page), var(--octo-surface-page)) padding-box,
          linear-gradient(135deg,
            rgba(0, 103, 209, 0.7) 1%,
            rgba(46, 134, 222, 0.7) 22%,
            rgba(0, 103, 209, 0.7) 54%,
            rgba(0, 78, 168, 0.7) 87%,
            rgba(0, 103, 209, 0.7) 92%) border-box`,
        "box-shadow": "0 0 5px rgba(0, 0, 0, 0.08), 0 0 10px rgba(0, 103, 209, 0.18), 0 0 20px rgba(0, 78, 168, 0.12)",
        "margin-top": attachments().length > 0 ? "6px" : "0",
        ...(rows === undefined ? { height: "150px" } : {}),
      }}
    >
      <textarea
        value={prompt()}
        onInput={(e) => setPrompt(e.currentTarget.value)}
        onKeyDown={handleKeyDown}
        placeholder="描述你想要的界面，按 Enter 生成 A2UI JSON…"
        rows={rows}
        disabled={inputDisabled()}
        class="w-full resize-none bg-transparent text-14-regular text-text-strong outline-none relative z-10 p-4"
        style={{
          "font-family": "var(--octo-font)",
          ...(rows === undefined ? { flex: "1", "max-height": "none", "overflow-y": "auto" } : { "max-height": "120px", "overflow-y": "auto" }),
        }}
      />
      <div class="flex items-center justify-between px-4 pb-4 relative z-10 overflow-hidden">
        <div class="flex items-center gap-1 min-w-0">
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
            class="flex flex-shrink-0 items-center justify-center size-8 rounded-full transition-colors hover:bg-black/5 active:bg-black/10 text-gray-800 hover:text-black disabled:text-gray-400"
            title={maxAttachments() ? "最多 5 个文件" : "添加附件"}
          >
            <Icon name="plus" class="size-5" />
          </button>
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
  )

  return (
    <DataProvider data={sync.data} directory={sdk.directory || ""}>
      <Toast.Region />
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
                      {sessionTitle(sessionInfo()?.title) ?? "Pattern"}
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
                      <DropdownMenu.Item onSelect={() => { setTitleState("menuOpen", false); openTitleEditor() }}>
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
                  <AttachmentBar attachments={attachments()} onRemove={removeAttachment} />
                  {inputBox(undefined)}
                </div>
              </div>
            }>
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

              <div class="shrink-0" style={{ padding: "24px", background: "#fff" }}>
                <AttachmentBar attachments={attachments()} onRemove={removeAttachment} />
                {inputBox(3)}
              </div>
            </Show>
          </div>
        </Show>

        <Show when={hasContent() && !focusMode()}>
          <div class="octo-split-handle" onMouseDown={handleDividerMouseDown} />
        </Show>

        <Show when={hasContent()}>
          <div ref={bindPreviewPaneRef} class="flex flex-col overflow-hidden" style="position:relative">
            <div class="absolute right-[12px] top-[12px] flex gap-[6px]" style={{ "z-index": 10 }}>
              <button
                class="preview-action-btn"
                title="历史版本"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </button>
              <button
                class="preview-action-btn"
                title="刷新"
                onClick={() => { if (previewIframeRef) previewIframeRef.src = "http://127.0.0.1:8989" }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
              <button
                class="preview-action-btn"
                title="全屏"
                onClick={() => {
                  if (previewPaneRef?.requestFullscreen) previewPaneRef.requestFullscreen()
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                </svg>
              </button>
            </div>
            <div style={{ flex: "1", "min-height": "0", overflow: "hidden", display: "flex", "justify-content": "center", "align-items": "center", padding: "20px", position: "relative" }}>
              <div class="preview-iframe-wrapper" style={{ width: `${TARGET_WIDTH}px`, height: `${TARGET_HEIGHT}px`, transform: `scale(${previewScale()})` }}>
                <iframe
                  ref={(el) => { previewIframeRef = el }}
                  src="http://127.0.0.1:8989"
                />
              </div>
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
      <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
        <rect x="8" y="8" width="64" height="64" rx="16" stroke="var(--octo-brand-a40)" stroke-width="2" fill="none" />
        <rect x="20" y="20" width="16" height="16" rx="4" fill="var(--octo-brand-a20)" />
        <rect x="44" y="20" width="16" height="16" rx="4" fill="var(--octo-brand-a20)" />
        <rect x="20" y="44" width="16" height="16" rx="4" fill="var(--octo-brand-a20)" />
        <rect x="44" y="44" width="16" height="16" rx="4" fill="var(--octo-brand-a20)" />
      </svg>
      <div class="flex flex-col items-center gap-2">
        <div style={{ color: "#191919", "font-size": "24px", "font-weight": "600", "line-height": "36px" }}>Octo Pattern</div>
        <div style={{ color: "#6e737a", "font-size": "14px", "line-height": "20px" }}>
          描述界面需求，生成 A2UI JSON
        </div>
      </div>
    </div>
  )
}

function PatternDialogDeleteSession(props: { sessionID: string; name: string; onDelete: (id: string) => Promise<void> }): JSX.Element {
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

