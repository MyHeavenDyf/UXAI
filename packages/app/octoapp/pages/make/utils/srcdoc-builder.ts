/**
 * Builds a sandboxed srcdoc string for rendering artifact HTML in an iframe.
 * Ported from open-design/apps/web/src/runtime/srcdoc.ts (simplified).
 *
 * Features:
 * - Auto-wrap partial HTML in a full document shell
 * - Inject localStorage/sessionStorage polyfill (prevents SecurityError in sandboxed iframes)
 * - Intercept link clicks (anchors scroll in-page, _blank opens safely)
 * - Optional deck bridge for slide navigation via postMessage
 * - Focus guard to prevent iframe from stealing focus
 */

export type SrcdocOptions = {
  deck?: boolean
  initialSlideIndex?: number
  focusGuard?: boolean
  palette?: boolean
  initialPalette?: string | null
  picker?: boolean
  inspectBridge?: boolean
  editBridge?: boolean
  snapshotBridge?: boolean
  annotateElements?: boolean
}

export function buildSrcdoc(html: string, options: SrcdocOptions = {}): string {
  const head = html.trimStart().slice(0, 64).toLowerCase()
  const isFullDoc = head.startsWith("<!doctype") || head.startsWith("<html")

  let doc = isFullDoc
    ? html
    : `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>${html}</body>
</html>`

  doc = injectSandboxShim(doc)

  if (options.annotateElements) {
    doc = annotateElementsWithIds(doc)
  }

  if (options.focusGuard) {
    doc = injectFocusGuard(doc)
  }

  if (options.deck) {
    doc = injectDeckBridge(doc, options.initialSlideIndex)
  }

  if (options.palette) {
    doc = injectPaletteBridge(doc, { initialPalette: options.initialPalette ?? null })
  }

  if (options.picker) {
    doc = injectPickerBridge(doc)
  }

  if (options.snapshotBridge) {
    doc = injectSnapshotBridge(doc)
  }

  if (options.inspectBridge) {
    doc = injectInspectStyleBridge(doc)
  }

  if (options.editBridge) {
    doc = injectEditBridgeStyle(doc)
    doc = injectEditBridge(doc)
  }

  return doc
}

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

function injectFocusGuard(doc: string): string {
  const script = `<script data-od-focus-guard>(function(){
  var lastInputAt = 0;
  function userActivated(){ return Date.now() - lastInputAt < 1000; }
  function markInput(e){ if (e && e.isTrusted) lastInputAt = Date.now(); }
  document.addEventListener('pointerdown', markInput, true);
  document.addEventListener('keydown', markInput, true);
  try {
    var nativeFocus = window.focus && window.focus.bind(window);
    Object.defineProperty(window, 'focus', {
      configurable: true, writable: true,
      value: function(){ if (userActivated() && nativeFocus) return nativeFocus(); }
    });
  } catch (_) {}
  try {
    var nativeElFocus = HTMLElement.prototype.focus;
    Object.defineProperty(HTMLElement.prototype, 'focus', {
      configurable: true, writable: true,
      value: function(opts){ if (userActivated()) return nativeElFocus.call(this, opts); }
    });
  } catch (_) {}
})();</script>`

  if (/<head[^>]*>/i.test(doc)) {
    return doc.replace(/<head[^>]*>/i, (m) => `${m}${script}`)
  }
  return doc
}

