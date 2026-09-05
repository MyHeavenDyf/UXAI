const ATTRIBUTE_NAME = 'data-dom-picker-source'
const PICKER_ID_ATTR = 'id'
const PICKER_COMPONENT_ATTR = 'dom-picker-component'
const OVERLAY_ID = 'dom-picker-overlay'
const ACTIVE_ATTR = 'data-dom-picker-active'

// A2UI 元素与宿主页面元素的框选配色。宿主色（橙）区别于 A2UI（蓝）。
const A2UI_BORDER = '#007bff'
const A2UI_BG = 'rgba(0, 123, 255, 0.1)'
const HOST_BORDER = '#fa8c16'
const HOST_BG = 'rgba(250, 140, 22, 0.12)'

function applyOverlayColor(overlay, kind) {
  if (kind === 'host') {
    overlay.style.border = `2px solid ${HOST_BORDER}`
    overlay.style.background = HOST_BG
    return
  }
  overlay.style.border = `2px solid ${A2UI_BORDER}`
  overlay.style.background = A2UI_BG
}

function createOverlay() {
  const overlay = document.createElement('div')
  overlay.id = OVERLAY_ID
  overlay.style.position = 'fixed'
  overlay.style.zIndex = '2147483646'
  overlay.style.pointerEvents = 'none'
  overlay.style.opacity = '0'
  overlay.style.transition = 'all 0.1s ease-out'
  return overlay
}

function readSourceFromVueInstance(instance) {
  if (!instance) {
    return ''
  }

  const candidates = [
    instance.vnode?.props,
    instance.attrs,
    instance.subTree?.props,
    instance.subTree?.component?.vnode?.props,
  ]

  for (const candidate of candidates) {
    const location = candidate?.[ATTRIBUTE_NAME]
    if (typeof location === 'string' && location) {
      return location
    }
  }

  return ''
}

function readSourceFromVNode(vnode) {
  if (!vnode) {
    return ''
  }

  const candidates = [
    vnode.props,
    vnode.component?.vnode?.props,
    vnode.component?.attrs,
    vnode.component?.subTree?.props,
  ]

  for (const candidate of candidates) {
    const location = candidate?.[ATTRIBUTE_NAME]
    if (typeof location === 'string' && location) {
      return location
    }
  }

  return ''
}

function getVueElementVNodes(element) {
  if (!(element instanceof Element)) {
    return []
  }

  const ownVNode = element.__vnode
  const ownParentComponent = element.__vueParentComponent
  const appInstance = element.__vue_app__?._instance

  return [
    ownVNode,
    ownVNode?.component?.vnode,
    ownParentComponent?.vnode,
    ownParentComponent?.subTree,
    appInstance?.vnode,
    appInstance?.subTree,
  ].filter(Boolean)
}

function resolveVueComponentSource(target) {
  if (!(target instanceof Element)) {
    return null
  }

  let currentElement = target

  while (currentElement) {
    const vnodes = getVueElementVNodes(currentElement)
    for (const vnode of vnodes) {
      const location = readSourceFromVNode(vnode)
      if (location) {
        if (!currentElement.hasAttribute(ATTRIBUTE_NAME)) {
          currentElement.setAttribute(ATTRIBUTE_NAME, location)
        }

        return {
          element: currentElement,
          location,
        }
      }
    }

    let instance = currentElement.__vueParentComponent || currentElement.__vue_app__?._instance || null

    while (instance) {
      const location = readSourceFromVueInstance(instance)
      if (location) {
        if (!currentElement.hasAttribute(ATTRIBUTE_NAME)) {
          currentElement.setAttribute(ATTRIBUTE_NAME, location)
        }

        return {
          element: currentElement,
          location,
        }
      }

      instance = instance.parent
    }

    currentElement = currentElement.parentElement
  }

  return null
}

function cssEscapeId(id) {
  if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(id)
  return String(id).replace(/([^\w-])/g, '\\$1')
}

