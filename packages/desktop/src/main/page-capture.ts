import { BrowserWindow, net, session } from "electron"
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

// Phase 1 — collect every resource URL the rendered page references.
// No fetching happens here: page-side fetch is CORS-bound, so cross-origin
// CSS/images/fonts would silently fail. We hand the URL list to the main
// process, which fetches via net.fetch (main process has no Origin → no CORS).
const COLLECT_SCRIPT = `(function() {
  var urls = new Set();

  document.querySelectorAll('link[rel="stylesheet"]').forEach(function(el) {
    if (el.href && !el.href.startsWith('data:')) {
      try { urls.add(new URL(el.href, location.href).href); } catch(e) {}
    }
  });

  document.querySelectorAll('img[src]').forEach(function(el) {
    var s = el.getAttribute('src');
    if (s && !s.startsWith('data:') && !s.startsWith('blob:')) {
      try { urls.add(new URL(s, location.href).href); } catch(e) {}
    }
  });

  document.querySelectorAll('source[src]').forEach(function(el) {
    var s = el.getAttribute('src');
    if (s && !s.startsWith('data:') && !s.startsWith('blob:')) {
      try { urls.add(new URL(s, location.href).href); } catch(e) {}
    }
  });

  // url() refs in inline <style> tags — always same-origin content, readable.
  document.querySelectorAll('style').forEach(function(el) {
    var css = el.textContent || '';
    var matches = css.match(/url\\(["']?[^"')]+["']?\\)/g);
    if (matches) matches.forEach(function(m) {
      var u = m.replace(/url\\(["']?([^"')]+)["']?\\)/, '$1');
      if (!u.startsWith('data:') && !u.startsWith('blob:')) {
        try { urls.add(new URL(u, location.href).href); } catch(e) {}
      }
    });
  });

  // url() refs in same-origin / adopted stylesheets. Cross-origin sheets throw
  // SecurityError on cssRules — those are handled by main process fetching the
  // <link href> and parsing the CSS text itself.
  for (var i = 0; i < document.styleSheets.length; i++) {
    try {
      var sheet = document.styleSheets[i];
      if (sheet.href) continue;
      var rules = sheet.cssRules;
      if (!rules) continue;
      for (var j = 0; j < rules.length; j++) {
        var text = rules[j].cssText;
        if (!text) continue;
        var matches = text.match(/url\\(["']?[^"')]+["']?\\)/g);
        if (matches) matches.forEach(function(m) {
          var u = m.replace(/url\\(["']?([^"')]+)["']?\\)/, '$1');
          if (!u.startsWith('data:') && !u.startsWith('blob:')) {
            try { urls.add(new URL(u, location.href).href); } catch(e) {}
          }
        });
      }
    } catch(e) {}
  }

  return JSON.stringify(Array.from(urls));
})()`

// Phase 3 — transform the DOM using urlMap (URL → data URI) and cssTextMap
// (CSS URL → raw CSS text). The url() replacement inside the inlined CSS is
// done here, same as for inline <style> tags, using urlMap. Maps are injected
// by buildTransformScript() — JSON is a valid JS subset, so the literal is
// safe to embed (no template literal, no interpolation pitfalls).
const TRANSFORM_BODY = `
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

  var clone = document.documentElement.cloneNode(true);
  tagComponents(clone);

  clone.querySelectorAll('script').forEach(function(el) { el.remove(); });
  clone.querySelectorAll('base').forEach(function(el) { el.remove(); });
  clone.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"]').forEach(function(el) { el.remove(); });

  var extraCss = '';
  clone.querySelectorAll('link[rel="stylesheet"]').forEach(function(el) {
    var href = el.href || el.getAttribute('href');
    if (!href) { el.remove(); return; }
    try {
      var absUrl = new URL(href, location.href).href;
      if (cssTextMap[absUrl]) {
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

  clone.querySelectorAll('img[src]').forEach(function(el) {
    var src = el.getAttribute('src');
    if (!src) return;
    try {
      var au = new URL(src, location.href).href;
      var data = urlMap[au];
      if (data && data.length <= 100000) el.setAttribute('src', data);
    } catch(e) {}
  });

  clone.querySelectorAll('source[src]').forEach(function(el) {
    var src = el.getAttribute('src');
    if (!src) return;
    try {
      var au = new URL(src, location.href).href;
      var data = urlMap[au];
      if (data && data.length <= 100000) el.setAttribute('src', data);
    } catch(e) {}
  });

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

  var html = clone.outerHTML;
  if (extraCss) {
    html = html.replace(/<\\/head>/i, '<style>' + extraCss + '</style>\\n</head>');
  }

  return JSON.stringify({ html: '<!DOCTYPE html>\\n' + html, resourceCount: count });
`

