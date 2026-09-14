export const MODEL_EDIT_BRIDGE_SCRIPT = `<script data-od-model-edit-bridge>(function(){
var me_enabled = false;
var me_componentFlag = null;
var me_htmlFlag = null;
var me_annotateNextId = -1;

var me_trackId = null;
var me_trackRaf = 0;
var me_trackRo = null;
function me_trackSend() {
  if (!me_trackId) return;
  var el = document.querySelector('[data-od-id="' + me_trackId + '"]');
  if (!el) return;
  var r = el.getBoundingClientRect();
  window.parent.postMessage({ type: 'od:rect-update', elementId: me_trackId, rect: { x: r.left, y: r.top, width: r.width, height: r.height } }, '*');
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
  return parts.join(' > ');
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
      if (attr && attr.indexOf('el-') === 0) {
        var n = parseInt(attr.substring(3), 10);
        if (!isNaN(n) && n > me_annotateNextId) me_annotateNextId = n;
      }
    }
  }
  me_annotateNextId++;
  id = 'el-' + me_annotateNextId;
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
  var rect = el.getBoundingClientRect();
  var computed = window.getComputedStyle(el);

  var directTextParts = [];
  for (var i = 0; i < el.childNodes.length; i++) {
    var node = el.childNodes[i];
    if (node.nodeType === 3 && node.textContent && node.textContent.trim()) {
      directTextParts.push(node.textContent.trim());
    }
  }
  var directText = directTextParts.join(' ');
  var allText = el.textContent || '';

  var elementKind = 'container';
  if (tag === 'a') elementKind = 'link';
  else if (tag === 'img') elementKind = 'image';
  else if (allText.trim() && el.children.length === 0) elementKind = 'text';
  else if (['label', 'button', 'span', 'p', 'div'].indexOf(tag) >= 0 && directText.trim()) {
    elementKind = 'mixed';
  }

  var styles = {};
  var styleProps = [
    'fontFamily','fontSize','fontWeight','color','textAlign','lineHeight','letterSpacing',
    'width','height','minHeight',
    'gap','flexDirection','justifyContent','alignItems',
    'backgroundColor','opacity',
    'padding','paddingTop','paddingRight','paddingBottom','paddingLeft',
    'margin','marginTop','marginRight','marginBottom','marginLeft',
    'border','borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth',
    'borderStyle','borderColor','borderRadius',
    'boxShadow','filter','backdropFilter','backgroundImage','overflow',
    'borderTopLeftRadius','borderTopRightRadius','borderBottomRightRadius','borderBottomLeftRadius',
    'verticalAlign'
  ];
  styleProps.forEach(function(p) {
    styles[p] = computed[p] || '';
  });

  var attributes = {};
  var attrNames = ['class','id','href','src','alt','title','data-od-label','aria-label','data-icon-name','data-icon-id','data-icon-custom','data-icon-src','data-icon-size','data-icon-style','data-icon-color'];
  if (me_htmlFlag) attrNames.push(me_htmlFlag);
  if (me_componentFlag) attrNames.push(me_componentFlag);
  attrNames.forEach(function(name) {
    var val = el.getAttribute(name);
    if (val) attributes[name] = val;
  });

  return {
    dataOdId: id,
    tagName: tag,
    className: el.getAttribute('class') || '',
    attributes: attributes,
    styles: styles,
    outerHTML: el.outerHTML.slice(0, 500),
    rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
    text: (elementKind === 'mixed' ? directText : allText).trim().slice(0, 200),
    selector: me_buildSelector(el),
    htmlHint: el.outerHTML.slice(0, Math.min(200, el.outerHTML.indexOf('>') + 1)),
    isLayoutContainer: el.children.length > 0,
    elementKind: elementKind,
    selectionKind: selectionKind,
    componentType: componentType || undefined,
    htmlType: htmlType || undefined
  };
}

function me_clearSelected() {
  var selected = document.querySelectorAll('[data-od-edit-selected]');
  for (var i = 0; i < selected.length; i++) selected[i].removeAttribute('data-od-edit-selected');
}

function me_setSelected(el) {
  me_clearSelected();
  if (el) el.setAttribute('data-od-edit-selected', 'true');
}

function me_handleMouseDown(ev) {
  if (!me_enabled) return;
  ev.preventDefault();
}

function me_handleClick(ev) {
  if (!me_enabled) return;
  ev.preventDefault();
  ev.stopPropagation();

  me_clearSelected();

  var el = ev.target;

  if (me_componentFlag) {
    var node = el;
    while (node && node !== document.documentElement) {
      if (node.hasAttribute && node.hasAttribute(me_componentFlag)) {
        var componentType = node.getAttribute(me_componentFlag);
        var target = me_buildTarget(node, 'component', componentType, null);
        if (target) {
          me_setSelected(node);
          window.parent.postMessage({ type: 'od:model-edit-selected', target: target }, '*');
          return;
        }
      }
      node = node.parentElement;
    }
  }

  var htmlType = null;
  if (me_htmlFlag && el.hasAttribute && el.hasAttribute(me_htmlFlag)) {
    htmlType = el.getAttribute(me_htmlFlag);
  }

  var nativeEl = el;
  var elTag = el.tagName && el.tagName.toLowerCase();
  if (elTag && ['path','circle','rect','line','polyline','polygon','g','defs','use','text','tspan','linearGradient','radialGradient','stop','filter','mask','clippath','pattern','symbol','image','foreignobject','ellipse'].indexOf(elTag) >= 0) {
    var svgParent = el.closest('svg');
    if (svgParent) nativeEl = svgParent;
  }

  var nativeTarget = me_buildTarget(nativeEl, 'native', null, htmlType);
  if (nativeTarget) {
    me_setSelected(nativeEl);
    window.parent.postMessage({ type: 'od:model-edit-selected', target: nativeTarget }, '*');
  }
}

window.addEventListener('message', function(ev) {
  var d = ev && ev.data;
  if (!d) return;

  if (d.type === 'od:model-edit-mode') {
    me_enabled = d.enabled;
    me_componentFlag = d.componentFlag || null;
    me_htmlFlag = d.htmlFlag || null;
    document.documentElement.toggleAttribute('data-od-edit-mode', me_enabled);
    if (me_enabled) {
      me_annotateRendered();
      document.body.addEventListener('mousedown', me_handleMouseDown, true);
      document.body.addEventListener('click', me_handleClick, true);
    } else {
      document.body.removeEventListener('mousedown', me_handleMouseDown, true);
      document.body.removeEventListener('click', me_handleClick, true);
      me_clearSelected();
    }
    return;
  }

  if (d.type === 'od:model-edit-clear') {
    me_clearSelected();
    return;
  }

  if (d.type === 'od:edit-attr') {
    var attrEl = document.querySelector('[data-od-id="' + d.elementId + '"]');
    if (attrEl) attrEl.setAttribute(d.attr, d.value);
    return;
  }

  if (d.type === 'od:replace-element') {
    var oldEl = document.querySelector('[data-od-id="' + d.elementId + '"]');
    if (oldEl) {
      var template = document.createElement('div');
      template.innerHTML = d.html;
      var newEl = template.firstElementChild;
      if (newEl) {
        newEl.setAttribute('data-od-id', d.elementId);
        if (d.attrs) {
          for (var k in d.attrs) {
            if (d.attrs[k]) newEl.setAttribute(k, d.attrs[k]);
          }
        }
        oldEl.parentNode.replaceChild(newEl, oldEl);
      }
    }
    return;
  }

  if (d.type === 'od:track-rect') {
    me_startTrack(d.elementId);
    return;
  }

  if (d.type === 'od:stop-track-rect') {
    me_stopTrack();
    return;
  }
});
})();</script>`
