import { createEffect, createMemo, createSignal, For, onCleanup, Show, type JSX } from "solid-js"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { buildStudioDisplayPrompt, type StudioTurnData } from "./turns"
import { StudioResultCard } from "./studio-result-card"
import { isStudioEditResult, isVideoMedia } from "./studio-shared"
import { STUDIO_STYLE_MODELS } from "./data"
import { StudioVideoPlayer } from "./studio-video-player"
import type { StudioCapability, StudioGenerationResult, StudioGenerationStatus, StudioImage } from "./types"

export function StudioConversation(props: {
  result?: StudioGenerationResult
  turns: StudioTurnData[]
  busy: boolean
  cancellingGenerationIDs: ReadonlySet<string>
  onCancelGeneration: (generationID: string) => void
  onSelectImage: (input: { resultID: string; imageID: string }) => void
  onOpenEditor: (capability: StudioCapability) => void
}): JSX.Element {
  return (
    <div class="studio-conversation">
      <For each={props.turns}>
        {(turn, index) => (
          <div class="studio-conversation-turn" classList={{ separated: index() > 0 }}>
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
                cancelling={Boolean(turn.result && props.cancellingGenerationIDs.has(turn.result.id))}
                onCancelGeneration={props.onCancelGeneration}
                onSelectImage={props.onSelectImage}
              />
            </Show>
          </div>
        )}
      </For>
    </div>
  )
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
}): JSX.Element {
  const [fullscreenImage, setFullscreenImage] = createSignal<StudioImage | null>(null)

  createEffect(() => {
    const image = fullscreenImage()
    document.body.style.overflow = image ? "hidden" : ""
    document.body.classList.toggle("studio-fullscreen-active", !!image)
    if (!image) return
    ;(window as any).api?.setTitlebarOverlayHidden?.(true)
    ;(window as any).api?.showFullscreenOverlay?.(image.url).then(() => setFullscreenImage(null))
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); setFullscreenImage(null) }
    }
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (fullscreenImage()) { setFullscreenImage(null); e.preventDefault() }
    }
    document.addEventListener("keydown", onKeyDown)
    window.addEventListener("beforeunload", onBeforeUnload)
    onCleanup(() => {
      ;(window as any).api?.setTitlebarOverlayHidden?.(false)
      document.body.style.overflow = ""
      document.body.classList.remove("studio-fullscreen-active")
      document.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("beforeunload", onBeforeUnload)
    })
  })

  return (
    <>
      <Show when={props.image} fallback={
        <div class="h-full flex flex-col items-center justify-center text-center">
          <Show when={props.status === "queued" || props.status === "running" || props.status === "submitting"} fallback={
            <Show when={props.status === "failed" && props.result?.error} fallback={<StudioEmptyState />}>
              <div class="max-w-[520px] rounded-[16px] border border-[rgba(180,35,24,0.16)] bg-[rgba(255,244,242,0.92)] px-5 py-4 text-left shadow-sm">
                <div class="text-[16px] font-semibold text-[#b42318]">生成失败</div>
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
        {(image) => {
          function tabLabelFor(tabImage: StudioImage, index: number): string {
            const video = isVideoMedia(tabImage)
            const ext = video ? "mp4" : "png"
            const stored = props.tabLabels?.[tabImage.id]
            if (stored) return `${stored}.${ext}`
            const prompt = props.result?.prompt ?? ""
            const firstLine = prompt.split("\n")[0].trim()
            const cleaned = firstLine
              .replace(/[\\/:*?\"<>|，。！？、；：""''（）【】《》!?;:()\[\]{}@#$%^&+=~`]/g, " ")
              .replace(/\s+/g, "-")
              .replace(/^-+|-+$/g, "")
            const prefix = cleaned.length > 20 ? cleaned.slice(0, 20).replace(/-+$/, "") : (cleaned || "image")
            const total = props.result?.images.length ?? 1
            return total > 1 ? `${prefix}-${index + 1}.${ext}` : `${prefix}.${ext}`
          }
          return (
          <>
            <div class="studio-canvas-header">
              <For each={(props.tabImages && props.tabImages.length > 0) ? props.tabImages : (props.onSelectImage && props.result?.images ? [props.result.images[0]] : [])}>
                {(tabImage, index) => {
                  const tabSource = (props.tabImages && props.tabImages.length > 0) ? props.tabImages : [props.result!.images[0]]
                  return (
                    <span
                      class="studio-canvas-tab"
                      classList={{ active: (props.tabImages && props.tabImages.length > 0)
                        ? (props.result?.images.some((img) => img.id === tabImage.id) ?? false)
                        : tabImage.id === (props.selectedImageId ?? tabSource[0]?.id)
                      }}
                      onClick={() => props.onSelectImage!(tabImage.id)}
                    >
                      <span class="studio-canvas-label-text">{tabLabelFor(tabImage, index())}</span>
                      <Show when={(props.tabImages && props.tabImages.length > 0) ? Boolean(props.onCloseTab) : Boolean(props.onDeleteImage)}>
                        <span class="studio-canvas-tab-close" onClick={(e) => { e.stopPropagation(); (props.tabImages && props.tabImages.length > 0 ? props.onCloseTab! : props.onDeleteImage!)(tabImage.id); }} />
                      </Show>
                    </span>
                  )
                }}
              </For>
            </div>
            <div class="studio-canvas-stage">
              <Show
                when={isVideoMedia(image())}
                fallback={<StudioMediaPreview image={image()} class="studio-canvas-image" onClick={() => setFullscreenImage(image())} />}
              >
                <StudioVideoPlayer
                  src={image().remoteUrl ?? image().url}
                  poster={image().thumbnailUrl}
                  class="studio-canvas-image"
                />
              </Show>
            </div>
            <div class="studio-canvas-floating-actions">
              <button type="button" onClick={props.onDownload} class="studio-canvas-download-action" title="下载">下载</button>
            </div>
          </>
          )
        }
        }
      </Show>
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
        accept="image/*"
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
        <div class="studio-detail-title">{buildStudioDisplayPrompt(props.result.prompt)}</div>
        <p class="studio-detail-copy">
          {props.result.prompt}
        </p>
      </section>
      <section class="studio-detail-section">
        <div class="studio-detail-section-title">生成信息</div>
        <InfoRow label="模型" value={modelLabel()} />
        <Show when={!isEditResult()}>
          <InfoRow label="比例" value={props.result.aspectRatio} />
        </Show>
        <Show when={isVideoResult()}>
          <InfoRow label="类型" value={props.result.videoMode === "first_last_frame" ? "首尾帧生成" : "文生视频"} />
          <InfoRow label="时长" value={props.result.duration ? `${props.result.duration}秒` : "-"} />
        </Show>
        <Show when={!isVideoResult() && !isEditResult()}>
          <InfoRow label="分辨率" value={props.image?.width && props.image.height ? `${props.image.width} x ${props.image.height}` : "-"} />
        </Show>
        <InfoRow label="数量" value={`${props.result.images.length}`} />
        <InfoRow label="当前" value={`${Math.max(props.result.images.findIndex((item) => item.id === (props.selectedImageId ?? props.result.images[0]?.id)) + 1, 1)}/${props.result.images.length}`} />
      </section>
      <section class="studio-detail-section">
        <Show when={!isEditResult()}>
          <div class="studio-detail-section-title">提示词</div>
          <p class="studio-detail-prompt">{props.result.prompt.split("\n")[0]}</p>
          <Show when={props.result.capability === "image.generate" && props.showVideoGeneration}>
            <button
              type="button"
              onClick={props.onGenerateVideo}
              disabled={props.regenerateDisabled || !props.image}
              class="studio-details-primary-action studio-details-secondary-action studio-details-video-action disabled:opacity-45 disabled:cursor-not-allowed"
            >
              视频生成
            </button>
          </Show>
        </Show>
        <button
          type="button"
          onClick={props.onRegenerate}
          disabled={props.regenerateDisabled}
          class="studio-details-primary-action disabled:opacity-45 disabled:cursor-not-allowed"
        >
          再次生成
        </button>
        <Show when={!isVideoResult()}>
          <div class="studio-detail-action-grid">
            <button
              type="button"
              onClick={props.onUpscale}
              disabled={props.regenerateDisabled}
              class="studio-details-secondary-action studio-detail-action-upscale disabled:opacity-45 disabled:cursor-not-allowed"
            >
              <span>变清晰</span>
            </button>
            <button
              type="button"
              onClick={props.onCutout}
              disabled={props.regenerateDisabled}
              class="studio-details-secondary-action studio-detail-action-cutout disabled:opacity-45 disabled:cursor-not-allowed"
            >
              <span>抠图</span>
            </button>
            <button
              type="button"
              onClick={props.onInpaint}
              disabled={props.regenerateDisabled}
              class="studio-details-secondary-action studio-detail-action-inpaint disabled:opacity-45 disabled:cursor-not-allowed"
            >
              <span>智能重绘</span>
            </button>
            <button
              type="button"
              onClick={props.onOutpaint}
              disabled={props.regenerateDisabled}
              class="studio-details-secondary-action studio-detail-action-outpaint disabled:opacity-45 disabled:cursor-not-allowed"
            >
              <span>扩图</span>
            </button>
          </div>
        </Show>
      </section>
    </ScrollView>
  )
}
