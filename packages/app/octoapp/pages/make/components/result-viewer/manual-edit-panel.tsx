import { createSignal, createEffect, Show, For, onCleanup } from 'solid-js'
import type { JSX } from 'solid-js'
import { Portal } from 'solid-js/web'
import type { ManualEditTarget, ManualEditStyles, ManualEditPatch } from '../../edit-mode/source-patches'
import { emptyManualEditStyles, serializeEffects, parseEffects, type EffectEntry } from '../../edit-mode/source-patches'
import { ColorPicker } from '../../../pattern/modules/preview/property-editor-popup/color-picker'
import { HUI_COLOR_TOKENS } from '../../../pattern/modules/preview/property-editor-popup/hui-color-tokens'
import { DragInput } from '../../../pattern/modules/preview/property-editor-popup/drag-input'
import { CustomSelect } from '../../../pattern/modules/preview/property-editor-popup/custom-select'
import {
  FreeformIcon, RowIcon, ColIcon,
  HAlignIcon, VAlignIcon,
  PaddingIcon, MarginIcon, HorizontalPaddingIcon, VerticalPaddingIcon,
  OpacityIcon, CornerCurveIcon, BorderRadiusIcon,
  TopLeftBorderRadiusIcon, TopRightBorderRadiusIcon, BottomLeftBorderRadiusIcon, BottomRightBorderRadiusIcon,
  LineHeightIcon, LetterSpacingIcon,
  SettingsIcon,
} from '../../../pattern/modules/preview/property-editor-popup/icons'
import '../../../pattern/assets/style/preview/PropertyEditorPopup.css'
import './manual-edit-panel.css'

export interface ManualEditDraft {
  text: string
  href: string
  src: string
  alt: string
  styles: ManualEditStyles
  attributesText: string
  outerHtml: string
  fullSource: string
}

export function emptyManualEditDraft(source = ''): ManualEditDraft {
  return {
    text: '', href: '', src: '', alt: '',
    styles: emptyManualEditStyles(),
    attributesText: '{}', outerHtml: '', fullSource: source,
  }
}

const BORDER_STYLE_OPTS = ['solid', 'dashed', 'dotted', 'none']

// 布局 9 宫格:justify × align,CSS 值。顺序:左上→中上→右上→中左→正中→中右→左下→中下→右下。
const LAYOUT_GRID = [
  { label: '左上', justify: 'flex-start', align: 'flex-start' },
  { label: '中上', justify: 'center', align: 'flex-start' },
  { label: '右上', justify: 'flex-end', align: 'flex-start' },
  { label: '中左', justify: 'flex-start', align: 'center' },
  { label: '正中', justify: 'center', align: 'center' },
  { label: '中右', justify: 'flex-end', align: 'center' },
  { label: '左下', justify: 'flex-start', align: 'flex-end' },
  { label: '中下', justify: 'center', align: 'flex-end' },
  { label: '右下', justify: 'flex-end', align: 'flex-end' },
]

