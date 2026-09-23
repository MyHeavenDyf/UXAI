import { Show, For, createSignal, createEffect, createMemo, onCleanup } from 'solid-js'
import { Portal } from 'solid-js/web'
import type { JSX } from 'solid-js'
import { ColorPicker, hexWithAlpha, hexToRgb } from '../model-edit-items/icon-data/color-picker'
import { HUI_COLOR_TOKENS, type ColorToken } from '../model-edit-items/icon-data/hui-color-tokens'
import { DragInput } from './drag-input'
import { CustomSelect } from '../model-edit-items/icon-data/custom-select'
import {
  FreeformIcon, RowIcon, ColIcon,
  HAlignIcon, VAlignIcon,
  PaddingIcon, MarginIcon, HorizontalPaddingIcon, VerticalPaddingIcon,
  OpacityIcon, CornerCurveIcon, BorderRadiusIcon,
  TopLeftBorderRadiusIcon, TopRightBorderRadiusIcon, BottomLeftBorderRadiusIcon, BottomRightBorderRadiusIcon,
  LineHeightIcon, LetterSpacingIcon,
  SettingsIcon,
} from '../../../pattern/modules/preview/property-editor-popup/icons'
import type { EffectEntry } from '../../edit-mode/source-patches'
import { IconSizeCheckmark, IconPaddingLeft, IconPaddingTop, IconPaddingRight, IconPaddingBottom, IconEye, IconEyeSlash, IconHighlights, IconEffectMinus, IconEffectPlus, IconGranule, IconXmark } from '../../icons'
import '../../../pattern/assets/style/preview/PropertyEditorPopup.css'

export { ColorPicker, HUI_COLOR_TOKENS, DragInput, CustomSelect }
export {
  FreeformIcon, RowIcon, ColIcon,
  HAlignIcon, VAlignIcon,
  PaddingIcon, MarginIcon, HorizontalPaddingIcon, VerticalPaddingIcon,
  OpacityIcon, CornerCurveIcon, BorderRadiusIcon,
  TopLeftBorderRadiusIcon, TopRightBorderRadiusIcon, BottomLeftBorderRadiusIcon, BottomRightBorderRadiusIcon,
  LineHeightIcon, LetterSpacingIcon,
  SettingsIcon,
}

export const BORDER_STYLE_OPTS = ['solid', 'dashed', 'dotted', 'none']

