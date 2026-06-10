import { createMemo, For, Show, type JSX } from "solid-js"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { buildStudioDisplayPrompt, type StudioTurnData } from "./turns"
import { StudioResultCard } from "./studio-result-card"
import { isStudioEditResult, isVideoMedia } from "./studio-shared"
import type { StudioCapability, StudioGenerationResult, StudioGenerationStatus, StudioImage } from "./types"

export function StudioConversation(props: {
  result?: StudioGenerationResult
  turns: StudioTurnData[]
  busy: boolean
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

export function StudioMediaPreview(props: { image: StudioImage; class?: string; controls?: boolean }): JSX.Element {
  return (
    <Show when={isVideoMedia(props.image)} fallback={
      <img src={props.image.thumbnailUrl ?? props.image.url} class={props.class} alt="" />
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
  onDownload: () => void
  onSelectImage?: (id: string) => void
  onDeleteImage?: (id: string) => void
  onCloseTab?: (id: string) => void
}): JSX.Element {
  return (
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
          const match = props.imageLabel?.match(/^(.+)-(\d+)\.\w+$/)
          const prefix = match ? match[1] : "image"
          return `${prefix}-${index + 1}.${ext}`
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
                    classList={{ active: tabImage.id === (props.selectedImageId ?? tabSource[0]?.id) }}
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
            <StudioMediaPreview image={image()} class="studio-canvas-image" controls={isVideoMedia(image())} />
          </div>
          <div class="studio-canvas-floating-actions">
            <button type="button" onClick={props.onDownload} class="studio-canvas-download-action" title="下载">下载</button>
          </div>
        </>
        )
      }
      }
    </Show>
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

function StudioEmptyState(): JSX.Element {
  return (
    <>
      <div class="studio-empty-state-dots">
        <span class="studio-empty-dot" style={{ width: "10px", height: "10px", top: "74px", left: "98px", background: "#5ecb6b", animation: "studio-float-1 2s ease-in-out infinite" }} />
        <span class="studio-empty-dot" style={{ width: "14px", height: "14px", top: "100px", left: "72px", background: "#45bcc9", animation: "studio-float-2 2s ease-in-out infinite 0.35s" }} />
        <span class="studio-empty-dot" style={{ width: "22px", height: "22px", top: "98px", left: "116px", background: "#2e9dfb", animation: "studio-float-3 2s ease-in-out infinite 0.7s" }} />
        <span class="studio-empty-dot" style={{ width: "16px", height: "16px", top: "127px", left: "93px", background: "#7c5cef", animation: "studio-float-4 2s ease-in-out infinite 1.05s" }} />
      </div>
      <div class="text-[14px] font-bold -mt-[30px]">生成中...</div>
    </>
  )
}

export function StudioDetails(props: {
  result: StudioGenerationResult
  image?: StudioImage
  selectedImageId?: string
  imageLabel: string
  regenerateDisabled: boolean
  onSelectImage: (id: string) => void
  onRegenerate: () => void
  onUpscale: () => void
  onCutout: () => void
  onInpaint: () => void
  onOutpaint: () => void
}): JSX.Element {
  const isEditResult = createMemo(() => isStudioEditResult(props.result))
  const isVideoResult = createMemo(() => props.result.capability === "video.generate" || isVideoMedia(props.image))
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
        <InfoRow label="模型" value={props.result.model} />
        <InfoRow label="比例" value={props.result.aspectRatio} />
        <Show when={isVideoResult()}>
          <InfoRow label="类型" value={props.result.videoMode === "first_last_frame" ? "首尾帧生成" : "文生视频"} />
          <InfoRow label="时长" value={props.result.duration ? `${props.result.duration}秒` : "-"} />
        </Show>
        <Show when={!isVideoResult()}>
          <InfoRow label="分辨率" value={props.image?.width && props.image.height ? `${props.image.width} x ${props.image.height}` : "-"} />
        </Show>
        <InfoRow label="数量" value={`${props.result.images.length}`} />
        <InfoRow label="当前" value={`${Math.max(props.result.images.findIndex((item) => item.id === (props.selectedImageId ?? props.result.images[0]?.id)) + 1, 1)}/${props.result.images.length}`} />
      </section>
      <section class="studio-detail-section">
        <Show when={!isEditResult()}>
          <div class="studio-detail-section-title">提示词</div>
          <p class="studio-detail-prompt">{props.result.prompt.split("\n")[0]}</p>
          <button
            type="button"
            onClick={props.onRegenerate}
            disabled={props.regenerateDisabled}
            class="studio-details-primary-action disabled:opacity-45 disabled:cursor-not-allowed"
          >
            再次生成
          </button>
        </Show>
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
