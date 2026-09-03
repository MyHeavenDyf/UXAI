export type ManualEditKind = 'text' | 'link' | 'image' | 'container' | 'token' | 'mixed'

export interface ManualEditRect {
  x: number
  y: number
  width: number
  height: number
}

export interface ManualEditFields {
  text?: string
  href?: string
  src?: string
  alt?: string
}

export type EffectType = 'drop-shadow' | 'layer-blur' | 'background-blur'

export interface EffectEntry {
  id: string
  type: EffectType
  visible: boolean
  expanded: boolean
  color: string
  opacity: number
  blur: number
  offsetX: number
  offsetY: number
  layerBlur: number
  bgBlur: number
  foundBlur: boolean
  foundOffsetX: boolean
  foundOffsetY: boolean
  foundLayerBlur: boolean
  foundBgBlur: boolean
}

export interface ManualEditStyles {
  fontFamily: string
  fontSize: string
  fontWeight: string
  color: string
  textAlign: string
  lineHeight: string
  letterSpacing: string
  width: string
  height: string
  minHeight: string
  gap: string
  flexDirection: string
  justifyContent: string
  alignItems: string
  backgroundColor: string
  opacity: string
  padding: string
  paddingTop: string
  paddingRight: string
  paddingBottom: string
  paddingLeft: string
  margin: string
  marginTop: string
  marginRight: string
  marginBottom: string
  marginLeft: string
  border: string
  borderTopWidth: string
  borderRightWidth: string
  borderBottomWidth: string
  borderLeftWidth: string
  borderStyle: string
  borderColor: string
  borderRadius: string
  boxShadow: string
  filter: string
  backdropFilter: string
  backgroundImage: string
  overflow: string
  borderTopLeftRadius: string
  borderTopRightRadius: string
  borderBottomRightRadius: string
  borderBottomLeftRadius: string
  verticalAlign: string
  effects: EffectEntry[]
}

export interface ManualEditTarget {
  id: string
  kind: ManualEditKind
  label: string
  tagName: string
  className: string
  text: string
  rect: ManualEditRect
  fields: ManualEditFields
  attributes: Record<string, string>
  styles: ManualEditStyles
  selector: string
  htmlHint: string
  isLayoutContainer: boolean
  outerHtml: string
}

export type ManualEditPatch =
  | { id: string; kind: 'set-text'; value: string }
  | { id: string; kind: 'set-link'; text: string; href: string }
  | { id: string; kind: 'set-image'; src: string; alt: string }
  | { id: string; kind: 'remove-element' }
  | { id: string; kind: 'set-style'; styles: Partial<ManualEditStyles> }
  | { id: string; kind: 'set-attributes'; attributes: Record<string, string> }
  | { id: string; kind: 'set-outer-html'; html: string }
  | { kind: 'set-full-source'; source: string }

export interface ManualEditPatchResult {
  ok: boolean
  source: string
  error?: string
}

// CSS 字符串字段(可写入 inline style 的属性);排除 effects(数组,非 CSS 属性)。
export type ManualEditCssKey = Exclude<keyof ManualEditStyles, 'effects'>

export const MANUAL_EDIT_STYLE_PROPS: readonly ManualEditCssKey[] = [
  'fontFamily', 'fontSize', 'fontWeight', 'color', 'textAlign', 'lineHeight', 'letterSpacing',
  'width', 'height', 'minHeight',
  'gap', 'flexDirection', 'justifyContent', 'alignItems',
  'backgroundColor', 'opacity',
  'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'border', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderStyle', 'borderColor', 'borderRadius',
  'boxShadow', 'filter', 'backdropFilter', 'backgroundImage',
  'overflow',
  'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius',
  'verticalAlign',
]

export function emptyManualEditStyles(): ManualEditStyles {
  const styles = MANUAL_EDIT_STYLE_PROPS.reduce<ManualEditStyles>((acc, key) => {
    acc[key] = ''
    return acc
  }, {} as ManualEditStyles)
  styles.effects = []
  return styles
}

