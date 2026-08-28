import { BrowserWindow, session } from "electron"
import { randomUUID } from "node:crypto"

export interface CapturePageOptions {
  url: string
  theme?: "light" | "dark"
  waitForMs?: number
}

export interface CapturePageResult {
  html: string
  resourceCount: number
}

// Minimal script: tag components + download external CSS/images, keep all <style> tags as-is.
const CAPTURE_SCRIPT = `(async function() {
  function toDataUri(blob) {
    return new Promise(function(resolve) {
      var reader = new FileReader();
      reader.onloadend = function() { resolve(reader.result); };
      reader.onerror = function() { resolve(null); };
      reader.readAsDataURL(blob);
    });
  }

  // 1. Collect all resource URLs to download
  var fetchUrls = new Set();

  // External CSS files
  document.querySelectorAll('link[rel="stylesheet"]').forEach(function(el) {
    if (el.href && !el.href.startsWith('data:')) fetchUrls.add(el.href);
  });

  // Images
  document.querySelectorAll('img[src]').forEach(function(el) {
    if (el.src && !el.src.startsWith('data:') && !el.src.startsWith('blob:')) fetchUrls.add(el.src);
  });
  document.querySelectorAll('source[src]').forEach(function(el) {
    if (el.src && !el.src.startsWith('data:')) fetchUrls.add(el.src);
  });

  // CSS url() references in stylesheets
  for (var i = 0; i < document.styleSheets.length; i++) {
    try {
      var rules = document.styleSheets[i].cssRules;
      if (!rules) continue;
      for (var j = 0; j < rules.length; j++) {
        var text = rules[j].cssText;
        if (!text) continue;
        var matches = text.match(/url\\(["']?([^"')]+)["']?\\)/g);
        if (matches) {
          matches.forEach(function(m) {
            var u = m.replace(/url\\(["']?([^"')]+)["']?\\)/, '$1');
            if (!u.startsWith('data:') && !u.startsWith('blob:')) {
              try { fetchUrls.add(new URL(u, location.href).href); } catch(e) {}
            }
          });
        }
      }
    } catch(e) {}
  }

  // 2. Download all resources (8s per-fetch timeout; skip oversized binaries that exceed the inline limit anyway)
  var urlMap = {};
  var cssTextMap = {};
  var count = 0;
  var MAX_INLINE_BYTES = 70000;
  await Promise.all(Array.from(fetchUrls).map(async function(u) {
    try {
      var controller = new AbortController();
      var timer = setTimeout(function() { controller.abort(); }, 8000);
      var res = await fetch(u, { signal: controller.signal });
      clearTimeout(timer);
      var contentType = (res.headers.get('content-type') || '').toLowerCase();
      var isCss = contentType.indexOf('text/css') !== -1 || contentType.indexOf('stylesheet') !== -1;
      if (!isCss) {
        var len = parseInt(res.headers.get('content-length') || '0', 10);
        if (len > MAX_INLINE_BYTES) return;
      }
      var blob = await res.blob();

      if (isCss) {
        // CSS file: store raw text to inline as <style>
        cssTextMap[u] = await blob.text();
      } else if (blob.size <= MAX_INLINE_BYTES) {
        // Other resources (images, fonts): store as data URI
        var dataUri = await toDataUri(blob);
        if (dataUri) urlMap[u] = dataUri;
      } else {
        return;
      }
      count++;
    } catch(e) {}
  }));

  // 3. Clone DOM — keep everything EXCEPT scripts/icons/base
  var clone = document.documentElement.cloneNode(true);

  // Tag recognized components with OCTO_C2D_ID
  var PIXSO_COMPS = ['Button','Badge','Dropdown','Menu','Input','InputNumber','Steps','Checkbox','CheckboxGroup','Select','Tabs','Tag','Switch','Carousel','Collapse','Divider','Segmented','Timeline','Tree','Datepicker','Timepicker','Breadcrumb','RadioGroup','Rate','Slider','Progress','Textarea','PieChart', 'BarChart','ProcessChart', 'BubbleChart', 'ScatterChart', 'FunnelChart','RadarChart', 'GaugeChart', 'HillChart', 'BulletChart', 'CircleProcessChart','AssembleBubbleChart', 'JadeJueChart', 'LineChart'];
  function tagComponents(node) {
    if (node.nodeType !== 1) return;
    var ct = node.getAttribute('dom-picker-component');
    if (ct && PIXSO_COMPS.indexOf(ct) !== -1) {
      var id = node.getAttribute('id') || '';
      var cls = node.getAttribute('class') || '';
      node.setAttribute('class', cls + ' OCTO_C2D_ID_' + id);
      if(node.getAttribute('id')) {
        node.setAttribute('id', 'OCTO_C2D_ID_' + id);
      }
    }
    for (var i = 0; i < node.children.length; i++) tagComponents(node.children[i]);
  }
  tagComponents(clone);

  // Remove only scripts and icon links — KEEP all <style> tags intact!
  clone.querySelectorAll('script').forEach(function(el) { el.remove(); });
  clone.querySelectorAll('base').forEach(function(el) { el.remove(); });
  clone.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"]').forEach(function(el) { el.remove(); });

  // 4. Inline external CSS: replace <link rel="stylesheet"> with <style> containing the downloaded CSS
  var extraCss = '';
  clone.querySelectorAll('link[rel="stylesheet"]').forEach(function(el) {
    var href = el.href || el.getAttribute('href');
    if (!href) { el.remove(); return; }
    // Resolve to absolute URL for lookup
    try {
      var absUrl = new URL(href, location.href).href;
      if (cssTextMap[absUrl]) {
        // Replace url() in the CSS with data URIs
        var css = cssTextMap[absUrl];
        for (var orig in urlMap) {
          if (urlMap[orig].length <= 100000) {
            css = css.split(orig).join(urlMap[orig]);
            try {
              var pn = new URL(orig, location.href).pathname;
              if (pn && pn !== '/') css = css.split(pn).join(urlMap[orig]);
            } catch(e) {}
          }
        }
        extraCss += '\\n' + css;
      }
    } catch(e) {}
    el.remove();
  });

  // 5. Inline images
  clone.querySelectorAll('img[src]').forEach(function(el) {
    var src = el.getAttribute('src');
    if (!src) return;
    try {
      var au = new URL(src, location.href).href;
      var data = urlMap[au];
      if (data && data.length <= 100000) el.setAttribute('src', data);
    } catch(e) {}
  });

  // 6. Replace url() references inside inline <style> tags with data URIs
  clone.querySelectorAll('style').forEach(function(el) {
    var css = el.textContent;
    if (!css || css.indexOf('url(') === -1) return;
    for (var orig2 in urlMap) {
      if (urlMap[orig2].length <= 100000) {
        css = css.split(orig2).join(urlMap[orig2]);
        try {
          var pn2 = new URL(orig2, location.href).pathname;
          if (pn2 && pn2 !== '/') css = css.split(pn2).join(urlMap[orig2]);
        } catch(e) {}
      }
    }
    el.textContent = css;
  });

  // 7. Inject downloaded external CSS before </head>
  var html = clone.outerHTML;
  if (extraCss) {
    html = html.replace(/<\\/head>/i, '<style>' + extraCss + '</style>\\n</head>');
  }

  return JSON.stringify({ html: '<!DOCTYPE html>\\n' + html, resourceCount: count });
})()`

