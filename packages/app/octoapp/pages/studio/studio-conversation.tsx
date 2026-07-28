import { createEffect, createMemo, createSignal, For, onCleanup, Show, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { buildStudioDisplayPrompt, type StudioTurnData } from "./turns"
import { StudioResultCard } from "./studio-result-card"
import { getDefaultDimensions, isStudioEditResult, isVideoMedia, getImageOrientation } from "./studio-shared"
import { capabilityLabel, STUDIO_STYLE_MODELS } from "./data"
import { StudioVideoPlayer } from "./studio-video-player"
import { getArtifactRelativePath, getArtifactServeUrl } from "../make/utils/artifact-file-api"
import { StudioFileManager } from "./studio-file-manager"
import type { StudioCapability, StudioGenerationResult, StudioGenerationStatus, StudioImage } from "./types"

const INPUT_IMAGE_PREVIEW_SIZE = 125
const INPUT_IMAGE_PREVIEW_GAP = 10

export function StudioConversation(props: {
  result?: StudioGenerationResult
  turns: StudioTurnData[]
  sdkUrl: string
  directory: string
  busy: boolean
  actionBusy: boolean
  cancellingGenerationIDs: ReadonlySet<string>
  rebootingGenerationIDs: ReadonlySet<string>
  onCancelGeneration: (generationID: string) => void
  onEditGeneration: (result: StudioGenerationResult) => void
  onRebootGeneration: (generationID: string) => void
  onSelectImage: (input: { resultID: string; imageID: string }) => void
  onOpenEditor: (capability: StudioCapability) => void
  onUseInputImage: (url: string) => void
}): JSX.Element {
  const [inputImagePreview, setInputImagePreview] = createSignal<{
    src: string
    left: number
    top: number
  }>()

  return (
    <>
      <div class="studio-conversation">
        <For each={props.turns}>
          {(turn, index) => (
            <div class="studio-conversation-turn" classList={{ separated: index() > 0 }}>
              <Show when={turn.inputImages?.length}>
                <div class="studio-user-input-images">
                  <For each={turn.inputImages}>
                    {(image) => (
                      <Show when={studioInputImageSrc({
                        url: image.url,
                        sdkUrl: props.sdkUrl,
                        directory: props.directory,
                      })}>
                        {(src) => (
                          <button
                            type="button"
                            class="studio-user-input-image-button"
                            onMouseEnter={(event) => setInputImagePreview({
                              src: src(),
                              ...inputImagePreviewPosition(event.currentTarget.getBoundingClientRect()),
                            })}
                            onMouseLeave={() => setInputImagePreview(undefined)}
                            onFocus={(event) => setInputImagePreview({
                              src: src(),
                              ...inputImagePreviewPosition(event.currentTarget.getBoundingClientRect()),
                            })}
                            onBlur={() => setInputImagePreview(undefined)}
                            onClick={() => props.onUseInputImage(src())}
                          >
                            <img class="studio-user-input-image" src={src()} alt="" />
                          </button>
                        )}
                      </Show>
                    )}
                  </For>
                </div>
              </Show>
              <div class="studio-user-bubble">
                {turn.userText || props.result?.prompt?.split("\n")[0] || "Octo Studio"}
              </div>
              <Show when={turn.editCapability} fallback={
                <Show when={sanitizeStudioAssistantText(turn.assistantText)}>
                  {(assistantText) => <div class="studio-assistant-copy">{assistantText()}</div>}
                </Show>
              }>
                {(editCapability) => (
                  <button
                    type="button"
                    class="studio-assistant-editor-link"
                    onClick={() => props.onOpenEditor(editCapability())}
                  >
                    点击前往编辑区
                    <img src="/studio/stutdio_arrow_right.png" alt="" class="studio-editor-link-arrow" />
                  </button>
                )}
              </Show>
              <Show when={!turn.editCapability}>
                <StudioResultCard
                  turn={turn}
                  fallbackCapability={props.result?.capability}
                  busy={props.busy && turn.isLatest}
                  actionBusy={props.actionBusy}
                  cancelling={Boolean(turn.result && props.cancellingGenerationIDs.has(turn.result.id))}
                  rebooting={Boolean(turn.result && props.rebootingGenerationIDs.has(turn.result.id))}
                  onCancelGeneration={props.onCancelGeneration}
                  onEditGeneration={props.onEditGeneration}
                  onRebootGeneration={props.onRebootGeneration}
                  onSelectImage={props.onSelectImage}
                />
              </Show>
            </div>
          )}
        </For>
      </div>
      <Portal>
        <Show when={inputImagePreview()}>
          {(preview) => (
            <img
              class="studio-user-input-image-preview"
              src={preview().src}
              alt=""
              style={{
                left: `${preview().left}px`,
                top: `${preview().top}px`,
              }}
            />
          )}
        </Show>
      </Portal>
    </>
  )
}

function inputImagePreviewPosition(rect: DOMRect) {
  const margin = 8
  const leftCandidate = rect.left + rect.width / 2 - INPUT_IMAGE_PREVIEW_SIZE / 2
  const right = window.innerWidth - margin - INPUT_IMAGE_PREVIEW_SIZE
  const left = Math.min(Math.max(margin, leftCandidate), Math.max(margin, right))
  const above = rect.top - INPUT_IMAGE_PREVIEW_GAP - INPUT_IMAGE_PREVIEW_SIZE
  if (above >= margin) return { left, top: above }
  const below = rect.bottom + INPUT_IMAGE_PREVIEW_GAP
  const bottom = window.innerHeight - margin - INPUT_IMAGE_PREVIEW_SIZE
  return {
    left,
    top: Math.min(Math.max(margin, below), Math.max(margin, bottom)),
  }
}

function studioInputImageSrc(input: { url: string; sdkUrl: string; directory: string }) {
  if (/^https?:\/\//i.test(input.url) || /^data:image\//i.test(input.url)) return input.url
  const artifact = getArtifactRelativePath(input.url)
  if (!artifact) return
  return getArtifactServeUrl(input.sdkUrl, input.directory, artifact.sessionId, artifact.relativePath)
}

function sanitizeStudioAssistantText(text?: string) {
  return text
    ?.split("\n")
    .filter((line) => !line.includes("当前选中的生图工具") && !line.includes("内部模型"))
    .join("\n")
    .trim()
}

export function StudioMediaPreview(props: { image: StudioImage; class?: string; controls?: boolean; onClick?: (e: MouseEvent) => void }): JSX.Element {
  return (
    <Show when={isVideoMedia(props.image)} fallback={
      <img src={props.image.thumbnailUrl ?? props.image.url} class={props.class} alt="" onClick={props.onClick} />
    }>
      <video
        src={props.image.remoteUrl ?? props.image.url}
        class={props.class}
        controls={props.controls}
        muted={!props.controls}
        playsinline
        preload="metadata"
      />
    </Show>
  )
}

export function StudioResultCanvas(props: {
  videoPlayerMount: () => HTMLElement
  fullscreenMount?: () => HTMLElement
  status: StudioGenerationStatus
  image?: StudioImage
  result?: StudioGenerationResult
  imageLabel: string
  selectedImageId?: string
  tabImages?: StudioImage[]
  tabLabels?: Record<string, string>
  onDownload: () => void
  onSelectImage?: (id: string) => void
  onDeleteImage?: (id: string) => void
  onCloseTab?: (id: string) => void
  onUpscale: () => void
  onCutout: () => void
  onInpaint: () => void
  onOutpaint: () => void
  onRegenerate: () => void
  onGenerateVideo: () => void
  showVideoGeneration: boolean
  regenerateDisabled: boolean
  actionDisabled: boolean
  showFileManagerTab?: boolean
  onFileManagerClick?: () => void
  showFileManager?: boolean
  fileManagerDetailView?: boolean
  onFileManagerBack?: () => void
  onFileManagerSelectMedia?: (item: { id: string; turnID: string; width?: number; height?: number; aspectRatio?: string }) => void
  studioCenterWidth?: number
  showStudioCenter?: boolean
  hideFileManagerFilter?: boolean
  turns?: StudioTurnData[]
  canGenerateVideo?: boolean
  sessionID?: string
  fileManagerGenPending?: boolean
  children?: JSX.Element
}): JSX.Element {
  const [fullscreenImage, setFullscreenImage] = createSignal<StudioImage | null>(null)
  const isVideoResult = createMemo(() => props.result?.capability === "video.generate" || isVideoMedia(props.image))
  // 文件管理详情页生成中时隐藏图片和 canvas stage，展示 loading fallback
  const fileManagerLoading = createMemo(() =>
    props.fileManagerDetailView && props.fileManagerGenPending,
  )
  const showImage = createMemo(() => {
    if (fileManagerLoading()) return undefined
    if (props.status === "running" || props.status === "queued" || props.status === "submitting") return undefined
    return props.image
  })
  const shouldShowCanvas = createMemo(() => {
    // 生成中时优先展示 loading fallback（"生成中..."），而非空 canvas 或文件管理
    if (props.status === "running" || props.status === "queued" || props.status === "submitting") return false
    return !!showImage() || (props.showFileManager === true && !fileManagerLoading())
  })
  const [canvasStageRef, setCanvasStageRef] = createSignal<HTMLDivElement | null>(null)
  const [floatingActionsRef, setFloatingActionsRef] = createSignal<HTMLDivElement | null>(null)
  const [compactActions, setCompactActions] = createSignal(false)
  const [editToolsOpen, setEditToolsOpen] = createSignal(false)

  createEffect(() => {
    const stage = canvasStageRef()
    if (!stage) return
    const ro = new ResizeObserver(() => {
      // stage.clientWidth 含 32px×2 的 padding，内联按钮全部展开约需 620px 内容宽度
      // clientWidth >= 750 时内容区足够宽，4 个按钮平铺展示
      setCompactActions(stage.clientWidth < 750)
    })
    ro.observe(stage)
    onCleanup(() => ro.disconnect())
  })

  createEffect(() => {
    const image = fullscreenImage()
    const mountEl = props.fullscreenMount?.() || document.body
    mountEl.style.overflow = image ? "hidden" : ""
    if (!image) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); setFullscreenImage(null) }
    }
    document.addEventListener("keydown", onKeyDown)
    onCleanup(() => {
      const mountEl = props.fullscreenMount?.() || document.body
      mountEl.style.overflow = ""
      document.removeEventListener("keydown", onKeyDown)
    })
  })

  return (
    <>
      <Show when={shouldShowCanvas()} fallback={
        <div class="h-full flex flex-col items-center justify-center text-center">
          <Show when={props.status === "queued" || props.status === "running" || props.status === "submitting"} fallback={
            <Show when={(props.status === "failed" || props.status === "create_failed") && props.result?.error} fallback={<StudioEmptyState />}>
              <div class="max-w-[520px] rounded-[16px] border border-[rgba(180,35,24,0.16)] bg-[rgba(255,244,242,0.92)] px-5 py-4 text-left shadow-sm">
                <div class="text-[16px] font-semibold text-[#b42318]">
                  {props.status === "create_failed" ? "创建失败" : "生成失败"}
                </div>
                <div class="mt-2 text-[12px] leading-[18px] whitespace-pre-wrap break-all text-[#7a271a]">
                  {props.result?.error}
                </div>
              </div>
            </Show>
          }>
            <StudioEmptyState />
          </Show>
        </div>
      }>
        {(() => {
          function tabLabelFor(tabImage: StudioImage, index: number): string {
            const stored = props.tabLabels?.[tabImage.id]
            if (stored) return stored
            const prompt = props.result?.prompt ?? ""
            const firstLine = prompt.split("\n")[0].trim()
            const cleaned = firstLine
              .replace(/[\\/:*?\"<>|，。！？、；：""''（）【】《》!?;:()\[\]{}@#$%^&+=~`]/g, " ")
              .replace(/\s+/g, "-")
              .replace(/^-+|-+$/g, "")
            const prefix = cleaned.length > 20 ? cleaned.slice(0, 20).replace(/-+$/, "") : (cleaned || "image")
            const total = props.result?.images.length ?? 1
            return total > 1 ? `${prefix}-${index + 1}` : prefix
          }
          return (
          <>
            <div class="studio-canvas-header">
              <Show when={props.showFileManagerTab}>
                <span
                  class="studio-canvas-tab studio-canvas-tab-locked"
                  classList={{ active: props.showFileManager }}
                  onClick={() => props.onFileManagerClick?.()}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ "margin-right": "4px", "flex-shrink": "0" }} aria-hidden="true">
                    <path d="M13.6 4.80021C13.5022 4.19132 13.2245 3.68465 12.7667 3.28021C12.3089 2.87576 11.7645 2.67354 11.1333 2.67354L5.95334 2.67354C5.84667 2.48243 5.69112 2.3291 5.48667 2.21354C5.28667 2.10243 5.07334 2.04688 4.84667 2.04688L2.89334 2.04688C2.4889 2.04688 2.11556 2.1491 1.77334 2.35354C1.43556 2.55354 1.16667 2.82465 0.966673 3.16688C0.771118 3.5091 0.67334 3.88243 0.67334 4.28687L0.67334 11.7135C0.67334 12.118 0.771118 12.4935 0.966673 12.8402C1.16667 13.1869 1.43556 13.458 1.77334 13.6535C2.11556 13.8535 2.4889 13.9535 2.89334 13.9535L13.1067 13.9535C13.5111 13.9535 13.8844 13.8535 14.2267 13.6535C14.5645 13.458 14.8333 13.1869 15.0333 12.8402C15.2289 12.4935 15.3267 12.118 15.3267 11.7135L15.3267 6.97354C15.3267 6.45354 15.1645 5.99132 14.84 5.58688C14.5156 5.17799 14.1022 4.91576 13.6 4.80021ZM7.37334 4.75354C7.34223 4.75354 7.31112 4.74687 7.28001 4.73354C7.2489 4.72465 7.22001 4.7091 7.19334 4.68688C7.16667 4.66465 7.14223 4.63799 7.12001 4.60687L6.56001 3.68021L11.1333 3.68021C11.4756 3.68021 11.7778 3.77799 12.04 3.97354C12.3022 4.17354 12.4756 4.43354 12.56 4.75354L7.37334 4.75354ZM14.32 11.7135C14.32 12.0558 14.2 12.3491 13.96 12.5935C13.72 12.838 13.4289 12.9602 13.0867 12.9602L2.89334 12.9602C2.55556 12.9602 2.26667 12.838 2.02667 12.5935C1.78667 12.3491 1.66667 12.0558 1.66667 11.7135L1.66667 4.28687C1.66667 3.94465 1.78667 3.65354 2.02667 3.41354C2.26667 3.17354 2.55556 3.05354 2.89334 3.05354L4.84667 3.05354C4.90001 3.05354 4.95112 3.06687 5.00001 3.09354C5.0489 3.12021 5.08445 3.15576 5.10667 3.20021L6.27334 5.12021C6.38001 5.31132 6.53334 5.46243 6.73334 5.57354C6.93778 5.6891 7.15112 5.74688 7.37334 5.74688L13.1067 5.74688C13.4445 5.74688 13.7333 5.86688 13.9733 6.10688C14.2133 6.34688 14.3333 6.63576 14.3333 6.97354L14.32 11.7135Z" fill="currentColor" fill-rule="nonzero" />
                  </svg>
                  <span class="studio-canvas-label-text">文件管理</span>
                </span>
                <Show when={(props.tabImages && props.tabImages.length > 0) || (!props.showFileManager && props.onSelectImage && props.result?.images && props.result.images.length > 0)}>
                  <span class="studio-canvas-tab-divider" />
                </Show>
              </Show>
              <For each={(props.tabImages && props.tabImages.length > 0) ? props.tabImages : (!props.showFileManager && props.onSelectImage && props.result?.images ? [props.result.images[0]] : [])}>
                {(tabImage, index) => {
                  const tabSource = (props.tabImages && props.tabImages.length > 0) ? props.tabImages : (!props.showFileManager ? [props.result!.images[0]] : [])
                  const [isTabTruncated, setIsTabTruncated] = createSignal(false)
                  let tabLabelRef!: HTMLSpanElement
                  let tabResizeObserver: ResizeObserver | undefined
                  const checkTabTruncation = () => {
                    if (tabLabelRef) setIsTabTruncated(tabLabelRef.scrollWidth > tabLabelRef.clientWidth)
                  }
                  createEffect(() => {
                    void tabLabelFor(tabImage, index())
                    queueMicrotask(() => checkTabTruncation())
                  })
                  onCleanup(() => tabResizeObserver?.disconnect())
                  const [showTabTooltip, setShowTabTooltip] = createSignal(false)
                  let tabTooltipTimeout: ReturnType<typeof setTimeout> | undefined
                  let tabTooltipRef!: HTMLDivElement
                  const [tabTooltipStyle, setTabTooltipStyle] = createSignal<JSX.CSSProperties>({})
                  const updateTabTooltipPos = () => {
                    if (!tabLabelRef) return
                    const rect = tabLabelRef.getBoundingClientRect()
                    const spaceBelow = window.innerHeight - rect.bottom
                    const style: JSX.CSSProperties = { left: `${rect.left}px` }
                    if (spaceBelow >= 130 || spaceBelow >= rect.top) {
                      style.top = `${rect.bottom + 4}px`
                    } else {
                      style.bottom = `${window.innerHeight - rect.top + 4}px`
                    }
                    setTabTooltipStyle(style)
                  }
                  const enterTabTrigger = () => {
                    if (!isTabTruncated()) return
                    clearTimeout(tabTooltipTimeout)
                    updateTabTooltipPos()
                    setShowTabTooltip(true)
                  }
                  const leaveTabTrigger = () => {
                    tabTooltipTimeout = setTimeout(() => setShowTabTooltip(false), 150)
                  }
                  const enterTabTooltip = () => clearTimeout(tabTooltipTimeout)
                  const leaveTabTooltip = () => setShowTabTooltip(false)
                  return (
                    <span
                      class="studio-canvas-tab"
                      classList={{ active: !props.showFileManager && ((props.tabImages && props.tabImages.length > 0)
                        ? (props.result?.images.some((img) => img.id === tabImage.id) ?? false)
                        : tabImage.id === (props.selectedImageId ?? tabSource[0]?.id))
                      }}
                      onClick={() => props.onSelectImage!(tabImage.id)}
                    >
                      <span
                        ref={(el) => { tabLabelRef = el; tabResizeObserver?.disconnect(); tabResizeObserver = new ResizeObserver(() => checkTabTruncation()); tabResizeObserver.observe(el); queueMicrotask(() => checkTabTruncation()) }}
                        class="studio-canvas-label-text"
                        onMouseEnter={enterTabTrigger}
                        onMouseLeave={leaveTabTrigger}
                      >{tabLabelFor(tabImage, index())}</span>
                      <Show when={(props.tabImages && props.tabImages.length > 0) ? Boolean(props.onCloseTab) : Boolean(props.onDeleteImage)}>
                        <span class="studio-canvas-tab-close" onClick={(e) => { e.stopPropagation(); (props.tabImages && props.tabImages.length > 0 ? props.onCloseTab! : props.onDeleteImage!)(tabImage.id); }} />
                      </Show>
                      <Show when={showTabTooltip()}>
                        <Portal>
                          <div
                            ref={tabTooltipRef!}
                            style={{ ...tabTooltipStyle(), "max-width": "300px" }}
                            onMouseEnter={enterTabTooltip}
                            onMouseLeave={leaveTabTooltip}
                            class="studio-custom-tooltip fixed z-[1000]"
                          >
                            {tabLabelFor(tabImage, index())}
                          </div>
                        </Portal>
                      </Show>
                    </span>
                  )
                }}
              </For>
            </div>
            <div class="studio-canvas-body">
              <div style={{ display: props.showFileManager && !props.fileManagerDetailView ? "contents" : "none" }}>
                <StudioFileManager
                  studioCenterWidth={props.studioCenterWidth}
                  showStudioCenter={props.showStudioCenter}
                  hideFilter={props.hideFileManagerFilter}
                  turns={props.turns}
                  canGenerateVideo={props.canGenerateVideo}
                  onSelectMedia={props.onFileManagerSelectMedia}
                  sessionID={props.sessionID}
                />
              </div>
              <Show when={!props.showFileManager || (props.showFileManager && props.fileManagerDetailView) || props.status === "running" || props.status === "queued" || props.status === "submitting"}>
                <div style="display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;container-type:inline-size;">
                <Show when={props.showFileManager && props.fileManagerDetailView}>
                  <div class="studio-file-manager-back-bar">
                    <button
                      type="button"
                      class="studio-file-manager-back-btn"
                      onClick={() => props.onFileManagerBack?.()}
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ "flex-shrink": "0" }}>
                        <path d="M10 3L5 8L10 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                      </svg>
                      <span>返回</span>
                    </button>
                  </div>
                </Show>
              <div ref={setCanvasStageRef} class="studio-canvas-stage" classList={{ "has-back-bar": props.showFileManager && props.fileManagerDetailView }}>
                <div class="studio-canvas-image-wrapper">
                  <Show when={showImage()} fallback={
                    <Show when={props.status === "running" || props.status === "queued" || props.status === "submitting"}>
                      <StudioEmptyState />
                    </Show>
                  }>
                    {(img) => (
                      <Show
                        when={isVideoMedia(img())}
                        fallback={<StudioMediaPreview image={img()} class={`studio-canvas-image ${getImageOrientation(img())}`} onClick={() => setFullscreenImage(img())} />}
                      >
                        <StudioVideoPlayer
                          src={img().remoteUrl ?? img().url}
                          mount={props.videoPlayerMount}
                        />
                      </Show>
                    )}
                  </Show>
                </div>
                <div ref={setFloatingActionsRef} class="studio-canvas-floating-actions">
                  <button
                    type="button"
                    onClick={props.onRegenerate}
                    disabled={props.regenerateDisabled}
                    class="studio-canvas-regenerate-action disabled:opacity-45 disabled:cursor-not-allowed"
                  >
                    再次生成
                  </button>
                  <Show when={props.result?.capability === "image.generate" && props.showVideoGeneration}>
                    <span class="studio-canvas-action-divider" />
                    <button
                      type="button"
                      onClick={props.onGenerateVideo}
                      disabled={props.actionDisabled || !props.image}
                      class="studio-canvas-video-action disabled:opacity-45 disabled:cursor-not-allowed"
                    >
                      视频生成
                    </button>
                  </Show>
                  <Show when={!isVideoResult()}>
                    <span class="studio-canvas-action-divider" />
                    <Show when={!compactActions()} fallback={
                      <DropdownMenu gutter={4} placement="bottom" open={editToolsOpen()} onOpenChange={setEditToolsOpen}>
                        <DropdownMenu.Trigger class="studio-canvas-icon-action disabled:opacity-45 disabled:cursor-not-allowed" disabled={props.actionDisabled}>
                          <span>AI修图</span>
                          <svg width="10" height="6" viewBox="0 0 10 6" fill="none" style={{ "margin-left": "4px", transform: editToolsOpen() ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.15s ease" }}>
                            <path d="M1 1L5 5L9 1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                          </svg>
                        </DropdownMenu.Trigger>
                        <DropdownMenu.Portal>
                          <DropdownMenu.Content>
                            <DropdownMenu.Item onSelect={props.onUpscale} disabled={props.actionDisabled}>
                              <span class="studio-canvas-icon-action-icon studio-canvas-icon-upscale" style={{ width: "16px", height: "16px", "margin-right": "1px" }} />
                              <DropdownMenu.ItemLabel>变清晰</DropdownMenu.ItemLabel>
                            </DropdownMenu.Item>
                            <DropdownMenu.Item onSelect={props.onCutout} disabled={props.actionDisabled}>
                              <span class="studio-canvas-icon-action-icon studio-canvas-icon-cutout" style={{ width: "16px", height: "16px", "margin-right": "1px" }} />
                              <DropdownMenu.ItemLabel>抠图</DropdownMenu.ItemLabel>
                            </DropdownMenu.Item>
                            <DropdownMenu.Item onSelect={props.onInpaint} disabled={props.actionDisabled}>
                              <span class="studio-canvas-icon-action-icon studio-canvas-icon-inpaint" style={{ width: "16px", height: "16px", "margin-right": "1px" }} />
                              <DropdownMenu.ItemLabel>智能重绘</DropdownMenu.ItemLabel>
                            </DropdownMenu.Item>
                            <DropdownMenu.Item onSelect={props.onOutpaint} disabled={props.actionDisabled}>
                              <span class="studio-canvas-icon-action-icon studio-canvas-icon-outpaint" style={{ width: "16px", height: "16px", "margin-right": "1px" }} />
                              <DropdownMenu.ItemLabel>扩图</DropdownMenu.ItemLabel>
                            </DropdownMenu.Item>
                          </DropdownMenu.Content>
                        </DropdownMenu.Portal>
                      </DropdownMenu>
                    }>
                      <div class="studio-canvas-action-group">
                        <button type="button" onClick={props.onUpscale} disabled={props.actionDisabled}
                          class="studio-canvas-icon-action disabled:opacity-45 disabled:cursor-not-allowed" title="变清晰">
                          <span class="studio-canvas-icon-action-icon studio-canvas-icon-upscale" />
                          <span>变清晰</span>
                        </button>
                        <button type="button" onClick={props.onCutout} disabled={props.actionDisabled}
                          class="studio-canvas-icon-action disabled:opacity-45 disabled:cursor-not-allowed" title="抠图">
                          <span class="studio-canvas-icon-action-icon studio-canvas-icon-cutout" />
                          <span>抠图</span>
                        </button>
                        <button type="button" onClick={props.onInpaint} disabled={props.actionDisabled}
                          class="studio-canvas-icon-action disabled:opacity-45 disabled:cursor-not-allowed" title="智能重绘">
                          <span class="studio-canvas-icon-action-icon studio-canvas-icon-inpaint" />
                          <span>智能重绘</span>
                        </button>
                        <button type="button" onClick={props.onOutpaint} disabled={props.actionDisabled}
                          class="studio-canvas-icon-action disabled:opacity-45 disabled:cursor-not-allowed" title="扩图">
                          <span class="studio-canvas-icon-action-icon studio-canvas-icon-outpaint" />
                          <span>扩图</span>
                        </button>
                      </div>
                    </Show>
                    <span class="studio-canvas-action-divider" />
                  </Show>
                  <button type="button" onClick={props.onDownload} class="studio-canvas-download-action">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    <span>下载</span>
                  </button>
                </div>
              </div>
              </div>
              {props.children}
              </Show>
            </div>
          </>
          )
        })()}
      </Show>
      {fullscreenImage() && (
        <Portal mount={props.fullscreenMount?.() || document.body}>
          <div class="studio-fullscreen-overlay" onClick={() => setFullscreenImage(null)}>
            <button type="button" class="studio-fullscreen-close" onClick={(e) => { e.stopPropagation(); setFullscreenImage(null); }} aria-label="关闭全屏">
              <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
                <path d="M18 6L6 18M6 6l12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
              </svg>
            </button>
            <img src={fullscreenImage()!.url} class="studio-fullscreen-image" alt="" />
          </div>
        </Portal>
      )}
    </>
  )
}

