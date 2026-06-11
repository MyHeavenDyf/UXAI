import { createMemo, For, onCleanup, Show, type JSX, type Resource } from "solid-js"
import IconHost from "@/pages/_shell/icons/IconHost.svg"
import { STUDIO_ASPECT_RATIOS, STUDIO_CAPABILITIES, STUDIO_STYLE_MODELS, capabilityLabel, styleModelLabel } from "./data"
import { STUDIO_VIDEO_ASPECT_RATIOS, SUPPORTED_STUDIO_CAPABILITIES, workspaceModeForCapability, type StudioVideoDuration, type StudioVideoFrameSlot, type StudioVideoQualityMode } from "./studio-shared"
import { MaterialMenu, type MaterialWordBook } from "./MaterialMenu"
import type { StudioAsset, StudioAspectRatio, StudioCapability, StudioGenerationStatus } from "./types"
import { StudioVideoRiskContent } from "./studio-video-risk-dialog"

export function StudioIntro(): JSX.Element {
  return (
    <div class="studio-intro">
      <img src={IconHost} width={166} height={166} alt="" style={{ "flex-shrink": "0" }} />
      <div class="studio-intro-copy">
        <div class="studio-intro-title">Octo Studio</div>
        <div class="studio-intro-subtitle">一键创意落地，让视觉生产力触手可及</div>
      </div>
    </div>
  )
}

