const ATTRIBUTE_NAME = 'data-dom-picker-source'
const PICKER_ID_ATTR = 'dom-picker-id'
const PICKER_COMPONENT_ATTR = 'dom-picker-component'
const OVERLAY_ID = 'dom-picker-overlay'
const ACTIVE_ATTR = 'data-dom-picker-active'

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
  let frozen = false
  let disabled = true
  let lastContextMenuX = 0
  let lastContextMenuY = 0
  let resizeObserver = null

  const ensureResizeObserver = () => {
    if (resizeObserver) return
    resizeObserver = new ResizeObserver(() => {
      if (!frozen || !activeElement) return
      updateOverlay(overlay, activeElement)
    })
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
      if (el !== activeElement) el.removeAttribute(ACTIVE_ATTR)
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
    if (disabled) return
    if (frozen) return
    const resolvedTarget = resolveMarkedTarget(event.target)
    activeElement = resolvedTarget?.element || null
    activeLocation = resolvedTarget?.location || ''
    updateOverlay(overlay, activeElement)
  }

  const handleClick = async (event) => {
    if (disabled) return
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

    const element = resolvedTarget.element
    const location = resolvedTarget.location
    activeElement = element
    activeLocation = location
    frozen = true
    ensureResizeObserver()
    observeActiveElement(element)
    applyActiveMarker()
    event.preventDefault()
    event.stopPropagation()

    const rect = element.getBoundingClientRect()
    window.parent.postMessage(
      {
        type: 'DOM_PICKER_QUICK_FIX',
        domPickerId: location,
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
    console.log(`[${logPrefix}] selected:`, location, element)
  }

  const handleContextMenu = (event) => {
    if (disabled) return

    const resolvedTarget = frozen && activeElement && activeLocation
      ? { element: activeElement, location: activeLocation }
      : resolveMarkedTarget(event.target)
    if (!resolvedTarget?.element || !resolvedTarget.location) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    activeElement = resolvedTarget.element
    activeLocation = resolvedTarget.location
    frozen = true
    ensureResizeObserver()
    observeActiveElement(resolvedTarget.element)
    applyActiveMarker()
    lastContextMenuX = event.clientX
    lastContextMenuY = event.clientY

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
    if (disabled) return
    updateOverlay(overlay, activeElement)
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
    activeElement = resolved.element
    activeLocation = resolved.location
    frozen = true
    ensureResizeObserver()
    observeActiveElement(resolved.element)
    applyActiveMarker()
    updateOverlay(overlay, activeElement)
    const rect = resolved.element.getBoundingClientRect()
    window.parent.postMessage(
      {
        type: 'DOM_PICKER_QUICK_FIX',
        domPickerId: resolved.location,
        domPickerComponent: resolved.element.getAttribute(PICKER_COMPONENT_ATTR) || '',
        domPickerClass: resolved.element.getAttribute('class') || '',
        elementProps: resolved.element.getAttribute('data-element-props') || '',
        tagName: resolved.element.tagName.toLowerCase(),
        rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      },
      '*',
    )
    console.log(`[${logPrefix}] select parent:`, resolved.location, resolved.element)
  }

  window.addEventListener('message', (event) => {
    if (event.data.type === 'DOM_PICKER_UNFREEZE') {
      frozen = false
      applyActiveMarker()
      if (resizeObserver) resizeObserver.disconnect()
    }
    if (event.data.type === 'DOM_PICKER_TOGGLE') {
      disabled = !event.data.active
      if (disabled) {
        overlay.style.display = 'none'
      } else {
        overlay.style.display = ''
      }
    }
    if (event.data.type === 'DOM_PICKER_SELECT_PARENT') {
      selectParent()
    }
  })

  const observer = new MutationObserver(() => {
    if (!frozen || !activeLocation) return
    if (activeElement && document.body.contains(activeElement)) return

    requestAnimationFrame(() => {
      const allPickerElements = document.querySelectorAll(`[${PICKER_ID_ATTR}]`)
      let newElement = null
      for (const el of allPickerElements) {
        if (el.getAttribute(PICKER_ID_ATTR) === activeLocation) {
          newElement = el
          break
        }
      }
      if (newElement) {
        activeElement = newElement
        observeActiveElement(newElement)
        applyActiveMarker()
        updateOverlay(overlay, activeElement)
      } else {
        frozen = false
        activeElement = null
        activeLocation = ''
        applyActiveMarker()
        updateOverlay(overlay, null)
      }
    })
  })

  observer.observe(document.body, { childList: true, subtree: true })

  console.log(`[${logPrefix}] ready`)
}
