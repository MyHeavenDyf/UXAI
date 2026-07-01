/**
 * Bridge script injection for artifact HTML files served via /artifact/serve endpoint.
 * Ported from packages/app/octoapp/pages/make/utils/srcdoc-builder.ts
 * 
 * Injected bridges:
 * - localStorage/sessionStorage polyfill (prevents SecurityError in sandboxed iframes)
 * - Link click intercept (anchors scroll in-page, _blank opens safely)
 * - Edit bridge (visual editing support via postMessage)
 * - Inspect bridge (element inspection via postMessage)
 * - Picker bridge (hover highlighting)
 * - Element annotation (data-od-id for stable element tracking)
 */

function injectSandboxShim(doc: string): string {
  const shim = `<script data-od-sandbox-shim>(function(){
  function makeStore(){
    var data = {};
    var api = {
      getItem: function(k){ return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
      setItem: function(k, v){ data[k] = String(v); },
      removeItem: function(k){ delete data[k]; },
      clear: function(){ data = {}; },
      key: function(i){ return Object.keys(data)[i] || null; }
    };
    Object.defineProperty(api, 'length', { get: function(){ return Object.keys(data).length; } });
    return api;
  }
  function tryShim(name){
    var works = false;
    try { works = !!window[name] && typeof window[name].getItem === 'function'; void window[name].length; }
    catch (_) { works = false; }
    if (works) return;
    try { Object.defineProperty(window, name, { configurable: true, value: makeStore() }); }
    catch (_) { try { window[name] = makeStore(); } catch (__) {} }
  }
  tryShim('localStorage');
  tryShim('sessionStorage');
  document.addEventListener('click', function(e){
    if (!e.target || !(e.target instanceof Element)) return;
    var link = e.target.closest('a[href]');
    if (!link) return;
    var href = link.getAttribute('href');
    if (href === null) return;
    var isAnchor = href.startsWith('#') || href === '';
    if (isAnchor) {
      e.preventDefault();
      if (href === '' || href === '#') {
        window.scrollTo({ top: 0 });
      } else {
        var target = document.getElementById(href.slice(1));
        if (target) target.scrollIntoView({ behavior: 'smooth' });
      }
    } else if (link.getAttribute('target') === '_blank') {
      e.preventDefault();
      var safe = false;
      try {
        var url = new URL(href, location.href);
        safe = url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:';
      } catch (_) {}
      safe && window.open(href, '_blank', 'noopener,noreferrer');
    }
  });
})();</script>`

  if (/<head[^>]*>/i.test(doc)) {
    return doc.replace(/<head[^>]*>/i, (m) => `${m}${shim}`)
  }
  if (/<body[^>]*>/i.test(doc)) {
    return doc.replace(/<body[^>]*>/i, (m) => `${m}${shim}`)
  }
  return shim + doc
}

