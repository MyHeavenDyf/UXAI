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
      s.style.display = i === current ? 'block' : 'none';
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
