import { createSignal, createEffect, Show, For, onCleanup } from 'solid-js'
import { Portal } from 'solid-js/web'
import type { ManualEditTarget, ManualEditStyles, ManualEditPatch } from '../../edit-mode/source-patches'
import { emptyManualEditStyles } from '../../edit-mode/source-patches'
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

const EDITOR_SWATCH_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e',
  '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
  '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#000000',
  '#6b7280', '#9ca3af', '#d1d5db', '#e5e7eb', '#f3f4f6', '#ffffff',
]

const WEIGHT_OPTS = ['100', '200', '300', '400', '500', '600', '700', '800', '900']
const ALIGN_OPTS = ['left', 'center', 'right', 'justify']
const DIRECTION_OPTS = ['row', 'row-reverse', 'column', 'column-reverse']
const JUSTIFY_OPTS = ['flex-start', 'center', 'flex-end', 'space-between', 'space-around']
const ITEMS_OPTS = ['flex-start', 'center', 'flex-end', 'stretch', 'baseline']
const BORDER_STYLE_OPTS = ['solid', 'dashed', 'dotted', 'none']

const FONT_OPTS = [
  { label: 'System', value: 'system-ui, -apple-system, sans-serif' },
  { label: 'Serif', value: 'serif' },
  { label: 'Mono', value: 'monospace' },
  { label: 'Sans', value: 'sans-serif' },
]