function injectPickerBridge(doc: string): string {
  const script = `<script data-od-picker-bridge>(function(){
var active=false;
var lastEl=null;
var overlay=null;
function createOverlay(){
  if(overlay)return;
  overlay=document.createElement('div');
  overlay.style.cssText='position:fixed;pointer-events:none;z-index:99999;border:2px solid #0067D1;border-radius:3px;background:rgba(0,103,209,0.08);transition:all 80ms ease;display:none;';
  document.body.appendChild(overlay);
}
function removeOverlay(){
  if(!overlay)return;
  overlay.remove();overlay=null;
}
function showOverlay(el){
  if(!overlay)return;
  var r=el.getBoundingClientRect();
  overlay.style.display='block';
  overlay.style.left=r.left+'px';
  overlay.style.top=r.top+'px';
  overlay.style.width=r.width+'px';
  overlay.style.height=r.height+'px';
}
function hideOverlay(){if(overlay)overlay.style.display='none';}
function tagLabel(el){
  var t=el.tagName.toLowerCase();
  var c=el.className&&typeof el.className==='string'?'.'+el.className.trim().split(/\\s+/).join('.'):'';
  return t+c;
}
function selector(el){
  var parts=[];
  var cur=el;
  for(var i=0;i<5&&cur&&cur!==document.body&&cur!==document.documentElement;i++){
    parts.unshift(tagLabel(cur));
    cur=cur.parentElement;
  }
  return parts.join(' > ');
}
function styleSnap(el){
  var cs=getComputedStyle(el);
  return{color:cs.color,backgroundColor:cs.backgroundColor,fontSize:cs.fontSize,fontWeight:cs.fontWeight,borderRadius:cs.borderRadius,paddingTop:cs.paddingTop,paddingRight:cs.paddingRight,paddingBottom:cs.paddingBottom,paddingLeft:cs.paddingLeft,textAlign:cs.textAlign,fontFamily:cs.fontFamily,lineHeight:cs.lineHeight};
}
function targetFrom(el){
  var r=el.getBoundingClientRect();
  var odId=el.getAttribute('data-od-id')||null;
  return{type:'od:inspect-target',elementId:odId,tag:tagLabel(el),selector:selector(el),text:(el.textContent||'').trim().slice(0,120),position:{x:r.x,y:r.y,width:r.width,height:r.height},style:styleSnap(el),htmlHint:el.outerHTML.slice(0,Math.min(200,el.outerHTML.indexOf('>')+1))};
}
document.addEventListener('mouseover',function(e){
  if(!active)return;
  var el=e.target;
  if(!el||el===document.documentElement||el===document.body||el===overlay)return;
  if(lastEl===el)return;
  lastEl=el;
  showOverlay(el);
  try{window.parent.postMessage(targetFrom(el),'*');}catch(_){}
},true);
document.addEventListener('mouseout',function(e){
  if(!active)return;
  if(!e.relatedTarget||!e.target.contains(e.relatedTarget)){
    lastEl=null;hideOverlay();
    try{window.parent.postMessage({type:'od:inspect-leave'},'*');}catch(_){}
  }
},true);
document.addEventListener('click',function(e){
  if(!active)return;
  var el=e.target;
  if(!el||el===overlay)return;
  e.preventDefault();e.stopPropagation();
  try{window.parent.postMessage(Object.assign({clicked:true},targetFrom(el)),'*');}catch(_){}
},true);
window.addEventListener('message',function(ev){
  var d=ev&&ev.data;
  if(!d||d.type!=='od:inspect-mode')return;
  active=!!d.enabled;
  if(active){createOverlay();document.body.style.cursor='crosshair';}
  else{removeOverlay();document.body.style.cursor='';lastEl=null;}
});
})();</script>`

  if (doc.includes("</body>")) {
    return doc.replace("</body>", script + "</body>")
  }
  return doc + script
}

function injectInspectStyleBridge(doc: string): string {
  const script = `<script data-od-inspect-style-bridge>(function(){
var overrides={};
var STYLE_PROPS=['color','backgroundColor','fontSize','fontWeight','textAlign','padding','borderRadius','fontFamily','lineHeight'];
function camelToKebab(str){
  return str.replace(/([a-z])([A-Z])/g,function(m,p1,p2){return p1+'-'+p2.toLowerCase();});
}
window.addEventListener('message',function(ev){
  var d=ev&&ev.data;
  if(!d)return;
  if(d.type==='od:inspect-set'){
    var el=document.querySelector('[data-od-id="'+d.elementId+'"]');
    if(!el)return;
    var camelProp=d.prop;
    var cssProp=camelToKebab(camelProp);
    var value=d.value;
    if(!STYLE_PROPS.includes(camelProp))return;
    var key=d.elementId+'||'+camelProp;
    if(!overrides[key])overrides[key]={original:el.style.getPropertyValue(cssProp)};
    el.style.setProperty(cssProp,value,'important');
  }
  if(d.type==='od:inspect-reset'){
    if(d.elementId){
      var keys=Object.keys(overrides).filter(function(k){return k.startsWith(d.elementId+'||');});
      keys.forEach(function(k){
        var parts=k.split('||');
        var el=document.querySelector('[data-od-id="'+parts[0]+'"]');
        if(el&&overrides[k]){
          var cssProp=camelToKebab(parts[1]);
          if(overrides[k].original)el.style.setProperty(cssProp,overrides[k].original);
          else el.style.removeProperty(cssProp);
        }
        delete overrides[k];
      });
    }else{
      Object.keys(overrides).forEach(function(k){
        var parts=k.split('||');
        var el=document.querySelector('[data-od-id="'+parts[0]+'"]');
        if(el&&overrides[k]){
          var cssProp=camelToKebab(parts[1]);
          if(overrides[k].original)el.style.setProperty(cssProp,overrides[k].original);
          else el.style.removeProperty(cssProp);
        }
      });
      overrides={};
    }
  }
  if(d.type==='od:inspect-extract'){
    var result=[];
    Object.keys(overrides).forEach(function(k){
      var parts=k.split('||');
      var el=document.querySelector('[data-od-id="'+parts[0]+'"]');
      if(el){
        var cssProp=camelToKebab(parts[1]);
        var currentValue=el.style.getPropertyValue(cssProp);
        result.push({elementId:parts[0],prop:parts[1],value:currentValue});
      }
    });
    window.parent.postMessage({type:'od:inspect-overrides',overrides:result},'*');
  }
});
})();</script>`

  if (doc.includes("</body>")) {
    return doc.replace("</body>", script + "</body>")
  }
  return doc + script
}