export function applyManualEditPatch(source: string, patch: ManualEditPatch): ManualEditPatchResult {
  if (patch.kind === 'set-full-source') return { ok: true, source: patch.source }

  const doc = parseSource(source)
  if (!doc) return { ok: false, source, error: 'Could not parse source.' }

  const el = findEditableElement(doc, patch.id)
  if (!el) return { ok: false, source, error: `Target not found: ${patch.id}` }

  if (patch.kind === 'set-text') {
    const kind = inferKind(el)
    
    if (kind === 'mixed') {
      // Smart edit: only modify direct text nodes, preserve child elements
      setMixedContainerText(el, patch.value)
    } else if (hasElementChildren(el)) {
      return { ok: false, source, error: 'This element contains nested markup. Use the HTML tab instead.' }
    } else {
      el.textContent = patch.value
    }
  } else if (patch.kind === 'set-link') {
    if (hasElementChildren(el)) {
      const currentText = el.textContent?.trim() ?? ''
      if (patch.text.trim() !== currentText) {
        return { ok: false, source, error: 'This link contains nested markup. Use the HTML tab to change its label.' }
      }
    } else {
      el.textContent = patch.text
    }
    el.setAttribute('href', patch.href)
  } else if (patch.kind === 'set-image') {
    el.setAttribute('src', patch.src)
    el.setAttribute('alt', patch.alt)
  } else if (patch.kind === 'set-style') {
    setInlineStyles(el as HTMLElement, stripNonCssStyles(patch.styles))
  } else if (patch.kind === 'set-attributes') {
    setAttributes(el, patch.attributes)
  } else if (patch.kind === 'set-outer-html') {
    const replaced = replaceOuterHtml(doc, el, patch.html)
    if (!replaced.ok) return { ok: false, source, error: replaced.error }
  } else if (patch.kind === 'remove-element') {
    if (!el.parentElement) {
      return { ok: false, source, error: 'Cannot remove the root element.' }
    }
    if (el.parentElement === doc.body && doc.body.children.length === 1) {
      return { ok: false, source, error: 'Cannot remove the last element in the document.' }
    }
    el.remove()
  }

  return { ok: true, source: serializeSource(doc, source) }
}

export function readManualEditFields(source: string, id: string): ManualEditFields {
  const doc = parseSource(source)
  const el = doc ? findEditableElement(doc, id) : null
  if (!el) return {}
  const kind = inferKind(el)
  if (kind === 'link') {
    return {
      text: el.textContent?.trim() ?? '',
      href: el.getAttribute('href') ?? '',
    }
  }
  if (kind === 'image') {
    return {
      src: el.getAttribute('src') ?? '',
      alt: el.getAttribute('alt') ?? '',
    }
  }
  if (kind === 'mixed') {
    // Only extract direct text nodes, exclude nested element text
    const textParts: string[] = []
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
        textParts.push(node.textContent.trim())
      }
    }
    return { text: textParts.join(' ') }
  }
  return { text: el.textContent?.trim() ?? '' }
}

// 面板里当单值用的简写 key:inline 只设 top longhand(如 `border-top: 11px solid ...`)时,
// `style['borderStyle']` / `style['borderColor']` 简写访问器返回空,fallback 到 top longhand。
const SHORTHAND_LONGHAND_FALLBACK: Partial<Record<ManualEditCssKey, string>> = {
  borderStyle: 'border-top-style',
  borderColor: 'border-top-color',
}

