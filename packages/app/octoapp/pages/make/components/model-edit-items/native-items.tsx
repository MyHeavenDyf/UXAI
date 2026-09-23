import type { JSX } from 'solid-js'
import { Show, For, createSignal, createEffect, onCleanup } from 'solid-js'
import { Portal } from 'solid-js/web'
import type { ModelEditElement, ManualEditKind } from './types'
import type { ColorToken } from './icon-data/hui-color-tokens'
import {
  ColorPicker, HUI_COLOR_TOKENS, DragInput, CustomSelect,
  HAlignIcon, VAlignIcon,
  FreeformIcon,
  OpacityIcon, CornerCurveIcon, BorderRadiusIcon,
  TopLeftBorderRadiusIcon, TopRightBorderRadiusIcon, BottomLeftBorderRadiusIcon, BottomRightBorderRadiusIcon,
  LineHeightIcon, LetterSpacingIcon,
  Section, QuadModeSection, EffectsSection,
  LAYOUT_GRID,
} from '../result-viewer/row-primitives'
import { IconSizeFixedWidth, IconSizeAdjustWidth, IconSizeFillWidth, IconSizeCheckmark, IconBorderMenu, IconBorderAll, IconBorderLeft, IconBorderTop, IconBorderRight, IconBorderBottom } from '../../icons'
import type { EffectEntry } from '../../edit-mode/source-patches'
import { parseEffects } from '../../edit-mode/source-patches'

export type { ManualEditKind }

export type NativeItemRenderProps = {
  value: () => string
  onChange: (v: string) => void
  colors: ColorToken[]
}

export type NativeItemDef = {
  type: string
  defaultKey: string
  readValue: (element: ModelEditElement) => string
  render: (props: NativeItemRenderProps) => JSX.Element
}

function rgbToHex(rgb: string): string {
  const m = rgb.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/)
  if (!m) return ''
  const alpha = m[4] !== undefined ? parseFloat(m[4]) : 1
  if (alpha <= 0) return ''
  const r = parseInt(m[1]), g = parseInt(m[2]), b = parseInt(m[3])
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
}

function isColorProp(prop: string): boolean {
  return prop === 'color' || prop === 'backgroundColor' || prop === 'borderColor'
}

function roundPx(value: string): string {
  const m = value.match(/^([\d.]+)px$/)
  if (!m) return value
  return Math.round(parseFloat(m[1])) + 'px'
}

function normalizeStyle(prop: string, value: string): string {
  if (!value) return ''
  if (isColorProp(prop)) return rgbToHex(value) || value
  if (prop.startsWith('border') && prop.endsWith('Width')) return roundPx(value)
  return value
}

function numFromString(s: string): number {
  return parseFloat(s) || 0
}

function parseJson(s: string): Record<string, string> {
  try { return JSON.parse(s) } catch { return {} }
}

function LayoutColIcon() {
  return (
    <svg viewBox="0 0 14 14" width="14" height="14" fill="none">
      <path d="M2.51563 1.53125L11.4844 1.53125C11.5445 1.53125 11.5938 1.58047 11.5938 1.64063L11.5938 2.46093C11.5938 2.52109 11.5445 2.57031 11.4844 2.57031L2.51563 2.57031C2.45547 2.57031 2.40625 2.52109 2.40625 2.46093L2.40625 1.64063C2.40625 1.58047 2.45547 1.53125 2.51563 1.53125ZM2.51563 11.4297L11.4844 11.4297C11.5445 11.4297 11.5938 11.4789 11.5938 11.5391L11.5938 12.3594C11.5938 12.4195 11.5445 12.4688 11.4844 12.4688L2.51563 12.4688C2.45547 12.4688 2.40625 12.4195 2.40625 12.3594L2.40625 11.5391C2.40625 11.4789 2.45547 11.4297 2.51563 11.4297Z" fill="currentColor" fill-rule="evenodd" />
      <path d="M6.47854 7.86035L6.47854 4.19629L7.46292 4.19629L7.46292 7.86035L8.37483 7.86035C8.45823 7.86035 8.50335 7.95606 8.45276 8.02031L7.07464 9.76348C7.03635 9.81406 6.95979 9.81406 6.92014 9.76348L5.54202 8.02031C5.49143 7.95606 5.53792 7.86035 5.61995 7.86035L6.47854 7.86035Z" fill="currentColor" fill-rule="evenodd" />
    </svg>
  )
}

