import { For, Show } from "solid-js"
import {
  boardFrameSourceCount,
  type BoardCard,
  type BoardDocument,
  type BoardReference,
  type BoardSettings,
} from "@opencode-ai/core/studio-board"
import { StyleMenu, ImageSettings, VideoSettings, ToolButton, IconTool, StudioToolbarTooltip } from "../studio-composer"
import { studioPermissionState } from "../studio-permission-store"
import { styleModelLabel } from "../data"
import { getDefaultDimensions } from "../studio-shared"

export function StudioBoardComposer(props: {
  card: BoardCard
  document: BoardDocument
  references: BoardReference[]
  anchor: { left: number; top: number; width: number }
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
  return (
    <div
      ref={props.elements.composer}
      class="studio-board-composer"
      role="region"
      aria-label={`${props.card.title}的生成输入区`}
      style={{ left: `${props.anchor.left}px`, top: `${props.anchor.top}px`, width: `${props.anchor.width}px` }}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
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
      <Show when={props.card.kind === "video"}>
        <div class="studio-board-frame-uploads">
          <For
            each={
              [
                { role: "firstFrame", label: "首帧" },
                { role: "lastFrame", label: "尾帧" },
              ] as const
            }
          >
            {(frame) => (
              <button
                type="button"
                disabled={props.blocked || !!boardFrameSourceCount(props.document, props.card.id, frame.role)}
                onClick={() => props.onPickUpload(frame.role)}
              >
                ＋ 上传{frame.label}
              </button>
            )}
          </For>
        </div>
      </Show>
      <Show when={props.references.length}>
        <div class="studio-board-references">
          <For each={props.references}>
            {(ref) => (
              <div class="studio-board-reference">
                <img src={props.mediaURL(ref.image)} alt={ref.title} />
                <span>
                  {ref.title}
                  {ref.role === "firstFrame" ? " · 首帧" : ref.role === "lastFrame" ? " · 尾帧" : ""}
                </span>
                <button
                  type="button"
                  disabled={props.blocked}
                  aria-label={`移除${ref.title}引用`}
                  onClick={() => props.onRemoveReference(ref)}
                >
                  ×
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>
      <textarea
        aria-label="生成提示词"
        placeholder="描述你想生成的画面…"
        value={props.card.draft.prompt}
        disabled={props.blocked}
        onInput={(event) => props.onPrompt(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (!event.isComposing && event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            props.onGenerate()
          }
        }}
      />
      <div class="studio-board-composer-footer">
        <div class="studio-board-parameters">
          <div class="studio-composer-toolbar-item--expanded" ref={(el) => props.elements.menuButton("style", el)}>
            <ToolButton
              label={styleModelLabel(props.card.draft.settings.styleModel)}
              active={props.menuTab === "style"}
              disabled={props.blocked}
              onClick={() => props.onMenuTab(props.menuTab === "style" ? "" : "style")}
            />
          </div>
          <div ref={(el) => props.elements.menuButton("settings", el)}>
            <ToolButton
              label={props.card.kind === "video" ? "视频设置" : "图片设置"}
              active={props.menuTab === "settings"}
              disabled={props.blocked}
              onClick={() => props.onMenuTab(props.menuTab === "settings" ? "" : "settings")}
            />
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
          class="studio-board-generate"
          title="发送新任务（⌘ / Ctrl + Enter）"
          aria-label="发送新任务"
          disabled={!props.canGenerate}
          onClick={() => props.onGenerate()}
        >
          ↑
        </button>
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
                : "引用参考"
          }
        >
          <Show when={props.menuTab === "style"}>
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
            <div class="studio-menu studio-board-reference-menu">
              <p>参考图可插入当前提示词</p>
              <button type="button" onClick={() => props.onPickUpload("reference")}>
                上传参考图
              </button>
              <Show
                when={props.references.length}
                fallback={<span>从图片卡片右侧加号拖线到当前卡片左侧，或拖到空白处创建。</span>}
              >
                <For each={props.references}>
                  {(ref, index) => (
                    <button type="button" onClick={() => props.onMention(index())}>
                      @参考图{index() + 1} · {ref.title}
                    </button>
                  )}
                </For>
              </Show>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  )
}
