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

export const MANUAL_EDIT_STYLE_PROPS: readonly (keyof ManualEditStyles)[] = [
  'fontFamily', 'fontSize', 'fontWeight', 'color', 'textAlign', 'lineHeight', 'letterSpacing',
  'width', 'height', 'minHeight',
  'gap', 'flexDirection', 'justifyContent', 'alignItems',
  'backgroundColor', 'opacity',
  'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'border', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderStyle', 'borderColor', 'borderRadius',
]

export function emptyManualEditStyles(): ManualEditStyles {
  return MANUAL_EDIT_STYLE_PROPS.reduce<ManualEditStyles>((acc, key) => {
    acc[key] = ''
    return acc
  }, {} as ManualEditStyles)
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
    setInlineStyles(el as HTMLElement, patch.styles)
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
const SHORTHAND_LONGHAND_FALLBACK: Partial<Record<keyof ManualEditStyles, string>> = {
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
  return MANUAL_EDIT_STYLE_PROPS.reduce<ManualEditStyles>((acc, key) => {
    const direct = style[key as unknown as keyof CSSStyleDeclaration] as string | undefined
    const kebab = camelToKebab(key)
    const fallback = SHORTHAND_LONGHAND_FALLBACK[key]
    acc[key] = direct
      || style.getPropertyValue(kebab)
      || (fallback ? style.getPropertyValue(fallback) : '')
      || ''
    return acc
  }, {} as ManualEditStyles)
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
const BORDER_WIDTH_LONGHAND_KEYS = new Set<keyof ManualEditStyles>([
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
])

function mergeManualEditInspectorStyles(
  sourceStyles: ManualEditStyles,
  previewStyles: ManualEditStyles,
): ManualEditStyles {
  // border-style=none 时 computed 的 border-width 强制为 0,但实际 inline width 还在。
  // 这种情况不用 computed 的 0,留空让用户切回 solid 时从源/pending 重读。
  const borderStyleNone = /^(none)$/i.test(previewStyles.borderStyle?.trim() || '')
  return MANUAL_EDIT_STYLE_PROPS.reduce<ManualEditStyles>((acc, key) => {
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
}

function manualEditInspectorStyleValue(
  key: keyof ManualEditStyles,
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

function normalizeManualEditInspectorColor(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed)) return trimmed.toLowerCase()
  if (/^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(,\s*[\d.]+\s*)?\)$/i.test(trimmed)) return trimmed
  return trimmed
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

const INLINE_STYLE_SHORTHAND_KEYS = new Set<keyof ManualEditStyles>(['border', 'padding', 'margin'])

function setInlineStyles(el: HTMLElement, styles: Partial<ManualEditStyles>): void {
  for (const [key, value] of Object.entries(styles)) {
    // 跳过简写 key:只写 longhand(border-top-width / padding-top 等)。
    // 写简写后 el.style.borderTopWidth 在不同浏览器里返回行为不一致,
    // 会导致 readManualEditStyles 读不到 longhand,fallback 到 computed。
    if (INLINE_STYLE_SHORTHAND_KEYS.has(key as keyof ManualEditStyles)) continue
    if (value === '' || value === undefined || value === null) {
      el.style.removeProperty(camelToKebab(key))
    } else {
      el.style.setProperty(camelToKebab(key), String(value))
    }
  }
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