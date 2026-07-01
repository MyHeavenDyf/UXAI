export function annotateElementsWithIds(doc: string): string {
  // Dynamic import to avoid bundling jsdom in browser environments
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { JSDOM } = require("jsdom")
  const dom = new JSDOM(doc)
  const parsedDoc = dom.window.document

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

export * as BridgeAnnotateNode from "./annotate-node"