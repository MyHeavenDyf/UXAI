import "./pattern-tokens.css"
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
} from "solid-js"
import { createStore } from "solid-js/store"
import { useNavigate, useParams } from "@solidjs/router"
import { useGlobalSync } from "@/context/global-sync"
import { SDKProvider, useSDK } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"
import { LocalProvider, useLocal } from "@/context/local"
import { useLayout } from "@/context/layout"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { type Attachment } from "./modules/chat/attachment_bar"
import { type OutputCard } from "./modules/chat/insight-turn"
import { runProtoTriage } from "./agents/proto_triage"
import proto_intent from "./agents/proto_intent"
import proto_intent_audit from "./agents/proto_intent_audit"
import proto_planner_create from "./agents/proto_planner_create"
import proto_module_create from "./agents/proto_module_create"
import { getDesignMap, readDesignFile } from "./design/load_design"
import create_json from './workflow/create_json'
import { runProtoPlannerModify } from "./agents/proto_planner_modify"
import { runModuleModify } from "./agents/proto_module_modify"
import { mergeModules } from "./agents/merge"
import { buildIntentPrompt, detectCatalog, detectA2UIJson, type ComponentCatalog } from "./utils/a2ui-protocol"
import { ProtoIntroduction } from './modules/chat/proto_introduction'
import { PreviewPage, type PreviewPageAPI } from "./modules/preview/index"
import { ChatPanel } from "./modules/chat/index"