export function readManualEditStyles(source: string, id: string): ManualEditStyles {
  const doc = parseSource(source)
  const el = doc ? findEditableElement(doc, id) : null
  if (!el) return emptyManualEditStyles()
  const style = (el as HTMLElement).style
  // 用 getPropertyValue 作为 camelCase 访问器的 fallback:
  // Chrome 序列化 cssText 时会把 longhand 合并成简写(如 `border-top: 11px solid ...`),
  // 此时 `style['borderTopWidth']` 返回空,但 `getPropertyValue('border-top-width')`
  // 能从简写解析出 longhand 值。borderStyle/borderColor 是简写 key,
  // inline 只设 border-top 时简写访问器也返回空,fallback 到 top longhand。
  const styles = MANUAL_EDIT_STYLE_PROPS.reduce<ManualEditStyles>((acc, key) => {
    const direct = style[key as unknown as keyof CSSStyleDeclaration] as string | undefined
    const kebab = camelToKebab(key)
    const fallback = SHORTHAND_LONGHAND_FALLBACK[key]
    acc[key] = direct
      || style.getPropertyValue(kebab)
      || (fallback ? style.getPropertyValue(fallback) : '')
      || ''
    return acc
  }, {} as ManualEditStyles)
  expandRadiusShorthandIntoLonghands(styles)
  styles.effects = parseEffects(styles.boxShadow, styles.filter, styles.backdropFilter)
  return styles
}

// 解析 border-radius shorthand 字符串为 4 个 longhand 值。
// "8px" → [8,8,8,8];"5px 8px" → [5,8,5,8](tl,tr,bl,br → tl=5,tr=8,br=5,bl=8 实际语义);
// "5px 8px 10px" → tl=5,tr=8,br=10,bl=8;"5px 8px 10px 12px" → tl=5,tr=8,br=10,bl=12。
function parseBorderRadiusShorthand(value: string): { tl: string; tr: string; br: string; bl: string } | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  // 椭圆语法(x y / x y)不支持拆解,返回 null 走原样写入路径
  if (trimmed.includes('/')) return null
  const parts = trimmed.split(/\s+/)
  if (parts.length === 0) return null
  if (parts.length === 1) return { tl: parts[0], tr: parts[0], br: parts[0], bl: parts[0] }
  if (parts.length === 2) return { tl: parts[0], tr: parts[1], br: parts[0], bl: parts[1] }
  if (parts.length === 3) return { tl: parts[0], tr: parts[1], br: parts[2], bl: parts[1] }
  return { tl: parts[0], tr: parts[1], br: parts[2], bl: parts[3] }
}

// 若 inline 只有 border-radius shorthand 而 4 个 longhand 为空,把 shorthand 展开到 longhand,
// 让 UI 4 角面板能显示当前值。inline 既设 shorthand 又设 longhand 时,直接用 longhand 值。
function expandRadiusShorthandIntoLonghands(styles: ManualEditStyles): void {
  const shorthand = styles.borderRadius
  if (!shorthand) return
  const hasAnyLonghand = RADIUS_LONGHAND_KEYS.some(k => styles[k])
  if (hasAnyLonghand) return
  const parsed = parseBorderRadiusShorthand(shorthand)
  if (!parsed) return
  styles.borderTopLeftRadius = parsed.tl
  styles.borderTopRightRadius = parsed.tr
  styles.borderBottomRightRadius = parsed.br
  styles.borderBottomLeftRadius = parsed.bl
}

export function readManualEditAttributes(source: string, id: string): Record<string, string> {
  const doc = parseSource(source)
  const el = doc ? findEditableElement(doc, id) : null
  if (!el) return {}
  const attrs: Record<string, string> = {}
  Array.from(el.attributes).forEach((attr) => {
    if (attr.name === 'data-od-runtime-id') return
    attrs[attr.name] = attr.value
  })
  return attrs
}

export function readManualEditOuterHtml(source: string, id: string): string {
  const doc = parseSource(source)
  return (doc ? findEditableElement(doc, id)?.outerHTML : '') ?? ''
}

export function inspectorManualEditStyles(target: ManualEditTarget, baseSource: string): ManualEditStyles {
  const inlineStyles = readManualEditStyles(baseSource, target.id)
  return mergeManualEditInspectorStyles(inlineStyles, target.styles)
}

// border-width longhand 会被浏览器 snap 到设备像素后再换算回 CSS px
// (如 DPR=1.25 时 10px → round(12.5)=12 → 12/1.25=9.6px)。
// 这几个 key 用 computed(iframe 报的 target.styles)回填时,round 到整数消除 snap 漂移。
const BORDER_WIDTH_LONGHAND_KEYS = new Set<ManualEditCssKey>([
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
])