// 为宿主元素生成唯一 CSS 选择器：优先 #id，其次逐层 tag.class / tag:nth-of-type(k)，
// 每层用 querySelectorAll 验证唯一即停；一直上溯到 html 保证最终唯一。
function buildHostSelector(el) {
  if (!el || !(el instanceof Element)) return ''

  if (el.id) {
    const sel = `#${cssEscapeId(el.id)}`
    try {
      if (document.querySelectorAll(sel).length === 1) return sel
    } catch (_) { /* 非法选择器，降级 */ }
  }

  const segments = []
  let cur = el
  while (cur && cur.nodeType === 1) {
    const tag = cur.tagName.toLowerCase()
    const cls = cur.getAttribute('class')
    let seg
    if (cls) {
      const firstClass = cls.trim().split(/\s+/)[0]
      if (firstClass) {
        seg = `${tag}.${firstClass}`
        const candidate = `${segments.join(' > ')} ${seg}`.trim()
        try {
          if (document.querySelectorAll(candidate).length === 1) return candidate
        } catch (_) { /* 降级到 nth-of-type */ }
      }
    }
    if (!seg) {
      const parent = cur.parentElement
      if (parent) {
        let index = 0
        let sibling = cur
        while ((sibling = sibling.previousElementSibling)) {
          if (sibling.tagName === cur.tagName) index++
        }
        seg = `${tag}:nth-of-type(${index + 1})`
      } else {
        seg = tag
      }
    }
    segments.unshift(seg)
    const candidate = segments.join(' > ')
    try {
      if (document.querySelectorAll(candidate).length === 1) return candidate
    } catch (_) { /* 继续 */ }
    if (cur === document.documentElement) break
    cur = cur.parentElement
  }

  return segments.length > 0 ? segments.join(' > ') : el.tagName.toLowerCase()
}

// 宿主页面元素（非 A2UI）：直接命中指针下的最里层元素，跳过 html/body/head
// （空白背景不可选）。要选容器可走右键「选择父容器」逐层上溯。
function resolveHostTarget(target) {
  if (!(target instanceof Element)) return null

  const tag = target.tagName.toLowerCase()
  if (tag === 'html' || tag === 'body' || tag === 'head') return null

  const selector = buildHostSelector(target)
  if (!selector) return null

  return {
    element: target,
    location: selector,
    kind: 'host',
  }
}

function updateOverlay(overlay, element, kind) {
  if (!element) {
    overlay.style.opacity = '0'
    return
  }

  applyOverlayColor(overlay, kind)
  const rect = element.getBoundingClientRect()
  overlay.style.opacity = '1'
  overlay.style.top = `${rect.top}px`
  overlay.style.left = `${rect.left}px`
  overlay.style.width = `${rect.width}px`
  overlay.style.height = `${rect.height}px`
}

