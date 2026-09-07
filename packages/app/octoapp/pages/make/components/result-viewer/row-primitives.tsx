import { Show, For, createSignal, createEffect, onCleanup } from 'solid-js'
import type { JSX } from 'solid-js'
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
import type { EffectEntry } from '../../edit-mode/source-patches'
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

export function EffectsSection(props: {
  effects: EffectEntry[]
  onChange: (next: EffectEntry[]) => void
  showSectionWrapper?: boolean
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

  const content = (
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
  )

  if (props.showSectionWrapper === false) return content
  return <Section title="效果">{content}</Section>
}