function mergeManualEditInspectorStyles(
  sourceStyles: ManualEditStyles,
  previewStyles: ManualEditStyles,
): ManualEditStyles {
  // border-style=none 时 computed 的 border-width 强制为 0,但实际 inline width 还在。
  // 这种情况不用 computed 的 0,留空让用户切回 solid 时从源/pending 重读。
  const borderStyleNone = /^(none)$/i.test(previewStyles.borderStyle?.trim() || '')
  const acc = MANUAL_EDIT_STYLE_PROPS.reduce<ManualEditStyles>((acc, key) => {
    const sourceValue = sourceStyles[key]?.trim()
    const isBorderWidthLonghand = BORDER_WIDTH_LONGHAND_KEYS.has(key)
    // border-style=none 时,border-width longhand 不用 computed(会是 0)
    const previewValue = (borderStyleNone && isBorderWidthLonghand)
      ? ''
      : (previewStyles[key]?.trim() || '')
    const value = sourceValue || previewValue || ''
    acc[key] = manualEditInspectorStyleValue(key, value, !sourceValue)
    return acc
  }, {} as ManualEditStyles)
  acc.effects = previewStyles.effects ?? []
  return acc
}

function manualEditInspectorStyleValue(
  key: ManualEditCssKey,
  value: string,
  fromComputed: boolean,
): string {
  if (!value) return ''
  if (key === 'color' || key === 'backgroundColor' || key === 'borderColor') {
    return normalizeManualEditInspectorColor(value)
  }
  // border-width longhand 来自 computed 时,round 到整数消除设备像素 snap 漂移。
  // 源里有 inline 的不 round(用户输入的值原样保留)。
  if (fromComputed && BORDER_WIDTH_LONGHAND_KEYS.has(key)) {
    return roundBorderWidthValue(value)
  }
  return value
}

function roundBorderWidthValue(value: string): string {
  const match = value.match(/^(-?\d+(?:\.\d+)?)px$/i)
  if (!match) return value
  const rounded = Math.round(parseFloat(match[1]))
  return `${rounded}px`
}

// rgb()/rgba() 字符串 → hex(#RRGGBB / #RRGGBBAA);alpha=0 返回 ''(透明,等价于清除)。
// 重开面板时颜色值来自 computed styles(rgb() 格式),统一规范成 hex 后
// ColorPicker 的 displayLabel() 才能用 hex 对 hex 反查出 token 名。
function rgbStringToHex(value: string): string | null {
  const m = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i)
  if (!m) return null
  const toHex = (n: number) => n.toString(16).padStart(2, '0')
  let hex = `#${toHex(parseInt(m[1]))}${toHex(parseInt(m[2]))}${toHex(parseInt(m[3]))}`
  if (m[4] !== undefined) {
    const alpha = parseFloat(m[4])
    if (alpha <= 0) return ''
    if (alpha < 1) hex += Math.round(alpha * 255).toString(16).padStart(2, '0')
  }
  return hex.toLowerCase()
}

function normalizeManualEditInspectorColor(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(trimmed)) return trimmed.toLowerCase()
  const hex = rgbStringToHex(trimmed)
  return hex ?? trimmed
}

function parseSource(source: string): Document | null {
  if (typeof DOMParser !== 'undefined') {
    return new DOMParser().parseFromString(source, 'text/html')
  }
  if (typeof document !== 'undefined') {
    const doc = document.implementation.createHTMLDocument('')
    doc.documentElement.innerHTML = source
    return doc
  }
  return null
}

function serializeSource(doc: Document, originalSource: string): string {
  if (!isManualEditFullHtmlDocument(originalSource)) return doc.body.innerHTML
  return `<!doctype html>\n${doc.documentElement.outerHTML}`
}

export function isManualEditFullHtmlDocument(source: string): boolean {
  const normalized = firstSourceToken(source).slice(0, 32).toLowerCase()
  return normalized.startsWith('<!doctype') || normalized.startsWith('<html')
}