function LayoutGapIcon() {
  return (
    <svg viewBox="0 0 12.25 12.25" width="12" height="12" fill="none">
      <path d="M8.45833 6.125L4.375 6.125" stroke="currentColor" stroke-linejoin="round" stroke-width="0.875" />
      <rect width="0.875" height="2.625" x="3.5" y="4.8125" fill="currentColor" />
      <rect width="0.875" height="2.625" x="7.875" y="4.8125" fill="currentColor" />
      <path d="M0 1.75L2.1875 1.75L2.1875 10.5L0 10.5" stroke="currentColor" stroke-width="0.875" />
      <path d="M0 0L2.1875 0L2.1875 8.75L0 8.75" stroke="currentColor" stroke-width="0.875" transform="matrix(-1,0,0,1,12.6875,1.75)" />
    </svg>
  )
}

type SizeMode = 'fixed' | 'fit' | 'fill'

function SizeModeSelect(props: {
  value: SizeMode
  fixedValue: string
  axis: 'width' | 'height'
  onModeChange: (mode: SizeMode) => void
}): JSX.Element {
  const [open, setOpen] = createSignal(false)
  const [pos, setPos] = createSignal({ x: 0, y: 0, w: 0 })
  let btnRef!: HTMLButtonElement
  let listRef!: HTMLDivElement

  const isW = () => props.axis === 'width'
  const shortLabel = () => props.value === 'fixed' ? '固定' : props.value === 'fit' ? '适应' : '填充'
  const ModeIcon = (mode: SizeMode): JSX.Element => {
    const Icon = isW()
      ? (mode === 'fixed' ? IconSizeFixedWidth : mode === 'fit' ? IconSizeAdjustWidth : IconSizeFillWidth)
      : (mode === 'fixed' ? IconSizeFixedWidth : mode === 'fit' ? IconSizeAdjustWidth : IconSizeFillWidth)
    return <Icon />
  }

  const modes: { value: SizeMode; longLabel: string }[] = isW()
    ? [
        { value: 'fixed', longLabel: '固定宽度' },
        { value: 'fit', longLabel: '适应内容' },
        { value: 'fill', longLabel: '填充容器' },
      ]
    : [
        { value: 'fixed', longLabel: '固定高度' },
        { value: 'fit', longLabel: '适应内容' },
        { value: 'fill', longLabel: '填充容器' },
      ]

  createEffect(() => {
    if (!open()) return
    const handler = (e: MouseEvent) => {
      if (listRef && !listRef.contains(e.target as Node) && !btnRef.contains(e.target as Node)) setOpen(false)
    }
    const onScroll = () => setOpen(false)
    if (btnRef) {
      const r = btnRef.getBoundingClientRect()
      setPos({ x: r.left, y: r.bottom + 4, w: r.width })
      requestAnimationFrame(() => {
        if (!listRef) return
        const lr = listRef.getBoundingClientRect()
        if (!lr.height) return
        const fitsDown = r.bottom + 4 + lr.height <= window.innerHeight
        const ay = fitsDown ? r.bottom + 4 : Math.max(4, r.top - 4 - lr.height)
        setPos({ x: r.left, y: ay, w: r.width })
      })
    }
    document.addEventListener('mousedown', handler)
    window.addEventListener('scroll', onScroll, true)
    onCleanup(() => {
      document.removeEventListener('mousedown', handler)
      window.removeEventListener('scroll', onScroll, true)
    })
  })

  return (
    <div class="relative flex-1 min-w-0">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen(!open())}
        class="flex h-8 w-full items-center gap-1.5 rounded-[4px] bg-[#F9F9F9] px-2 text-left text-[12px] outline-none border border-transparent hover:border-[#c9c9c9]"
      >
        <span class="inline-flex items-center justify-center shrink-0" style={{ color: 'rgba(0,0,0,0.4)', ...(isW() ? {} : { transform: 'rotate(90deg)' }) }}>
          {ModeIcon(props.value)}
        </span>
        <span class="flex-1 truncate" style={{ color: '#191919' }}>{shortLabel()}</span>
        <svg class="w-3 h-3 ml-0.5 shrink-0 text-slate-400" viewBox="0 0 8 5" fill="none"><path d="M1 1L4 4L7 1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </button>
      <Show when={open()}>
        <Portal mount={document.body}>
          <div ref={listRef} class="fixed z-[2147483646] flex flex-col gap-1 rounded-lg p-1"
            style={{
              left: pos().x + 'px',
              top: pos().y + 'px',
              width: '166px',
              background: '#fff',
              'border-radius': '8px',
              'box-shadow': '0 4px 12px 0 rgba(0,0,0,0.16)',
            }}>
            <For each={modes}>
              {(m) => (
                <button
                  type="button"
                  onClick={() => { props.onModeChange(m.value); setOpen(false) }}
                  class="flex items-center gap-2 rounded-[4px] px-2 text-left cursor-pointer border-none bg-transparent outline-none hover:bg-[rgba(0,0,0,0.05)]"
                  style={{ 'line-height': '32px', 'font-size': '14px', 'font-weight': '400', color: 'rgba(25,25,25,1)' }}
                >
                  <span class="inline-flex items-center justify-center shrink-0" style={{ color: 'rgba(0,0,0,0.9)', ...(isW() ? {} : { transform: 'rotate(90deg)' }) }}>
                    {ModeIcon(m.value)}
                  </span>
                  <span class="flex-1 truncate">{m.longLabel}</span>
                  <Show when={props.value === m.value}>
                    <span class="inline-flex items-center justify-center shrink-0" style={{ color: 'rgba(0,0,0,0.9)' }}>
                      <IconSizeCheckmark />
                    </span>
                  </Show>
                </button>
              )}
            </For>
          </div>
        </Portal>
      </Show>
    </div>
  )
}

