import { TW_FONT_SIZES, TW_FONT_WEIGHTS } from "./constants"
import { _px, _pxGap } from "./utils"

export interface ParsedClassInfo {
  fontSize: number
  fontWeight: number
  textAlign: string
  fontFamily: string
  lineHeight: string
  letterSpacing: number
  vAlign: string
  foundFontSize: boolean
  foundFontWeight: boolean
  pt: number
  pr: number
  pb: number
  pl: number
  mt: number
  mr: number
  mb: number
  ml: number
  borderRadius: number
  width: string
  widthPx: number
  heightPx: number
  opacity: number
  radiusTl: number
  radiusTr: number
  radiusBr: number
  radiusBl: number
  flexDir: string
  flexGap: number
  flexJustify: string
  flexAlignItems: string
  foundPt: boolean
  foundPr: boolean
  foundPb: boolean
  foundPl: boolean
  foundMt: boolean
  foundMr: boolean
  foundMb: boolean
  foundMl: boolean
  foundRadius: boolean
  foundFlexGap: boolean
  foundWidthPx: boolean
  foundHeightPx: boolean
  foundOpacity: boolean
  fillWidth: boolean
  fillHeight: boolean
  hugWidth: boolean
  hugHeight: boolean
  clipContent: boolean
  foundRadiusTl: boolean
  foundRadiusTr: boolean
  foundRadiusBr: boolean
  foundRadiusBl: boolean
}

export function parseClass(cls: string): { classes: string[]; info: ParsedClassInfo } {
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
  return {
    classes,
    info: {
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
    },
  }
}