export function StudioComposer(props: {
  prompt: string
  capability: StudioCapability
  canGenerateVideo: boolean
  styleModel: string
  aspectRatio: StudioAspectRatio
  count: 1 | 2 | 3 | 4
  assets: StudioAsset[]
  videoFrames: { first?: StudioAsset; last?: StudioAsset }
  videoDuration: StudioVideoDuration
  videoQualityMode: StudioVideoQualityMode
  videoQualityLocked: boolean
  status: StudioGenerationStatus
  openMenu: "capability" | "style" | "settings" | "material" | null
  canSubmit: boolean
  wordBook?: Resource<MaterialWordBook[]>
  onPrompt: (value: string) => void
  onCapability: (value: StudioCapability) => void
  onStyleModel: (value: string) => void
  onAspectRatio: (value: StudioAspectRatio) => void
  onCount: (value: 1 | 2 | 3 | 4) => void
  onVideoDuration: (value: StudioVideoDuration) => void
  onVideoQualityMode: (value: StudioVideoQualityMode) => void
  onOpenMenu: (value: "capability" | "style" | "settings" | "material" | null) => void
  onSubmit: () => void
  onKeyDown: (event: KeyboardEvent) => void
  onPickFile: () => void
  onPickVideoFrame: (slot: StudioVideoFrameSlot) => void
  onPasteImage: (files: File[]) => void
  onRemoveAsset: (id: string) => void
  onRemoveVideoFrame: (slot: StudioVideoFrameSlot) => void
  onSwapVideoFrames: () => void
}): JSX.Element {
  let pointerDownOpenMenu: typeof props.openMenu = null
  const referenceAsset = createMemo(() => props.assets[0])
  const isImageGeneration = createMemo(() => props.capability === "image.generate")
  const isVideoGeneration = createMemo(() => props.capability === "video.generate")
  const isEditingCapability = createMemo(() => Boolean(workspaceModeForCapability(props.capability)))

  function handlePaste(event: ClipboardEvent) {
    if (!isImageGeneration() && !isVideoGeneration()) return
    const files = Array.from(event.clipboardData?.items ?? [])
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file))
    if (!files.length) return
    event.preventDefault()
    props.onPasteImage(files)
  }

  const handleDocumentPointerDown = (event: PointerEvent) => {
    if (!props.openMenu) return
    if (event.target instanceof Element && event.target.closest(".studio-menu")) return
    props.onOpenMenu(null)
  }

  document.addEventListener("pointerdown", handleDocumentPointerDown)
  onCleanup(() => document.removeEventListener("pointerdown", handleDocumentPointerDown))

  return (
    <div class="studio-composer-wrap relative shrink-0">
      <div class="studio-composer" classList={{ video: isVideoGeneration() }}>
        <Show when={isVideoGeneration()}>
          <div class="studio-composer-video-frames">
            <VideoFrameButton
              label="首帧"
              asset={props.videoFrames.first}
              onPick={() => props.onPickVideoFrame("first")}
              onRemove={() => props.onRemoveVideoFrame("first")}
            />
            <button type="button" class="studio-composer-video-swap" onClick={props.onSwapVideoFrames} aria-label="交换首尾帧" title="交换首尾帧">
              <img src="/studio/ic_public_switchover.svg" class="studio-composer-video-swap-icon" alt="" />
            </button>
            <VideoFrameButton
              label="尾帧"
              asset={props.videoFrames.last}
              onPick={() => props.onPickVideoFrame("last")}
              onRemove={() => props.onRemoveVideoFrame("last")}
            />
          </div>
        </Show>
        <div class="studio-composer-input-row" classList={{ "with-reference": isImageGeneration() }}>
          <Show when={isImageGeneration()}>
            <div class="studio-composer-ref-slot" classList={{ filled: Boolean(referenceAsset()) }}>
              <button
                type="button"
                onClick={props.onPickFile}
                class="studio-composer-ref-btn"
                title={referenceAsset() ? "替换参考图" : "上传参考图"}
              >
                <Show when={referenceAsset()}>
                  {(asset) => <img src={asset().dataUrl} alt={asset().name} class="studio-composer-ref-image" />}
                </Show>
              </button>
              <Show when={referenceAsset()}>
                {(asset) => (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      props.onRemoveAsset(asset().id)
                    }}
                    class="studio-composer-ref-remove"
                    aria-label="删除参考图"
                    title="删除参考图"
                  >
                    ×
                  </button>
                )}
              </Show>
            </div>
          </Show>
          <textarea
            value={props.prompt}
            onInput={(event) => props.onPrompt(event.currentTarget.value)}
            onKeyDown={props.onKeyDown}
            onPaste={handlePaste}
            placeholder={isVideoGeneration() ? "请描述你想生成的视频内容，或使用反推描述图片，也可查看使用指南提升生成效果。" : "上传参考图、输入文字，描述你想生成的图片。"}
            class="studio-composer-input"
            disabled={isEditingCapability() || props.status === "queued" || props.status === "running" || props.status === "submitting"}
          />
        </div>

        <div class="studio-composer-toolbar">
          <div class="relative">
            <Show when={props.openMenu === "capability"}>
              <CapabilityMenu
                value={props.capability}
                canGenerateVideo={props.canGenerateVideo}
                onSelect={(value) => { props.onCapability(value); props.onOpenMenu(null) }}
              />
            </Show>
            <ToolButton
              label={capabilityLabel(props.capability)}
              active={props.openMenu === "capability"}
              onPointerDown={() => { pointerDownOpenMenu = props.openMenu }}
              onClick={() => props.onOpenMenu(pointerDownOpenMenu === "capability" ? null : "capability")}
            />
          </div>
          <Show when={isImageGeneration()}>
            <div class="relative">
              <Show when={isImageGeneration() && props.openMenu === "style"}>
                <StyleMenu value={props.styleModel} onSelect={(value) => { props.onStyleModel(value); props.onOpenMenu(null) }} />
              </Show>
              <ToolButton
                label={styleModelLabel(props.styleModel)}
                active={props.openMenu === "style"}
                onPointerDown={() => { pointerDownOpenMenu = props.openMenu }}
                onClick={() => props.onOpenMenu(pointerDownOpenMenu === "style" ? null : "style")}
              />
            </div>
            <div class="relative">
              <Show when={isImageGeneration() && props.openMenu === "settings"}>
                <ImageSettings
                  aspectRatio={props.aspectRatio}
                  count={props.count}
                  onAspectRatio={props.onAspectRatio}
                  onCount={props.onCount}
                />
              </Show>
              <IconTool
                label="参数"
                onPointerDown={() => { pointerDownOpenMenu = props.openMenu }}
                onClick={() => props.onOpenMenu(pointerDownOpenMenu === "settings" ? null : "settings")}
              />
            </div>
            <div class="relative">
              <Show when={isImageGeneration() && props.openMenu === "material" && props.wordBook}>
                <MaterialMenu wordBook={props.wordBook!} onSelectTag={(tag) => props.onPrompt(props.prompt ? props.prompt + "，" + tag : tag)} />
              </Show>
              <IconTool
                label="词书"
                onPointerDown={() => { pointerDownOpenMenu = props.openMenu }}
                onClick={() => props.onOpenMenu(pointerDownOpenMenu === "material" ? null : "material")}
              />
            </div>
          </Show>
          <Show when={isVideoGeneration()}>
            <div class="relative">
              <Show when={props.openMenu === "settings"}>
                <VideoSettings
                  aspectRatio={props.aspectRatio}
                  count={props.count}
                  duration={props.videoDuration}
                  qualityMode={props.videoQualityMode}
                  qualityLocked={props.videoQualityLocked}
                  onAspectRatio={props.onAspectRatio}
                  onCount={props.onCount}
                  onDuration={props.onVideoDuration}
                  onQualityMode={props.onVideoQualityMode}
                />
              </Show>
              <IconTool
                label="参数"
                onPointerDown={() => { pointerDownOpenMenu = props.openMenu }}
                onClick={() => props.onOpenMenu(pointerDownOpenMenu === "settings" ? null : "settings")}
              />
            </div>
          </Show>
          <button
            type="button"
            onClick={props.onSubmit}
            disabled={!props.canSubmit}
            class="studio-composer-send"
            title="生成"
          />
        </div>
      </div>
      <div class="studio-composer-compliance">
        <span>遵守</span>
        <div class="studio-composer-compliance-guide">
          <button type="button" class="studio-composer-compliance-trigger">合规指引</button>
          <span>，</span>
          <div role="tooltip" class="studio-composer-compliance-tooltip">
            <StudioVideoRiskContent class="studio-composer-compliance-tooltip-content" />
            <span class="studio-composer-compliance-tooltip-arrow" />
          </div>
        </div>
        <span>严禁上传内部敏感信息</span>
      </div>
    </div>
  )
}

