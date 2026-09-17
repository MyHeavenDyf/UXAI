export const MODEL_EDIT_BRIDGE_SCRIPT = `<script data-od-model-edit-bridge>(function(){

function me_runBridge() {
  var me_enabled = false;
  var me_componentFlag = null;
  var me_htmlFlag = null;
  var me_annotateNextId = -1;

  var me_depth = 0;
  (function() {
    var f = window.frameElement;
    while (f) { me_depth++; var w = f.ownerDocument.defaultView; f = w ? w.frameElement : null; }
  })();
  var me_idPrefix = me_depth > 0 ? 'if' + me_depth + '-' : '';

  function me_getOffsetToTop() {
    var x = 0, y = 0;
    var f = window.frameElement;
    while (f) {
      var r = f.getBoundingClientRect();
      x += r.left;
      y += r.top;
      var w = f.ownerDocument.defaultView;
      f = w ? w.frameElement : null;
    }
    return { x: x, y: y };
  }

  var me_trackId = null;
  var me_trackRaf = 0;
  var me_trackRo = null;
  function me_trackSend() {
    if (!me_trackId) return;
    var el = document.querySelector('[data-od-id="' + me_trackId + '"]');
    if (!el) return;
    var r = el.getBoundingClientRect();
    var off = me_getOffsetToTop();
    window.parent.postMessage({ type: 'od:rect-update', elementId: me_trackId, rect: { x: r.left + off.x, y: r.top + off.y, width: r.width, height: r.height } }, '*');
  }
  function me_trackRefresh() {
    if (me_trackRaf) cancelAnimationFrame(me_trackRaf);
    me_trackRaf = requestAnimationFrame(function() { me_trackRaf = 0; me_trackSend(); });
  }
  function me_startTrack(id) {
    me_stopTrack();
    me_trackId = id;
    me_trackSend();
    window.addEventListener('scroll', me_trackRefresh, true);
    window.addEventListener('resize', me_trackRefresh);
    if (typeof ResizeObserver !== 'undefined' && document.documentElement) {
      me_trackRo = new ResizeObserver(function() { me_trackRefresh(); });
      me_trackRo.observe(document.documentElement);
    }
  }
  function me_stopTrack() {
    if (me_trackId) {
      window.removeEventListener('scroll', me_trackRefresh, true);
      window.removeEventListener('resize', me_trackRefresh);
      if (me_trackRo) { me_trackRo.disconnect(); me_trackRo = null; }
      if (me_trackRaf) { cancelAnimationFrame(me_trackRaf); me_trackRaf = 0; }
      me_trackId = null;
    }
  }

  function me_tagLabel(el) {
    var t = el.tagName ? el.tagName.toLowerCase() : '';
    var c = el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).join('.') : '';
    var nth = 1;
    var parent = el.parentElement;
    if (parent) {
      for (var i = 0; i < parent.children.length; i++) {
        if (parent.children[i] === el) { nth = i + 1; break; }
      }
    }
    return t + c + ':nth-child(' + nth + ')';
  }

  function me_buildSelector(el) {
    var parts = [];
    var cur = el;
    for (var i = 0; i < 5 && cur && cur !== document.body && cur !== document.documentElement; i++) {
      parts.unshift(me_tagLabel(cur));
      cur = cur.parentElement;
    }
    var frameEl = window.frameElement;
    while (frameEl) {
      parts.unshift('>>>');
      var parentDoc = frameEl.ownerDocument;
      cur = frameEl;
      for (var j = 0; j < 5 && cur && cur !== parentDoc.body && cur !== parentDoc.documentElement; j++) {
        parts.unshift(me_tagLabel(cur));
        cur = cur.parentElement;
      }
      var parentWin = parentDoc.defaultView;
      frameEl = parentWin ? parentWin.frameElement : null;
    }
    return parts.join(' > ').replace(/ > >>> > /g, ' >>> ');
  }

  function me_ensureAnnotatedId(el) {
    if (!el || !el.getAttribute) return null;
    var id = el.getAttribute('data-od-id');
    if (id) return id;
    var tag = el.tagName ? el.tagName.toUpperCase() : '';
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'HEAD') return null;
    if (me_annotateNextId < 0) {
      var els = document.querySelectorAll('[data-od-id]');
      for (var i = 0; i < els.length; i++) {
        var attr = els[i].getAttribute('data-od-id');
        if (attr && attr.indexOf(me_idPrefix + 'el-') === 0) {
          var n = parseInt(attr.substring((me_idPrefix + 'el-').length), 10);
          if (!isNaN(n) && n > me_annotateNextId) me_annotateNextId = n;
        }
      }
    }
    me_annotateNextId++;
    id = me_idPrefix + 'el-' + me_annotateNextId;
    el.setAttribute('data-od-id', id);
    return id;
  }

  function me_annotateRendered() {
    function walk(el) {
      if (el.nodeType !== 1) return;
      var tag = el.tagName ? el.tagName.toUpperCase() : '';
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'HEAD') return;
      me_ensureAnnotatedId(el);
      for (var i = 0; i < el.children.length; i++) walk(el.children[i]);
    }
    walk(document.body);
  }

  function me_buildTarget(el, selectionKind, componentType, htmlType) {
    if (!el || !el.getAttribute) return null;
    var id = me_ensureAnnotatedId(el);
    if (!id) return null;
    var tag = el.tagName.toLowerCase();
    var r = el.getBoundingClientRect();
    var off = me_getOffsetToTop();
    var rect = { left: r.left + off.x, top: r.top + off.y, width: r.width, height: r.height };
    var computed = window.getComputedStyle(el);
    var directTextParts = [];
    for (var i = 0; i < el.childNodes.length; i++) {
      var node = el.childNodes[i];
      if (node.nodeType === 3 && node.textContent && node.textContent.trim()) directTextParts.push(node.textContent.trim());
    }
    var directText = directTextParts.join(' ');
    var allText = el.textContent || '';
    var elementKind = 'container';
    if (tag === 'a') elementKind = 'link';
    else if (tag === 'img') elementKind = 'image';
    else if (allText.trim() && el.children.length === 0) elementKind = 'text';
    else if (['label','button','span','p','div'].indexOf(tag) >= 0 && directText.trim()) elementKind = 'mixed';
    var styles = {};
    var styleProps = ['fontFamily','fontSize','fontWeight','color','textAlign','lineHeight','letterSpacing','width','height','minHeight','gap','flexDirection','justifyContent','alignItems','backgroundColor','opacity','padding','paddingTop','paddingRight','paddingBottom','paddingLeft','margin','marginTop','marginRight','marginBottom','marginLeft','border','borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','borderStyle','borderColor','borderRadius','boxShadow','filter','backdropFilter','backgroundImage','overflow','borderTopLeftRadius','borderTopRightRadius','borderBottomRightRadius','borderBottomLeftRadius','verticalAlign'];
    styleProps.forEach(function(p) { styles[p] = computed[p] || ''; });
    var attributes = {};
    var attrNames = ['class','id','href','src','alt','title','data-od-label','aria-label','data-icon-name','data-icon-id','data-icon-custom','data-icon-src','data-icon-size','data-icon-style','data-icon-color'];
    if (me_htmlFlag) attrNames.push(me_htmlFlag);
    if (me_componentFlag) attrNames.push(me_componentFlag);
    attrNames.forEach(function(name) { var val = el.getAttribute(name); if (val) attributes[name] = val; });
    return {
      dataOdId: id, tagName: tag, className: el.getAttribute('class') || '', attributes: attributes, styles: styles,
      outerHTML: el.outerHTML.slice(0, 500), rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      text: (elementKind === 'mixed' ? directText : allText).trim().slice(0, 200), selector: me_buildSelector(el),
      htmlHint: el.outerHTML.slice(0, Math.min(200, el.outerHTML.indexOf('>') + 1)),
      isLayoutContainer: el.children.length > 0, elementKind: elementKind, selectionKind: selectionKind,
      componentType: componentType || undefined, htmlType: htmlType || undefined
    };
  }

  function me_clearSelected() {
    var selected = document.querySelectorAll('[data-od-edit-selected]');
    for (var i = 0; i < selected.length; i++) selected[i].removeAttribute('data-od-edit-selected');
  }
  function me_setSelected(el) { me_clearSelected(); if (el) el.setAttribute('data-od-edit-selected', 'true'); }

  function me_handleMouseDown(ev) { if (!me_enabled) return; ev.preventDefault(); }

  function me_handleClick(ev) {
    if (!me_enabled) return;
    ev.preventDefault(); ev.stopPropagation();
    me_clearSelected();
    var el = ev.target;
    if (me_componentFlag) {
      var node = el;
      while (node && node !== document.documentElement) {
        if (node.hasAttribute && node.hasAttribute(me_componentFlag)) {
          var componentType = node.getAttribute(me_componentFlag);
          var target = me_buildTarget(node, 'component', componentType, null);
          if (target) { me_setSelected(node); window.parent.postMessage({ type: 'od:model-edit-selected', target: target }, '*'); return; }
        }
        node = node.parentElement;
      }
    }
    var htmlType = null;
    if (me_htmlFlag && el.hasAttribute && el.hasAttribute(me_htmlFlag)) htmlType = el.getAttribute(me_htmlFlag);
    var nativeEl = el;
    var elTag = el.tagName && el.tagName.toLowerCase();
    if (elTag && ['path','circle','rect','line','polyline','polygon','g','defs','use','text','tspan','linearGradient','radialGradient','stop','filter','mask','clippath','pattern','symbol','image','foreignobject','ellipse'].indexOf(elTag) >= 0) {
      var svgParent = el.closest('svg');
      if (svgParent) nativeEl = svgParent;
    }
    var nativeTarget = me_buildTarget(nativeEl, 'native', null, htmlType);
    if (nativeTarget) { me_setSelected(nativeEl); window.parent.postMessage({ type: 'od:model-edit-selected', target: nativeTarget }, '*'); }
  }

  function me_injectIntoIframe(iframe) {
    try {
      if (iframe.getAttribute('data-od-me-injected')) return;
      var doc = iframe.contentDocument;
      if (!doc) return;
      iframe.setAttribute('data-od-me-injected', 'true');
      var script = doc.createElement('script');
      script.textContent = '(' + me_runBridge.toString() + ')();';
      (doc.head || doc.body || doc.documentElement).appendChild(script);
    } catch(e) {}
  }

  function me_injectNestedIframes() {
    if (!me_enabled) return;
    var iframes = document.querySelectorAll('iframe:not([data-od-me-injected])');
    for (var i = 0; i < iframes.length; i++) {
      me_injectIntoIframe(iframes[i]);
      (function(iframe) { iframe.addEventListener('load', function() { me_injectIntoIframe(iframe); }); })(iframes[i]);
    }
  }

  function me_forwardToNestedIframes(d) {
    var iframes = document.querySelectorAll('iframe[data-od-me-injected]');
    for (var i = 0; i < iframes.length; i++) {
      try { iframes[i].contentWindow.postMessage(d, '*'); } catch(e) {}
    }
  }

  function me_applyMode(enabled) {
    me_enabled = enabled;
    document.documentElement.toggleAttribute('data-od-edit-mode', me_enabled);
    if (me_enabled) {
      me_annotateRendered();
      document.body.addEventListener('mousedown', me_handleMouseDown, true);
      document.body.addEventListener('click', me_handleClick, true);
      me_injectNestedIframes();
    } else {
      document.body.removeEventListener('mousedown', me_handleMouseDown, true);
      document.body.removeEventListener('click', me_handleClick, true);
      me_clearSelected();
      me_forwardToNestedIframes({ type: 'od:model-edit-mode', enabled: false });
    }
  }

  window.addEventListener('message', function(ev) {
    var d = ev && ev.data;
    if (!d) return;
    // Relay messages from nested iframes to parent
    if (ev.source !== window.parent && ev.source !== window) {
      if (d.type === 'od:model-edit-selected' || d.type === 'od:rect-update') {
        window.parent.postMessage(d, '*');
        return;
      }
    }
    if (d.type === 'od:model-edit-mode') {
      me_componentFlag = d.componentFlag || null;
      me_htmlFlag = d.htmlFlag || null;
      me_applyMode(d.enabled);
      me_forwardToNestedIframes(d);
      return;
    }
    if (d.type === 'od:model-edit-clear') { me_clearSelected(); me_forwardToNestedIframes(d); return; }
    if (d.type === 'od:edit-attr') {
      var attrEl = document.querySelector('[data-od-id="' + d.elementId + '"]');
      if (attrEl) attrEl.setAttribute(d.attr, d.value); else me_forwardToNestedIframes(d);
      return;
    }
    if (d.type === 'od:replace-element') {
      var oldEl = document.querySelector('[data-od-id="' + d.elementId + '"]');
      if (oldEl) {
        var template = document.createElement('div'); template.innerHTML = d.html;
        var newEl = template.firstElementChild;
        if (newEl) { newEl.setAttribute('data-od-id', d.elementId); if (d.attrs) { for (var k in d.attrs) { if (d.attrs[k]) newEl.setAttribute(k, d.attrs[k]); } } oldEl.parentNode.replaceChild(newEl, oldEl); }
      } else me_forwardToNestedIframes(d);
      return;
    }
    if (d.type === 'od:track-rect') {
      var trackEl = document.querySelector('[data-od-id="' + d.elementId + '"]');
      if (trackEl) me_startTrack(d.elementId); else me_forwardToNestedIframes(d);
      return;
    }
    if (d.type === 'od:stop-track-rect') { me_stopTrack(); me_forwardToNestedIframes(d); return; }
  });

  var me_observer = null;
  if (typeof MutationObserver !== 'undefined' && document.body) {
    me_observer = new MutationObserver(function() { me_injectNestedIframes(); });
    me_observer.observe(document.body, { childList: true, subtree: true });
  }
}

me_runBridge();

})();</script>`
