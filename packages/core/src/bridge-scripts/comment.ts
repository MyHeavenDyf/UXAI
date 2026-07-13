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
      return
    }
  })

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
      ev.preventDefault()
      ev.stopPropagation()
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
    var t = ev.target
    var walk = t && t.nodeType === 1 ? t : null
    while (walk && walk !== document.documentElement) {
      var tag = walk.tagName
      if (tag === 'A' || tag === 'BUTTON' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'LABEL') return
      if (walk.isContentEditable) return
      walk = walk.parentElement
    }
    ev.preventDefault()
    ev.stopPropagation()
    
    var viewport = document.documentElement.getBoundingClientRect()
    var x = (ev.clientX - viewport.left) / viewport.width
    var y = (ev.clientY - viewport.top) / viewport.height
    
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
    while (el && el !== document.body) {
      if (el.getAttribute && el.getAttribute('data-od-id')) {
        return { target: el }
      }
      el = el.parentElement
    }
    return null
  }

  function buildTargetPayload(target) {
    var rect = target.getBoundingClientRect()
    var viewport = document.documentElement.getBoundingClientRect()
    var position = {
      x: (rect.left - viewport.left) / viewport.width,
      y: (rect.top - viewport.top) / viewport.height,
      w: rect.width / viewport.width,
      h: rect.height / viewport.height
    }
    
    return {
      elementId: target.getAttribute('data-od-id'),
      selector: buildSelector(target),
      label: inferLabel(target),
      text: (target.textContent || '').trim().slice(0, 40),
      position: position,
      htmlHint: target.outerHTML.slice(0, 200)
    }
  }

  function buildSelector(el) {
    var parts = []
    while (el && el !== document.body) {
      var part = el.tagName.toLowerCase()
      if (el.id) part += '#' + el.id
      var classAttr = el.getAttribute('class')
      if (classAttr) {
        var firstClass = classAttr.split(' ')[0]
        if (firstClass) part += '.' + firstClass
      }
      parts.unshift(part)
      el = el.parentElement
    }
    return parts.join(' > ')
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

  function renderSavedPins(comments) {
    // 1. 更新现有 pin 的位置或创建新的
    comments.forEach(function(comment) {
      var existingPin = document.querySelector('[data-od-comment-pin="' + comment.id + '"]')
      
      var leftPercent, topPercent
      
      var targetElement = document.querySelector('[data-od-id="' + comment.elementId + '"]')
      
      if (targetElement) {
        var rect = targetElement.getBoundingClientRect()
        var viewport = document.documentElement.getBoundingClientRect()
        
        leftPercent = ((rect.left - viewport.left + rect.width) / viewport.width) * 100
        topPercent = ((rect.top - viewport.top) / viewport.height) * 100
      } else {
        leftPercent = (comment.position.x + comment.position.w) * 100
        topPercent = (comment.position.y) * 100
      }
      
      if (existingPin) {
        // pin 已存在，只更新位置
        existingPin.style.left = 'calc(' + leftPercent + '% - 20px)'
        existingPin.style.top = 'calc(' + topPercent + '% - 20px)'
      } else {
        // 创建新的 pin
        var pin = document.createElement('div')
        pin.setAttribute('data-od-comment-pin', comment.id)
        
        pin.style.cssText = 'position:absolute;left:calc(' + leftPercent + '% - 20px);top:calc(' + topPercent + '% - 20px);width:20px;height:20px;background:#1677ff;border-radius:50%;align-items:center;justify-content:center;color:white;font-size:10px;cursor:pointer;z-index:999;box-shadow:0 2px 4px rgba(0,0,0,0.2);'
        pin.innerHTML = '💬'
        
        pin.addEventListener('pointerenter', function(e) {
          e.stopPropagation()
          var rect = pin.getBoundingClientRect()
          window.parent.postMessage({
            type: 'od:comment-pin-hover',
            commentId: comment.id,
            position: {
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height
            }
          }, '*')
        })
        
        pin.addEventListener('pointerleave', function(e) {
          e.stopPropagation()
          window.parent.postMessage({
            type: 'od:comment-pin-leave'
          }, '*')
        })
        
        pin.addEventListener('click', function(e) {
          e.stopPropagation()
          
          var prevActive = document.querySelector('[data-od-comment-active]')
          if (prevActive) {
            prevActive.removeAttribute('data-od-comment-active')
          }
          
          var targetElement = document.querySelector('[data-od-id="' + comment.elementId + '"]')
          if (targetElement) {
            targetElement.setAttribute('data-od-comment-active', 'true')
          }
          
          window.parent.postMessage({
            type: 'od:comment-pin-click',
            commentId: comment.id
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