function ToolButton(props: { label: string; active?: boolean; onClick: () => void; onPointerDown?: () => void }): JSX.Element {
  return (
    <button type="button" onPointerDown={props.onPointerDown} onClick={props.onClick} class="studio-composer-tool-btn" data-active={props.active ? "" : undefined}>
      <span class="studio-composer-tool-label">{props.label}</span>
      <span class="studio-composer-tool-caret" />
    </button>
  )
}

function IconTool(props: { label: string; title?: string; onClick?: () => void; onPointerDown?: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onPointerDown={props.onPointerDown}
      onClick={props.onClick}
      class={`studio-composer-icon-tool ${props.label === "参数" ? "studio-composer-icon-settings" : "studio-composer-icon-material"}`}
      title={props.title ?? props.label}
      aria-label={props.label}
    />
  )
}

function VideoFrameButton(props: { label: string; asset?: StudioAsset; onPick: () => void; onRemove: () => void }): JSX.Element {
  return (
    <div class="studio-composer-video-frame-wrap">
      <button
        type="button"
        onClick={props.onPick}
        class="studio-composer-video-frame"
        classList={{ filled: Boolean(props.asset) }}
        title={props.asset ? `替换${props.label}` : `上传${props.label}`}
      >
        <Show when={props.asset} fallback={
          <>
            <img src="/studio/studio_public_plus.svg" class="studio-composer-video-plus" alt="" />
            <span class="studio-composer-video-label">{props.label}</span>
          </>
        }>
          {(asset) => <img src={asset().dataUrl} alt={asset().name} class="studio-composer-video-image" />}
        </Show>
      </button>
      <Show when={props.asset}>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            props.onRemove()
          }}
          class="studio-composer-video-remove"
          aria-label={`删除${props.label}`}
          title={`删除${props.label}`}
        >
          ×
        </button>
      </Show>
    </div>
  )
}

function CapabilityMenu(props: {
  value: StudioCapability
  canGenerateVideo: boolean
  onSelect: (value: StudioCapability) => void
}): JSX.Element {
  return (
    <div class="studio-menu w-[175px] p-1">
      <For each={STUDIO_CAPABILITIES
        .map((item, index) => ({ item, index }))
        .filter((entry) => entry.item.id !== "video.generate" || props.canGenerateVideo)}
      >
        {(entry) => (
          <>
            <button
              type="button"
              onClick={() => props.onSelect(entry.item.id)}
              disabled={!SUPPORTED_STUDIO_CAPABILITIES.has(entry.item.id)}
              class="studio-capability-option"
              classList={{
                active: entry.item.id === props.value,
                "opacity-45 cursor-not-allowed": !SUPPORTED_STUDIO_CAPABILITIES.has(entry.item.id),
              }}
              title={SUPPORTED_STUDIO_CAPABILITIES.has(entry.item.id) ? entry.item.description : "即将支持"}
            >
              <span class={`studio-capability-icon studio-capability-icon-${entry.index + 1}`} />
              <span class="studio-capability-label">{entry.item.label}</span>
            </button>
            <Show when={
              entry.item.id === (props.canGenerateVideo ? "video.generate" : "image.generate") ||
              entry.item.id === "image.outpaint"
            }>
              <div style={{ height: "1px", background: "rgba(0,0,0,0.1)", margin: "0 12px" }} />
            </Show>
          </>
        )}
      </For>
    </div>
  )
}

