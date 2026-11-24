import { For, Show } from "solid-js"
import {
  boardFrameSourceCount,
  BOARD_VIDEO_REFERENCE_LIMIT,
  type BoardCard,
  type BoardDocument,
  type BoardReference,
  type BoardSettings,
} from "@opencode-ai/core/studio-board"
import {
  StyleMenu,
  ImageSettings,
  VideoSettings,
  ToolButton,
  IconTool,
  StudioToolbarTooltip,
  VideoFrameButton,
  VideoModeMenu,
} from "../studio-composer"
import { studioPermissionState } from "../studio-permission-store"
import { referenceImageLimit, styleModelLabel } from "../data"
import { StudioReferenceImages, StudioImageSettingsLabel, StudioMentionMenu } from "../studio-composer-parts"
import { getDefaultDimensions, STUDIO_VIDEO_INPUT_MODES } from "../studio-shared"

export function StudioBoardComposer(props: {
  card: BoardCard
  document: BoardDocument
  references: BoardReference[]
  anchor: { left: number; top: number; width: number }
  hidden?: boolean
  blocked: boolean
  canGenerate: boolean
  menusBlocked: boolean
  menuTab: string
  showMentionEntry: boolean
  demo?: boolean
  mediaURL: (value?: string) => string | undefined
  elements: {
    composer: (element: HTMLDivElement) => void
    uploadInput: (element: HTMLInputElement) => void
    dropdown: (element: HTMLDivElement) => void
    menuButton: (tab: string, element: HTMLDivElement) => void
  }
  onUpload: (files: File[]) => void
  onDropUpload: (files: File[], role: BoardReference["role"]) => void
  onSwapFrames: () => void
  onPickUpload: (role: BoardReference["role"]) => void
  onRemoveReference: (reference: BoardReference) => void
  onPrompt: (value: string) => void
  onMenuTab: (tab: string) => void
  onStyleModel: (model: string) => void
  onSetting: <K extends keyof BoardSettings>(key: K, value: BoardSettings[K]) => void
  onMention: (index: number) => void
  onGenerate: () => void
  onRetryPermission: () => void
}) {
  let input!: HTMLTextAreaElement
  const inputMode = () => props.card.draft.settings.videoInputMode ?? "first-last-frame"
  const firstLastFrame = () => props.card.kind === "video" && inputMode() === "first-last-frame"
  const frame = (role: BoardReference["role"]) => props.references.find((ref) => ref.role === role)
  const drop = (event: DragEvent, role: BoardReference["role"]) => {
    const files = Array.from(event.dataTransfer?.files ?? []).filter((file) => file.type.startsWith("image/"))
    if (!files.length || props.blocked) return
    event.preventDefault()
    event.stopPropagation()
    props.onDropUpload(files, role)
  }
  return (
    <div
      ref={props.elements.composer}
      class="studio-board-composer"
      classList={{ video: firstLastFrame() }}
      role="region"
      aria-label={`${props.card.title}的生成输入区`}
      style={{
        left: `${props.anchor.left}px`,
        top: `${props.anchor.top}px`,
        width: `${props.anchor.width}px`,
        visibility: props.hidden ? "hidden" : undefined,
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => drop(event, firstLastFrame() ? "firstFrame" : "reference")}
    >
      <input
        ref={props.elements.uploadInput}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? [])
          event.currentTarget.value = ""
          props.onUpload(files)
        }}
      />
      <Show when={firstLastFrame()}>
        <div class="studio-composer-video-frames">
          <For
            each={
              [
                { role: "firstFrame", label: "首帧" },
                { role: "lastFrame", label: "尾帧" },
              ] as const
            }
          >
            {(slot, index) => (
              <>
                <Show when={index() === 1}>
                  <button
                    type="button"
                    class="studio-composer-video-swap"
                    aria-label="交换首尾帧"
                    title="交换首尾帧"
                    disabled={props.blocked}
                    onClick={props.onSwapFrames}
                  >
                    <img src="/studio/ic_public_switchover.svg" class="studio-composer-video-swap-icon" alt="" />
                  </button>
                </Show>
                <VideoFrameButton
                  label={slot.label}
                  asset={
                    frame(slot.role)
                      ? { dataUrl: props.mediaURL(frame(slot.role)!.image) ?? "", name: frame(slot.role)!.title }
                      : undefined
                  }
                  disabled={
                    props.blocked ||
                    (!frame(slot.role) && !!boardFrameSourceCount(props.document, props.card.id, slot.role))
                  }
                  onPick={() => props.onPickUpload(slot.role)}
                  onRemove={() => {
                    const ref = frame(slot.role)
                    if (ref) props.onRemoveReference(ref)
                  }}
                  onDrop={(event) => drop(event, slot.role)}
                />
              </>
            )}
          </For>
        </div>
      </Show>
      <div class="studio-composer-input-row" classList={{ "with-reference": !firstLastFrame() }}>
        <Show when={!firstLastFrame()}>
          <div onDragOver={(event) => event.preventDefault()} onDrop={(event) => drop(event, "reference")}>
            <StudioReferenceImages
              assets={props.references}
              name={(ref) => ref.title}
              source={(ref) => props.mediaURL(ref.image)}
              canAdd={
                props.references.length <
                (props.card.kind === "video"
                  ? BOARD_VIDEO_REFERENCE_LIMIT
                  : referenceImageLimit(props.card.draft.settings.styleModel))
              }
              disabled={props.blocked}
              onPick={() => props.onPickUpload("reference")}
              onRemove={props.onRemoveReference}
            />
          </div>
        </Show>
        <textarea
          ref={input!}
          aria-label="生成提示词"
          placeholder={
            props.card.kind === "image" ? "上传参考图、输入文字，描述你想生成的图片。" : "描述你想生成的画面…"
          }
          value={props.card.draft.prompt}
          disabled={props.blocked}
          onInput={(event) => props.onPrompt(event.currentTarget.value)}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith("image/"))
            if (!files.length || props.blocked) return
            event.preventDefault()
            props.onDropUpload(files, firstLastFrame() ? "firstFrame" : "reference")
          }}
          onKeyDown={(event) => {
            if (!event.isComposing && event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              props.onGenerate()
            }
          }}
        />
      </div>
      <div class="studio-board-composer-footer">
        <div class="studio-board-parameters">
          <Show
            when={props.card.kind === "image"}
            fallback={
              <div
                class="studio-composer-toolbar-item--expanded"
                ref={(el) => props.elements.menuButton("video-input", el)}
              >
                <ToolButton
                  label={inputMode() === "multi-reference" ? "多图参考" : "首尾帧"}
                  active={props.menuTab === "video-input"}
                  disabled={props.blocked}
                  onClick={() => props.onMenuTab(props.menuTab === "video-input" ? "" : "video-input")}
                />
              </div>
            }
          >
            <div class="studio-composer-toolbar-item--expanded" ref={(el) => props.elements.menuButton("style", el)}>
              <ToolButton
                label={styleModelLabel(props.card.draft.settings.styleModel)}
                active={props.menuTab === "style"}
                disabled={props.blocked}
                onClick={() => props.onMenuTab(props.menuTab === "style" ? "" : "style")}
              />
            </div>
          </Show>
          <div ref={(el) => props.elements.menuButton("settings", el)}>
            <IconTool
              label="参数"
              title={props.card.kind === "image" ? "图片设置" : "视频设置"}
              disabled={props.blocked}
              onClick={() => props.onMenuTab(props.menuTab === "settings" ? "" : "settings")}
            >
              <StudioImageSettingsLabel
                aspectRatio={props.card.draft.settings.aspectRatio}
                count={props.card.draft.settings.count}
                styleModel={props.card.draft.settings.styleModel}
                customWidth={props.card.draft.settings.width ?? 0}
                customHeight={props.card.draft.settings.height ?? 0}
                isCustom={props.card.kind === "image" && props.card.draft.settings.isCustom}
                open={props.menuTab === "settings"}
              />
            </IconTool>
          </div>
          <Show when={props.showMentionEntry}>
            <div ref={(el) => props.elements.menuButton("references", el)}>
              <StudioToolbarTooltip label="引用参考">
                <IconTool
                  label="引用参考"
                  title=""
                  class="studio-composer-icon-at"
                  disabled={props.blocked}
                  onClick={() => props.onMenuTab(props.menuTab === "references" ? "" : "references")}
                />
              </StudioToolbarTooltip>
            </div>
          </Show>
        </div>
        <button
          type="button"
          class="studio-board-generate studio-composer-send"
          title="发送新任务（⌘ / Ctrl + Enter）"
          aria-label="发送新任务"
          disabled={!props.canGenerate}
          onClick={() => props.onGenerate()}
        />
      </div>
      <Show when={props.menuTab && !props.menusBlocked}>
        <div
          ref={props.elements.dropdown}
          class="studio-board-dropdown"
          role="dialog"
          aria-label={
            props.menuTab === "style"
              ? "风格模型"
              : props.menuTab === "settings"
                ? props.card.kind === "image"
                  ? "图片设置"
                  : "视频设置"
                : props.menuTab === "video-input"
                  ? "视频输入方式"
                  : "引用参考"
          }
        >
          <Show when={props.card.kind === "video" && props.menuTab === "video-input"}>
            <VideoModeMenu
              value={inputMode()}
              modes={STUDIO_VIDEO_INPUT_MODES}
              onSelect={(mode) => {
                props.onSetting("videoInputMode", mode)
                props.onMenuTab("")
              }}
            />
          </Show>
          <Show when={props.card.kind === "image" && props.menuTab === "style"}>
            <StyleMenu
              value={props.card.draft.settings.styleModel}
              canUseSeedream={!!props.demo || studioPermissionState.seedream}
              permissionStatus={
                props.demo
                  ? "ready"
                  : studioPermissionState.status === "idle"
                    ? "loading"
                    : studioPermissionState.status
              }
              onRetry={props.onRetryPermission}
              onSelect={props.onStyleModel}
            />
          </Show>
          <Show when={props.menuTab === "settings"}>
            <Show
              when={props.card.kind === "image"}
              fallback={
                <VideoSettings
                  aspectRatio={props.card.draft.settings.aspectRatio}
                  count={props.card.draft.settings.count}
                  duration={props.card.draft.settings.duration}
                  qualityMode={props.card.draft.settings.quality}
                  onAspectRatio={(value) => props.onSetting("aspectRatio", value)}
                  onCount={(value) => props.onSetting("count", value)}
                  onDuration={(value) => props.onSetting("duration", value)}
                  onQualityMode={(value) => {
                    props.onSetting("quality", value)
                    if (value === "4k") props.onSetting("count", 1)
                  }}
                />
              }
            >
              <ImageSettings
                aspectRatio={props.card.draft.settings.aspectRatio}
                count={props.card.draft.settings.count}
                styleModel={props.card.draft.settings.styleModel}
                customWidth={props.card.draft.settings.width ?? 0}
                customHeight={props.card.draft.settings.height ?? 0}
                isCustom={props.card.draft.settings.isCustom}
                onAspectRatio={(value) => props.onSetting("aspectRatio", value)}
                onCount={(value) => props.onSetting("count", value)}
                onCustomWidth={(value) => props.onSetting("width", value || undefined)}
                onCustomHeight={(value) => props.onSetting("height", value || undefined)}
                onIsCustom={(value) => {
                  props.onSetting("isCustom", value)
                  const dimensions = value
                    ? getDefaultDimensions(props.card.draft.settings.styleModel, props.card.draft.settings.aspectRatio)
                    : undefined
                  props.onSetting("width", dimensions?.width)
                  props.onSetting("height", dimensions?.height)
                }}
              />
            </Show>
          </Show>
          <Show when={props.showMentionEntry && props.menuTab === "references"}>
            <StudioMentionMenu
              assets={props.references}
              name={(ref) => ref.title}
              source={(ref) => props.mediaURL(ref.image)}
              onSelect={(_, index) => {
                props.onMention(index)
                input.focus()
                input.setSelectionRange(input.value.length, input.value.length)
              }}
              onClose={() => props.onMenuTab("")}
            />
          </Show>
        </div>
      </Show>
    </div>
  )
}