const FONT_FAMILY_OPTS = [
  { label: 'Default', value: '' },
  { label: 'Sans', value: 'sans-serif' },
  { label: 'Serif', value: 'serif' },
  { label: 'Mono', value: 'monospace' },
]

const FONT_WEIGHT_OPTS = [
  { label: 'Thin', value: '100' },
  { label: 'Extra Light', value: '200' },
  { label: 'Light', value: '300' },
  { label: 'Regular', value: '400' },
  { label: 'Medium', value: '500' },
  { label: 'Semi Bold', value: '600' },
  { label: 'Bold', value: '700' },
  { label: 'Extra Bold', value: '800' },
  { label: 'Black', value: '900' },
]

const BORDER_STYLE_OPTS = [
  { label: '实线', value: 'solid' },
  { label: '虚线', value: 'dashed' },
  { label: '点线', value: 'dotted' },
  { label: '无', value: 'none' },
]

const NATIVE_ITEMS_LIST: NativeItemDef[] = [
  {
    type: 'textContent',
    defaultKey: 'od_textContent',
    readValue: (el) => el.text || '',
    render: (props) => (
      <textarea
        class="cc-textarea"
        value={props.value()}
        onInput={(e) => props.onChange(e.currentTarget.value)}
        placeholder="输入文本内容..."
        rows={3}
      />
    ),
  },
  {
    type: 'href',
    defaultKey: 'od_href',
    readValue: (el) => el.attributes.href || '',
    render: (props) => (
      <label class="cc-row">
        <span class="cc-label">Href</span>
        <input
          type="url"
          class="cc-input-url"
          value={props.value()}
          onInput={(e) => props.onChange(e.currentTarget.value)}
          placeholder="https://..."
          autocomplete="off"
        />
      </label>
    ),
  },
  {
    type: 'fontFamily',
    defaultKey: 'od_fontFamily',
    readValue: (el) => normalizeStyle('fontFamily', el.styles.fontFamily || ''),
    render: (props) => (
      <div class="cc-typ-row">
        <span class="cc-typ-label">字体</span>
        <CustomSelect value={props.value()} options={FONT_FAMILY_OPTS} onChange={props.onChange} />
      </div>
    ),
  },
  {
    type: 'fontWeight',
    defaultKey: 'od_fontWeight',
    readValue: (el) => normalizeStyle('fontWeight', el.styles.fontWeight || ''),
    render: (props) => (
      <div class="cc-typ-row">
        <span class="cc-typ-label">字重</span>
        <CustomSelect value={props.value()} options={FONT_WEIGHT_OPTS} onChange={props.onChange} />
      </div>
    ),
  },
  {
    type: 'fontSize',
    defaultKey: 'od_fontSize',
    readValue: (el) => normalizeStyle('fontSize', el.styles.fontSize || ''),
    render: (props) => (
      <div class="cc-typ-row">
        <span class="cc-typ-label">字号</span>
        <DragInput
          value={() => numFromString(props.value())}
          setValue={(v) => props.onChange(`${v}px`)}
          setFound={() => {}} found={() => true}
          placeholder="字号" icon="S"
        />
      </div>
    ),
  },
  {
    type: 'color',
    defaultKey: 'od_color',
    readValue: (el) => normalizeStyle('color', el.styles.color || ''),
    render: (props) => (
      <ColorPicker label="文字色" value={props.value()} tokens={props.colors} onChange={props.onChange} />
    ),
  },
  {
    type: 'textAlign',
    defaultKey: 'od_textAlign',
    readValue: (el) => el.styles.textAlign || '',
    render: (props) => (
      <div class="cc-typ-align-row">
        <div class="cc-typ-align-cell">
          <span class="cc-typ-sublabel">水平对齐</span>
          <div class="cc-typ-align-group">
            <button type="button" onClick={() => props.onChange(props.value() === 'left' ? '' : 'left')} class={props.value() === 'left' ? 'prop-chip-active cc-typ-align-btn' : 'prop-chip cc-typ-align-btn'} title="左对齐" aria-label="左对齐"><HAlignIcon value="left" /></button>
            <button type="button" onClick={() => props.onChange(props.value() === 'center' ? '' : 'center')} class={props.value() === 'center' ? 'prop-chip-active cc-typ-align-btn' : 'prop-chip cc-typ-align-btn'} title="居中" aria-label="居中"><HAlignIcon value="center" /></button>
            <button type="button" onClick={() => props.onChange(props.value() === 'right' ? '' : 'right')} class={props.value() === 'right' ? 'prop-chip-active cc-typ-align-btn' : 'prop-chip cc-typ-align-btn'} title="右对齐" aria-label="右对齐"><HAlignIcon value="right" /></button>
            <button type="button" onClick={() => props.onChange(props.value() === 'justify' ? '' : 'justify')} class={props.value() === 'justify' ? 'prop-chip-active cc-typ-align-btn' : 'prop-chip cc-typ-align-btn'} title="两端对齐" aria-label="两端对齐"><HAlignIcon value="justify" /></button>
          </div>
        </div>
      </div>
    ),
  },
  {
    type: 'lineHeight',
    defaultKey: 'od_lineHeight',
    readValue: (el) => el.styles.lineHeight || '',
    render: (props) => (
      <div class="cc-typ-pair-cell">
        <span class="cc-typ-sublabel">行高</span>
        <DragInput
          value={() => numFromString(props.value())}
          setValue={(v) => {
            const raw = props.value().trim()
            const unitless = /^\d+(\.\d+)?$/.test(raw)
            props.onChange(unitless ? String(v) : `${v}px`)
          }}
          setFound={() => {}} found={() => true}
          placeholder="auto" flex1={false}
        />
      </div>
    ),
  },
  {
    type: 'letterSpacing',
    defaultKey: 'od_letterSpacing',
    readValue: (el) => el.styles.letterSpacing || '',
    render: (props) => (
      <div class="cc-typ-pair-cell">
        <span class="cc-typ-sublabel">字间距</span>
        <DragInput
          value={() => numFromString(props.value())}
          setValue={(v) => props.onChange(`${v}px`)}
          setFound={() => {}} found={() => true}
          placeholder="0" flex1={false}
        />
      </div>
    ),
  },
  {
    type: 'verticalAlign',
    defaultKey: 'od_verticalAlign',
    readValue: (el) => el.styles.verticalAlign || '',
    render: (props) => (
      <div class="cc-typ-align-cell">
        <span class="cc-typ-sublabel">垂直对齐</span>
        <div class="cc-typ-align-group">
          <button type="button" onClick={() => props.onChange(props.value() === 'top' ? '' : 'top')} class={props.value() === 'top' ? 'prop-chip-active cc-typ-align-btn' : 'prop-chip cc-typ-align-btn'} title="顶部对齐" aria-label="顶部对齐"><VAlignIcon value="start" /></button>
          <button type="button" onClick={() => props.onChange(props.value() === 'middle' ? '' : 'middle')} class={props.value() === 'middle' ? 'prop-chip-active cc-typ-align-btn' : 'prop-chip cc-typ-align-btn'} title="居中" aria-label="居中"><VAlignIcon value="center" /></button>
          <button type="button" onClick={() => props.onChange(props.value() === 'bottom' ? '' : 'bottom')} class={props.value() === 'bottom' ? 'prop-chip-active cc-typ-align-btn' : 'prop-chip cc-typ-align-btn'} title="底部对齐" aria-label="底部对齐"><VAlignIcon value="end" /></button>
        </div>
      </div>
    ),
  },
  {
    type: 'layoutGroup',
    defaultKey: 'od_layout',
    readValue: (el) => JSON.stringify({
      flexDirection: el.styles.flexDirection || '',
      justifyContent: el.styles.justifyContent || '',
      alignItems: el.styles.alignItems || '',
      gap: el.styles.gap || '',
    }),
    render: (props) => {
      const data = () => parseJson(props.value())
      const update = (patch: Record<string, string>) => props.onChange(JSON.stringify({ ...data(), ...patch }))
      const fd = () => data().flexDirection || ''

      return (
        <Section title="布局">
          <div class="cc-layout-direction">
            <button type="button" onClick={() => update({ flexDirection: 'column' })} class={fd() === 'column' || fd() === 'column-reverse' ? 'cc-layout-dir-btn cc-layout-dir-btn-active' : 'cc-layout-dir-btn'} title="列布局" aria-label="列布局"><LayoutColIcon /></button>
            <button type="button" onClick={() => update({ flexDirection: 'row' })} class={fd() === 'row' || fd() === 'row-reverse' ? 'cc-layout-dir-btn cc-layout-dir-btn-active' : 'cc-layout-dir-btn'} title="行布局" aria-label="行布局"><span class="inline-flex" style={{ transform: 'rotate(90deg)' }}><LayoutColIcon /></span></button>
            <button type="button" onClick={() => update({ flexDirection: '' })} class={!fd() ? 'cc-layout-dir-btn cc-layout-dir-btn-active' : 'cc-layout-dir-btn'} title="自由布局" aria-label="自由布局"><FreeformIcon /></button>
          </div>
          <Show when={!!fd()}>
            <div class="cc-layout-grid-wrap">
              <div class="cc-layout-grid">
                <For each={LAYOUT_GRID}>
                  {(p) => {
                    const selected = () => data().justifyContent === p.justify && data().alignItems === p.align
                    return (
                      <button type="button" onClick={() => update({ justifyContent: p.justify, alignItems: p.align })} class={selected() ? 'cc-layout-cell cc-layout-cell-active' : 'cc-layout-cell'} title={p.label} aria-label={p.label}>
                        <div class={selected() ? 'cc-layout-dot cc-layout-dot-active' : 'cc-layout-dot'} />
                      </button>
                    )
                  }}
                </For>
              </div>
              <div class="cc-layout-gap-col">
                <DragInput value={() => numFromString(data().gap)} setValue={(v) => update({ gap: `${v}px` })} setFound={() => {}} found={() => true} placeholder="间距" icon={<LayoutGapIcon />} />
                <label class="cc-layout-radio">
                  <input type="radio" name="layout-justify-mode" checked={data().justifyContent === 'space-between'} onChange={() => update({ justifyContent: 'space-between' })} />
                  <span>两端对齐</span>
                </label>
                <label class="cc-layout-radio">
                  <input type="radio" name="layout-justify-mode" checked={data().justifyContent === 'space-around'} onChange={() => update({ justifyContent: 'space-around' })} />
                  <span>环绕分布</span>
                </label>
              </div>
            </div>
          </Show>
        </Section>
      )
    },
  },
  {
    type: 'sizeGroup',
    defaultKey: 'od_size',
    readValue: (el) => JSON.stringify({
      width: el.styles.width || '',
      height: el.styles.height || '',
      overflow: el.styles.overflow || '',
    }),
    render: (props) => {
      const data = () => parseJson(props.value())
      const update = (patch: Record<string, string>) => props.onChange(JSON.stringify({ ...data(), ...patch }))
      const w = () => data().width || ''
      const h = () => data().height || ''

      // 尺寸模式：fill=100% / fit=fit-content / fixed=具体 px
      const wMode = (): SizeMode => w() === '100%' ? 'fill' : (w() === 'fit-content' || w() === 'max-content' || w() === 'auto') ? 'fit' : 'fixed'
      const hMode = (): SizeMode => h() === '100%' ? 'fill' : (h() === 'fit-content' || h() === 'max-content' || h() === 'auto') ? 'fit' : 'fixed'
      const [fixedCache, setFixedCache] = createSignal<{ width?: string; height?: string }>({})
      // 初始 px 值缓存（首次读取 fixed 模式时记录）
      const cacheFixed = (axis: 'width' | 'height', val: string) => {
        if (!val || val === '100%' || val === 'fit-content' || val === 'max-content' || val === 'auto') return
        setFixedCache(prev => prev[axis] === val ? prev : { ...prev, [axis]: val })
      }
      createEffect(() => { cacheFixed('width', w()) })
      createEffect(() => { cacheFixed('height', h()) })
      const onWModeChange = (mode: SizeMode) => {
        if (mode === 'fill') update({ width: '100%' })
        else if (mode === 'fit') update({ width: 'fit-content' })
        else update({ width: fixedCache().width || '' })
      }
      const onHModeChange = (mode: SizeMode) => {
        if (mode === 'fill') update({ height: '100%' })
        else if (mode === 'fit') update({ height: 'fit-content' })
        else update({ height: fixedCache().height || '' })
      }

      return (
        <Section title="宽高">
          <div class="cc-size-grid">
            <DragInput value={() => numFromString(w())} setValue={(v) => update({ width: `${v}px` })} setFound={() => {}} found={() => true} placeholder="宽" icon="W" />
            <DragInput value={() => numFromString(h())} setValue={(v) => update({ height: `${v}px` })} setFound={() => {}} found={() => true} placeholder="高" icon="H" />
            <SizeModeSelect value={wMode()} fixedValue={w()} axis="width" onModeChange={onWModeChange} />
            <SizeModeSelect value={hMode()} fixedValue={h()} axis="height" onModeChange={onHModeChange} />
          </div>
          <div class="cc-size-checkboxes">
            <label class="cc-size-checkbox cc-size-clip">
              <input type="checkbox" checked={data().overflow === 'hidden'} onChange={(e) => update({ overflow: e.currentTarget.checked ? 'hidden' : '' })} />
              <span>裁剪内容</span>
            </label>
          </div>
        </Section>
      )
    },
  },
  {
    type: 'paddingGroup',
    defaultKey: 'od_padding',
    readValue: (el) => JSON.stringify({
      t: normalizeStyle('paddingTop', el.styles.paddingTop || ''),
      r: normalizeStyle('paddingRight', el.styles.paddingRight || ''),
      b: normalizeStyle('paddingBottom', el.styles.paddingBottom || ''),
      l: normalizeStyle('paddingLeft', el.styles.paddingLeft || ''),
    }),
    render: (props) => {
      const data = () => parseJson(props.value())
      const onChange = (side: 't' | 'r' | 'b' | 'l', value: string) => {
        props.onChange(JSON.stringify({ ...data(), [side]: value }))
      }
      return (
        <QuadModeSection
          title="内边距"
          base="padding"
          values={{ t: data().t || '', r: data().r || '', b: data().b || '', l: data().l || '' }}
          onChange={onChange}
        />
      )
    },
  },
  {
    type: 'marginGroup',
    defaultKey: 'od_margin',
    readValue: (el) => JSON.stringify({
      t: normalizeStyle('marginTop', el.styles.marginTop || ''),
      r: normalizeStyle('marginRight', el.styles.marginRight || ''),
      b: normalizeStyle('marginBottom', el.styles.marginBottom || ''),
      l: normalizeStyle('marginLeft', el.styles.marginLeft || ''),
    }),
    render: (props) => {
      const data = () => parseJson(props.value())
      const onChange = (side: 't' | 'r' | 'b' | 'l', value: string) => {
        props.onChange(JSON.stringify({ ...data(), [side]: value }))
      }
      return (
        <QuadModeSection
          title="外边距"
          base="margin"
          values={{ t: data().t || '', r: data().r || '', b: data().b || '', l: data().l || '' }}
          onChange={onChange}
        />
      )
    },
  },
  {
    type: 'appearanceGroup',
    defaultKey: 'od_appearance',
    readValue: (el) => JSON.stringify({
      backgroundColor: normalizeStyle('backgroundColor', el.styles.backgroundColor || ''),
      opacity: el.styles.opacity || '',
      borderRadius: el.styles.borderRadius || '',
      borderTopLeftRadius: el.styles.borderTopLeftRadius || '',
      borderTopRightRadius: el.styles.borderTopRightRadius || '',
      borderBottomRightRadius: el.styles.borderBottomRightRadius || '',
      borderBottomLeftRadius: el.styles.borderBottomLeftRadius || '',
    }),
    render: (props) => {
      const data = () => parseJson(props.value())
      const update = (patch: Record<string, string>) => props.onChange(JSON.stringify({ ...data(), ...patch }))
      const [cornerOpen, setCornerOpen] = createSignal(false)
      const bg = () => data().backgroundColor || ''
      const op = () => data().opacity || ''
      const br = () => data().borderRadius || ''

      const setCorner = (key: 'borderTopLeftRadius' | 'borderTopRightRadius' | 'borderBottomRightRadius' | 'borderBottomLeftRadius', v: number) => {
        const d = data()
        const currentBR = d.borderRadius
        if (currentBR) {
          update({ borderRadius: '', borderTopLeftRadius: key === 'borderTopLeftRadius' ? `${v}px` : (d.borderTopLeftRadius || currentBR), borderTopRightRadius: key === 'borderTopRightRadius' ? `${v}px` : (d.borderTopRightRadius || currentBR), borderBottomRightRadius: key === 'borderBottomRightRadius' ? `${v}px` : (d.borderBottomRightRadius || currentBR), borderBottomLeftRadius: key === 'borderBottomLeftRadius' ? `${v}px` : (d.borderBottomLeftRadius || currentBR) })
        } else {
          update({ [key]: `${v}px` })
        }
      }

      return (
        <Section title="外观">
          <ColorPicker label="Fill" value={bg()} tokens={props.colors} onChange={(v) => update({ backgroundColor: v })} />
          <div class="cc-stroke-row">
            <DragInput
              value={() => Math.round(numFromString(op()) * 100)}
              setValue={(v) => update({ opacity: String(Math.round(v) / 100) })}
              setFound={() => {}} found={() => true}
              placeholder="透明度" max={100} icon={<OpacityIcon />} suffixIcon="%"
            />
            <DragInput
              value={() => numFromString(br())}
              setValue={(v) => update({ borderRadius: `${v}px`, borderTopLeftRadius: '', borderTopRightRadius: '', borderBottomRightRadius: '', borderBottomLeftRadius: '' })}
              setFound={() => {}} found={() => true}
              placeholder="圆角" icon={<CornerCurveIcon />} suffixIcon={<BorderRadiusIcon />}
              display={cornerOpen() && (data().borderTopLeftRadius || data().borderTopRightRadius || data().borderBottomRightRadius || data().borderBottomLeftRadius) ? 'mixed' : undefined}
            />
            <button type="button" class={cornerOpen() ? 'prop-chip-active cc-stroke-expand' : 'prop-chip cc-stroke-expand'} onClick={() => setCornerOpen(!cornerOpen())} title="四角独立" aria-label="四角独立">
              <span style={{ "font-size": "10px" }}>◱</span>
            </button>
          </div>
          <Show when={cornerOpen()}>
            <div class="cc-stroke-trbl">
              <DragInput value={() => numFromString(data().borderTopLeftRadius || '')} setValue={(v) => setCorner('borderTopLeftRadius', v)} setFound={() => {}} found={() => true} placeholder="左上" icon={<TopLeftBorderRadiusIcon />} />
              <DragInput value={() => numFromString(data().borderTopRightRadius || '')} setValue={(v) => setCorner('borderTopRightRadius', v)} setFound={() => {}} found={() => true} placeholder="右上" icon={<TopRightBorderRadiusIcon />} />
              <DragInput value={() => numFromString(data().borderBottomLeftRadius || '')} setValue={(v) => setCorner('borderBottomLeftRadius', v)} setFound={() => {}} found={() => true} placeholder="左下" icon={<BottomLeftBorderRadiusIcon />} />
              <DragInput value={() => numFromString(data().borderBottomRightRadius || '')} setValue={(v) => setCorner('borderBottomRightRadius', v)} setFound={() => {}} found={() => true} placeholder="右下" icon={<BottomRightBorderRadiusIcon />} />
            </div>
          </Show>
        </Section>
      )
    },
  },
  {
    type: 'borderGroup',
    defaultKey: 'od_border',
    readValue: (el) => JSON.stringify({
      borderColor: normalizeStyle('borderColor', el.styles.borderColor || ''),
      borderTopWidth: normalizeStyle('borderTopWidth', el.styles.borderTopWidth || ''),
      borderRightWidth: normalizeStyle('borderRightWidth', el.styles.borderRightWidth || ''),
      borderBottomWidth: normalizeStyle('borderBottomWidth', el.styles.borderBottomWidth || ''),
      borderLeftWidth: normalizeStyle('borderLeftWidth', el.styles.borderLeftWidth || ''),
      borderStyle: el.styles.borderStyle || '',
    }),
    render: (props) => {
      const data = () => parseJson(props.value())
      const update = (patch: Record<string, string>) => props.onChange(JSON.stringify({ ...data(), ...patch }))
      const [borderIndividualOpen, setBorderIndividualOpen] = createSignal(false)
      const bc = () => data().borderColor || ''
      const btw = () => data().borderTopWidth || ''
      const bs = () => data().borderStyle || ''

      const setBorderWidthAll = (v: number) => {
        update({ borderTopWidth: `${v}px`, borderRightWidth: `${v}px`, borderBottomWidth: `${v}px`, borderLeftWidth: `${v}px` })
      }

      return (
        <Section title="描边">
          <ColorPicker label="Color" value={bc()} tokens={props.colors} onChange={(v) => update({ borderColor: v })} />
          <div class="cc-stroke-row">
            <CustomSelect value={bs() || 'none'} options={BORDER_STYLE_OPTS} onChange={(v) => update({ borderStyle: v })} checkmark dropdownWidth={166} />
            <DragInput
              value={() => numFromString(btw())}
              setValue={(v) => {
                if (!borderIndividualOpen()) setBorderWidthAll(v)
                else update({ borderTopWidth: `${v}px` })
              }}
              setFound={() => {}} found={() => true}
              placeholder="宽度"
              icon={<IconBorderMenu />}
            />
            <button type="button" class={borderIndividualOpen() ? 'cc-stroke-expand cc-stroke-expand-active' : 'cc-stroke-expand'} onClick={() => setBorderIndividualOpen(!borderIndividualOpen())} title="独立边距" aria-label="独立边距">
              <IconBorderAll />
            </button>
          </div>
          <Show when={borderIndividualOpen()}>
            <div class="cc-stroke-trbl">
              <DragInput value={() => numFromString(data().borderLeftWidth || '')} setValue={(v) => update({ borderLeftWidth: `${v}px` })} setFound={() => {}} found={() => true} placeholder="左" icon={<IconBorderLeft />} />
              <DragInput value={() => numFromString(btw())} setValue={(v) => update({ borderTopWidth: `${v}px` })} setFound={() => {}} found={() => true} placeholder="上" icon={<IconBorderTop />} />
              <DragInput value={() => numFromString(data().borderRightWidth || '')} setValue={(v) => update({ borderRightWidth: `${v}px` })} setFound={() => {}} found={() => true} placeholder="右" icon={<IconBorderRight />} />
              <DragInput value={() => numFromString(data().borderBottomWidth || '')} setValue={(v) => update({ borderBottomWidth: `${v}px` })} setFound={() => {}} found={() => true} placeholder="下" icon={<IconBorderBottom />} />
            </div>
          </Show>
        </Section>
      )
    },
  },
  {
    type: 'effectsGroup',
    defaultKey: 'od_effects',
    readValue: (el) => JSON.stringify(parseEffects(el.styles.boxShadow || '', el.styles.filter || '', el.styles.backdropFilter || '')),
    render: (props) => {
      const data = () => {
        try {
          return JSON.parse(props.value()) as EffectEntry[]
        } catch { return [] as EffectEntry[] }
      }
      const onChange = (next: EffectEntry[]) => {
        props.onChange(JSON.stringify(next))
      }
      return <EffectsSection effects={data()} onChange={onChange} showSectionWrapper={false} colors={props.colors} />
    },
  },
  {
    type: 'bgImageGroup',
    defaultKey: 'od_bgImage',
    readValue: (el) => el.styles.backgroundImage || '',
    render: (props) => (
      <Section title="背景图">
        <div class="cc-bgimage-row">
          <div class="cc-bgimage-preview" style={{ background: props.value() ? `center / cover no-repeat ${props.value()}` : undefined }} />
          <div class="cc-bgimage-actions">
            <input
              type="text"
              class="cc-input-url"
              value={props.value()}
              onInput={(e) => props.onChange(e.currentTarget.value)}
              placeholder="url(...) 或留空"
            />
            <Show when={props.value()}>
              <button type="button" class="cc-action-btn" onClick={() => props.onChange('')}>Clear</button>
            </Show>
          </div>
        </div>
      </Section>
    ),
  },
]

export const NATIVE_ITEMS: Record<string, NativeItemDef> = Object.fromEntries(
  NATIVE_ITEMS_LIST.map(item => [item.type, item])
)