export function ManualEditPanel(props: {
  selectedTarget: ManualEditTarget | null
  draft: ManualEditDraft
  error: string | null
  busy?: boolean
  floatingStyle?: { left: number; top: number }
  onDraftChange: (draft: ManualEditDraft) => void
  onStyleChange?: (id: string, styles: Partial<ManualEditStyles>, label: string) => void
  onTextPreview?: (id: string, text: string) => void
  onApplyPatch: (patch: ManualEditPatch, label: string) => void
  onPickImage?: (file: File) => Promise<string | null>
  onError: (message: string) => void
  onSaveDraft: () => void
  onCancelDraft: () => void
  onExit?: () => void
  onFloatingPositionChange?: (position: { left: number; top: number }) => void
}) {
  const [confirmDelete, setConfirmDelete] = createSignal(false)
  const [uploadingImage, setUploadingImage] = createSignal(false)
  let fileInputRef: HTMLInputElement | undefined
  let bgFileInputRef: HTMLInputElement | undefined
  let panelRef: HTMLElement | undefined

  const updatePanelMaxHeight = () => {
    if (!panelRef || !props.floatingStyle) return
    const parent = panelRef.parentElement
    if (!parent) return
    const parentRect = parent.getBoundingClientRect()
    const panelTop = props.floatingStyle.top
    const available = parentRect.height - panelTop - 12
    panelRef.style.maxHeight = `${Math.max(100, available)}px`
  }

  createEffect(() => {
    if (props.floatingStyle) updatePanelMaxHeight()
  })
  
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
  
  const interactive = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return false
    const selector =
      "button, a, input, textarea, select, option, [role='button'], [role='menuitem'], [contenteditable='true'], [contenteditable='']"
    return !!target.closest(selector)
  }
  
  const isDragHandle = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return false
    return !!target.closest('.manual-edit-drag-handle')
  }
  
  const startPanelDrag = (event: PointerEvent) => {
    if (!props.onFloatingPositionChange) return
    if (interactive(event.target) && !isDragHandle(event.target)) return
    event.preventDefault()
    event.stopPropagation()
    
    const target = event.currentTarget as HTMLElement
    const panel = target.closest('.manual-edit-right') as HTMLElement | null
    const parent = panel?.parentElement
    if (!panel || !parent) return
    
    target.setPointerCapture(event.pointerId)
    
    const startX = event.clientX
    const startY = event.clientY
    const startLeft = panel.offsetLeft
    const startTop = panel.offsetTop
    const parentRect = parent.getBoundingClientRect()
    const panelRect = panel.getBoundingClientRect()
    const pad = 8
    
    const maxLeft = Math.max(pad, parentRect.width - panelRect.width - pad)
    const maxTop = Math.max(pad, parentRect.height - panelRect.height - pad)
    
    let rafId: number | null = null
    let pendingLeft = startLeft
    let pendingTop = startTop
    
    const updatePosition = () => {
      rafId = null
      props.onFloatingPositionChange!({ left: pendingLeft, top: pendingTop })
      if (panelRef) {
        const available = parentRect.height - pendingTop - 12
        panelRef.style.maxHeight = `${Math.max(100, available)}px`
      }
    }
    
    const move = (moveEvent: PointerEvent) => {
      pendingLeft = clamp(startLeft + moveEvent.clientX - startX, pad, maxLeft)
      pendingTop = clamp(startTop + moveEvent.clientY - startY, pad, maxTop)
      if (rafId === null) {
        rafId = requestAnimationFrame(updatePosition)
      }
    }
    
    const up = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
        rafId = null
      }
      try { target.releasePointerCapture(event.pointerId) } catch { /* noop */ }
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
      target.removeEventListener('pointercancel', up)
    }
    
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
    target.addEventListener('pointercancel', up)
  }

  const changeTargetStyle = (key: keyof ManualEditStyles, value: string) => {
    const nextStyles = { ...props.draft.styles, [key]: value }
    props.onDraftChange({ ...props.draft, styles: nextStyles })
    if (!props.selectedTarget) return
    props.onStyleChange?.(props.selectedTarget.id, { [key]: value }, `Style: ${props.selectedTarget.label}`)
  }

  // effects 是数组字段,需同时序列化为 boxShadow/filter/backdropFilter 字符串;一次性发送 4 个字段。
  const changeEffects = (next: EffectEntry[]) => {
    const serialized = serializeEffects(next)
    const nextStyles: ManualEditStyles = {
      ...props.draft.styles,
      effects: next,
      boxShadow: serialized.boxShadow,
      filter: serialized.filter,
      backdropFilter: serialized.backdropFilter,
    }
    props.onDraftChange({ ...props.draft, styles: nextStyles })
    if (!props.selectedTarget) return
    props.onStyleChange?.(
      props.selectedTarget.id,
      { effects: next, boxShadow: serialized.boxShadow, filter: serialized.filter, backdropFilter: serialized.backdropFilter },
      `Effects: ${props.selectedTarget.label}`,
    )
  }

  const handleImagePick = async (e: Event) => {
    const file = (e.currentTarget as HTMLInputElement).files?.[0]
    if (!file || !props.onPickImage) return
    (e.currentTarget as HTMLInputElement).value = ''
    setUploadingImage(true)
    try {
      const src = await props.onPickImage(file)
      if (src && props.selectedTarget) {
        props.onApplyPatch(
          { id: props.selectedTarget.id, kind: 'set-image', src, alt: props.draft.alt },
          'Upload Image'
        )
      } else {
        props.onError('Failed to upload image')
      }
    } finally {
      setUploadingImage(false)
    }
  }

  // 背景图:复用 onPickImage 拿 dataURL,作为 backgroundImage inline style 写入(不是 src 属性)。
  const handleBgImagePick = async (e: Event) => {
    const file = (e.currentTarget as HTMLInputElement).files?.[0]
    if (!file || !props.onPickImage) return
    (e.currentTarget as HTMLInputElement).value = ''
    setUploadingImage(true)
    try {
      const dataUrl = await props.onPickImage(file)
      if (dataUrl && props.selectedTarget) {
        changeTargetStyle('backgroundImage', `url("${dataUrl}")`)
      } else {
        props.onError('Failed to upload background image')
      }
    } finally {
      setUploadingImage(false)
    }
  }

  const handleBgImageClear = () => {
    changeTargetStyle('backgroundImage', '')
  }

  const handleDelete = () => {
    if (!props.selectedTarget) return
    props.onApplyPatch(
      { id: props.selectedTarget.id, kind: 'remove-element' },
      'Delete Element'
    )
    setConfirmDelete(false)
  }

  const panelTitle = () => {
    if (!props.selectedTarget) return 'Edit Element'
    const target = props.selectedTarget
    const explicit = target.attributes['data-od-label'] || target.attributes['aria-label'] || target.attributes.title
    if (explicit) return explicit
    if (target.kind === 'text' || target.kind === 'link') {
      const textName = readableContentName(target.text || target.fields.text || target.label)
      if (textName) return textName
    }
    if (target.kind === 'image') {
      const imageName = readableContentName(target.fields.alt || target.label)
      if (imageName) return imageName
    }
    return target.label
  }

  return (
    <aside
      ref={panelRef}
      class={`manual-edit-right${props.floatingStyle ? ' manual-edit-floating' : ''}`}
      style={props.floatingStyle ? { 
        left: `${props.floatingStyle.left}px`, 
        top: `${props.floatingStyle.top}px`,
        right: 'auto',
        bottom: 'auto'
      } : undefined}
    >
      <section class="manual-edit-modal cc-panel octo-thin-scroll">
        <div class="manual-edit-titlebar" onPointerDown={startPanelDrag}>
          <Show when={props.selectedTarget} fallback={<span title={panelTitle()}>{panelTitle()}</span>}>
            <span class="manual-edit-titlebar-kind" title={panelTitle()}>
              {props.selectedTarget!.kind}
            </span>
            <span class="manual-edit-titlebar-id" title={props.selectedTarget!.id}>
              {props.selectedTarget!.id}
            </span>
          </Show>
          <span class="manual-edit-titlebar-spacer" />
          <Show when={props.onExit}>
            <button
              type="button"
              class="manual-edit-titlebar-close"
              aria-label="Close panel"
              title="Close panel"
              onClick={props.onExit}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </Show>
        </div>

        <div class="manual-edit-scroll octo-thin-scroll">
          <Show when={props.selectedTarget}>
            {/* ★ Href input for link elements (separate from TEXT section) */}
            <Show when={props.selectedTarget!.kind === 'link'}>
              <Section title="LINK">
                <label class="cc-row">
                  <span class="cc-label">Href</span>
                  <input
                    type="url"
                    class="cc-input-url"
                    value={props.draft.href}
                    onInput={(e) => props.onDraftChange({ ...props.draft, href: e.currentTarget.value })}
                    placeholder="https://..."
                    autocomplete="off"
                  />
                </label>
              </Section>
            </Show>
            
            {/* ★ TEXT Section only for mixed elements (not text/link - those use in-place editing) */}
            <Show when={props.selectedTarget!.kind === 'mixed'}>
              <Section title="TEXT">
                <textarea
                  class="cc-textarea"
                  value={props.draft.text}
                  onInput={(e) => props.onDraftChange({ ...props.draft, text: e.currentTarget.value })}
                  onBlur={() => {
                    const target = props.selectedTarget
                    if (target) props.onTextPreview?.(target.id, props.draft.text)
                  }}
                  placeholder="Enter text content (mixed elements only)..."
                  rows={3}
                />
              </Section>
            </Show>
            
            <StyleInspector
              targetKind={props.selectedTarget!.kind}
              styles={props.draft.styles}
              layoutEnabled={props.selectedTarget!.isLayoutContainer}
              onChange={changeTargetStyle}
              onEffectsChange={changeEffects}
            />
          </Show>

          <Show when={props.selectedTarget?.kind === 'image' && props.onPickImage}>
            <div class="cc-section">
              <header class="cc-section-head">IMAGE</header>
              <div class="cc-section-body">
                <button
                  type="button"
                  class="cc-action-btn"
                  disabled={uploadingImage()}
                  onClick={() => fileInputRef?.click()}
                >
                  {uploadingImage() ? 'Uploading...' : 'Upload Image'}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={handleImagePick}
                />
              </div>
            </div>
          </Show>

          <Show when={props.selectedTarget?.kind === 'container' && props.onPickImage}>
            <div class="cc-section">
              <header class="cc-section-head">背景图</header>
              <div class="cc-section-body">
                <div class="cc-bgimage-row">
                  <div
                    class="cc-bgimage-preview"
                    style={{ background: props.draft.styles.backgroundImage ? `center / cover no-repeat ${props.draft.styles.backgroundImage}` : undefined }}
                  />
                  <div class="cc-bgimage-actions">
                    <button
                      type="button"
                      class="cc-action-btn"
                      disabled={uploadingImage()}
                      onClick={() => bgFileInputRef?.click()}
                    >
                      {uploadingImage() ? 'Uploading...' : 'Upload'}
                    </button>
                    <Show when={props.draft.styles.backgroundImage}>
                      <button
                        type="button"
                        class="cc-action-btn"
                        onClick={handleBgImageClear}
                      >
                        Clear
                      </button>
                    </Show>
                  </div>
                </div>
                <input
                  ref={bgFileInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={handleBgImagePick}
                />
              </div>
            </div>
          </Show>
        </div>

        <div class="manual-edit-footer">
          <div class="manual-edit-footer-left">
            <Show when={props.selectedTarget}>
              <Show
                when={confirmDelete()}
                fallback={
                  <button
                    type="button"
                    class="manual-edit-delete-btn"
                    aria-label="Delete element"
                    title="Delete element"
                    disabled={props.busy}
                    onClick={() => setConfirmDelete(true)}
                  >
                    <svg width="16" height="16" viewBox="0 0 13.0068 14.5867" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M4.48 3.08667C4.60889 3.08667 4.72222 3.03778 4.82 2.94C4.91333 2.84667 4.96 2.72889 4.96 2.58667C4.96 2.30222 5.03333 2.03333 5.18 1.78C5.32222 1.53111 5.51778 1.33333 5.76667 1.18667C6.02 1.04444 6.29111 0.973333 6.58 0.973333C6.86445 0.973333 7.13333 1.04444 7.38667 1.18667C7.63556 1.33333 7.83333 1.53111 7.98 1.78C8.12222 2.03333 8.19333 2.30222 8.19333 2.58667C8.19333 2.72889 8.24222 2.84667 8.34 2.94C8.43333 3.03778 8.54889 3.08667 8.68667 3.08667L12.5133 3.08667C12.6511 3.08667 12.7689 3.03778 12.8667 2.94C12.96 2.84667 13.0067 2.72889 13.0067 2.58667C13.0067 2.44889 12.96 2.33333 12.8667 2.24C12.7689 2.14222 12.6511 2.09333 12.5133 2.09333L9.12 2.09333C9.01333 1.49778 8.72 1 8.24 0.6C7.76 0.2 7.2 0 6.56 0C5.93333 0 5.38222 0.2 4.90667 0.6C4.43111 1 4.13556 1.49778 4.02 2.09333L0.5 2.09333C0.357778 2.09333 0.24 2.14222 0.146667 2.24C0.0488889 2.33333 0 2.44889 0 2.58667C0 2.72889 0.0488889 2.84667 0.146667 2.94C0.24 3.03778 0.357778 3.08667 0.5 3.08667L4.48 3.08667Z" fill="currentColor" fill-rule="nonzero" />
                      <path d="M7.74667 11.3867C7.88444 11.3867 8.00222 11.3422 8.1 11.2533C8.19333 11.1644 8.24667 11.0489 8.26 10.9067L8.42 6C8.42889 5.85778 8.38222 5.73778 8.28 5.64C8.17778 5.53778 8.05778 5.48 7.92 5.46667C7.79111 5.46667 7.68 5.51333 7.58667 5.60667C7.48889 5.69556 7.44 5.80889 7.44 5.94667L7.24667 10.86C7.23778 10.9978 7.28444 11.1178 7.38667 11.22C7.48889 11.3222 7.60889 11.3778 7.74667 11.3867Z" fill="currentColor" fill-rule="nonzero" />
                      <path d="M5.3 11.3867C5.43778 11.3778 5.55778 11.3222 5.66 11.22C5.75778 11.1178 5.80222 10.9978 5.79333 10.86L5.58667 5.94667C5.58667 5.80889 5.54 5.69556 5.44667 5.60667C5.35778 5.51333 5.23778 5.46667 5.08667 5.46667C4.94889 5.48 4.83333 5.53778 4.74 5.64C4.64222 5.73778 4.59778 5.85778 4.60667 6L4.78667 10.9067C4.80889 11.0489 4.86444 11.1644 4.95333 11.2533C5.04222 11.3422 5.15778 11.3867 5.3 11.3867Z" fill="currentColor" fill-rule="nonzero" />
                      <path d="M10.2067 12.7667C10.1756 13.0111 10.0756 13.2111 9.90667 13.3667C9.73333 13.5222 9.53111 13.6 9.3 13.6L3.72667 13.6C3.49556 13.6 3.29111 13.5222 3.11333 13.3667C2.93556 13.2111 2.83778 13.0111 2.82 12.7667L2.22667 4.63333L1.18 4.63333L1.79333 13.06C1.84 13.6111 2.07333 14.0622 2.49333 14.4133C2.91333 14.7644 3.4 14.94 3.95333 14.94L9.07333 14.94C9.62667 14.94 10.1133 14.7644 10.5333 14.4133C10.9533 14.0622 11.1867 13.6111 11.2333 13.06L11.8467 4.63333L10.8 4.63333L10.2067 12.7667Z" fill="currentColor" fill-rule="nonzero" />
                    </svg>
                  </button>
                }
              >
                <div class="manual-edit-delete-confirm">
                  <span>删除?</span>
                  <button
                    type="button"
                    class="manual-edit-footer-btn danger"
                    disabled={props.busy}
                    onClick={handleDelete}
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    class="manual-edit-footer-btn subtle"
                    disabled={props.busy}
                    onClick={() => setConfirmDelete(false)}
                  >
                    Cancel
                  </button>
                </div>
              </Show>
            </Show>
          </div>
          <Show when={!confirmDelete()}>
            <div class="manual-edit-footer-right">
              <button
                type="button"
                class="manual-edit-footer-btn subtle"
                disabled={props.busy}
                onClick={props.onCancelDraft}
              >
                Cancel
              </button>
              <button
                type="button"
                class="manual-edit-footer-btn primary"
                disabled={props.busy}
                onClick={props.onSaveDraft}
              >
                Save
              </button>
            </div>
          </Show>
        </div>

        <Show when={props.error}>
          <div class="manual-edit-error">{props.error}</div>
        </Show>
      </section>
    </aside>
  )
}

