import { injectCustomBridge, injectEditBridge, injectEditBridgeStyle, injectInspectStyleBridge, injectModelEditBridge } from "@opencode-ai/core/bridge-scripts"

export type EditPreviewCommit = {
  requestId: string
  removeId?: string
  links: [string, string][]
  dynamicIds: string[]
  overrides: [string, string][]
}

// Runs inside the preview. Capture the values before the edit bridges change them.
export function installEditPreviewUndo(frame: Window, doc: Document) {
  const find = (id: string) => doc.querySelector('[data-od-id="' + CSS.escape(id) + '"]')
  const styles = new Map<Element, string | null>()
  const text = new Map<Element, { node: ChildNode; value: string | null; next: ChildNode | null }[]>()
  frame.addEventListener("message", event => {
    if (event.source !== frame.parent) return
    const data = event.data
    if (data?.type === "od:insight-reset-edit" || data?.type === "od:insight-commit-edit") {
      if (data.type === "od:insight-commit-edit" && data.commit) {
        const commit: EditPreviewCommit = data.commit
        const removed = commit.removeId ? find(commit.removeId) : null
        const links = commit.links.map(([id, href]) => [find(id), href] as const)
        const dynamic = commit.dynamicIds.map(find)
        const ok = (!commit.removeId || !!removed) && links.every(([link]) => !!link) && dynamic.every(element => !!element && styles.has(element))
        if (!ok) {
          frame.parent.postMessage({ type: "od:insight-commit-result", requestId: commit.requestId, ok: false }, "*")
          return
        }
        for (const [attribute, css] of commit.overrides) {
          const node = doc.head.querySelector("style[" + attribute + "]") ?? doc.createElement("style")
          node.setAttribute(attribute, "")
          node.textContent = css
          if (!node.parentNode) doc.head.append(node)
        }
        for (const element of dynamic) {
          if (!element) continue
          const value = styles.get(element)
          if (value == null) element.removeAttribute("style")
          else element.setAttribute("style", value)
        }
        for (const [link, href] of links) link?.setAttribute("href", href)
        removed?.remove()
        frame.parent.postMessage({ type: "od:insight-commit-result", requestId: commit.requestId, ok: true }, "*")
      }
      if (data.type === "od:insight-reset-edit") {
        for (const [element, value] of styles) {
          if (value === null) element.removeAttribute("style")
          else element.setAttribute("style", value)
        }
        for (const [element, entries] of text) {
          for (const node of Array.from(element.childNodes)) if (node.nodeType === 3) node.remove()
          for (const entry of entries) {
            entry.node.nodeValue = entry.value
            element.insertBefore(entry.node, entry.next?.parentNode === element ? entry.next : null)
          }
        }
      }
      styles.clear()
      text.clear()
      return
    }
    if (data?.type !== "od:edit-preview-style" && data?.type !== "od:edit-text") return
    const id = data.type === "od:edit-text" ? data.elementId : data.id
    if (typeof id !== "string") return
    const element = find(id)
    if (!element) return
    if (data.type === "od:edit-preview-style" && !styles.has(element)) styles.set(element, element.getAttribute("style"))
    if (data.type === "od:edit-text" && !text.has(element)) {
      text.set(element, Array.from(element.childNodes).flatMap(node => {
        if (node.nodeType !== 3 && (element.children.length || node.nodeType !== 8)) return []
        let next = element.children.length ? node.nextSibling : null
        while (next && next.nodeType === 3) next = next.nextSibling
        return [{ node, value: node.nodeValue, next }]
      }))
    }
  }, true)
}

export function injectInsightEditBridge(html: string) {
  const undo = injectCustomBridge(html, `(${installEditPreviewUndo.toString()})(window, document)`)
  return injectEditBridgeStyle(injectModelEditBridge(injectEditBridge(injectInspectStyleBridge(undo))))
}