export function ManualEditPanel(props: {
  selectedTarget: ManualEditTarget | null
  draft: ManualEditDraft
  error: string | null
  busy?: boolean
  floatingStyle?: { left: number; top: number }
  onDraftChange: (draft: ManualEditDraft) => void
  onStyleChange?: (id: string, styles: Partial<ManualEditStyles>, label: string) => void
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
          <span title={panelTitle()}>{panelTitle()}</span>
          
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

function StyleInspector(props: {
  targetKind: ManualEditTarget['kind']
  styles: ManualEditStyles
  layoutEnabled: boolean
  onChange: (key: keyof ManualEditStyles, value: string) => void
}) {
  const u = (key: keyof ManualEditStyles, value: string) => props.onChange(key, value)

  return (
    <div class="cc-inspector">
      <Show when={props.targetKind === 'text' || props.targetKind === 'link' || props.targetKind === 'token' || props.targetKind === 'mixed'}>
        <Section title="TYPOGRAPHY">
          <FontRow value={props.styles.fontFamily} onChange={(v) => u('fontFamily', v)} />
          <UnitRow label="Size" value={props.styles.fontSize} onChange={(v) => u('fontSize', v)} unit="px" autoUnit />
          <DropdownRow label="Weight" value={props.styles.fontWeight} onChange={(v) => u('fontWeight', v)} options={WEIGHT_OPTS} />
          <ColorRow label="Color" value={props.styles.color} onChange={(v) => u('color', v)} />
          <DropdownRow label="Align" value={props.styles.textAlign} onChange={(v) => u('textAlign', v)} options={ALIGN_OPTS} />
          <UnitRow label="Line" value={props.styles.lineHeight} onChange={(v) => u('lineHeight', v)} unit="" />
          <UnitRow label="Tracking" value={props.styles.letterSpacing} onChange={(v) => u('letterSpacing', v)} unit="px" autoUnit />
        </Section>
      </Show>

      <Show when={props.targetKind !== 'text' && props.targetKind !== 'link' && props.targetKind !== 'token' && props.targetKind !== 'mixed'}>
        <Section title="SIZE">
          <SizePairRow
            width={props.styles.width}
            height={props.styles.height}
            onWidthChange={(v) => u('width', v)}
            onHeightChange={(v) => u('height', v)}
          />
        </Section>
      </Show>

      <Show when={props.layoutEnabled}>
        <Section title="LAYOUT">
          <UnitRow label="Gap" value={props.styles.gap} onChange={(v) => u('gap', v)} unit="px" autoUnit />
          <DropdownRow label="Direction" value={props.styles.flexDirection} onChange={(v) => u('flexDirection', v)} options={DIRECTION_OPTS} />
          <DropdownRow label="Justify" value={props.styles.justifyContent} onChange={(v) => u('justifyContent', v)} options={JUSTIFY_OPTS} />
          <DropdownRow label="Align" value={props.styles.alignItems} onChange={(v) => u('alignItems', v)} options={ITEMS_OPTS} />
        </Section>
      </Show>

      <Show when={props.targetKind === 'container' || props.targetKind === 'image' || props.targetKind === 'token'}>
        <Section title="BOX">
          <ColorRow label="Fill" value={props.styles.backgroundColor} onChange={(v) => u('backgroundColor', v)} />
          <UnitRow label="Opacity" value={props.styles.opacity} onChange={(v) => u('opacity', v)} unit="" />

          <QuadRow label="Padding" values={{
            t: props.styles.paddingTop, r: props.styles.paddingRight, b: props.styles.paddingBottom, l: props.styles.paddingLeft,
          }} onChange={(side, value) => u(sideToProp('padding', side), value)} />

          <QuadRow label="Margin" values={{
            t: props.styles.marginTop, r: props.styles.marginRight, b: props.styles.marginBottom, l: props.styles.marginLeft,
          }} onChange={(side, value) => u(sideToProp('margin', side), value)} />

          <QuadRow label="Border" values={{
            t: props.styles.borderTopWidth, r: props.styles.borderRightWidth, b: props.styles.borderBottomWidth, l: props.styles.borderLeftWidth,
          }} onChange={(side, value) => u(`border${sideUpper(side)}Width` as keyof ManualEditStyles, value)} />

          <DropdownRow label="Style" value={props.styles.borderStyle} onChange={(v) => u('borderStyle', v)} options={BORDER_STYLE_OPTS} />
          <ColorRow label="Color" value={props.styles.borderColor} onChange={(v) => u('borderColor', v)} />
          <UnitRow label="Radius" value={props.styles.borderRadius} onChange={(v) => u('borderRadius', v)} unit="px" autoUnit />
        </Section>
      </Show>
    </div>
  )
}

function Section(props: { title: string; children: any }) {
  return (
    <section class="cc-section">
      <header class="cc-section-head">{props.title}</header>
      <div class="cc-section-body">{props.children}</div>
    </section>
  )
}

function PairRow(props: { children: any }) {
  return <div class="cc-pair">{props.children}</div>
}

function SizePairRow(props: {
  width: string
  height: string
  onWidthChange: (v: string) => void
  onHeightChange: (v: string) => void
}) {
  const autoUnit = (raw: string) => {
    const trimmed = raw.trim()
    if (trimmed && /^-?\d+(\.\d+)?$/.test(trimmed)) return `${trimmed}px`
    return raw
  }

  const display = (value: string) => {
    const match = value.trim().match(/^(-?\d+(?:\.\d+)?)px$/i)
    return match?.[1] ?? value
  }

  return (
    <div class="cc-size-pair">
      <span class="cc-size-cell">
        <span class="cc-size-label">W</span>
        <input
          value={display(props.width)}
          onInput={(e) => props.onWidthChange(e.currentTarget.value)}
          onBlur={(e) => props.onWidthChange(autoUnit(e.currentTarget.value))}
          placeholder="0"
        />
      </span>
      <span class="cc-size-cell">
        <span class="cc-size-label">H</span>
        <input
          value={display(props.height)}
          onInput={(e) => props.onHeightChange(e.currentTarget.value)}
          onBlur={(e) => props.onHeightChange(autoUnit(e.currentTarget.value))}
          placeholder="0"
        />
      </span>
    </div>
  )
}

function UnitRow(props: {
  label: string
  value: string
  onChange: (v: string) => void
  unit: string
  autoUnit?: boolean
}) {
  const display = () => stripPxUnit(props.value)

  const valueFromDisplay = (raw: string) => {
    const trimmed = raw.trim()
    if (/^-?\d+(\.\d+)?px$/i.test(trimmed)) return trimmed.toLowerCase()
    if (props.autoUnit && trimmed && isNumericInput(trimmed)) return `${trimmed}px`
    return raw
  }

  return (
    <div class="cc-row">
      <span class="cc-label">{props.label}</span>
      <span class="cc-input-cell">
        <input
          value={display()}
          onInput={(e) => props.onChange(e.currentTarget.value)}
          onBlur={(e) => {
            const next = valueFromDisplay(e.currentTarget.value)
            if (next !== props.value) props.onChange(next)
          }}
          placeholder="0"
        />
      </span>
    </div>
  )
}

function DropdownRow(props: {
  label: string
  value: string
  onChange: (v: string) => void
  options: string[]
}) {
  const [open, setOpen] = createSignal(false)
  const [popupPos, setPopupPos] = createSignal({ top: 0, left: 0, width: 120 })
  let triggerRef: HTMLButtonElement | undefined
  let dropdownRef: HTMLDivElement | undefined

  const displayText = () => props.value || "请选择"

  const handleSelect = (option: string) => {
    props.onChange(option)
    setOpen(false)
  }

  const updatePosition = () => {
    if (!triggerRef) return
    const rect = triggerRef.getBoundingClientRect()
    setPopupPos({
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width
    })
  }

  const handleClickOutside = (e: MouseEvent) => {
    if (!open()) return
    const target = e.target as HTMLElement
    if (triggerRef && !triggerRef.contains(target) && dropdownRef && !dropdownRef.contains(target)) {
      setOpen(false)
    }
  }

  const handleWindowBlur = () => {
    if (open()) {
      setOpen(false)
    }
  }

  const handleScroll = () => {
    if (open()) {
      updatePosition()
    }
  }

  const handleResize = () => {
    if (open()) {
      updatePosition()
    }
  }

  createEffect(() => {
    if (open()) {
      updatePosition()
      document.addEventListener("click", handleClickOutside)
      document.addEventListener("scroll", handleScroll, true)
      window.addEventListener("resize", handleResize)
      window.addEventListener("blur", handleWindowBlur)
    } else {
      document.removeEventListener("click", handleClickOutside)
      document.removeEventListener("scroll", handleScroll, true)
      window.removeEventListener("resize", handleResize)
      window.removeEventListener("blur", handleWindowBlur)
    }
    onCleanup(() => {
      document.removeEventListener("click", handleClickOutside)
      document.removeEventListener("scroll", handleScroll, true)
      window.removeEventListener("resize", handleResize)
      window.removeEventListener("blur", handleWindowBlur)
    })
  })

  const popupStyle = () => ({
    position: "fixed" as const,
    top: `${popupPos().top}px`,
    left: `${popupPos().left}px`,
    "min-width": `${popupPos().width}px`,
    "z-index": 10001
  })

  return (
    <label class="cc-row">
      <span class="cc-label">{props.label}</span>
      <span class="cc-value cc-select">
        <button
          ref={triggerRef}
          type="button"
          class="cc-select-trigger"
          classList={{ "cc-select-trigger-active": open() }}
          onClick={() => setOpen(!open())}
        >
          <span class="cc-select-trigger-text">{displayText()}</span>
          <span class="cc-select-trigger-icon" style={{ transform: open() ? "rotate(180deg)" : "none" }}>
            <svg viewBox="0 0 20 20" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M10.0001 13.0418C10.2556 13.0418 10.4751 12.9474 10.6584 12.7585L15.4418 8.04183C15.5584 7.91961 15.6168 7.77238 15.6168 7.60016C15.6168 7.42794 15.5584 7.27516 15.4418 7.14183C15.3195 7.01961 15.1723 6.9585 15.0001 6.9585C14.8279 6.9585 14.6751 7.01961 14.5418 7.14183L10.0001 11.6585L5.44176 7.14183C5.31953 7.01961 5.17231 6.9585 5.00009 6.9585C4.82787 6.9585 4.68064 7.01961 4.55842 7.14183C4.44176 7.27516 4.38342 7.42794 4.38342 7.60016C4.38342 7.77238 4.44176 7.91961 4.55842 8.04183L9.34176 12.7585C9.52509 12.9474 9.74453 13.0418 10.0001 13.0418Z" fill="currentColor" fill-opacity="0.6"/>
            </svg>
          </span>
        </button>
        <Show when={open()}>
          <Portal mount={document.body}>
            <div ref={dropdownRef} class="cc-select-popup" style={popupStyle()}>
              <div class="cc-select-list">
                <For each={props.options}>
                  {(opt) => (
                    <div
                      class="cc-select-item"
                      classList={{ "cc-select-item-selected": props.value === opt }}
                      onClick={() => handleSelect(opt)}
                    >
                      {opt}
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Portal>
        </Show>
      </span>
    </label>
  )
}

function FontRow(props: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = createSignal(false)
  const [popupPos, setPopupPos] = createSignal({ top: 0, left: 0, width: 120 })
  let triggerRef: HTMLButtonElement | undefined
  let dropdownRef: HTMLDivElement | undefined

  const normalizedValue = () => normalizeFontFamilyForSelect(props.value)
  const customValue = () => normalizedValue() === props.value ? props.value : ''
  const displayText = () => {
    const normalized = normalizedValue()
    const opt = FONT_OPTS.find(o => o.value === normalized)
    return opt?.label || fontFamilyLabel(normalized) || "请选择"
  }

  const options = () => {
    const opts = [...FONT_OPTS]
    if (customValue() && !FONT_OPTS.some(o => o.value === customValue())) {
      opts.unshift({ label: fontFamilyLabel(customValue()), value: customValue() })
    }
    return opts
  }

  const handleSelect = (option: { label: string; value: string }) => {
    props.onChange(option.value)
    setOpen(false)
  }

  const updatePosition = () => {
    if (!triggerRef) return
    const rect = triggerRef.getBoundingClientRect()
    setPopupPos({
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width
    })
  }

  const handleClickOutside = (e: MouseEvent) => {
    if (!open()) return
    const target = e.target as HTMLElement
    if (triggerRef && !triggerRef.contains(target) && dropdownRef && !dropdownRef.contains(target)) {
      setOpen(false)
    }
  }

  const handleScroll = () => {
    if (open()) {
      updatePosition()
    }
  }

  const handleResize = () => {
    if (open()) {
      updatePosition()
    }
  }

  createEffect(() => {
    if (open()) {
      updatePosition()
      document.addEventListener("click", handleClickOutside)
      document.addEventListener("scroll", handleScroll, true)
      window.addEventListener("resize", handleResize)
    } else {
      document.removeEventListener("click", handleClickOutside)
      document.removeEventListener("scroll", handleScroll, true)
      window.removeEventListener("resize", handleResize)
    }
    onCleanup(() => {
      document.removeEventListener("click", handleClickOutside)
      document.removeEventListener("scroll", handleScroll, true)
      window.removeEventListener("resize", handleResize)
    })
  })

  const popupStyle = () => ({
    position: "fixed" as const,
    top: `${popupPos().top}px`,
    left: `${popupPos().left}px`,
    "min-width": `${popupPos().width}px`,
    "z-index": 10001
  })

  return (
    <label class="cc-row">
      <span class="cc-label">Font</span>
      <span class="cc-value cc-select">
        <button
          ref={triggerRef}
          type="button"
          class="cc-select-trigger"
          classList={{ "cc-select-trigger-active": open() }}
          onClick={() => setOpen(!open())}
        >
          <span class="cc-select-trigger-text">{displayText()}</span>
          <span class="cc-select-trigger-icon" style={{ transform: open() ? "rotate(180deg)" : "none" }}>
            <svg viewBox="0 0 20 20" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M10.0001 13.0418C10.2556 13.0418 10.4751 12.9474 10.6584 12.7585L15.4418 8.04183C15.5584 7.91961 15.6168 7.77238 15.6168 7.60016C15.6168 7.42794 15.5584 7.27516 15.4418 7.14183C15.3195 7.01961 15.1723 6.9585 15.0001 6.9585C14.8279 6.9585 14.6751 7.01961 14.5418 7.14183L10.0001 11.6585L5.44176 7.14183C5.31953 7.01961 5.17231 6.9585 5.00009 6.9585C4.82787 6.9585 4.68064 7.01961 4.55842 7.14183C4.44176 7.27516 4.38342 7.42794 4.38342 7.60016C4.38342 7.77238 4.44176 7.91961 4.55842 8.04183L9.34176 12.7585C9.52509 12.9474 9.74453 13.0418 10.0001 13.0418Z" fill="currentColor" fill-opacity="0.6"/>
            </svg>
          </span>
        </button>
        <Show when={open()}>
          <Portal mount={document.body}>
            <div ref={dropdownRef} class="cc-select-popup" style={popupStyle()}>
              <div class="cc-select-list">
                <For each={options()}>
                  {(opt) => (
                    <div
                      class="cc-select-item"
                      classList={{ "cc-select-item-selected": normalizedValue() === opt.value }}
                      onClick={() => handleSelect(opt)}
                    >
                      {opt.label}
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Portal>
        </Show>
      </span>
    </label>
  )
}

function normalizeFontFamilyForSelect(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  const direct = FONT_OPTS.find(o => o.value === trimmed)
  if (direct) return direct.value
  const families = parseFontFamilies(trimmed)
  const primaryFamily = families[0]
  const match = FONT_OPTS.find(o => {
    if (!o.value) return false
    const optionFamilies = parseFontFamilies(o.value)
    return optionFamilies[0] === primaryFamily
  })
  return match?.value ?? trimmed
}

function fontFamilyLabel(value: string): string {
  return parseFontFamilies(value)[0] ?? value
}

function parseFontFamilies(value: string): string[] {
  return value
    .split(',')
    .map(f => f.trim().replace(/^['"]|['"]$/g, '').toLowerCase())
    .filter(Boolean)
}

function ColorRow(props: {
  label: string
  value: string
  onChange: (v: string) => void
  compact?: boolean
}) {
  const [open, setOpen] = createSignal(false)
  let containerRef: HTMLDivElement | undefined
  let popoverRef: HTMLDivElement | undefined
  let swatchRef: HTMLButtonElement | undefined
  let inputRef: HTMLInputElement | undefined

  const isInsidePopover = (target: HTMLElement) => {
    return popoverRef && popoverRef.contains(target)
  }

  const isTriggerElement = (target: HTMLElement) => {
    return swatchRef?.contains(target) || inputRef?.contains(target)
  }

  const handleClickOutside = (e: MouseEvent) => {
    if (!open()) return
    const target = e.target as HTMLElement
    if (!isTriggerElement(target) && !isInsidePopover(target)) {
      setOpen(false)
    }
  }

  const handleWindowBlur = () => {
    if (open()) {
      setOpen(false)
    }
  }

  createEffect(() => {
    if (open()) {
      setTimeout(() => {
        document.addEventListener("click", handleClickOutside)
      }, 0)
      window.addEventListener("blur", handleWindowBlur)
    } else {
      document.removeEventListener("click", handleClickOutside)
      window.removeEventListener("blur", handleWindowBlur)
    }
    onCleanup(() => {
      document.removeEventListener("click", handleClickOutside)
      window.removeEventListener("blur", handleWindowBlur)
    })
  })

  const handleSwatchClick = (e: MouseEvent) => {
    e.stopPropagation()
    setOpen(!open())
  }

  const handleInputFocus = (e: FocusEvent) => {
    e.stopPropagation()
    setOpen(true)
  }

  return (
    <div ref={containerRef} class={`cc-row cc-color ${props.compact ? 'cc-color-compact' : ''}`}>
      <Show when={!props.compact}><span class="cc-label">{props.label}</span></Show>
      <span class="cc-input-cell" style={{ gap: '16px' }}>
        <button
          ref={swatchRef}
          type="button"
          class="cc-swatch"
          style={{ background: props.value || 'transparent' }}
          onClick={handleSwatchClick}
        />
        <input
          ref={inputRef}
          value={props.value}
          placeholder="(transparent)"
          onChange={(e) => props.onChange(e.currentTarget.value)}
          onFocus={handleInputFocus}
          onBlur={(e) => {
            if (!e.currentTarget.value && !open()) {
              props.onChange('')
            }
          }}
        />
        <Show when={open()}>
          <div ref={popoverRef} class="cc-color-popover" onClick={(e) => e.stopPropagation()}>
            <div class="cc-color-grid">
              <For each={EDITOR_SWATCH_COLORS}>{(hex) =>
                <button
                  type="button"
                  class="cc-color-tile"
                  style={{ background: hex }}
                  onClick={(e) => { e.stopPropagation(); props.onChange(hex); setOpen(false) }}
                />
              }</For>
            </div>
            <input
              type="color"
              class="cc-color-native"
              value={(() => {
                const normalized = normalizeColorForPicker(props.value)
                if (!normalized) return "#ffffff"
                if (normalized.startsWith("rgba")) {
                  const m = normalized.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
                  if (!m) return "#ffffff"
                  const r = parseInt(m[1]).toString(16).padStart(2, "0")
                  const g = parseInt(m[2]).toString(16).padStart(2, "0")
                  const b = parseInt(m[3]).toString(16).padStart(2, "0")
                  return `#${r}${g}${b}`
                }
                return normalized
              })()}
              onChange={(e) => props.onChange(e.currentTarget.value)}
            />
          </div>
        </Show>
      </span>
    </div>
  )
}

function QuadRow(props: {
  label: string
  values: { t: string; r: string; b: string; l: string }
  onChange: (side: 't' | 'r' | 'b' | 'l', value: string) => void
}) {
  const [open, setOpen] = createSignal(true)
  const allEqualValue = () => {
    const v = props.values.t
    return v === props.values.r && v === props.values.b && v === props.values.l ? v : null
  }

  return (
    <div class="cc-quad">
      <button type="button" class="cc-quad-head" onClick={() => setOpen(!open())}>
        <span>{props.label}</span>
        <Show when={!open() && allEqualValue() !== null} fallback={<span class="cc-chevron-small" style={{ transform: open() ? "rotate(180deg)" : "none" }}><svg viewBox="0 0 20 20" width="12" height="12" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M10.0001 13.0418C10.2556 13.0418 10.4751 12.9474 10.6584 12.7585L15.4418 8.04183C15.5584 7.91961 15.6168 7.77238 15.6168 7.60016C15.6168 7.42794 15.5584 7.27516 15.4418 7.14183C15.3195 7.01961 15.1723 6.9585 15.0001 6.9585C14.8279 6.9585 14.6751 7.01961 14.5418 7.14183L10.0001 11.6585L5.44176 7.14183C5.31953 7.01961 5.17231 6.9585 5.00009 6.9585C4.82787 6.9585 4.68064 7.01961 4.55842 7.14183C4.44176 7.27516 4.38342 7.42794 4.38342 7.60016C4.38342 7.77238 4.44176 7.91961 4.55842 8.04183L9.34176 12.7585C9.52509 12.9474 9.74453 13.0418 10.0001 13.0418Z" fill="currentColor" fill-opacity="0.6"/></svg></span>}>
          <em>{allEqualValue() || '0 px'}</em>
        </Show>
      </button>
      <Show when={open()}>
        <div class="cc-quad-grid">
          <QuadCell axis="T" value={props.values.t} onChange={(v) => props.onChange('t', v)} />
          <QuadCell axis="R" value={props.values.r} onChange={(v) => props.onChange('r', v)} />
          <QuadCell axis="B" value={props.values.b} onChange={(v) => props.onChange('b', v)} />
          <QuadCell axis="L" value={props.values.l} onChange={(v) => props.onChange('l', v)} />
        </div>
      </Show>
    </div>
  )
}

function QuadCell(props: { axis: string; value: string; onChange: (v: string) => void }) {
  const display = () => stripPxUnit(props.value)

  const handleChange = (e: Event) => {
    const raw = (e.currentTarget as HTMLInputElement).value.trim()
    if (raw === '') props.onChange('')
    else if (isNumericInput(raw)) props.onChange(`${raw}px`)
    else if (/^-?\d+(\.\d+)?px$/i.test(raw)) props.onChange(raw.toLowerCase())
    else props.onChange((e.currentTarget as HTMLInputElement).value)
  }

  const handleBlur = (e: Event) => {
    const v = (e.currentTarget as HTMLInputElement).value.trim()
    const next = v && isNumericInput(v) ? `${v}px` : (e.currentTarget as HTMLInputElement).value
    if (next !== props.value) props.onChange(next)
  }

  return (
    <span class="cc-quad-cell">
      <em class="cc-quad-axis">{props.axis}</em>
      <input value={display()} placeholder="0" onChange={handleChange} onBlur={handleBlur} />
    </span>
  )
}

function stripPxUnit(value: string): string {
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)px$/i)
  return match?.[1] ?? value
}

function isNumericInput(value: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(value.trim())
}

function sideToProp(base: 'padding' | 'margin', side: 't' | 'r' | 'b' | 'l'): keyof ManualEditStyles {
  return `${base}${sideUpper(side)}` as keyof ManualEditStyles
}

function sideUpper(side: 't' | 'r' | 'b' | 'l'): 'Top' | 'Right' | 'Bottom' | 'Left' {
  return side === 't' ? 'Top' : side === 'r' ? 'Right' : side === 'b' ? 'Bottom' : 'Left'
}

function normalizeColorForPicker(value: string): string {
  const trimmed = value.trim()
  
  if (trimmed === "transparent" || trimmed === "rgba(0, 0, 0, 0)") {
    return ""
  }
  
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed)) {
    if (trimmed.length === 4) {
      const r = trimmed[1]!, g = trimmed[2]!, b = trimmed[3]!
      return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
    }
    return trimmed.toLowerCase()
  }
  
  const match = trimmed.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\)/i)
  if (match) {
    const alpha = match[4] ? parseFloat(match[4]) : 1
    if (alpha === 0) return ""
    
    if (alpha < 1) {
      return trimmed
    }
    
    const toHex = (n: string) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, '0')
    return `#${toHex(match[1]!)}${toHex(match[2]!)}${toHex(match[3]!)}`
  }
  
  return ''
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