function injectDeckBridge(doc: string, initialSlide: number = 0): string {
  const script = `<script data-od-deck-bridge>(function(){
  var current = ${initialSlide};
  var origDisplay = [];
  function getAllSlides(){
    var byClass = document.querySelectorAll('.slide');
    if (byClass.length > 0) return Array.prototype.slice.call(byClass);
    return [];
  }
  function updateDots(idx){
    var dots = document.querySelectorAll('.dots .dot');
    dots.forEach(function(d, i){ d.classList.toggle('active', i === idx); });
  }
  function updateNum(idx){
    var numEl = document.getElementById('slideNum');
    if (numEl) {
      var slides = getAllSlides();
      numEl.textContent = String(idx + 1).padStart(2, '0') + ' / ' + String(slides.length).padStart(2, '0');
    }
  }
  function showSlide(idx){
    var slides = getAllSlides();
    var total = slides.length;
    if (total === 0) return;
    current = Math.max(0, Math.min(idx, total - 1));
    slides.forEach(function(s, i){
      if (origDisplay[i] === undefined) {
        origDisplay[i] = getComputedStyle(s).display;
      }
      s.style.display = i === current ? origDisplay[i] : 'none';
      s.classList.toggle('active', i === current);
    });
    updateDots(current);
    updateNum(current);
    try {
      window.parent.postMessage({ type: 'od:slide-state', active: current, count: total }, '*');
    } catch (_) {}
  }
  document.addEventListener('keydown', function(e){
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); e.stopImmediatePropagation(); showSlide(current + 1); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); e.stopImmediatePropagation(); showSlide(current - 1); }
    if (e.key === 'Home') { e.preventDefault(); e.stopImmediatePropagation(); showSlide(0); }
    if (e.key === 'End') { e.preventDefault(); e.stopImmediatePropagation(); showSlide(getAllSlides().length - 1); }
  }, true);
  document.addEventListener('click', function(e){
    var t = e.target;
    while (t && t !== document) {
      var tag = t.tagName ? t.tagName.toLowerCase() : '';
      var cls = (t.className || '');
      if (cls.indexOf('nav-area') >= 0 || cls.indexOf('nav-arrow') >= 0) {
        var parent = t.parentElement;
        if (parent && parent.classList.contains('prev')) {
          e.preventDefault(); e.stopPropagation(); showSlide(current - 1); return;
        }
        if (parent && parent.classList.contains('next')) {
          e.preventDefault(); e.stopPropagation(); showSlide(current + 1); return;
        }
        if (tag === 'div' && (cls.indexOf('prev') >= 0)) {
          e.preventDefault(); e.stopPropagation(); showSlide(current - 1); return;
        }
        if (tag === 'div' && (cls.indexOf('next') >= 0)) {
          e.preventDefault(); e.stopPropagation(); showSlide(current + 1); return;
        }
      }
      if (cls.indexOf('dot') >= 0) {
        var dots = document.querySelectorAll('.dots .dot');
        for (var i = 0; i < dots.length; i++) {
          if (dots[i] === t || dots[i].contains(t)) {
            e.preventDefault(); e.stopPropagation(); showSlide(i); return;
          }
        }
      }
      t = t.parentElement;
    }
  }, true);
  window.addEventListener('message', function(e){
    if (!e.data || e.data.type !== 'od:slide') return;
    if (e.data.action === 'next') showSlide(current + 1);
    else if (e.data.action === 'prev') showSlide(current - 1);
    else if (e.data.action === 'first') showSlide(0);
    else if (e.data.action === 'last') showSlide(getAllSlides().length - 1);
    else if (e.data.action === 'go' && typeof e.data.index === 'number') showSlide(e.data.index);
  });
  function hijackInternalNav(){
    if (typeof window.navigate === 'function') {
      window.navigate = function(dir){ showSlide(current + dir); };
    }
    if (typeof window.goTo === 'function') {
      window.goTo = function(idx){ showSlide(idx); };
    }
  }
  setTimeout(hijackInternalNav, 10);
  setTimeout(hijackInternalNav, 100);
  setTimeout(hijackInternalNav, 500);
  showSlide(current);
})();</script>`

  if (doc.includes("</body>")) {
    return doc.replace("</body>", script + "</body>")
  }
  return doc + script
}