function firstSourceToken(source: string): string {
  let rest = source.trimStart()
  while (rest.startsWith('<!--') || rest.startsWith('<?')) {
    const close = rest.startsWith('<!--') ? '-->' : '?>'
    const end = rest.indexOf(close)
    if (end === -1) return rest
    rest = rest.slice(end + close.length).trimStart()
  }
  return rest
}

function inferKind(el: Element): ManualEditKind {
  const explicit = el.getAttribute('data-od-edit')
  if (explicit === 'text' || explicit === 'link' || explicit === 'image' || explicit === 'container' || explicit === 'token' || explicit === 'mixed') return explicit
  const tag = el.tagName.toLowerCase()
  if (tag === 'a') return 'link'
  if (tag === 'img') return 'image'
  
  // Mixed containers: have children but also direct text content
  const text = el.textContent?.trim() ?? ''
  if (['label', 'button', 'span', 'p', 'div'].includes(tag) && text && el.children.length > 0) {
    return 'mixed'
  }
  
  if (['section', 'main', 'nav', 'div', 'article', 'header', 'footer'].includes(tag)) return 'container'
  return 'text'
}

function findEditableElement(doc: Document, id: string): Element | null {
  if (id === '__body__') return doc.body
  return doc.querySelector(`[data-od-id="${CSS.escape(id)}"]`)
}

function hasElementChildren(el: Element): boolean {
  return Array.from(el.children).some(child => child.tagName.toLowerCase() !== 'br')
}

/**
 * Smart text editing for mixed containers (e.g., label with checkbox child)
 * Only modifies direct text nodes, preserves child elements
 */
function setMixedContainerText(el: Element, newText: string): boolean {
  // Find direct text nodes (not nested in child elements)
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      // Only accept text nodes that are direct children of el
      return node.parentElement === el ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    }
  })
  
  let firstTextNode: Text | null = null
  let textNodeCount = 0
  
  while (walker.nextNode()) {
    textNodeCount++
    if (!firstTextNode && walker.currentNode.textContent?.trim()) {
      firstTextNode = walker.currentNode as Text
    }
  }
  
  if (firstTextNode) {
    // Replace the first meaningful text node
    firstTextNode.textContent = newText
    
    // Remove other direct text nodes (if multiple)
    walker.currentNode = firstTextNode
    while (walker.nextNode()) {
      const node = walker.currentNode
      if (node.parentElement === el && node.parentNode) {
        node.parentNode.removeChild(node)
      }
    }
    
    return true
  }
  
  // No text node found, append new text at the end
  if (el.lastChild && el.lastChild.nodeType === Node.ELEMENT_NODE) {
    // Insert after last element
    el.insertBefore(document.createTextNode(newText), null)
  } else {
    // Append at the end
    el.appendChild(document.createTextNode(newText))
  }
  
  return true
}

const INLINE_STYLE_SHORTHAND_KEYS = new Set<ManualEditCssKey>(['border', 'padding', 'margin'])

// 4 个 border-radius longhand key。若同时设置 borderRadius(shorthand)和任一 longhand,
// 浏览器会把 longhand 吸收回 shorthand 序列化为 "5px 8px 8px 8px" 形式,
// 导致 DOMParser 解析后 style['borderTopLeftRadius'] 返回空,UI 读不回 longhand 值。
// 解决:任一 longhand 在 styles 中时,把 shorthand 展开到 4 个 longhand(未设置的 fallback 到 shorthand 值),再清空 shorthand。
const RADIUS_LONGHAND_KEYS: ManualEditCssKey[] = [
  'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius',
]

