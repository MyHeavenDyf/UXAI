export interface FillData {
  color: string
  opacity: number
  visible: boolean
}

export interface StrokeData {
  color: string
  visible: boolean
  position: 'center' | 'inside' | 'outside'
  width: number
  widthTop: number
  widthRight: number
  widthBottom: number
  widthLeft: number
  foundWidth: boolean
  foundWidthTop: boolean
  foundWidthRight: boolean
  foundWidthBottom: boolean
  foundWidthLeft: boolean
  individualOpen: boolean
}

export interface EffectData {
  type: 'drop-shadow' | 'layer-blur' | 'background-blur'
  visible: boolean
  expanded: boolean
  color: string
  opacity: number
  blur: number
  offsetX: number
  offsetY: number
  foundBlur: boolean
  foundOffsetX: boolean
  foundOffsetY: boolean
  layerBlur: number
  foundLayerBlur: boolean
  bgBlur: number
  foundBgBlur: boolean
}

export function parseFillsFromRawCls(rawCls: string): FillData[] {
  const result: FillData[] = []
  for (const m of rawCls.matchAll(/\bbg-\[(#(?:[a-fA-F0-9]{3}|[a-fA-F0-9]{6}|[a-fA-F0-9]{8}))(?:\/(\d+))?\]/g)) {
    result.push({ color: m[1], opacity: m[2] ? Number(m[2]) : 100, visible: true })
  }
  return result
}

export function parseStrokesFromRawCls(rawCls: string): StrokeData[] {
  const result: StrokeData[] = []
  const strokeColors = [...rawCls.matchAll(/\bborder-\[(#(?:[a-fA-F0-9]{3}|[a-fA-F0-9]{6}|[a-fA-F0-9]{8}))\]/g)]
  for (const sm of strokeColors) {
    const swMatch = rawCls.match(/border-\[(\d+)px\]/)
    const hasIndiv = rawCls.includes('border-t-[') || rawCls.includes('border-r-[') || rawCls.includes('border-b-[') || rawCls.includes('border-l-[')
    const s: StrokeData = {
      color: sm[1], visible: true, position: 'center',
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
    result.push(s)
  }
  return result
}

export function parseEffectsFromRawCls(rawCls: string, skip: { shadow?: boolean; blur?: boolean; bgBlur?: boolean }): EffectData[] {
  const result: EffectData[] = []
  if (!skip.shadow) {
    for (const sm of rawCls.matchAll(/shadow-\[(-?\d+)px_(-?\d+)px_(\d+)px_((?:#[a-fA-F0-9]{6})[a-fA-F0-9]{2})\]/g)) {
      const color = sm[4].slice(0, 7)
      const alpha = parseInt(sm[4].slice(7), 16)
      result.push({
        type: 'drop-shadow', visible: true, expanded: false,
        color, opacity: Math.round(alpha / 2.55), blur: Number(sm[3]), offsetX: Number(sm[1]), offsetY: Number(sm[2]),
        foundBlur: true, foundOffsetX: true, foundOffsetY: true,
        layerBlur: 0, foundLayerBlur: false, bgBlur: 0, foundBgBlur: false,
      })
    }
  }
  if (!skip.blur) {
    for (const bm of rawCls.matchAll(/blur-\[(\d+)px\]/g)) {
      result.push({
        type: 'layer-blur', visible: true, expanded: false,
        color: '#000000', opacity: 100, blur: 0, offsetX: 0, offsetY: 0,
        foundBlur: false, foundOffsetX: false, foundOffsetY: false,
        layerBlur: Number(bm[1]), foundLayerBlur: true, bgBlur: 0, foundBgBlur: false,
      })
    }
  }
  if (!skip.bgBlur) {
    for (const bm of rawCls.matchAll(/backdrop-blur-\[(\d+)px\]/g)) {
      result.push({
        type: 'background-blur', visible: true, expanded: false,
        color: '#000000', opacity: 100, blur: 0, offsetX: 0, offsetY: 0,
        foundBlur: false, foundOffsetX: false, foundOffsetY: false,
        layerBlur: 0, foundLayerBlur: false, bgBlur: Number(bm[1]), foundBgBlur: true,
      })
    }
  }
  return result
}
