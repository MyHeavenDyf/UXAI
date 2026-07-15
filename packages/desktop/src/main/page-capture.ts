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

// Runs inside the page: collects CSS + images, strips JS, produces clean static HTML for Pixso.
const INLINE_SCRIPT = `(async function() {
  function toDataUri(blob) {
    return new Promise(function(resolve) {
      var reader = new FileReader();
      reader.onloadend = function() { resolve(reader.result); };
      reader.onerror = function() { resolve(null); };
      reader.readAsDataURL(blob);
    });
  }

  // 1. Collect image URLs only (CSS handled separately)
  var imgUrls = new Set();
  document.querySelectorAll('img[src]').forEach(function(el) {
    if (el.src && !el.src.startsWith('data:') && !el.src.startsWith('blob:')) imgUrls.add(el.src);
  });
  document.querySelectorAll('source[src]').forEach(function(el) {
    if (el.src && !el.src.startsWith('data:')) imgUrls.add(el.src);
  });
  document.querySelectorAll('video[poster]').forEach(function(el) {
    if (el.poster && !el.poster.startsWith('data:')) imgUrls.add(el.poster);
  });

  // Collect url() refs from stylesheets (images/fonts)
  var cssUrls = new Set();
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
              try { cssUrls.add(new URL(u, location.href).href); } catch(e) {}
            }
          });
        }
      }
    } catch(e) {}
  }

  // Merge all URLs that need fetching (images + CSS url() assets)
  var allUrls = new Set([].concat(Array.from(imgUrls), Array.from(cssUrls)));
  var urlMap = {};
  var count = 0;
  await Promise.all(Array.from(allUrls).map(async function(u) {
    try {
      var res = await fetch(u);
      var blob = await res.blob();
      var dataUri = await toDataUri(blob);
      if (dataUri) { urlMap[u] = dataUri; count++; }
    } catch(e) {}
  }));

  // 3. Collect all computed CSS into one stylesheet
  // Recursively unwrap @layer / @media / @container blocks so Pixso can parse rules.
  function flattenRules(rules) {
    var out = '';
    for (var ri = 0; ri < rules.length; ri++) {
      var rule = rules[ri];
      if (rule.cssRules && rule.cssRules.length > 0) {
        // @layer, @media, @container, @supports — unwrap and inline inner rules
        out += flattenRules(rule.cssRules);
      } else if (rule.cssText) {
        out += rule.cssText + '\\n';
      }
    }
    return out;
  }

  var cssText = '';
  for (var si = 0; si < document.styleSheets.length; si++) {
    try {
      var sheetRules = document.styleSheets[si].cssRules;
      if (!sheetRules) continue;
      cssText += flattenRules(sheetRules);
    } catch(e) {}
  }

  // Strip any remaining @layer / @container declarations
  cssText = cssText.replace(/@layer\\s+[^{;]+\\s*\\{[^}]*\\}/g, '');
  cssText = cssText.replace(/@layer\\s+[\\w\\s,]+;/g, '');

  // Replace url() in CSS with data URIs (skip huge resources like font files >100KB)
  for (var orig in urlMap) {
    var dataVal = urlMap[orig];
    // Skip large data URIs (fonts, big images) to keep HTML manageable
    if (dataVal.length > 100000) {
      cssText = cssText.split(orig).join('');
      try {
        var pn2 = new URL(orig, location.href).pathname;
        if (pn2 && pn2 !== '/') cssText = cssText.split(pn2).join('');
      } catch(e) {}
    } else {
      cssText = cssText.split(orig).join(dataVal);
      try {
        var pn = new URL(orig, location.href).pathname;
        if (pn && pn !== '/') cssText = cssText.split(pn).join(dataVal);
      } catch(e) {}
    }
  }

  // 4. Clone the document, strip scripts + existing styles + external links
  var clone = document.documentElement.cloneNode(true);

  // Inline computed border on elements that have non-zero border-width.
  // Pixso's CSS parser doesn't resolve var() chains like browsers do, so
  // border: var(--el-button-border) → var(--el-border) → var(--el-border-width) ... fails.
  // We read getComputedStyle and write explicit border shorthand directly on the element.
  var PIXSO_COMPONENTS = new Set(['Button', 'Badge', 'Dropdown', 'Menu', 'Input', 'Checkbox', 'Select', 'Tabs', 'Tag']);
  var originalRoot = document.documentElement;
  var cloneRoot = clone;
  function walkAndInlineBorder(origNode, cloneNode) {
    if (origNode.nodeType !== 1 || cloneNode.nodeType !== 1) return;

    // Add class name for recognized components (Pixso layer naming)
    var compType = origNode.getAttribute('dom-picker-component');
    if (compType && PIXSO_COMPONENTS.has(compType)) {
      var elemId = origNode.getAttribute('dom-picker-id') || '';
      var existingClass = cloneNode.getAttribute('class') || '';
      cloneNode.setAttribute('class', existingClass + ' OCTO_' + elemId);
    }

    var cs = window.getComputedStyle(origNode);
    var bw = cs.getPropertyValue('border-top-width');
    var bs = cs.getPropertyValue('border-top-style');
    var bc = cs.getPropertyValue('border-top-color');
    if (bw && bs && bs !== 'none' && bw !== '0px') {
      cloneNode.style.setProperty('border-top', bw + ' ' + bs + ' ' + bc, 'important');
      cloneNode.style.setProperty('border-bottom', cs.getPropertyValue('border-bottom-width') + ' ' + cs.getPropertyValue('border-bottom-style') + ' ' + cs.getPropertyValue('border-bottom-color'), 'important');
      cloneNode.style.setProperty('border-left', cs.getPropertyValue('border-left-width') + ' ' + cs.getPropertyValue('border-left-style') + ' ' + cs.getPropertyValue('border-left-color'), 'important');
      cloneNode.style.setProperty('border-right', cs.getPropertyValue('border-right-width') + ' ' + cs.getPropertyValue('border-right-style') + ' ' + cs.getPropertyValue('border-right-color'), 'important');
    }
    var origKids = origNode.children;
    var cloneKids = cloneNode.children;
    for (var i = 0; i < origKids.length && i < cloneKids.length; i++) {
      walkAndInlineBorder(origKids[i], cloneKids[i]);
    }
  }
  walkAndInlineBorder(originalRoot, cloneRoot);

  // Remove all <script> tags
  clone.querySelectorAll('script').forEach(function(el) { el.remove(); });

  // Remove all <link rel="stylesheet"> tags
  clone.querySelectorAll('link[rel="stylesheet"]').forEach(function(el) { el.remove(); });

  // Remove existing <style> tags (we'll add one consolidated <style>)
  clone.querySelectorAll('style').forEach(function(el) { el.remove(); });

  // Remove <base> tags
  clone.querySelectorAll('base').forEach(function(el) { el.remove(); });

  // Remove <link rel="icon"> etc that point to external resources
  clone.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"]').forEach(function(el) { el.remove(); });

  // 5. Replace img src with data URIs (skip huge images >100KB)
  clone.querySelectorAll('img[src]').forEach(function(el) {
    if (el.getAttribute('src')) {
      var src = el.getAttribute('src');
      try {
        var absUrl = new URL(src, location.href).href;
        var data = urlMap[absUrl];
        if (data && data.length <= 100000) el.setAttribute('src', data);
      } catch(e) {}
    }
  });

  // 6. Inject CSS variable fallbacks for Element Plus (Pixso doesn't resolve CSS custom properties the same way browsers do)
  var fallbacks = ':root {\\n'
    + '  --el-border-width: 1px;\\n'
    + '  --el-border-style: solid;\\n'
    + '  --el-border-color: #dcdfe6;\\n'
    + '  --el-border-color-light: #e4e7ed;\\n'
    + '  --el-border-color-lighter: #ebeef5;\\n'
    + '  --el-border-color-extra-light: #f2f6fc;\\n'
    + '  --el-border-color-hover: #c0c4cc;\\n'
    + '  --el-border-color-dark: #d4d7de;\\n'
    + '}\\n';

  // 7. Get clean HTML, inject consolidated CSS
  var html = clone.outerHTML;
  html = html.replace(/<\\/head>/i, '<style>\\n' + fallbacks + cssText + '\\n</style>\\n</head>');

  return JSON.stringify({ html: '<!DOCTYPE html>\\n' + html, resourceCount: count });
})()`

export async function codeToHtml(opts: CapturePageOptions): Promise<CapturePageResult> {
  const partition = `capture-${randomUUID().slice(0, 8)}`
  await session.fromPartition(partition).setProxy({ mode: "direct" })

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

    const json = await win.webContents.executeJavaScript(INLINE_SCRIPT)
    return JSON.parse(json) as CapturePageResult
  } catch (err) {
    throw err
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}