function expandRadiusShorthand(styles: Partial<ManualEditStyles>): Partial<ManualEditStyles> {
  const shorthand = styles.borderRadius
  if (shorthand === undefined || shorthand === '') return styles
  const hasLonghand = RADIUS_LONGHAND_KEYS.some(k => styles[k] !== undefined && styles[k] !== '')
  if (!hasLonghand) return styles
  // fallback 必须解析成单角值:shorthand 可能是多值形式(如 computed 的 "22px 0px 0px"),
  // 原样塞进单个 longhand(如 border-top-right-radius: 22px 0px 0px)是非法 CSS,会被浏览器丢弃。
  const parsed = parseBorderRadiusShorthand(shorthand)
  if (!parsed) return styles
  const out = { ...styles }
  if (out.borderTopLeftRadius === undefined || out.borderTopLeftRadius === '') out.borderTopLeftRadius = parsed.tl
  if (out.borderTopRightRadius === undefined || out.borderTopRightRadius === '') out.borderTopRightRadius = parsed.tr
  if (out.borderBottomRightRadius === undefined || out.borderBottomRightRadius === '') out.borderBottomRightRadius = parsed.br
  if (out.borderBottomLeftRadius === undefined || out.borderBottomLeftRadius === '') out.borderBottomLeftRadius = parsed.bl
  out.borderRadius = ''
  return out
}

function setInlineStyles(el: HTMLElement, styles: Partial<ManualEditStyles>): void {
  // 先展开 radius shorthand → longhand,避免浏览器把 longhand 吸收回 shorthand 序列化。
  const expanded = expandRadiusShorthand(styles)
  const entries = Object.entries(expanded)
  // 两遍处理:先执行全部 removeProperty,再执行全部 setProperty。
  // 若单遍且 longhand 先于 shorthand 处理,setProperty(longhand) 会被浏览器吸收进
  // 已存在的 shorthand(如 border-radius: 5px 8px 8px 8px),随后的
  // removeProperty('border-radius') 会把吸收后的值整个删掉,导致修改全部丢失。
  for (const [key, value] of entries) {
    // 跳过简写 key:只写 longhand(border-top-width / padding-top 等)。
    // 写简写后 el.style.borderTopWidth 在不同浏览器里返回行为不一致,
    // 会导致 readManualEditStyles 读不到 longhand,fallback 到 computed。
    if (INLINE_STYLE_SHORTHAND_KEYS.has(key as ManualEditCssKey)) continue
    if (value === '' || value === undefined || value === null) {
      el.style.removeProperty(camelToKebab(key))
    }
  }
  for (const [key, value] of entries) {
    if (INLINE_STYLE_SHORTHAND_KEYS.has(key as ManualEditCssKey)) continue
    if (value === '' || value === undefined || value === null) continue
    el.style.setProperty(camelToKebab(key), String(value))
  }
}

// effects 是结构化 UI 数据,不是 CSS 属性;patch 应用前剔除,避免 setProperty('effects', '[object Array]')。
function stripNonCssStyles(styles: Partial<ManualEditStyles>): Partial<ManualEditStyles> {
  if (!styles) return styles
  const { effects, ...rest } = styles
  return rest
}

