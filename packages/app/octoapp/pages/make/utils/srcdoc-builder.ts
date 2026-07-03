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

import {
  injectSandboxShim,
  injectFocusGuard,
  injectDeckBridge,
  injectPaletteBridge,
  injectPickerBridge,
  injectSnapshotBridge,
  injectInspectStyleBridge,
  injectEditBridge,
  injectEditBridgeStyle,
  annotateElementsWithIdsBrowser,
} from "@opencode-ai/core/bridge-scripts"

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
    doc = annotateElementsWithIdsBrowser(doc)
  }

  if (options.focusGuard) {
    doc = injectFocusGuard(doc)
  }

  if (options.deck) {
    doc = injectDeckBridge(doc, options.initialSlideIndex)
  }

  if (options.palette) {
    doc = injectPaletteBridge(doc, options.initialPalette ?? null)
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

export { annotateElementsWithIdsBrowser as annotateElementsWithIds }
