import { createEffect, createMemo, createSignal, onCleanup, Show, For } from "solid-js"
import { Portal } from "solid-js/web"
import { createStore, reconcile } from "solid-js/store"
import { logStartSession, logAgentCall } from "../../utils/persist"

interface ElementRect {
  top: number
  left: number
  width: number
  height: number
}

interface ContainerSize {
  width: number
  height: number
}

const TEXT_ELEMENTS = [
  'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'a', 'label', 'li', 'section', 'header', 'footer', 'main', 'nav', 'article', 'aside',
]

const LABEL_MAP: Record<string, string> = {
  value: '文本内容', color: '颜色', types: '类型', size: '尺寸', shape: '形状',
  icon: '图标', iconPlacement: '图标位置', variant: '样式', status: '状态',
  name: '图标名', orientation: '方向', titlePlacement: '文字位置',
  closable: '可关闭', closeIcon: '关闭图标', count: '数值', dot: '圆点模式',
  showZero: '显示零', overflowCount: '溢出数', placeholder: '占位符',
  disabled: '禁用', readonly: '只读', required: '必填', maxLength: '最大长度',
  min: '最小值', max: '最大值', step: '步长', rows: '行数',
  checked: '选中', label: '标签', key: '键值', className: '样式类',
}

const COMPONENT_ENUMS: Record<string, string[]> = {
  'Button.color': ['default', 'primary', 'danger', 'success', 'warning', 'info'],
  'Button.types': ['default', 'link'],
  'Button.size': ['large', 'medium', 'small'],
  'Button.iconPlacement': ['start', 'end'],
  'Button.shape': ['default', 'circle', 'round'],
  'Icon.shape': ['outline', 'fill', 'square', 'circle'],
  'Icon.color': ['default', 'primary', 'success', 'warning', 'error', 'inverse'],
}

const ENUM_DEFAULTS: Record<string, string> = {
  'Button.size': 'medium',
  'Button.iconPlacement': 'start',
}

const COMPONENT_PROPS: Record<string, string[]> = {
  Button: ['value', 'color', 'types', 'size', 'icon', 'iconPlacement', 'shape', 'className'],
  Icon: ['name', 'shape', 'color', 'className'],
}

const TW_FONT_SIZES: Record<string, number> = {
  xs: 12, sm: 14, base: 16, lg: 18, xl: 20, '2xl': 24, '3xl': 30,
  '4xl': 36, '5xl': 48, '6xl': 60, '7xl': 72, '8xl': 96, '9xl': 128,
}

const TW_FONT_WEIGHTS: Record<string, number> = {
  thin: 100, extralight: 200, light: 300, normal: 400, medium: 500,
  semibold: 600, bold: 700, extrabold: 800, black: 900,
}

const FW_TO_TW = Object.fromEntries(Object.entries(TW_FONT_WEIGHTS).map(([k, v]) => [v, k]))

const TW_PREFIXES = [
  'p-', 'pt-', 'pr-', 'pb-', 'pl-', 'px-', 'py-',
  'm-', 'mt-', 'mr-', 'mb-', 'ml-', 'mx-', 'my-',
  'w-', 'h-', 'min-w-', 'min-h-', 'max-w-', 'max-h-',
  'text-', 'font-', 'leading-', 'tracking-',
  'rounded-', 'rounded-tl-', 'rounded-tr-', 'rounded-br-', 'rounded-bl-',
  'bg-', 'border-', 'border-t-', 'border-r-', 'border-b-', 'border-l-',
  'shadow-', 'blur-', 'backdrop-blur-',
  'flex', 'flex-col', 'flex-row', 'flex-wrap', 'flex-nowrap',
  'gap-', 'justify-', 'items-', 'opacity-', 'overflow-',
]

function isTailwindToken(cls: string): boolean {
  for (const p of TW_PREFIXES) {
    if (cls === p) return true
    if (cls.startsWith(p) || cls.startsWith(p + '[')) return true
  }
  return false
}

function _px(cls: string, prefix: string): number | null {
  const m = cls.match(new RegExp(`${prefix}-\\[(\\d+)px\\]`))
  if (m) return Number(m[1])
  const n = Number(cls.startsWith(`${prefix}-`) ? cls.slice(prefix.length + 1) : '')
  if (!isNaN(n)) {
    const px = n * 4
    if ([0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64].includes(px)) return px
  }
  return null
}

function _pxGap(cls: string, cb: (v: number) => void) {
  let m = cls.match(/gap-\[(\d+)px\]/)
  if (m) { cb(Number(m[1])); return }
  m = cls.match(/gap-(\d+)/)
  if (m) {
    const px = Number(m[1]) * 4
    if ([0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64].includes(px)) cb(px)
  }
}

export interface ModifyElementData {
  elementId: string
  className: string
  textContent: string
  componentProps: Record<string, string>
  tag?: string
  keepOpen?: boolean
  saveToHistory?: boolean
}