export function installDomPicker(options = {}) {
  const {
    logPrefix = 'dom-picker',
  } = options

  if (typeof window === 'undefined' || document.getElementById(OVERLAY_ID)) {
    return
  }

  const overlay = createOverlay()

  let activeElement = null
  let activeLocation = ''
  let activeKind = 'a2ui'
  let activeSelector = ''
  let frozen = false
  let disabled = true
  let lastContextMenuX = 0
  let lastContextMenuY = 0
  let resizeObserver = null
  let rectRafPending = false

  // 元素尺寸变化后，把新 rect 回传父层，使其黑色遮罩/蓝框(.picker-mask)跟随更新。
  // rAF 合并：连续 resize 每帧最多回传一条，避免刷屏。
  const postRectUpdate = () => {
    if (rectRafPending) return
    rectRafPending = true
    requestAnimationFrame(() => {
      rectRafPending = false
      if (!frozen || !activeElement) return
      const r = activeElement.getBoundingClientRect()
      window.parent.postMessage(
        {
          type: 'od:dom-picker-rect-update',
          id: activeLocation,
          rect: { top: r.top, left: r.left, width: r.width, height: r.height },
        },
        '*',
      )
    })
  }

  const ensureResizeObserver = () => {
    if (resizeObserver) return
    resizeObserver = new ResizeObserver(() => {
      if (!frozen || !activeElement) return
      updateOverlay(overlay, activeElement, activeKind)
      postRectUpdate()
    })
  }

  // 选中元素后等入场/位移动画结束再回传一次最终 rect。ResizeObserver 只覆盖尺寸变化，
  // transform 位移不触发它；这里用 transitionend/animationend 精确捕获动画结束，配合
  // 400ms 兜底（无动画 / JS 动画 / 事件被 preventDefault 的边界）。postRectUpdate 内部
  // rAF 合并，多次触发安全。若动画 > 400ms，transitionend 仍会在动画结束时触发再发一次最终 rect。
  let stableRectEl = null
  let stableRectHandler = null
  let stableRectTimer = null

  const cleanupStableRectReport = () => {
    if (stableRectTimer) { clearTimeout(stableRectTimer); stableRectTimer = null }
    if (stableRectEl && stableRectHandler) {
      stableRectEl.removeEventListener('transitionend', stableRectHandler, true)
      stableRectEl.removeEventListener('animationend', stableRectHandler, true)
    }
    stableRectEl = null
    stableRectHandler = null
  }

  const scheduleStableRectReport = () => {
    cleanupStableRectReport()
    const el = activeElement
    if (!el) return
    stableRectEl = el
    const onStable = () => {
      el.removeEventListener('transitionend', onStable, true)
      el.removeEventListener('animationend', onStable, true)
      if (stableRectTimer) { clearTimeout(stableRectTimer); stableRectTimer = null }
      stableRectEl = null
      stableRectHandler = null
      postRectUpdate()
    }
    stableRectHandler = onStable
    el.addEventListener('transitionend', onStable, true)
    el.addEventListener('animationend', onStable, true)
    // 兜底：transitionend/animationend 可能不触发，延时 400ms 发一次 rect。
    // 不在此移除监听——若动画 > 400ms，transitionend 仍会在结束时触发发最终 rect。
    stableRectTimer = setTimeout(() => {
      postRectUpdate()
      stableRectTimer = null
    }, 400)
  }

  const observeActiveElement = (element) => {
    if (!resizeObserver) return
    resizeObserver.disconnect()
    if (element && frozen) {
      resizeObserver.observe(element)
    }
  }

  const applyActiveMarker = () => {
    document.querySelectorAll(`[${ACTIVE_ATTR}]`).forEach((el) => {
      el.removeAttribute(ACTIVE_ATTR)
    })
    if (frozen && activeElement) {
      activeElement.setAttribute(ACTIVE_ATTR, '')
    }
  }

  const resolveMarkedTarget = (target) => {
    if (!(target instanceof Element)) {
      return null
    }

    const markedElement = target.closest(`[${ATTRIBUTE_NAME}]`)
    if (markedElement) {
      return {
        element: markedElement,
        location: markedElement.getAttribute(ATTRIBUTE_NAME) || '',
        kind: 'a2ui',
      }
    }

    const componentElement = target.closest(`[${PICKER_COMPONENT_ATTR}]`)
    if (componentElement) {
      return {
        element: componentElement,
        location: componentElement.getAttribute(PICKER_ID_ATTR) || '',
        kind: 'a2ui',
      }
    }

    // 宿主页面元素：无 A2UI 标记，按块级吸附 + CSS 选择器命中。
    const hostTarget = resolveHostTarget(target)
    if (hostTarget) {
      return hostTarget
    }

    const vueResolved = resolveVueComponentSource(target)
    if (vueResolved) {
      return {
        element: vueResolved.element,
        location: vueResolved.location,
        kind: 'a2ui',
      }
    }

    return null
  }

  const handlePointerMove = (event) => {
    if (disabled) return
    if (frozen) return
    const resolvedTarget = resolveMarkedTarget(event.target)
    activeElement = resolvedTarget?.element || null
    activeLocation = resolvedTarget?.location || ''
    activeKind = resolvedTarget?.kind || 'a2ui'
    activeSelector = resolvedTarget?.kind === 'host' ? resolvedTarget.location : ''
    updateOverlay(overlay, activeElement, activeKind)
  }

  const handleClick = async (event) => {
    if (disabled) return
    if (frozen) {
      if (activeElement && event.target instanceof Element && activeElement.contains(event.target)) {
        const rect = activeElement.getBoundingClientRect()
        window.parent.postMessage(
          {
            type: 'od:dom-picker-quick-fix',
            kind: activeKind,
            id: activeLocation,
            selector: activeSelector,
            domPickerComponent: activeElement.getAttribute(PICKER_COMPONENT_ATTR) || '',
            domPickerClass: activeElement.getAttribute('class') || '',
            elementProps: activeElement.getAttribute('data-element-props') || '',
            tagName: activeElement.tagName.toLowerCase(),
            rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
            clickX: event.clientX,
            clickY: event.clientY,
          },
          '*',
        )
        event.preventDefault()
        event.stopPropagation()
        return
      }
      window.parent.postMessage({ type: 'od:dom-picker-close-panels' }, '*')
      event.preventDefault()
      event.stopPropagation()
      return
    }

    const resolvedTarget = resolveMarkedTarget(event.target)
    if (!resolvedTarget?.element || !resolvedTarget.location) {
      return
    }

    const element = resolvedTarget.element
    const location = resolvedTarget.location
    const kind = resolvedTarget.kind || 'a2ui'
    const selector = kind === 'host' ? location : ''
    activeElement = element
    activeLocation = location
    activeKind = kind
    activeSelector = selector
    frozen = true
    ensureResizeObserver()
    observeActiveElement(element)
    applyActiveMarker()
    event.preventDefault()
    event.stopPropagation()

    const rect = element.getBoundingClientRect()
    window.parent.postMessage(
      {
        type: 'od:dom-picker-quick-fix',
        kind,
        id: location,
        selector,
        domPickerComponent: element.getAttribute(PICKER_COMPONENT_ATTR) || '',
        domPickerClass: element.getAttribute('class') || '',
        elementProps: element.getAttribute('data-element-props') || '',
        tagName: element.tagName.toLowerCase(),
        rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
        clickX: event.clientX,
        clickY: event.clientY,
      },
      '*',
    )
    console.log(`[${logPrefix}] selected:`, kind, location, element)
    scheduleStableRectReport()
  }

  const handleContextMenu = (event) => {
    if (disabled) return

    let resolvedTarget = frozen && activeElement && activeLocation
      ? { element: activeElement, location: activeLocation, kind: activeKind }
      : resolveMarkedTarget(event.target)
    if (!resolvedTarget?.element || !resolvedTarget.location) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    const kind = resolvedTarget.kind || 'a2ui'
    const selector = kind === 'host' ? resolvedTarget.location : ''
    activeElement = resolvedTarget.element
    activeLocation = resolvedTarget.location
    activeKind = kind
    activeSelector = selector
    frozen = true
    ensureResizeObserver()
    observeActiveElement(resolvedTarget.element)
    applyActiveMarker()
    lastContextMenuX = event.clientX
    lastContextMenuY = event.clientY

    const rect = resolvedTarget.element.getBoundingClientRect()
    window.parent.postMessage(
      {
        type: 'od:dom-picker-context-menu',
        kind,
        id: resolvedTarget.location,
        selector,
        domPickerComponent: resolvedTarget.element.getAttribute(PICKER_COMPONENT_ATTR) || '',
        domPickerClass: resolvedTarget.element.getAttribute('class') || '',
        elementProps: resolvedTarget.element.getAttribute('data-element-props') || '',
        tagName: resolvedTarget.element.tagName.toLowerCase(),
        rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
        clickX: event.clientX,
        clickY: event.clientY,
      },
      '*',
    )
    console.log(`[${logPrefix}] context menu:`, kind, resolvedTarget.location, resolvedTarget.element)
    scheduleStableRectReport()
  }

  const handleScrollOrResize = () => {
    if (disabled) return
    updateOverlay(overlay, activeElement, activeKind)
  }

  document.body.append(overlay)
  overlay.style.display = 'none'
  window.addEventListener('pointermove', handlePointerMove, true)
  window.addEventListener('click', handleClick, true)
  window.addEventListener('contextmenu', handleContextMenu, true)
  window.addEventListener('scroll', handleScrollOrResize, true)
  window.addEventListener('resize', handleScrollOrResize)
  const selectParent = () => {
    if (!activeElement) return
    const parent = activeElement.parentElement
    if (!parent || !(parent instanceof Element)) return
    const resolved = resolveMarkedTarget(parent)
    if (!resolved?.element || !resolved.location) return
    const kind = resolved.kind || 'a2ui'
    activeElement = resolved.element
    activeLocation = resolved.location
    activeKind = kind
    activeSelector = kind === 'host' ? resolved.location : ''
    frozen = true
    ensureResizeObserver()
    observeActiveElement(resolved.element)
    applyActiveMarker()
    updateOverlay(overlay, activeElement, activeKind)
    console.log(`[${logPrefix}] select parent:`, kind, resolved.location, resolved.element)
    scheduleStableRectReport()
  }

  window.addEventListener('message', (event) => {
    if (event.data.type === 'od:dom-picker-unfreeze') {
      frozen = false
      activeElement = null
      activeLocation = ''
      activeKind = 'a2ui'
      activeSelector = ''
      applyActiveMarker()
      updateOverlay(overlay, null, activeKind)
      if (resizeObserver) resizeObserver.disconnect()
      cleanupStableRectReport()
    }
    if (event.data.type === 'od:dom-picker-mode') {
      disabled = !event.data.enabled
      if (disabled) {
        overlay.style.display = 'none'
      } else {
        overlay.style.display = ''
      }
    }
    if (event.data.type === 'od:dom-picker-select-parent') {
      selectParent()
    }
  })

  const observer = new MutationObserver(() => {
    if (!frozen || !activeLocation) return
    if (activeElement && document.body.contains(activeElement)) return

    requestAnimationFrame(() => {
      // a2ui 元素按 id 重定位；宿主元素按 CSS 选择器重定位（activeLocation 即选择器）。
      let newElement = null
      if (activeKind === 'host') {
        try { newElement = document.querySelector(activeLocation) } catch (_) { newElement = null }
      } else {
        const allPickerElements = document.querySelectorAll(`[id]`)
        for (const el of allPickerElements) {
          if ((el.getAttribute('id') || '') === activeLocation) {
            newElement = el
            break
          }
        }
      }
      if (newElement) {
        activeElement = newElement
        observeActiveElement(newElement)
        applyActiveMarker()
        updateOverlay(overlay, activeElement, activeKind)
      } else {
        frozen = false
        activeElement = null
        activeLocation = ''
        activeKind = 'a2ui'
        activeSelector = ''
        applyActiveMarker()
        updateOverlay(overlay, null, activeKind)
      }
    })
  })

  observer.observe(document.body, { childList: true, subtree: true })

  console.log(`[${logPrefix}] ready`)
}