function EffectsSection(props: {
  effects: EffectEntry[]
  onChange: (next: EffectEntry[]) => void
}) {
  const update = (id: string, patch: Partial<EffectEntry>) => {
    props.onChange(props.effects.map(e => e.id === id ? { ...e, ...patch } : e))
  }
  const addEffect = () => {
    const next: EffectEntry = {
      id: `effect-${Date.now()}-${props.effects.length}`,
      type: 'drop-shadow',
      visible: true,
      expanded: true,
      color: '#000000',
      opacity: 100,
      blur: 0,
      offsetX: 2,
      offsetY: 2,
      layerBlur: 0,
      bgBlur: 0,
      foundBlur: false,
      foundOffsetX: true,
      foundOffsetY: true,
      foundLayerBlur: false,
      foundBgBlur: false,
    }
    props.onChange([...props.effects, next])
  }
  const removeEffect = (id: string) => {
    props.onChange(props.effects.filter(e => e.id !== id))
  }

  return (
    <Section title="效果">
      <div class="cc-effects-row">
        <div class="cc-effects-head">
          <span>效果</span>
          <button type="button" class="prop-chip cc-effect-add" onClick={addEffect} title="添加" aria-label="添加">
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3v10M3 8h10" /></svg>
          </button>
        </div>
        <For each={props.effects}>
          {(e) => (
            <div class="cc-effect-card">
              <div class="cc-effect-row">
                <CustomSelect
                  value={e.type}
                  options={[
                    { label: '阴影', value: 'drop-shadow' },
                    { label: '模糊', value: 'layer-blur' },
                    { label: '背景模糊', value: 'background-blur' },
                  ]}
                  onChange={(v) => update(e.id, { type: v as EffectEntry['type'] })}
                />
                <button
                  type="button"
                  class="prop-chip cc-effect-toggle"
                  onClick={() => update(e.id, { visible: !e.visible })}
                  title={e.visible ? '隐藏' : '显示'}
                  aria-label={e.visible ? '隐藏' : '显示'}
                >
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                    {e.visible
                      ? <><path d="M2 8s2-5 6-5 6 5 6 5-2 5-6 5-6-5-6-5z" /><circle cx="8" cy="8" r="2" /></>
                      : <><path d="M1 1l14 14M4 4c-1.3.8-2.5 2-3 4 0 0 2 5 6 5 1.5 0 2.8-.5 3.8-1.2M14 12c1.3-.8 2.5-2 3-4 0 0-2-5-6-5-1.5 0-2.8.5-3.8 1.2" /></>}
                  </svg>
                </button>
                <button
                  type="button"
                  class="prop-chip cc-effect-remove"
                  onClick={() => removeEffect(e.id)}
                  title="删除"
                  aria-label="删除"
                >
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 8h10" /></svg>
                </button>
              </div>
              <Show when={e.expanded && e.type === 'drop-shadow'}>
                <div class="cc-effect-row">
                  <ColorPicker label="Color" value={e.color} tokens={HUI_COLOR_TOKENS} onChange={(v) => update(e.id, { color: v })} />
                </div>
                <div class="cc-effect-row">
                  <DragInput value={() => e.opacity} setValue={(v) => update(e.id, { opacity: Math.max(0, Math.min(100, v)) })} setFound={() => {}} found={() => true} placeholder="100%" max={100} suffix="%" />
                </div>
                <div class="cc-effect-row">
                  <DragInput value={() => e.blur} setValue={(v) => update(e.id, { blur: v, foundBlur: true })} setFound={() => {}} found={() => e.foundBlur} placeholder="模糊值" />
                </div>
                <div class="cc-effect-row">
                  <DragInput value={() => e.offsetX} setValue={(v) => update(e.id, { offsetX: v, foundOffsetX: true })} setFound={() => {}} found={() => e.foundOffsetX} placeholder="X" />
                  <DragInput value={() => e.offsetY} setValue={(v) => update(e.id, { offsetY: v, foundOffsetY: true })} setFound={() => {}} found={() => e.foundOffsetY} placeholder="Y" />
                </div>
              </Show>
              <Show when={e.expanded && e.type === 'layer-blur'}>
                <div class="cc-effect-row">
                  <DragInput value={() => e.layerBlur} setValue={(v) => update(e.id, { layerBlur: v, foundLayerBlur: true })} setFound={() => {}} found={() => e.foundLayerBlur} placeholder="模糊值" />
                </div>
              </Show>
              <Show when={e.expanded && e.type === 'background-blur'}>
                <div class="cc-effect-row">
                  <DragInput value={() => e.bgBlur} setValue={(v) => update(e.id, { bgBlur: v, foundBgBlur: true })} setFound={() => {}} found={() => e.foundBgBlur} placeholder="模糊值" />
                </div>
              </Show>
              <button
                type="button"
                class="prop-chip cc-effect-expand-toggle"
                onClick={() => update(e.id, { expanded: !e.expanded })}
              >
                {e.expanded ? '收起' : '展开'}
              </button>
            </div>
          )}
        </For>
      </div>
    </Section>
  )
}