export function StudioWorkspaceUpload(props: { onUpload: (files: File[]) => void }): JSX.Element {
  let inputRef!: HTMLInputElement

  return (
    <div
      class="studio-workspace-upload"
      onClick={() => inputRef.click()}
      onDragOver={(event) => {
        event.preventDefault()
        event.currentTarget.classList.add("dragging")
      }}
      onDragLeave={(event) => {
        event.currentTarget.classList.remove("dragging")
      }}
      onDrop={(event) => {
        event.preventDefault()
        event.currentTarget.classList.remove("dragging")
        props.onUpload(Array.from(event.dataTransfer?.files ?? []))
      }}
    >
      <div class="studio-workspace-upload-target">
        <span class="studio-workspace-upload-plus" />
        <span class="studio-workspace-upload-title">上传图片</span>
        <span class="studio-workspace-upload-copy">本地上传/拖拽图片上传</span>
      </div>
      <input
        ref={inputRef!}
        type="file"
        accept=".png,.jpg,.jpeg,.webp"
        class="hidden"
        onChange={(event) => {
          if (event.currentTarget.files?.length) props.onUpload(Array.from(event.currentTarget.files))
          event.currentTarget.value = ""
        }}
      />
    </div>
  )
}

function InfoRow(props: { label: string; value: string }): JSX.Element {
  return (
    <div class="studio-detail-row">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  )
}