export function PropertyEditorPopup(props: {
  show: boolean
  elementId: string
  componentType: string
  currentClass?: string
  elementProps?: string
  elementRect: ElementRect
  clickPoint?: { x: number; y: number }
  containerSize: ContainerSize
  onConfirm: (data: ModifyElementData) => void
  onCancel: () => void
}) {
  let popupRef: HTMLDivElement | undefined

  const [popupW, setPopupW] = createSignal(0)
  const [popupH, setPopupH] = createSignal(0)
  const [dragOffset, setDragOffset] = createStore({ x: 0, y: 0 })
  const [initialPos, setInitialPos] = createStore({ right: 20, top: 115 })

  const isTextElement = createMemo(() => TEXT_ELEMENTS.includes(props.componentType))
  const hasClassEditor = createMemo(() =>
    isTextElement() ||
    (COMPONENT_PROPS[props.componentType]?.includes('className') ?? false)
  )

  const [editText, setEditText] = createSignal('')
  const [editFontSize, setEditFontSize] = createSignal(14)
  const [editFontWeight, setEditFontWeight] = createSignal(400)
  const [foundFontSize, setFoundFontSize] = createSignal(false)
  const [foundFontWeight, setFoundFontWeight] = createSignal(false)
  const [editAlign, setEditAlign] = createSignal('')
  const [editFontFamily, setEditFontFamily] = createSignal('')
  const [editLineHeight, setEditLineHeight] = createSignal('')
  const [editLetterSpacing, setEditLetterSpacing] = createSignal(0)
  const [editVAlign, setEditVAlign] = createSignal('')
  const [editTextColor, setEditTextColor] = createSignal('')
  const [editBgColor, setEditBgColor] = createSignal('')

  const [editPt, setEditPt] = createSignal(0)
  const [editPr, setEditPr] = createSignal(0)
  const [editPb, setEditPb] = createSignal(0)
  const [editPl, setEditPl] = createSignal(0)
  const [foundPt, setFoundPt] = createSignal(false)
  const [foundPr, setFoundPr] = createSignal(false)
  const [foundPb, setFoundPb] = createSignal(false)
  const [foundPl, setFoundPl] = createSignal(false)

  const [editMt, setEditMt] = createSignal(0)
  const [editMr, setEditMr] = createSignal(0)
  const [editMb, setEditMb] = createSignal(0)
  const [editMl, setEditMl] = createSignal(0)
  const [foundMt, setFoundMt] = createSignal(false)
  const [foundMr, setFoundMr] = createSignal(false)
  const [foundMb, setFoundMb] = createSignal(false)
  const [foundMl, setFoundMl] = createSignal(false)

  const [editRadius, setEditRadius] = createSignal(0)
  const [foundRadius, setFoundRadius] = createSignal(false)
  const [editWidth, setEditWidth] = createSignal('')
  const [editWidthPx, setEditWidthPx] = createSignal(0)
  const [editHeightPx, setEditHeightPx] = createSignal(0)
  const [foundWidthPx, setFoundWidthPx] = createSignal(false)
  const [foundHeightPx, setFoundHeightPx] = createSignal(false)
  const [fillWidth, setFillWidth] = createSignal(false)
  const [fillHeight, setFillHeight] = createSignal(false)
  const [hugWidth, setHugWidth] = createSignal(false)
  const [hugHeight, setHugHeight] = createSignal(false)
  const [clipContent, setClipContent] = createSignal(false)
  const [editOpacity, setEditOpacity] = createSignal(100)
  const [foundOpacity, setFoundOpacity] = createSignal(false)
  const [cornerOpen, setCornerOpen] = createSignal(false)
  const [editRadiusTl, setEditRadiusTl] = createSignal(0)
  const [editRadiusTr, setEditRadiusTr] = createSignal(0)
  const [editRadiusBr, setEditRadiusBr] = createSignal(0)
  const [editRadiusBl, setEditRadiusBl] = createSignal(0)
  const [foundRadiusTl, setFoundRadiusTl] = createSignal(false)
  const [foundRadiusTr, setFoundRadiusTr] = createSignal(false)
  const [foundRadiusBr, setFoundRadiusBr] = createSignal(false)
  const [foundRadiusBl, setFoundRadiusBl] = createSignal(false)
  const [editFlexDir, setEditFlexDir] = createSignal('')
  const [editFlexGap, setEditFlexGap] = createSignal(0)
  const [foundFlexGap, setFoundFlexGap] = createSignal(false)
  const [editJustify, setEditJustify] = createSignal('')
  const [editAlignItems, setEditAlignItems] = createSignal('')
  const [paddingMode, setPaddingMode] = createSignal<'all' | 'hv' | 'trbl'>('all')
  const [paddingOpen, setPaddingOpen] = createSignal(false)
  const [marginMode, setMarginMode] = createSignal<'all' | 'hv' | 'trbl'>('all')
  const [marginOpen, setMarginOpen] = createSignal(false)
  const [editBgImage, setEditBgImage] = createSignal<File | null>(null)
  const [editBgUrl, setEditBgUrl] = createSignal('')

  const [editTag, setEditTag] = createSignal('')

  const [fills, setFills] = createStore<{ id: number; color: string; opacity: number; visible: boolean }[]>([])
  let fillIdCounter = 0

  const [strokes, setStrokes] = createStore<{
    id: number; color: string; visible: boolean; position: 'center' | 'inside' | 'outside'
    width: number; widthTop: number; widthRight: number; widthBottom: number; widthLeft: number
    foundWidth: boolean; foundWidthTop: boolean; foundWidthRight: boolean; foundWidthBottom: boolean; foundWidthLeft: boolean
    individualOpen: boolean
  }[]>([])
  let strokeIdCounter = 0

  const [effects, setEffects] = createStore<{
    id: number; type: 'drop-shadow' | 'layer-blur' | 'background-blur'; visible: boolean; expanded: boolean
    color: string; opacity: number; blur: number; offsetX: number; offsetY: number
    foundBlur: boolean; foundOffsetX: boolean; foundOffsetY: boolean
    layerBlur: number; foundLayerBlur: boolean; bgBlur: number; foundBgBlur: boolean
  }[]>([])
  let effectIdCounter = 0

  const [editProps, setEditProps] = createStore<Record<string, string>>({})
  const [rawProps, setRawProps] = createStore<Record<string, string>>({})
  const [propKeys, setPropKeys] = createSignal<string[]>([])

  let initialBgUrl = ''
  let parsedClasses: string[] = []

  const aligns = [
    { value: 'left', label: '左对齐' },
    { value: 'center', label: '居中' },
    { value: 'right', label: '右对齐' },
    { value: 'justify', label: '两端对齐' },
  ]

  const GRID_POSITIONS = [
    { label: '左上', justify: 'start', align: 'start' },
    { label: '中上', justify: 'center', align: 'start' },
    { label: '右上', justify: 'end', align: 'start' },
    { label: '中左', justify: 'start', align: 'center' },
    { label: '正中', justify: 'center', align: 'center' },
    { label: '中右', justify: 'end', align: 'center' },
    { label: '左下', justify: 'start', align: 'end' },
    { label: '中下', justify: 'center', align: 'end' },
    { label: '右下', justify: 'end', align: 'end' },
  ]

  function parseClass(cls: string) {
    const classes = cls.split(/\s+/).filter(Boolean)
    let fs = 14, fw = 400, ta = '', pt = 0, pr = 0, pb = 0, pl = 0
    let fFS = false, fFW = false
    let mt = 0, mr = 0, mb = 0, ml = 0, br = 0, w = '', wp = 0, hp = 0, op = 100
    let rtl = 0, rtr = 0, rbr = 0, rbl = 0
    let ff = '', lh = '', ls = 0, va = ''
    let fd = '', fg = 0, fj = '', fa = '', fFg = false
    let fPt = false, fPr = false, fPb = false, fPl = false
    let fMt = false, fMr = false, fMb = false, fMl = false, fBr = false
    let fWp = false, fHp = false, fOp = false
    let fRtl = false, fRtr = false, fRbr = false, fRbl = false
    let fwFill = false, fhFill = false, fwHug = false, fhHug = false, fClip = false
    for (const c of classes) {
      if (c.startsWith('text-[')) {
        const m = c.match(/text-\[(\d+)px\]/)
        if (m) { fs = Number(m[1]); fFS = true }
      } else {
        const m = c.match(/^text-(\S+)$/)
        if (m && TW_FONT_SIZES[m[1]] != null) { fs = TW_FONT_SIZES[m[1]]; fFS = true }
      }
      const fm = c.match(/^font-(\S+)$/)
      if (fm && TW_FONT_WEIGHTS[fm[1]] != null) { fw = TW_FONT_WEIGHTS[fm[1]]; fFW = true }
      const ffm = c.match(/^font-(.+)$/)
      if (ffm && !TW_FONT_WEIGHTS[ffm[1]]) ff = ffm[1]
      if (c === 'leading-none') lh = '1'
      else if (c.startsWith('leading-[')) {
        const lm = c.match(/leading-\[(.+)\]/); if (lm) lh = lm[1]
      } else {
        const lm = c.match(/^leading-(\d+)$/); if (lm) lh = String(Number(lm[1]) / 4)
      }
      if (c.startsWith('tracking-[')) {
        const tm = c.match(/tracking-\[([\d.]+)(?:em|px)?\]/); if (tm) ls = Math.round(Number(tm[1]) * 100)
      } else {
        const tm = c.match(/^tracking-(.+)$/); if (tm) ls = tm[1] as unknown as number
      }
      if (c === 'text-left') ta = 'left'
      else if (c === 'text-center') ta = 'center'
      else if (c === 'text-right') ta = 'right'
      else if (c === 'text-justify') ta = 'justify'
      if (_px(c, 'p') != null) { pt = pr = pb = pl = _px(c, 'p')!; fPt = fPr = fPb = fPl = true }
      if (_px(c, 'pt') != null) { pt = _px(c, 'pt')!; fPt = true }
      if (_px(c, 'pr') != null) { pr = _px(c, 'pr')!; fPr = true }
      if (_px(c, 'pb') != null) { pb = _px(c, 'pb')!; fPb = true }
      if (_px(c, 'pl') != null) { pl = _px(c, 'pl')!; fPl = true }
      if (_px(c, 'm') != null) { mt = mr = mb = ml = _px(c, 'm')!; fMt = fMr = fMb = fMl = true }
      if (_px(c, 'mt') != null) { mt = _px(c, 'mt')!; fMt = true }
      if (_px(c, 'mr') != null) { mr = _px(c, 'mr')!; fMr = true }
      if (_px(c, 'mb') != null) { mb = _px(c, 'mb')!; fMb = true }
      if (_px(c, 'ml') != null) { ml = _px(c, 'ml')!; fMl = true }
      if (c.startsWith('rounded-tl-[')) {
        const m = c.match(/rounded-tl-\[(\d+)px\]/); if (m) { rtl = Number(m[1]); fRtl = true }
      } else if (c.startsWith('rounded-tr-[')) {
        const m = c.match(/rounded-tr-\[(\d+)px\]/); if (m) { rtr = Number(m[1]); fRtr = true }
      } else if (c.startsWith('rounded-br-[')) {
        const m = c.match(/rounded-br-\[(\d+)px\]/); if (m) { rbr = Number(m[1]); fRbr = true }
      } else if (c.startsWith('rounded-bl-[')) {
        const m = c.match(/rounded-bl-\[(\d+)px\]/); if (m) { rbl = Number(m[1]); fRbl = true }
      } else if (c.match(/^rounded-tl-(\S+)/)) {
        const sz: Record<string, number> = { none: 0, sm: 2, md: 6, lg: 8, xl: 12, '2xl': 16, '3xl': 24, full: 999 }
        rtl = sz[(c.match(/^rounded-tl-(\S+)/) as RegExpMatchArray)[1]]; fRtl = true
      } else if (c.match(/^rounded-tr-(\S+)/)) {
        const sz: Record<string, number> = { none: 0, sm: 2, md: 6, lg: 8, xl: 12, '2xl': 16, '3xl': 24, full: 999 }
        rtr = sz[(c.match(/^rounded-tr-(\S+)/) as RegExpMatchArray)[1]]; fRtr = true
      } else if (c.match(/^rounded-br-(\S+)/)) {
        const sz: Record<string, number> = { none: 0, sm: 2, md: 6, lg: 8, xl: 12, '2xl': 16, '3xl': 24, full: 999 }
        rbr = sz[(c.match(/^rounded-br-(\S+)/) as RegExpMatchArray)[1]]; fRbr = true
      } else if (c.match(/^rounded-bl-(\S+)/)) {
        const sz: Record<string, number> = { none: 0, sm: 2, md: 6, lg: 8, xl: 12, '2xl': 16, '3xl': 24, full: 999 }
        rbl = sz[(c.match(/^rounded-bl-(\S+)/) as RegExpMatchArray)[1]]; fRbl = true
      } else if (c.startsWith('rounded-[')) {
        const m = c.match(/rounded-\[(\d+)px\]/)
        if (m) { br = Number(m[1]); fBr = true }
      } else if (c === 'rounded') { br = 4; fBr = true }
      else {
        const m = c.match(/^rounded-(\S+)/)
        if (m) {
          const sz: Record<string, number> = { none: 0, sm: 2, md: 6, lg: 8, xl: 12, '2xl': 16, '3xl': 24, full: 999 }
          br = sz[m[1]] ?? 0; fBr = true
        }
      }
      if (c.startsWith('w-[')) {
        const m = c.match(/w-\[(.+)\]/); if (m) w = m[1]
        const pm = c.match(/w-\[(\d+)px\]/); if (pm) { wp = Number(pm[1]); fWp = true }
      } else if (c === 'w-full') { w = '100%'; fwFill = true }
      else if (c === 'w-auto') { w = 'auto'; fwHug = true }
      if (c.startsWith('h-[')) {
        const pm = c.match(/h-\[(\d+)px\]/); if (pm) { hp = Number(pm[1]); fHp = true }
      } else if (c === 'h-full') fhFill = true
      else if (c === 'h-auto') fhHug = true
      if (c === 'overflow-hidden') fClip = true
      if (c.startsWith('opacity-[')) {
        const m = c.match(/opacity-\[([\d.]+)\]/); if (m) { op = Math.round(Number(m[1]) * 100); fOp = true }
      } else {
        const m = c.match(/^opacity-(\d+)$/); if (m) { op = Number(m[1]); fOp = true }
      }
      if (c === 'flex-col') fd = 'col'
      else if (c === 'flex-row') fd = 'row'
      else if (c === 'flex') { if (!fd) fd = 'row' }
      _pxGap(c, (v) => { fg = v; fFg = true })
      if (c.startsWith('justify-')) { const m = c.match(/^justify-(\S+)/); if (m) fj = m[1] }
      if (c.startsWith('items-')) { const m = c.match(/^items-(\S+)/); if (m) { fa = m[1]; va = m[1] } }
    }
    parsedClasses = classes
    return {
      fontSize: fs, fontWeight: fw, textAlign: ta, fontFamily: ff, lineHeight: lh, letterSpacing: ls, vAlign: va,
      foundFontSize: fFS, foundFontWeight: fFW,
      pt, pr, pb, pl, mt, mr, mb, ml, borderRadius: br, width: w, widthPx: wp, heightPx: hp, opacity: op,
      radiusTl: rtl, radiusTr: rtr, radiusBr: rbr, radiusBl: rbl,
      flexDir: fd, flexGap: fg, flexJustify: fj, flexAlignItems: fa,
      foundPt: fPt, foundPr: fPr, foundPb: fPb, foundPl: fPl,
      foundMt: fMt, foundMr: fMr, foundMb: fMb, foundMl: fMl,
      foundRadius: fBr, foundFlexGap: fFg, foundWidthPx: fWp, foundHeightPx: fHp, foundOpacity: fOp,
      fillWidth: fwFill, fillHeight: fhFill, hugWidth: fwHug, hugHeight: fhHug, clipContent: fClip,
      foundRadiusTl: fRtl, foundRadiusTr: fRtr, foundRadiusBr: fRbr, foundRadiusBl: fRbl,
    }
  }

  function buildClassName() {
    const parts = parsedClasses.filter(c =>
      !c.startsWith('text-[') &&
      !c.match(/^text-\S+$/) &&
      !c.match(/^font-\S+$/) &&
      !['text-left', 'text-center', 'text-right', 'text-justify'].includes(c) &&
      !c.startsWith('p-[') && !c.match(/^p(t|r|b|l)?-\d+$/) &&
      !c.startsWith('pt-[') && !c.startsWith('pr-[') && !c.startsWith('pb-[') && !c.startsWith('pl-[') &&
      !c.startsWith('m-[') && !c.match(/^m(t|r|b|l)?-\d+$/) &&
      !c.startsWith('mt-[') && !c.startsWith('mr-[') && !c.startsWith('mb-[') && !c.startsWith('ml-[') &&
      !c.startsWith('rounded-[') && !c.match(/^rounded(-\S+)?$/) &&
      !c.startsWith('rounded-tl-[') && !c.startsWith('rounded-tr-[') &&
      !c.startsWith('rounded-br-[') && !c.startsWith('rounded-bl-[') &&
      !c.startsWith('opacity-[') && !c.match(/^opacity-\d+$/) &&
      !c.startsWith('w-[') && !c.match(/^w-\S+$/) &&
      !c.startsWith('h-[') && !c.match(/^h-\S+$/) &&
      !['flex', 'flex-col', 'flex-row'].includes(c) &&
      !c.startsWith('gap-[') && !c.match(/^gap-\d+$/) &&
      !c.match(/^justify-\S+$/) && !c.match(/^items-\S+$/) && c !== 'overflow-hidden' && c !== 'border-solid' &&
      !c.startsWith('border-[') && !c.startsWith('border-t-[') && !c.startsWith('border-r-[') && !c.startsWith('border-b-[') && !c.startsWith('border-l-[') &&
      !c.match(/^border(-[trbl])?-\d+$/) &&
      !c.startsWith('bg-[') &&
      !c.startsWith('shadow-[') && !c.startsWith('blur-[') && !c.startsWith('backdrop-blur-[') &&
      !c.startsWith('leading-') && !c.startsWith('tracking-') && !c.startsWith('font-')
    )
    if (foundFontSize()) {
      const twFs = Object.entries(TW_FONT_SIZES).find(([, v]) => v === editFontSize())
      if (twFs) parts.push(`text-${twFs[0]}`)
      else parts.push(`text-[${editFontSize()}px]`)
    }
    if (foundFontWeight()) {
      const twFw = FW_TO_TW[editFontWeight()]
      if (twFw) parts.push(`font-${twFw}`)
    }
    if (editFontFamily()) parts.push(`font-${editFontFamily()}`)
    if (editLineHeight() && editLineHeight() !== 'auto') parts.push(`leading-[${editLineHeight()}]`)
    if (editLetterSpacing()) parts.push(`tracking-[${editLetterSpacing() / 100}em]`)
    if (editAlign()) parts.push(`text-${editAlign()}`)
    if (editVAlign()) parts.push(`items-${editVAlign()}`)

    const pv = [0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64]
      ; (function () {
        const vals = [editPt(), editPr(), editPb(), editPl()]
        const same = new Set(vals).size === 1
        if (same) {
          const v = editPt(); if (!v) return
          parts.push(pv.includes(v) ? `p-${v / 4}` : `p-[${v}px]`)
        } else {
          for (const [r, p] of [[editPt, 'pt'], [editPr, 'pr'], [editPb, 'pb'], [editPl, 'pl']] as const) {
            const v = r(); if (!v) continue
            parts.push(pv.includes(v) ? `${p}-${v / 4}` : `${p}-[${v}px]`)
          }
        }
      })()
      ; (function () {
        const vals = [editMt(), editMr(), editMb(), editMl()]
        const same = new Set(vals).size === 1
        if (same) {
          const v = editMt(); if (!v) return
          parts.push(pv.includes(v) ? `m-${v / 4}` : `m-[${v}px]`)
        } else {
          for (const [r, p] of [[editMt, 'mt'], [editMr, 'mr'], [editMb, 'mb'], [editMl, 'ml']] as const) {
            const v = r(); if (!v) continue
            parts.push(pv.includes(v) ? `${p}-${v / 4}` : `${p}-[${v}px]`)
          }
        }
      })()
    if (foundRadiusTl() || foundRadiusTr() || foundRadiusBr() || foundRadiusBl()) {
      if (foundRadiusTl() && editRadiusTl()) parts.push(`rounded-tl-[${editRadiusTl()}px]`)
      if (foundRadiusTr() && editRadiusTr()) parts.push(`rounded-tr-[${editRadiusTr()}px]`)
      if (foundRadiusBr() && editRadiusBr()) parts.push(`rounded-br-[${editRadiusBr()}px]`)
      if (foundRadiusBl() && editRadiusBl()) parts.push(`rounded-bl-[${editRadiusBl()}px]`)
    } else if (foundRadius()) {
      if (editRadius() === 999) parts.push('rounded-full')
      else if (editRadius() === 0) parts.push('rounded-none')
      else {
        const rMap: Record<number, string> = { 2: 'sm', 4: '', 6: 'md', 8: 'lg', 12: 'xl', 16: '2xl', 24: '3xl' }
        if (rMap[editRadius()] !== undefined) parts.push(`rounded${rMap[editRadius()] ? '-' + rMap[editRadius()] : ''}`)
        else parts.push(`rounded-[${editRadius()}px]`)
      }
    }
    if (fillWidth()) parts.push('w-full')
    else if (hugWidth()) parts.push('w-auto')
    else if (foundWidthPx() && editWidthPx()) parts.push(`w-[${editWidthPx()}px]`)
    else if (editWidth()) {
      if (editWidth() === '100%') parts.push('w-full')
      else if (editWidth() === 'auto') parts.push('w-auto')
      else parts.push(`w-[${editWidth()}]`)
    }
    if (fillHeight()) parts.push('h-full')
    else if (hugHeight()) parts.push('h-auto')
    else if (foundHeightPx() && editHeightPx()) parts.push(`h-[${editHeightPx()}px]`)
    if (clipContent()) parts.push('overflow-hidden')
    for (const f of fills) {
      if (!f.visible) continue
      const alpha = f.opacity / 100
      parts.push(alpha < 1 ? `bg-[${f.color}/${f.opacity}]` : `bg-[${f.color}]`)
    }
    for (const s of strokes) {
      if (!s.visible) continue
      if (s.individualOpen) {
        if (s.foundWidthTop && s.widthTop) parts.push(`border-t-[${s.widthTop}px]`)
        if (s.foundWidthRight && s.widthRight) parts.push(`border-r-[${s.widthRight}px]`)
        if (s.foundWidthBottom && s.widthBottom) parts.push(`border-b-[${s.widthBottom}px]`)
        if (s.foundWidthLeft && s.widthLeft) parts.push(`border-l-[${s.widthLeft}px]`)
      } else if (s.foundWidth && s.width) {
        parts.push(`border-[${s.width}px]`)
      }
      parts.push(`border-[${s.color}]`)
      parts.push('border-solid')
    }
    for (const e of effects) {
      if (!e.visible) continue
      if (e.type === 'drop-shadow') {
        const r = Math.round(e.opacity * 2.55)
        const a = r.toString(16).padStart(2, '0')
        const c = e.color + a
        const b = e.foundBlur && e.blur ? `${e.blur}px` : '0'
        const x = e.foundOffsetX && e.offsetX ? `${e.offsetX}px` : '0'
        const y = e.foundOffsetY && e.offsetY ? `${e.offsetY}px` : '0'
        parts.push(`shadow-[${x}_${y}_${b}_${c}]`)
      } else if (e.type === 'layer-blur') {
        if (e.foundLayerBlur && e.layerBlur) parts.push(`blur-[${e.layerBlur}px]`)
      } else if (e.type === 'background-blur') {
        if (e.foundBgBlur && e.bgBlur) parts.push(`backdrop-blur-[${e.bgBlur}px]`)
      }
    }
    if (foundOpacity() && editOpacity() !== 100) parts.push(`opacity-[${editOpacity() / 100}]`)
    if (editFlexDir() === 'col') parts.push('flex', 'flex-col')
    else if (editFlexDir() === 'row') parts.push('flex', 'flex-row')
    const j = editJustify()
    if (editFlexGap() && j !== 'between' && j !== 'around') {
      const gv = editFlexGap()
      parts.push(pv.includes(gv) ? `gap-${gv / 4}` : `gap-[${gv}px]`)
    }
    if (j) parts.push(`justify-${j}`)
    if (editAlignItems()) parts.push(`items-${editAlignItems()}`)
    return parts.join(' ')
  }

  function getEnumOptions(key: string) {
    return COMPONENT_ENUMS[`${props.componentType}.${key}`] || []
  }

  function isBinding(key: string) {
    return `__bind_${key}` in rawProps
  }

  function calcInitPos() {
    const cp = props.clickPoint
    if (!cp) return { right: 20, top: 115 }
    const ph = popupH() || 400
    let r = cp.x, t = cp.y + 4
    if (t + ph > props.containerSize.height - 5) t = Math.max(5, cp.y - ph - 4)
    return { right: Math.max(0, r), top: Math.max(5, t) }
  }

  function applyCssVariables(vars: Record<string, string>, rawCls: string, parsed: Record<string, unknown>) {
    const px = (v: string) => {
      if (typeof v !== 'string') return Number(v) || 0
      if (v.endsWith('rem')) return parseFloat(v) * 16
      return parseFloat(v) || 0
    }

    const v = vars

    if (v.fontSize) { setEditFontSize(px(v.fontSize)); setFoundFontSize(true) }
    if (v.fontWeight) { setEditFontWeight(px(v.fontWeight)); setFoundFontWeight(true) }
    if (v.fontFamily) setEditFontFamily(v.fontFamily)
    if (v.textAlign) setEditAlign(v.textAlign)
    if (v.lineHeight) setEditLineHeight(v.lineHeight)
    if (v.letterSpacing) {
      const ls = String(v.letterSpacing)
      const n = parseFloat(ls)
      if (!isNaN(n)) setEditLetterSpacing(ls.endsWith('em') ? Math.round(n * 100) : n)
    }

    if (v.padding) {
      const parts = String(v.padding).split(/\s+/)
      if (parts.length === 1) {
        const val = px(parts[0])
        setEditPt(val); setEditPr(val); setEditPb(val); setEditPl(val)
        setFoundPt(true); setFoundPr(true); setFoundPb(true); setFoundPl(true)
        setPaddingMode('all')
      } else if (parts.length === 2) {
        setEditPt(px(parts[0])); setEditPb(px(parts[0]))
        setEditPr(px(parts[1])); setEditPl(px(parts[1]))
        setFoundPt(true); setFoundPb(true); setFoundPr(true); setFoundPl(true)
        setPaddingMode('hv')
      } else if (parts.length === 4) {
        setEditPt(px(parts[0])); setEditPr(px(parts[1])); setEditPb(px(parts[2])); setEditPl(px(parts[3]))
        setFoundPt(true); setFoundPr(true); setFoundPb(true); setFoundPl(true)
        setPaddingMode('trbl')
      }
    } else {
      if (v.paddingTop) { setEditPt(px(v.paddingTop)); setFoundPt(true) }
      if (v.paddingRight) { setEditPr(px(v.paddingRight)); setFoundPr(true) }
      if (v.paddingBottom) { setEditPb(px(v.paddingBottom)); setFoundPb(true) }
      if (v.paddingLeft) { setEditPl(px(v.paddingLeft)); setFoundPl(true) }
      if (v.paddingTop || v.paddingRight || v.paddingBottom || v.paddingLeft) {
        setPaddingMode('trbl')
      }
    }

    if (v.margin) {
      const parts = String(v.margin).split(/\s+/)
      if (parts.length === 1) {
        const val = px(parts[0])
        setEditMt(val); setEditMr(val); setEditMb(val); setEditMl(val)
        setFoundMt(true); setFoundMr(true); setFoundMb(true); setFoundMl(true)
        setMarginMode('all')
      } else if (parts.length === 4) {
        setEditMt(px(parts[0])); setEditMr(px(parts[1])); setEditMb(px(parts[2])); setEditMl(px(parts[3]))
        setFoundMt(true); setFoundMr(true); setFoundMb(true); setFoundMl(true)
        setMarginMode('trbl')
      }
    } else {
      if (v.marginTop) { setEditMt(px(v.marginTop)); setFoundMt(true) }
      if (v.marginRight) { setEditMr(px(v.marginRight)); setFoundMr(true) }
      if (v.marginBottom) { setEditMb(px(v.marginBottom)); setFoundMb(true) }
      if (v.marginLeft) { setEditMl(px(v.marginLeft)); setFoundMl(true) }
      if (v.marginTop || v.marginRight || v.marginBottom || v.marginLeft) {
        setMarginMode('trbl')
      }
    }

    if (v.borderRadius) { setEditRadius(px(v.borderRadius)); setFoundRadius(true) }
    if (v.borderTopLeftRadius) { setEditRadiusTl(px(v.borderTopLeftRadius)); setFoundRadiusTl(true) }
    if (v.borderTopRightRadius) { setEditRadiusTr(px(v.borderTopRightRadius)); setFoundRadiusTr(true) }
    if (v.borderBottomRightRadius) { setEditRadiusBr(px(v.borderBottomRightRadius)); setFoundRadiusBr(true) }
    if (v.borderBottomLeftRadius) { setEditRadiusBl(px(v.borderBottomLeftRadius)); setFoundRadiusBl(true) }

    if (v.width) {
      const w = v.width
      if (w === '100%') { setFillWidth(true); setEditWidthPx(0); setFoundWidthPx(false) }
      else if (w === 'auto' || w === 'fit-content' || w === 'max-content') { setHugWidth(true); setEditWidthPx(0); setFoundWidthPx(false) }
      else { setEditWidthPx(px(w)); setFoundWidthPx(true); setEditWidth(w) }
    }
    if (v.height) {
      const h = v.height
      if (h === '100%') setFillHeight(true)
      else if (h === 'auto' || h === 'fit-content') setHugHeight(true)
      else { setEditHeightPx(px(h)); setFoundHeightPx(true) }
    }
    if (v.overflow === 'hidden') setClipContent(true)

    if (v.opacity) { setEditOpacity(Math.round(parseFloat(v.opacity) * 100)); setFoundOpacity(true) }

    if (v.display === 'flex') {
      if (v.flexDirection === 'column' || v.flexDirection === 'col') setEditFlexDir('col')
      else setEditFlexDir('row')
    }
    if (v.gap) { setEditFlexGap(px(v.gap)); setFoundFlexGap(true) }
    if (v.justifyContent) {
      const j = v.justifyContent as string
      const m: Record<string, string> = { 'flex-start': 'start', 'flex-end': 'end', 'space-between': 'between', 'space-around': 'around' }
      setEditJustify(m[j] ?? j)
    } else if (v.display === 'flex') {
      setEditJustify('start')
    }
    if (v.alignItems) {
      const a = v.alignItems as string
      const m: Record<string, string> = { 'flex-start': 'start', 'flex-end': 'end' }
      setEditAlignItems(m[a] ?? a)
      setEditVAlign(m[a] ?? a)
    } else if (v.display === 'flex') {
      setEditAlignItems('start')
      setEditVAlign('start')
    }

    if (v.color) {
      const c = String(v.color)
      if (c.startsWith('#') || c.startsWith('rgb')) setEditTextColor(c)
    }
    if (v.backgroundColor) {
      const c = String(v.backgroundColor)
      if (c.startsWith('#') || c.startsWith('rgb')) setEditBgColor(c)
    }
    if (v.backgroundImage) {
      const m = String(v.backgroundImage).match(/url\(['"]?([^'"()]+)['"]?\)/)
      if (m) setEditBgUrl(m[1])
    }

    setFills([])
    setStrokes([])
    setEffects([])

    if (v.backgroundColor && v.backgroundColor !== 'transparent') {
      setFills([{ id: ++fillIdCounter, color: v.backgroundColor, opacity: 100, visible: true }])
    } else {
      for (const m of rawCls.matchAll(/\bbg-\[(#(?:[a-fA-F0-9]{3}|[a-fA-F0-9]{6}|[a-fA-F0-9]{8}))(?:\/(\d+))?\]/g)) {
        setFills([...fills, { id: ++fillIdCounter, color: m[1], opacity: m[2] ? Number(m[2]) : 100, visible: true }])
      }
    }

    if (v.borderColor) {
      const sw = v.borderWidth ? px(v.borderWidth) : 0
      const hasTop = !!v.borderTopWidth; const hasRight = !!v.borderRightWidth
      const hasBottom = !!v.borderBottomWidth; const hasLeft = !!v.borderLeftWidth
      const hasIndiv = hasTop || hasRight || hasBottom || hasLeft
      const s: typeof strokes[number] = {
        id: ++strokeIdCounter, color: v.borderColor, visible: true, position: 'center',
        width: sw, widthTop: 0, widthRight: 0, widthBottom: 0, widthLeft: 0,
        foundWidth: !!v.borderWidth, foundWidthTop: false, foundWidthRight: false, foundWidthBottom: false, foundWidthLeft: false,
        individualOpen: hasIndiv,
      }
      if (hasTop) { s.widthTop = px(v.borderTopWidth); s.foundWidthTop = true }
      if (hasRight) { s.widthRight = px(v.borderRightWidth); s.foundWidthRight = true }
      if (hasBottom) { s.widthBottom = px(v.borderBottomWidth); s.foundWidthBottom = true }
      if (hasLeft) { s.widthLeft = px(v.borderLeftWidth); s.foundWidthLeft = true }
      setStrokes([s])
    } else {
      const strokeColors = [...rawCls.matchAll(/\bborder-\[(#(?:[a-fA-F0-9]{3}|[a-fA-F0-9]{6}|[a-fA-F0-9]{8}))\]/g)]
      for (const sm of strokeColors) {
        const swMatch = rawCls.match(/border-\[(\d+)px\]/)
        const hasIndiv = rawCls.includes('border-t-[') || rawCls.includes('border-r-[') || rawCls.includes('border-b-[') || rawCls.includes('border-l-[')
        const s: typeof strokes[number] = {
          id: ++strokeIdCounter, color: sm[1], visible: true, position: 'center',
          width: swMatch ? Number(swMatch[1]) : 1,
          widthTop: 0, widthRight: 0, widthBottom: 0, widthLeft: 0,
          foundWidth: !!swMatch, foundWidthTop: false, foundWidthRight: false, foundWidthBottom: false, foundWidthLeft: false,
          individualOpen: hasIndiv,
        }
        if (hasIndiv) {
          const tm = rawCls.match(/border-t-\[(\d+)px\]/); if (tm) { s.widthTop = Number(tm[1]); s.foundWidthTop = true }
          const rm = rawCls.match(/border-r-\[(\d+)px\]/); if (rm) { s.widthRight = Number(rm[1]); s.foundWidthRight = true }
          const bm = rawCls.match(/border-b-\[(\d+)px\]/); if (bm) { s.widthBottom = Number(bm[1]); s.foundWidthBottom = true }
          const lm = rawCls.match(/border-l-\[(\d+)px\]/); if (lm) { s.widthLeft = Number(lm[1]); s.foundWidthLeft = true }
        }
        setStrokes([...strokes, s])
      }
    }

    if (v.boxShadow && v.boxShadow !== 'none') {
      const sm = String(v.boxShadow).match(/([-\d.]+)px\s+([-\d.]+)px\s+(\d+)px\s+(?:[-\d.]+px\s+)?(?:(#[\da-fA-F]{6}(?:[\da-fA-F]{2})?)|(rgba?\([^)]+\)))/)
      const color = sm ? (sm[4] || sm[5]) : '#000000'
      const rgbaMatch = color?.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/)
      const opacity = rgbaMatch ? Math.round(Number(rgbaMatch[4] ?? 1) * 100) : 100
      const hexColor = rgbaMatch ? `#${Number(rgbaMatch[1]).toString(16).padStart(2, '0')}${Number(rgbaMatch[2]).toString(16).padStart(2, '0')}${Number(rgbaMatch[3]).toString(16).padStart(2, '0')}` : color
      setEffects([...effects, {
        id: ++effectIdCounter, type: 'drop-shadow', visible: true, expanded: false,
        color: hexColor, opacity, blur: sm ? Number(sm[3]) : 0, offsetX: sm ? Number(sm[1]) : 0, offsetY: sm ? Number(sm[2]) : 0,
        foundBlur: !!sm, foundOffsetX: !!sm, foundOffsetY: !!sm,
        layerBlur: 0, foundLayerBlur: false, bgBlur: 0, foundBgBlur: false,
      }])
    } else {
      for (const sm of rawCls.matchAll(/shadow-\[(-?\d+)px_(-?\d+)px_(\d+)px_((?:#[a-fA-F0-9]{6})[a-fA-F0-9]{2})\]/g)) {
        const color = sm[4].slice(0, 7)
        const alpha = parseInt(sm[4].slice(7), 16)
        setEffects([...effects, {
          id: ++effectIdCounter, type: 'drop-shadow', visible: true, expanded: false,
          color, opacity: Math.round(alpha / 2.55), blur: Number(sm[3]), offsetX: Number(sm[1]), offsetY: Number(sm[2]),
          foundBlur: true, foundOffsetX: true, foundOffsetY: true,
          layerBlur: 0, foundLayerBlur: false, bgBlur: 0, foundBgBlur: false,
        }])
      }
    }
    if (v.filter) {
      const bm = String(v.filter).match(/blur\((\d+)px\)/)
      if (bm) {
        setEffects([...effects, {
          id: ++effectIdCounter, type: 'layer-blur', visible: true, expanded: false,
          color: '#000000', opacity: 100, blur: 0, offsetX: 0, offsetY: 0,
          foundBlur: false, foundOffsetX: false, foundOffsetY: false,
          layerBlur: Number(bm[1]), foundLayerBlur: true, bgBlur: 0, foundBgBlur: false,
        }])
      }
    } else {
      for (const bm of rawCls.matchAll(/blur-\[(\d+)px\]/g)) {
        setEffects([...effects, {
          id: ++effectIdCounter, type: 'layer-blur', visible: true, expanded: false,
          color: '#000000', opacity: 100, blur: 0, offsetX: 0, offsetY: 0,
          foundBlur: false, foundOffsetX: false, foundOffsetY: false,
          layerBlur: Number(bm[1]), foundLayerBlur: true, bgBlur: 0, foundBgBlur: false,
        }])
      }
    }
    if (v.backdropFilter) {
      const bm = String(v.backdropFilter).match(/blur\((\d+)px\)/)
      if (bm) {
        setEffects([...effects, {
          id: ++effectIdCounter, type: 'background-blur', visible: true, expanded: false,
          color: '#000000', opacity: 100, blur: 0, offsetX: 0, offsetY: 0,
          foundBlur: false, foundOffsetX: false, foundOffsetY: false,
          layerBlur: 0, foundLayerBlur: false, bgBlur: Number(bm[1]), foundBgBlur: true,
        }])
      }
    } else {
      for (const bm of rawCls.matchAll(/backdrop-blur-\[(\d+)px\]/g)) {
        setEffects([...effects, {
          id: ++effectIdCounter, type: 'background-blur', visible: true, expanded: false,
          color: '#000000', opacity: 100, blur: 0, offsetX: 0, offsetY: 0,
          foundBlur: false, foundOffsetX: false, foundOffsetY: false,
          layerBlur: 0, foundLayerBlur: false, bgBlur: Number(bm[1]), foundBgBlur: true,
        }])
      }
    }

    setEditText((parsed.value ?? '').toString())
    const bgUrl = v.backgroundImage ? '' : (parsed.backgroundImage || '').toString()
    if (bgUrl) {
      setEditBgUrl(bgUrl === 'none' ? '' : bgUrl)
      initialBgUrl = editBgUrl()
    } else if (v.backgroundImage) {
      initialBgUrl = editBgUrl()
    }

    setRawProps(reconcile(parsed as Record<string, string>))

    const defKeys = COMPONENT_PROPS[props.componentType] || []
    const allKeys = [...new Set([...defKeys, ...Object.keys(parsed)])].filter(k => !k.startsWith('__bind_'))
    setPropKeys(allKeys)
    for (const k of allKeys) {
      const raw = (parsed[k] ?? '').toString()
      const opts = getEnumOptions(k)
      const def = ENUM_DEFAULTS[`${props.componentType}.${k}`] ?? (opts.includes('default') ? 'default' : '')
      setEditProps(k, raw || def)
    }
  }

  function applyParseClassFallback(rawCls: string, parsed: Record<string, unknown>) {
    const clsInfo = parseClass(rawCls)

    setEditText((parsed.value ?? '').toString())
    setEditFontSize(clsInfo.fontSize); setFoundFontSize(clsInfo.foundFontSize)
    setEditFontWeight(clsInfo.fontWeight); setFoundFontWeight(clsInfo.foundFontWeight)
    setEditAlign(clsInfo.textAlign)
    setEditFontFamily(clsInfo.fontFamily)
    setEditLineHeight(clsInfo.lineHeight)
    setEditLetterSpacing(clsInfo.letterSpacing)
    setEditVAlign(clsInfo.vAlign)

    const tcMatch = rawCls.match(/\btext-\[#([a-fA-F0-9]{3,8})\]/)
    setEditTextColor(tcMatch ? '#' + tcMatch[1] : '')
    const bgcMatch = rawCls.match(/\bbg-\[#([a-fA-F0-9]{3,8})\]/)
    setEditBgColor(bgcMatch ? '#' + bgcMatch[1] : (parsed.backgroundColor || parsed.background || '').toString())

    const bgUrlMatch = rawCls.match(/\bbg-\[url\(\/uploads\/([^)]+)\)\]/)
    const bgUrl = bgUrlMatch ? '/uploads/' + bgUrlMatch[1] : (parsed.backgroundImage || '').toString()
    setEditBgUrl(bgUrl === 'none' ? '' : bgUrl)
    initialBgUrl = editBgUrl()

    setEditPt(clsInfo.pt); setFoundPt(clsInfo.foundPt)
    setEditPr(clsInfo.pr); setFoundPr(clsInfo.foundPr)
    setEditPb(clsInfo.pb); setFoundPb(clsInfo.foundPb)
    setEditPl(clsInfo.pl); setFoundPl(clsInfo.foundPl)
    setEditMt(clsInfo.mt); setFoundMt(clsInfo.foundMt)
    setEditMr(clsInfo.mr); setFoundMr(clsInfo.foundMr)
    setEditMb(clsInfo.mb); setFoundMb(clsInfo.foundMb)
    setEditMl(clsInfo.ml); setFoundMl(clsInfo.foundMl)
    setEditRadius(clsInfo.borderRadius); setFoundRadius(clsInfo.foundRadius)
    setEditWidth(clsInfo.width)
    setEditWidthPx(clsInfo.widthPx); setFoundWidthPx(clsInfo.foundWidthPx)
    setEditHeightPx(clsInfo.heightPx); setFoundHeightPx(clsInfo.foundHeightPx)
    setFillWidth(clsInfo.fillWidth)
    setFillHeight(clsInfo.fillHeight)
    setHugWidth(clsInfo.hugWidth)
    setHugHeight(clsInfo.hugHeight)
    setClipContent(clsInfo.clipContent)
    setEditOpacity(clsInfo.opacity); setFoundOpacity(clsInfo.foundOpacity)
    setEditRadiusTl(clsInfo.radiusTl); setFoundRadiusTl(clsInfo.foundRadiusTl)
    setEditRadiusTr(clsInfo.radiusTr); setFoundRadiusTr(clsInfo.foundRadiusTr)
    setEditRadiusBr(clsInfo.radiusBr); setFoundRadiusBr(clsInfo.foundRadiusBr)
    setEditRadiusBl(clsInfo.radiusBl); setFoundRadiusBl(clsInfo.foundRadiusBl)
    setEditFlexDir(clsInfo.flexDir)
    setEditFlexGap(clsInfo.flexGap); setFoundFlexGap(clsInfo.foundFlexGap)
    setEditJustify(clsInfo.flexJustify)
    setEditAlignItems(clsInfo.flexAlignItems)
    setEditBgImage(null)
    setEditTag('')

    setFills([])
    setStrokes([])
    setEffects([])
    for (const m of rawCls.matchAll(/\bbg-\[(#(?:[a-fA-F0-9]{3}|[a-fA-F0-9]{6}|[a-fA-F0-9]{8}))(?:\/(\d+))?\]/g)) {
      setFills([...fills, { id: ++fillIdCounter, color: m[1], opacity: m[2] ? Number(m[2]) : 100, visible: true }])
    }

    const strokeColors = [...rawCls.matchAll(/\bborder-\[(#(?:[a-fA-F0-9]{3}|[a-fA-F0-9]{6}|[a-fA-F0-9]{8}))\]/g)]
    for (const sm of strokeColors) {
      const swMatch = rawCls.match(/border-\[(\d+)px\]/)
      const hasIndiv = rawCls.includes('border-t-[') || rawCls.includes('border-r-[') || rawCls.includes('border-b-[') || rawCls.includes('border-l-[')
      const s: typeof strokes[number] = {
        id: ++strokeIdCounter, color: sm[1], visible: true, position: 'center',
        width: swMatch ? Number(swMatch[1]) : 1,
        widthTop: 0, widthRight: 0, widthBottom: 0, widthLeft: 0,
        foundWidth: !!swMatch, foundWidthTop: false, foundWidthRight: false, foundWidthBottom: false, foundWidthLeft: false,
        individualOpen: hasIndiv,
      }
      if (hasIndiv) {
        const tm = rawCls.match(/border-t-\[(\d+)px\]/); if (tm) { s.widthTop = Number(tm[1]); s.foundWidthTop = true }
        const rm = rawCls.match(/border-r-\[(\d+)px\]/); if (rm) { s.widthRight = Number(rm[1]); s.foundWidthRight = true }
        const bm = rawCls.match(/border-b-\[(\d+)px\]/); if (bm) { s.widthBottom = Number(bm[1]); s.foundWidthBottom = true }
        const lm = rawCls.match(/border-l-\[(\d+)px\]/); if (lm) { s.widthLeft = Number(lm[1]); s.foundWidthLeft = true }
      }
      setStrokes([...strokes, s])
    }

    for (const sm of rawCls.matchAll(/shadow-\[(-?\d+)px_(-?\d+)px_(\d+)px_((?:#[a-fA-F0-9]{6})[a-fA-F0-9]{2})\]/g)) {
      const color = sm[4].slice(0, 7)
      const alpha = parseInt(sm[4].slice(7), 16)
      setEffects([...effects, {
        id: ++effectIdCounter, type: 'drop-shadow', visible: true, expanded: false,
        color, opacity: Math.round(alpha / 2.55), blur: Number(sm[3]), offsetX: Number(sm[1]), offsetY: Number(sm[2]),
        foundBlur: true, foundOffsetX: true, foundOffsetY: true,
        layerBlur: 0, foundLayerBlur: false, bgBlur: 0, foundBgBlur: false,
      }])
    }
    for (const bm of rawCls.matchAll(/blur-\[(\d+)px\]/g)) {
      setEffects([...effects, {
        id: ++effectIdCounter, type: 'layer-blur', visible: true, expanded: false,
        color: '#000000', opacity: 100, blur: 0, offsetX: 0, offsetY: 0,
        foundBlur: false, foundOffsetX: false, foundOffsetY: false,
        layerBlur: Number(bm[1]), foundLayerBlur: true, bgBlur: 0, foundBgBlur: false,
      }])
    }
    for (const bm of rawCls.matchAll(/backdrop-blur-\[(\d+)px\]/g)) {
      setEffects([...effects, {
        id: ++effectIdCounter, type: 'background-blur', visible: true, expanded: false,
        color: '#000000', opacity: 100, blur: 0, offsetX: 0, offsetY: 0,
        foundBlur: false, foundOffsetX: false, foundOffsetY: false,
        layerBlur: 0, foundLayerBlur: false, bgBlur: Number(bm[1]), foundBgBlur: true,
      }])
    }

    setRawProps(reconcile(parsed as Record<string, string>))

    const defKeys = COMPONENT_PROPS[props.componentType] || []
    const allKeys = [...new Set([...defKeys, ...Object.keys(parsed)])].filter(k => !k.startsWith('__bind_'))
    setPropKeys(allKeys)
    for (const k of allKeys) {
      const raw = (parsed[k] ?? '').toString()
      const opts = getEnumOptions(k)
      const def = ENUM_DEFAULTS[`${props.componentType}.${k}`] ?? (opts.includes('default') ? 'default' : '')
      setEditProps(k, raw || def)
    }
  }

  let ready = false
  let autoUpdateTimer: ReturnType<typeof setTimeout> | undefined

  function resetEditorSignals() {
    setEditFontSize(14); setFoundFontSize(false)
    setEditFontWeight(400); setFoundFontWeight(false)
    setEditAlign(''); setEditFontFamily(''); setEditLineHeight(''); setEditLetterSpacing(0)
    setEditVAlign(''); setEditTextColor(''); setEditBgColor('')
    setEditPt(0); setFoundPt(false); setEditPr(0); setFoundPr(false)
    setEditPb(0); setFoundPb(false); setEditPl(0); setFoundPl(false)
    setEditMt(0); setFoundMt(false); setEditMr(0); setFoundMr(false)
    setEditMb(0); setFoundMb(false); setEditMl(0); setFoundMl(false)
    setEditRadius(0); setFoundRadius(false)
    setEditRadiusTl(0); setFoundRadiusTl(false); setEditRadiusTr(0); setFoundRadiusTr(false)
    setEditRadiusBr(0); setFoundRadiusBr(false); setEditRadiusBl(0); setFoundRadiusBl(false)
    setEditWidth(''); setEditWidthPx(0); setFoundWidthPx(false)
    setEditHeightPx(0); setFoundHeightPx(false)
    setFillWidth(false); setFillHeight(false); setHugWidth(false); setHugHeight(false)
    setClipContent(false)
    setEditOpacity(100); setFoundOpacity(false)
    setEditFlexDir(''); setEditFlexGap(0); setFoundFlexGap(false)
    setEditJustify(''); setEditAlignItems('')
    setFills([])
    setStrokes([])
    setEffects([])
  }

  createEffect(() => {
    if (!props.show) {
      ready = false
      clearTimeout(autoUpdateTimer)
      return
    }
    const rawCls = props.currentClass || ''
    parsedClasses = rawCls.split(/\s+/).filter(Boolean)
    let parsed: Record<string, unknown> = {}
    try { parsed = JSON.parse(props.elementProps || '{}') } catch { /* ignore */ }

    console.log("[PropertyEditor] open, original className:", rawCls)
    logStartSession(`quick-modify-${props.elementId}`, `修改元素 ${props.elementId} [${props.componentType}]\n原始 className: ${rawCls}\n原始 props: ${props.elementProps || '{}'}`)

    resetEditorSignals()
    setInitialPos('right', 20)
    setInitialPos('top', 115)
    setDragOffset({ x: 0, y: 0 })
    setEditBgImage(null)
    setEditTag('')

    const desktopApi = (window as unknown as { api?: { tailwindToCss?: (className: string) => Promise<Record<string, string>> } }).api
    const api = desktopApi?.tailwindToCss
    if (api) {
      api(rawCls).then(cssVars => {
        console.log("[PropertyEditor] tailwind css vars:", cssVars)
        logAgentCall('tailwindToCss', props.elementId, rawCls, cssVars)
        if (cssVars && Object.keys(cssVars).length > 0) {
          applyCssVariables(cssVars, rawCls, parsed)
        } else {
          console.log("[PropertyEditor] fallback: api returned empty, using parseClass")
          applyParseClassFallback(rawCls, parsed)
        }
        setDragOffset({ x: 0, y: 0 })
        ready = true
      })
    } else {
      console.log("[PropertyEditor] fallback: no tailwindToCss api, using parseClass")
      applyParseClassFallback(rawCls, parsed)
      setDragOffset({ x: 0, y: 0 })
      ready = true
    }
  })

  createEffect(() => {
    if (props.show) {
      requestAnimationFrame(() => {
        updateDims()
        setInitialPos(calcInitPos())
      })
    }
  })

  function onWindowClick(e: MouseEvent) {
    if ((e.target as HTMLElement).closest('.padding-dropdown-area')) return
    if ((e.target as HTMLElement).closest('.margin-dropdown-area')) return
    setPaddingOpen(false)
    setMarginOpen(false)
  }

  createEffect(() => {
    if (paddingOpen() || marginOpen()) {
      window.addEventListener('click', onWindowClick)
    } else {
      window.removeEventListener('click', onWindowClick)
    }
  })
  onCleanup(() => window.removeEventListener('click', onWindowClick))
  onCleanup(() => clearTimeout(autoUpdateTimer))

  createEffect(() => {
    const file = editBgImage()
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setEditBgUrl(reader.result as string)
    reader.readAsDataURL(file)
  })

  onCleanup(() => clearTimeout(autoUpdateTimer))

  const autoSnapshot = createMemo(() => {
    if (!props.show) return null
    return {
      text: editText(),
      fontSize: editFontSize(), foundFontSize: foundFontSize(),
      fontWeight: editFontWeight(), foundFontWeight: foundFontWeight(),
      textAlign: editAlign(),
      fontFamily: editFontFamily(),
      lineHeight: editLineHeight(),
      letterSpacing: editLetterSpacing(),
      vAlign: editVAlign(),
      textColor: editTextColor(),
      bgColor: editBgColor(),
      pt: editPt(), foundPt: foundPt(),
      pr: editPr(), foundPr: foundPr(),
      pb: editPb(), foundPb: foundPb(),
      pl: editPl(), foundPl: foundPl(),
      mt: editMt(), foundMt: foundMt(),
      mr: editMr(), foundMr: foundMr(),
      mb: editMb(), foundMb: foundMb(),
      ml: editMl(), foundMl: foundMl(),
      radius: editRadius(), foundRadius: foundRadius(),
      width: editWidth(),
      widthPx: editWidthPx(), foundWidthPx: foundWidthPx(),
      heightPx: editHeightPx(), foundHeightPx: foundHeightPx(),
      fillWidth: fillWidth(), fillHeight: fillHeight(),
      hugWidth: hugWidth(), hugHeight: hugHeight(),
      clipContent: clipContent(),
      opacity: editOpacity(), foundOpacity: foundOpacity(),
      radiusTl: editRadiusTl(), foundRadiusTl: foundRadiusTl(),
      radiusTr: editRadiusTr(), foundRadiusTr: foundRadiusTr(),
      radiusBr: editRadiusBr(), foundRadiusBr: foundRadiusBr(),
      radiusBl: editRadiusBl(), foundRadiusBl: foundRadiusBl(),
      flexDir: editFlexDir(),
      flexGap: editFlexGap(), foundFlexGap: foundFlexGap(),
      justify: editJustify(),
      alignItems: editAlignItems(),
      paddingMode: paddingMode(),
      bgImage: editBgImage(),
      bgUrl: editBgUrl(),
      tag: editTag(),
      fills: fills.map(f => `${f.id}:${f.color}:${f.opacity}:${f.visible}`),
      strokes: strokes.map(s => `${s.id}:${s.color}:${s.visible}:${s.width}:${s.position}:${s.individualOpen}:${s.widthTop}:${s.widthRight}:${s.widthBottom}:${s.widthLeft}`),
      effects: effects.map(e => `${e.id}:${e.type}:${e.visible}:${e.color}:${e.opacity}:${e.blur}:${e.offsetX}:${e.offsetY}:${e.layerBlur}:${e.bgBlur}`),
      editProps: JSON.stringify(editProps),
      propKeys: JSON.stringify(propKeys()),
    }
  })

  createEffect(() => {
    autoSnapshot()
    if (!ready) return
    clearTimeout(autoUpdateTimer)
    autoUpdateTimer = setTimeout(() => handleConfirm(true), 400)
  })

  function updateDims() {
    if (popupRef) {
      setPopupW(popupRef.offsetWidth)
      setPopupH(popupRef.offsetHeight)
    }
  }

  const finalStyle = createMemo(() => ({
    position: 'absolute' as const,
    right: `${initialPos.right + dragOffset.x}px`,
    top: `${initialPos.top + dragOffset.y}px`,
  }))

  function startDrag(e: MouseEvent) {
    e.preventDefault()
    const sx = e.clientX, sy = e.clientY
    const ox = dragOffset.x, oy = dragOffset.y
    const onDrag = (me: MouseEvent) => { setDragOffset({ x: ox - (me.clientX - sx), y: oy + me.clientY - sy }) }
    const onUp = () => { window.removeEventListener('mousemove', onDrag); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onDrag)
    window.addEventListener('mouseup', onUp)
  }

  function openBgPicker() {
    const inp = document.createElement('input')
    inp.type = 'file'; inp.accept = 'image/*'; inp.style.display = 'none'
    inp.addEventListener('change', () => { const f = inp.files?.[0]; if (f) setEditBgImage(f) })
    document.body.appendChild(inp)
    inp.click()
    inp.addEventListener('blur', () => { document.body.removeChild(inp) })
  }

  function buildCssObject(): Record<string, string> {
    const css: Record<string, string> = {}

    if (foundFontSize()) css['font-size'] = editFontSize() + 'px'
    if (foundFontWeight()) css['font-weight'] = String(editFontWeight())
    if (editFontFamily()) css['font-family'] = editFontFamily()
    if (editAlign()) css['text-align'] = editAlign()
    if (editLineHeight() && editLineHeight() !== 'auto') css['line-height'] = editLineHeight()
    if (editLetterSpacing()) css['letter-spacing'] = (editLetterSpacing() / 100) + 'em'

    if (editTextColor()) css['color'] = editTextColor()

    if (editBgUrl()) css['background-image'] = `url(${editBgUrl()})`

    const pt = editPt(), pr = editPr(), pb = editPb(), pl = editPl()
    const fp = foundPt(), fpr = foundPr(), fpb = foundPb(), fpl = foundPl()
    if (fp && fpr && fpb && fpl && pt === pr && pt === pb && pt === pl) {
      css['padding'] = pt + 'px'
    } else {
      if (fp) css['padding-top'] = pt + 'px'
      if (fpr) css['padding-right'] = pr + 'px'
      if (fpb) css['padding-bottom'] = pb + 'px'
      if (fpl) css['padding-left'] = pl + 'px'
    }

    const mt = editMt(), mr = editMr(), mb = editMb(), ml = editMl()
    const fmt = foundMt(), fmr = foundMr(), fmb = foundMb(), fml = foundMl()
    if (fmt && fmr && fmb && fml && mt === mr && mt === mb && mt === ml) {
      css['margin'] = mt + 'px'
    } else {
      if (fmt) css['margin-top'] = mt + 'px'
      if (fmr) css['margin-right'] = mr + 'px'
      if (fmb) css['margin-bottom'] = mb + 'px'
      if (fml) css['margin-left'] = ml + 'px'
    }

    if (foundRadiusTl() || foundRadiusTr() || foundRadiusBr() || foundRadiusBl()) {
      if (foundRadiusTl()) css['border-top-left-radius'] = editRadiusTl() + 'px'
      if (foundRadiusTr()) css['border-top-right-radius'] = editRadiusTr() + 'px'
      if (foundRadiusBr()) css['border-bottom-right-radius'] = editRadiusBr() + 'px'
      if (foundRadiusBl()) css['border-bottom-left-radius'] = editRadiusBl() + 'px'
    } else if (foundRadius()) {
      css['border-radius'] = editRadius() + 'px'
    }

    if (fillWidth()) css['width'] = '100%'
    else if (hugWidth()) css['width'] = 'auto'
    else if (foundWidthPx() && editWidthPx()) css['width'] = editWidthPx() + 'px'
    else if (editWidth()) css['width'] = editWidth()

    if (fillHeight()) css['height'] = '100%'
    else if (hugHeight()) css['height'] = 'auto'
    else if (foundHeightPx() && editHeightPx()) css['height'] = editHeightPx() + 'px'

    if (clipContent()) css['overflow'] = 'hidden'

    if (foundOpacity() && editOpacity() !== 100) css['opacity'] = String(editOpacity() / 100)

    if (editFlexDir()) {
      css['display'] = 'flex'
      css['flex-direction'] = editFlexDir() === 'col' ? 'column' : 'row'
      if (editFlexGap() && foundFlexGap() && editJustify() !== 'between' && editJustify() !== 'around') {
        css['gap'] = editFlexGap() + 'px'
      }
      if (editJustify()) {
        const j: Record<string, string> = { start: 'flex-start', end: 'flex-end', between: 'space-between', around: 'space-around' }
        css['justify-content'] = j[editJustify()] ?? editJustify()
      }
      if (editAlignItems()) {
        const a: Record<string, string> = { start: 'flex-start', end: 'flex-end' }
        css['align-items'] = a[editAlignItems()] ?? editAlignItems()
      }
    }

    for (const f of fills) {
      if (!f.visible) continue
      if (f.opacity < 100) {
        const a = Math.round(f.opacity * 2.55).toString(16).padStart(2, '0')
        css['background-color'] = f.color + a
      } else {
        css['background-color'] = f.color
      }
    }

    for (const s of strokes) {
      if (!s.visible) continue
      css['border-style'] = 'solid'
      css['border-color'] = s.color
      if (s.individualOpen) {
        if (s.foundWidthTop && s.widthTop) css['border-top-width'] = s.widthTop + 'px'
        if (s.foundWidthRight && s.widthRight) css['border-right-width'] = s.widthRight + 'px'
        if (s.foundWidthBottom && s.widthBottom) css['border-bottom-width'] = s.widthBottom + 'px'
        if (s.foundWidthLeft && s.widthLeft) css['border-left-width'] = s.widthLeft + 'px'
      } else if (s.foundWidth && s.width) {
        css['border-width'] = s.width + 'px'
      }
    }

    for (const e of effects) {
      if (!e.visible) continue
      if (e.type === 'drop-shadow') {
        const r = Math.round(e.opacity * 2.55)
        const a = r.toString(16).padStart(2, '0')
        css['box-shadow'] = `${e.offsetX}px ${e.offsetY}px ${e.blur}px ${e.color}${a}`
      } else if (e.type === 'layer-blur') {
        if (e.foundLayerBlur && e.layerBlur) css['filter'] = `blur(${e.layerBlur}px)`
      } else if (e.type === 'background-blur') {
        if (e.foundBgBlur && e.bgBlur) css['backdrop-filter'] = `blur(${e.bgBlur}px)`
      }
    }

    return css
  }

  async function handleConfirm(skipChangeCheck?: boolean) {
    let className = ''
    const hasAnyTailwind = parsedClasses.some(c => isTailwindToken(c))
    if (hasClassEditor() && hasAnyTailwind) {
      const desktopApi = (window as unknown as {
        api?: {
          tailwindToCss?: (className: string) => Promise<Record<string, string>>
          cssToTailwind?: (cssObject: Record<string, unknown>) => Promise<string>
        }
      }).api
      const api = desktopApi?.cssToTailwind
      if (api) {
        const cssObj = buildCssObject()
        console.log("[PropertyEditor] cssToTailwind input (cssObj):", cssObj)
        className = await api(cssObj)
        console.log("[PropertyEditor] cssToTailwind output (className):", className)
        logAgentCall('cssToTailwind', props.elementId, JSON.stringify(cssObj), className)
        const flexExtra = parsedClasses.filter(c => c.startsWith('flex-') && !['flex', 'flex-col', 'flex-row'].includes(c)).join(' ')
        if (flexExtra) className = (className + ' ' + flexExtra).trim()
        const keepParts = parsedClasses.filter(c => {
          if (c === '' || c === 'flex' || c === 'flex-col' || c === 'flex-row') return false
          if (c.startsWith('flex-')) return false
          return !isTailwindToken(c)
        })
        if (keepParts.length > 0) className = (keepParts.join(' ') + ' ' + className).trim()
      } else {
        className = buildClassName()
        console.log("[PropertyEditor] buildClassName output (no api):", className)
        logAgentCall('buildClassName', props.elementId, props.currentClass || '', className)
        if (editTextColor()) {
          className = className.replace(/\btext-\[#[^\]]+\]/g, '').trim()
          className += ` text-[${editTextColor()}]`
        }
        if (editBgColor()) {
          className = className.replace(/\bbg-\[#[^\]]+\]/g, '').trim()
          className += ` bg-[${editBgColor()}]`
        }
        if (initialBgUrl && !editBgUrl() && !editBgImage()) {
          className = className.replace(/\bbg-\[url\([^)]+\)\]/g, '').replace(/\bbg-(cover|contain|center|no-repeat)\b/g, '').trim()
        }
      }
    }

    const componentProps: Record<string, string> = {}
    if (!isTextElement()) {
      for (const key of propKeys()) {
        if (key === 'className') continue
        const val = (editProps as Record<string, string>)[key]
        const isEnum = getEnumOptions(key).length > 0
        if (isEnum || val) componentProps[key] = val
      }
    }

    if (!skipChangeCheck) {
      const currentClass = props.currentClass || ''
      if (className === currentClass && Object.keys(componentProps).length === 0) {
        props.onCancel()
        return
      }
    }

    const confirmData: ModifyElementData = {
      elementId: props.elementId,
      className,
      textContent: editText(),
      componentProps,
      tag: editTag() || undefined,
      keepOpen: skipChangeCheck,
      saveToHistory: true,
    }
    console.log("[PropertyEditor] confirmData:", {
      elementId: confirmData.elementId,
      classNameBefore: props.currentClass,
      classNameAfter: className,
      componentPropsBefore: (() => { try { return JSON.parse(props.elementProps || '{}') } catch { return {} } })(),
      componentPropsAfter: componentProps,
      textContentBefore: (() => { try { return JSON.parse(props.elementProps || '{}').value || '' } catch { return '' } })(),
      textContentAfter: editText(),
      skipChangeCheck,
    })
    console.log("[PropertyEditor] confirm, outgoing className:", className, "componentProps:", JSON.stringify(componentProps), "elementId:", props.elementId)
    props.onConfirm(confirmData)
  }

  return (
    <Show when={props.show}>
      <div
        class="property-editor-overlay"
        onClick={() => props.onCancel()}
        onContextMenu={(e) => e.preventDefault()}
      />
      <div
        ref={(el) => { popupRef = el; if (el) updateDims() }}
        style={finalStyle()}
        class="property-editor-popup"
      >
        <div class="popup-header" onMouseDown={startDrag}>
          <span class="text-sm font-semibold text-slate-700">{props.componentType}</span>
          <span class="text-xs text-slate-400 ml-2 truncate">{props.elementId}</span>
          <button
            type="button"
            onClick={() => props.onCancel()}
            class="ml-auto flex items-center justify-center w-5 h-5 rounded-sm text-slate-400 hover:text-slate-600 hover:bg-slate-100 flex-shrink-0"
            id="popup-header-close-btn"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
              <line x1="2" y1="2" x2="10" y2="10" />
              <line x1="10" y1="2" x2="2" y2="10" />
            </svg>
          </button>
        </div>

        <div class="popup-body px-4 pb-4 flex flex-col gap-2">

          <Show when={!isTextElement() && propKeys().filter(k => k !== 'className' || !hasClassEditor()).length > 0}>
            <div class="grid gap-1.5 min-w-0">
              <span class="text-[10px] font-medium text-slate-500">组件属性</span>
              <For each={propKeys().filter(k => k !== 'className' || !hasClassEditor())}>
                {(key) => (
                  <div class="flex items-center gap-2">
                    <label class="text-[10px] font-medium text-slate-500 w-14 shrink-0">
                      {LABEL_MAP[key] || key}
                      <Show when={isBinding(key)}>
                        <span class="text-[10px] text-amber-500 font-normal">动态绑定</span>
                      </Show>
                    </label>
                    <Show
                      when={getEnumOptions(key).length > 0}
                      fallback={
                        <input value={(editProps as Record<string, string>)[key] ?? ''}
                          onInput={(e) => setEditProps(key, e.currentTarget.value)}
                          type="text" placeholder={key}
                          class="flex items-center rounded-sm bg-[#F4F4F5] h-6 text-[11px] px-2 outline-none flex-1 min-w-0 focus:border-[#3D99FF] focus:ring-1 focus:ring-[#3D99FF] border border-transparent shadow-none" />
                      }
                    >
                      <CustomSelect
                        value={(editProps as Record<string, string>)[key] ?? ''}
                        options={getEnumOptions(key).map(o => ({ label: o, value: o }))}
                        onChange={(v) => setEditProps(key, v)}
                        class="flex-1 min-w-0"
                      />
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </Show>

          <Show when={!isTextElement() && !hasClassEditor() && propKeys().filter(k => k !== 'className').length === 0}>
            <div class="text-[11px] text-slate-400 py-2">该组件暂不支持快速修改</div>
          </Show>

          <Show when={hasClassEditor()}>
            {/* <div>
              <label class="mb-1 block text-xs font-medium text-slate-500">文本内容</label>
              <textarea value={editText()} onInput={(e) => setEditText(e.currentTarget.value)}
                placeholder="输入文本内容" rows={2} class="property-input w-full" />
            </div> */}

            {/* <div class="flex items-center gap-2">
              <label class="text-xs font-medium text-slate-500 w-14 shrink-0">字号</label>
              <input type="number" min={8} max={128} value={editFontSize()}
                onInput={(e) => setEditFontSize(parseInt(e.currentTarget.value) || 14)}
                class="property-number-input" />
              <span class="text-xs text-slate-400">px</span>
              <div class="flex gap-1 ml-auto">
                <For each={[12, 14, 16, 18, 20, 24]}>
                  {(s) => (
                    <button onClick={() => setEditFontSize(s)}
                      class={editFontSize() === s ? 'prop-chip-active' : 'prop-chip'}>{s}</button>
                  )}
                </For>
              </div>
            </div> */}

            {/* <div class="flex items-center gap-2">
              <label class="text-xs font-medium text-slate-500 w-14 shrink-0">字重</label>
              <input type="range" min={100} max={900} step={100} value={editFontWeight()}
                onInput={(e) => setEditFontWeight(parseInt(e.currentTarget.value))}
                class="flex-1 h-1 accent-sky-500" />
              <span class="text-xs text-slate-500 w-8 text-right">{editFontWeight()}</span>
            </div> */}

            {/* <div class="flex items-center gap-2">
              <label class="text-xs font-medium text-slate-500 w-14 shrink-0">对齐</label>
              <div class="flex gap-0.5">
                <For each={aligns}>
                  {(a) => (
                    <button onClick={() => setEditAlign(a.value)} title={a.label}
                      class={editAlign() === a.value ? 'prop-chip-active w-8 h-7' : 'prop-chip w-8 h-7'}>
                      <AlignIcon value={a.value} />
                    </button>
                  )}
                </For>
              </div>
            </div> */}

            <div class="grid gap-1.5 py-0.5 border-slate-100">
              <span class="text-[10px] font-medium text-slate-500">
                {editFlexDir() ? 'Flex Layout' : 'Layout'}
              </span>
              <div class="flex gap-1 rounded-[6px] p-[1px] bg-[#E4E4E7] ">
                <button onClick={() => setEditFlexDir('')}
                  class={!editFlexDir() ? 'prop-chip-active h-6 flex-1 flex items-center justify-center' : 'prop-chip h-6 flex-1 flex items-center justify-center'}>
                  <FreeformIcon />
                </button>
                <button onClick={() => setEditFlexDir('row')}
                  class={editFlexDir() === 'row' ? 'prop-chip-active h-6 flex-1 flex items-center justify-center' : 'prop-chip h-6 flex-1 flex items-center justify-center'}>
                  <RowIcon />
                </button>
                <button onClick={() => setEditFlexDir('col')}
                  class={editFlexDir() === 'col' ? 'prop-chip-active h-6 flex-1 flex items-center justify-center' : 'prop-chip h-6 flex-1 flex items-center justify-center'}>
                  <ColIcon />
                </button>
              </div>

              <Show when={!!editFlexDir()}>
                <div class="flex gap-2">
                  <div class="flex-1">
                    <div class="text-[10px] font-medium text-slate-500 mb-1">Alignment</div>
                    <div class="grid grid-cols-3 gap-1 grid-rows-3  rounded-[6px] bg-[#F4F4F5]">
                      <For each={GRID_POSITIONS}>
                        {(p) => {
                          const selected = () => editJustify() === p.justify && editAlignItems() === p.align
                          const spaceMode = () => editJustify() === 'between' || editJustify() === 'around'
                          const isRowBar = () => spaceMode() && editFlexDir() === 'row' && p.align === (editAlignItems() || 'center')
                          const isColBar = () => spaceMode() && editFlexDir() === 'col' && p.justify === (editAlignItems() || 'center')
                          return (
                            <button
                              onClick={() => {
                                if (spaceMode()) {
                                  if (editFlexDir() === 'row') setEditAlignItems(p.align)
                                  else setEditAlignItems(p.justify)
                                  return
                                }
                                setEditJustify(p.justify); setEditAlignItems(p.align)
                              }}
                              class="flex items-center justify-center rounded-sm w-6 h-6 p-0 border border-transparent hover:bg-[#E4E4E7]"
                              title={p.label}
                            >
                              <div class="flex items-center justify-center w-full h-full">
                                <Show when={isRowBar()}>
                                  <div class={`transition-all bg-[#3D99FF] rounded-[1px] w-1 ${p.justify === 'center' ? 'h-2' : 'h-4'}`} />
                                </Show>
                                <Show when={isColBar()}>
                                  <div class={`transition-all bg-[#3D99FF] rounded-[1px] h-1 ${p.align === 'center' ? 'w-2' : 'w-4'}`} />
                                </Show>
                                <Show when={!isRowBar() && !isColBar()}>
                                  <div class={selected() ? 'transition-all w-2 h-2 rounded-[2px] bg-[#3D99FF]' : 'transition-all w-0.5 h-0.5 bg-current'} />
                                </Show>
                              </div>
                            </button>
                          )
                        }}
              </For>
            </div>
                  </div>
                  <div class="flex-1">
                    <div class="text-[10px] text-slate-400 mb-1">间距</div>

                    <label class="flex items-center gap-2 mb-1.5 cursor-pointer"
                      style={{ opacity: editJustify() !== 'between' && editJustify() !== 'around' ? 1 : 0.4 }}>
                      <input type="radio" name="justify-mode"
                        checked={editJustify() !== 'between' && editJustify() !== 'around'}
                        onChange={() => setEditJustify('start')} />
                      <DragInput value={editFlexGap} setValue={setEditFlexGap} setFound={setFoundFlexGap} found={foundFlexGap} placeholder="间距" class="w-16" flex1={false} />


                    </label>

                    <label class="flex items-center gap-2 mb-1.5 cursor-pointer">
                      <input type="radio" name="justify-mode"
                        checked={editJustify() === 'between'}
                        onChange={() => setEditJustify('between')} />
                      <span class="text-[10px] text-slate-400">Space between</span>
                    </label>

                    <label class="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="justify-mode"
                        checked={editJustify() === 'around'}
                        onChange={() => setEditJustify('around')} />
                      <span class="text-[10px] text-slate-400">Space around</span>
                    </label>
                  </div>
                </div>
              </Show>
            </div>

            {/* <div class="flex items-center gap-2">
              <label class="text-xs font-medium text-slate-500 w-14 shrink-0">文字色</label>
              <div class="flex items-center gap-2 flex-1">
                <input type="color" value={editTextColor()} onInput={(e) => setEditTextColor(e.currentTarget.value)}
                  class="w-7 h-7 rounded border border-slate-200 cursor-pointer p-0" />
                <span class="text-xs text-slate-400">{editTextColor() || '继承'}</span>
                <Show when={editTextColor()}>
                  <button onClick={() => setEditTextColor('')} class="text-xs text-slate-400 hover:text-slate-600 ml-auto">清除</button>
                </Show>
              </div>
            </div> */}

            {/* <div class="flex items-center gap-2">
              <label class="text-xs font-medium text-slate-500 w-14 shrink-0">背景</label>
              <input type="color" value={editBgColor()} onInput={(e) => setEditBgColor(e.currentTarget.value)}
                class="w-5 h-5 rounded border border-slate-200 cursor-pointer p-0" />
              <button onClick={openBgPicker} class="text-xs px-1.5 py-0.5 rounded-sm border border-slate-200 text-slate-500 hover:border-slate-400 hover:bg-slate-50 whitespace-nowrap">图片</button>
              <Show when={(editBgUrl() && editBgUrl() !== 'none') || editBgImage()?.name}>
                <span class="text-[10px] text-slate-500 truncate flex-1">{editBgImage()?.name || editBgUrl()}</span>
              </Show>
              <Show when={editBgImage() || (editBgUrl() && editBgUrl() !== 'none')}>
                <button onClick={() => { setEditBgImage(null); setEditBgUrl('') }} class="text-xs text-slate-400 hover:text-slate-600">✕</button>
              </Show>
            </div> */}

            <div class="grid gap-1.5 py-0.5 border-slate-100 min-w-0">
              <div class="flex items-center justify-between">
                <span class="text-[10px] font-medium text-slate-500">Padding</span>
                <div class="relative padding-dropdown-area">
                  <button onClick={() => setPaddingOpen(!paddingOpen())}
                    class="prop-chip h-5 w-5 p-0 flex items-center justify-center">
                    <span class="w-3 h-3"><SettingsIcon /></span>
                  </button>
                  <Show when={paddingOpen()}>
                    <div class="absolute right-0 top-full mt-1 z-[301] py-1 w-[180px]"
                      style={{ background: "#fff", border: "1px solid #e2e8f0", "border-radius": "6px", "box-shadow": "0 4px 12px rgba(0,0,0,0.15)" }}
                      onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => { setPaddingMode('all'); setPaddingOpen(false) }}
                        class="w-full text-left px-3 py-2 text-[11px] text-slate-700 hover:bg-[#F4F4F5]">
                        One value for all sides
                      </button>
                      <button onClick={() => { setPaddingMode('hv'); setPaddingOpen(false) }}
                        class="w-full text-left px-3 py-2 text-[11px] text-slate-700 hover:bg-[#F4F4F5]">
                        Horizontal/Vertical
                      </button>
                      <button onClick={() => { setPaddingMode('trbl'); setPaddingOpen(false) }}
                        class="w-full text-left px-3 py-2 text-[11px] text-slate-700 hover:bg-[#F4F4F5]">
                        Top/Right/Bottom/Left
                      </button>
                    </div>
                  </Show>
                </div>
              </div>
              <Show when={paddingMode() === 'all'}>
                <div class="flex items-center gap-1.5 w-full min-w-0">
                  <DragInput
                    value={editPt} setValue={(v) => { setEditPt(v); setEditPr(v); setEditPb(v); setEditPl(v) }}
                    setFound={(v) => { setFoundPt(v); setFoundPr(v); setFoundPb(v); setFoundPl(v) }}
                    found={foundPt} placeholder="-" />
                </div>
              </Show>
              <Show when={paddingMode() === 'hv'}>
                <div class="flex items-center gap-1.5 w-full min-w-0">
                  <DragInput
                    value={editPr} setValue={(v) => { setEditPr(v); setEditPl(v) }}
                    setFound={(v) => { setFoundPr(v); setFoundPl(v) }}
                    found={foundPr} placeholder="H" />
                  <DragInput
                    value={editPt} setValue={(v) => { setEditPt(v); setEditPb(v) }}
                    setFound={(v) => { setFoundPt(v); setFoundPb(v) }}
                    found={foundPt} placeholder="V" />
                </div>
              </Show>
              <Show when={paddingMode() === 'trbl'}>
                <div class="flex flex-col gap-1.5 w-full min-w-0">
                  <div class="flex items-center gap-1.5 w-full min-w-0">
                    <DragInput value={editPt} setValue={setEditPt} setFound={setFoundPt} found={foundPt} placeholder="上" icon="↑" />
                    <DragInput value={editPr} setValue={setEditPr} setFound={setFoundPr} found={foundPr} placeholder="右" icon="→" />
                  </div>
                  <div class="flex items-center gap-1.5 w-full min-w-0">
                    <DragInput value={editPb} setValue={setEditPb} setFound={setFoundPb} found={foundPb} placeholder="下" icon="↓" />
                    <DragInput value={editPl} setValue={setEditPl} setFound={setFoundPl} found={foundPl} placeholder="左" icon="←" />
                  </div>
                </div>
              </Show>
            </div>

            <div class="grid gap-1.5 py-0.5 border-slate-100 min-w-0">
              <div class="flex items-center justify-between">
                <span class="text-[10px] font-medium text-slate-500">Margin</span>
                <div class="relative margin-dropdown-area">
                  <button onClick={() => setMarginOpen(!marginOpen())}
                    class="prop-chip h-5 w-5 p-0 flex items-center justify-center">
                    <span class="w-3 h-3"><SettingsIcon /></span>
                  </button>
                  <Show when={marginOpen()}>
                    <div class="absolute right-0 top-full mt-1 z-[301] py-1 w-[180px]"
                      style={{ background: "#fff", border: "1px solid #e2e8f0", "border-radius": "6px", "box-shadow": "0 4px 12px rgba(0,0,0,0.15)" }}
                      onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => { setMarginMode('all'); setMarginOpen(false) }}
                        class="w-full text-left px-3 py-2 text-[11px] text-slate-700 hover:bg-[#F4F4F5]">
                        One value for all sides
                      </button>
                      <button onClick={() => { setMarginMode('hv'); setMarginOpen(false) }}
                        class="w-full text-left px-3 py-2 text-[11px] text-slate-700 hover:bg-[#F4F4F5]">
                        Horizontal/Vertical
                      </button>
                      <button onClick={() => { setMarginMode('trbl'); setMarginOpen(false) }}
                        class="w-full text-left px-3 py-2 text-[11px] text-slate-700 hover:bg-[#F4F4F5]">
                        Top/Right/Bottom/Left
                      </button>
                    </div>
                  </Show>
                </div>
              </div>
              <Show when={marginMode() === 'all'}>
                <div class="flex items-center gap-1.5 w-full min-w-0">
                  <DragInput
                    value={editMt} setValue={(v) => { setEditMt(v); setEditMr(v); setEditMb(v); setEditMl(v) }}
                    setFound={(v) => { setFoundMt(v); setFoundMr(v); setFoundMb(v); setFoundMl(v) }}
                    found={foundMt} placeholder="-" />
                </div>
              </Show>
              <Show when={marginMode() === 'hv'}>
                <div class="flex items-center gap-1.5 w-full min-w-0">
                  <DragInput
                    value={editMr} setValue={(v) => { setEditMr(v); setEditMl(v) }}
                    setFound={(v) => { setFoundMr(v); setFoundMl(v) }}
                    found={foundMr} placeholder="H" />
                  <DragInput
                    value={editMt} setValue={(v) => { setEditMt(v); setEditMb(v) }}
                    setFound={(v) => { setFoundMt(v); setFoundMb(v) }}
                    found={foundMt} placeholder="V" />
                </div>
              </Show>
              <Show when={marginMode() === 'trbl'}>
                <div class="flex flex-col gap-1.5 w-full min-w-0">
                  <div class="flex items-center gap-1.5 w-full min-w-0">
                    <DragInput value={editMt} setValue={setEditMt} setFound={setFoundMt} found={foundMt} placeholder="上" icon="↑" />
                    <DragInput value={editMr} setValue={setEditMr} setFound={setFoundMr} found={foundMr} placeholder="右" icon="→" />
                  </div>
                  <div class="flex items-center gap-1.5 w-full min-w-0">
                    <DragInput value={editMb} setValue={setEditMb} setFound={setFoundMb} found={foundMb} placeholder="下" icon="↓" />
                    <DragInput value={editMl} setValue={setEditMl} setFound={setFoundMl} found={foundMl} placeholder="左" icon="←" />
                  </div>
                </div>
              </Show>
            </div>

            <div class="grid gap-1.5 py-0.5 border-slate-100 min-w-0">
              <span class="text-[10px] font-medium text-slate-500">宽高</span>
              <div class="flex items-center gap-1.5 w-full min-w-0">
                <DragInput value={editWidthPx} setValue={setEditWidthPx} setFound={setFoundWidthPx} found={foundWidthPx} placeholder="宽" />
                <DragInput value={editHeightPx} setValue={setEditHeightPx} setFound={setFoundHeightPx} found={foundHeightPx} placeholder="高" />
              </div>
              <div class="grid grid-cols-2 gap-x-2 gap-y-1">
                <label class="flex items-center gap-1 cursor-pointer">
                  <input type="checkbox" checked={fillWidth()} onChange={(e) => { setFillWidth(e.currentTarget.checked); if (e.currentTarget.checked) setHugWidth(false) }} />
                  <span class="text-[10px] text-slate-500">Fill width</span>
                </label>
                <label class="flex items-center gap-1 cursor-pointer">
                  <input type="checkbox" checked={fillHeight()} onChange={(e) => { setFillHeight(e.currentTarget.checked); if (e.currentTarget.checked) setHugHeight(false) }} />
                  <span class="text-[10px] text-slate-500">Fill height</span>
                </label>
                <label class="flex items-center gap-1 cursor-pointer">
                  <input type="checkbox" checked={hugWidth()} onChange={(e) => { setHugWidth(e.currentTarget.checked); if (e.currentTarget.checked) setFillWidth(false) }} />
                  <span class="text-[10px] text-slate-500">Hug width</span>
                </label>
                <label class="flex items-center gap-1 cursor-pointer">
                  <input type="checkbox" checked={hugHeight()} onChange={(e) => { setHugHeight(e.currentTarget.checked); if (e.currentTarget.checked) setFillHeight(false) }} />
                  <span class="text-[10px] text-slate-500">Hug height</span>
                </label>
                <label class="flex items-center gap-1 cursor-pointer col-span-2">
                  <input type="checkbox" checked={clipContent()} onChange={(e) => setClipContent(e.currentTarget.checked)} />
                  <span class="text-[10px] text-slate-500">Clip content</span>
                </label>
              </div>
            </div>

            <div class="grid gap-1.5 py-0.5 border-slate-100 min-w-0">
              <span class="text-[10px] font-medium text-slate-500">Appearance</span>
              <div class="flex items-center gap-1.5 w-full min-w-0">
                <DragInput value={editOpacity} setValue={setEditOpacity} setFound={setFoundOpacity} found={foundOpacity} placeholder="透明度" max={100} suffix="%" />
                <DragInput value={editRadius} setValue={setEditRadius} setFound={setFoundRadius} found={foundRadius} placeholder="圆角" display={cornerOpen() && (foundRadiusTl() || foundRadiusTr() || foundRadiusBr() || foundRadiusBl()) ? 'mixed' : undefined} />
                <button onClick={() => setCornerOpen(!cornerOpen())}
                  class={cornerOpen() ? 'prop-chip-active h-6 w-6 p-0 flex items-center justify-center shrink-0' : 'prop-chip h-6 w-6 p-0 flex items-center justify-center shrink-0'}>
                  <span class="text-[10px]">◱</span>
                </button>
              </div>
              <Show when={cornerOpen()}>
                <div class="flex flex-col gap-1.5 w-full min-w-0">
                  <div class="flex items-center gap-1.5 w-full min-w-0">
                    <DragInput value={editRadiusTl} setValue={setEditRadiusTl} setFound={setFoundRadiusTl} found={foundRadiusTl} placeholder="左上" />
                    <DragInput value={editRadiusTr} setValue={setEditRadiusTr} setFound={setFoundRadiusTr} found={foundRadiusTr} placeholder="右上" />
                    <div class="w-6 shrink-0" />
                  </div>
                  <div class="flex items-center gap-1.5 w-full min-w-0">
                    <DragInput value={editRadiusBl} setValue={setEditRadiusBl} setFound={setFoundRadiusBl} found={foundRadiusBl} placeholder="左下" />
                    <DragInput value={editRadiusBr} setValue={setEditRadiusBr} setFound={setFoundRadiusBr} found={foundRadiusBr} placeholder="右下" />
                    <div class="w-6 shrink-0" />
                  </div>
                </div>
              </Show>
            </div>

            {/* Fill section hidden */}
            {/* <div class="grid gap-1.5 py-0.5 border-slate-100 min-w-0">
              <div class="flex items-center justify-between">
                <span class="text-[10px] font-medium text-slate-500">Fill</span>
                <button onClick={() => { setFills([...fills, { id: ++fillIdCounter, color: '#FFFFFF', opacity: 100, visible: true }]) }}
                  class="prop-chip h-5 w-5 p-0 flex items-center justify-center">
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3v10M3 8h10" /></svg>
                </button>
              </div>
              <For each={fills}>
                {(f) => {
                  return (
                    <div class="flex items-center gap-1.5 w-full min-w-0">
                      <div class="flex items-center gap-1.5 bg-[#f5f7fa] rounded-sm px-1.5 h-6">
                        <div class="relative shrink-0 w-3.5 h-3.5 rounded-[1px] overflow-hidden" style={{ background: f.color }}>
                          <input type="color" value={f.color}
                            onInput={(e) => { const i = fills.findIndex(x => x.id === f.id); if (i >= 0) setFills(i, 'color', e.currentTarget.value) }}
                            class="absolute inset-0 opacity-0 w-full h-full cursor-pointer" />
                        </div>
                        <span class="text-[11px] text-slate-600 font-mono">{f.color}</span>
                      </div>

                      <DragInput value={() => f.opacity} setValue={(v) => { const i = fills.findIndex(x => x.id === f.id); if (i >= 0) setFills(i, 'opacity', v) }} setFound={() => { }} found={() => true} placeholder="100%" max={100} suffix="%" />
                      <button onClick={() => { const i = fills.findIndex(x => x.id === f.id); if (i >= 0) setFills(i, 'visible', !fills[i].visible) }}
                        class="prop-chip h-5 w-5 p-0 flex items-center justify-center shrink-0">
                        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                          {f.visible
                            ? <><path d="M2 8s2-5 6-5 6 5 6 5-2 5-6 5-6-5-6-5z" /><circle cx="8" cy="8" r="2" /></>
                            : <><path d="M1 1l14 14M4 4c-1.3.8-2.5 2-3 4 0 0 2 5 6 5 1.5 0 2.8-.5 3.8-1.2M14 12c1.3-.8 2.5-2 3-4 0 0-2-5-6-5-1.5 0-2.8.5-3.8 1.2" /></>
                          }
                        </svg>
                      </button>
                      <button onClick={() => setFills(fills.filter(x => x.id !== f.id))}
                        class="prop-chip h-5 w-5 p-0 flex items-center justify-center shrink-0">
                        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 8h10" /></svg>
                      </button>
                    </div>
                  )
                }}
              </For>
            </div> */}

            <div class="grid gap-1.5 py-0.5 border-slate-100 min-w-0">
              <span class="text-[10px] font-medium text-slate-500">Typography</span>
                <CustomSelect
                  value={editFontFamily()}
                  options={[{ label: 'Default', value: '' }, { label: 'Sans', value: 'sans' }, { label: 'Serif', value: 'serif' }, { label: 'Mono', value: 'mono' }]}
                  onChange={(v) => setEditFontFamily(v)}
                />
              <div class="flex items-center gap-1.5 w-full min-w-0">
                <CustomSelect
                  value={String(editFontWeight())}
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
                  onChange={(v) => setEditFontWeight(Number(v))}
                />
                <DragInput value={editFontSize} setValue={setEditFontSize} setFound={() => {}} found={() => true} placeholder="字号" />
              </div>
              <div class="flex items-center gap-1.5 w-full min-w-0">
                <div class="flex flex-col gap-0.5 flex-1 min-w-0">
                  <span class="text-[9px] text-slate-400">Line height</span>
                  <DragInput value={() => editLineHeight() === 'auto' ? 0 : Number(editLineHeight()) || 0} setValue={(v) => setEditLineHeight(String(v))} setFound={() => {}} found={() => editLineHeight() !== '' && editLineHeight() !== 'auto'} placeholder="auto" />
                </div>
                <div class="flex flex-col gap-0.5 flex-1 min-w-0">
                  <span class="text-[9px] text-slate-400">Letter spacing</span>
                  <DragInput value={editLetterSpacing} setValue={setEditLetterSpacing} setFound={() => {}} found={() => true} placeholder="0" />
                </div>
              </div>
              <div class="flex items-start gap-2 w-full min-w-0">
                <div class="flex flex-col gap-0.5 flex-4 min-w-0">
                  <span class="text-[9px] text-slate-400">Horizontal</span>
                  <div class="flex gap-0.5 rounded-[6px] bg-[#E4E4E7] p-[1px]">
                    {(['left', 'center', 'right', 'justify'] as const).map(a => (
                      <button onClick={() => setEditAlign(a === editAlign() ? '' : a)} title={{ left: 'Align left', center: 'Align center', right: 'Align right', justify: 'Justify' }[a]}
                        class={editAlign() === a ? 'prop-chip-active h-5 flex-1 flex items-center justify-center p-0' : 'prop-chip h-5 flex-1 flex items-center justify-center p-0'}>
                        <HAlignIcon value={a} />
                      </button>
                    ))}
                  </div>
                </div>
                <div class="flex flex-col gap-0.5 flex-3 min-w-0">
                  <span class="text-[9px] text-slate-400">Vertical</span>
                  <div class="flex gap-0.5 rounded-[6px] bg-[#E4E4E7] p-[1px]">
                    {(['start', 'center', 'end'] as const).map(a => (
                      <button onClick={() => setEditVAlign(a === editVAlign() ? '' : a)} title={{ start: 'Align top', center: 'Align middle', end: 'Align bottom' }[a]}
                        class={editVAlign() === a ? 'prop-chip-active h-5 flex-1 flex items-center justify-center p-0' : 'prop-chip h-5 flex-1 flex items-center justify-center p-0'}>
                        <VAlignIcon value={a} />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div class="grid gap-1.5 py-0.5 border-slate-100 min-w-0">
              <div class="flex items-center justify-between">
                <span class="text-[10px] font-medium text-slate-500">Stroke</span>
                <button onClick={() => { setStrokes([...strokes, { id: ++strokeIdCounter, color: '#000000', visible: true, position: 'center', width: 1, widthTop: 0, widthRight: 0, widthBottom: 0, widthLeft: 0, foundWidth: false, foundWidthTop: false, foundWidthRight: false, foundWidthBottom: false, foundWidthLeft: false, individualOpen: false }]) }}
                  class="prop-chip h-5 w-5 p-0 flex items-center justify-center">
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3v10M3 8h10" /></svg>
                </button>
              </div>
              <For each={strokes}>
                {(s) => {
                  return (
                    <>
                      <div class="flex items-center gap-1.5 w-full min-w-0">
                        <div class="flex items-center gap-1.5 bg-[#f5f7fa] rounded-sm px-1.5 h-6">
                          <div class="relative shrink-0 w-3.5 h-3.5 rounded-[1px] overflow-hidden" style={{ background: s.color }}>
                            <input type="color" value={s.color}
                              onInput={(e) => { const i = strokes.findIndex(x => x.id === s.id); if (i >= 0) setStrokes(i, 'color', e.currentTarget.value) }}
                              class="absolute inset-0 opacity-0 w-full h-full cursor-pointer" />
                          </div>
                          <span class="text-[11px] text-slate-600 font-mono">{s.color}</span>
                        </div>
                        <button onClick={() => { const i = strokes.findIndex(x => x.id === s.id); if (i >= 0) setStrokes(i, 'visible', !strokes[i].visible) }}
                          class="prop-chip h-5 w-5 p-0 flex items-center justify-center shrink-0">
                          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                            {s.visible
                              ? <><path d="M2 8s2-5 6-5 6 5 6 5-2 5-6 5-6-5-6-5z" /><circle cx="8" cy="8" r="2" /></>
                              : <><path d="M1 1l14 14M4 4c-1.3.8-2.5 2-3 4 0 0 2 5 6 5 1.5 0 2.8-.5 3.8-1.2M14 12c1.3-.8 2.5-2 3-4 0 0-2-5-6-5-1.5 0-2.8.5-3.8 1.2" /></>
                            }
                          </svg>
                        </button>
                        <button onClick={() => setStrokes(strokes.filter(x => x.id !== s.id))}
                          class="prop-chip h-5 w-5 p-0 flex items-center justify-center shrink-0">
                          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 8h10" /></svg>
                        </button>
                      </div>
                      <div class="flex items-center gap-1.5 w-full min-w-0">
                        <CustomSelect
                          value={s.position}
                          options={[{ label: 'center', value: 'center' }, { label: 'inside', value: 'inside' }, { label: 'outside', value: 'outside' }]}
                          onChange={(v) => { const i = strokes.findIndex(x => x.id === s.id); if (i >= 0) setStrokes(i, 'position', v as 'center' | 'inside' | 'outside') }}
                        />
                        <DragInput value={() => s.width} setValue={(v) => { const i = strokes.findIndex(x => x.id === s.id); if (i >= 0) { setStrokes(i, 'width', v); setStrokes(i, 'foundWidth', true) } }} setFound={() => { }} found={() => s.foundWidth} placeholder="宽度" display={s.individualOpen && (s.foundWidthTop || s.foundWidthRight || s.foundWidthBottom || s.foundWidthLeft) ? 'mixed' : undefined} />
                        <button onClick={() => { const i = strokes.findIndex(x => x.id === s.id); if (i >= 0) setStrokes(i, 'individualOpen', !strokes[i].individualOpen) }}
                          class={s.individualOpen ? 'prop-chip-active h-6 w-6 p-0 flex items-center justify-center shrink-0' : 'prop-chip h-6 w-6 p-0 flex items-center justify-center shrink-0'}>
                          <span class="text-[10px]">◱</span>
                        </button>
                      </div>
                      <Show when={s.individualOpen}>
                        <div class="flex flex-col gap-1.5 w-full min-w-0">
                          <div class="flex items-center gap-1.5 w-full min-w-0">
                            <DragInput value={() => s.widthTop} setValue={(v) => { const i = strokes.findIndex(x => x.id === s.id); if (i >= 0) { setStrokes(i, 'widthTop', v); setStrokes(i, 'foundWidthTop', true) } }} setFound={() => { }} found={() => s.foundWidthTop} placeholder="上" />
                            <DragInput value={() => s.widthRight} setValue={(v) => { const i = strokes.findIndex(x => x.id === s.id); if (i >= 0) { setStrokes(i, 'widthRight', v); setStrokes(i, 'foundWidthRight', true) } }} setFound={() => { }} found={() => s.foundWidthRight} placeholder="右" />
                            <div class="w-6 shrink-0" />
                          </div>
                          <div class="flex items-center gap-1.5 w-full min-w-0">
                            <DragInput value={() => s.widthBottom} setValue={(v) => { const i = strokes.findIndex(x => x.id === s.id); if (i >= 0) { setStrokes(i, 'widthBottom', v); setStrokes(i, 'foundWidthBottom', true) } }} setFound={() => { }} found={() => s.foundWidthBottom} placeholder="下" />
                            <DragInput value={() => s.widthLeft} setValue={(v) => { const i = strokes.findIndex(x => x.id === s.id); if (i >= 0) { setStrokes(i, 'widthLeft', v); setStrokes(i, 'foundWidthLeft', true) } }} setFound={() => { }} found={() => s.foundWidthLeft} placeholder="左" />
                            <div class="w-6 shrink-0" />
                          </div>
                        </div>
                      </Show>
                    </>
                  )
                }}
              </For>
            </div>

            <div class="grid gap-1.5 py-0.5 border-slate-100 min-w-0">
              <div class="flex items-center justify-between">
                <span class="text-[10px] font-medium text-slate-500">Effects</span>
                <button onClick={() => { setEffects([...effects, { id: ++effectIdCounter, type: 'drop-shadow', visible: true, expanded: false, color: '#000000', opacity: 100, blur: 0, offsetX: 0, offsetY: 0, foundBlur: false, foundOffsetX: false, foundOffsetY: false, layerBlur: 0, foundLayerBlur: false, bgBlur: 0, foundBgBlur: false }]) }}
                  class="prop-chip h-5 w-5 p-0 flex items-center justify-center">
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3v10M3 8h10" /></svg>
                </button>
              </div>
               <For each={effects}>
                {(e) => {
                  let triggerRef!: HTMLButtonElement
                  let popupRef!: HTMLDivElement
                  const [panelPos, setPanelPos] = createSignal({ x: 0, y: 0 })
                  createEffect(() => {
                    if (!e.expanded) return
                    const handler = (ev: MouseEvent) => {
                      if (popupRef && !popupRef.contains(ev.target as Node)) {
                        const i = effects.findIndex(x => x.id === e.id)
                        if (i >= 0) setEffects(i, 'expanded', false)
                      }
                    }
                    if (triggerRef) {
                      const rect = triggerRef.getBoundingClientRect()
                      setPanelPos({ x: rect.left - 208, y: rect.top - 4 })
                    }
                    document.addEventListener('mousedown', handler)
                    onCleanup(() => document.removeEventListener('mousedown', handler))
                  })
                  return (
                    <div class="relative">
                      <div class="flex items-center gap-1.5 w-full min-w-0">
                        <button ref={triggerRef} onClick={(ev) => { ev.stopPropagation(); const i = effects.findIndex(x => x.id === e.id); if (i >= 0) setEffects(i, 'expanded', !e.expanded) }}
                          class={e.expanded ? 'prop-chip-active h-5 w-5 p-0 flex items-center justify-center shrink-0' : 'prop-chip h-5 w-5 p-0 flex items-center justify-center shrink-0'}>
                          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2l2 2-8 8H4v-2l8-8z" /></svg>
                        </button>
                        <CustomSelect
                          value={e.type}
                          options={[{ label: 'Drop shadow', value: 'drop-shadow' }, { label: 'Layer blur', value: 'layer-blur' }, { label: 'Background blur', value: 'background-blur' }]}
                          onChange={(v) => { const i = effects.findIndex(x => x.id === e.id); if (i >= 0) setEffects(i, 'type', v as 'drop-shadow' | 'layer-blur' | 'background-blur') }}
                        />
                        <button onClick={() => { const i = effects.findIndex(x => x.id === e.id); if (i >= 0) setEffects(i, 'visible', !effects[i].visible) }}
                          class="prop-chip h-5 w-5 p-0 flex items-center justify-center shrink-0">
                          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                            {e.visible
                              ? <><path d="M2 8s2-5 6-5 6 5 6 5-2 5-6 5-6-5-6-5z" /><circle cx="8" cy="8" r="2" /></>
                              : <><path d="M1 1l14 14M4 4c-1.3.8-2.5 2-3 4 0 0 2 5 6 5 1.5 0 2.8-.5 3.8-1.2M14 12c1.3-.8 2.5-2 3-4 0 0-2-5-6-5-1.5 0-2.8.5-3.8 1.2" /></>
                            }
                          </svg>
                        </button>
                        <button onClick={() => setEffects(effects.filter(x => x.id !== e.id))}
                          class="prop-chip h-5 w-5 p-0 flex items-center justify-center shrink-0">
                          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 8h10" /></svg>
                        </button>
                      </div>
                      <Show when={e.expanded}>
                        <Portal>
                          <div ref={popupRef} class="fixed z-[302] py-2 px-3 w-[200px]"
                            style={{ left: panelPos().x + 'px', top: panelPos().y + 'px', background: "#fff", border: "1px solid #e2e8f0", "border-radius": "6px", "box-shadow": "0 4px 12px rgba(0,0,0,0.15)" }}
                            onMouseDown={(ev) => ev.stopPropagation()}>
                            <Show when={e.type === 'drop-shadow'} fallback={
                            <Show when={e.type === 'layer-blur'} fallback={
                              <div class="flex flex-col gap-1.5">
                                <span class="text-[10px] font-medium text-slate-500">Background blur</span>
                                <DragInput value={() => e.bgBlur} setValue={(v) => { const i = effects.findIndex(x => x.id === e.id); if (i >= 0) { setEffects(i, 'bgBlur', v); setEffects(i, 'foundBgBlur', true) } }} setFound={() => { }} found={() => e.foundBgBlur} placeholder="Blur" />
                              </div>
                            }>
                              <div class="flex flex-col gap-1.5">
                                <span class="text-[10px] font-medium text-slate-500">Layer blur</span>
                                <DragInput value={() => e.layerBlur} setValue={(v) => { const i = effects.findIndex(x => x.id === e.id); if (i >= 0) { setEffects(i, 'layerBlur', v); setEffects(i, 'foundLayerBlur', true) } }} setFound={() => { }} found={() => e.foundLayerBlur} placeholder="Blur" />
                              </div>
                            </Show>
                          }>
                            <div class="flex flex-col gap-1.5">
                              <span class="text-[10px] font-medium text-slate-500">Drop shadow</span>
                              <div class="flex items-center gap-1.5">
                                <div class="relative shrink-0 w-5 h-5 rounded-sm border border-slate-200 overflow-hidden" style={{ background: e.color }}>
                                  <input type="color" value={e.color}
                                    onInput={(ev) => { const i = effects.findIndex(x => x.id === e.id); if (i >= 0) setEffects(i, 'color', ev.currentTarget.value) }}
                                    class="absolute inset-0 opacity-0 w-full h-full cursor-pointer" />
                                </div>
                                <input type="text" value={e.color}
                                  onInput={(ev) => { const i = effects.findIndex(x => x.id === e.id); if (i >= 0) setEffects(i, 'color', ev.currentTarget.value) }}
                                  class="font-mono flex-1 min-w-0 bg-transparent outline-none text-[11px] h-6 border-0 shadow-none" />
                                <DragInput value={() => e.opacity} setValue={(v) => { const i = effects.findIndex(x => x.id === e.id); if (i >= 0) setEffects(i, 'opacity', Math.max(0, Math.min(100, v))) }} setFound={() => { }} found={() => true} placeholder="100%" max={100} suffix="%" />
                              </div>
                              <DragInput value={() => e.blur} setValue={(v) => { const i = effects.findIndex(x => x.id === e.id); if (i >= 0) { setEffects(i, 'blur', v); setEffects(i, 'foundBlur', true) } }} setFound={() => { }} found={() => e.foundBlur} placeholder="Blur" />
                              <div class="flex items-center gap-1.5">
                                <DragInput value={() => e.offsetX} setValue={(v) => { const i = effects.findIndex(x => x.id === e.id); if (i >= 0) { setEffects(i, 'offsetX', v); setEffects(i, 'foundOffsetX', true) } }} setFound={() => { }} found={() => e.foundOffsetX} placeholder="X" />
                                <DragInput value={() => e.offsetY} setValue={(v) => { const i = effects.findIndex(x => x.id === e.id); if (i >= 0) { setEffects(i, 'offsetY', v); setEffects(i, 'foundOffsetY', true) } }} setFound={() => { }} found={() => e.foundOffsetY} placeholder="Y" />
                              </div>
                            </div>
                          </Show>
                        </div>
                        </Portal>
                      </Show>
                    </div>
                  )
                }}
              </For>
            </div>

            {/* <div class="flex items-center gap-2">
              <label class="text-xs font-medium text-slate-500 w-14 shrink-0">外边距</label>
              <EdgeInput label="上" value={editMt} found={foundMt} onValue={setEditMt} onFound={setFoundMt} />
              <EdgeInput label="右" value={editMr} found={foundMr} onValue={setEditMr} onFound={setFoundMr} />
              <EdgeInput label="下" value={editMb} found={foundMb} onValue={setEditMb} onFound={setFoundMb} />
              <EdgeInput label="左" value={editMl} found={foundMl} onValue={setEditMl} onFound={setFoundMl} />
            </div> */}

            {/* <div class="flex items-center gap-2">
              <label class="text-xs font-medium text-slate-500 w-14 shrink-0">圆角</label>
              <input type="text" inputmode="numeric" placeholder="-"
                value={foundRadius() ? String(editRadius()) : '-'}
                onInput={(e) => { setEditRadius(parseInt(e.currentTarget.value) || 0); setFoundRadius(true) }}
                class="property-number-input w-16" />
              <span class="text-xs text-slate-400">px</span>
              <div class="flex gap-1 ml-auto">
                <For each={[0, 4, 8, 12, 16, 999]}>
                  {(r) => (
                    <button onClick={() => { setEditRadius(r); setFoundRadius(true) }}
                      class={editRadius() === r ? 'prop-chip-active' : 'prop-chip'}>{r === 999 ? '圆' : r}</button>
                  )}
                </For>
              </div>
            </div> */}

            {/* <div class="flex items-center gap-2">
              <label class="text-xs font-medium text-slate-500 w-14 shrink-0">宽度</label>
              <input value={editWidth()} onInput={(e) => setEditWidth(e.currentTarget.value)}
                placeholder="auto / 100% / 300px" class="property-input flex-1" />
            </div> */}
          </Show>

          {/* <div class="border-t border-slate-100 pt-3">
            <label class="mb-1 block text-xs font-medium text-slate-500">历史标签</label>
            <input value={editTag()} onInput={(e) => setEditTag(e.currentTarget.value)}
              placeholder="输入标签以便回溯" class="property-input w-full" />
          </div> */}

        </div>
      </div>
    </Show>
  )
}

function DragInput(props: {
  value: () => number
  setValue: (v: number) => void
  setFound: (v: boolean) => void
  found: () => boolean
  placeholder: string
  direction?: 'vertical' | 'horizontal'
  min?: number
  max?: number
  icon?: string
  hasBorder?: boolean
  bg?: string
  class?: string
  flex1?: boolean
  suffix?: string
  display?: string
}) {
  const icon = props.icon ?? '◧'
  const isV = props.direction === 'vertical'
  const mn = props.min ?? 0
  const border = props.hasBorder ? 'border border-slate-200' : ''
  const bg = props.bg ?? 'bg-[#F4F4F5]'
  const flex = props.flex1 !== false ? 'flex-1' : ''
  return (
    <div class={`flex items-center rounded-sm ${border} focus-within:border-[#3D99FF] focus-within:ring-1 focus-within:ring-[#3D99FF] h-6 shadow-none ${bg} ${flex} min-w-0 ${props.class ?? ''}`}>
      <span onMouseDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
        const sc = isV ? e.clientY : e.clientX
        const sv = props.value()
        const overlay = document.createElement('div')
        overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;cursor:' + (isV ? 'ns-resize' : 'ew-resize')
        document.body.appendChild(overlay)
        const onMove = (me: MouseEvent) => {
          const cursor = isV ? me.clientY : me.clientX
          const d = Math.round(((isV ? sc - cursor : cursor - sc)) / 2)
          const v = Math.max(mn, sv + d)
          props.setValue(props.max != null ? Math.min(props.max, v) : v)
          props.setFound(true)
        }
        const onUp = () => {
          window.removeEventListener('mousemove', onMove)
          window.removeEventListener('mouseup', onUp)
          overlay.remove()
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
      }} class={`select-none ${isV ? 'cursor-ns-resize' : 'cursor-ew-resize'} text-slate-400 text-[10px] font-medium px-1.5 h-full flex items-center`}>{icon}</span>
      <input type="text" inputmode="numeric" placeholder={props.placeholder}
        value={props.display ?? (props.found() ? String(props.value()) + (props.suffix ?? '') : '')}
        onInput={(e) => { const v = Math.max(mn, parseInt(e.currentTarget.value) || 0); props.setValue(props.max != null ? Math.min(props.max, v) : v); props.setFound(true) }}
        class="placeholder:text-muted-foreground flex-1 min-w-0 bg-transparent outline-none text-[11px] pr-1 h-full border-0 shadow-none" />
    </div>
  )
}

function SettingsIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2">
      <rect x="3" y="1" width="10" height="3" rx=".5" />
      <rect x="3" y="12" width="10" height="3" rx=".5" />
      <rect x="1" y="3" width="3" height="10" rx=".5" />
      <rect x="12" y="3" width="3" height="10" rx=".5" />
    </svg>
  )
}

function EdgeInput(props: {
  label: string
  value: () => number
  found: () => boolean
  onValue: (v: number) => void
  onFound: (v: boolean) => void
}) {
  return (
    <>
      <span class="text-[10px] text-slate-400 shrink-0">{props.label}</span>
      <input type="text" inputmode="numeric" placeholder="-"
        value={props.found() ? String(props.value()) : '-'}
        onInput={(e) => { props.onValue(parseInt(e.currentTarget.value) || 0); props.onFound(true) }}
        class="property-number-input w-12" />
    </>
  )
}

function AlignIcon(props: { value: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="14" height="14">
      {props.value === 'left' && (
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 6h14M3 10h18M3 14h14M3 18h18" />
      )}
      {props.value === 'center' && (
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 6h14M3 10h18M5 14h14M3 18h18" />
      )}
      {props.value === 'right' && (
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 6h14M3 10h18M7 14h14M3 18h18" />
      )}
      {props.value === 'justify' && (
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 6h18M3 10h18M3 14h18M3 18h18" />
      )}
    </svg>
  )
}

function FreeformIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
      <rect width="7" height="9" x="1" y="1" rx="1" stroke="currentColor" stroke-width="1" />
      <rect width="7" height="5" x="1" y="11" rx="1" stroke="currentColor" stroke-width="1" />
      <rect width="7" height="5" x="9" y="1" rx="1" stroke="currentColor" stroke-width="1" />
      <rect width="7" height="9" x="9" y="7" rx="1" stroke="currentColor" stroke-width="1" />
    </svg>
  )
}

function RowIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 8H2M5 5l-3 3 3 3M11 11l3-3-3-3" />
    </svg>
  )
}

function ColIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M8 14V2M5 5l3-3 3 3M11 11l-3 3-3-3" />
    </svg>
  )
}

function HAlignIcon(props: { value: string }) {
  return (
    <svg width="14" height="10" viewBox="0 0 14 10" fill="currentColor">
      {props.value === 'left' && (
        <>
          <rect x="0" y="0" width="8" height="2" rx="0.5" />
          <rect x="0" y="4" width="14" height="2" rx="0.5" />
          <rect x="0" y="8" width="5" height="2" rx="0.5" />
        </>
      )}
      {props.value === 'center' && (
        <>
          <rect x="3" y="0" width="8" height="2" rx="0.5" />
          <rect x="0" y="4" width="14" height="2" rx="0.5" />
          <rect x="4" y="8" width="5" height="2" rx="0.5" />
        </>
      )}
      {props.value === 'right' && (
        <>
          <rect x="6" y="0" width="8" height="2" rx="0.5" />
          <rect x="0" y="4" width="14" height="2" rx="0.5" />
          <rect x="9" y="8" width="5" height="2" rx="0.5" />
        </>
      )}
      {props.value === 'justify' && (
        <>
          <rect x="0" y="0" width="14" height="2" rx="0.5" />
          <rect x="0" y="4" width="14" height="2" rx="0.5" />
          <rect x="0" y="8" width="14" height="2" rx="0.5" />
        </>
      )}
    </svg>
  )
}

function VAlignIcon(props: { value: string }) {
  return (
    <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
      {props.value === 'start' && (
        <>
          <rect x="0" y="0" width="10" height="2" rx="0.5" />
          <rect x="0" y="4" width="10" height="2" rx="0.5" />
          <rect x="0" y="8" width="6" height="2" rx="0.5" />
        </>
      )}
      {props.value === 'center' && (
        <>
          <rect x="0" y="1" width="10" height="2" rx="0.5" />
          <rect x="0" y="6" width="10" height="2" rx="0.5" />
          <rect x="0" y="11" width="6" height="2" rx="0.5" />
        </>
      )}
      {props.value === 'end' && (
        <>
          <rect x="0" y="2" width="10" height="2" rx="0.5" />
          <rect x="0" y="8" width="10" height="2" rx="0.5" />
          <rect x="0" y="12" width="6" height="2" rx="0.5" />
        </>
      )}
    </svg>
  )
}

function CustomSelect(props: {
  value: string
  options: { label: string; value: string }[]
  onChange: (value: string) => void
  class?: string
}) {
  const [open, setOpen] = createSignal(false)
  const [pos, setPos] = createSignal({ x: 0, y: 0, w: 0 })
  let btnRef!: HTMLButtonElement
  let listRef!: HTMLDivElement
  createEffect(() => {
    if (!open()) return
    const handler = (e: MouseEvent) => {
      if (listRef && !listRef.contains(e.target as Node) && !btnRef.contains(e.target as Node)) setOpen(false)
    }
    const onScroll = () => setOpen(false)
    if (btnRef) {
      const r = btnRef.getBoundingClientRect()
      setPos({ x: r.left, y: r.bottom + 4, w: r.width })
    }
    document.addEventListener('mousedown', handler)
    window.addEventListener('scroll', onScroll, true)
    onCleanup(() => {
      document.removeEventListener('mousedown', handler)
      window.removeEventListener('scroll', onScroll, true)
    })
  })
  const cls = () => props.class || ''
  return (
    <div class={`relative ${cls()}`}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen(!open())}
        class="flex items-center rounded-sm bg-[#F4F4F5] h-6 text-[11px] px-2 outline-none w-full border border-transparent hover:border-[#c9c9c9] focus:border-[#0067d1] focus:shadow-[0_0_0_1px_#8abef3] text-left"
      >
        <span class="flex-1 truncate">{props.options.find(o => o.value === props.value)?.label || props.value}</span>
        <svg class="w-3 h-3 ml-1 shrink-0 text-slate-400" viewBox="0 0 8 5" fill="none"><path d="M1 1L4 4L7 1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <Show when={open()}>
        <Portal mount={document.body}>
          <div ref={listRef} class="fixed z-[2147483646] py-1 rounded-lg border border-[#e5e7eb]"
            style={{ left: pos().x + 'px', top: pos().y + 'px', 'min-width': pos().w + 'px', background: '#fff', 'box-shadow': '0 10px 15px -3px rgba(0,0,0,0.08), 0 4px 6px -2px rgba(0,0,0,0.04)' }}
            onClick={() => setOpen(false)}>
            <For each={props.options}>
              {(opt) => (
                <div
                  onClick={() => props.onChange(opt.value)}
                  class="px-[10px] py-[6px] text-[12px] text-slate-700 bg-white hover:bg-[#f3f4f6] cursor-pointer whitespace-nowrap"
                  classList={{ 'bg-[#E6F2FD] text-primary font-medium': opt.value === props.value }}
                >
                  {opt.label}
                </div>
              )}
            </For>
          </div>
        </Portal>
      </Show>
    </div>
  )
}