function StyleInspector(props: {
  targetKind: ManualEditTarget['kind']
  styles: ManualEditStyles
  layoutEnabled: boolean
  onChange: (key: keyof ManualEditStyles, value: string) => void
  onEffectsChange: (next: EffectEntry[]) => void
}) {
  const u = (key: keyof ManualEditStyles, value: string) => props.onChange(key, value)
  const [borderIndividualOpen, setBorderIndividualOpen] = createSignal(false)
  const [cornerOpen, setCornerOpen] = createSignal(false)

  const setBorderWidthAll = (v: number) => {
    u('borderTopWidth', `${v}px`)
    u('borderRightWidth', `${v}px`)
    u('borderBottomWidth', `${v}px`)
    u('borderLeftWidth', `${v}px`)
  }

  return (
    <div class="cc-inspector">
      <Show when={props.layoutEnabled}>
        <Section title="布局">
          <div class="cc-layout-direction">
            <button
              type="button"
              onClick={() => u('flexDirection', '')}
              class={!props.styles.flexDirection ? 'prop-chip-active cc-layout-dir-btn' : 'prop-chip cc-layout-dir-btn'}
              title="自由布局"
              aria-label="自由布局"
            >
              <FreeformIcon />
            </button>
            <button
              type="button"
              onClick={() => u('flexDirection', 'row')}
              class={props.styles.flexDirection === 'row' || props.styles.flexDirection === 'row-reverse' ? 'prop-chip-active cc-layout-dir-btn' : 'prop-chip cc-layout-dir-btn'}
              title="行布局"
              aria-label="行布局"
            >
              <RowIcon />
            </button>
            <button
              type="button"
              onClick={() => u('flexDirection', 'column')}
              class={props.styles.flexDirection === 'column' || props.styles.flexDirection === 'column-reverse' ? 'prop-chip-active cc-layout-dir-btn' : 'prop-chip cc-layout-dir-btn'}
              title="列布局"
              aria-label="列布局"
            >
              <ColIcon />
            </button>
          </div>
          <Show when={!!props.styles.flexDirection}>
            <div class="cc-layout-grid-wrap">
              <div class="cc-layout-grid">
                <For each={LAYOUT_GRID}>
                  {(p) => {
                    const selected = () => props.styles.justifyContent === p.justify && props.styles.alignItems === p.align
                    return (
                      <button
                        type="button"
                        onClick={() => { u('justifyContent', p.justify); u('alignItems', p.align) }}
                        class={selected() ? 'cc-layout-cell cc-layout-cell-active' : 'cc-layout-cell'}
                        title={p.label}
                        aria-label={p.label}
                      >
                        <div class={selected() ? 'cc-layout-dot cc-layout-dot-active' : 'cc-layout-dot'} />
                      </button>
                    )
                  }}
                </For>
              </div>
              <div class="cc-layout-gap-col">
                <DragInput
                  value={() => parseFloat(props.styles.gap) || 0}
                  setValue={(v) => u('gap', `${v}px`)}
                  setFound={() => {}}
                  found={() => true}
                  placeholder="间距"
                />
                <label class="cc-layout-radio">
                  <input
                    type="radio"
                    name="layout-justify-mode"
                    checked={props.styles.justifyContent === 'space-between'}
                    onChange={() => u('justifyContent', 'space-between')}
                  />
                  <span>两端对齐</span>
                </label>
                <label class="cc-layout-radio">
                  <input
                    type="radio"
                    name="layout-justify-mode"
                    checked={props.styles.justifyContent === 'space-around'}
                    onChange={() => u('justifyContent', 'space-around')}
                  />
                  <span>环绕分布</span>
                </label>
              </div>
            </div>
          </Show>
        </Section>
      </Show>

      <Show when={props.targetKind === 'container' || props.targetKind === 'image' || props.targetKind === 'token'}>
        <QuadModeSection
          title="内边距"
          base="padding"
          values={{
            t: props.styles.paddingTop, r: props.styles.paddingRight, b: props.styles.paddingBottom, l: props.styles.paddingLeft,
          }}
          onChange={(side, value) => u(sideToProp('padding', side), value)}
        />

        <QuadModeSection
          title="外边距"
          base="margin"
          values={{
            t: props.styles.marginTop, r: props.styles.marginRight, b: props.styles.marginBottom, l: props.styles.marginLeft,
          }}
          onChange={(side, value) => u(sideToProp('margin', side), value)}
        />
      </Show>

      <Show when={props.targetKind !== 'text' && props.targetKind !== 'link' && props.targetKind !== 'token' && props.targetKind !== 'mixed'}>
        <Section title="宽高">
          <div class="cc-size-row">
            <DragInput
              value={() => parseFloat(props.styles.width) || 0}
              setValue={(v) => u('width', `${v}px`)}
              setFound={() => {}}
              found={() => true}
              placeholder="宽"
              icon="W"
            />
            <DragInput
              value={() => parseFloat(props.styles.height) || 0}
              setValue={(v) => u('height', `${v}px`)}
              setFound={() => {}}
              found={() => true}
              placeholder="高"
              icon="H"
            />
          </div>
          <div class="cc-size-checkboxes">
            <label class="cc-size-checkbox">
              <input
                type="checkbox"
                checked={props.styles.width === '100%'}
                onChange={(e) => u('width', e.currentTarget.checked ? '100%' : '')}
              />
              <span>填充宽度</span>
            </label>
            <label class="cc-size-checkbox">
              <input
                type="checkbox"
                checked={props.styles.height === '100%'}
                onChange={(e) => u('height', e.currentTarget.checked ? '100%' : '')}
              />
              <span>填充高度</span>
            </label>
            <label class="cc-size-checkbox">
              <input
                type="checkbox"
                checked={props.styles.width === 'fit-content' || props.styles.width === 'max-content' || props.styles.width === 'auto'}
                onChange={(e) => u('width', e.currentTarget.checked ? 'fit-content' : '')}
              />
              <span>适应宽度</span>
            </label>
            <label class="cc-size-checkbox">
              <input
                type="checkbox"
                checked={props.styles.height === 'fit-content' || props.styles.height === 'max-content' || props.styles.height === 'auto'}
                onChange={(e) => u('height', e.currentTarget.checked ? 'fit-content' : '')}
              />
              <span>适应高度</span>
            </label>
            <label class="cc-size-checkbox cc-size-clip">
              <input
                type="checkbox"
                checked={props.styles.overflow === 'hidden'}
                onChange={(e) => u('overflow', e.currentTarget.checked ? 'hidden' : '')}
              />
              <span>裁剪内容</span>
            </label>
          </div>
        </Section>
      </Show>

      <Show when={props.targetKind === 'container' || props.targetKind === 'image' || props.targetKind === 'token'}>
        <Section title="外观">
          <ColorPicker label="Fill" value={props.styles.backgroundColor} tokens={HUI_COLOR_TOKENS} onChange={(v) => u('backgroundColor', v)} />
          <div class="cc-stroke-row">
            <DragInput
              value={() => Math.round((parseFloat(props.styles.opacity) || 0) * 100)}
              setValue={(v) => u('opacity', String(Math.round(v) / 100))}
              setFound={() => {}}
              found={() => true}
              placeholder="透明度"
              max={100}
              icon={<OpacityIcon />}
              suffixIcon="%"
            />
            <DragInput
              value={() => parseFloat(props.styles.borderRadius) || 0}
              setValue={(v) => {
                // 改 unified radius 时清空 4 个 longhand,让 shorthand 生效;
                // 否则 expandRadiusShorthand 会用旧 longhand 值覆盖用户的新 shorthand 意图。
                u('borderRadius', `${v}px`)
                u('borderTopLeftRadius', '')
                u('borderTopRightRadius', '')
                u('borderBottomRightRadius', '')
                u('borderBottomLeftRadius', '')
              }}
              setFound={() => {}}
              found={() => true}
              placeholder="圆角"
              icon={<CornerCurveIcon />}
              suffixIcon={<BorderRadiusIcon />}
              display={cornerOpen() && (props.styles.borderTopLeftRadius || props.styles.borderTopRightRadius || props.styles.borderBottomRightRadius || props.styles.borderBottomLeftRadius) ? 'mixed' : undefined}
            />
            <button
              type="button"
              class={cornerOpen() ? 'prop-chip-active cc-stroke-expand' : 'prop-chip cc-stroke-expand'}
              onClick={() => setCornerOpen(!cornerOpen())}
              title="四角独立"
              aria-label="四角独立"
            >
              <span style={{ "font-size": "10px" }}>◱</span>
            </button>
          </div>
          <Show when={cornerOpen()}>
            <div class="cc-stroke-trbl">
              <DragInput value={() => parseFloat(props.styles.borderTopLeftRadius) || 0} setValue={(v) => u('borderTopLeftRadius', `${v}px`)} setFound={() => {}} found={() => true} placeholder="左上" icon={<TopLeftBorderRadiusIcon />} />
              <DragInput value={() => parseFloat(props.styles.borderTopRightRadius) || 0} setValue={(v) => u('borderTopRightRadius', `${v}px`)} setFound={() => {}} found={() => true} placeholder="右上" icon={<TopRightBorderRadiusIcon />} />
              <DragInput value={() => parseFloat(props.styles.borderBottomLeftRadius) || 0} setValue={(v) => u('borderBottomLeftRadius', `${v}px`)} setFound={() => {}} found={() => true} placeholder="左下" icon={<BottomLeftBorderRadiusIcon />} />
              <DragInput value={() => parseFloat(props.styles.borderBottomRightRadius) || 0} setValue={(v) => u('borderBottomRightRadius', `${v}px`)} setFound={() => {}} found={() => true} placeholder="右下" icon={<BottomRightBorderRadiusIcon />} />
            </div>
          </Show>
        </Section>

        <Section title="描边">
          <ColorPicker label="Color" value={props.styles.borderColor} tokens={HUI_COLOR_TOKENS} onChange={(v) => u('borderColor', v)} />
          <div class="cc-stroke-row">
            <DragInput
              value={() => parseFloat(props.styles.borderTopWidth) || 0}
              setValue={(v) => {
                if (!borderIndividualOpen()) setBorderWidthAll(v)
                else u('borderTopWidth', `${v}px`)
              }}
              setFound={() => {}}
              found={() => true}
              placeholder="宽度"
            />
            <button
              type="button"
              class={borderIndividualOpen() ? 'prop-chip-active cc-stroke-expand' : 'prop-chip cc-stroke-expand'}
              onClick={() => setBorderIndividualOpen(!borderIndividualOpen())}
              title="四角独立"
              aria-label="四角独立"
            >
              <span style={{ "font-size": "10px" }}>◱</span>
            </button>
            <CustomSelect
              value={props.styles.borderStyle || 'none'}
              options={[
                { label: '实线', value: 'solid' },
                { label: '虚线', value: 'dashed' },
                { label: '点线', value: 'dotted' },
                { label: '无', value: 'none' },
              ]}
              onChange={(v) => u('borderStyle', v)}
            />
          </div>
          <Show when={borderIndividualOpen()}>
            <div class="cc-stroke-trbl">
              <DragInput value={() => parseFloat(props.styles.borderTopWidth) || 0} setValue={(v) => u('borderTopWidth', `${v}px`)} setFound={() => {}} found={() => true} placeholder="上" />
              <DragInput value={() => parseFloat(props.styles.borderRightWidth) || 0} setValue={(v) => u('borderRightWidth', `${v}px`)} setFound={() => {}} found={() => true} placeholder="右" />
              <DragInput value={() => parseFloat(props.styles.borderBottomWidth) || 0} setValue={(v) => u('borderBottomWidth', `${v}px`)} setFound={() => {}} found={() => true} placeholder="下" />
              <DragInput value={() => parseFloat(props.styles.borderLeftWidth) || 0} setValue={(v) => u('borderLeftWidth', `${v}px`)} setFound={() => {}} found={() => true} placeholder="左" />
            </div>
          </Show>
        </Section>

        <EffectsSection effects={props.styles.effects ?? []} onChange={props.onEffectsChange} />
      </Show>

      <Show when={props.targetKind === 'text' || props.targetKind === 'link' || props.targetKind === 'token' || props.targetKind === 'mixed'}>
        <Section title="文字">
          <div class="cc-typ-row">
            <span class="cc-typ-label">字体</span>
            <CustomSelect
              value={props.styles.fontFamily}
              options={[
                { label: 'Default', value: '' },
                { label: 'Sans', value: 'sans-serif' },
                { label: 'Serif', value: 'serif' },
                { label: 'Mono', value: 'monospace' },
              ]}
              onChange={(v) => u('fontFamily', v)}
            />
          </div>
          <div class="cc-typ-row">
            <span class="cc-typ-label">字重</span>
            <CustomSelect
              value={props.styles.fontWeight}
              options={[
                { label: 'Thin', value: '100' },
                { label: 'Extra Light', value: '200' },
                { label: 'Light', value: '300' },
                { label: 'Regular', value: '400' },
                { label: 'Medium', value: '500' },
                { label: 'Semi Bold', value: '600' },
                { label: 'Bold', value: '700' },
                { label: 'Extra Bold', value: '800' },
                { label: 'Black', value: '900' },
              ]}
              onChange={(v) => u('fontWeight', v)}
            />
          </div>
          <div class="cc-typ-row">
            <span class="cc-typ-label">字号</span>
            <DragInput
              value={() => parseFloat(props.styles.fontSize) || 0}
              setValue={(v) => u('fontSize', `${v}px`)}
              setFound={() => {}}
              found={() => true}
              placeholder="字号"
              icon="S"
            />
          </div>
          <ColorPicker label="文字色" value={props.styles.color} tokens={HUI_COLOR_TOKENS} onChange={(v) => u('color', v)} />
          <div class="cc-typ-pair">
            <div class="cc-typ-pair-cell">
              <span class="cc-typ-sublabel">行高</span>
              <DragInput
                value={() => parseFloat(props.styles.lineHeight) || 0}
                setValue={(v) => {
                  // line-height 无单位是合法写法(=字号倍数);原值无单位则保持倍数语义,
                  // 有单位(px/em)或 normal/空 则写 px。重开面板后值来自 computed 恒为 px。
                  const raw = props.styles.lineHeight.trim()
                  const unitless = /^\d+(\.\d+)?$/.test(raw)
                  u('lineHeight', unitless ? String(v) : `${v}px`)
                }}
                setFound={() => {}}
                found={() => true}
                placeholder="auto"
                icon={<LineHeightIcon />}
                flex1={false}
              />
            </div>
            <div class="cc-typ-pair-cell">
              <span class="cc-typ-sublabel">字间距</span>
              <DragInput
                value={() => parseFloat(props.styles.letterSpacing) || 0}
                setValue={(v) => u('letterSpacing', `${v}px`)}
                setFound={() => {}}
                found={() => true}
                placeholder="0"
                icon={<LetterSpacingIcon />}
                flex1={false}
              />
            </div>
          </div>
          <div class="cc-typ-align-row">
            <div class="cc-typ-align-cell">
              <span class="cc-typ-sublabel">水平对齐</span>
              <div class="cc-typ-align-group">
                <button type="button" onClick={() => u('textAlign', props.styles.textAlign === 'left' ? '' : 'left')} class={props.styles.textAlign === 'left' ? 'prop-chip-active cc-typ-align-btn' : 'prop-chip cc-typ-align-btn'} title="左对齐" aria-label="左对齐"><HAlignIcon value="left" /></button>
                <button type="button" onClick={() => u('textAlign', props.styles.textAlign === 'center' ? '' : 'center')} class={props.styles.textAlign === 'center' ? 'prop-chip-active cc-typ-align-btn' : 'prop-chip cc-typ-align-btn'} title="居中" aria-label="居中"><HAlignIcon value="center" /></button>
                <button type="button" onClick={() => u('textAlign', props.styles.textAlign === 'right' ? '' : 'right')} class={props.styles.textAlign === 'right' ? 'prop-chip-active cc-typ-align-btn' : 'prop-chip cc-typ-align-btn'} title="右对齐" aria-label="右对齐"><HAlignIcon value="right" /></button>
                <button type="button" onClick={() => u('textAlign', props.styles.textAlign === 'justify' ? '' : 'justify')} class={props.styles.textAlign === 'justify' ? 'prop-chip-active cc-typ-align-btn' : 'prop-chip cc-typ-align-btn'} title="两端对齐" aria-label="两端对齐"><HAlignIcon value="justify" /></button>
              </div>
            </div>
            <div class="cc-typ-align-cell">
              <span class="cc-typ-sublabel">垂直对齐</span>
              <div class="cc-typ-align-group">
                <button type="button" onClick={() => u('verticalAlign', props.styles.verticalAlign === 'top' ? '' : 'top')} class={props.styles.verticalAlign === 'top' ? 'prop-chip-active cc-typ-align-btn' : 'prop-chip cc-typ-align-btn'} title="顶部对齐" aria-label="顶部对齐"><VAlignIcon value="start" /></button>
                <button type="button" onClick={() => u('verticalAlign', props.styles.verticalAlign === 'middle' ? '' : 'middle')} class={props.styles.verticalAlign === 'middle' ? 'prop-chip-active cc-typ-align-btn' : 'prop-chip cc-typ-align-btn'} title="居中" aria-label="居中"><VAlignIcon value="center" /></button>
                <button type="button" onClick={() => u('verticalAlign', props.styles.verticalAlign === 'bottom' ? '' : 'bottom')} class={props.styles.verticalAlign === 'bottom' ? 'prop-chip-active cc-typ-align-btn' : 'prop-chip cc-typ-align-btn'} title="底部对齐" aria-label="底部对齐"><VAlignIcon value="end" /></button>
              </div>
            </div>
          </div>
        </Section>
      </Show>
    </div>
  )
}