export function StudioEmptyState(): JSX.Element {
  return (
    <>
      <div class="studio-empty-state-dots">
        <span class="studio-empty-dot" style={{ width: "12px", height: "12px", top: "80px", left: "44px", background: "#65a2e5", animation: "studio-float-1 2s ease-in-out infinite" }} />
        <span class="studio-empty-dot" style={{ width: "12px", height: "12px", top: "44px", left: "80px", background: "#c3e78b", animation: "studio-float-2 2s ease-in-out infinite 0.35s" }} />
        <span class="studio-empty-dot" style={{ width: "16px", height: "16px", top: "80px", left: "80px", background: "#7bd5a4", animation: "studio-float-3 2s ease-in-out infinite 0.7s" }} />
        <span class="studio-empty-dot" style={{ width: "12px", height: "12px", top: "116px", left: "80px", background: "#7f78f1", animation: "studio-float-4 2s ease-in-out infinite 1.05s" }} />
        <span class="studio-empty-dot" style={{ width: "20px", height: "20px", top: "80px", left: "116px", background: "#5c77f4", animation: "studio-float-5 2s ease-in-out infinite 1.4s" }} />
      </div>
      <div class="text-[14px] font-bold pl-[20px]">生成中...</div>
    </>
  )
}

export function StudioDetails(props: {
  result: StudioGenerationResult
  image?: StudioImage
  selectedImageId?: string
  imageLabel: string
  regenerateDisabled: boolean
  showVideoGeneration: boolean
  onSelectImage: (id: string) => void
  onRegenerate: () => void
  onGenerateVideo: () => void
  onUpscale: () => void
  onCutout: () => void
  onInpaint: () => void
  onOutpaint: () => void
}): JSX.Element {
  const isEditResult = createMemo(() => isStudioEditResult(props.result))
  const isVideoResult = createMemo(() => props.result.capability === "video.generate" || isVideoMedia(props.image))
  const editorTitle = createMemo(() => {
    if (props.result.capability === "image.upscale") return capabilityLabel(props.result.capability)
    if (props.result.capability === "image.cutout") return capabilityLabel(props.result.capability)
    if (props.result.capability === "image.inpaint" || props.result.toolAction === "inpainting") return "智能重绘"
    if (props.result.capability === "image.outpaint" || props.result.toolAction === "outpainting") return "扩图"
    if (props.result.toolAction === "super_resolution") return "变清晰"
    if (props.result.toolAction === "cutout") return "抠图"
    return capabilityLabel(props.result.capability)
  })
  const detailTitle = createMemo(() => isEditResult()
    ? editorTitle()
    : props.result.detailTitle ?? buildStudioDisplayPrompt(props.result.prompt))
  const detailCopy = createMemo(() => {
    if (!isEditResult()) return props.result.prompt
    if (props.result.capability === "image.inpaint" || props.result.capability === "image.outpaint" || props.result.toolAction === "inpainting" || props.result.toolAction === "outpainting") {
      return props.result.detailPrompt?.trim() || "-"
    }
    return "-"
  })
  const resolution = createMemo(() => {
    if (props.image?.width && props.image.height) return `${props.image.width} x ${props.image.height}`
    const dimensions = getDefaultDimensions(props.result.styleModel ?? props.result.model, props.result.aspectRatio)
    return dimensions ? `${dimensions.width} x ${dimensions.height}` : "-"
  })
  const modelLabel = createMemo(() => {
    const m = props.result.styleModel || props.result.model
    const found = STUDIO_STYLE_MODELS.find((item) => item.id === m || item.label === m)
    return found?.label ?? (m || "千问")
  })
  return (
    <ScrollView class="studio-detail-panel">
      <div class="studio-detail-cover">
        <For each={props.result.images}>
          {(image) => (
            <button
              type="button"
              onClick={() => props.onSelectImage(image.id)}
              class="studio-detail-preview-button"
              classList={{ active: image.id === (props.selectedImageId ?? props.result.images[0]?.id) }}
            >
              <StudioMediaPreview image={image} class="studio-detail-preview-image" />
            </button>
          )}
        </For>
      </div>
      <section class="studio-detail-section">
        <div class="studio-detail-title">{detailTitle()}</div>
        <p class="studio-detail-copy">
          {detailCopy()}
        </p>
      </section>
      <section class="studio-detail-section">
        <div class="studio-detail-section-title">生成信息</div>
        <InfoRow label="模型" value={modelLabel()} />
        <Show when={!isEditResult()}>
          <InfoRow label="比例" value={props.result.isCustom ? "自定义" : props.result.aspectRatio} />
        </Show>
        <Show when={isVideoResult()}>
          <InfoRow label="类型" value={props.result.videoMode === "first_last_frame" ? "首尾帧生成" : "文生视频"} />
          <InfoRow label="时长" value={props.result.duration ? `${props.result.duration}秒` : "-"} />
        </Show>
        <Show when={!isVideoResult() && !isEditResult()}>
          <InfoRow label="分辨率" value={resolution()} />
        </Show>
        <InfoRow label="数量" value={`${props.result.images.length}`} />
        <InfoRow label="当前" value={`${Math.max(props.result.images.findIndex((item) => item.id === (props.selectedImageId ?? props.result.images[0]?.id)) + 1, 1)}/${props.result.images.length}`} />
      </section>
      <section class="studio-detail-section">
        <Show when={!isEditResult()}>
          <div class="studio-detail-section-title">提示词</div>
          <p class="studio-detail-prompt">{(props.result.detailPrompt ?? props.result.prompt).split("\n")[0]}</p>
        </Show>
      </section>
    </ScrollView>
  )
}