function injectEditBridgeStyle(doc: string): string {
  const style = `<style data-od-edit-bridge-style>
html[data-od-edit-mode] body * { cursor: pointer !important; }
html[data-od-edit-mode] [data-od-id],
html[data-od-edit-mode] [data-od-runtime-id],
html[data-od-edit-mode] [data-od-source-path] { outline: 1px dashed rgba(37, 99, 235, 0.35); outline-offset: 3px; }
html[data-od-edit-mode] [data-od-id]:hover,
html[data-od-edit-mode] [data-od-runtime-id]:hover,
html[data-od-edit-mode] [data-od-source-path]:hover { outline: 2px solid #2563eb; }
html[data-od-edit-mode] [data-od-edit-selected] {
  outline: 2px solid #2563eb !important;
  outline-offset: 4px;
  box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.16);
}
html[data-od-edit-mode] [data-od-editing="true"] {
  outline: 2px solid #2563eb !important;
  outline-offset: 4px;
  background: rgba(37, 99, 235, 0.06);
  cursor: text !important;
}
</style>`

  if (doc.includes("</head>")) {
    return doc.replace("</head>", style + "</head>")
  }
  if (doc.includes("<body")) {
    return doc.replace("<body", style + "<body")
  }
  return doc + style
}

function injectEditBridge(doc: string): string {
  const script = `<script data-od-edit-bridge>(function(){
var editEnabled = false;
var lastSelectedId = null;
var TEXT_PROPS=['textContent'];
var ATTR_PROPS=['href','src','alt'];

function caretRangeFromClick(ev){
  try{
    if(document.caretPositionFromPoint){
      var pos=document.caretPositionFromPoint(ev.clientX,ev.clientY);
      if(!pos)return null;
      var r=document.createRange();
      r.setStart(pos.offsetNode,pos.offset);
      r.collapse(true);
      return r;
    }
    if(document.caretRangeFromPoint)return document.caretRangeFromPoint(ev.clientX,ev.clientY);
  }catch(e){}
  return null;
}

function placeCaretFromClick(ev,el){
  var r=caretRangeFromClick(ev);
  if(!r){
    r=document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
  }
  try{
    var s=window.getSelection();
    if(s){s.removeAllRanges();s.addRange(r);}
  }catch(e){}
}

function makeEditable(el,ev){
  if(!el||el.getAttribute('contenteditable')==='true')return;
  var orig=el.textContent||'';
  el.setAttribute('contenteditable','plaintext-only');
  el.setAttribute('data-od-editing','true');
  try{el.focus();}catch(e){}
  placeCaretFromClick(ev,el);
  
  function finish(commit){
    el.removeAttribute('contenteditable');
    el.removeAttribute('data-od-editing');
    el.removeEventListener('blur',onBlur);
    el.removeEventListener('keydown',onKey);
    var v=(el.textContent||'').trim();
    if(commit&&v!==orig.trim()){
      window.parent.postMessage({type:'od-edit-text-commit',id:el.getAttribute('data-od-id'),value:v},'*');
    }else if(!commit)el.textContent=orig;
  }
  function onBlur(){
    finish(true);
    window.parent.postMessage({type:'od:edit-focus-transfer'},'*');
  }
  function onKey(e){
    if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();finish(true);try{el.blur();}catch(e){}}
    if(e.key==='Escape'){e.preventDefault();finish(false);try{el.blur();}catch(e){}}
  }
  el.addEventListener('blur',onBlur);
  el.addEventListener('keydown',onKey);
}

function getManualEditTarget(el) {
  if (!el || !el.getAttribute) return null;
  var id = el.getAttribute('data-od-id');
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
  
  var kind = 'container';
  if (tag === 'a') kind = 'link';
  else if (tag === 'img') kind = 'image';
  else if (allText.trim() && el.children.length === 0) kind = 'text';
  else if (['label', 'button', 'span', 'p', 'div'].indexOf(tag) >= 0 && directText.trim()) {
    kind = 'mixed';
  }
  
  var fields = {};
  if (kind === 'text' || kind === 'link') fields.text = allText.trim().slice(0, 200);
  if (kind === 'mixed') fields.text = directText.trim().slice(0, 200);
  if (kind === 'link') fields.href = el.getAttribute('href') || '';
  if (kind === 'image') {
    fields.src = el.getAttribute('src') || '';
    fields.alt = el.getAttribute('alt') || '';
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
    'borderStyle','borderColor','borderRadius'
  ];
  styleProps.forEach(function(p) {
    styles[p] = computed[p] || '';
  });
  
  var attributes = {};
  var attrNames = ['class','id','href','src','alt','title','data-od-label','aria-label'];
  attrNames.forEach(function(name) {
    var val = el.getAttribute(name);
    if (val) attributes[name] = val;
  });
  
  return {
    id: id,
    kind: kind,
    label: tag + (fields.text ? ': ' + fields.text.slice(0, 50) : ''),
    tagName: tag,
    className: el.getAttribute('class') || '',
    text: (kind === 'mixed' ? directText : allText).trim().slice(0, 200),
    rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
    fields: fields,
    attributes: attributes,
    styles: styles,
    isLayoutContainer: el.children.length > 0,
    outerHtml: el.outerHTML.slice(0, 500)
  };
}

function clearSelectedTarget() {
  var selected = document.querySelectorAll('[data-od-edit-selected]');
  for (var i = 0; i < selected.length; i++) selected[i].removeAttribute('data-od-edit-selected');
  lastSelectedId = null;
}

function setSelectedTarget(id) {
  clearSelectedTarget();
  if (!id) return;
  var el = document.querySelector('[data-od-id="' + id + '"]');
  if (el) el.setAttribute('data-od-edit-selected', 'true');
  lastSelectedId = id;
}

window.addEventListener('message',function(ev){
  var d=ev&&ev.data;
  if(!d)return;
  
  if(d.type==='od:edit-mode'){
    editEnabled = d.enabled;
    document.documentElement.toggleAttribute('data-od-edit-mode', editEnabled);
    if(editEnabled){
      document.body.addEventListener('click',handleEditSingleClick,true);
      document.body.addEventListener('dblclick',handleEditDoubleClick,true);
    } else {
      document.body.removeEventListener('click',handleEditSingleClick,true);
      document.body.removeEventListener('dblclick',handleEditDoubleClick,true);
      clearSelectedTarget();
    }
    return;
  }
  
  if(d.type==='od:edit-selected-target'){
    setSelectedTarget(d.id || null);
    return;
  }
  
  if(d.type==='od:edit-preview-style'){
    var previewEl=document.querySelector('[data-od-id="'+d.id+'"]');
    if(previewEl){
      var styles=d.styles||{};
      var keys=Object.keys(styles);
      for(var i=0;i<keys.length;i++){
        var key=keys[i];
        var value=styles[key];
        var cssName=key.replace(/([a-z])([A-Z])/g,function(m,p1,p2){return p1+'-'+p2.toLowerCase();});
        if(typeof value!=='string'||value.trim===''){
          previewEl.style.removeProperty(cssName);
        }else{
          previewEl.style.setProperty(cssName,value.trim());
        }
      }
      window.parent.postMessage({
        type:'od:edit-preview-style-applied',
        id:d.id,
        version:d.version||0,
        ok:true
      },'*');
    }else{
      window.parent.postMessage({
        type:'od:edit-preview-style-applied',
        id:d.id||'',
        version:d.version||0,
        ok:false,
        error:'Target not found'
      },'*');
    }
    return;
  }
  
  if(d.type==='od:edit-text'){
    var el=document.querySelector('[data-od-id="'+d.elementId+'"]');
    if(el)el.textContent=d.value;
  }
  if(d.type==='od:edit-attr'){
    var el=document.querySelector('[data-od-id="'+d.elementId+'"]');
    if(el&&ATTR_PROPS.includes(d.attr))el.setAttribute(d.attr,d.value);
  }
  if(d.type==='od:edit-style'){
    var el=document.querySelector('[data-od-id="'+d.elementId+'"]');
    if(el)el.style.setProperty(d.prop,d.value,'important');
  }
});

function handleEditSingleClick(ev){
  if(!editEnabled)return;
  if(ev.target&&ev.target.closest&&ev.target.closest('[data-od-editing="true"]'))return;
  ev.preventDefault();
  ev.stopPropagation();
  
  var el=ev.target;
  while(el&&el!==document.documentElement){
    var target=getManualEditTarget(el);
    if(target){
      setSelectedTarget(target.id);
      window.parent.postMessage({type:'od:edit-selected',target:target},'*');
      return;
    }
    el=el.parentElement;
  }
}

function handleEditDoubleClick(ev){
  if(!editEnabled)return;
  if(ev.target&&ev.target.closest&&ev.target.closest('[data-od-editing="true"]'))return;
  ev.preventDefault();
  ev.stopPropagation();
  
  var el=ev.target;
  while(el&&el!==document.documentElement){
    var target=getManualEditTarget(el);
    if(target){
      if(target.kind==='text'||target.kind==='link'){
        makeEditable(el,ev);
      }
      return;
    }
    el=el.parentElement;
  }
}

})();</script>`

  if (doc.includes("</body>")) {
    return doc.replace("</body>", script + "</body>")
  }
  return doc + script
}

