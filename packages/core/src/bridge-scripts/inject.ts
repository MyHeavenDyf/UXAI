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

export * as BridgeInject from "./inject"