import { createEffect, createSignal, For, on, Show, type JSX } from "solid-js"
import { STUDIO_HD_MODES, type StudioHDMode } from "./studio-shared"
import type { StudioImage } from "./types"

export function StudioHDEditor(props: {
  image: StudioImage
  onClose: () => void
  onDelete: () => void
  onSubmit: (input: { mode: StudioHDMode }) => void
}): JSX.Element {
  const [selectedMode, setSelectedMode] = createSignal<StudioHDMode>("restoration_8k")
  const [loadError, setLoadError] = createSignal("")

  createEffect(
    on(
      () => props.image.id,
      () => {
        setLoadError("")
        setSelectedMode("restoration_8k")
      },
    ),
  )

  return (
    <div class="studio-hd">
      <div class="studio-hd-header">
        <div class="min-w-0">
          <div class="studio-hd-title">变清晰</div>
        </div>
        <button type="button" onClick={props.onClose} class="studio-hd-close" aria-label="关闭变清晰" title="关闭变清晰" />
      </div>
      <div class="studio-hd-body">
        <div class="studio-hd-canvas-wrap">
          <img
            class="studio-hd-image"
            src={props.image.url}
            alt="HD source"
            onLoad={() => setLoadError("")}
            onError={() => setLoadError("图片加载失败")}
          />
          <Show when={loadError()}>
            {(message) => <div class="studio-hd-loading">{message()}</div>}
          </Show>
        </div>
        <div class="studio-hd-controls">
          <div class="studio-hd-mode-group" aria-label="放大模式">
            <span class="studio-hd-mode-label">放大模式</span>
            <For each={STUDIO_HD_MODES}>
              {(option) => (
                <button
                  type="button"
                  class="studio-hd-mode-option"
                  classList={{ active: selectedMode() === option.value }}
                  aria-pressed={selectedMode() === option.value}
                  data-mode={option.value}
                  onClick={() => setSelectedMode(option.value)}
                >
                  <span class="studio-hd-mode-dot" />
                  <span class="studio-hd-mode-text">{option.label}</span>
                </button>
              )}
            </For>
          </div>
          <div class="studio-editor-actions">
            <button type="button" class="studio-editor-delete" onClick={props.onDelete}>删除</button>
            <button
              type="button"
              class="studio-hd-create"
              onClick={() => props.onSubmit({ mode: selectedMode() })}
            >
              一键生成
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function StudioCutoutEditor(props: {
  image: StudioImage
  busy: boolean
  onClose: () => void
  onDelete: () => void
  onSubmit: () => void
}): JSX.Element {
  const [loadError, setLoadError] = createSignal("")

  createEffect(
    on(
      () => props.image.id,
      () => setLoadError(""),
    ),
  )

  return (
    <div class="studio-cutout">
      <div class="studio-cutout-header">
        <div class="min-w-0">
          <div class="studio-cutout-title">抠图</div>
        </div>
        <button type="button" onClick={props.onClose} class="studio-cutout-close" aria-label="关闭抠图" title="关闭抠图" />
      </div>
      <div class="studio-cutout-body">
        <div class="studio-cutout-canvas-wrap">
          <img
            class="studio-cutout-image"
            src={props.image.url}
            alt="Cutout source"
            onLoad={() => setLoadError("")}
            onError={() => setLoadError("图片加载失败")}
          />
          <Show when={loadError()}>
            {(message) => <div class="studio-cutout-loading">{message()}</div>}
          </Show>
        </div>
        <div class="studio-cutout-controls">
          <button type="button" class="studio-editor-delete" onClick={props.onDelete}>删除</button>
          <button
            type="button"
            class="studio-hd-create"
            disabled={props.busy}
            onClick={props.onSubmit}
          >
            一键生成
          </button>
        </div>
      </div>
    </div>
  )
}