// Phase 2 — fetch every collected URL through the main process via net.fetch.
// net.fetch bypasses CORS (main process has no Origin → no preflight, no
// Same-Origin policy on reads). It uses the default session (system proxy),
// matching how the rest of this codebase does main-process network. CSS files
// are parsed for url() refs, which are enqueued for fetching — so url() refs
// inside cross-origin CSS now resolve too (previously unreachable: cssRules
// threw SecurityError, and the page's fetch() was CORS-blocked).
async function fetchResources(
  initialUrls: string[],
): Promise<{ urlMap: Record<string, string>; cssTextMap: Record<string, string>; count: number }> {
  const urlMap: Record<string, string> = {}
  const cssTextMap: Record<string, string> = {}
  const seen = new Set<string>(initialUrls)
  const queue = [...initialUrls]

  while (queue.length > 0) {
    const batch = queue.splice(0, queue.length)
    await Promise.all(
      batch.map(async (u) => {
        try {
          const res = await net.fetch(u)
          if (!res.ok) return
          const contentType = (res.headers.get("content-type") || "").toLowerCase()
          if (contentType.indexOf("text/css") !== -1 || contentType.indexOf("stylesheet") !== -1) {
            const text = await res.text()
            cssTextMap[u] = text
            const urlPattern = /url\(["']?([^"')]+)["']?\)/g
            let m: RegExpExecArray | null
            while ((m = urlPattern.exec(text)) !== null) {
              const ref = m[1]
              if (ref.startsWith("data:") || ref.startsWith("blob:")) continue
              try {
                const absRef = new URL(ref, u).href
                if (!seen.has(absRef)) {
                  seen.add(absRef)
                  queue.push(absRef)
                }
              } catch {}
            }
          } else {
            const buf = Buffer.from(await res.arrayBuffer())
            const mime = contentType.split(";")[0].trim() || "application/octet-stream"
            urlMap[u] = `data:${mime};base64,${buf.toString("base64")}`
          }
        } catch {}
      }),
    )
  }

  const count = Object.keys(urlMap).length + Object.keys(cssTextMap).length
  return { urlMap, cssTextMap, count }
}

export async function codeToHtml(opts: CapturePageOptions): Promise<CapturePageResult> {
  const partition = `capture-${randomUUID().slice(0, 8)}`
  const ses = session.fromPartition(partition)
  await ses.setProxy({ mode: "direct" })

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
      await new Promise((r) => setTimeout(r, 300))
      await win.webContents.executeJavaScript(
        `window.postMessage({ type: "TOGGLE_THEME", theme: ${JSON.stringify(opts.theme)} }, "*")`,
      )
    }

    await new Promise((r) => setTimeout(r, opts.waitForMs ?? 3000))

    // Phase 1: collect URLs from the rendered page (no fetch — CORS-bound).
    const urlsJson = await win.webContents.executeJavaScript(COLLECT_SCRIPT)
    const urls: string[] = JSON.parse(urlsJson)

    // Phase 2: main-process fetch via net.fetch (no CORS).
    const { urlMap, cssTextMap, count } = await fetchResources(urls)

    // Phase 3: transform DOM using the fetched maps → single-file HTML.
    // Maps are embedded as a JSON literal (valid JS) via string concatenation —
    // never a template literal, so ${...} or backticks inside CSS can't break it.
    const mapsLiteral = JSON.stringify({ urlMap, cssTextMap, count })
    const transformCode =
      "(function(){var M=" + mapsLiteral + ";var urlMap=M.urlMap;var cssTextMap=M.cssTextMap;var count=M.count;" + TRANSFORM_BODY + "})()"
    const json = await win.webContents.executeJavaScript(transformCode)
    return JSON.parse(json) as CapturePageResult
  } catch (err) {
    throw err
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}
