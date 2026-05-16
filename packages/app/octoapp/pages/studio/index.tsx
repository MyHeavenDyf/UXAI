import "./studio.css"
import type { FilePartInput, Message, Part, Session, SessionStatus, TextPartInput } from "@opencode-ai/sdk/v2/client"
import { Binary } from "@opencode-ai/core/util/binary"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { batch, createEffect, createMemo, createSignal, For, on, onCleanup, Show, type JSX } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { useNavigate, useParams } from "@solidjs/router"
import { decode64 } from "@/utils/base64"
import { useGlobalSDK } from "@/context/global-sdk"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DialogSettings } from "@/components/dialog-settings"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { groupSessionsByDate, sortedRootSessions } from "@/pages/layout/helpers"
import { sessionTitle } from "@/utils/session-title"
import {
  STUDIO_ASPECT_RATIOS,
  STUDIO_CAPABILITIES,
  STUDIO_IMAGE_TOOLS,
  STUDIO_STYLE_MODELS,
  capabilityLabel,
  imageToolLabel,
  styleModelLabel,
} from "./data"
import type {
  StudioAsset,
  StudioAspectRatio,
  StudioCapability,
  StudioGenerationResult,
  StudioGenerationStatus,
  StudioImage,
  StudioMode,
  StudioImageTool,
} from "./types"
import {
  buildStudioConversationContext,
  buildStudioDisplayPrompt,
  buildStudioTurns,
  latestStudioTurn,
  type StudioTurnData,
} from "./turns"

const SKIP_PART_TYPES = new Set(["patch", "step-start", "step-finish"])

type DataStore = {
  session: Session[]
  session_status: { [sessionID: string]: SessionStatus }
  message: { [sessionID: string]: Message[] }
  part: { [messageID: string]: Part[] }
}