const AGENT_NAME = "proto_triage"

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

  async function deleteSession(sessionID: string) {
    try {
      await sdk.client.session.delete({ sessionID })
      navigate("/pattern")
    } catch (err) {
      showToast({ title: "删除失败", description: err instanceof Error ? err.message : String(err) })
    }
  }

  createEffect(
    on(
      () => params.id,
      (id, prevId) => {
        if (id) layout.lastSessionPerTab.setPattern(id)
        if (prevId !== undefined) {
          setSending(false)
          setPhase("idle")
        }
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
  const [lastIntent, setLastIntent] = createSignal<Record<string, unknown> | null>(null)
  const [lastPlanner, setLastPlanner] = createSignal<Record<string, unknown> | null>(null)
  const [lastModules, setLastModules] = createSignal<Array<Record<string, unknown>>>([])
  const getModuleResults = () => {
    const mods = lastModules()
    return mods.length > 0 ? mods as unknown as Record<string, unknown> : null
  }
  const hasContent = () => !!(params.id && (userMessages().length > 0 || phase() !== "idle"))
  const [pickerDialog, setPickerDialog] = createStore<{ domPickerId: string; tagName: string }>({ domPickerId: "", tagName: "" })
  const [pickerText, setPickerText] = createSignal("")

  function unfreezeDomPicker() {
    previewApi.postMessage({ type: "DOM_PICKER_UNFREEZE" })
  }

  function showPickerDialog() {
    dialog.show(() => (
      <Dialog title="修改选中区域" fit>
        <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
          <span class="text-14-regular text-text-strong">
            选中元素: <b>{pickerDialog.tagName}</b> ({pickerDialog.domPickerId})
          </span>
          <div class="flex gap-2">
            <button class="px-3 py-1 rounded-full text-13-medium transition-colors bg-primary text-on-primary">
              AI 修改
            </button>
          </div>
          <textarea
            value={pickerText()}
            onInput={(e) => setPickerText(e.currentTarget.value)}
            placeholder="描述你想要的修改..."
            rows={3}
            class="w-full resize-none rounded-md border border-divider px-3 py-2 text-14-regular text-text-strong outline-none focus:border-primary"
          />
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              取消
            </Button>
            <Button variant="primary" size="large" onClick={submitPicker}>
              确认修改
            </Button>
          </div>
        </div>
      </Dialog>
    ), unfreezeDomPicker)
  }

  const handlePickerMessage = (e: MessageEvent) => {
    if (e.data?.type !== "DOM_PICKER_CONTEXT_MENU") return
    setPickerDialog({ domPickerId: e.data.domPickerId ?? "", tagName: e.data.tagName ?? "" })
    setPickerText("")
    showPickerDialog()
  }
  window.addEventListener("message", handlePickerMessage)
  onCleanup(() => window.removeEventListener("message", handlePickerMessage))

  function submitPicker() {
    const text = pickerText().trim()
    if (!text) return
    setPrompt(`[选中元素: ${pickerDialog.domPickerId}] ${text}`)
    dialog.close()
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
    fetch("http://127.0.0.1:8989/api/data", {
      method: "POST",
      body: JSON.stringify(data),
    }).then(() => {
      previewApi.refresh()
    })
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
        navigate(`/pattern/${session.id}`)
        sid = session.id
      }

      const existing = sessionInfo()?.title
      if (!existing || existing.startsWith("New session")) {
        await sdk.client.session.update({ sessionID: sid, title: text.slice(0, 60) }).catch(() => { })
      }

      const ctx = {
        sdk: { client: sdk.client },
        directory: sdk.directory,
        modelKey: mk,
        parentSessionId: sid,
        abortSignal: controller.signal,
      }

      let intentCtx = {
        sdk: sdk,
        sync: sync,
        modelKey: mk,
        rootSession: sid,
        userInput: text
      }

      // ── Step 0: triage → 判断首次还是修改 ──
      const isEdit = !!lastIntent()
      const currentPlanner = lastPlanner()
      console.log("[Pattern] 进入代理: proto_triage")
      const triage = await runProtoTriage({
        sdk: { client: sdk.client },
        directory: sdk.directory!,
        modelKey: mk,
        userRequest: text,
        genuiJson: isEdit ? (lastIntent() ?? {}) : null,
        layoutPlanner: currentPlanner,
        moduleResults: getModuleResults(),
        sessionId: isEdit ? sid : undefined,
        abortSignal: controller.signal,
      })
      console.log("[Pattern] triage:", triage.routing, triage.reason)
      console.log("[Pattern] triage output:", JSON.stringify(triage, null, 2))

      if (triage.routing === "modify") {
        debugger
        if (!currentPlanner || !lastIntent()) {
          console.log("[Pattern] modify skipped: no previous page state")
          return
        }
        setPhase("planner")
        console.log("[Pattern] 进入代理: proto_planner_modify")
        const modifyResult = await runProtoPlannerModify({
          ...ctx,
          input: {
            intentReason: triage.reason,
            intentDelete: triage.delete,
            intentAdd: triage.add,
            intentModify: triage.modify,
            intentPage: triage.updated_intent,
            layoutPlanner: currentPlanner,
          },
        })
        console.log("[Pattern] planner_modify done, slots:", modifyResult.output.slots.length)
        console.log("[Pattern] planner_modify output:", JSON.stringify(modifyResult, null, 2))
        console.log("[Pattern] removed sections:", modifyResult.removedSectionIds)

        const updatedIntent = { ...lastIntent(), ...triage.updated_intent }
        const prevModules = lastModules()

        setPhase("module")
        const allModules: typeof prevModules = []

        for (const slot of modifyResult.output.slots) {
          if (slot.operation === "none") {
            const existing = prevModules.find((m) => m.rootId === slot.element_id)
            if (existing) allModules.push(existing)
            continue
          }
          if (slot.operation === "create") {
            console.log("[Pattern] 进入代理: proto_module_create (modify/create)")
            const moduleResult = await proto_module_create({
              ...intentCtx,
              idPrefix: slot.id_prefix,
              sectionId: slot.section_id,
              elementId: slot.element_id,
              layoutPlanner: modifyResult.output as unknown as Record<string, unknown>,
              intentDescription: updatedIntent as any,
            })
            allModules.push(moduleResult.uiJson as typeof prevModules[number])
            continue
          }
          if (slot.operation === "modify") {
            const originModule = prevModules.find((m) => m.rootId === slot.element_id)
            const modAction = triage.modify.find((m) => m.section_id === slot.section_id)
            if (!originModule || !modAction) continue
            console.log("[Pattern] 进入代理: proto_module_modify")
            const moduleResult = await runModuleModify({
              ...ctx,
              input: {
                layoutPlanner: modifyResult.output as unknown as Record<string, unknown>,
                idPrefix: slot.id_prefix,
                sectionId: slot.section_id,
                originModules: originModule,
                modifications: modAction as unknown as Record<string, unknown>,
              },
            })
            allModules.push(moduleResult.uiJson as typeof prevModules[number])
          }
        }

        const merged = mergeModules(
          { rootId: modifyResult.output.rootId, elements: modifyResult.output.elements },
          allModules,
        )
        console.log("[Pattern] ========== MERGED A2UI JSON ==========")
        console.log(JSON.stringify(merged, null, 2))
        const mergedJson = detectA2UIJson(JSON.stringify(merged))
        if (mergedJson) sendToPreview(mergedJson)

        setLastIntent(updatedIntent as unknown as Record<string, unknown>)
        setLastPlanner(modifyResult.output as unknown as Record<string, unknown>)
        setLastModules(allModules)

        return
      }
      setPhase("intent")

      debugger
      // 第一步：意图扩展
      let intentResult = await proto_intent(intentCtx)
      
      // 第二步：意图检查 - 最多进行N(当前1)次审查
      // for (let attempt = 0; attempt < 1; attempt++) {
      //   let descriptionStr = JSON.stringify(intentResult.intent_description);
      //   const audit = await proto_intent_audit({ ...intentCtx, intentDescription: descriptionStr });
      //   if (audit.intent_audit_pass) break;
      //   intentResult = await proto_intent({
      //     ...intentCtx,
      //     auditFeedback: audit.intent_audit_feedback as string,
      //     intentAuditPass: audit.intent_audit_pass as boolean,
      //     pageDescription: descriptionStr
      //   })
      // }
      
      // 第三步：页面局部
      let pageDescriptionStr = JSON.stringify(intentResult.intent_description);
      const planner = await proto_planner_create({ ...intentCtx, intentDescription: pageDescriptionStr });
      
      debugger
      // 第四部：并行生成 A2UI JSON
      const modules = await Promise.all(
        (planner.layout_planner.slots as Array<any>).map(slot =>
          proto_module_create({
            ...intentCtx,
            idPrefix: slot.id_prefix,
            sectionId: slot.section_id,
            elementId: slot.element_id,
            layoutPlanner: planner.layout_planner,
            intentDescription: intentResult.intent_description
          }).then(r => r.ui_json)
        )
      )
      
      const merged = mergeModules(
        { rootId: planner.layout_planner.rootId, elements: planner.layout_planner.elements },
        modules,
      )

      // 第五步：合并顶层布局和各模块JSON
      // for (let i = 0; i < planner.slots.length; i++) {
      //   const slot = planner.slots[i]
      //   const mod = await import(`./slot${i + 1}.json`)
      //   const uiJson = mod.default.rootId && mod.default.elements ? mod.default : mod.default.uiJson
      //   if (uiJson.rootId !== slot.element_id) {
      //     const target = (uiJson.elements as Array<{ id: string }>)?.find((e) => e.id === uiJson.rootId)
      //     if (target) {
      //       target.id = slot.element_id
      //       uiJson.rootId = slot.element_id
      //     }
      //   }
      //   modules.push(uiJson)
      // }
      debugger
      
      console.log("[Pattern] ========== MERGED A2UI JSON ==========")
      console.log(JSON.stringify(merged, null, 2))
      const mergedJson = detectA2UIJson(JSON.stringify(merged))
      if (mergedJson) sendToPreview(mergedJson)

      setLastIntent(intentResult.intent_page as unknown as Record<string, unknown>)
      setLastPlanner(planner as unknown as Record<string, unknown>)
      setLastModules(modules)

      const genDuration = (performance.now() - genStartTime).toFixed(0)
      console.log(`[Pattern] 第一次生成页面耗时: ${genDuration}ms`)
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
    await sdk.client.session.abort({ sessionID: sid }).catch(() => { })
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
    if (doc) sendToPreview(doc)
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
            onDeleteSession={deleteSession}
            onTitleChanged={() => void refetchSession()}
          />
        </Show>

        <Show when={hasContent() && !focusMode()}>
          <div class="octo-split-handle" onMouseDown={handleDividerMouseDown} />
        </Show>

        {/* 预览页 */}
        <Show when={hasContent()}>
          <PreviewPage api={previewApi} />
        </Show>
      </div>
    </DataProvider>
  )
}