function StyleMenu(props: { value: string; onSelect: (value: string) => void }): JSX.Element {
  return (
    <div class="studio-menu w-[414px] p-4">
      <div class="text-[13px] font-semibold mb-3">风格模型</div>
      <div class="grid grid-cols-2 gap-x-4 gap-y-3">
        <For each={STUDIO_STYLE_MODELS}>
          {(item, index) => (
            <button
              type="button"
              onClick={() => props.onSelect(item.id)}
              class="studio-style-option"
              classList={{ active: item.id === props.value }}
            >
              <span class={`studio-style-icon studio-style-icon-${index() + 1}`} />
              <span class="studio-style-label">{item.label}</span>
              <Show when={item.id === props.value}>
                <span class="studio-style-check" />
              </Show>
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
    <div class="studio-menu studio-image-settings-menu">
      <div class="studio-image-settings-title">图片设置</div>
      <div class="studio-image-settings-label">选择比例</div>
      <div class="studio-image-settings-ratios">
        <For each={STUDIO_ASPECT_RATIOS}>
          {(item) => (
            <button
              type="button"
              onClick={() => props.onAspectRatio(item)}
              class="studio-image-settings-ratio"
              classList={{ active: item === props.aspectRatio }}
              aria-pressed={item === props.aspectRatio}
            >
              <span
                class="studio-image-settings-ratio-icon"
                style={{
                  "aspect-ratio": item.replace(":", " / "),
                  width: item === "1:1" ? "22px" : item === "2:3" || item === "3:4" || item === "9:16" ? "14px" : "28px",
                }}
              />
              <span class="studio-image-settings-ratio-text">{item}</span>
            </button>
          )}
        </For>
      </div>
      <div class="studio-image-settings-label">图片数量</div>
      <div class="studio-image-settings-counts">
        <For each={[1, 2, 3, 4] as const}>
          {(item) => (
            <button
              type="button"
              onClick={() => props.onCount(item)}
              class="studio-image-settings-count"
              classList={{ active: item === props.count }}
              aria-pressed={item === props.count}
            >
              {item}张
            </button>
          )}
        </For>
      </div>
    </div>
  )
}

function VideoSettings(props: {
  aspectRatio: StudioAspectRatio
  count: 1 | 2 | 3 | 4
  duration: StudioVideoDuration
  qualityMode: StudioVideoQualityMode
  qualityLocked: boolean
  onAspectRatio: (value: StudioAspectRatio) => void
  onCount: (value: 1 | 2 | 3 | 4) => void
  onDuration: (value: StudioVideoDuration) => void
  onQualityMode: (value: StudioVideoQualityMode) => void
}): JSX.Element {
  return (
    <div class="studio-menu studio-image-settings-menu studio-video-settings-menu">
      <div class="studio-image-settings-title">视频设置</div>
      <div class="studio-image-settings-label">选择比例</div>
      <div class="studio-image-settings-ratios studio-video-settings-ratios">
        <For each={STUDIO_VIDEO_ASPECT_RATIOS}>
          {(item) => (
            <button
              type="button"
              onClick={() => props.onAspectRatio(item)}
              class="studio-image-settings-ratio"
              classList={{ active: item === props.aspectRatio }}
              aria-pressed={item === props.aspectRatio}
            >
              <span
                class="studio-image-settings-ratio-icon"
                style={{
                  "aspect-ratio": item.replace(":", " / "),
                  width: item === "1:1" ? "22px" : item === "9:16" ? "14px" : "28px",
                }}
              />
              <span class="studio-image-settings-ratio-text">{item}</span>
            </button>
          )}
        </For>
      </div>
      <div class="studio-image-settings-label">视频时长</div>
      <div class="studio-image-settings-counts studio-video-settings-duration">
        <For each={["5", "10"] as const}>
          {(item) => (
            <button
              type="button"
              onClick={() => props.onDuration(item)}
              class="studio-image-settings-count"
              classList={{ active: item === props.duration }}
              aria-pressed={item === props.duration}
            >
              {item}秒
            </button>
          )}
        </For>
      </div>
      <div class="studio-image-settings-label">视频数量</div>
      <div class="studio-image-settings-counts studio-video-settings-count">
        <For each={[1, 2, 3, 4] as const}>
          {(item) => (
            <button
              type="button"
              onClick={() => props.onCount(item)}
              class="studio-image-settings-count"
              classList={{ active: item === props.count }}
              aria-pressed={item === props.count}
            >
              {item}个
            </button>
          )}
        </For>
      </div>
      <div class="studio-image-settings-label">生成模式</div>
      <div class="studio-image-settings-counts studio-video-settings-quality">
        <For each={[
          { label: "标准", value: "std" },
          { label: "高质量", value: "pro" },
        ] as const}>
          {(item) => (
            <button
              type="button"
              onClick={() => props.onQualityMode(item.value)}
              disabled={props.qualityLocked}
              class="studio-image-settings-count"
              classList={{ active: item.value === props.qualityMode }}
              aria-pressed={item.value === props.qualityMode}
            >
              {item.label}
            </button>
          )}
        </For>
      </div>
    </div>
  )
}
