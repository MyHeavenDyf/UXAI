import { createEffect, createMemo, createSignal, onCleanup, Show, For, type Accessor, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import { createStore, reconcile } from "solid-js/store"
import { logStartSession, logAgentCall } from "../../../utils/debug-log"
import type { ElementRect, ContainerSize, ModifyElementData } from "./types"
import {
  TEXT_ELEMENTS, LABEL_MAP, COMPONENT_ENUMS, ENUM_DEFAULTS, COMPONENT_PROPS,
  TW_FONT_SIZES, FW_TO_TW,
  GRID_POSITIONS,
} from "./constants"
import { isTailwindToken, normalizeCssKeys, toHex } from "./utils"
import { parseClass, type ParsedClassInfo } from "./class-parser"
import { parseFillsFromRawCls, parseStrokesFromRawCls, parseEffectsFromRawCls } from "./raw-parsers"
import { DragInput } from "./drag-input"
import { CustomSelect } from "./custom-select"
import {
  SettingsIcon, FreeformIcon, RowIcon, ColIcon, HAlignIcon, VAlignIcon, BorderRadiusIcon,
  TopLeftBorderRadiusIcon, TopRightBorderRadiusIcon, BottomLeftBorderRadiusIcon, BottomRightBorderRadiusIcon,
  HorizontalPaddingIcon, VerticalPaddingIcon,
  LineHeightIcon, LetterSpacingIcon,
} from "./icons"

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
  const [initialPos, setInitialPos] = createStore({ right: 5, top: 50 })
  const [maxPopupH, setMaxPopupH] = createSignal(560)

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
  let baseCssVars: Record<string, string> = {}

  function getEnumOptions(key: string) {
    return COMPONENT_ENUMS[`${props.componentType}.${key}`] || []
  }

  function isBinding(key: string) {
    return `__bind_${key}` in rawProps
  }

  function splitCssList(value: string): string[] {
    const parts: string[] = []
    let depth = 0
    let current = ''
    for (const ch of value) {
      if (ch === '(') depth++
      else if (ch === ')') depth--
      if (ch === ',' && depth === 0) {
        parts.push(current.trim())
        current = ''
      } else {
        current += ch
      }
    }
    if (current.trim()) parts.push(current.trim())
    return parts
  }

  function parseSingleShadow(shadow: string) {
    const trimmed = shadow.trim()
    const colorMatch = trimmed.match(/((?:#[a-fA-F0-9]{3,8})|(?:rgba?\([^)]+\)))\s*$/)
    const color = colorMatch ? colorMatch[1] : '#000000'
    const valueStr = colorMatch ? trimmed.slice(0, colorMatch.index).trim() : trimmed
    const values = valueStr.split(/\s+/).map(v => parseFloat(v) || 0)
    return {
      color,
      offsetX: values[0] || 0,
      offsetY: values[1] || 0,
      blur: values[2] || 0,
    }
  }

  function calcInitPos() {
    return { right: 5, top: 50 }
  }

  function doParseClass(rawCls: string): ParsedClassInfo {
    const result = parseClass(rawCls)
    parsedClasses = result.classes
    return result.info
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
    const pushSpacing = (prefix: string, pairs: [Accessor<number>, string][]) => {
      const vals = pairs.map(([r]) => r())
      const same = new Set(vals).size === 1
      if (same) {
        const v = pairs[0][0]()
        if (!v) return
        parts.push(pv.includes(v) ? `${prefix}-${v / 4}` : `${prefix}-[${v}px]`)
        return
      }
      for (const [r, p] of pairs) {
        const v = r()
        if (!v) continue
        parts.push(pv.includes(v) ? `${p}-${v / 4}` : `${p}-[${v}px]`)
      }
    }
    pushSpacing('p', [[editPt, 'pt'], [editPr, 'pr'], [editPb, 'pb'], [editPl, 'pl']])
    pushSpacing('m', [[editMt, 'mt'], [editMr, 'mr'], [editMb, 'mb'], [editMl, 'ml']])
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
      } else if (parts.length === 2) {
        setEditMt(px(parts[0])); setEditMb(px(parts[0]))
        setEditMr(px(parts[1])); setEditMl(px(parts[1]))
        setFoundMt(true); setFoundMb(true); setFoundMr(true); setFoundMl(true)
        setMarginMode('hv')
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
      if (!v.justifyContent) setEditJustify('start')
      if (!v.alignItems) { setEditAlignItems('start'); setEditVAlign('start') }
    }
    if (v.gap) { setEditFlexGap(px(v.gap)); setFoundFlexGap(true) }
    if (v.justifyContent) {
      const j = v.justifyContent as string
      const m: Record<string, string> = { 'flex-start': 'start', 'flex-end': 'end', 'space-between': 'between', 'space-around': 'around' }
      setEditJustify(m[j] ?? j)
    }
    if (v.alignItems) {
      const a = v.alignItems as string
      const m: Record<string, string> = { 'flex-start': 'start', 'flex-end': 'end' }
      setEditAlignItems(m[a] ?? a)
      setEditVAlign(m[a] ?? a)
    }

    if (v.color) {
      const c = String(v.color)
      if (c.startsWith('#') || c.startsWith('rgb')) setEditTextColor(toHex(c))
    }
    if (v.backgroundColor) {
      const c = String(v.backgroundColor)
      if (c.startsWith('#') || c.startsWith('rgb')) setEditBgColor(toHex(c))
    }
    if (v.backgroundImage) {
      const m = String(v.backgroundImage).match(/url\(['"]?([^'"()]+)['"]?\)/)
      if (m) setEditBgUrl(m[1])
    }

    setFills([])
    setStrokes([])
    setEffects([])

    if (v.backgroundColor && v.backgroundColor !== 'transparent') {
      setFills([{ id: ++fillIdCounter, color: toHex(v.backgroundColor), opacity: 100, visible: true }])
    }

    if (v.borderColor) {
      const sw = v.borderWidth ? px(v.borderWidth) : 0
      const hasTop = !!v.borderTopWidth; const hasRight = !!v.borderRightWidth
      const hasBottom = !!v.borderBottomWidth; const hasLeft = !!v.borderLeftWidth
      const hasIndiv = hasTop || hasRight || hasBottom || hasLeft
      const s: typeof strokes[number] = {
        id: ++strokeIdCounter, color: toHex(v.borderColor), visible: true, position: 'center',
        width: sw, widthTop: 0, widthRight: 0, widthBottom: 0, widthLeft: 0,
        foundWidth: !!v.borderWidth, foundWidthTop: false, foundWidthRight: false, foundWidthBottom: false, foundWidthLeft: false,
        individualOpen: hasIndiv,
      }
      if (hasTop) { s.widthTop = px(v.borderTopWidth); s.foundWidthTop = true }
      if (hasRight) { s.widthRight = px(v.borderRightWidth); s.foundWidthRight = true }
      if (hasBottom) { s.widthBottom = px(v.borderBottomWidth); s.foundWidthBottom = true }
      if (hasLeft) { s.widthLeft = px(v.borderLeftWidth); s.foundWidthLeft = true }
      setStrokes([s])
    }

    if (v.boxShadow && v.boxShadow !== 'none') {
      const shadows = splitCssList(String(v.boxShadow))
      for (const shadow of shadows) {
        const parsed = parseSingleShadow(shadow)
        if (!parsed) continue
        const rgbaMatch = parsed.color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/)
        let opacity = 100
        let hexColor = parsed.color
        if (rgbaMatch) {
          opacity = Math.round(Number(rgbaMatch[4] ?? 1) * 100)
          hexColor = `#${Number(rgbaMatch[1]).toString(16).padStart(2, '0')}${Number(rgbaMatch[2]).toString(16).padStart(2, '0')}${Number(rgbaMatch[3]).toString(16).padStart(2, '0')}`
        } else if (parsed.color.length === 5 || parsed.color.length === 9) {
          const alphaHex = parsed.color.length === 5 ? parsed.color[4] + parsed.color[4] : parsed.color.slice(7, 9)
          opacity = Math.round((parseInt(alphaHex, 16) / 255) * 100)
        }
        if (parsed.offsetX === 0 && parsed.offsetY === 0 && parsed.blur === 0 && opacity === 0) continue
        setEffects([...effects, {
          id: ++effectIdCounter, type: 'drop-shadow', visible: true, expanded: false,
          color: hexColor, opacity, blur: parsed.blur, offsetX: parsed.offsetX, offsetY: parsed.offsetY,
          foundBlur: parsed.blur > 0, foundOffsetX: parsed.offsetX !== 0, foundOffsetY: parsed.offsetY !== 0,
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
    }

    if (!v.backgroundColor || v.backgroundColor === 'transparent') {
      for (const f of parseFillsFromRawCls(rawCls)) {
        setFills([...fills, { id: ++fillIdCounter, ...f }])
      }
    }
    if (!v.borderColor) {
      for (const s of parseStrokesFromRawCls(rawCls)) {
        setStrokes([...strokes, { id: ++strokeIdCounter, ...s }])
      }
    }
    for (const e of parseEffectsFromRawCls(rawCls, {
      shadow: !!(v.boxShadow && v.boxShadow !== 'none'),
      blur: !!v.filter,
      bgBlur: !!v.backdropFilter,
    })) {
      setEffects([...effects, { id: ++effectIdCounter, ...e }])
    }

    setEditText((parsed.value ?? '').toString())
    const bgUrl = v.backgroundImage ? '' : (parsed.backgroundImage || '').toString()
    if (bgUrl) {
      setEditBgUrl(bgUrl === 'none' ? '' : bgUrl)
      initialBgUrl = editBgUrl()
    } else if (v.backgroundImage) {
      initialBgUrl = editBgUrl()
    }

    syncComponentProps(parsed)
  }

  function applyParseClassFallback(rawCls: string, parsed: Record<string, unknown>) {
    const clsInfo = doParseClass(rawCls)

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
    setEditBgColor(bgcMatch ? '#' + bgcMatch[1] : toHex((parsed.backgroundColor || parsed.background || '').toString()))

    const bgUrlMatch = rawCls.match(/\bbg-\[url\(\/uploads\/([^)]+)\)\]/)
    const bgUrl = bgUrlMatch ? '/uploads/' + bgUrlMatch[1] : (parsed.backgroundImage || '').toString()
    setEditBgUrl(bgUrl === 'none' ? '' : bgUrl)
    initialBgUrl = editBgUrl()

    setEditPt(clsInfo.pt); setFoundPt(clsInfo.foundPt)
    setEditPr(clsInfo.pr); setFoundPr(clsInfo.foundPr)
    setEditPb(clsInfo.pb); setFoundPb(clsInfo.foundPb)
    setEditPl(clsInfo.pl); setFoundPl(clsInfo.foundPl)
    if (clsInfo.foundPt && clsInfo.foundPr && clsInfo.foundPb && clsInfo.foundPl) {
      if (clsInfo.pt === clsInfo.pr && clsInfo.pt === clsInfo.pb && clsInfo.pt === clsInfo.pl) setPaddingMode('all')
      else setPaddingMode('trbl')
    }
    setEditMt(clsInfo.mt); setFoundMt(clsInfo.foundMt)
    setEditMr(clsInfo.mr); setFoundMr(clsInfo.foundMr)
    setEditMb(clsInfo.mb); setFoundMb(clsInfo.foundMb)
    setEditMl(clsInfo.ml); setFoundMl(clsInfo.foundMl)
    if (clsInfo.foundMt && clsInfo.foundMr && clsInfo.foundMb && clsInfo.foundMl) {
      if (clsInfo.mt === clsInfo.mr && clsInfo.mt === clsInfo.mb && clsInfo.mt === clsInfo.ml) setMarginMode('all')
      else setMarginMode('trbl')
    }
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
    setEditJustify(clsInfo.flexJustify || (clsInfo.flexDir ? 'start' : ''))
    setEditAlignItems(clsInfo.flexAlignItems || (clsInfo.flexDir ? 'start' : ''))
    setEditBgImage(null)
    setEditTag('')

    setFills([])
    setStrokes([])
    setEffects([])
    for (const f of parseFillsFromRawCls(rawCls)) {
      setFills([...fills, { id: ++fillIdCounter, ...f }])
    }
    for (const s of parseStrokesFromRawCls(rawCls)) {
      setStrokes([...strokes, { id: ++strokeIdCounter, ...s }])
    }
    for (const e of parseEffectsFromRawCls(rawCls, {})) {
      setEffects([...effects, { id: ++effectIdCounter, ...e }])
    }

    syncComponentProps(parsed)
  }

  function syncComponentProps(parsed: Record<string, unknown>) {
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
  let apiCalled = false
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
    setPaddingMode('all'); setMarginMode('all'); setCornerOpen(false)
    setFills([])
    setStrokes([])
    setEffects([])
  }

  createEffect(() => {
    if (!props.show) {
      ready = false
      apiCalled = false
      clearTimeout(autoUpdateTimer)
      return
    }
    const rawCls = props.currentClass || ''
    parsedClasses = rawCls.split(/\s+/).filter(Boolean)
    let parsed: Record<string, unknown> = {}
    try { parsed = JSON.parse(props.elementProps || '{}') } catch { /* ignore */ }

    console.log("[PropertyEditor] open, original className:", rawCls)

    logStartSession(`quick-modify-${props.elementId}`, `修改元素 ${props.elementId} [${props.componentType}]`)

    if (!apiCalled) {
      apiCalled = true
      resetEditorSignals()
      setInitialPos('right', 5)
      setInitialPos('top', 50)
      setDragOffset({ x: 0, y: 0 })
      setEditBgImage(null)
      setEditTag('')

      const desktopApi = (window as unknown as { api?: { tailwindToCss?: (className: string) => Promise<Record<string, string>> } }).api
      const api = desktopApi?.tailwindToCss
      if (api) {
        logAgentCall('tailwindToCss', props.elementId, rawCls, null)
        api(rawCls).then(cssVars => {
          logStartSession(`quick-modify-${props.elementId}`, `修改元素 ${props.elementId} [${props.componentType}]`)
          console.log("[PropertyEditor] tailwind css vars:", cssVars)
          logAgentCall('tailwindToCss', props.elementId, rawCls, cssVars)
          if (cssVars && Object.keys(cssVars).length > 0) {
            baseCssVars = normalizeCssKeys(cssVars)
            applyCssVariables(cssVars, rawCls, parsed)
          } else {
            console.log("[PropertyEditor] fallback: api returned empty, using parseClass")
            applyParseClassFallback(rawCls, parsed)
            baseCssVars = buildCssObject()
          }
          if (!editBgColor()) {
            const f = fills.find(x => x.visible)
            if (f) setEditBgColor(toHex(f.color))
          }
          setDragOffset({ x: 0, y: 0 })
          ready = true
        })
      } else {
        console.log("[PropertyEditor] fallback: no tailwindToCss api, using parseClass")
        applyParseClassFallback(rawCls, parsed)
        baseCssVars = buildCssObject()
        if (!editBgColor()) {
          const f = fills.find(x => x.visible)
          if (f) setEditBgColor(f.color)
        }
        setDragOffset({ x: 0, y: 0 })
        ready = true
      }
    }
  })

  createEffect(() => {
    if (props.show) {
      requestAnimationFrame(() => {
        updateDims()
        setInitialPos(calcInitPos())
        setMaxPopupH(Math.max(200, props.containerSize.height - initialPos.top - 20))
      })
    }
  })

  createEffect(() => {
    if (!props.show) return
    const recalc = () => setMaxPopupH(Math.max(200, window.innerHeight - initialPos.top - 20))
    recalc()
    window.addEventListener('resize', recalc)
    onCleanup(() => window.removeEventListener('resize', recalc))
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
    'max-height': `${maxPopupH()}px`,
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

    if (editBgColor()) css['background-color'] = editBgColor()

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
    logStartSession(`quick-modify-${props.elementId}`, `修改元素 ${props.elementId} [${props.componentType}]`)
    let className = props.currentClass || ''
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
        const currentCss = buildCssObject()
        const keepParts = parsedClasses.filter(c => !isTailwindToken(c))
        const flexExtra = parsedClasses.filter(c =>
          c.startsWith('flex-') && !['flex-col', 'flex-row'].includes(c)
        ).join(' ')
        const newTailwind = await api(currentCss)
        console.log("[PropertyEditor] full cssToTailwind:", newTailwind)
        logAgentCall('cssToTailwind', props.elementId, currentCss, newTailwind)
        className = ((keepParts.join(' ') + ' ' + newTailwind).trim() + ' ' + flexExtra).trim()
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
    const beforeProps = (() => { try { return JSON.parse(props.elementProps || '{}') } catch { return {} } })()
    const changed: { prop: string; before: string; after: string }[] = []
    if (className !== props.currentClass) changed.push({ prop: 'className', before: props.currentClass ?? '', after: className })
    const beforeText = (beforeProps.value ?? '').toString()
    if (editText() !== beforeText) changed.push({ prop: 'textContent', before: beforeText, after: editText() })
    for (const key of Object.keys(componentProps)) {
      const bv = (beforeProps[key] ?? '').toString()
      if (componentProps[key] !== bv) changed.push({ prop: key, before: bv, after: componentProps[key] ?? '' })
    }
    logAgentCall('quick-modify', props.elementId, { className, componentProps, textContent: editText(), changed }, confirmData)
    props.onConfirm(confirmData)
  }

  type TrblInput = {
    value: Accessor<number>
    setValue: (v: number) => void
    setFound: (v: boolean) => void
    found: Accessor<boolean>
    placeholder: string
    icon?: string | JSX.Element
  }

  function renderTrblGrid(
    tl: TrblInput, tr: TrblInput, bl: TrblInput, br: TrblInput, hasSpacer?: boolean,
  ) {
    const row = (a: TrblInput, b: TrblInput) => (
      <div class="flex items-center gap-1.5 w-full min-w-0">
        <DragInput value={a.value} setValue={a.setValue} setFound={a.setFound} found={a.found} placeholder={a.placeholder} icon={a.icon} />
        <DragInput value={b.value} setValue={b.setValue} setFound={b.setFound} found={b.found} placeholder={b.placeholder} icon={b.icon} />
        {hasSpacer ? <div class="w-6 shrink-0" /> : null}
      </div>
    )
    return (
      <div class="flex flex-col gap-1.5 w-full min-w-0">
        {row(tl, tr)}
        {row(bl, br)}
      </div>
    )
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

        <div class="popup-body px-4 pb-2 flex flex-col gap-2">

          <Show when={isTextElement()}>
            <div class="flex gap-2 mt-2 flex-col">
              <label class="text-[12px] font-medium text-slate-500 w-14 shrink-0">文本内容</label>
              <div class="flex items-center rounded-sm focus-within:border-[#3D99FF] focus-within:ring-1 focus-within:ring-[#3D99FF] h-6 shadow-none bg-[#F4F4F5] w-full min-w-0">
                <input value={editText()}
                  onInput={(e) => setEditText(e.currentTarget.value)}
                  type="text" placeholder="输入文本..."
                  class="flex-1 min-w-0 bg-transparent outline-none text-[11px] px-2 h-full border-0 shadow-none" />
              </div>
            </div>
          </Show>

          <Show when={!isTextElement() && propKeys().filter(k => k !== 'className' || !hasClassEditor()).length > 0}>
            <div class="grid gap-2 py-2 min-w-0">
              <span class="text-[12px] font-medium text-slate-500">组件属性</span>
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
                class="flex items-center rounded-sm bg-[#F4F4F5] h-6 text-[12px] px-2 outline-none w-full focus:border-[#3D99FF] focus:ring-1 focus:ring-[#3D99FF] border border-transparent shadow-none" />
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
            <div class="text-[12px] text-slate-400 py-2">该组件暂不支持快速修改</div>
          </Show>

          <Show when={hasClassEditor()}>

            <div class="grid gap-2 py-2 border-slate-100 border-t -mx-4 px-4 border-[#e5e7eb]">
              <span class="text-[12px] font-medium text-slate-500">
                {editFlexDir() ? '弹性布局' : '布局'}
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
                    <div class="text-[12px] font-medium text-slate-500 mb-1">对齐</div>
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
                    <div class="text-[12px] text-slate-400 mb-1">间距</div>

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
                      <span class="text-[10px] text-slate-400">两端对齐</span>
                    </label>

                    <label class="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="justify-mode"
                        checked={editJustify() === 'around'}
                        onChange={() => setEditJustify('around')} />
                      <span class="text-[10px] text-slate-400">环绕分布</span>
                    </label>
                  </div>
                </div>
              </Show>
            </div>

            <div class="grid gap-2 py-2 border-slate-100 min-w-0 border-t -mx-4 px-4 border-[#e5e7eb]">
              <div class="flex items-center justify-between">
                <span class="text-[12px] font-medium text-slate-500">内边距</span>
                <div class="relative padding-dropdown-area">
                  <button onClick={() => setPaddingOpen(!paddingOpen())}
                    class="prop-chip h-5 w-5 p-0 flex items-center justify-center">
                    <span class="w-3 h-3"><SettingsIcon /></span>
                  </button>
                  <Show when={paddingOpen()}>
                    <div class="absolute right-0 top-full mt-1 z-[301] py-1 w-[100px]"
                      style={{ background: "#fff", border: "1px solid #e2e8f0", "border-radius": "6px", "box-shadow": "0 4px 12px rgba(0,0,0,0.15)" }}
                      onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => { setPaddingMode('all'); setPaddingOpen(false) }}
                        class="w-full text-left px-3 py-2 text-[12px] text-slate-700 hover:bg-[#F4F4F5]">
                        四周
                      </button>
                      <button onClick={() => { setPaddingMode('hv'); setPaddingOpen(false) }}
                        class="w-full text-left px-3 py-2 text-[12px] text-slate-700 hover:bg-[#F4F4F5]">
                        水平/垂直
                      </button>
                      <button onClick={() => { setPaddingMode('trbl'); setPaddingOpen(false) }}
                        class="w-full text-left px-3 py-2 text-[12px] text-slate-700 hover:bg-[#F4F4F5]">
                        上/右/下/左
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
                    found={foundPr} placeholder="水平" icon={HorizontalPaddingIcon()} />
                  <DragInput
                    value={editPt} setValue={(v) => { setEditPt(v); setEditPb(v) }}
                    setFound={(v) => { setFoundPt(v); setFoundPb(v) }}
                    found={foundPt} placeholder="垂直" icon={VerticalPaddingIcon()} />
                </div>
              </Show>
              <Show when={paddingMode() === 'trbl'}>
                {renderTrblGrid(
                  { value: editPt, setValue: setEditPt, setFound: setFoundPt, found: foundPt, placeholder: "上", icon: "↑" },
                  { value: editPr, setValue: setEditPr, setFound: setFoundPr, found: foundPr, placeholder: "右", icon: "→" },
                  { value: editPb, setValue: setEditPb, setFound: setFoundPb, found: foundPb, placeholder: "下", icon: "↓" },
                  { value: editPl, setValue: setEditPl, setFound: setFoundPl, found: foundPl, placeholder: "左", icon: "←" },
                )}
              </Show>

                            <div class="flex items-center justify-between">
                <span class="text-[12px] font-medium text-slate-500">外边距</span>
                <div class="relative margin-dropdown-area">
                  <button onClick={() => setMarginOpen(!marginOpen())}
                    class="prop-chip h-5 w-5 p-0 flex items-center justify-center">
                    <span class="w-3 h-3"><SettingsIcon /></span>
                  </button>
                  <Show when={marginOpen()}>
                    <div class="absolute right-0 top-full mt-1 z-[301] py-1 w-[100px]"
                      style={{ background: "#fff", border: "1px solid #e2e8f0", "border-radius": "6px", "box-shadow": "0 4px 12px rgba(0,0,0,0.15)" }}
                      onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => { setMarginMode('all'); setMarginOpen(false) }}
                        class="w-full text-left px-3 py-2 text-[12px] text-slate-700 hover:bg-[#F4F4F5]">
                        四周
                      </button>
                      <button onClick={() => { setMarginMode('hv'); setMarginOpen(false) }}
                        class="w-full text-left px-3 py-2 text-[12px] text-slate-700 hover:bg-[#F4F4F5]">
                        水平/垂直
                      </button>
                      <button onClick={() => { setMarginMode('trbl'); setMarginOpen(false) }}
                        class="w-full text-left px-3 py-2 text-[12px] text-slate-700 hover:bg-[#F4F4F5]">
                        上/右/下/左
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
                    found={foundMr} placeholder="水平" icon={HorizontalPaddingIcon()} />
                  <DragInput
                    value={editMt} setValue={(v) => { setEditMt(v); setEditMb(v) }}
                    setFound={(v) => { setFoundMt(v); setFoundMb(v) }}
                    found={foundMt} placeholder="垂直" icon={VerticalPaddingIcon()} />
                </div>
              </Show>
              <Show when={marginMode() === 'trbl'}>
                {renderTrblGrid(
                  { value: editMt, setValue: setEditMt, setFound: setFoundMt, found: foundMt, placeholder: "上", icon: "↑" },
                  { value: editMr, setValue: setEditMr, setFound: setFoundMr, found: foundMr, placeholder: "右", icon: "→" },
                  { value: editMb, setValue: setEditMb, setFound: setFoundMb, found: foundMb, placeholder: "下", icon: "↓" },
                  { value: editMl, setValue: setEditMl, setFound: setFoundMl, found: foundMl, placeholder: "左", icon: "←" },
                )}
              </Show>
            </div>

            {/* <div class="grid gap-2 py-2 border-slate-100 min-w-0">

            </div> */}

            <div class="grid gap-2 py-2 border-slate-100 min-w-0 border-t -mx-4 px-4 border-[#e5e7eb]">
              <span class="text-[12px] font-medium text-slate-500">宽高</span>
              <div class="flex items-center gap-1.5 w-full min-w-0">
                <DragInput value={editWidthPx} setValue={setEditWidthPx} setFound={setFoundWidthPx} found={foundWidthPx} placeholder="宽" icon="W" />
                <DragInput value={editHeightPx} setValue={setEditHeightPx} setFound={setFoundHeightPx} found={foundHeightPx} placeholder="高" icon="H" />
              </div>
              <div class="grid grid-cols-2 gap-x-2 gap-y-1">
                <label class="flex items-center gap-1 cursor-pointer">
                  <input type="checkbox" checked={fillWidth()} onChange={(e) => { setFillWidth(e.currentTarget.checked); if (e.currentTarget.checked) setHugWidth(false) }} />
                  <span class="text-[10px] text-slate-500">填充宽度</span>
                </label>
                <label class="flex items-center gap-1 cursor-pointer">
                  <input type="checkbox" checked={fillHeight()} onChange={(e) => { setFillHeight(e.currentTarget.checked); if (e.currentTarget.checked) setHugHeight(false) }} />
                  <span class="text-[10px] text-slate-500">填充高度</span>
                </label>
                <label class="flex items-center gap-1 cursor-pointer">
                  <input type="checkbox" checked={hugWidth()} onChange={(e) => { setHugWidth(e.currentTarget.checked); if (e.currentTarget.checked) setFillWidth(false) }} />
                  <span class="text-[10px] text-slate-500">适应宽度</span>
                </label>
                <label class="flex items-center gap-1 cursor-pointer">
                  <input type="checkbox" checked={hugHeight()} onChange={(e) => { setHugHeight(e.currentTarget.checked); if (e.currentTarget.checked) setFillHeight(false) }} />
                  <span class="text-[10px] text-slate-500">适应高度</span>
                </label>
                <label class="flex items-center gap-1 cursor-pointer col-span-2">
                  <input type="checkbox" checked={clipContent()} onChange={(e) => setClipContent(e.currentTarget.checked)} />
                  <span class="text-[10px] text-slate-500">裁剪内容</span>
                </label>
              </div>
            </div>

            <div class="grid gap-2 py-2 border-slate-100 min-w-0 border-t -mx-4 px-4 border-[#e5e7eb]">
              <span class="text-[12px] font-medium text-slate-500">外观</span>
              <div class="flex items-center gap-1.5 w-full min-w-0">
                <DragInput value={editOpacity} setValue={setEditOpacity} setFound={setFoundOpacity} found={foundOpacity} placeholder="透明度" max={100} suffix="%"  icon="%"/>
                <DragInput value={editRadius} setValue={setEditRadius} setFound={setFoundRadius} found={foundRadius} placeholder="圆角" display={cornerOpen() && (foundRadiusTl() || foundRadiusTr() || foundRadiusBr() || foundRadiusBl()) ? 'mixed' : undefined} icon={BorderRadiusIcon()} />
                <button onClick={() => setCornerOpen(!cornerOpen())}
                  class={cornerOpen() ? 'prop-chip-active h-6 w-6 p-0 flex items-center justify-center shrink-0' : 'prop-chip h-6 w-6 p-0 flex items-center justify-center shrink-0'}>
                  <span class="text-[10px]">◱</span>
                </button>
              </div>
              <Show when={cornerOpen()}>
                {renderTrblGrid(
                  { value: editRadiusTl, setValue: setEditRadiusTl, setFound: setFoundRadiusTl, found: foundRadiusTl, placeholder: "左上", icon: TopLeftBorderRadiusIcon() },
                  { value: editRadiusTr, setValue: setEditRadiusTr, setFound: setFoundRadiusTr, found: foundRadiusTr, placeholder: "右上", icon: TopRightBorderRadiusIcon() },
                  { value: editRadiusBl, setValue: setEditRadiusBl, setFound: setFoundRadiusBl, found: foundRadiusBl, placeholder: "左下", icon: BottomLeftBorderRadiusIcon() },
                  { value: editRadiusBr, setValue: setEditRadiusBr, setFound: setFoundRadiusBr, found: foundRadiusBr, placeholder: "右下", icon: BottomRightBorderRadiusIcon() },
                  true,
                )}
              </Show>
            </div>

            <div class="flex items-center gap-2  pt-2  border-t -mx-4 px-4 border-[#e5e7eb]">
              <label class="text-[12px] font-medium text-slate-500 w-14 shrink-0">背景色</label>
              <input type="color" value={editBgColor()} onInput={(e) => setEditBgColor(e.currentTarget.value)}
                class="w-5 h-5 rounded cursor-pointer p-0" />
              <button onClick={openBgPicker} class="hidden text-xs px-1.5 py-0.5 rounded-sm border border-slate-200 text-slate-500 hover:border-slate-400 hover:bg-slate-50 whitespace-nowrap">{/* ImageUploadIcon hidden */}</button>
              <Show when={(editBgUrl() && editBgUrl() !== 'none') || editBgImage()?.name}>
                <span class="text-[10px] text-slate-500 truncate flex-1">{editBgImage()?.name || editBgUrl()}</span>
              </Show>
              <Show when={editBgImage() || (editBgUrl() && editBgUrl() !== 'none')}>
                <button onClick={() => { setEditBgImage(null); setEditBgUrl('') }} class="text-xs text-slate-400 hover:text-slate-600">✕</button>
              </Show>
            </div>

            <div class="grid gap-2 py-2 border-slate-100 min-w-0 border-t -mx-4 px-4 border-[#e5e7eb]">
              <span class="text-[12px] font-medium text-slate-500">文字</span>
              <div class="flex items-center gap-1.5 w-full min-w-0">
                <span class="text-[10px] text-slate-400 w-8 shrink-0">字体</span>
                <CustomSelect
                  value={editFontFamily()}
                  options={[{ label: 'Default', value: '' }, { label: 'Sans', value: 'sans' }, { label: 'Serif', value: 'serif' }, { label: 'Mono', value: 'mono' }]}
                  onChange={(v) => setEditFontFamily(v)}
                />
              </div>
              <div class="flex items-center gap-1.5 w-full min-w-0">
                <span class="text-[10px] text-slate-400 w-8 shrink-0">字重</span>
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
              </div>
              <div class="flex items-center gap-1.5 w-full min-w-0">
                <span class="text-[10px] text-slate-400 w-8 shrink-0">字号</span>
                <DragInput value={editFontSize} setValue={setEditFontSize} setFound={() => { }} found={() => true} placeholder="字号" icon={"S"} />
              </div>

              <div class="flex items-center gap-2">
                <label class="text-[10px] font-medium text-slate-500 shrink-0">文字色</label>
                <div class="flex items-center gap-2 flex-1">
                  <input type="color" value={editTextColor()} onInput={(e) => setEditTextColor(e.currentTarget.value)}
                    class="w-5 h-5 rounded cursor-pointer p-0" />
                  <span class="text-[10px] text-slate-400">{editTextColor() || '继承'}</span>
                  <Show when={editTextColor()}>
                    <button onClick={() => setEditTextColor('')} class="text-[10px] text-slate-400 hover:text-slate-600 ml-auto">清除</button>
                  </Show>
                </div>
              </div>

              <div class="flex items-center gap-1.5 w-full min-w-0">
                <div class="flex flex-col gap-0.5 flex-1 min-w-0">
                  <span class="text-[10px] text-slate-400">行高</span>
                  <DragInput value={() => editLineHeight() === 'auto' ? 0 : Number(editLineHeight()) || 0} setValue={(v) => setEditLineHeight(String(v))} setFound={() => { }} found={() => editLineHeight() !== '' && editLineHeight() !== 'auto'} placeholder="auto" flex1={false} icon={LineHeightIcon()} />
                </div>
                <div class="flex flex-col gap-0.5 flex-1 min-w-0">
                  <span class="text-[10px] text-slate-400">字间距</span>
                  <DragInput value={editLetterSpacing} setValue={setEditLetterSpacing} setFound={() => { }} found={() => true} placeholder="0" flex1={false} icon={LetterSpacingIcon()} />
                </div>
              </div>
              <div class="flex items-start gap-2 w-full min-w-0">
                <div class="flex flex-col gap-0.5 flex-4 min-w-0">
                  <span class="text-[10px] text-slate-400">水平对齐</span>
                  <div class="flex gap-0.5 rounded-[6px] bg-[#E4E4E7] p-[1px]">
                    {(['left', 'center', 'right', 'justify'] as const).map(a => (
                      <button onClick={() => setEditAlign(a === editAlign() ? '' : a)} title={{ left: '左对齐', center: '居中', right: '右对齐', justify: '两端' }[a]}
                        class={editAlign() === a ? 'prop-chip-active h-5 flex-1 flex items-center justify-center p-0' : 'prop-chip h-5 flex-1 flex items-center justify-center p-0'}>
                        <HAlignIcon value={a} />
                      </button>
                    ))}
                  </div>
                </div>
                <div class="flex flex-col gap-0.5 flex-3 min-w-0">
                  <span class="text-[10px] text-slate-400">垂直对齐</span>
                  <div class="flex gap-0.5 rounded-[6px] bg-[#E4E4E7] p-[1px]">
                    {(['start', 'center', 'end'] as const).map(a => (
                      <button onClick={() => setEditVAlign(a === editVAlign() ? '' : a)} title={{ start: '顶部对齐', center: '居中', end: '底部对齐' }[a]}
                        class={editVAlign() === a ? 'prop-chip-active h-5 flex-1 flex items-center justify-center p-0' : 'prop-chip h-5 flex-1 flex items-center justify-center p-0'}>
                        <VAlignIcon value={a} />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div class="grid gap-2 pt-2 border-slate-100 min-w-0 border-t -mx-4 px-4 border-[#e5e7eb]">
              <div class="flex items-center justify-between">
                <span class="text-[12px] font-medium text-slate-500">描边</span>
                <button onClick={() => { setStrokes([...strokes, { id: ++strokeIdCounter, color: '#000000', visible: true, position: 'center', width: 1, widthTop: 0, widthRight: 0, widthBottom: 0, widthLeft: 0, foundWidth: false, foundWidthTop: false, foundWidthRight: false, foundWidthBottom: false, foundWidthLeft: false, individualOpen: false }]) }}
                  class="prop-chip h-5 w-5 p-0 flex items-center justify-center">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3v10M3 8h10" /></svg>
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
                          <span class="text-[12px] text-slate-600 font-mono">{s.color}</span>
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
                          options={[{ label: '居中', value: 'center' }, { label: '内部', value: 'inside' }, { label: '外部', value: 'outside' }]}
                          onChange={(v) => { const i = strokes.findIndex(x => x.id === s.id); if (i >= 0) setStrokes(i, 'position', v as 'center' | 'inside' | 'outside') }}
                        />
                        <DragInput value={() => s.width} setValue={(v) => { const i = strokes.findIndex(x => x.id === s.id); if (i >= 0) { setStrokes(i, 'width', v); setStrokes(i, 'foundWidth', true) } }} setFound={() => { }} found={() => s.foundWidth} placeholder="宽度" display={s.individualOpen && (s.foundWidthTop || s.foundWidthRight || s.foundWidthBottom || s.foundWidthLeft) ? 'mixed' : undefined} />
                        <button onClick={() => { const i = strokes.findIndex(x => x.id === s.id); if (i >= 0) setStrokes(i, 'individualOpen', !strokes[i].individualOpen) }}
                          class={s.individualOpen ? 'prop-chip-active h-6 w-6 p-0 flex items-center justify-center shrink-0' : 'prop-chip h-6 w-6 p-0 flex items-center justify-center shrink-0'}>
                          <span class="text-[10px]">◱</span>
                        </button>
                      </div>
                      <Show when={s.individualOpen}>
                        {renderTrblGrid(
                          { value: () => s.widthTop, setValue: (v) => { const i = strokes.findIndex(x => x.id === s.id); if (i >= 0) { setStrokes(i, 'widthTop', v); setStrokes(i, 'foundWidthTop', true) } }, setFound: () => { }, found: () => s.foundWidthTop, placeholder: "上" },
                          { value: () => s.widthRight, setValue: (v) => { const i = strokes.findIndex(x => x.id === s.id); if (i >= 0) { setStrokes(i, 'widthRight', v); setStrokes(i, 'foundWidthRight', true) } }, setFound: () => { }, found: () => s.foundWidthRight, placeholder: "右" },
                          { value: () => s.widthBottom, setValue: (v) => { const i = strokes.findIndex(x => x.id === s.id); if (i >= 0) { setStrokes(i, 'widthBottom', v); setStrokes(i, 'foundWidthBottom', true) } }, setFound: () => { }, found: () => s.foundWidthBottom, placeholder: "下" },
                          { value: () => s.widthLeft, setValue: (v) => { const i = strokes.findIndex(x => x.id === s.id); if (i >= 0) { setStrokes(i, 'widthLeft', v); setStrokes(i, 'foundWidthLeft', true) } }, setFound: () => { }, found: () => s.foundWidthLeft, placeholder: "左" },
                          true,
                        )}
                      </Show>
                    </>
                  )
                }}
              </For>
            </div>

            <div class="grid gap-2 pt-2 border-slate-100 min-w-0 border-t -mx-4 px-4 border-[#e5e7eb]">
              <div class="flex items-center justify-between">
                <span class="text-[12px] font-medium text-slate-500">效果</span>
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
                          options={[{ label: '阴影', value: 'drop-shadow' }, { label: '模糊', value: 'layer-blur' }, { label: '背景模糊', value: 'background-blur' }]}
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
                                  <span class="text-[12px] font-medium text-slate-500">背景模糊</span>
                                  <DragInput value={() => e.bgBlur} setValue={(v) => { const i = effects.findIndex(x => x.id === e.id); if (i >= 0) { setEffects(i, 'bgBlur', v); setEffects(i, 'foundBgBlur', true) } }} setFound={() => { }} found={() => e.foundBgBlur} placeholder="模糊值" />
                                </div>
                              }>
                                <div class="flex flex-col gap-1.5">
                                  <span class="text-[12px] font-medium text-slate-500">模糊</span>
                                  <DragInput value={() => e.layerBlur} setValue={(v) => { const i = effects.findIndex(x => x.id === e.id); if (i >= 0) { setEffects(i, 'layerBlur', v); setEffects(i, 'foundLayerBlur', true) } }} setFound={() => { }} found={() => e.foundLayerBlur} placeholder="模糊值" />
                                </div>
                              </Show>
                            }>
                              <div class="flex flex-col gap-1.5">
                                <span class="text-[12px] font-medium text-slate-500">阴影</span>
                                <div class="flex items-center gap-1.5">
                                  <div class="relative shrink-0 w-5 h-5 rounded-sm border border-slate-200 overflow-hidden" style={{ background: e.color }}>
                                    <input type="color" value={e.color}
                                      onInput={(ev) => { const i = effects.findIndex(x => x.id === e.id); if (i >= 0) setEffects(i, 'color', ev.currentTarget.value) }}
                                      class="absolute inset-0 opacity-0 w-full h-full cursor-pointer" />
                                  </div>
                                  <input type="text" value={e.color}
                                    onInput={(ev) => { const i = effects.findIndex(x => x.id === e.id); if (i >= 0) setEffects(i, 'color', ev.currentTarget.value) }}
                                    class="font-mono flex-1 min-w-0 bg-transparent outline-none text-[12px] h-6 border-0 shadow-none" />
                                  <DragInput value={() => e.opacity} setValue={(v) => { const i = effects.findIndex(x => x.id === e.id); if (i >= 0) setEffects(i, 'opacity', Math.max(0, Math.min(100, v))) }} setFound={() => { }} found={() => true} placeholder="100%" max={100} suffix="%" />
                                </div>
                                <DragInput value={() => e.blur} setValue={(v) => { const i = effects.findIndex(x => x.id === e.id); if (i >= 0) { setEffects(i, 'blur', v); setEffects(i, 'foundBlur', true) } }} setFound={() => { }} found={() => e.foundBlur} placeholder="模糊值" />
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
          </Show>

        </div>
      </div>
    </Show>
  )
}
