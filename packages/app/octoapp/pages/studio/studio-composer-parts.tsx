import { createEffect, createMemo, For, on, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import emptyPng from "../insight/icons/empty.png"
import { isStudioCustomSizeValid } from "./studio-shared"
import type { StudioAspectRatio } from "./types"

export function StudioMentionMenu<T>(props: {
  assets: T[]
  name: (asset: T) => string
  source: (asset: T) => string | undefined
  onSelect: (asset: T, index: number) => void
  onClose: () => void
}) {
  return (
    <div
      class="studio-menu studio-at-menu"
      style={{ width: "200px", height: props.assets.length > 0 ? "120px" : "150px" }}
      onClick={props.onClose}
    >
      <div class="studio-material-title">可能@的内容</div>
      <ScrollView class="studio-at-menu-list">
        <Show
          when={props.assets.length > 0}
          fallback={
            <div class="studio-at-menu-empty">
              <img class="studio-at-menu-empty-img" src={emptyPng} alt="" />
              <span class="studio-at-menu-empty-text">你还没有添加图片</span>
            </div>
          }
        >
          <For each={props.assets}>
            {(asset, index) => (
              <div
                class="studio-at-menu-item"
                onMouseDown={(event) => {
                  event.preventDefault()
                  props.onSelect(asset, index())
                  props.onClose()
                }}
              >
                <img class="studio-at-menu-thumb" src={props.source(asset)} alt="" />
                <span class="studio-at-menu-name">{props.name(asset).replace(/\.[^.]+$/, "")}</span>
              </div>
            )}
          </For>
        </Show>
      </ScrollView>
    </div>
  )
}

export function StudioReferenceImages<T>(props: {
  assets: T[]
  name: (asset: T) => string
  source: (asset: T) => string | undefined
  canAdd: boolean
  disabled?: boolean
  uploadUnavailable?: boolean
  onPick: () => void
  onRemove: (asset: T) => void
}) {
  const [state, setState] = createStore({ expanded: false, hoverReady: false })
  let frame: number | undefined
  onCleanup(() => {
    if (frame !== undefined) cancelAnimationFrame(frame)
  })
  createEffect((previousCount = 0) => {
    const count = props.assets.length
    if (!count) {
      if (frame !== undefined) cancelAnimationFrame(frame)
      setState({ expanded: false, hoverReady: false })
      return count
    }
    if (previousCount) return count
    setState({ expanded: false, hoverReady: false })
    // A newly uploaded stack stays collapsed until the pointer actually moves.
    frame = requestAnimationFrame(() => {
      frame = undefined
      setState("hoverReady", true)
    })
    return count
  }, 0)

  return (
    <div class="studio-composer-ref-slot" classList={{ filled: props.assets.length > 0 }}>
      <Show
        when={props.assets.length}
        fallback={
          <button
            type="button"
            onClick={props.onPick}
            disabled={props.disabled}
            class="studio-composer-ref-btn"
            classList={{ disabled: props.uploadUnavailable }}
            title="上传参考图"
            aria-label="上传参考图"
          />
        }
      >
        <div
          class="studio-composer-ref-stack"
          classList={{ expanded: state.expanded }}
          onPointerMove={(event) => {
            if (!state.hoverReady || (!event.movementX && !event.movementY) || state.expanded) return
            setState("expanded", true)
          }}
          onPointerLeave={() => setState("expanded", false)}
        >
          <For each={props.assets}>
            {(asset, index) => (
              <div
                class="studio-composer-ref-item"
                style={{
                  "--ref-index": String(index()),
                  "--ref-rotate": `${[-7.8, 4.1, -3.6][index()] ?? 0}deg`,
                }}
              >
                <div class="studio-composer-ref-btn" title={props.name(asset)}>
                  <img src={props.source(asset)} alt={props.name(asset)} class="studio-composer-ref-image" />
                </div>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    props.onRemove(asset)
                  }}
                  disabled={props.disabled}
                  class="studio-composer-ref-remove"
                  aria-label={`删除参考图 ${props.name(asset)}`}
                  title="删除参考图"
                >
                  <img src="/studio/studio-img-delete-icon.svg" class="studio-composer-ref-remove-icon" alt="" />
                </button>
              </div>
            )}
          </For>
          <Show when={state.expanded && props.canAdd}>
            <button
              type="button"
              onClick={props.onPick}
              disabled={props.disabled}
              class="studio-composer-ref-btn studio-composer-ref-add"
              title="继续上传参考图"
              aria-label="继续上传参考图"
            />
          </Show>
        </div>
        <Show when={props.canAdd && !state.expanded}>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              props.onPick()
            }}
            disabled={props.disabled}
            class="studio-composer-ref-upload-float"
            aria-label="继续上传参考图"
            title="继续上传参考图"
          >
            <img src="/studio/studio_mask.svg" alt="" />
          </button>
        </Show>
      </Show>
    </div>
  )
}

export function StudioImageSettingsLabel(props: {
  aspectRatio: StudioAspectRatio
  count: 1 | 2 | 3 | 4
  styleModel: string
  customWidth: number
  customHeight: number
  isCustom: boolean
  open: boolean
}) {
  const [state, setState] = createStore({
    width: props.customWidth,
    height: props.customHeight,
    isCustom: props.isCustom,
    lastValid: "",
  })
  createEffect(
    on(
      () => props.styleModel,
      () => setState("lastValid", ""),
    ),
  )
  createEffect(() => {
    // Keep the committed size visible while the settings panel edits local inputs.
    if (props.open) return
    setState({ width: props.customWidth, height: props.customHeight, isCustom: props.isCustom })
  })
  const ratio = createMemo(() => {
    const width = props.open ? state.width : props.customWidth
    const height = props.open ? state.height : props.customHeight
    if (!(props.open ? state.isCustom : props.isCustom) || width <= 0 || height <= 0) return props.aspectRatio
    if (!isStudioCustomSizeValid(props.styleModel, width, height)) return state.lastValid || props.aspectRatio
    setState("lastValid", `${width}×${height}`)
    return `${width}×${height}`
  })
  const icon = () => {
    switch (props.aspectRatio) {
      case "1:1":
        return [10.5, 10.5]
      case "2:3":
        return [9.32, 12.82]
      case "3:2":
        return [12.82, 9.32]
      case "3:4":
        return [10.5, 11.68]
      case "4:3":
        return [11.68, 10.5]
      case "9:16":
        return [9.04, 14]
      case "16:9":
        return [14, 9.04]
      default:
        return [12, 12]
    }
  }
  return (
    <>
      <Show when={ratio() === props.aspectRatio}>
        <span
          class="studio-composer-icon-tool-ratio-icon"
          style={{ "--icon-w": `${icon()[0]}px`, "--icon-h": `${icon()[1]}px` }}
        />
      </Show>
      <span class="studio-composer-icon-tool-text">{ratio()}</span>
      <span class="studio-composer-icon-tool-sep" />
      <span class="studio-composer-icon-tool-text">{props.count}</span>
    </>
  )
}