function Section(props: { title: string; actions?: JSX.Element; children: any }) {
  return (
    <section class="cc-section">
      <header class="cc-section-head">
        <span class="cc-section-title">{props.title}</span>
        <Show when={props.actions}>{props.actions}</Show>
      </header>
      <div class="cc-section-body">{props.children}</div>
    </section>
  )
}

// 内边距/外边距 section:支持四周/水平垂直/上右下左 3 种模式切换 + DragInput 图标。
function QuadModeSection(props: {
  title: string
  base: 'padding' | 'margin'
  values: { t: string; r: string; b: string; l: string }
  onChange: (side: 't' | 'r' | 'b' | 'l', value: string) => void
}) {
  const [mode, setMode] = createSignal<'all' | 'hv' | 'trbl'>('all')
  const [modeOpen, setModeOpen] = createSignal(false)
  let modeAreaRef: HTMLDivElement | undefined

  createEffect(() => {
    if (!modeOpen()) return
    const handler = (e: MouseEvent) => {
      if (modeAreaRef && !modeAreaRef.contains(e.target as Node)) setModeOpen(false)
    }
    document.addEventListener('mousedown', handler)
    onCleanup(() => document.removeEventListener('mousedown', handler))
  })

  const allVal = () => parseFloat(props.values.t) || 0
  const hVal = () => parseFloat(props.values.r) || 0
  const vVal = () => parseFloat(props.values.t) || 0
  const setAll = (v: number) => {
    props.onChange('t', `${v}px`); props.onChange('r', `${v}px`)
    props.onChange('b', `${v}px`); props.onChange('l', `${v}px`)
  }
  const setH = (v: number) => { props.onChange('r', `${v}px`); props.onChange('l', `${v}px`) }
  const setV = (v: number) => { props.onChange('t', `${v}px`); props.onChange('b', `${v}px`) }
  const side = (s: 't' | 'r' | 'b' | 'l') => () => parseFloat(props.values[s]) || 0
  const setSide = (s: 't' | 'r' | 'b' | 'l') => (v: number) => props.onChange(s, `${v}px`)

  const Icon = props.base === 'padding' ? PaddingIcon : MarginIcon

  const modeActions = (
    <div class="cc-quad-mode" ref={modeAreaRef}>
      <button
        type="button"
        class="prop-chip cc-quad-mode-btn"
        onClick={() => setModeOpen(!modeOpen())}
        title="模式"
        aria-label="切换模式"
      >
        <span class="cc-quad-mode-icon"><SettingsIcon /></span>
      </button>
      <Show when={modeOpen()}>
        <div class="cc-quad-mode-dropdown" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => { setMode('all'); setModeOpen(false) }}>四周</button>
          <button onClick={() => { setMode('hv'); setModeOpen(false) }}>水平/垂直</button>
          <button onClick={() => { setMode('trbl'); setModeOpen(false) }}>上/右/下/左</button>
        </div>
      </Show>
    </div>
  )

  return (
    <Section title={props.title} actions={modeActions}>
      <Show when={mode() === 'all'}>
        <div class="cc-quad-row">
          <DragInput value={allVal} setValue={setAll} setFound={() => {}} found={() => true} placeholder="-" icon={<Icon />} />
        </div>
      </Show>
      <Show when={mode() === 'hv'}>
        <div class="cc-quad-row">
          <DragInput value={hVal} setValue={setH} setFound={() => {}} found={() => true} placeholder="水平" icon={<HorizontalPaddingIcon />} />
          <DragInput value={vVal} setValue={setV} setFound={() => {}} found={() => true} placeholder="垂直" icon={<VerticalPaddingIcon />} />
        </div>
      </Show>
      <Show when={mode() === 'trbl'}>
        <div class="cc-quad-trbl">
          <DragInput value={side('t')} setValue={setSide('t')} setFound={() => {}} found={() => true} placeholder="上" icon="↑" />
          <DragInput value={side('r')} setValue={setSide('r')} setFound={() => {}} found={() => true} placeholder="右" icon="→" />
          <DragInput value={side('b')} setValue={setSide('b')} setFound={() => {}} found={() => true} placeholder="下" icon="↓" />
          <DragInput value={side('l')} setValue={setSide('l')} setFound={() => {}} found={() => true} placeholder="左" icon="←" />
        </div>
      </Show>
    </Section>
  )
}

function PairRow(props: { children: any }) {
  return <div class="cc-pair">{props.children}</div>
}

function sideToProp(base: 'padding' | 'margin', side: 't' | 'r' | 'b' | 'l'): keyof ManualEditStyles {
  return `${base}${sideUpper(side)}` as keyof ManualEditStyles
}

function sideUpper(side: 't' | 'r' | 'b' | 'l'): 'Top' | 'Right' | 'Bottom' | 'Left' {
  return side === 't' ? 'Top' : side === 'r' ? 'Right' : side === 'b' ? 'Bottom' : 'Left'
}

function readableContentName(value: string | undefined): string {
  const clean = (value ?? '').replace(/\s+/g, ' ').trim()
  if (!clean) return ''
  if (looksGeneratedIdentifier(clean)) return ''
  return clean.length > 42 ? `${clean.slice(0, 39).trim()}...` : clean
}

function looksGeneratedIdentifier(value: string): boolean {
  return /^path(?:-\d+)+$/i.test(value) || /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)
}