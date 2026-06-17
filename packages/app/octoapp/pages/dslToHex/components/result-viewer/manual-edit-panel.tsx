import { createSignal, Show, For } from 'solid-js'
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
  
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
  
  const startPanelDrag = (event: PointerEvent) => {
    if (!props.onFloatingPositionChange) return
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
    
    const move = (moveEvent: PointerEvent) => {
      props.onFloatingPositionChange!({
        left: clamp(startLeft + moveEvent.clientX - startX, pad, maxLeft),
        top: clamp(startTop + moveEvent.clientY - startY, pad, maxTop)
      })
    }
    
    const up = () => {
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
      class={`manual-edit-right${props.floatingStyle ? ' manual-edit-floating' : ''}`}
      style={props.floatingStyle ? { 
        left: `${props.floatingStyle.left}px`, 
        top: `${props.floatingStyle.top}px`,
        right: 'auto',
        bottom: 'auto'
      } : undefined}
    >
      <section class="manual-edit-modal cc-panel">
        <div class="manual-edit-titlebar">
          {/* 拖拽按钮（只在floating模式下显示） */}
          <Show when={props.floatingStyle}>
            <button
              type="button"
              class="manual-edit-drag-handle"
              aria-label="Move panel"
              title="Move panel"
              onPointerDown={startPanelDrag}
            >
              ⋮⋮
            </button>
          </Show>
          
          <span title={panelTitle()}>{panelTitle()}</span>
          
          <Show when={props.onExit}>
            <button
              type="button"
              class="manual-edit-titlebar-close"
              aria-label="Close panel"
              title="Close panel"
              onClick={props.onExit}
            >
              ✕
            </button>
          </Show>
        </div>

        <div class="manual-edit-scroll">
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
                    🗑
                  </button>
                }
              >
                <div class="manual-edit-delete-confirm">
                  <span>Delete element?</span>
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
          <UnitRow label="Width" value={props.styles.width} onChange={(v) => u('width', v)} unit="px" autoUnit />
          <UnitRow label="Height" value={props.styles.height} onChange={(v) => u('height', v)} unit="px" autoUnit />
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

function UnitRow(props: {
  label: string
  value: string
  onChange: (v: string) => void
  unit: string
  autoUnit?: boolean
}) {
  const display = () => stripPxUnit(props.value)
  const canStep = () => isNumericInput(display())

  const valueFromDisplay = (raw: string) => {
    const trimmed = raw.trim()
    if (props.autoUnit && trimmed && isNumericInput(trimmed)) return `${trimmed}px`
    if (props.autoUnit && /^-?\d+(\.\d+)?px$/i.test(trimmed)) return trimmed.toLowerCase()
    return raw
  }

  const handle = (raw: string) => {
    const next = valueFromDisplay(raw)
    if (next !== props.value) props.onChange(next)
  }

  const stepBy = (direction: -1 | 1) => {
    if (!canStep()) return
    const step = props.unit === 'px' ? 1 : 0.1
    const next = formatSteppedNumber(Number(display()) + direction * step, display(), step)
    props.onChange(valueFromDisplay(next))
  }

  return (
    <label class="cc-row">
      <span class="cc-label">{props.label}</span>
      <span class="cc-value">
        <button type="button" class="cc-step" disabled={!canStep()} onClick={() => stepBy(-1)}>−</button>
        <input
          value={display()}
          onChange={(e) => props.onChange(valueFromDisplay(e.currentTarget.value))}
          onBlur={(e) => handle(e.currentTarget.value)}
        />
        <button type="button" class="cc-step" disabled={!canStep()} onClick={() => stepBy(1)}>+</button>
        <Show when={props.unit && !isKeyword(display())}><em class="cc-unit">{props.unit}</em></Show>
      </span>
    </label>
  )
}

function DropdownRow(props: {
  label: string
  value: string
  onChange: (v: string) => void
  options: string[]
}) {
  return (
    <label class="cc-row">
      <span class="cc-label">{props.label}</span>
      <span class="cc-value cc-select">
        <select value={props.value} onChange={(e) => props.onChange(e.currentTarget.value)}>
          <For each={props.options}>{(opt) => <option value={opt}>{opt}</option>}</For>
        </select>
        <em class="cc-chevron">▾</em>
      </span>
    </label>
  )
}

function FontRow(props: { value: string; onChange: (v: string) => void }) {
  const normalizedValue = () => normalizeFontFamilyForSelect(props.value)
  const customValue = () => normalizedValue() === props.value ? props.value : ''

  return (
    <label class="cc-row">
      <span class="cc-label">Font</span>
      <span class="cc-value cc-select">
        <select value={normalizedValue()} onChange={(e) => props.onChange(e.currentTarget.value)}>
          <Show when={customValue() && !FONT_OPTS.some(o => o.value === customValue())}>
            <option value={customValue()}>{fontFamilyLabel(customValue())}</option>
          </Show>
          <For each={FONT_OPTS}>{(opt) => <option value={opt.value}>{opt.label}</option>}</For>
        </select>
        <em class="cc-chevron">▾</em>
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

  return (
    <label class={`cc-row cc-color ${props.compact ? 'cc-color-compact' : ''}`}>
      <Show when={!props.compact}><span class="cc-label">{props.label}</span></Show>
      <span class="cc-value">
        <button
          type="button"
          class="cc-swatch"
          style={{ background: props.value || 'transparent' }}
          onClick={() => setOpen(!open())}
        />
        <input
          value={props.value}
          placeholder="(transparent)"
          onChange={(e) => props.onChange(e.currentTarget.value)}
          onFocus={() => setOpen(true)}
        />
        <Show when={open()}>
          <div class="cc-color-popover">
            <div class="cc-color-grid">
              <For each={EDITOR_SWATCH_COLORS}>{(hex) =>
                <button
                  type="button"
                  class="cc-color-tile"
                  style={{ background: hex }}
                  onClick={() => { props.onChange(hex); setOpen(false) }}
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
    </label>
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
        <Show when={!open() && allEqualValue() !== null} fallback={<span class="cc-chevron-small">{open() ? '▾' : '▸'}</span>}>
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
  const canStep = () => isNumericInput(display())

  const stepBy = (direction: -1 | 1) => {
    if (!canStep()) return
    props.onChange(`${formatSteppedNumber(Number(display()) + direction, display(), 1)}px`)
  }

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
      <button type="button" class="cc-step cc-step-quad" disabled={!canStep()} onClick={() => stepBy(-1)}>−</button>
      <input value={display()} placeholder="0" onChange={handleChange} onBlur={handleBlur} />
      <button type="button" class="cc-step cc-step-quad" disabled={!canStep()} onClick={() => stepBy(1)}>+</button>
      <em class="cc-quad-unit">px</em>
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

function isKeyword(value: string): boolean {
  return /^(normal|auto|inherit|initial|unset|none)$/i.test(value.trim())
}

function formatSteppedNumber(value: number, current: string, step: number): string {
  const decimals = Math.max(decimalPlaces(current), decimalPlaces(String(step)))
  return decimals > 0
    ? value.toFixed(decimals).replace(/\.?0+$/, '')
    : String(Math.round(value))
}

function decimalPlaces(value: string): number {
  const match = value.match(/\.(\d+)/)
  return match?.[1]?.length ?? 0
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