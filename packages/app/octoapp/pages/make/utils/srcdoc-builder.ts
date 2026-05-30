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
    });
    try {
      window.parent.postMessage({ type: 'od:slide-state', active: current, count: total }, '*');
    } catch (_) {}
  }
  document.addEventListener('keydown', function(e){
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); showSlide(current + 1); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); showSlide(current - 1); }
    if (e.key === 'Home') { e.preventDefault(); showSlide(0); }
    if (e.key === 'End') { e.preventDefault(); showSlide(getAllSlides().length - 1); }
  });
  window.addEventListener('message', function(e){
    if (!e.data || e.data.type !== 'od:slide') return;
    if (e.data.action === 'next') showSlide(current + 1);
    else if (e.data.action === 'prev') showSlide(current - 1);
    else if (e.data.action === 'first') showSlide(0);
    else if (e.data.action === 'last') showSlide(getAllSlides().length - 1);
    else if (e.data.action === 'go' && typeof e.data.index === 'number') showSlide(e.data.index);
  });
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
  return{color:cs.color,backgroundColor:cs.backgroundColor,fontSize:cs.fontSize,fontWeight:cs.fontWeight,borderRadius:cs.borderRadius};
}
function targetFrom(el){
  var r=el.getBoundingClientRect();
  return{type:'od:inspect-target',tag:tagLabel(el),selector:selector(el),text:(el.textContent||'').trim().slice(0,120),position:{x:r.x,y:r.y,width:r.width,height:r.height},style:styleSnap(el),htmlHint:el.outerHTML.slice(0,Math.min(200,el.outerHTML.indexOf('>')+1))};
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
