export const COMMENT_OUTLINE_CSS = `
html[data-od-comment-mode] body * { cursor: pointer !important; }

html[data-od-comment-mode] [data-od-id]:hover {
  outline: 2px solid #1677ff;
  outline-offset: 2px;
}

html[data-od-comment-mode] [data-od-comment-active] {
  outline: 2px solid #1677ff;
  outline-offset: 2px;
}

[data-od-comment-pin] {
  display: none !important;
}

html[data-od-comment-mode] [data-od-comment-pin] {
  display: flex !important;
}

[data-od-comment-pin-active] {
  border: 1.5px solid #0a59f7 !important;
}
`

export const COMMENT_BRIDGE_SCRIPT = `<script data-od-comment-bridge>(function(){
  let commentEnabled = false
  let hoveredElementId = null
  let savedPins = []
  let lastUpdateTime = 0
  let animationFrameId = null

  window.addEventListener('message', function(ev) {
    var data = ev && ev.data
    if (!data || !data.type) return

    if (data.type === 'od:comment-mode') {
      commentEnabled = !!data.enabled
      document.documentElement.toggleAttribute('data-od-comment-mode', commentEnabled)
      if (commentEnabled) {
        document.body.style.cursor = 'pointer'
        window.parent.postMessage({ type: 'od:comment-request-pins' }, '*')
        updatePinPositionsLoop()
        document.addEventListener('mousedown', blockEvent, true)
        document.addEventListener('mouseup', blockEvent, true)
        document.addEventListener('keydown', blockEvent, true)
        document.addEventListener('keyup', blockEvent, true)
        document.addEventListener('dblclick', blockEvent, true)
      } else {
        document.body.style.cursor = ''
        hoveredElementId = null
        var activeElements = document.querySelectorAll('[data-od-comment-active]')
        for (var i = 0; i < activeElements.length; i++) {
          activeElements[i].removeAttribute('data-od-comment-active')
        }
        if (animationFrameId) {
          cancelAnimationFrame(animationFrameId)
          animationFrameId = null
        }
        document.removeEventListener('mousedown', blockEvent, true)
        document.removeEventListener('mouseup', blockEvent, true)
        document.removeEventListener('keydown', blockEvent, true)
        document.removeEventListener('keyup', blockEvent, true)
        document.removeEventListener('dblclick', blockEvent, true)
      }
      return
    }

    if (data.type === 'od:comment-saved-pins') {
      savedPins = data.comments || []
      renderSavedPins(savedPins)
      return
    }
    
    if (data.type === 'od:comment-clear') {
      var activeElements = document.querySelectorAll('[data-od-comment-active]')
      for (var i = 0; i < activeElements.length; i++) {
        activeElements[i].removeAttribute('data-od-comment-active')
      }
      var activePins = document.querySelectorAll('[data-od-comment-pin-active]')
      for (var j = 0; j < activePins.length; j++) {
        activePins[j].removeAttribute('data-od-comment-pin-active')
      }
      return
    }
    
    if (data.type === 'od:comment-set-active') {
      var prevActive = document.querySelector('[data-od-comment-active]')
      if (prevActive) prevActive.removeAttribute('data-od-comment-active')
      
      var prevActivePin = document.querySelector('[data-od-comment-pin-active]')
      if (prevActivePin) prevActivePin.removeAttribute('data-od-comment-pin-active')
      
      var targetElement = findElementByStrategies(data)
      if (targetElement) {
        targetElement.setAttribute('data-od-comment-active', 'true')
        
        var rect = targetElement.getBoundingClientRect()
        var isInViewport = rect.top >= 0 && 
                           rect.left >= 0 && 
                           rect.bottom <= window.innerHeight && 
                           rect.right <= window.innerWidth
        if (!isInViewport) {
          targetElement.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'nearest' })
        }
      }
      
      if (data.commentId) {
        var targetPin = document.querySelector('[data-od-comment-pin="' + data.commentId + '"]')
        if (targetPin) targetPin.setAttribute('data-od-comment-pin-active', 'true')
      }
      
      if (data.commentId) {
        var pin = document.querySelector('[data-od-comment-pin="' + data.commentId + '"]')
        if (pin) {
          var rect = pin.getBoundingClientRect()
          window.parent.postMessage({
            type: 'od:comment-pin-position',
            commentId: data.commentId,
            pinPosition: {
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height
            }
          }, '*')
        }
      }
      return
    }
    
    if (data.type === 'od:comment-get-pin-position') {
      var pin = document.querySelector('[data-od-comment-pin="' + data.commentId + '"]')
      if (pin) {
        var rect = pin.getBoundingClientRect()
        window.parent.postMessage({
          type: 'od:comment-pin-position',
          commentId: data.commentId,
          pinPosition: {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height
          }
        }, '*')
      }
      return
    }
  })

  function blockEvent(ev) {
    if (!commentEnabled) return
    var el = ev.target
    while (el && el !== document.documentElement) {
      if (el.getAttribute && el.getAttribute('data-od-comment-pin')) return
      el = el.parentElement
    }
    ev.preventDefault()
    ev.stopPropagation()
  }

  document.addEventListener('click', function(ev) {
    if (!commentEnabled) return
    
// Check if clicking on a comment pin - let pin's own handler handle it
  var clickedElement = ev.target
  while (clickedElement && clickedElement !== document.documentElement) {
    if (clickedElement.getAttribute && clickedElement.getAttribute('data-od-comment-pin')) {
      return
    }
    clickedElement = clickedElement.parentElement
  }
  
  ev.preventDefault()
  ev.stopPropagation()
  
  // 检查是否正在编辑评论（有 active 元素）
  var activeElement = document.querySelector('[data-od-comment-active]')
  if (activeElement) {
    // 正在编辑评论，点击 iframe 内部元素
    // 发送消息到父窗口，表示外部点击
    window.parent.postMessage({ type: 'od:comment-external-click' }, '*')
    return
  }
  
  var result = findCommentTarget(ev.target)
    if (result) {
      var target = result.target
      
      var prevActive = document.querySelector('[data-od-comment-active]')
      if (prevActive) {
        prevActive.removeAttribute('data-od-comment-active')
      }
      
      target.setAttribute('data-od-comment-active', 'true')
      
      var payload = buildTargetPayload(target)
      payload.hoverPoint = { x: ev.clientX, y: ev.clientY }
      window.parent.postMessage(Object.assign({}, payload, { type: 'od:comment-target' }), '*')
      return
    }
    
    // Free-pin fallback for elements without data-od-id
    if (!canUseDomFallback()) return
    
    var scrollX = window.scrollX || document.documentElement.scrollLeft
    var scrollY = window.scrollY || document.documentElement.scrollTop
    var docWidth = document.documentElement.scrollWidth
    var docHeight = document.documentElement.scrollHeight
    
    var x = (ev.clientX + scrollX) / docWidth
    var y = (ev.clientY + scrollY) / docHeight
    
    window.parent.postMessage({
      type: 'od:comment-target',
      elementId: null,
      selector: '',
      label: 'Free pin',
      text: '',
      position: { x: x, y: y, w: 0.02, h: 0.02 },
      htmlHint: '',
      hoverPoint: { x: ev.clientX, y: ev.clientY }
    }, '*')
  }, true)

  function findCommentTarget(el) {
    while (el && el !== document.documentElement) {
      if (el.getAttribute && el.getAttribute('data-od-id')) {
        return { target: el }
      }
      el = el.parentElement
    }
    return null
  }

  function buildTargetPayload(target) {
    var rect = target.getBoundingClientRect()
    var scrollX = window.scrollX || document.documentElement.scrollLeft
    var scrollY = window.scrollY || document.documentElement.scrollTop
    var docWidth = document.documentElement.scrollWidth
    var docHeight = document.documentElement.scrollHeight
    
    var position = {
      x: (rect.left + scrollX) / docWidth,
      y: (rect.top + scrollY) / docHeight,
      w: rect.width / docWidth,
      h: rect.height / docHeight
    }
    
    return {
      elementId: target.getAttribute('data-od-id'),
      selector: buildSelector(target),
      contentSignature: buildContentSignature(target),
      nativeId: getNativeId(target),
      label: inferLabel(target),
      text: (target.textContent || '').trim().slice(0, 40),
      position: position,
      htmlHint: target.outerHTML.slice(0, 200)
    }
  }

  function buildSelector(el) {
    if (el === document.body) {
      return 'body'
    }
    
    var parts = []
    while (el && el !== document.body) {
      var part = el.tagName.toLowerCase()
      
      if (el.id && !el.id.match(/^el-\d+$/)) {
        part += '#' + CSS.escape(el.id)
      } else {
        var classAttr = el.getAttribute('class')
        if (classAttr) {
          var classes = classAttr.split(' ').filter(function(c) { 
            return c && !c.match(/^[._]?[a-f0-9]{6,}$/i)
          }).slice(0, 3)
          if (classes.length > 0) {
            part += '.' + classes.map(function(c) { return CSS.escape(c) }).join('.')
          }
        }
        
        var parent = el.parentElement
        if (parent) {
          var siblings = Array.prototype.filter.call(parent.children, function(c) { 
            return c.tagName === el.tagName 
          })
          if (siblings.length > 1) {
            var index = Array.prototype.indexOf.call(siblings, el) + 1
            part += ':nth-of-type(' + index + ')'
          }
        }
      }
      
      parts.unshift(part)
      el = el.parentElement
    }
    return parts.join(' > ')
  }
  
  function buildContentSignature(el) {
    var text = (el.textContent || '').trim().slice(0, 100)
    var tag = el.tagName.toLowerCase()
    var classAttr = el.getAttribute('class') || ''
    var firstClass = classAttr.split(' ')[0] || ''
    return tag + '|' + firstClass + '|' + text
  }
  
  function getNativeId(el) {
    var id = el.id
    if (id && !id.match(/^el-\d+$/)) {
      return id
    }
    return null
  }
  
  function findElementByStrategies(comment) {
    var targetElement = null
    
    if (comment.selector) {
      try {
        targetElement = document.querySelector(comment.selector)
      } catch (e) {}
    }
    
    if (!targetElement && comment.contentSignature) {
      targetElement = findByContentSignature(comment.contentSignature, comment.position)
    }
    
    if (!targetElement && comment.nativeId) {
      targetElement = document.getElementById(comment.nativeId)
    }
    
    if (!targetElement && comment.elementId) {
      targetElement = document.querySelector('[data-od-id="' + comment.elementId + '"]')
    }
    
    return targetElement
  }
  
  function findByContentSignature(signature, position) {
    var parts = signature.split('|')
    if (parts.length < 3) return null
    
    var tag = parts[0]
    var firstClass = parts[1]
    var text = parts.slice(2).join('|')
    
    var selector = tag
    if (firstClass) {
      try {
        selector += '.' + CSS.escape(firstClass)
      } catch (e) {
        selector += '.' + firstClass
      }
    }
    
    var candidates = document.querySelectorAll(selector)
    var matches = []
    
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i]
      var elText = (el.textContent || '').trim().slice(0, 100)
      if (elText === text) {
        matches.push(el)
      }
    }
    
    if (matches.length === 1) return matches[0]
    
    if (matches.length > 1 && position) {
      var scrollX = window.scrollX || document.documentElement.scrollLeft
      var scrollY = window.scrollY || document.documentElement.scrollTop
      var docWidth = document.documentElement.scrollWidth
      var docHeight = document.documentElement.scrollHeight
      
      var bestMatch = null
      var bestDistance = Infinity
      
      for (var j = 0; j < matches.length; j++) {
        var el = matches[j]
        var rect = el.getBoundingClientRect()
        var elX = (rect.left + scrollX) / docWidth
        var elY = (rect.top + scrollY) / docHeight
        
        var distance = Math.abs(elX - position.x) + Math.abs(elY - position.y)
        if (distance < bestDistance) {
          bestDistance = distance
          bestMatch = el
        }
      }
      
      if (bestDistance < 0.1) return bestMatch
    }
    
    return null
  }

  function inferLabel(el) {
    var tag = el.tagName.toLowerCase()
    var id = el.id
    var classAttr = el.getAttribute('class')
    var firstClass = classAttr ? classAttr.split(' ')[0] : null
    if (id) return tag + '#' + id
    if (firstClass) return tag + '.' + firstClass
    return tag.charAt(0).toUpperCase() + tag.slice(1)
  }

  function canUseDomFallback() {
    return true
  }

  function isElementVisible(el) {
    if (!el) return false
    if (!document.body.contains(el)) return false
    
    var current = el
    while (current && current !== document.documentElement) {
      var style = window.getComputedStyle(current)
      
      if (style.display === 'none') return false
      if (style.visibility === 'hidden') return false
      if (current === el && style.pointerEvents === 'none') return false
      
      current = current.parentElement
    }
    
    return true
  }

  function renderSavedPins(comments) {
    comments.forEach(function(comment) {
      var existingPin = document.querySelector('[data-od-comment-pin="' + comment.id + '"]')
      var targetElement = findElementByStrategies(comment)
      
      if (!isElementVisible(targetElement)) {
        if (existingPin) {
          existingPin.style.display = 'none'
        }
        return
      }
      
      var rect = targetElement.getBoundingClientRect()
      var scrollX = window.scrollX || document.documentElement.scrollLeft
      var scrollY = window.scrollY || document.documentElement.scrollTop
      var viewportWidth = document.documentElement.clientWidth
      
      var leftPx = rect.left + scrollX + rect.width
      var topPx = rect.top + scrollY - 40
      
      var overflowTop = rect.top + scrollY < 40
      var overflowRight = leftPx + 40 > viewportWidth + scrollX
      
      var pinLeft = overflowRight ? (leftPx - 40) : leftPx
      var pinTop = overflowTop ? (rect.top + scrollY) : topPx
      
      var showOverlap = overflowTop || overflowRight
      
      if (existingPin) {
        existingPin.style.display = 'flex'
        existingPin.style.left = pinLeft + 'px'
        existingPin.style.top = pinTop + 'px'
      } else {
        var pin = document.createElement('div')
        pin.setAttribute('data-od-comment-pin', comment.id)
        if (showOverlap) {
          pin.setAttribute('data-od-comment-pin-overlap', 'true')
        }
        
        pin.style.cssText = 'position:absolute;left:' + pinLeft + 'px;top:' + pinTop + 'px;width:40px;height:40px;background:#fff;border:none;border-radius:999px 999px 999px 0;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:2147483647;box-sizing:border-box;box-shadow:0 2px 8px rgba(0,0,0,0.15);'
        
        if (comment.commenterAvatar) {
          pin.innerHTML = '<img src="' + comment.commenterAvatar + '" style="width:32px;height:32px;border-radius:50%;object-fit:cover;display:block;" />'
        } else {
          var fallback = document.createElement('div')
          fallback.style.cssText = 'width:32px;height:32px;border-radius:50%;background:#0a59f7;display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px;font-weight:600;'
          fallback.textContent = (comment.commenterName || '用户').charAt(0)
          pin.appendChild(fallback)
        }
        
        pin.addEventListener('pointerenter', function(e) {
          e.stopPropagation()
          var rect = pin.getBoundingClientRect()
          var showOverlap = pin.getAttribute('data-od-comment-pin-overlap') === 'true'
          window.parent.postMessage({
            type: 'od:comment-pin-hover',
            commentId: comment.id,
            position: {
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height
            },
            showOverlap: showOverlap
          }, '*')
        })
        
        pin.addEventListener('click', function(e) {
          e.stopPropagation()
          
          var prevActive = document.querySelector('[data-od-comment-active]')
          if (prevActive) {
            prevActive.removeAttribute('data-od-comment-active')
          }
          
          var prevActivePin = document.querySelector('[data-od-comment-pin-active]')
          if (prevActivePin) {
            prevActivePin.removeAttribute('data-od-comment-pin-active')
          }
          
          var targetElement = findElementByStrategies(comment)
          if (targetElement) {
            targetElement.setAttribute('data-od-comment-active', 'true')
          }
          
          pin.setAttribute('data-od-comment-pin-active', 'true')
          
          var rect = pin.getBoundingClientRect()
          window.parent.postMessage({
            type: 'od:comment-pin-click',
            commentId: comment.id,
            pinPosition: {
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height
            }
          }, '*')
        })
        
        document.body.appendChild(pin)
      }
    })
    
    // 2. 移除不再存在的评论的 pin
    var currentIds = comments.map(function(c) { return c.id })
    document.querySelectorAll('[data-od-comment-pin]').forEach(function(p) {
      var pinId = p.getAttribute('data-od-comment-pin')
      if (currentIds.indexOf(pinId) === -1) {
        p.remove()
      }
    })
  }
  
  function updatePinPositionsLoop() {
    const now = Date.now()
    if (now - lastUpdateTime >= 60) {
      lastUpdateTime = now
      if (commentEnabled && savedPins.length > 0) {
        renderSavedPins(savedPins)
      }
    }
    animationFrameId = requestAnimationFrame(updatePinPositionsLoop)
  }
  
  window.addEventListener('resize', function() {
    if (commentEnabled) {
      renderSavedPins(savedPins)
    }
  })
  
  // Request saved comments from parent on load
  setTimeout(function() {
    window.parent.postMessage({ type: 'od:comment-request-pins' }, '*')
  }, 100)
})();</script>`

export function injectCommentBridge(doc: string): string {
  // Inject outline CSS in <head>
  if (/<head[^>]*>/i.test(doc)) {
    doc = doc.replace(/<head[^>]*>/i, function(m) { 
      return m + '<style>' + COMMENT_OUTLINE_CSS + '</style>'
    })
  } else if (/<body[^>]*>/i.test(doc)) {
    doc = doc.replace(/<body[^>]*>/i, function(m) {
      return '<style>' + COMMENT_OUTLINE_CSS + '</style>' + m
    })
  }

  // Inject bridge script before </body>
  if (/<\/body>/i.test(doc)) {
    doc = doc.replace(/<\/body>/i, COMMENT_BRIDGE_SCRIPT + '</body>')
  } else {
    doc = doc + COMMENT_BRIDGE_SCRIPT
  }

  return doc
}