function injectPaletteBridge(doc: string, options: { initialPalette: string | null } = { initialPalette: null }): string {
  const initial = options.initialPalette
    ? JSON.stringify(String(options.initialPalette))
    : "null"
  const script = `<script data-od-palette-bridge>(function(){
var PALETTES={
  'coral':{hue:10,satFloor:0.55,mono:false},
  'electric':{hue:262,satFloor:0.55,mono:false},
  'acid-forest':{hue:142,satFloor:0.55,mono:false},
  'risograph':{hue:349,satFloor:0.60,mono:false},
  'mono-noir':{hue:0,satFloor:0,mono:true}
};
var current=${initial};
var ATTR='data-od-palette-fix';
var SAVED='__odPaletteSaved__';
var MIN_SAT=0.08;
var WALK_LIMIT=12000;
function parseRgb(s){
  var m=s.match(/^rgba?\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)/);
  if(m) return{r:+m[1],g:+m[2],b:+m[3]};
  var hx=s.replace(/^#/,'');
  if(hx.length===3) hx=hx[0]+hx[0]+hx[1]+hx[1]+hx[2]+hx[2];
  if(hx.length===6) return{r:parseInt(hx.slice(0,2),16),g:parseInt(hx.slice(2,4),16),b:parseInt(hx.slice(4,6),16)};
  return null;
}
function rgbToHsl(r,g,b){
  r/=255;g/=255;b/=255;
  var mx=Math.max(r,g,b),mn=Math.min(r,g,b);
  var h,s,l=(mx+mn)/2;
  if(mx===mn){h=s=0;}else{
    var d=mx-mn;
    s=l>0.5?d/(2-mx-mn):d/(mx+mn);
    if(mx===r)h=((g-b)/d+(g<b?6:0))/6;
    else if(mx===g)h=((b-r)/d+2)/6;
    else h=((r-g)/d+4)/6;
  }
  return{h:h*360,s:s,l:l};
}
function h2r(p,q,t){if(t<0)t+=1;if(t>1)t-=1;if(t<1/6)return p+(q-p)*6*t;if(t<1/2)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p;}
function hslToRgb(h,s,l){
  h/=360;if(s===0)return{r:Math.round(l*255),g:Math.round(l*255),b:Math.round(l*255)};
  var q=l<0.5?l*(1+s):l+s-l*s;var p=2*l-q;
  return{r:Math.round(h2r(p,q,h+1/3)*255),g:Math.round(h2r(p,q,h)*255),b:Math.round(h2r(p,q,h-1/3)*255)};
}
function rgbStr(r,g,b){return'rgb('+r+','+g+','+b+')';}
function chromatic(c){
  if(!c)return null;
  var hsl=rgbToHsl(c.r,c.g,c.b);
  if(hsl.s<MIN_SAT||hsl.l<0.04||hsl.l>0.98)return null;
  return hsl;
}
function shift(hsl,pal){
  if(pal.mono)return rgbStr.apply(null,[hsl.l,hsl.l,hsl.l].map(function(v){return Math.round(v*255);}));
  var sat=Math.max(hsl.s,pal.satFloor*0.7);
  var rgb=hslToRgb(pal.hue,sat,hsl.l);
  return rgbStr(rgb.r,rgb.g,rgb.b);
}
function save(el,prop){
  var s=el[SAVED];if(!s){s={};el[SAVED]=s;el.setAttribute(ATTR,'1');}
  if(!(prop in s))s[prop]=el.style.getPropertyValue(prop);
}
function restoreEl(el){
  var s=el[SAVED];if(!s)return;
  for(var k in s)el.style.setProperty(k,s[k]);
  el.removeAttribute(ATTR);delete el[SAVED];
}
function restoreAll(){
  var els=document.querySelectorAll('['+ATTR+']');
  for(var i=0;i<els.length;i++)restoreEl(els[i]);
}
function applyTint(id){
  var pal=PALETTES[id];if(!pal)return;
  var els=document.querySelectorAll('*');
  var count=0;
  for(var i=0;i<els.length&&count<WALK_LIMIT;i++){
    var el=els[i];
    var cs;try{cs=getComputedStyle(el);}catch(_){continue;}
    var props=[['background-color','background-color'],['color','color'],['border-top-color','border-color']];
    for(var j=0;j<props.length;j++){
      var raw=cs.getPropertyValue(props[j][0]).trim();
      if(!raw||raw==='transparent'||raw==='rgba(0, 0, 0, 0)'||raw==='currentColor')continue;
      var c=parseRgb(raw);if(!c)continue;
      var hsl=chromatic(c);if(!hsl)continue;
      save(el,props[j][1]);
      el.style.setProperty(props[j][1],shift(hsl,pal),'important');
      count++;
    }
  }
}
function apply(id){
  restoreAll();
  if(!id||!PALETTES[id]){current=null;return;}
  current=id;applyTint(id);
}
window.addEventListener('message',function(ev){
  var data=ev&&ev.data;if(!data||data.type!=='od:palette')return;
  apply(data.palette?String(data.palette):null);
});
function boot(){if(current)apply(current);}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);
else boot();
})();</script>`

  if (doc.includes("</body>")) {
    return doc.replace("</body>", script + "</body>")
  }
  return doc + script
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

export function annotateElementsWithIds(doc: string): string {
  const parser = new DOMParser()
  const parsedDoc = parser.parseFromString(doc, "text/html")
  
  // Find maximum existing data-od-id to preserve stability
  let maxId = -1
  const existingElements = parsedDoc.querySelectorAll('[data-od-id]')
  existingElements.forEach((el) => {
    const idAttr = el.getAttribute('data-od-id')
    if (idAttr && idAttr.startsWith('el-')) {
      const idNum = parseInt(idAttr.substring(3), 10)
      if (!isNaN(idNum) && idNum > maxId) maxId = idNum
    }
  })
  
  // Start counter from maxId + 1 (preserve existing IDs)
  let counter = maxId + 1
  
  const walk = (el: Element) => {
    if (el.tagName !== "SCRIPT" && el.tagName !== "STYLE" && el.tagName !== "HEAD") {
      // Only assign new ID if element doesn't have one
      if (!el.hasAttribute('data-od-id')) {
        el.setAttribute("data-od-id", `el-${counter++}`)
      }
      // Keep existing data-od-id unchanged
    }
    for (const child of Array.from(el.children)) {
      walk(child)
    }
  }
  
  walk(parsedDoc.body)
  return parsedDoc.documentElement.outerHTML
}

function injectSnapshotBridge(doc: string): string {
  const script = `<script data-od-snapshot-bridge>(function(){
function waitForImages(){
  var imgs=document.images||[];
  var pending=[];
  for(var i=0;i<imgs.length;i++){
    var img=imgs[i];
    if(!img.complete&&img.src){
      pending.push(new Promise(function(res,rej){
        img.onload=res;img.onerror=res;
      }));
    }
  }
  return Promise.all(pending);
}
function scrollOffset(){
  return{x:window.pageXOffset||document.documentElement.scrollLeft||0,y:window.pageYOffset||document.documentElement.scrollTop||0};
}
function escapeAttribute(s){
  return String(s||'').replace(/[&<>"']/g,function(c){
    return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[c];
  });
}
function inlineSnapshotStyles(srcEl,destEl){
  if(!srcEl||!destEl)return;
  if(srcEl.nodeType!==1)return;
  var cs;
  try{cs=getComputedStyle(srcEl);}catch(_){cs=null;}
  if(cs){
    var importantProps=['color','background-color','font-size','font-weight','font-family','line-height','border-radius','border-color','border-width','padding','margin','width','height','display','visibility','opacity','position','top','left','right','bottom','text-align','overflow','z-index'];
    var styleStr='';
    for(var i=0;i<importantProps.length;i++){
      var p=importantProps[i];
      var v=cs.getPropertyValue(p);
      if(v&&v!=='initial'&&v!=='inherit'&&v!==''){
        styleStr+=p+':'+v+';';
      }
    }
    if(styleStr)destEl.setAttribute('style',destEl.getAttribute('style')||''+styleStr);
  }
  var srcChildren=srcEl.children||[];
  var destChildren=destEl.children||[];
  for(var i=0;i<srcChildren.length&&i<destChildren.length;i++){
    inlineSnapshotStyles(srcChildren[i],destChildren[i]);
  }
}
function renderSnapshot(id){
  var w=Math.max(1,window.innerWidth||document.documentElement.clientWidth||1);
  var h=Math.max(1,window.innerHeight||document.documentElement.clientHeight||1);
  var dpr=window.devicePixelRatio||1;
  var docW=Math.max(w,document.documentElement.scrollWidth||0,document.body?document.body.scrollWidth:0);
  var docH=Math.max(h,document.documentElement.scrollHeight||0,document.body?document.body.scrollHeight:0);
  var clone=document.documentElement.cloneNode(true);
  clone.setAttribute('xmlns','http://www.w3.org/1999/xhtml');
  inlineSnapshotStyles(document.documentElement,clone);
  var scroll=scrollOffset();
  var cloneBody=clone.querySelector('body');
  var rootStyle=clone.getAttribute('style')||'';
  var bodyStyle=cloneBody?cloneBody.getAttribute('style')||'':'';
  var bodyContent=cloneBody?cloneBody.innerHTML:clone.innerHTML;
  var wrapperStyle=rootStyle+bodyStyle+'margin:0;position:relative;left:'+(-scroll.x)+'px;top:'+(-scroll.y)+'px;width:'+docW+'px;height:'+docH+'px;overflow:visible;';
  var html='<div xmlns="http://www.w3.org/1999/xhtml" style="'+escapeAttribute(wrapperStyle)+'">'+bodyContent+'</div>';
  var svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'" viewBox="0 0 '+w+' '+h+'"><foreignObject x="0" y="0" width="'+docW+'" height="'+docH+'">'+html+'</foreignObject></svg>';
  var img=new Image();
  var blob=new Blob([svg],{type:'image/svg+xml;charset=utf-8'});
  var blobUrl=URL.createObjectURL(blob);
  img.onload=function(){
    URL.revokeObjectURL(blobUrl);
    try{
      var canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.floor(w*dpr));
      canvas.height=Math.max(1,Math.floor(h*dpr));
      var ctx=canvas.getContext('2d');
      if(!ctx)throw new Error('no 2d context');
      ctx.scale(dpr,dpr);
      ctx.drawImage(img,0,0,w,h);
      window.parent.postMessage({type:'od:snapshot:result',id:id,dataUrl:canvas.toDataURL('image/png'),w:canvas.width,h:canvas.height},'*');
    }catch(err){
      window.parent.postMessage({type:'od:snapshot:result',id:id,error:String(err&&err.message||err)},'*');
    }
  };
  img.onerror=function(){
    URL.revokeObjectURL(blobUrl);
    console.error('[Snapshot Bridge] Image load failed, SVG length:', svg.length);
    console.error('[Snapshot Bridge] Trying fallback: return empty snapshot (drawing only)');
    window.parent.postMessage({type:'od:snapshot:result',id:id,dataUrl:'',w:w,h:h,fallback:true},'*');
  };
  img.src=blobUrl;
}
window.addEventListener('message',function(ev){
  var data=ev&&ev.data;
  if(!data||data.type!=='od:snapshot'||!data.id)return;
  waitForImages().then(function(){renderSnapshot(String(data.id));});
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
        console.log('[Bridge] Extracting from overrides:', parts[0], parts[1], currentValue);
        result.push({elementId:parts[0],prop:parts[1],value:currentValue});
      }
    });
    
    var allElements=document.querySelectorAll('[data-od-id]');
    for(var i=0;i<allElements.length;i++){
      var el=allElements[i];
      var elementId=el.getAttribute('data-od-id');
      var style=el.style;
      for(var j=0;j<STYLE_PROPS.length;j++){
        var camelProp=STYLE_PROPS[j];
        var cssProp=camelToKebab(camelProp);
        var value=style.getPropertyValue(cssProp);
        var key=elementId+'||'+camelProp;
        if(value && !overrides[key]){
          console.log('[Bridge] Found additional inline style:', elementId, camelProp, value);
          result.push({elementId:elementId,prop:camelProp,value:value});
        }
      }
    }
    
    console.log('[Bridge] Total overrides extracted:', result.length);
    window.parent.postMessage({type:'od:inspect-overrides',overrides:result},'*');
  }
});
})();</script>`

  if (doc.includes("</body>")) {
    return doc.replace("</body>", script + "</body>")
  }
  return doc + script
}

function injectEditBridge(doc: string): string {
  const script = `<script data-od-edit-bridge>(function(){
var editEnabled = false;
var lastSelectedId = null;
var TEXT_PROPS=['textContent'];
var ATTR_PROPS=['href','src','alt'];

// ★ In-place text editing (Open Design style)
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
  clearSelectedTarget();
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
    // ★ Notify parent to move focus (sandbox iframe cannot call parent.focus())
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
  
  // Extract direct text only (not nested in child elements)
  var directTextParts = [];
  for (var i = 0; i < el.childNodes.length; i++) {
    var node = el.childNodes[i];
    if (node.nodeType === 3 && node.textContent && node.textContent.trim()) {
      directTextParts.push(node.textContent.trim());
    }
  }
  var directText = directTextParts.join(' ');
  var allText = el.textContent || '';
  
  // Determine element kind
  var kind = 'container';
  if (tag === 'a') kind = 'link';
  else if (tag === 'img') kind = 'image';
  else if (allText.trim() && el.children.length === 0) kind = 'text';
  else if (['label', 'button', 'span', 'p', 'div'].indexOf(tag) >= 0 && directText.trim()) {
    // Mixed containers: have children AND direct text content (not nested)
    kind = 'mixed';
  }
  
  // Extract fields
  var fields = {};
  if (kind === 'text' || kind === 'link') fields.text = allText.trim().slice(0, 200);
  if (kind === 'mixed') fields.text = directText.trim().slice(0, 200);
  if (kind === 'link') fields.href = el.getAttribute('href') || '';
  if (kind === 'image') {
    fields.src = el.getAttribute('src') || '';
    fields.alt = el.getAttribute('alt') || '';
  }
  
  // Extract styles
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
  
  // Extract attributes
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
        if(typeof value!=='string'||value.trim()===''){
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
      // ★ text/link → in-place editing (not mixed)
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
