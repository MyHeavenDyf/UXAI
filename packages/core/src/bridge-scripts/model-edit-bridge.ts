export const MODEL_EDIT_BRIDGE_SCRIPT = `<script data-od-model-edit-bridge>(function(){
var me_enabled = false;
var me_componentFlag = null;
var me_htmlFlag = null;
var me_annotateNextId = -1;

function me_tagLabel(el) {
  var t = el.tagName ? el.tagName.toLowerCase() : '';
  var c = el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).join('.') : '';
  return t + c;
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
  var attrNames = ['class','id','href','src','alt','title','data-od-label','aria-label'];
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

function me_handleClick(ev) {
  if (!me_enabled) return;
  ev.preventDefault();
  ev.stopPropagation();

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

  var nativeTarget = me_buildTarget(el, 'native', null, htmlType);
  if (nativeTarget) {
    me_setSelected(el);
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
      document.body.addEventListener('click', me_handleClick, true);
    } else {
      document.body.removeEventListener('click', me_handleClick, true);
      me_clearSelected();
    }
    return;
  }

  if (d.type === 'od:model-edit-clear') {
    me_clearSelected();
    return;
  }
});
})();</script>`
