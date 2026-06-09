const ATTRIBUTE_NAME = 'data-dom-picker-source'
const PICKER_ID_ATTR = 'dom-picker-id'
const PICKER_COMPONENT_ATTR = 'dom-picker-component'
const OVERLAY_ID = 'dom-picker-overlay'
const BADGE_ID = 'dom-picker-badge'

function createOverlay() {
  const overlay = document.createElement('div')
  overlay.id = OVERLAY_ID
  overlay.style.position = 'fixed'
  overlay.style.zIndex = '2147483646'
  overlay.style.pointerEvents = 'none'
  overlay.style.border = '2px solid #007bff'
  overlay.style.background = 'rgba(0, 123, 255, 0.1)'
  overlay.style.opacity = '0'
  overlay.style.transition = 'all 0.1s ease-out'
  return overlay
}

function createBadge() {
  const badge = document.createElement('div')
  badge.id = BADGE_ID
  badge.innerHTML = `<span data-role="tag">dom</span>`

  Object.assign(badge.style, {
    position: 'fixed',
    zIndex: '2147483647',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 10px',
    borderRadius: '3px',
    background: '#007bff',
    color: '#eff6ff',
    boxShadow: '0 10px 30px rgba(0, 123, 255, 0.28)',
    fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
    fontSize: '20px',
    lineHeight: '1',
    opacity: '0',
    pointerEvents: 'none',
    transition: 'opacity 0.1s ease-out',
  })

  const tag = badge.querySelector('[data-role="tag"]')
  Object.assign(tag.style, {
    maxWidth: '600px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontWeight: '700',
  })

  return badge
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

function updateOverlay(overlay, element) {
  if (!element) {
    overlay.style.opacity = '0'
    return
  }

  const rect = element.getBoundingClientRect()
  overlay.style.opacity = '1'
  overlay.style.top = `${rect.top}px`
  overlay.style.left = `${rect.left}px`
  overlay.style.width = `${rect.width}px`
  overlay.style.height = `${rect.height}px`
}

function updateBadge(badge, element, location) {
  if (!element || !location) {
    badge.style.opacity = '0'
    badge.dataset.source = ''
    return
  }

  const tag = badge.querySelector('[data-role="tag"]')
  const rect = element.getBoundingClientRect()

  tag.textContent = location
  badge.dataset.source = location
  badge.style.opacity = '1'
  badge.style.left = '8px'
  badge.style.top = '8px'
  const badgeRect = badge.getBoundingClientRect()
  const outsideTop = rect.top - badgeRect.height < 0
  const top = outsideTop ? rect.top : rect.top - badgeRect.height
  const left = Math.min(Math.max(0, rect.left), Math.max(0, window.innerWidth - badgeRect.width))

  badge.style.left = `${left}px`
  badge.style.top = `${Math.max(0, top)}px`
}

export function installDomPicker(options = {}) {
  const {
    logPrefix = 'dom-picker',
  } = options

  if (typeof window === 'undefined' || document.getElementById(BADGE_ID)) {
    return
  }

  const overlay = createOverlay()
  const badge = createBadge()

  let activeElement = null
  let activeLocation = ''
  let frozen = false

  const resolveMarkedTarget = (target) => {
    if (!(target instanceof Element)) {
      return null
    }

    if (target.closest(`#${BADGE_ID}`)) {
      return activeElement && activeLocation
        ? { element: activeElement, location: activeLocation }
        : null
    }

    const markedElement = target.closest(`[${ATTRIBUTE_NAME}]`)
    if (markedElement) {
      return {
        element: markedElement,
        location: markedElement.getAttribute(ATTRIBUTE_NAME) || '',
      }
    }

    const pickerElement = target.closest(`[${PICKER_ID_ATTR}]`)
    if (pickerElement) {
      return {
        element: pickerElement,
        location: pickerElement.getAttribute(PICKER_ID_ATTR) || '',
      }
    }

    return resolveVueComponentSource(target)
  }

  const handlePointerMove = (event) => {
    if (frozen) return
    const resolvedTarget = resolveMarkedTarget(event.target)
    activeElement = resolvedTarget?.element || null
    activeLocation = resolvedTarget?.location || ''
    updateOverlay(overlay, activeElement)

    if (activeElement && activeLocation) {
      updateBadge(badge, activeElement, activeLocation)
    } else {
      updateBadge(badge, null, '')
    }
  }

  const handleClick = (event) => {
    if (frozen) {
      window.parent.postMessage({ type: 'DOM_PICKER_CLOSE_MENU' }, '*')
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (event.target instanceof Element && event.target.closest(`#${BADGE_ID}`)) {
      return
    }

    const resolvedTarget = resolveMarkedTarget(event.target)
    if (!resolvedTarget?.element || !resolvedTarget.location) {
      return
    }

    const element = resolvedTarget.element
    const location = resolvedTarget.location
    activeElement = element
    activeLocation = location
    event.preventDefault()
    event.stopPropagation()

    updateBadge(badge, element, location)
    console.log(`[${logPrefix}] selected:`, location, element)
  }

  const handleContextMenu = (event) => {
    if (frozen) {
      window.parent.postMessage({ type: 'DOM_PICKER_CLOSE_MENU' }, '*')
      event.preventDefault()
      event.stopPropagation()
      return
    }

    const resolvedTarget = resolveMarkedTarget(event.target)
    if (!resolvedTarget?.element || !resolvedTarget.location) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    activeElement = resolvedTarget.element
    activeLocation = resolvedTarget.location
    frozen = true

    const rect = resolvedTarget.element.getBoundingClientRect()
    window.parent.postMessage(
      {
        type: 'DOM_PICKER_CONTEXT_MENU',
        domPickerId: resolvedTarget.location,
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
    console.log(`[${logPrefix}] context menu:`, resolvedTarget.location, resolvedTarget.element)
  }

  const handleScrollOrResize = () => {
    updateOverlay(overlay, activeElement)
    updateBadge(badge, activeElement, activeLocation)
  }

  document.body.append(overlay, badge)
  window.addEventListener('pointermove', handlePointerMove, true)
  window.addEventListener('click', handleClick, true)
  window.addEventListener('contextmenu', handleContextMenu, true)
  window.addEventListener('scroll', handleScrollOrResize, true)
  window.addEventListener('resize', handleScrollOrResize)
  window.addEventListener('message', (event) => {
    if (event.data.type === 'DOM_PICKER_UNFREEZE') {
      frozen = false
    }
  })
  console.log(`[${logPrefix}] ready`)
}