export const LAYOUT_GRID = [
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

export function Section(props: { title: string; actions?: JSX.Element; children: any }) {
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

export function PairRow(props: { children: any }) {
  return <div class="cc-pair">{props.children}</div>
}

export function sideToProp(base: 'padding' | 'margin', side: 't' | 'r' | 'b' | 'l'): string {
  return `${base}${sideUpper(side)}`
}

export function sideUpper(side: 't' | 'r' | 'b' | 'l'): 'Top' | 'Right' | 'Bottom' | 'Left' {
  return side === 't' ? 'Top' : side === 'r' ? 'Right' : side === 'b' ? 'Bottom' : 'Left'
}

export function readableContentName(value: string | undefined): string {
  const clean = (value ?? '').replace(/\s+/g, ' ').trim()
  if (!clean) return ''
  if (looksGeneratedIdentifier(clean)) return ''
  return clean.length > 42 ? `${clean.slice(0, 39).trim()}...` : clean
}

export function looksGeneratedIdentifier(value: string): boolean {
  return /^path(?:-\d+)+$/i.test(value) || /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)
}

export function QuadModeSection(props: {
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
          <For each={[{ v: 'all' as const, label: '四周' }, { v: 'hv' as const, label: '水平/垂直' }, { v: 'trbl' as const, label: '独立边距' }]}>
            {(m) => (
              <button onClick={() => { setMode(m.v); setModeOpen(false) }}>
                <span class="cc-quad-mode-check" style={{ visibility: mode() === m.v ? 'visible' : 'hidden' }}>
                  <IconSizeCheckmark />
                </span>
                <span>{m.label}</span>
              </button>
            )}
          </For>
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
          <DragInput value={side('l')} setValue={setSide('l')} setFound={() => {}} found={() => true} placeholder="左" icon={<IconPaddingLeft />} />
          <DragInput value={side('t')} setValue={setSide('t')} setFound={() => {}} found={() => true} placeholder="上" icon={<IconPaddingTop />} />
          <DragInput value={side('r')} setValue={setSide('r')} setFound={() => {}} found={() => true} placeholder="右" icon={<IconPaddingRight />} />
          <DragInput value={side('b')} setValue={setSide('b')} setFound={() => {}} found={() => true} placeholder="下" icon={<IconPaddingBottom />} />
        </div>
      </Show>
    </Section>
  )
}

const EFFECT_TYPE_LABELS: Record<EffectEntry['type'], string> = {
  'drop-shadow': '阴影',
  'layer-blur': '模糊',
  'background-blur': '背景模糊',
}

function rgbToHexStr(r: number, g: number, b: number): string {
  return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`
}

export function EffectsSection(props: {
  effects: EffectEntry[]
  onChange: (next: EffectEntry[]) => void
  showSectionWrapper?: boolean
  colors?: ColorToken[]
}) {
  const update = (id: string, patch: Partial<EffectEntry>) => {
    props.onChange(props.effects.map(e => e.id === id ? { ...e, ...patch } : e))
  }
  const addEffect = () => {
    const next: EffectEntry = {
      id: `effect-${Date.now()}-${props.effects.length}`,
      type: 'drop-shadow',
      visible: true,
      expanded: false,
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
    if (popupEffectId() === id) setPopupEffectId(null)
    props.onChange(props.effects.filter(e => e.id !== id))
  }

  const [popupEffectId, setPopupEffectId] = createSignal<string | null>(null)
  const [popupPos, setPopupPos] = createSignal({ left: 0, top: 0 })
  const popupEffect = createMemo(() => props.effects.find(e => e.id === popupEffectId()) ?? null)
  let popupRef: HTMLDivElement | undefined
  let popupCardRef: HTMLElement | undefined

  const togglePopup = (id: string, el: HTMLElement) => {
    if (popupEffectId() === id) { setPopupEffectId(null); return }
    setPopupEffectId(id)
    popupCardRef = el.closest('.cc-effect-card') ?? undefined
    const rect = el.getBoundingClientRect()
    const pw = 220
    const left = Math.max(4, Math.min(rect.left, window.innerWidth - pw - 4))
    const top = Math.min(rect.bottom + 8, Math.max(4, window.innerHeight - 240))
    setPopupPos({ left, top })
  }

  const startTitleDrag = (e: MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX - popupPos().left
    const startY = e.clientY - popupPos().top
    const onMove = (ev: MouseEvent) => {
      setPopupPos({ left: Math.max(0, ev.clientX - startX), top: Math.max(0, ev.clientY - startY) })
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  createEffect(() => {
    if (!popupEffectId()) return
    const handler = (ev: MouseEvent) => {
      const t = ev.target as HTMLElement
      if (popupRef && popupRef.contains(t)) return
      if (popupCardRef && popupCardRef.contains(t)) return
      if (t.closest?.('[data-color-picker-popup]')) return
      if (t.closest?.('[data-custom-select-list]')) return
      setPopupEffectId(null)
    }
    document.addEventListener('mousedown', handler)
    onCleanup(() => document.removeEventListener('mousedown', handler))
  })

  const colorValue = (e: EffectEntry) => hexWithAlpha(e.color, e.opacity)
  const onColorChange = (id: string, hex: string) => {
    const rgb = hexToRgb(hex)
    if (!rgb) return
    update(id, { color: rgbToHexStr(rgb.r, rgb.g, rgb.b), opacity: rgb.a })
  }

  const content = (
    <div class="cc-effects-row">
      <div class="cc-effects-head">
        <span>效果</span>
        <button type="button" class="prop-chip cc-effect-add" onClick={addEffect} title="添加" aria-label="添加">
          <IconEffectPlus />
        </button>
      </div>
      <For each={props.effects}>
        {(e) => (
          <div class="cc-effect-card">
            <div class="cc-effect-row">
              <button
                type="button"
                class="prop-chip cc-effect-toggle"
                onClick={() => update(e.id, { visible: !e.visible })}
                title={e.visible ? '隐藏' : '显示'}
                aria-label={e.visible ? '隐藏' : '显示'}
              >
                <Show when={e.visible} fallback={<IconEyeSlash />}><IconEye /></Show>
              </button>
              <CustomSelect
                checkmark
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
                class="prop-chip cc-effect-config"
                onClick={(ev) => togglePopup(e.id, ev.currentTarget)}
                onMouseDown={(ev) => ev.stopPropagation()}
                title="配置"
                aria-label="配置"
              >
                <IconHighlights />
              </button>
              <button
                type="button"
                class="prop-chip cc-effect-remove"
                onClick={() => removeEffect(e.id)}
                title="删除"
                aria-label="删除"
              >
                <IconEffectMinus />
              </button>
            </div>
          </div>
        )}
      </For>
      <Show when={popupEffect()}>
        <Portal>
          <div ref={popupRef} class="cc-effect-popup" style={{ left: `${popupPos().left}px`, top: `${popupPos().top}px` }}>
            <div class="cc-effect-popup-title" onMouseDown={startTitleDrag}>
              <span>{EFFECT_TYPE_LABELS[popupEffect()!.type]}</span>
              <button type="button" class="cc-effect-popup-close" onClick={() => setPopupEffectId(null)} title="关闭" aria-label="关闭">
                <IconXmark />
              </button>
            </div>
            <Show when={popupEffect()!.type === 'drop-shadow'}>
              <div class="cc-effect-popup-row">
                <span class="cc-effect-popup-label">位置</span>
                <DragInput value={() => popupEffect()!.offsetX} setValue={(v) => update(popupEffect()!.id, { offsetX: v, foundOffsetX: true })} setFound={() => {}} found={() => popupEffect()!.foundOffsetX} placeholder="X" icon={<span class="cc-effect-icon-text">X</span>} />
              </div>
              <div class="cc-effect-popup-row">
                <span class="cc-effect-popup-label" style={{ visibility: 'hidden' }}>位置</span>
                <DragInput value={() => popupEffect()!.offsetY} setValue={(v) => update(popupEffect()!.id, { offsetY: v, foundOffsetY: true })} setFound={() => {}} found={() => popupEffect()!.foundOffsetY} placeholder="Y" icon={<span class="cc-effect-icon-text">Y</span>} />
              </div>
              <div class="cc-effect-popup-row">
                <span class="cc-effect-popup-label">模糊</span>
                <DragInput value={() => popupEffect()!.blur} setValue={(v) => update(popupEffect()!.id, { blur: v, foundBlur: true })} setFound={() => {}} found={() => popupEffect()!.foundBlur} placeholder="模糊值" icon={<IconGranule />} />
              </div>
              <div class="cc-effect-popup-row">
                <span class="cc-effect-popup-label">颜色</span>
                <ColorPicker label="颜色" value={colorValue(popupEffect()!)} tokens={props.colors ?? HUI_COLOR_TOKENS} onChange={(hex) => onColorChange(popupEffect()!.id, hex)} />
              </div>
            </Show>
            <Show when={popupEffect()!.type === 'layer-blur'}>
              <div class="cc-effect-popup-row">
                <span class="cc-effect-popup-label">模糊</span>
                <DragInput value={() => popupEffect()!.layerBlur} setValue={(v) => update(popupEffect()!.id, { layerBlur: v, foundLayerBlur: true })} setFound={() => {}} found={() => popupEffect()!.foundLayerBlur} placeholder="模糊值" icon={<IconGranule />} />
              </div>
            </Show>
            <Show when={popupEffect()!.type === 'background-blur'}>
              <div class="cc-effect-popup-row">
                <span class="cc-effect-popup-label">模糊</span>
                <DragInput value={() => popupEffect()!.bgBlur} setValue={(v) => update(popupEffect()!.id, { bgBlur: v, foundBgBlur: true })} setFound={() => {}} found={() => popupEffect()!.foundBgBlur} placeholder="模糊值" icon={<IconGranule />} />
              </div>
            </Show>
          </div>
        </Portal>
      </Show>
    </div>
  )

  if (props.showSectionWrapper === false) return content
  return <Section title="效果">{content}</Section>
}
