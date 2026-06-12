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
import { appendPatternVersion, loadCurrentPatternState, listPatternVersions, type VersionEntry } from "./utils/persist"
import { rollbackToVersion } from "./utils/history"
import { buildIntentPrompt, detectCatalog, detectA2UIJson, type ComponentCatalog } from "./utils/a2ui-protocol"
import { ProtoIntroduction } from './modules/chat/proto_introduction'
import { PreviewPage, type PreviewPageAPI } from "./modules/preview/index"
import { ChatPanel } from "./modules/chat/index"

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

  createEffect(
    on(
      () => params.id,
      (id, prevId) => {
        if (id) {
          layout.lastSessionPerTab.setPattern(id)
          void sync.session.sync(id).then(() => {
            if (params.id === id) discoverChildSessions(id)
          })
        }
        if (prevId !== undefined) {
          setSending(false)
          setPhase("idle")
        }
        setChildSessionIDs([])
        discoverVersion++
        requestAnimationFrame(() => autoScroll.forceScrollToBottom())
      },
    ),
  )

  createEffect(
    on(
      () => params.id,
      (id) => {
        if (!id) return
        setLastIntent(null)
        setLastPlanner(null)
        setLastModules([])
        setVersions([])
        setCurrentVersionId(null)
        const dir = patternHistoryDir()
        if (!dir) return
        void loadCurrentPatternState(dir, id).then((state) => {
          if (!state || params.id !== id) return
          if (state.lastIntent) setLastIntent(state.lastIntent)
          if (state.lastPlanner) setLastPlanner(state.lastPlanner)
          if (state.lastModules.length > 0) setLastModules(state.lastModules)
        })
        void listPatternVersions(dir, id).then(({ versions, current }) => {
          if (params.id !== id) return
          setVersions(versions)
          setCurrentVersionId(current)
        })
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
  // 历史文件存储目录，优先使用关联目录下的 .octo/pattern/history
  const patternHistoryDir = createMemo(() => {
    const dir = globalSync.data.path.directory
    if (dir && dir.length > 2) return `${dir}/.octo/pattern/history`
    const wt = globalSync.data.path.worktree
    if (wt && wt.length > 2) return `${wt}/.octo/pattern/history`
    const home = sdk.directory
    return home ? `${home}/.octo/pattern/history` : ""
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
        sync: sync,
        onSessionCreated: (childID: string) => setChildSessionIDs((prev) => [...prev, childID]),
      }

      let intentCtx = {
        sdk: sdk,
        sync: sync,
        modelKey: mk,
        rootSession: sid,
        userInput: text,
        onSessionCreated: (childID: string) => setChildSessionIDs((prev) => [...prev, childID]),
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
        sessionId: undefined,
        abortSignal: controller.signal,
      })
      console.log("[Pattern] triage:", triage.routing, triage.reason)
      console.log("[Pattern] triage output:", JSON.stringify(triage, null, 2))

      if (triage.routing === "modify") {
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

        const updatedIntent = { ...triage.updated_intent }
        const prevModules = lastModules()

        setPhase("module")
        const modulePromises = modifyResult.output.slots.map((slot) => {
          if (slot.operation === "none") {
            const existing = prevModules.find((m) => m.rootId === slot.element_id)
            return existing ?? null
          }
          if (slot.operation === "create") {
            console.log("[Pattern] 进入代理: proto_module_create (modify/create)")
            return proto_module_create({
              ...intentCtx,
              idPrefix: slot.id_prefix,
              sectionId: slot.section_id,
              elementId: slot.element_id,
              layoutPlanner: modifyResult.output as unknown as Record<string, unknown>,
              intentDescription: updatedIntent as any,
            }).then((r) => r.ui_json)
          }
          if (slot.operation === "modify") {
            const originModule = prevModules.find((m) => m.rootId === slot.element_id)
            const modAction = triage.modify.find((m) => m.section_id === slot.section_id)
            if (!originModule || !modAction) return null
            console.log("[Pattern] 进入代理: proto_module_modify")
            return runModuleModify({
              ...ctx,
              input: {
                layoutPlanner: modifyResult.output as unknown as Record<string, unknown>,
                idPrefix: slot.id_prefix,
                sectionId: slot.section_id,
                originModules: originModule,
                modifications: modAction as unknown as Record<string, unknown>,
              },
            }).then((r) => r.ui_json)
          }
          return null
        })
        const moduleResults = await Promise.all(modulePromises)
        const allModules = moduleResults.filter(Boolean) as typeof prevModules

        const merged = mergeModules(
          { rootId: modifyResult.output.rootId as string, elements: modifyResult.output.elements as any },
          allModules as any,
        )
        console.log("[Pattern] ========== MERGED A2UI JSON ==========")
        console.log(JSON.stringify(merged, null, 2))
        const mergedJson = detectA2UIJson(JSON.stringify(merged))
        if (mergedJson) sendToPreview(mergedJson)

        setLastIntent(updatedIntent as unknown as Record<string, unknown>)
        setLastPlanner(modifyResult.output as unknown as Record<string, unknown>)
        setLastModules(allModules)

        // 追加修改版本到历史文件
        const dir = patternHistoryDir()
        if (dir) {
          const vid = await appendPatternVersion(dir, sid, {
            lastIntent: lastIntent(),
            lastPlanner: lastPlanner(),
            lastModules: lastModules(),
          }, text.slice(0, 80))
          setVersions((prev) => [...prev, { id: vid, createdAt: Date.now(), summary: text.slice(0, 80) }])
          setCurrentVersionId(vid)
        }

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
        { rootId: planner.layout_planner.rootId as string, elements: planner.layout_planner.elements as any },
        modules as any,
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

      console.log("[Pattern] ========== MERGED A2UI JSON ==========")
      console.log(JSON.stringify(merged, null, 2))
      const mergedJson = detectA2UIJson(JSON.stringify(merged))
      if (mergedJson) sendToPreview(mergedJson)

      setLastIntent(intentResult.intent_page as unknown as Record<string, unknown>)
      setLastPlanner(planner.layout_planner as unknown as Record<string, unknown>)
      setLastModules(modules)

      // 追加首次生成版本到历史文件
      const dir = patternHistoryDir()
      if (dir) {
        const vid = await appendPatternVersion(dir, sid, {
          lastIntent: lastIntent(),
          lastPlanner: lastPlanner(),
          lastModules: lastModules(),
        }, text.slice(0, 80))
        setVersions((prev) => [...prev, { id: vid, createdAt: Date.now(), summary: text.slice(0, 80) }])
        setCurrentVersionId(vid)
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
    if (doc) sendToPreview(doc)
  }

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

        {/* 预览页 — 通过 props 传入版本历史数据，预览区内时钟按钮触发 history dialog */}
        <Show when={hasContent()}>
          <PreviewPage
            api={previewApi}
            onPickerSubmit={handlePickerSubmit}
            versions={versions()}
            currentVersionId={currentVersionId()}
            onSelectVersion={(vid) => { void handleSelectVersion(vid) }}
          />
        </Show>
      </div>
    </DataProvider>
  )
}

