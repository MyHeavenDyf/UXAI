/**
 * 评估 pins bridge —— 在预览 iframe 内按评审数据渲染问题 pin（od-docs/create-assessment.md:63-86）。
 *
 *
 * 消息协议（parent → iframe）：
 * - od:assessment-mode    {enabled}                       开/关 pin 可见性（暂停=隐藏，数据保留）。
 * - od:assessment-data    {items:[{index,locator,pin}]}    全量替换评审数据（不影响激活态——激活态归父侧 pin-active 消息所有）
 * - od:assessment-clear   {}                               移除 pin + 清状态（退出待修改）
 * - od:assessment-pin-active {index|null, selected?}       激活某项；selected=true（用户显式选择：下拉选中/面板行点击）
 *                                                           同时进入"选中显示"态（多值 pin 显示该项 pin 值）；不带 selected
 *                                                           的重放（推送/重载恢复）仅恢复激活；null 重置
 * 消息协议（iframe → parent）：
 * - od:assessment-request-data {}                          载入后自请求（iframe 重载恢复）
 * - od:assessment-pin-click {index|null, indices, multi, activeIndex, pinPosition}
 *     单值：已激活，index 为该项；多值（两步第一步）：bridge 已激活本组代表项（activeIndex = 最小
 *     pin 值项，父侧据此同步持有的激活项），parent 弹下拉让用户选择后下发 pin-active
 * - od:assessment-pin-position {index, pinPosition}        pin-active 处理完成后回报 pin 位置（弹窗锚定用）
 * - od:assessment-external-click {}                         评估模式下点击 pin 外区域（父窗口关闭弹窗并取消激活）
 */

export const ASSESSMENT_PIN_CSS = `
[data-od-assessment-pin] {
  display: none !important;
}

html[data-od-assessment-mode] [data-od-assessment-pin] {
  display: flex !important;
}

[data-od-assessment-pin] .od-assessment-pin-outer {
  height: 24px;
  border-radius: 999px;
  border-bottom-left-radius: 0;
  box-shadow: 0 1px 4px 0 rgba(0, 0, 0, 0.16);
  display: flex;
  align-items: center;
  justify-content: center;
}

[data-od-assessment-pin] .od-assessment-pin-middle {
  min-width: 23px;
  height: 23px;
  border-radius: 999px;
  border-bottom-left-radius: 0;
  border: 1px solid #fff;
  background: #E02128;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 6px;
  box-sizing: border-box;
}

[data-od-assessment-pin-active] .od-assessment-pin-middle {
  border: 1px solid #0A59F7;
}

[data-od-assessment-pin] .od-assessment-pin-text {
  color: #fff;
  font-size: 12px;
  line-height: 14px;
  font-weight: 600;
}

[data-od-assessment-element-active] {
  outline: 1px solid #0A59F7 !important;
  outline-offset: 0 !important;
}
`

