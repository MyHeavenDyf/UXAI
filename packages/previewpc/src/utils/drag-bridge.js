/**
 * Drag-to-reorder bridge injected into the preview iframe.
 *
 * Messages:
 *   parent -> iframe:  { type: "DRAG_MODE", enabled: true|false }
 *   iframe -> parent:  { type: "DRAG_REORDER", elementId, targetSiblingId, position: "before"|"after" }
 *
 * Uses the A2UI renderer's `dom-picker-id` attribute (= A2UI element id)
 * which is always present on every rendered element.
 */
;(function () {
  var ATTR = "dom-picker-id"
  var dragMode = false
  var siblingMap = {}
  var dragEl = null
  var dragId = null
  var siblings = []
  var ghost = null
  var indicator = null
  var moved = false
  var offX = 0
  var offY = 0
  var hoverEl = null

  function attrSelector(id) {
    return "[" + ATTR + '="' + String(id).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"]'
  }

  function baseId(id) {
    return typeof id === "string" ? id.replace(/(:\d+)+$/, "") : ""
  }

  function idOf(el) {
    return el ? el.getAttribute(ATTR) || "" : ""
  }

  function mappedIds(id) {
    if (!id) return []
    var ids = siblingMap[id] || siblingMap[baseId(id)]
    return Array.isArray(ids) ? ids : []
  }

  function findById(id, nearEl) {
    var exact = document.querySelector(attrSelector(id))
    if (exact) return exact
    var base = baseId(id)
    if (!base || base === id) return null
    var all = document.querySelectorAll("[" + ATTR + "]")
    var best = null
    var bestDistance = Infinity
    var nearRect = nearEl ? nearEl.getBoundingClientRect() : null
    for (var i = 0; i < all.length; i++) {
      if (baseId(idOf(all[i])) !== base) continue
      if (!nearRect) return all[i]
      var r = all[i].getBoundingClientRect()
      var d = Math.abs(r.left - nearRect.left) + Math.abs(r.top - nearRect.top)
      if (d < bestDistance) {
        best = all[i]
        bestDistance = d
      }
    }
    return best
  }

  function mappedSibs(el) {
    var ids = mappedIds(idOf(el))
    if (ids.length < 2) return []
    var r = []
    for (var i = 0; i < ids.length; i++) {
      var item = findById(ids[i], el)
      if (item && r.indexOf(item) === -1) r.push(item)
    }
    return r
  }

  function domSibs(el) {
    var p = el.parentElement
    if (!p) return []
    var r = []
    for (var i = 0; i < p.children.length; i++)
      if (p.children[i].hasAttribute(ATTR)) r.push(p.children[i])
    return r
  }

  function getSibs(el) {
    var mapped = mappedSibs(el)
    return mapped.length > 1 ? mapped : domSibs(el)
  }

  function draggable(target) {
    if (!target || !target.closest) return null
    var first = target.closest("[" + ATTR + "]")
    var el = first
    while (el) {
      if (getSibs(el).length > 1) return el
      el = el.parentElement ? el.parentElement.closest("[" + ATTR + "]") : null
    }
    return first
  }

  function orderedSibs(sibs, dir) {
    return sibs.slice().sort(function (a, b) {
      var ar = a.getBoundingClientRect()
      var br = b.getBoundingClientRect()
      return dir === "h" ? ar.left - br.left : ar.top - br.top
    })
  }

  function direction(sibs) {
    if (sibs.length < 2) return "v"
    var a = sibs[0].getBoundingClientRect()
    var b = sibs[1].getBoundingClientRect()
    return Math.abs(a.left - b.left) > Math.abs(a.top - b.top) ? "h" : "v"
  }

  function hideBadges() {
    var e = document.querySelectorAll("[dom-picker-overlay],[dom-picker-badge]")
    for (var i = 0; i < e.length; i++) e[i].style.display = "none"
  }

  function makeGhost(el) {
    var r = el.getBoundingClientRect()
    var g = el.cloneNode(true)
    g.style.cssText =
      "position:fixed;z-index:99999;pointer-events:none;opacity:0.85;" +
      "left:" + r.left + "px;top:" + r.top + "px;" +
      "box-shadow:0 8px 24px rgba(0,123,255,.35);border:2px solid #007bff;" +
      "border-radius:6px;background:rgba(255,255,255,.95);overflow:hidden;"
    g.style.setProperty("width", r.width + "px", "important")
    g.style.setProperty("height", r.height + "px", "important")
    g.style.setProperty("min-width", r.width + "px", "important")
    g.style.setProperty("max-width", r.width + "px", "important")
    document.body.appendChild(g)
    return g
  }

  function makeIndicator() {
    var d = document.createElement("div")
    d.style.cssText =
      "position:fixed;z-index:99998;pointer-events:none;background:#007bff;" +
      "box-shadow:0 0 6px rgba(0,123,255,.8);border-radius:2px;display:none;"
    document.body.appendChild(d)
    return d
  }

  function hideIndicator() {
    if (indicator) indicator.style.display = "none"
  }

  function dropTarget(e, sibs, dragged, dir) {
    var x = e.clientX, y = e.clientY
    var ordered = orderedSibs(sibs, dir)
    for (var i = 0; i < ordered.length; i++) {
      var s = ordered[i]
      if (s === dragged) continue
      var r = s.getBoundingClientRect()
      var mid = dir === "h" ? r.left + r.width / 2 : r.top + r.height / 2
      var pos = dir === "h" ? x : y
      var lo = dir === "h" ? r.left : r.top
      var hi = dir === "h" ? r.right : r.bottom
      if (pos >= lo && pos <= hi) return { el: s, before: pos < mid }
    }
    if (ordered.length) {
      var f = ordered[0]
      if (f !== dragged) {
        var fr = f.getBoundingClientRect()
        if ((dir === "h" && x < fr.left) || (dir === "v" && y < fr.top))
          return { el: f, before: true }
      }
      var l = ordered[ordered.length - 1]
      if (l !== dragged) {
        var lr = l.getBoundingClientRect()
        if ((dir === "h" && x > lr.right) || (dir === "v" && y > lr.bottom))
          return { el: l, before: false }
      }
    }
    return null
  }

  function showIndicator(t, dir) {
    if (!indicator) return
    if (!t) {
      hideIndicator()
      return
    }
    var r = t.el.getBoundingClientRect()
    if (dir === "h") {
      indicator.style.cssText =
        "position:fixed;z-index:99998;pointer-events:none;background:#007bff;" +
        "box-shadow:0 0 6px rgba(0,123,255,.8);border-radius:2px;display:block;" +
        "height:" + r.height + "px;width:3px;top:" + r.top + "px;left:" +
        (t.before ? r.left - 2 : r.right - 1) + "px;"
      return
    }
    indicator.style.cssText =
      "position:fixed;z-index:99998;pointer-events:none;background:#007bff;" +
      "box-shadow:0 0 6px rgba(0,123,255,.8);border-radius:2px;display:block;" +
      "width:" + r.width + "px;height:3px;left:" + r.left + "px;top:" +
      (t.before ? r.top - 2 : r.bottom - 1) + "px;"
  }

  function onDown(e) {
    if (!dragMode || e.button !== 0) return
    var el = draggable(e.target)
    if (!el) return
    e.preventDefault()
    e.stopPropagation()
    dragEl = el
    dragId = idOf(el)
    siblings = getSibs(el)
    moved = false
    var r = el.getBoundingClientRect()
    offX = e.clientX - r.left
    offY = e.clientY - r.top
    el.setAttribute("data-drag-sel", "1")
    window.addEventListener("pointermove", onMove, true)
    window.addEventListener("pointerup", onUp, true)
  }

  function onMove(e) {
    if (!dragEl) return
    e.preventDefault()
    e.stopPropagation()
    if (!moved) {
      var sr = dragEl.getBoundingClientRect()
      if (Math.abs(e.clientX - (sr.left + offX)) < 3 && Math.abs(e.clientY - (sr.top + offY)) < 3) return
      moved = true
      hideBadges()
      ghost = makeGhost(dragEl)
      indicator = makeIndicator()
      dragEl.style.opacity = "0.25"
      document.body.style.cursor = "grabbing"
    }
    if (ghost) {
      ghost.style.left = e.clientX - offX + "px"
      ghost.style.top = e.clientY - offY + "px"
    }
    var dir = direction(siblings)
    var t = dropTarget(e, siblings, dragEl, dir)
    showIndicator(t, dir)
  }

  function onUp(e) {
    window.removeEventListener("pointermove", onMove, true)
    window.removeEventListener("pointerup", onUp, true)
    if (!dragEl) return
    if (moved) {
      var dir = direction(siblings)
      var t = dropTarget(e, siblings, dragEl, dir)
      if (t) {
        var tid = idOf(t.el)
        if (tid && tid !== dragId) {
          window.parent.postMessage({
            type: "DRAG_REORDER",
            elementId: dragId,
            targetSiblingId: tid,
            position: t.before ? "before" : "after",
          }, "*")
        }
      }
      if (ghost) { ghost.remove(); ghost = null }
      if (indicator) { indicator.remove(); indicator = null }
      document.body.style.cursor = ""
    }
    dragEl.style.opacity = ""
    dragEl.removeAttribute("data-drag-sel")
    dragEl = null
    dragId = null
    moved = false
  }

  function onHover(e) {
    if (!dragMode || dragEl) return
    var el = draggable(e.target)
    if (el === hoverEl) return
    if (hoverEl) hoverEl.removeAttribute("data-drag-hov")
    hoverEl = el
    if (el) el.setAttribute("data-drag-hov", "1")
  }

  function kill(e) {
    if (!dragMode) return
    e.preventDefault()
    e.stopPropagation()
  }

  function enable() {
    dragMode = true
    document.documentElement.setAttribute("data-drag-mode", "1")
    window.addEventListener("pointerdown", onDown, true)
    window.addEventListener("pointermove", onHover, true)
    window.addEventListener("click", kill, true)
    window.addEventListener("contextmenu", kill, true)
    document.body.style.cursor = "grab"
  }

  function disable() {
    dragMode = false
    document.documentElement.removeAttribute("data-drag-mode")
    window.removeEventListener("pointerdown", onDown, true)
    window.removeEventListener("pointermove", onHover, true)
    window.removeEventListener("click", kill, true)
    window.removeEventListener("contextmenu", kill, true)
    window.removeEventListener("pointermove", onMove, true)
    window.removeEventListener("pointerup", onUp, true)
    document.body.style.cursor = ""
    if (hoverEl) { hoverEl.removeAttribute("data-drag-hov"); hoverEl = null }
    if (dragEl) { dragEl.style.opacity = ""; dragEl.removeAttribute("data-drag-sel"); dragEl = null }
    if (ghost) { ghost.remove(); ghost = null }
    if (indicator) { indicator.remove(); indicator = null }
  }

  window.addEventListener("message", function (ev) {
    var d = ev && ev.data
    if (!d || d.type !== "DRAG_MODE") return
    siblingMap = d.siblingMap && typeof d.siblingMap === "object" ? d.siblingMap : {}
    if (d.enabled) enable()
    else disable()
  })

  var s = document.createElement("style")
  s.textContent =
    "[data-drag-mode] body{cursor:grab!important}" +
    "[data-drag-mode] [dom-picker-id]{cursor:grab!important}" +
    "[data-drag-mode] [data-drag-hov]{outline:2px solid #007bff!important;outline-offset:2px}" +
    "[data-drag-mode] [data-drag-sel]{outline:2px solid #007bff!important;outline-offset:2px}" +
    "[data-drag-mode] #dom-picker-overlay{display:none!important}" +
    "[data-drag-mode] #dom-picker-badge{display:none!important}"
  ;(document.head || document.documentElement).appendChild(s)
})()