function hexToRgbTuple(hex: string): [number, number, number] | null {
  const m = hex.match(/^#?([a-fA-F0-9]{6})([a-fA-F0-9]{2})?$/)
  if (!m) return null
  return [
    parseInt(m[1].slice(0, 2), 16),
    parseInt(m[1].slice(2, 4), 16),
    parseInt(m[1].slice(4, 6), 16),
  ]
}

function rgbTupleToHex(r: number, g: number, b: number): string {
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

export function serializeEffects(effects: EffectEntry[]): { boxShadow: string; filter: string; backdropFilter: string } {
  const dropShadows = effects.filter(e => e.type === 'drop-shadow' && e.visible)
  const layerBlurs = effects.filter(e => e.type === 'layer-blur' && e.visible)
  const bgBlurs = effects.filter(e => e.type === 'background-blur' && e.visible)

  const boxShadow = dropShadows.map(e => {
    const rgb = hexToRgbTuple(e.color) || [0, 0, 0]
    const alpha = (e.opacity / 100).toFixed(2)
    return `${e.offsetX}px ${e.offsetY}px ${e.blur}px rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`
  }).join(', ')

  const filter = layerBlurs.map(e => `blur(${e.layerBlur}px)`).join(' ')
  const backdropFilter = bgBlurs.map(e => `blur(${e.bgBlur}px)`).join(' ')

  return { boxShadow, filter, backdropFilter }
}

export function parseEffects(boxShadow: string, filter: string, backdropFilter: string): EffectEntry[] {
  const out: EffectEntry[] = []
  let idx = 0

  if (boxShadow && boxShadow.trim()) {
    // 按 ',' 切分多 shadow,但要避开 rgba(...) 内部的逗号
    const parts = boxShadow.split(/,(?![^()]*\))/).map(s => s.trim()).filter(Boolean)
    for (const part of parts) {
      // 两种格式兼容:写入格式(offsets 在前)与 computed 格式(color 在前、带可选 spread)
      const mOffsetsFirst = part.match(/^(-?\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px\s+(\d+(?:\.\d+)?)px\s+rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/)
      const mColorFirst = part.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)\s+(-?\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px\s+(\d+(?:\.\d+)?)px(?:\s+\d+(?:\.\d+)?px)?$/)
      const m = mOffsetsFirst || mColorFirst
      if (!m) continue
      const offsetX = mOffsetsFirst ? parseFloat(m[1]) : parseFloat(m[5])
      const offsetY = mOffsetsFirst ? parseFloat(m[2]) : parseFloat(m[6])
      const blur = mOffsetsFirst ? parseFloat(m[3]) : parseFloat(m[7])
      const r = mOffsetsFirst ? parseInt(m[4]) : parseInt(m[1])
      const g = mOffsetsFirst ? parseInt(m[5]) : parseInt(m[2])
      const b = mOffsetsFirst ? parseInt(m[6]) : parseInt(m[3])
      const alphaStr = mOffsetsFirst ? m[7] : m[4]
      out.push({
        id: `parsed-${++idx}`,
        type: 'drop-shadow',
        visible: true,
        expanded: false,
        offsetX,
        offsetY,
        blur,
        color: rgbTupleToHex(r, g, b),
        opacity: alphaStr ? Math.round(parseFloat(alphaStr) * 100) : 100,
        layerBlur: 0,
        bgBlur: 0,
        foundBlur: true,
        foundOffsetX: true,
        foundOffsetY: true,
        foundLayerBlur: false,
        foundBgBlur: false,
      })
    }
  }

  if (filter && filter.trim()) {
    const re = /blur\((\d+(?:\.\d+)?)px\)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(filter)) !== null) {
      out.push({
        id: `parsed-${++idx}`,
        type: 'layer-blur',
        visible: true,
        expanded: false,
        offsetX: 0,
        offsetY: 0,
        blur: 0,
        color: '#000000',
        opacity: 100,
        layerBlur: parseFloat(m[1]),
        bgBlur: 0,
        foundBlur: false,
        foundOffsetX: false,
        foundOffsetY: false,
        foundLayerBlur: true,
        foundBgBlur: false,
      })
    }
  }

  if (backdropFilter && backdropFilter.trim()) {
    const re = /blur\((\d+(?:\.\d+)?)px\)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(backdropFilter)) !== null) {
      out.push({
        id: `parsed-${++idx}`,
        type: 'background-blur',
        visible: true,
        expanded: false,
        offsetX: 0,
        offsetY: 0,
        blur: 0,
        color: '#000000',
        opacity: 100,
        layerBlur: 0,
        bgBlur: parseFloat(m[1]),
        foundBlur: false,
        foundOffsetX: false,
        foundOffsetY: false,
        foundLayerBlur: false,
        foundBgBlur: true,
      })
    }
  }

  return out
}

function setAttributes(el: Element, attributes: Record<string, string>): void {
  for (const [name, value] of Object.entries(attributes)) {
    if (value === '' || value === null || value === undefined) {
      el.removeAttribute(name)
    } else {
      el.setAttribute(name, value)
    }
  }
}

function replaceOuterHtml(doc: Document, el: Element, html: string): { ok: boolean; error?: string } {
  const template = doc.createElement('template')
  template.innerHTML = html.trim()
  const replacement = template.content.firstElementChild
  if (!replacement) return { ok: false, error: 'Invalid HTML fragment.' }
  el.replaceWith(replacement)
  return { ok: true }
}

function camelToKebab(str: string): string {
  return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
}