export const ASSESSMENT_BRIDGE_SCRIPT = `<script data-od-assessment-bridge>(function(){
  var assessmentEnabled = false
  var assessmentItems = []
  var activeIndex = null
  var multiDisplayIndex = null
  var lastUpdateTime = 0
  var animationFrameId = null
  var pinRegistry = []

  function looksLikeXPath(s) {
    return s.charAt(0) === '/' || s.indexOf('id(') === 0 || s.indexOf('((') === 0 || s.indexOf('./') === 0
  }

  function findByXPath(xpath) {
    try {
      var result = document.evaluate(xpath, document, null, 9, null)
      var node = result && result.singleNodeValue
      return node && node.nodeType === 1 ? node : null
    } catch (e) {
      return null
    }
  }

  function findByCss(sel) {
    try {
      var el = document.querySelector(sel)
      return el || null
    } catch (e) {
      return null
    }
  }

  function locateElement(locator) {
    if (!locator) return null
    return looksLikeXPath(locator)
      ? (findByXPath(locator) || findByCss(locator))
      : (findByCss(locator) || findByXPath(locator))
  }

  function isElementVisible(el) {
    if (!el) return false
    if (!document.body.contains(el)) return false
    var current = el
    while (current && current !== document.documentElement) {
      var style = window.getComputedStyle(current)
      if (style.display === 'none') return false
      if (style.visibility === 'hidden') return false
      current = current.parentElement
    }
    return true
  }

  function removeElementActiveMarks() {
    var marked = document.querySelectorAll('[data-od-assessment-element-active]')
    for (var i = 0; i < marked.length; i++) marked[i].removeAttribute('data-od-assessment-element-active')
  }

  function removeActivePinMarks() {
    var pins = document.querySelectorAll('[data-od-assessment-pin-active]')
    for (var i = 0; i < pins.length; i++) pins[i].removeAttribute('data-od-assessment-pin-active')
  }

  function groupLabel(group) {
    if (group.items.length === 1) return String(group.items[0].pin)
    for (var i = 0; i < group.items.length; i++) {
      if (group.items[i].index === multiDisplayIndex) return String(group.items[i].pin)
    }
    var minPin = group.items[0].pin
    for (var j = 1; j < group.items.length; j++) {
      if (group.items[j].pin < minPin) minPin = group.items[j].pin
    }
    return minPin + '+'
  }

  function renderPins() {
    removeElementActiveMarks()
    removeActivePinMarks()

    var groups = []
    for (var i = 0; i < assessmentItems.length; i++) {
      var item = assessmentItems[i]
      var el = locateElement(item.locator)
      if (!el || !isElementVisible(el)) continue
      var group = null
      for (var g = 0; g < groups.length; g++) {
        if (groups[g].element === el) { group = groups[g]; break }
      }
      if (!group) {
        group = { element: el, items: [] }
        groups.push(group)
      }
      group.items.push(item)
    }

    for (var r = pinRegistry.length - 1; r >= 0; r--) {
      var entry = pinRegistry[r]
      var stillGrouped = false
      for (var g2 = 0; g2 < groups.length; g2++) {
        if (groups[g2].element === entry.element) { stillGrouped = true; break }
      }
      if (!stillGrouped || !document.body.contains(entry.element)) {
        entry.pinEl.remove()
        pinRegistry.splice(r, 1)
      }
    }

    var scrollX = window.scrollX || document.documentElement.scrollLeft
    var scrollY = window.scrollY || document.documentElement.scrollTop
    var bodyRect = document.body.getBoundingClientRect()
    var bodyOffsetX = bodyRect.left + scrollX
    var bodyOffsetY = bodyRect.top + scrollY
    var viewportWidth = document.documentElement.clientWidth

    for (var g3 = 0; g3 < groups.length; g3++) {
      var group2 = groups[g3]
      var existing = null
      for (var r2 = 0; r2 < pinRegistry.length; r2++) {
        if (pinRegistry[r2].element === group2.element) { existing = pinRegistry[r2]; break }
      }

      var rect = group2.element.getBoundingClientRect()
      var leftPx = rect.left + scrollX + rect.width - bodyOffsetX
      var topPx = rect.top + scrollY - 24 - bodyOffsetY
      var pinWidth = existing ? (existing.pinEl.offsetWidth || 24) : 24
      var overflowRight = leftPx + pinWidth > viewportWidth + scrollX - bodyOffsetX
      var overflowTop = rect.top + scrollY - bodyOffsetY < 24
      var pinLeft = overflowRight ? leftPx - pinWidth : leftPx
      var pinTop = overflowTop ? rect.top + scrollY - bodyOffsetY : topPx

      var groupActive = false
      for (var a = 0; a < group2.items.length; a++) {
        if (group2.items[a].index === activeIndex) { groupActive = true; break }
      }
      if (groupActive) group2.element.setAttribute('data-od-assessment-element-active', 'true')

      var label = groupLabel(group2)
      var indices = group2.items.map(function(it) { return it.index })

      if (existing) {
        existing.pinEl.style.left = pinLeft + 'px'
        existing.pinEl.style.top = pinTop + 'px'
        existing.textEl.textContent = label
        existing.indices = indices
      } else {
        var pin = document.createElement('div')
        pin.setAttribute('data-od-assessment-pin', String(indices[0]))
        pin.style.cssText = 'position:absolute;left:' + pinLeft + 'px;top:' + pinTop + 'px;z-index:2147483647;cursor:pointer;'
        var outer = document.createElement('div')
        outer.className = 'od-assessment-pin-outer'
        var middle = document.createElement('div')
        middle.className = 'od-assessment-pin-middle'
        var text = document.createElement('span')
        text.className = 'od-assessment-pin-text'
        text.textContent = label
        middle.appendChild(text)
        outer.appendChild(middle)
        pin.appendChild(outer)
        document.body.appendChild(pin)

        var newEntry = { element: group2.element, pinEl: pin, textEl: text, indices: indices }
        pinRegistry.push(newEntry)

        pin.addEventListener('click', function(entryRef) {
          return function(e) {
            e.stopPropagation()
            var pinRect = entryRef.pinEl.getBoundingClientRect()
            var payload = {
              indices: entryRef.indices,
              pinPosition: { left: pinRect.left, top: pinRect.top, width: pinRect.width, height: pinRect.height }
            }
            if (entryRef.indices.length === 1) {
              activeIndex = entryRef.indices[0]
              multiDisplayIndex = null
              payload.index = entryRef.indices[0]
              payload.multi = false
              renderPins()
            } else if (multiDisplayIndex !== null && entryRef.indices.indexOf(multiDisplayIndex) !== -1) {
              // 处于"选中显示某项"的两步状态：重开该项弹窗（不走下拉），关闭弹窗后由 pin-active{null} 复位
              activeIndex = multiDisplayIndex
              payload.index = multiDisplayIndex
              payload.multi = false
              renderPins()
            } else {
              // 两步第一步：先激活该组（元素描边 + pin 蓝边，激活代表项 = 最小 pin 值项），父侧弹下拉
              var minItem = null
              for (var i = 0; i < assessmentItems.length; i++) {
                var it = assessmentItems[i]
                if (entryRef.indices.indexOf(it.index) !== -1 && (minItem === null || it.pin < minItem.pin)) minItem = it
              }
              if (minItem) activeIndex = minItem.index
              payload.index = null
              payload.multi = true
              // 父侧同步持有的激活项（assessmentActivePin）——任何 pin-active 重放（推送/重载恢复）重放本组代表项而非旧项
              payload.activeIndex = minItem ? minItem.index : null
              renderPins()
            }
            window.parent.postMessage(Object.assign({ type: 'od:assessment-pin-click' }, payload), '*')
          }
        }(newEntry))
      }

      if (groupActive) {
        var activePin = null
        for (var p = 0; p < pinRegistry.length; p++) {
          if (pinRegistry[p].element === group2.element) { activePin = pinRegistry[p]; break }
        }
        if (activePin) activePin.pinEl.setAttribute('data-od-assessment-pin-active', 'true')
      }
    }
  }

  function clearAll() {
    for (var i = pinRegistry.length - 1; i >= 0; i--) {
      pinRegistry[i].pinEl.remove()
    }
    pinRegistry = []
    assessmentItems = []
    activeIndex = null
    multiDisplayIndex = null
    removeElementActiveMarks()
    removeActivePinMarks()
  }

  function stopLoop() {
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId)
      animationFrameId = null
    }
  }

  function updatePinsLoop() {
    // 防堆叠：已有循环在跑则直接返回（animationFrameId 在循环期间恒有值，stopLoop 置 null）
    if (animationFrameId) return
    var tick = function() {
      var now = Date.now()
      if (now - lastUpdateTime >= 60) {
        lastUpdateTime = now
        if (assessmentEnabled && assessmentItems.length > 0) {
          renderPins()
        }
      }
      animationFrameId = requestAnimationFrame(tick)
    }
    animationFrameId = requestAnimationFrame(tick)
  }

  window.addEventListener('message', function(ev) {
    var data = ev && ev.data
    if (!data || !data.type) return

    if (data.type === 'od:assessment-mode') {
      var wasEnabled = assessmentEnabled
      assessmentEnabled = !!data.enabled
      document.documentElement.toggleAttribute('data-od-assessment-mode', assessmentEnabled)
      if (assessmentEnabled) {
        // 仅在 关→开 跃迁时自请求——父侧 request-data 响应含 mode 消息，无条件回发会造成
        // mode → request-data → mode → ... 无限回声循环（持续重放 pin-active 覆写激活态）
        if (!wasEnabled) {
          window.parent.postMessage({ type: 'od:assessment-request-data' }, '*')
        }
        updatePinsLoop()
      } else {
        stopLoop()
      }
      return
    }

    if (data.type === 'od:assessment-data') {
      // 激活态归父侧显式 pin-active 消息所有（同 comment 的 saved-pins 行为），data 重推不重置
      assessmentItems = Array.isArray(data.items) ? data.items : []
      if (assessmentEnabled) renderPins()
      return
    }

    if (data.type === 'od:assessment-clear') {
      assessmentEnabled = false
      document.documentElement.toggleAttribute('data-od-assessment-mode', false)
      stopLoop()
      clearAll()
      return
    }

    if (data.type === 'od:assessment-pin-active') {
      if (data.index === null || data.index === undefined) {
        activeIndex = null
        multiDisplayIndex = null
        renderPins()
        return
      }
      activeIndex = data.index
      // selected=true（用户显式选择：下拉选中/面板行点击）才进入"选中显示"态（多值 pin 显示该项 pin 值）；
      // 父侧重放（推送/重载恢复，不带 selected）仅恢复激活，不动 multiDisplayIndex——避免多值 pin 提前脱离 min+ 显示
      if (data.selected) multiDisplayIndex = data.index
      renderPins()
      var item = null
      for (var i = 0; i < assessmentItems.length; i++) {
        if (assessmentItems[i].index === data.index) { item = assessmentItems[i]; break }
      }
      var el = item ? locateElement(item.locator) : null
      if (el) {
        var rect = el.getBoundingClientRect()
        var isInViewport = rect.top >= 0 && rect.left >= 0 &&
                           rect.bottom <= window.innerHeight && rect.right <= window.innerWidth
        if (!isInViewport) {
          el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'nearest' })
        }
      }
      var activeEntry = null
      for (var r = 0; r < pinRegistry.length; r++) {
        if (pinRegistry[r].indices.indexOf(data.index) !== -1) { activeEntry = pinRegistry[r]; break }
      }
      if (activeEntry) {
        var pinRect = activeEntry.pinEl.getBoundingClientRect()
        window.parent.postMessage({
          type: 'od:assessment-pin-position',
          index: data.index,
          pinPosition: { left: pinRect.left, top: pinRect.top, width: pinRect.width, height: pinRect.height }
        }, '*')
      }
      return
    }
  })

  window.addEventListener('resize', function() {
    if (assessmentEnabled && assessmentItems.length > 0) renderPins()
  })

  // pin 弹窗打开期间,iframe 内点击弹窗外区域 → 通知父窗口关闭弹窗并取消激活（需求 :82）。
  // 捕获阶段监听 + pin 命中排除（pin 自身点击走 pin-click 流程,不该触发 external）。
  document.addEventListener('click', function(ev) {
    if (!assessmentEnabled) return
    var el = ev.target
    while (el && el !== document.documentElement) {
      if (el.getAttribute && el.getAttribute('data-od-assessment-pin')) return
      el = el.parentElement
    }
    window.parent.postMessage({ type: 'od:assessment-external-click' }, '*')
  }, true)

  setTimeout(function() {
    window.parent.postMessage({ type: 'od:assessment-request-data' }, '*')
  }, 100)
})();</script>`

export function injectAssessmentBridge(doc: string): string {
  if (/<head[^>]*>/i.test(doc)) {
    doc = doc.replace(/<head[^>]*>/i, (m) => m + '<style>' + ASSESSMENT_PIN_CSS + '</style>')
  } else if (/<body[^>]*>/i.test(doc)) {
    doc = doc.replace(/<body[^>]*>/i, (m) => '<style>' + ASSESSMENT_PIN_CSS + '</style>' + m)
  }

  if (/<\/body>/i.test(doc)) {
    doc = doc.replace(/<\/body>/i, ASSESSMENT_BRIDGE_SCRIPT + '</body>')
  } else {
    doc = doc + ASSESSMENT_BRIDGE_SCRIPT
  }

  return doc
}
