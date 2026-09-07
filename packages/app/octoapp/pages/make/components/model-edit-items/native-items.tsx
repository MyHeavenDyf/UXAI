import type { JSX } from 'solid-js'
import { Show, For, createSignal } from 'solid-js'
import type { ModelEditElement, ManualEditKind } from './types'
import {
  ColorPicker, HUI_COLOR_TOKENS, DragInput, CustomSelect,
  HAlignIcon, VAlignIcon,
  FreeformIcon, RowIcon, ColIcon,
  OpacityIcon, CornerCurveIcon, BorderRadiusIcon,
  TopLeftBorderRadiusIcon, TopRightBorderRadiusIcon, BottomLeftBorderRadiusIcon, BottomRightBorderRadiusIcon,
  LineHeightIcon, LetterSpacingIcon,
  Section, QuadModeSection, EffectsSection,
  LAYOUT_GRID,
} from '../result-viewer/row-primitives'
import type { EffectEntry } from '../../edit-mode/source-patches'
import { parseEffects } from '../../edit-mode/source-patches'

export type { ManualEditKind }

export type NativeItemDef = {
  type: string
  defaultKey: string
  readValue: (element: ModelEditElement) => string
  render: (props: { value: () => string; onChange: (v: string) => void }) => JSX.Element
}

function rgbToHex(rgb: string): string {
  const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (!m) return ''
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
      <ColorPicker label="文字色" value={props.value()} tokens={HUI_COLOR_TOKENS} onChange={props.onChange} />
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
            <button type="button" onClick={() => update({ flexDirection: '' })} class={!fd() ? 'prop-chip-active cc-layout-dir-btn' : 'prop-chip cc-layout-dir-btn'} title="自由布局" aria-label="自由布局"><FreeformIcon /></button>
            <button type="button" onClick={() => update({ flexDirection: 'row' })} class={fd() === 'row' || fd() === 'row-reverse' ? 'prop-chip-active cc-layout-dir-btn' : 'prop-chip cc-layout-dir-btn'} title="行布局" aria-label="行布局"><RowIcon /></button>
            <button type="button" onClick={() => update({ flexDirection: 'column' })} class={fd() === 'column' || fd() === 'column-reverse' ? 'prop-chip-active cc-layout-dir-btn' : 'prop-chip cc-layout-dir-btn'} title="列布局" aria-label="列布局"><ColIcon /></button>
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
                <DragInput value={() => numFromString(data().gap)} setValue={(v) => update({ gap: `${v}px` })} setFound={() => {}} found={() => true} placeholder="间距" />
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

      return (
        <Section title="宽高">
          <div class="cc-size-row">
            <DragInput value={() => numFromString(w())} setValue={(v) => update({ width: `${v}px` })} setFound={() => {}} found={() => true} placeholder="宽" icon="W" />
            <DragInput value={() => numFromString(h())} setValue={(v) => update({ height: `${v}px` })} setFound={() => {}} found={() => true} placeholder="高" icon="H" />
          </div>
          <div class="cc-size-checkboxes">
            <label class="cc-size-checkbox">
              <input type="checkbox" checked={w() === '100%'} onChange={(e) => update({ width: e.currentTarget.checked ? '100%' : '' })} />
              <span>填充宽度</span>
            </label>
            <label class="cc-size-checkbox">
              <input type="checkbox" checked={h() === '100%'} onChange={(e) => update({ height: e.currentTarget.checked ? '100%' : '' })} />
              <span>填充高度</span>
            </label>
            <label class="cc-size-checkbox">
              <input type="checkbox" checked={w() === 'fit-content' || w() === 'max-content' || w() === 'auto'} onChange={(e) => update({ width: e.currentTarget.checked ? 'fit-content' : '' })} />
              <span>适应宽度</span>
            </label>
            <label class="cc-size-checkbox">
              <input type="checkbox" checked={h() === 'fit-content' || h() === 'max-content' || h() === 'auto'} onChange={(e) => update({ height: e.currentTarget.checked ? 'fit-content' : '' })} />
              <span>适应高度</span>
            </label>
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

      return (
        <Section title="外观">
          <ColorPicker label="Fill" value={bg()} tokens={HUI_COLOR_TOKENS} onChange={(v) => update({ backgroundColor: v })} />
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
              <DragInput value={() => numFromString(data().borderTopLeftRadius || '')} setValue={(v) => update({ borderTopLeftRadius: `${v}px` })} setFound={() => {}} found={() => true} placeholder="左上" icon={<TopLeftBorderRadiusIcon />} />
              <DragInput value={() => numFromString(data().borderTopRightRadius || '')} setValue={(v) => update({ borderTopRightRadius: `${v}px` })} setFound={() => {}} found={() => true} placeholder="右上" icon={<TopRightBorderRadiusIcon />} />
              <DragInput value={() => numFromString(data().borderBottomLeftRadius || '')} setValue={(v) => update({ borderBottomLeftRadius: `${v}px` })} setFound={() => {}} found={() => true} placeholder="左下" icon={<BottomLeftBorderRadiusIcon />} />
              <DragInput value={() => numFromString(data().borderBottomRightRadius || '')} setValue={(v) => update({ borderBottomRightRadius: `${v}px` })} setFound={() => {}} found={() => true} placeholder="右下" icon={<BottomRightBorderRadiusIcon />} />
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
          <ColorPicker label="Color" value={bc()} tokens={HUI_COLOR_TOKENS} onChange={(v) => update({ borderColor: v })} />
          <div class="cc-stroke-row">
            <DragInput
              value={() => numFromString(btw())}
              setValue={(v) => {
                if (!borderIndividualOpen()) setBorderWidthAll(v)
                else update({ borderTopWidth: `${v}px` })
              }}
              setFound={() => {}} found={() => true}
              placeholder="宽度"
            />
            <button type="button" class={borderIndividualOpen() ? 'prop-chip-active cc-stroke-expand' : 'prop-chip cc-stroke-expand'} onClick={() => setBorderIndividualOpen(!borderIndividualOpen())} title="四角独立" aria-label="四角独立">
              <span style={{ "font-size": "10px" }}>◱</span>
            </button>
            <CustomSelect value={bs() || 'none'} options={BORDER_STYLE_OPTS} onChange={(v) => update({ borderStyle: v })} />
          </div>
          <Show when={borderIndividualOpen()}>
            <div class="cc-stroke-trbl">
              <DragInput value={() => numFromString(btw())} setValue={(v) => update({ borderTopWidth: `${v}px` })} setFound={() => {}} found={() => true} placeholder="上" />
              <DragInput value={() => numFromString(data().borderRightWidth || '')} setValue={(v) => update({ borderRightWidth: `${v}px` })} setFound={() => {}} found={() => true} placeholder="右" />
              <DragInput value={() => numFromString(data().borderBottomWidth || '')} setValue={(v) => update({ borderBottomWidth: `${v}px` })} setFound={() => {}} found={() => true} placeholder="下" />
              <DragInput value={() => numFromString(data().borderLeftWidth || '')} setValue={(v) => update({ borderLeftWidth: `${v}px` })} setFound={() => {}} found={() => true} placeholder="左" />
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
      return <EffectsSection effects={data()} onChange={onChange} showSectionWrapper={false} />
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
