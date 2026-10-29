const decoration = "[data-studio-recommendation-chip], [data-studio-recommendation-placeholder]"

export function composerText(element: Node): string {
  if (element.nodeType === Node.TEXT_NODE) return (element.textContent ?? "").replace(/\u200B/g, "")
  if (element instanceof Element && element.matches(decoration)) return ""
  if (element instanceof Element && element.tagName === "BR") return "\n"
  return Array.from(element.childNodes)
    .filter((node) => !(node instanceof Element && node.matches(decoration)))
    .map((node, index) => {
      const text = composerText(node)
      return index > 0 && node instanceof Element && ["DIV", "P"].includes(node.tagName) ? `\n${text}` : text
    })
    .join("")
}

export function composerHTML(element: HTMLElement) {
  const clone = element.cloneNode(true) as HTMLElement
  clone.querySelectorAll(decoration).forEach((node) => node.remove())
  return clone.innerHTML
}

export function stripComposerMentions(element: HTMLElement) {
  const mentions = Array.from(element.querySelectorAll<HTMLElement>(".studio-composer-at-chip"))
  mentions.forEach((chip) => {
    const next = chip.nextSibling
    if (next?.nodeType === Node.TEXT_NODE && next.textContent?.startsWith("\u200B")) {
      next.textContent = next.textContent.slice(1)
      if (!next.textContent) next.remove()
    }
    chip.replaceWith(document.createTextNode(chip.getAttribute("data-mention") ?? ""))
  })
  return mentions.length > 0
}

// The editor owns its children. Decorations are maintained here rather than by
// Solid's renderer, which must not compete with native contenteditable edits.
export function createRecommendationInput(element: HTMLElement, input: { enabled: () => boolean; exit: () => void }) {
  const chip = document.createElement("span")
  chip.className = "studio-composer-recommendation-chip"
  chip.dataset.studioRecommendationChip = ""
  chip.contentEditable = "false"
  const label = document.createElement("span")
  label.textContent = "AI推荐"
  const close = document.createElement("button")
  close.type = "button"
  close.className = "studio-composer-recommendation-close"
  close.setAttribute("aria-label", "退出AI推荐")
  close.title = "退出AI推荐"
  const icon = document.createElement("img")
  icon.src = "/studio/studio_template_close.svg"
  icon.alt = ""
  icon.draggable = false
  close.append(icon)
  close.addEventListener("mousedown", (event) => event.preventDefault())
  close.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") event.stopPropagation()
  })
  close.addEventListener("click", (event) => {
    event.stopPropagation()
    input.exit()
  })
  chip.append(label, close)
  const placeholder = document.createElement("span")
  placeholder.dataset.studioRecommendationPlaceholder = ""
  placeholder.className = "studio-composer-recommendation-placeholder"
  placeholder.contentEditable = "false"
  placeholder.textContent = "描述你想生成的图片"
  placeholder.addEventListener("mousedown", (event) => {
    event.preventDefault()
    element.focus()
    placeCaret()
  })
  function placeCaret() {
    const range = document.createRange()
    range.setStartAfter(chip)
    range.collapse(true)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)
  }
  function sync() {
    element.querySelectorAll(decoration).forEach((node) => {
      if (node !== chip && node !== placeholder) node.remove()
    })
    if (!input.enabled()) {
      chip.remove()
      placeholder.remove()
      return
    }
    stripComposerMentions(element)
    if (element.firstChild !== chip) element.prepend(chip)
    if (!composerText(element).trim()) {
      if (chip.nextSibling !== placeholder) chip.after(placeholder)
    } else placeholder.remove()
    const selection = window.getSelection()
    if (
      document.activeElement === element &&
      selection?.isCollapsed &&
      ((selection.anchorNode === element && selection.anchorOffset === 0) ||
        (selection.anchorNode && (chip.contains(selection.anchorNode) || placeholder.contains(selection.anchorNode))))
    )
      placeCaret()
  }
  const clipboard = (event: ClipboardEvent) => {
    const selection = window.getSelection()
    if (!input.enabled() || !selection?.rangeCount || selection.isCollapsed || !event.clipboardData) return
    event.preventDefault()
    event.clipboardData.setData("text/plain", composerText(selection.getRangeAt(0).cloneContents()))
    if (event.type !== "cut") return
    selection.getRangeAt(0).deleteContents()
    sync()
    element.dispatchEvent(new Event("input", { bubbles: true }))
  }
  const beforeInput = (event: InputEvent) => {
    if (!input.enabled()) return
    const selection = window.getSelection()
    if (!selection?.isCollapsed || !selection.rangeCount) return
    const range = selection.getRangeAt(0)
    if (range.startContainer === element && range.startOffset <= 1 && event.inputType === "deleteContentBackward") {
      event.preventDefault()
      placeCaret()
    }
  }
  element.addEventListener("copy", clipboard)
  element.addEventListener("cut", clipboard)
  element.addEventListener("beforeinput", beforeInput)
  const observer = new MutationObserver(sync)
  observer.observe(element, { childList: true, subtree: true })
  sync()
  return {
    sync,
    dispose: () => {
      observer.disconnect()
      element.removeEventListener("copy", clipboard)
      element.removeEventListener("cut", clipboard)
      element.removeEventListener("beforeinput", beforeInput)
    },
  }
}