export default function StudioPage() {
  const params = useParams<{ id?: string; dir?: string }>()
  const navigate = useNavigate()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const dialog = useDialog()

  const projectDir = () => {
    if (params.dir) return decode64(params.dir) ?? globalSync.data.path.home
    return globalSync.data.path.home
  }

  const slug = createMemo(() => base64Encode(projectDir()))

  const [prompt, setPrompt] = createSignal("")
  const [capability, setCapability] = createSignal<StudioCapability>("image.generate")
  const [styleModel, setStyleModel] = createSignal("qwen")
  const [aspectRatio, setAspectRatio] = createSignal<StudioAspectRatio>("3:4")
  const [count, setCount] = createSignal<1 | 2 | 3 | 4>(1)
  const [imageTool, setImageTool] = createSignal<StudioImageTool>("jimeng")
  const [assets, setAssets] = createSignal<StudioAsset[]>([])
  const [status, setStatus] = createSignal<StudioGenerationStatus>("idle")
  const [pendingResult, setPendingResult] = createSignal<StudioGenerationResult>()
  const [selectedImageId, setSelectedImageId] = createSignal<string>()
  const [openMenu, setOpenMenu] = createSignal<"capability" | "imageTool" | "style" | "settings" | null>(null)
  const [mode, setMode] = createSignal<StudioMode>("preview")
  const [sending, setSending] = createSignal(false)
  const [dataStore, setDataStore] = createStore<DataStore>({
    session: [],
    session_status: {},
    message: {},
    part: {},
  })

  let fileInputRef!: HTMLInputElement
  let conversationScrollRef!: HTMLDivElement
  let scrollFrame = 0

  createEffect(
    on(
      () => params.id,
      (id) => {
        if (!id) return
        globalSDK.client.session.messages({ sessionID: id })
          .then((result) => {
            const items = result.data ?? []
            const messages: Message[] = []
            const partMap: { [messageID: string]: Part[] } = {}
            for (const item of items as { info: Message; parts: Part[] }[]) {
              messages.push(item.info)
              partMap[item.info.id] = item.parts.filter((part) => !SKIP_PART_TYPES.has(part.type))
            }
            batch(() => {
              setDataStore("message", id, reconcile(messages, { key: "id" }))
              for (const [messageID, parts] of Object.entries(partMap)) {
                setDataStore("part", messageID, reconcile(parts, { key: "id" }))
              }
            })
          })
          .catch((error) => console.error("[StudioPage] messages load failed", error))
      },
    ),
  )

  const unsub = globalSDK.event.listen((event) => {
    const sessionID = params.id
    if (!sessionID) return
    const payload = event.details

    if (payload.type === "message.updated") {
      const info = payload.properties.info
      if (info.sessionID !== sessionID) return
      const messages = dataStore.message[sessionID]
      if (!messages) {
        setDataStore("message", sessionID, [info])
        return
      }
      const result = Binary.search(messages, info.id, (message: Message) => message.id)
      if (result.found) {
        setDataStore("message", sessionID, result.index, reconcile(info))
        return
      }
      setDataStore("message", sessionID, produce((draft) => { draft.splice(result.index, 0, info) }))
      return
    }

    if (payload.type === "message.part.updated") {
      const part = payload.properties.part
      if (part.sessionID !== sessionID || SKIP_PART_TYPES.has(part.type)) return
      const parts = dataStore.part[part.messageID]
      if (!parts) {
        setDataStore("part", part.messageID, [part])
        return
      }
      const result = Binary.search(parts, part.id, (item: Part) => item.id)
      if (result.found) {
        setDataStore("part", part.messageID, result.index, reconcile(part))
        return
      }
      setDataStore("part", part.messageID, produce((draft) => { draft.splice(result.index, 0, part) }))
      return
    }

    if (payload.type === "session.status") {
      const { sessionID: nextSessionID, status: nextStatus } = payload.properties
      if (nextSessionID !== sessionID) return
      setDataStore("session_status", nextSessionID, reconcile(nextStatus))
      return
    }

    const raw = payload as unknown as { type: string; properties: Record<string, unknown> }
    if (raw.type === "message.part.delta") {
      const props = raw.properties as { messageID: string; partID: string; field: string; delta: string }
      const parts = dataStore.part[props.messageID]
      if (!parts) return
      const result = Binary.search(parts, props.partID, (part: Part) => part.id)
      if (!result.found) return
      setDataStore("part", props.messageID, produce((draft) => {
        const part = draft[result.index] as Record<string, unknown>
        part[props.field] = `${part[props.field] ?? ""}${props.delta}`
      }))
    }
  })
  onCleanup(unsub)

  const sessionStatus = createMemo(() => {
    const id = params.id
    if (!id) return { type: "idle" } as SessionStatus
    return dataStore.session_status[id] ?? ({ type: "idle" } as SessionStatus)
  })

  const isBusy = createMemo(() => sending() || sessionStatus().type === "busy")
  const turns = createMemo(() =>
    buildStudioTurns({
      messages: params.id ? dataStore.message[params.id] ?? [] : [],
      parts: dataStore.part,
      fallback: pendingResult(),
    }),
  )
  const studioTurn = createMemo(() => latestStudioTurn({
    messages: params.id ? dataStore.message[params.id] ?? [] : [],
    parts: dataStore.part,
    fallback: pendingResult(),
  }))

  const latestCompletedTurn = createMemo(() => [...turns()].reverse().find((turn) => (turn.result?.images.length ?? 0) > 0))
  const result = createMemo(() => studioTurn()?.result ?? latestCompletedTurn()?.result ?? pendingResult())
  const effectiveStatus = createMemo<StudioGenerationStatus>(() => {
    if (result()?.images.length) return "succeeded"
    if (isBusy()) return "running"
    if (studioTurn()?.toolError) return "failed"
    if (studioTurn()?.assistantText && params.id) return "failed"
    return status()
  })

  const selectedImage = createMemo(() => {
    const images = result()?.images ?? []
    return images.find((item) => item.id === selectedImageId()) ?? images[0]
  })

  createEffect(() => {
    const first = result()?.images[0]?.id
    if (first && !result()?.images.some((image) => image.id === selectedImageId())) setSelectedImageId(first)
  })

  createEffect(() => {
    const pending = pendingResult()
    if (!pending) return
    if (studioTurn()?.userText !== pending.prompt) return
    if (!studioTurn()?.result && !studioTurn()?.toolError) return
    setPendingResult(undefined)
    setStatus(studioTurn()?.toolError ? "failed" : "succeeded")
  })

  createEffect(
    on(
      () => params.id,
      (id) => {
        if (!id || !sending()) {
          setStatus("idle")
          setPendingResult(undefined)
        }
        setSelectedImageId(undefined)
        setMode("preview")
        setAssets([])
        setPrompt("")
      },
      { defer: true },
    ),
  )

  const canSubmit = createMemo(() => prompt().trim().length > 0 && !isBusy())
  const currentTitle = createMemo(() =>
    latestCompletedTurn()?.result
      ? buildStudioDisplayPrompt(latestCompletedTurn()!.result!.prompt)
      : studioTurn()?.userText || "Octo Studio",
  )
  const currentImageLabel = createMemo(() => {
    const image = selectedImage()
    const images = result()?.images ?? []
    const index = image ? images.findIndex((item) => item.id === image.id) + 1 : 1
    const prefix = currentTitle() === "Octo Studio" ? "studio-image" : currentTitle().replace(/[\\/:*?\"<>|]/g, "-").slice(0, 24)
    return `${prefix}-${Math.max(index, 1)}.png`
  })

  createEffect(
    on(
      () => `${params.id ?? ""}:${turns().map((turn) => turn.id).join("|")}:${pendingResult()?.id ?? ""}`,
      () => {
        if (!params.id || !conversationScrollRef) return
        cancelAnimationFrame(scrollFrame)
        scrollFrame = requestAnimationFrame(() => {
          conversationScrollRef.scrollTo({ top: conversationScrollRef.scrollHeight, behavior: "smooth" })
        })
      },
      { defer: true },
    ),
  )

  function addAssets(files: File[]) {
    const slots = 5 - assets().length
    files.slice(0, slots).map((file) => {
      const reader = new FileReader()
      reader.onload = (event) => {
        const dataUrl = event.target?.result
        if (typeof dataUrl !== "string") return
        setAssets((items) => [
          ...items,
          {
            id: crypto.randomUUID(),
            name: file.name,
            mime: file.type || "application/octet-stream",
            dataUrl,
          },
        ])
      }
      reader.readAsDataURL(file)
      return file.name
    })
  }

  function handleFileChange(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    if (input.files?.length) addAssets(Array.from(input.files))
    input.value = ""
  }

  async function createAndNavigate(title?: string) {
    const result = await globalSDK.client.session.create({
      directory: projectDir(),
      agent: "octo_studio",
      title: title ? buildStudioDisplayPrompt(title) : undefined,
    })
    const session = result.data as Session | undefined
    if (!session) return
    navigate(`/${slug()}/studio/${session.id}`)
    return session.id
  }

  function buildPromptInput(input: { text: string; capability: StudioCapability; sourceImage?: string }) {
    return [
      `能力：${capabilityLabel(input.capability)}`,
      `首选生图工具：${imageToolLabel(imageTool())} (${imageTool() === "jimeng" ? "jimeng_image_generate" : "internel_image_generate"})`,
      `风格模型：${styleModelLabel(styleModel())}`,
      `画幅比例：${aspectRatio()}`,
      `生成数量：${count()}`,
      input.sourceImage ? "当前任务：基于上一轮选中的图片继续编辑。" : undefined,
      buildStudioConversationContext({
        messages: params.id ? dataStore.message[params.id] ?? [] : [],
        parts: dataStore.part,
        fallback: pendingResult(),
      }),
      `用户需求：${input.text}`,
      "输出时先简短说明创作方向，再调用生图工具。",
    ]
      .filter((item): item is string => Boolean(item))
      .join("\n")
  }

  async function sendStudioMessage(input: { text: string; capability: StudioCapability; sourceImage?: string }) {
    let sessionID = params.id
    if (!sessionID) {
      sessionID = await createAndNavigate(input.text)
      if (!sessionID) return
    }

    const textPart: TextPartInput = {
      type: "text",
      text: buildPromptInput(input),
    }
    const selectedTool = imageTool()
    const fileParts: FilePartInput[] = [
      ...assets().map((item) => ({
        type: "file" as const,
        mime: item.mime,
        filename: item.name,
        url: item.dataUrl,
      })),
      ...(input.sourceImage
        ? [{
            type: "file" as const,
            mime: "image/png",
            filename: currentImageLabel(),
            url: input.sourceImage,
          }]
        : []),
    ]
    await globalSDK.client.session.prompt({
      sessionID,
      parts: [textPart, ...fileParts],
      tools: {
        jimeng_image_generate: selectedTool === "jimeng",
        internel_image_generate: selectedTool === "internel",
      },
    })
    if (!params.id && sessionID) navigate(`/${slug()}/studio/${sessionID}`)
  }

  async function runGeneration(overrides?: { capability?: StudioCapability; sourceImage?: string; prompt?: string }) {
    const text = (overrides?.prompt ?? prompt()).trim()
    if (!text || isBusy()) return
    const previousPrompt = prompt()
    setStatus("submitting")
    setOpenMenu(null)
    setMode("preview")
    setPendingResult({
      id: `studio_pending_${Date.now()}`,
      status: "running",
      capability: overrides?.capability ?? capability(),
      prompt: text,
      provider: imageTool(),
      model: styleModelLabel(styleModel()),
      aspectRatio: aspectRatio(),
      images: [],
      createdAt: Date.now(),
    })
    setSending(true)
    setPrompt("")
    try {
      await sendStudioMessage({
        text,
        capability: overrides?.capability ?? capability(),
        sourceImage: overrides?.sourceImage,
      })
      setAssets([])
      setStatus("running")
    } catch (error) {
      console.error("[StudioPage] studio prompt failed", error)
      setPrompt(previousPrompt)
      setStatus("failed")
      setPendingResult((item) => item ? { ...item, status: "failed", error: error instanceof Error ? error.message : String(error) } : item)
    } finally {
      setSending(false)
    }
  }

  function handleSubmit() {
    void runGeneration()
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key !== "Enter" || event.shiftKey) return
    event.preventDefault()
    handleSubmit()
  }

  function openOutpaint() {
    if (!selectedImage()) return
    setMode("outpaint")
  }

  function submitOutpaint() {
    const image = selectedImage()
    if (!image) return
    void runGeneration({
      capability: "image.outpaint",
      sourceImage: image.url,
      prompt: prompt().trim() || "保留主体和画面风格，扩展更大尺寸和更多环境内容",
    })
  }

  return (
    <div class="studio-page">
      <aside class="studio-left">
        <StudioHistory directory={projectDir()} activeSessionID={params.id} onNewConversation={() => navigate(`/${slug()}/studio`)} onOpenSettings={() => dialog.show(() => <DialogSettings />)} />
      </aside>

      <section class="studio-center">
        <div class="h-[56px] shrink-0 flex items-center px-6 border-b border-[rgba(15,23,42,0.08)]">
          <div class="text-[15px] font-semibold truncate">{currentTitle()}</div>
          <div class="ml-auto text-[11px] text-[var(--studio-muted)] truncate max-w-[180px]" title={projectDir()}>
            {projectDir()}
          </div>
        </div>

        <div ref={conversationScrollRef!} class="flex-1 min-h-0 overflow-y-auto px-6 py-6">
          <Show when={turns().length > 0 || pendingResult()} fallback={<StudioIntro />}>
            <StudioConversation
              result={result() ?? pendingResult()!}
              turns={turns()}
              busy={effectiveStatus() === "running" || effectiveStatus() === "submitting"}
              onSelectImage={setSelectedImageId}
            />
          </Show>
        </div>

          <StudioComposer
            prompt={prompt()}
            capability={capability()}
            imageTool={imageTool()}
            styleModel={styleModel()}
            aspectRatio={aspectRatio()}
            count={count()}
          assets={assets()}
          status={effectiveStatus()}
          openMenu={openMenu()}
          canSubmit={canSubmit()}
            onPrompt={setPrompt}
            onCapability={setCapability}
            onImageTool={setImageTool}
            onStyleModel={setStyleModel}
            onAspectRatio={setAspectRatio}
            onCount={setCount}
          onOpenMenu={setOpenMenu}
          onSubmit={handleSubmit}
          onKeyDown={handleKeyDown}
          onPickFile={() => fileInputRef.click()}
          onRemoveAsset={(id) => setAssets((items) => items.filter((item) => item.id !== id))}
        />

        <input ref={fileInputRef!} type="file" multiple accept="image/*" class="hidden" onChange={handleFileChange} />
      </section>

      <main class="studio-workspace">
        <section class="studio-canvas">
          <Show when={mode() === "outpaint" && selectedImage()} fallback={
            <StudioResultCanvas
              status={effectiveStatus()}
              image={selectedImage()}
              result={result()}
              imageLabel={currentImageLabel()}
              onRegenerate={() => void runGeneration()}
            />
          }>
            {(image) => (
              <StudioOutpaintEditor
                image={image()}
                aspectRatio={aspectRatio()}
                onAspectRatio={setAspectRatio}
                onClose={() => setMode("preview")}
                onSubmit={submitOutpaint}
              />
            )}
          </Show>
        </section>

        <Show when={result()?.images.length}>
          <aside class="studio-details">
            <StudioDetails
              result={result()!}
              image={selectedImage()}
              selectedImageId={selectedImageId()}
              imageLabel={currentImageLabel()}
              onSelectImage={setSelectedImageId}
              onRegenerate={() => void runGeneration()}
              onOutpaint={openOutpaint}
            />
          </aside>
        </Show>
      </main>
    </div>
  )
}

function StudioHistory(props: { directory: string; activeSessionID?: string; onNewConversation: () => void; onOpenSettings?: () => void }): JSX.Element {
  const globalSync = useGlobalSync()
  const language = useLanguage()
  const sessions = createMemo(() => {
    const [store] = globalSync.child(props.directory, { bootstrap: true })
    const allSessions = sortedRootSessions(store, Date.now())
    const studioSessions = allSessions.filter(s => s.agent === "octo_studio")
    return groupSessionsByDate(studioSessions, Date.now())
  })

  return (
    <div class="h-full flex flex-col px-5 py-7">
      <h1 class="text-[20px] font-bold mb-9">{language.t("studio.title")}</h1>
      <button type="button" onClick={props.onNewConversation} class="flex items-center gap-3 text-[14px] mb-9">
        <span class="text-[25px] leading-none text-[rgba(17,24,39,0.65)]">+</span>
        <span>{language.t("command.session.new")}</span>
      </button>
      <div class="text-[15px] font-semibold mb-6">{language.t("sidebar.history.title")}</div>
      <div class="flex-1 min-h-0 overflow-y-auto pr-1">
        <For each={sessions()}>
          {(group) => (
            <div class="mb-7">
              <div class="text-[13px] text-[var(--studio-muted)] mb-3">{language.t(`session.group.${group.key}`)}</div>
              <div class="flex flex-col gap-1">
                <For each={group.sessions}>
                  {(session) => (
                    <a
                      href={`/${base64Encode(props.directory)}/studio/${session.id}`}
                      class="relative text-left text-[13px] leading-[18px] px-3 py-2 rounded-[8px] transition-colors truncate"
                      classList={{ "bg-[#dfe9ff] text-[#1267ff] font-semibold": props.activeSessionID === session.id }}
                    >
                      {sessionTitle(session.title) ?? language.t("command.session.new")}
                      <Show when={props.activeSessionID === session.id}>
                        <span class="absolute right-1 top-1 bottom-1 w-[4px] rounded-full bg-[#1267ff]" />
                      </Show>
                    </a>
                  )}
                </For>
              </div>
            </div>
          )}
        </For>
        <Show when={sessions().length === 0}>
          <div class="text-[13px] text-[var(--studio-muted)]">{language.t("sidebar.history.empty")}</div>
        </Show>
      </div>
      <button type="button" class="flex items-center gap-2 text-[13px] py-2" onClick={props.onOpenSettings}>
        <span class="text-[16px]">⚙</span>
        <span>{language.t("sidebar.settings")}</span>
      </button>
    </div>
  )
}

function StudioIntro(): JSX.Element {
  return (
    <div class="min-h-full flex flex-col items-center justify-center text-center pb-28">
      <StudioMark size="large" />
      <div class="mt-6 text-[28px] font-bold">Octo Studio</div>
      <div class="flex items-center gap-3 mt-3 mb-10 text-[13px] text-[var(--studio-muted)]">
        <span class="w-[84px] h-px bg-gradient-to-r from-transparent to-[#bdd0ff]" />
        <span>专项能力矩阵</span>
        <span class="w-[84px] h-px bg-gradient-to-r from-[#bdd0ff] to-transparent" />
      </div>
      <div class="flex flex-col gap-8 text-left">
        <For each={STUDIO_CAPABILITIES.slice(0, 4)}>
          {(item) => (
            <div class="flex items-center gap-5">
              <span class="w-5 h-5 rounded-[6px] flex items-center justify-center" style={{ color: item.tone }}>
                ✦
              </span>
              <div>
                <div class="text-[15px] font-semibold">{item.label}</div>
                <div class="text-[13px] text-[var(--studio-muted)] mt-1">{item.description}</div>
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}

function StudioComposer(props: {
  prompt: string
  capability: StudioCapability
  imageTool: StudioImageTool
  styleModel: string
  aspectRatio: StudioAspectRatio
  count: 1 | 2 | 3 | 4
  assets: StudioAsset[]
  status: StudioGenerationStatus
  openMenu: "capability" | "imageTool" | "style" | "settings" | null
  canSubmit: boolean
  onPrompt: (value: string) => void
  onCapability: (value: StudioCapability) => void
  onImageTool: (value: StudioImageTool) => void
  onStyleModel: (value: string) => void
  onAspectRatio: (value: StudioAspectRatio) => void
  onCount: (value: 1 | 2 | 3 | 4) => void
  onOpenMenu: (value: "capability" | "imageTool" | "style" | "settings" | null) => void
  onSubmit: () => void
  onKeyDown: (event: KeyboardEvent) => void
  onPickFile: () => void
  onRemoveAsset: (id: string) => void
}): JSX.Element {
  return (
    <div class="relative shrink-0">
      <Show when={props.openMenu === "capability"}>
        <CapabilityMenu value={props.capability} onSelect={(value) => { props.onCapability(value); props.onOpenMenu(null) }} />
      </Show>
      <Show when={props.openMenu === "imageTool"}>
        <ImageToolMenu value={props.imageTool} onSelect={(value) => { props.onImageTool(value); props.onOpenMenu(null) }} />
      </Show>
      <Show when={props.openMenu === "style"}>
        <StyleMenu value={props.styleModel} onSelect={(value) => { props.onStyleModel(value); props.onOpenMenu(null) }} />
      </Show>
      <Show when={props.openMenu === "settings"}>
        <ImageSettings
          aspectRatio={props.aspectRatio}
          count={props.count}
          onAspectRatio={props.onAspectRatio}
          onCount={props.onCount}
        />
      </Show>

      <div class="studio-composer">
        <div class="flex gap-4">
          <button
            type="button"
            onClick={props.onPickFile}
            class="w-[48px] h-[62px] shrink-0 rounded-[6px] bg-[#f4f5f7] border border-[rgba(15,23,42,0.06)] rotate-[-4deg] flex items-center justify-center text-[24px] text-[rgba(15,23,42,0.32)]"
            title="上传参考图"
          >
            +
          </button>
          <textarea
            value={props.prompt}
            onInput={(event) => props.onPrompt(event.currentTarget.value)}
            onKeyDown={props.onKeyDown}
            placeholder="上传参考图、输入文字，描述你想生成的图片。"
            class="flex-1 min-h-[76px] resize-none border-0 outline-none bg-transparent text-[13px] leading-[22px] placeholder:text-[rgba(15,23,42,0.45)]"
            disabled={props.status === "running" || props.status === "submitting"}
          />
        </div>

        <Show when={props.assets.length > 0}>
          <div class="flex gap-2 mt-3 overflow-x-auto">
            <For each={props.assets}>
              {(item) => (
                <button
                  type="button"
                  onClick={() => props.onRemoveAsset(item.id)}
                  class="relative w-[46px] h-[46px] shrink-0 overflow-hidden rounded-[8px] border border-[rgba(15,23,42,0.08)]"
                  title={`${item.name}，点击移除`}
                >
                  <img src={item.dataUrl} class="w-full h-full object-cover" alt="" />
                  <span class="absolute right-0 top-0 w-4 h-4 rounded-bl-[8px] bg-black/50 text-white text-[10px]">×</span>
                </button>
              )}
            </For>
          </div>
        </Show>

        <div class="flex items-center gap-2 mt-5">
          <ToolButton label={capabilityLabel(props.capability)} onClick={() => props.onOpenMenu(props.openMenu === "capability" ? null : "capability")} />
          <ToolButton label={imageToolLabel(props.imageTool)} onClick={() => props.onOpenMenu(props.openMenu === "imageTool" ? null : "imageTool")} />
          <ToolButton label={styleModelLabel(props.styleModel)} onClick={() => props.onOpenMenu(props.openMenu === "style" ? null : "style")} />
          <IconTool label="参数" onClick={() => props.onOpenMenu(props.openMenu === "settings" ? null : "settings")} />
          <IconTool label="素材" onClick={props.onPickFile} />
          <button
            type="button"
            onClick={props.onSubmit}
            disabled={!props.canSubmit}
            class="ml-auto w-[38px] h-[38px] rounded-full studio-gradient-button flex items-center justify-center disabled:opacity-45 disabled:shadow-none"
            title="生成"
          >
            {props.status === "submitting" || props.status === "running" ? "…" : "➤"}
          </button>
        </div>
      </div>
    </div>
  )
}

function ToolButton(props: { label: string; onClick: () => void }): JSX.Element {
  return (
    <button type="button" onClick={props.onClick} class="h-8 px-3 rounded-full bg-[#f2f3f5] text-[13px] flex items-center gap-1">
      <span>{props.label}</span>
      <span class="text-[10px] text-[var(--studio-muted)]">⌄</span>
    </button>
  )
}

function IconTool(props: { label: string; onClick: () => void }): JSX.Element {
  return (
    <button type="button" onClick={props.onClick} class="w-8 h-8 rounded-full bg-[#f2f3f5] text-[13px]" title={props.label}>
      {props.label === "参数" ? "≛" : "▣"}
    </button>
  )
}

function CapabilityMenu(props: { value: StudioCapability; onSelect: (value: StudioCapability) => void }): JSX.Element {
  return (
    <div class="studio-menu w-[178px] p-1">
      <For each={STUDIO_CAPABILITIES}>
        {(item) => (
          <button
            type="button"
            onClick={() => props.onSelect(item.id)}
            class="w-full h-10 rounded-[8px] px-3 flex items-center gap-2 text-left text-[13px] hover:bg-[#f4f5f7]"
            classList={{ "bg-[#f0f1f3]": item.id === props.value }}
          >
            <span style={{ color: item.tone }}>✦</span>
            <span>{item.label}</span>
          </button>
        )}
      </For>
    </div>
  )
}

function StyleMenu(props: { value: string; onSelect: (value: string) => void }): JSX.Element {
  return (
    <div class="studio-menu w-[414px] p-4 left-[118px]">
      <div class="text-[13px] font-semibold mb-3">风格模型</div>
      <div class="grid grid-cols-2 gap-x-4 gap-y-3">
        <For each={STUDIO_STYLE_MODELS}>
          {(item) => (
            <button
              type="button"
              onClick={() => props.onSelect(item.id)}
              class="h-[52px] rounded-[8px] px-2 flex items-center gap-3 text-left hover:bg-[#f4f5f7]"
              classList={{ "bg-[#f0f1f3]": item.id === props.value }}
            >
              <span class="w-10 h-10 rounded-[6px] shrink-0" style={{ background: item.color }} />
              <span class="text-[13px]">{item.label}</span>
              <Show when={item.id === props.value}>
                <span class="ml-auto">✓</span>
              </Show>
            </button>
          )}
        </For>
      </div>
    </div>
  )
}

function ImageToolMenu(props: { value: StudioImageTool; onSelect: (value: StudioImageTool) => void }): JSX.Element {
  return (
    <div class="studio-menu w-[280px] p-4 left-[118px]">
      <div class="text-[13px] font-semibold mb-3">生图工具</div>
      <div class="flex flex-col gap-2">
        <For each={STUDIO_IMAGE_TOOLS}>
          {(item) => (
            <button
              type="button"
              onClick={() => props.onSelect(item.id)}
              class="w-full rounded-[8px] px-3 py-2 text-left hover:bg-[#f4f5f7]"
              classList={{ "bg-[#f0f1f3]": item.id === props.value }}
            >
              <div class="text-[13px] font-medium">{item.label}</div>
              <div class="text-[11px] text-[var(--studio-muted)] mt-1">{item.description}</div>
            </button>
          )}
        </For>
      </div>
    </div>
  )
}

function ImageSettings(props: {
  aspectRatio: StudioAspectRatio
  count: 1 | 2 | 3 | 4
  onAspectRatio: (value: StudioAspectRatio) => void
  onCount: (value: 1 | 2 | 3 | 4) => void
}): JSX.Element {
  return (
    <div class="studio-menu w-[532px] p-4 left-[214px]">
      <div class="text-[13px] font-semibold mb-5">图片设置</div>
      <div class="text-[12px] text-[var(--studio-muted)] mb-2">选择比例</div>
      <div class="grid grid-cols-7 gap-1 bg-[#f1f1f2] rounded-[8px] p-1 mb-5">
        <For each={STUDIO_ASPECT_RATIOS}>
          {(item) => (
            <button
              type="button"
              onClick={() => props.onAspectRatio(item)}
              class="h-[54px] rounded-[7px] text-[12px] flex flex-col items-center justify-center gap-1"
              classList={{ "bg-white shadow-sm font-semibold": item === props.aspectRatio }}
            >
              <span class="w-4 h-5 border border-current rounded-[2px]" />
              <span>{item}</span>
            </button>
          )}
        </For>
      </div>
      <div class="text-[12px] text-[var(--studio-muted)] mb-2">图片数量</div>
      <div class="grid grid-cols-4 gap-1 bg-[#f1f1f2] rounded-[8px] p-1">
        <For each={[1, 2, 3, 4] as const}>
          {(item) => (
            <button
              type="button"
              onClick={() => props.onCount(item)}
              class="h-8 rounded-[7px] text-[13px]"
              classList={{ "bg-white shadow-sm font-semibold": item === props.count }}
            >
              {item}张
            </button>
          )}
        </For>
      </div>
    </div>
  )
}

function StudioConversation(props: {
  result?: StudioGenerationResult
  turns: StudioTurnData[]
  busy: boolean
  onSelectImage: (id: string) => void
}): JSX.Element {
  return (
    <div class="flex flex-col gap-8">
      <For each={props.turns}>
        {(turn, index) => (
          <div classList={{ "pt-8 border-t border-[rgba(15,23,42,0.08)]": index() > 0 }}>
            <div class="ml-auto max-w-[374px] rounded-[14px] bg-[#fdeeff] px-4 py-3 text-[13px] leading-[21px] whitespace-pre-wrap">
              {turn.userText || props.result?.prompt?.split("\n")[0] || "Octo Studio"}
            </div>
            <Show when={turn.assistantText}>
              <div class="mt-6 text-[13px] leading-[22px] whitespace-pre-wrap">{turn.assistantText}</div>
            </Show>
            <div class="studio-result-card mt-6 p-4">
              <div class="inline-flex items-center gap-1 rounded-full bg-white/70 text-[#c100d8] px-2 py-1 text-[12px]">
                ✦ {capabilityLabel(props.result?.capability ?? "image.generate")}
              </div>
              <div class="mt-4 text-[16px] font-semibold">{turn.toolTitle ?? "图片生成"}</div>
              <div class="mt-1 text-[13px] text-[var(--studio-muted)]">
                {turn.toolName ? `Tool：${turn.toolName} · ` : ""}
                创建时间：{formatTime(turn.createdAt)}
              </div>
              <Show when={turn.toolError}>
                <div class="mt-4 rounded-[10px] bg-white/70 px-3 py-2 text-[12px] leading-[18px] text-[#b42318]">
                  {turn.toolError}
                </div>
              </Show>
              <Show when={turn.result?.error}>
                <div class="mt-4 rounded-[10px] bg-white/70 px-3 py-2 text-[12px] leading-[18px] text-[#b42318] whitespace-pre-wrap break-all">
                  {turn.result?.error}
                </div>
              </Show>
              <Show when={props.busy && turn.isLatest} fallback={
                <div class="grid grid-cols-4 gap-2 mt-5">
                  <For each={turn.result?.images ?? []}>
                    {(image) => (
                      <button type="button" onClick={() => props.onSelectImage(image.id)} class="aspect-[3/4] overflow-hidden rounded-[8px] bg-white">
                        <img src={image.thumbnailUrl ?? image.url} class="w-full h-full object-cover" alt="" />
                      </button>
                    )}
                  </For>
                </div>
              }>
                <div class="mt-5 h-[168px] rounded-[12px] bg-[#e7c7ff] animate-pulse" />
              </Show>
            </div>
          </div>
        )}
      </For>
    </div>
  )
}

function StudioResultCanvas(props: {
  status: StudioGenerationStatus
  image?: StudioImage
  result?: StudioGenerationResult
  imageLabel: string
  onRegenerate: () => void
}): JSX.Element {
  return (
    <Show when={props.image} fallback={
      <div class="h-full flex flex-col items-center justify-center text-center">
        <Show when={props.status === "running" || props.status === "submitting"} fallback={
          <Show when={props.status === "failed" && props.result?.error} fallback={
          <>
            <StudioGlassSphere />
            <div class="mt-8 text-[28px] font-bold">Octo Studio</div>
            <div class="mt-2 text-[15px] text-[var(--studio-muted)]">输入你的想法，创意无限可能</div>
          </>
          }>
            <div class="max-w-[520px] rounded-[16px] border border-[rgba(180,35,24,0.16)] bg-[rgba(255,244,242,0.92)] px-5 py-4 text-left shadow-sm">
              <div class="text-[16px] font-semibold text-[#b42318]">生成失败</div>
              <div class="mt-2 text-[12px] leading-[18px] whitespace-pre-wrap break-all text-[#7a271a]">
                {props.result?.error}
              </div>
            </div>
          </Show>
        }>
          <div class="flex items-end gap-4 mb-8">
            <span class="studio-loader-dot bg-[#2e9dfb]" />
            <span class="studio-loader-dot bg-[#45bcc9]" style={{ "animation-delay": "120ms" }} />
            <span class="studio-loader-dot bg-[#704cff]" style={{ "animation-delay": "240ms" }} />
            <span class="studio-loader-dot bg-[#d100d8]" style={{ "animation-delay": "360ms" }} />
          </div>
          <div class="text-[14px] font-medium">生成中...</div>
        </Show>
      </div>
    }>
      {(image) => (
        <>
          <div class="h-[56px] shrink-0 flex items-center border-b border-[rgba(15,23,42,0.08)] px-6">
            <span class="rounded-full bg-[#fde7ff] text-[#c100d8] px-3 py-1 text-[13px]">{props.imageLabel}</span>
          </div>
          <div class="flex-1 min-h-0 flex items-center justify-center p-10">
            <img src={image().url} class="max-h-full max-w-full object-contain" alt="Studio generated result" />
          </div>
          <div class="absolute bottom-12 left-1/2 -translate-x-1/2 h-12 rounded-full bg-white shadow-[0_18px_52px_rgba(15,23,42,0.16)] flex items-center gap-2 px-4">
            <button type="button" class="w-8 h-8 rounded-full hover:bg-[#f3f4f6]" title="收藏">♡</button>
            <button type="button" class="w-8 h-8 rounded-full hover:bg-[#f3f4f6]" onClick={props.onRegenerate} title="再次生成">↻</button>
            <button type="button" class="studio-gradient-button h-8 px-7 rounded-full text-[13px]" title="下载">下载</button>
          </div>
        </>
      )}
    </Show>
  )
}

function StudioDetails(props: {
  result: StudioGenerationResult
  image?: StudioImage
  selectedImageId?: string
  imageLabel: string
  onSelectImage: (id: string) => void
  onRegenerate: () => void
  onOutpaint: () => void
}): JSX.Element {
  return (
    <div class="h-full overflow-y-auto px-7 py-7">
      <div class="grid grid-cols-4 gap-2 pb-4 border-b border-[rgba(15,23,42,0.08)]">
        <For each={props.result.images}>
          {(image) => (
            <button
              type="button"
              onClick={() => props.onSelectImage(image.id)}
              class="aspect-[3/4] rounded-[7px] overflow-hidden ring-offset-2"
              classList={{ "ring-2 ring-[#1267ff]": image.id === (props.selectedImageId ?? props.result.images[0]?.id) }}
            >
              <img src={image.thumbnailUrl ?? image.url} class="w-full h-full object-cover" alt="" />
            </button>
          )}
        </For>
      </div>
      <div class="py-5 border-b border-[rgba(15,23,42,0.08)]">
        <div class="text-[14px] font-semibold">{capabilityLabel(props.result.capability)}</div>
        <p class="mt-2 text-[12px] leading-[20px] text-[var(--studio-muted)]">
          {props.result.prompt}
        </p>
      </div>
      <div class="py-5 border-b border-[rgba(15,23,42,0.08)]">
        <div class="text-[15px] font-semibold mb-4">生成信息</div>
        <InfoRow label="模型" value={props.result.model} />
        <InfoRow label="比例" value={props.result.aspectRatio} />
        <InfoRow label="文件名" value={props.imageLabel} />
      </div>
      <div class="py-5 border-b border-[rgba(15,23,42,0.08)]">
        <div class="text-[15px] font-semibold mb-3">提示词</div>
        <p class="text-[12px] leading-[20px] text-[var(--studio-muted)]">{props.result.prompt.split("\n")[0]}</p>
      </div>
      <div class="py-5 border-b border-[rgba(15,23,42,0.08)]">
        <button type="button" onClick={props.onRegenerate} class="studio-gradient-button w-full h-8 rounded-full text-[13px] mb-3">
          ✦ 再次生成
        </button>
        <div class="grid grid-cols-2 gap-2">
          <button type="button" class="h-8 rounded-full bg-[#f3f4f6] text-[12px]">变清晰</button>
          <button type="button" class="h-8 rounded-full bg-[#f3f4f6] text-[12px]">抠图</button>
          <button type="button" class="h-8 rounded-full bg-[#f3f4f6] text-[12px]">局部重绘</button>
          <button type="button" onClick={props.onOutpaint} class="h-8 rounded-full bg-[#f3f4f6] text-[12px]">扩图</button>
        </div>
      </div>
      <div class="py-5">
        <div class="text-[15px] font-semibold mb-3">风格标签</div>
        <div class="flex flex-wrap gap-2">
          <For each={[capabilityLabel(props.result.capability), props.result.provider, props.result.aspectRatio, props.result.model]}>
            {(item) => <span class="px-2 py-1 rounded-[4px] bg-[#f5f5f5] text-[11px]">{item}</span>}
          </For>
        </div>
      </div>
    </div>
  )
}

function StudioOutpaintEditor(props: {
  image: StudioImage
  aspectRatio: StudioAspectRatio
  onAspectRatio: (value: StudioAspectRatio) => void
  onClose: () => void
  onSubmit: () => void
}): JSX.Element {
  return (
    <div class="absolute inset-0 bg-black text-white">
      <div class="h-[64px] flex items-center px-8 gap-3">
        <span>扩图</span>
        <span class="text-[13px] text-white/70">保留特征生成更大尺寸和内容</span>
        <button type="button" onClick={props.onClose} class="ml-auto text-[22px]">×</button>
      </div>
      <div class="absolute inset-x-0 top-[64px] bottom-[136px] flex items-center justify-center">
        <img src={props.image.url} class="max-w-[64%] max-h-full object-contain" alt="Outpaint source" />
      </div>
      <div class="absolute left-8 right-8 bottom-8 rounded-[14px] bg-[#1c1c1c] border border-white/10 p-5">
        <div class="flex gap-7 text-[13px] mb-5">
          <For each={["1:1", "16:9", "9:16"] as StudioAspectRatio[]}>
            {(item) => (
              <button
                type="button"
                onClick={() => props.onAspectRatio(item)}
                class="text-white/60"
                classList={{ "text-white": item === props.aspectRatio }}
              >
                □ {item}
              </button>
            )}
          </For>
        </div>
        <div class="flex gap-4">
          <input
            class="flex-1 h-10 rounded-[6px] bg-[#3a3a3a] px-3 text-[13px] outline-none"
            placeholder="请输入提示词：建议格式：风格，主体，背景，其他细节"
          />
          <button type="button" class="h-10 px-8 rounded-[6px] bg-[#333]">删除</button>
          <button type="button" onClick={props.onSubmit} class="studio-gradient-button h-10 px-9 rounded-[6px]">一键生成</button>
        </div>
      </div>
    </div>
  )
}

function InfoRow(props: { label: string; value: string }): JSX.Element {
  return (
    <div class="flex items-center justify-between text-[12px] mb-3">
      <span class="text-[var(--studio-muted)]">{props.label}</span>
      <span>{props.value}</span>
    </div>
  )
}

function StudioMark(props: { size: "large" | "small" }): JSX.Element {
  const size = props.size === "large" ? "70px" : "36px"
  return (
    <div
      style={{
        width: size,
        height: size,
        "border-radius": "999px",
        background: "conic-gradient(from 20deg, #7c5cff, #78d6e7, #d5f2ff, #a979ff, #7c5cff)",
        filter: "drop-shadow(0 14px 24px rgba(116,87,255,0.18))",
      }}
    />
  )
}

function StudioGlassSphere(): JSX.Element {
  return (
    <div
      class="w-[210px] h-[210px] rounded-full"
      style={{
        background:
          "radial-gradient(circle at 35% 24%, rgba(133,207,255,0.95), transparent 23%), radial-gradient(circle at 36% 42%, rgba(191,137,255,0.72), transparent 30%), radial-gradient(circle at 68% 68%, rgba(255,255,255,0.9), transparent 22%), linear-gradient(135deg, rgba(156,185,255,0.64), rgba(213,243,255,0.88))",
        "box-shadow": "0 28px 80px rgba(73, 123, 255, 0.25), inset -18px -22px 30px rgba(82, 151, 255, 0.12), inset 12px 14px 28px rgba(255,255,255,0.52)",
      }}
    />
  )
}

function formatTime(value: number) {
  return new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
}