export async function codeToHtml(opts: CapturePageOptions): Promise<CapturePageResult> {
  const partition = `capture-${randomUUID().slice(0, 8)}`
  const ses = session.fromPartition(partition)
  await ses.setProxy({ mode: "direct" })

  // Track in-flight requests to detect network idle instead of a fixed sleep
  let pending = 0
  let idleResolve: (() => void) | undefined
  let settleTimer: NodeJS.Timeout | undefined
  const settle = () => {
    clearTimeout(settleTimer)
    settleTimer = setTimeout(() => {
      if (pending === 0) idleResolve?.()
    }, 500)
  }
  const onRequest = () => {
    pending++
    clearTimeout(settleTimer)
  }
  const onDone = () => {
    pending = Math.max(0, pending - 1)
    if (pending === 0) settle()
  }
  ses.webRequest.onBeforeRequest((_details, callback) => {
    onRequest()
    callback({})
  })
  ses.webRequest.onBeforeRedirect(onDone)
  ses.webRequest.onCompleted(onDone)
  ses.webRequest.onErrorOccurred(onDone)

  const win = new BrowserWindow({
    width: 1920,
    height: 1080,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition,
    },
  })

  try {
    await new Promise<void>((resolve) => {
      let done = false
      const finish = () => { if (!done) { done = true; resolve() } }
      win.webContents.once("did-finish-load", finish)
      win.webContents.once("did-fail-load", finish)
      win.webContents.loadURL(opts.url).then(finish).catch(finish)
      setTimeout(finish, 15000)
    })

    if (opts.theme) {
      await new Promise((r) => setTimeout(r, 200))
      await win.webContents.executeJavaScript(
        `window.postMessage({ type: "TOGGLE_THEME", theme: ${JSON.stringify(opts.theme)} }, "*")`,
      )
    }

    // Wait until no requests for 500ms (capped at 10s), then a small settle for JS rendering
    await new Promise<void>((resolve) => {
      idleResolve = resolve
      if (pending === 0) settle()
      setTimeout(resolve, 10000)
    })
    await new Promise((r) => setTimeout(r, opts.waitForMs ?? 300))

    const json = await win.webContents.executeJavaScript(CAPTURE_SCRIPT)
    return JSON.parse(json) as CapturePageResult
  } finally {
    clearTimeout(settleTimer)
    if (!win.isDestroyed()) win.destroy()
  }
}
