import {
  SANDBOX_SHIM_SCRIPT,
  FOCUS_GUARD_SCRIPT,
  getDeckBridgeScript,
  getPaletteBridgeScript,
  PICKER_BRIDGE_SCRIPT,
  SNAPSHOT_BRIDGE_SCRIPT,
  INSPECT_STYLE_BRIDGE_SCRIPT,
  EDIT_BRIDGE_SCRIPT,
  EDIT_BRIDGE_STYLE,
} from "./constants"
import { COMMENT_BRIDGE_SCRIPT, COMMENT_OUTLINE_CSS, injectCommentBridge as injectCommentBridgeImpl } from "./comment"
import { RESOURCE_COLLECTOR_BRIDGE_SCRIPT } from "./resource-collector"
import { MODEL_EDIT_BRIDGE_SCRIPT } from "./model-edit-bridge"

export function injectSandboxShim(doc: string): string {
  if (/<head[^>]*>/i.test(doc)) {
    return doc.replace(/<head[^>]*>/i, (m) => `${m}${SANDBOX_SHIM_SCRIPT}`)
  }
  if (/<body[^>]*>/i.test(doc)) {
    return doc.replace(/<body[^>]*>/i, (m) => `${m}${SANDBOX_SHIM_SCRIPT}`)
  }
  return SANDBOX_SHIM_SCRIPT + doc
}

export function injectFocusGuard(doc: string): string {
  if (/<head[^>]*>/i.test(doc)) {
    return doc.replace(/<head[^>]*>/i, (m) => `${m}${FOCUS_GUARD_SCRIPT}`)
  }
  return doc
}

export function injectDeckBridge(doc: string, initialSlide: number = 0): string {
  const script = getDeckBridgeScript(initialSlide)
  if (doc.includes("</body>")) {
    return doc.replace("</body>", script + "</body>")
  }
  return doc + script
}

export function injectPaletteBridge(doc: string, initialPalette: string | null = null): string {
  const script = getPaletteBridgeScript(initialPalette)
  if (doc.includes("</body>")) {
    return doc.replace("</body>", script + "</body>")
  }
  return doc + script
}

export function injectPickerBridge(doc: string): string {
  if (doc.includes("</body>")) {
    return doc.replace("</body>", PICKER_BRIDGE_SCRIPT + "</body>")
  }
  return doc + PICKER_BRIDGE_SCRIPT
}

export function injectSnapshotBridge(doc: string): string {
  if (doc.includes("</body>")) {
    return doc.replace("</body>", SNAPSHOT_BRIDGE_SCRIPT + "</body>")
  }
  return doc + SNAPSHOT_BRIDGE_SCRIPT
}

export function injectInspectStyleBridge(doc: string): string {
  if (doc.includes("</body>")) {
    return doc.replace("</body>", INSPECT_STYLE_BRIDGE_SCRIPT + "</body>")
  }
  return doc + INSPECT_STYLE_BRIDGE_SCRIPT
}

export function injectEditBridge(doc: string): string {
  if (doc.includes("</body>")) {
    return doc.replace("</body>", EDIT_BRIDGE_SCRIPT + "</body>")
  }
  return doc + EDIT_BRIDGE_SCRIPT
}

export function injectEditBridgeStyle(doc: string): string {
  if (doc.includes("</head>")) {
    return doc.replace("</head>", EDIT_BRIDGE_STYLE + "</head>")
  }
  if (doc.includes("<body")) {
    return doc.replace("<body", EDIT_BRIDGE_STYLE + "<body")
  }
  return doc + EDIT_BRIDGE_STYLE
}

export function injectCommentBridge(doc: string): string {
  return injectCommentBridgeImpl(doc)
}

export function injectResourceCollectorBridge(doc: string): string {
  if (doc.includes("</body>")) {
    return doc.replace("</body>", RESOURCE_COLLECTOR_BRIDGE_SCRIPT + "</body>")
  }
  return doc + RESOURCE_COLLECTOR_BRIDGE_SCRIPT
}

export function injectModelEditBridge(doc: string): string {
  if (doc.includes("</body>")) {
    return doc.replace("</body>", MODEL_EDIT_BRIDGE_SCRIPT + "</body>")
  }
  return doc + MODEL_EDIT_BRIDGE_SCRIPT
}

export function injectCustomBridge(
  doc: string, 
  script: string, 
  options?: { 
    style?: string
    position?: 'head' | 'body'
  }
): string {
  const position = options?.position || 'body'
  
  if (options?.style) {
    const styleTag = `<style data-od-custom-bridge-style>${options.style}</style>`
    if (doc.includes('</head>')) {
      doc = doc.replace('</head>', styleTag + '</head>')
    } else if (doc.includes('<body')) {
      doc = doc.replace('<body', styleTag + '<body')
    }
  }
  
  const scriptTag = `<script data-od-custom-bridge>${script}</script>`
  if (position === 'head') {
    if (doc.includes('</head>')) {
      return doc.replace('</head>', scriptTag + '</head>')
    }
  } else {
    if (doc.includes('</body>')) {
      return doc.replace('</body>', scriptTag + '</body>')
    }
  }
  
  return doc + scriptTag
}

export * as BridgeInject from "./inject"