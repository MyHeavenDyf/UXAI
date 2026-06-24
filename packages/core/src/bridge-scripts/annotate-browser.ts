/// <reference lib="dom" />

export function annotateElementsWithIds(doc: string): string {
  const parser = new DOMParser()
  const parsedDoc = parser.parseFromString(doc, "text/html")

  let maxId = -1
  const existingElements = parsedDoc.querySelectorAll("[data-od-id]")
  existingElements.forEach((el: Element) => {
    const idAttr = el.getAttribute("data-od-id")
    if (idAttr && idAttr.startsWith("el-")) {
      const idNum = parseInt(idAttr.substring(3), 10)
      if (!isNaN(idNum) && idNum > maxId) maxId = idNum
    }
  })

  let counter = maxId + 1

  const walk = (el: Element) => {
    if (el.tagName !== "SCRIPT" && el.tagName !== "STYLE" && el.tagName !== "HEAD") {
      if (!el.hasAttribute("data-od-id")) {
        el.setAttribute("data-od-id", `el-${counter++}`)
      }
    }
    for (const child of Array.from(el.children)) {
      walk(child)
    }
  }

  walk(parsedDoc.body)
  return parsedDoc.documentElement.outerHTML
}

export * as BridgeAnnotateBrowser from "./annotate-browser"