function annotateElementsWithIds(doc: string): string {
  const parser = new DOMParser()
  const parsedDoc = parser.parseFromString(doc, "text/html")
  
  let maxId = -1
  const existingElements = parsedDoc.querySelectorAll('[data-od-id]')
  existingElements.forEach((el) => {
    const idAttr = el.getAttribute('data-od-id')
    if (idAttr && idAttr.startsWith('el-')) {
      const idNum = parseInt(idAttr.substring(3), 10)
      if (!isNaN(idNum) && idNum > maxId) maxId = idNum
    }
  })
  
  let counter = maxId + 1
  
  const walk = (el: Element) => {
    if (el.tagName !== "SCRIPT" && el.tagName !== "STYLE" && el.tagName !== "HEAD") {
      if (!el.hasAttribute('data-od-id')) {
        el.setAttribute("data-od-id", `el-${counter++}`)
      }
    }
    for (const child of Array.from(el.children)) {
      walk(child)
    }
  }
  
  walk(parsedDoc.body)
  return parsedDoc.documentElement.outerHTML
}

export function injectArtifactBridges(html: string): string {
  let doc = html
  
  doc = injectSandboxShim(doc)
  doc = injectEditBridgeStyle(doc)
  doc = injectEditBridge(doc)
  doc = injectInspectStyleBridge(doc)
  doc = injectPickerBridge(doc)
  doc = annotateElementsWithIds(doc)
  
  return doc
}