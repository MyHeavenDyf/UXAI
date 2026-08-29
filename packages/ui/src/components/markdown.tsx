import { useMarked } from "../context/marked"
import { useI18n } from "../context/i18n"
import DOMPurify from "dompurify"
import morphdom from "morphdom"
import { checksum } from "@opencode-ai/core/util/encode"
import { ComponentProps, createEffect, createResource, createSignal, onCleanup, splitProps } from "solid-js"
import { isServer } from "solid-js/web"
import { stream } from "./markdown-stream"

type Entry = {
  hash: string
  html: string
}

const max = 200
const cache = new Map<string, Entry>()

if (typeof window !== "undefined" && DOMPurify.isSupported) {
  DOMPurify.addHook("afterSanitizeAttributes", (node: Element) => {
    if (!(node instanceof HTMLAnchorElement)) return
    if (node.target !== "_blank") return

    const rel = node.getAttribute("rel") ?? ""
    const set = new Set(rel.split(/\s+/).filter(Boolean))
    set.add("noopener")
    set.add("noreferrer")
    node.setAttribute("rel", Array.from(set).join(" "))
  })
}

const config = {
  USE_PROFILES: { html: true, mathMl: true },
  SANITIZE_NAMED_PROPS: true,
  FORBID_TAGS: ["style"],
  FORBID_CONTENTS: ["style", "script"],
  ADD_TAGS: ["svg", "path"],
  ADD_ATTR: ["d", "viewBox", "preserveAspectRatio", "xmlns"],
}

const iconPaths = {
  copy: '<g><path d="M11.4451 5.41518C11.7601 5.41518 12.0251 5.52768 12.2401 5.75268C12.4551 5.97268 12.5626 6.24018 12.5626 6.55518L12.5626 14.0402C12.5626 14.3502 12.4551 14.6177 12.2401 14.8427C12.0251 15.0627 11.7601 15.1727 11.4451 15.1727L3.94507 15.1727C3.63007 15.1727 3.36507 15.0627 3.15007 14.8427C2.93507 14.6177 2.82757 14.3502 2.82757 14.0402L2.82757 6.55518C2.82757 6.24018 2.93507 5.97268 3.15007 5.75268C3.36507 5.52768 3.63007 5.41518 3.94507 5.41518L11.4451 5.41518ZM3.94507 4.30518C3.53507 4.30518 3.16007 4.40518 2.82007 4.60518C2.47507 4.81018 2.20007 5.08518 1.99507 5.43018C1.79507 5.77018 1.69507 6.14518 1.69507 6.55518L1.69507 14.0402C1.69507 14.4502 1.79507 14.8277 1.99507 15.1727C2.20007 15.5227 2.47507 15.7952 2.82007 15.9902C3.16007 16.1902 3.53507 16.2902 3.94507 16.2902L11.4451 16.2902C11.8551 16.2902 12.2301 16.1902 12.5701 15.9902C12.9151 15.7952 13.1901 15.5227 13.3951 15.1727C13.5951 14.8277 13.6951 14.4502 13.6951 14.0402L13.6951 6.55518C13.6951 6.14518 13.5951 5.77018 13.3951 5.43018C13.1901 5.08518 12.9151 4.81018 12.5701 4.60518C12.2301 4.40518 11.8551 4.30518 11.4451 4.30518L3.94507 4.30518ZM8.20507 9.81018L8.20507 7.36518C8.20507 7.13518 8.11257 6.97518 7.92757 6.88518C7.74257 6.79518 7.55507 6.79518 7.36507 6.88518C7.17007 6.97518 7.07257 7.13518 7.07257 7.36518L7.07257 9.81018L4.64257 9.81018C4.41757 9.81018 4.25507 9.90268 4.15507 10.0877C4.06007 10.2727 4.06007 10.4602 4.15507 10.6502C4.25507 10.8352 4.41757 10.9277 4.64257 10.9277L7.07257 10.9277L7.07257 13.3577C7.07257 13.5977 7.17007 13.7652 7.36507 13.8602C7.55507 13.9552 7.74257 13.9552 7.92757 13.8602C8.11257 13.7652 8.20507 13.5977 8.20507 13.3577L8.20507 10.9277L10.6351 10.9277C10.8751 10.9277 11.0451 10.8352 11.1451 10.6502C11.2401 10.4602 11.2401 10.2727 11.1451 10.0877C11.0451 9.90268 10.8751 9.81018 10.6351 9.81018L8.20507 9.81018Z" fill="rgb(0,0,0)" fill-opacity="0.600000024" fill-rule="nonzero" /><path d="M7.29008 1.69482C6.72508 1.69482 6.20508 1.83982 5.73008 2.12982C5.26008 2.42482 4.89758 2.81982 4.64258 3.31482L6.03008 3.31482C6.21008 3.15482 6.40508 3.03482 6.61508 2.95482C6.82508 2.86982 7.05008 2.82732 7.29008 2.82732L13.3051 2.82732C13.6401 2.82732 13.9501 2.90982 14.2351 3.07482C14.5251 3.24482 14.7551 3.47482 14.9251 3.76482C15.0901 4.04982 15.1726 4.35982 15.1726 4.69482L15.1726 10.6948C15.1726 10.9348 15.1276 11.1623 15.0376 11.3773C14.9476 11.5923 14.8251 11.7848 14.6701 11.9548L14.6701 13.3348C15.1601 13.0848 15.5526 12.7223 15.8476 12.2473C16.1426 11.7723 16.2901 11.2548 16.2901 10.6948L16.2901 4.69482C16.2901 4.15482 16.1551 3.65482 15.8851 3.19482C15.6151 2.73482 15.2526 2.36982 14.7976 2.09982C14.3426 1.82982 13.8451 1.69482 13.3051 1.69482L7.29008 1.69482Z" fill="rgb(0,0,0)" fill-opacity="0.600000024" fill-rule="nonzero" /></g>',
  check: '<path d="M5 11.9657L8.37838 14.7529L15 5.83398" stroke="rgb(0,0,0)" stroke-opacity="0.6" stroke-linecap="square" stroke-width="1.5"/>',
  preview: '<path d="M1 8s2-4 7-4 7 4 7 4-2 4-7 4-7-4-7-4zm7-2a2 2 0 100 4 2 2 0 000-4z" fill="rgb(0,0,0)" fill-opacity="0.6"/>',
  chevronDown: '<path d="M10.0001 13.0418C10.2556 13.0418 10.4751 12.9474 10.6584 12.7585L15.4418 8.04183C15.5584 7.91961 15.6168 7.77238 15.6168 7.60016C15.6168 7.42794 15.5584 7.27516 15.4418 7.14183C15.3195 7.01961 15.1723 6.9585 15.0001 6.9585C14.8279 6.9585 14.6751 7.01961 14.5418 7.14183L10.0001 11.6585L5.44176 7.14183C5.31953 7.01961 5.17231 6.9585 5.00009 6.9585C4.82787 6.9585 4.68064 7.01961 4.55842 7.14183C4.44176 7.27516 4.38342 7.42794 4.38342 7.60016C4.38342 7.77238 4.44176 7.91961 4.55842 8.04183L9.34176 12.7585C9.52509 12.9474 9.74453 13.0418 10.0001 13.0418Z" fill="rgb(0,0,0)" fill-opacity="0.6"/>',
}

function sanitize(html: string) {
  if (!DOMPurify.isSupported) return ""
  return DOMPurify.sanitize(html, config)
}

function escape(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function fallback(markdown: string) {
  return escape(markdown).replace(/\r\n?/g, "\n").replace(/\n/g, "<br>")
}

export function escapeInlineHtml(text: string): string {
  const parts: Array<{ code: boolean; text: string }> = []
  let i = 0
  const len = text.length

  while (i < len) {
    if (text.slice(i, i + 3) === "```") {
      let j = i + 3
      while (j < len && text.slice(j, j + 3) !== "```") j++
      if (j < len) {
        parts.push({ code: true, text: text.slice(i, j + 3) })
        i = j + 3
        continue
      }
    }

    if (text[i] === "`") {
      let j = i + 1
      while (j < len && text[j] !== "`") {
        if (text[j] === "\\") j++
        j++
      }
      if (j < len) {
        parts.push({ code: true, text: text.slice(i, j + 1) })
        i = j + 1
        continue
      }
    }

    let nextCode = text.indexOf("`", i)
    let nextFence = text.indexOf("```", i)
    if (nextCode === -1) nextCode = len
    if (nextFence === -1) nextFence = len
    const next = Math.min(nextCode, nextFence)
    if (next > i) {
      parts.push({ code: false, text: text.slice(i, next) })
      i = next
      continue
    }
    parts.push({ code: false, text: text.slice(i) })
    break
  }

  const htmlTagRe = /<[a-zA-Z][a-zA-Z0-9\-]*(?:\s+[a-zA-Z_:][a-zA-Z0-9_:\-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>|<\/[a-zA-Z][a-zA-Z0-9\-]*\s*>/g

  return parts
    .map((p) => {
      if (p.code) return p.text
      return p.text.replace(htmlTagRe, (match) => {
        return match.replace(/</g, "&lt;").replace(/>/g, "&gt;")
      })
    })
    .join("")
}

type CopyLabels = {
  copy: string
  copied: string
}

const urlPattern = /^https?:\/\/[^\s<>()`"']+$/

function codeUrl(text: string) {
  const href = text.trim().replace(/[),.;!?]+$/, "")
  if (!urlPattern.test(href)) return
  try {
    const url = new URL(href)
    return url.toString()
  } catch {
    return
  }
}

function isLocalFilePath(codeContent: string): boolean {
  const trimmed = codeContent.trim()
  if (trimmed.includes('\n')) return false
  const lower = trimmed.toLowerCase()
  return lower.endsWith('.html') || lower.endsWith('.htm')
}

function getCodeLanguage(block: HTMLPreElement): string {
  const code = block.querySelector("code")
  const className = code?.className || block.className
  const match = className.match(/language-([\w-]+)/)
  if (match) return match[1]
  const langAttr = block.getAttribute("data-language") || code?.getAttribute("data-language")
  if (langAttr) return langAttr
  return ""
}

function createLanguageLabel(lang: string) {
  const label = document.createElement("span")
  label.setAttribute("data-slot", "markdown-code-lang")
  label.textContent = lang.toUpperCase()
  return label
}

function createIcon(path: string, slot: string, viewBox = "0 0 20 20") {
  const icon = document.createElement("div")
  icon.setAttribute("data-component", "icon")
  icon.setAttribute("data-size", "small")
  icon.setAttribute("data-slot", slot)
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("data-slot", "icon-svg")
  svg.setAttribute("fill", "none")
  svg.setAttribute("viewBox", viewBox)
  svg.setAttribute("aria-hidden", "true")
  svg.innerHTML = path
  icon.appendChild(svg)
  return icon
}

function createCopyButton(labels: CopyLabels) {
  const button = document.createElement("button")
  button.type = "button"
  button.setAttribute("data-slot", "markdown-copy-button")
  button.setAttribute("aria-label", labels.copy)
  button.appendChild(createIcon(iconPaths.copy, "copy-icon", "0 0 18 18"))
  button.appendChild(createIcon(iconPaths.check, "check-icon"))
  const label = document.createElement("span")
  label.setAttribute("data-slot", "markdown-copy-label")
  label.textContent = labels.copy
  button.appendChild(label)
  return button
}

function createPreviewButton(label: string, onClick: () => void) {
  const button = document.createElement("button")
  button.type = "button"
  button.setAttribute("data-component", "icon-button")
  button.setAttribute("data-variant", "secondary")
  button.setAttribute("data-size", "small")
  button.setAttribute("data-slot", "markdown-preview-button")
  button.setAttribute("aria-label", label)
  button.setAttribute("data-tooltip", label)
  button.appendChild(createIcon(iconPaths.preview, "preview-icon"))
  button.addEventListener("click", onClick)
  return button
}

function setCopyState(button: HTMLButtonElement, labels: CopyLabels, copied: boolean) {
  const label = button.querySelector('[data-slot="markdown-copy-label"]')
  if (copied) {
    button.setAttribute("data-copied", "true")
    button.setAttribute("aria-label", labels.copied)
    if (label) label.textContent = labels.copied
    return
  }
  button.removeAttribute("data-copied")
  button.setAttribute("aria-label", labels.copy)
  if (label) label.textContent = labels.copy
}

function createExpandContainer() {
  const container = document.createElement("div")
  container.setAttribute("data-slot", "markdown-code-expand-container")
  const button = document.createElement("button")
  button.type = "button"
  button.setAttribute("data-slot", "markdown-code-expand")
  const label = document.createElement("span")
  label.setAttribute("data-slot", "markdown-code-expand-label")
  label.textContent = "展开"
  button.appendChild(label)
  button.appendChild(createIcon(iconPaths.chevronDown, "expand-icon"))
  container.appendChild(button)
  return container
}

function ensureCodeWrapper(
  block: HTMLPreElement,
  labels: CopyLabels,
  previewLabel: string,
  onOpenLocalFile?: (filePath: string) => void,
) {
  const parent = block.parentElement
  if (!parent) return
  const wrapped = parent.getAttribute("data-component") === "markdown-code"
  const codeContent = block.querySelector("code")?.textContent ?? ""

  if (!wrapped) {
    const wrapper = document.createElement("div")
    wrapper.setAttribute("data-component", "markdown-code")
    parent.replaceChild(wrapper, block)

    const header = document.createElement("div")
    header.setAttribute("data-slot", "markdown-code-header")
    const lang = getCodeLanguage(block)
    if (lang) header.appendChild(createLanguageLabel(lang))
    if (isLocalFilePath(codeContent) && onOpenLocalFile) {
      header.appendChild(createPreviewButton(previewLabel, () => onOpenLocalFile(codeContent.trim())))
    }
    header.appendChild(createCopyButton(labels))
    wrapper.appendChild(header)

    const scrollWrapper = document.createElement("div")
    scrollWrapper.setAttribute("data-slot", "markdown-code-scroll")
    scrollWrapper.appendChild(block)
    wrapper.appendChild(scrollWrapper)

    wrapper.appendChild(createExpandContainer())
    return
  }

  let header = Array.from(parent.children).find(
    (c): c is HTMLElement => c.getAttribute("data-slot") === "markdown-code-header",
  )
  if (!header) {
    header = document.createElement("div")
    header.setAttribute("data-slot", "markdown-code-header")
    parent.insertBefore(header, parent.firstChild)
  }

  const existingLang = header.querySelector('[data-slot="markdown-code-lang"]')
  const lang = getCodeLanguage(block)
  if (lang) {
    if (existingLang) {
      existingLang.textContent = lang.toUpperCase()
    } else {
      header.insertBefore(createLanguageLabel(lang), header.firstChild)
    }
  } else if (existingLang) {
    existingLang.remove()
  }

  const existingPreview = header.querySelector('[data-slot="markdown-preview-button"]')
  if (existingPreview) existingPreview.remove()
  if (isLocalFilePath(codeContent) && onOpenLocalFile) {
    const previewBtn = createPreviewButton(previewLabel, () => onOpenLocalFile(codeContent.trim()))
    header.insertBefore(previewBtn, header.firstChild)
  }

  const buttons = Array.from(header.querySelectorAll('[data-slot="markdown-copy-button"]')).filter(
    (el): el is HTMLButtonElement => el instanceof HTMLButtonElement,
  )
  if (buttons.length === 0) {
    header.appendChild(createCopyButton(labels))
  } else {
    for (const button of buttons.slice(1)) button.remove()
  }

  if (!parent.querySelector(':scope > [data-slot="markdown-code-expand-container"]')) {
    parent.appendChild(createExpandContainer())
  }
}

function markCodeLinks(root: HTMLDivElement) {
  const codeNodes = Array.from(root.querySelectorAll(":not(pre) > code"))
  for (const code of codeNodes) {
    const href = codeUrl(code.textContent ?? "")
    const parentLink =
      code.parentElement instanceof HTMLAnchorElement && code.parentElement.classList.contains("external-link")
        ? code.parentElement
        : null

    if (!href) {
      if (parentLink) parentLink.replaceWith(code)
      continue
    }

    if (parentLink) {
      parentLink.href = href
      continue
    }

    const link = document.createElement("a")
    link.href = href
    link.className = "external-link"
    link.target = "_blank"
    link.rel = "noopener noreferrer"
    code.parentNode?.replaceChild(link, code)
    link.appendChild(code)
  }
}

function decorate(
  root: HTMLDivElement,
  labels: CopyLabels,
  previewLabel: string,
  onOpenLocalFile?: (filePath: string) => void,
) {
  const blocks = Array.from(root.querySelectorAll("pre"))
  for (const block of blocks) {
    ensureCodeWrapper(block, labels, previewLabel, onOpenLocalFile)
  }
  markCodeLinks(root)
}

function setupCodeCopy(root: HTMLDivElement, getLabels: () => CopyLabels) {
  const timeouts = new Map<HTMLButtonElement, ReturnType<typeof setTimeout>>()

  const updateLabel = (button: HTMLButtonElement) => {
    const labels = getLabels()
    const copied = button.getAttribute("data-copied") === "true"
    setCopyState(button, labels, copied)
  }

  const handleClick = async (event: MouseEvent) => {
    const target = event.target
    if (!(target instanceof Element)) return

    const button = target.closest('[data-slot="markdown-copy-button"]')
    if (!(button instanceof HTMLButtonElement)) return
    const code = button.closest('[data-component="markdown-code"]')?.querySelector("code")
    const content = code?.textContent ?? ""
    if (!content) return
    const clipboard = navigator?.clipboard
    if (!clipboard) return
    await clipboard.writeText(content)
    const labels = getLabels()
    setCopyState(button, labels, true)
    const existing = timeouts.get(button)
    if (existing) clearTimeout(existing)
    const timeout = setTimeout(() => setCopyState(button, labels, false), 2000)
    timeouts.set(button, timeout)
  }

  const buttons = Array.from(root.querySelectorAll('[data-slot="markdown-copy-button"]'))
  for (const button of buttons) {
    if (button instanceof HTMLButtonElement) updateLabel(button)
  }

  root.addEventListener("click", handleClick)

  return () => {
    root.removeEventListener("click", handleClick)
    for (const timeout of timeouts.values()) {
      clearTimeout(timeout)
    }
  }
}

const CODE_MAX_HEIGHT = 320
const CODE_THRESHOLD = 4

function updateCodeExpandState(root: HTMLElement) {
  for (const block of root.querySelectorAll('[data-component="markdown-code"]')) {
    if (!(block instanceof HTMLElement)) continue
    const pre = block.querySelector("pre")
    if (!pre) continue
    const needsExpand = pre.scrollHeight > CODE_MAX_HEIGHT + CODE_THRESHOLD
    if (needsExpand) {
      block.setAttribute("data-expandable", "true")
    } else {
      block.removeAttribute("data-expandable")
    }
  }
}

function setupCodeExpandHandlers(root: HTMLDivElement) {
  const observer = new ResizeObserver(() => updateCodeExpandState(root))
  observer.observe(root)

  const handleClick = (event: MouseEvent) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const btn = target.closest('[data-slot="markdown-code-expand"]')
    if (!btn) return
    const wrapper = btn.closest('[data-component="markdown-code"]')
    if (!(wrapper instanceof HTMLElement)) return
    const isExpanded = wrapper.getAttribute("data-expanded") === "true"
    if (isExpanded) {
      wrapper.removeAttribute("data-expanded")
      const label = wrapper.querySelector('[data-slot="markdown-code-expand-label"]')
      if (label) label.textContent = "展开"
    } else {
      wrapper.setAttribute("data-expanded", "true")
      const label = wrapper.querySelector('[data-slot="markdown-code-expand-label"]')
      if (label) label.textContent = "收起"
    }
  }
  root.addEventListener("click", handleClick)

  return () => {
    root.removeEventListener("click", handleClick)
    observer.disconnect()
  }
}

function touch(key: string, value: Entry) {
  cache.delete(key)
  cache.set(key, value)

  if (cache.size <= max) return

  const first = cache.keys().next().value
  if (!first) return
  cache.delete(first)
}

export function Markdown(
  props: ComponentProps<"div"> & {
    text: string
    cacheKey?: string
    streaming?: boolean
    class?: string
    classList?: Record<string, boolean>
    onOpenLocalFile?: (filePath: string) => void
    projectDir?: string
  },
) {
  const [local, others] = splitProps(props, ["text", "cacheKey", "streaming", "class", "classList", "onOpenLocalFile", "projectDir"])
  const marked = useMarked()
  const i18n = useI18n()
  const [root, setRoot] = createSignal<HTMLDivElement>()
  const [html] = createResource(
    () => ({
      text: local.text,
      key: local.cacheKey,
      streaming: local.streaming ?? false,
    }),
    async (src) => {
      if (isServer) return fallback(src.text)
      if (!src.text) return ""

      const base = src.key ?? checksum(src.text)
      return Promise.all(
        stream(src.text, src.streaming).map(async (block, index) => {
          const hash = checksum(block.raw)
          const key = base ? `${base}:${index}:${block.mode}` : hash

          if (key && hash) {
            const cached = cache.get(key)
            if (cached && cached.hash === hash) {
              touch(key, cached)
              return cached.html
            }
          }

          const escaped = escapeInlineHtml(block.src)
          const next = await Promise.resolve(marked.parse(escaped))
          const safe = sanitize(next)
          if (key && hash) touch(key, { hash, html: safe })
          return safe
        }),
      )
        .then((list) => list.join(""))
        .catch(() => fallback(src.text))
    },
    { initialValue: fallback(local.text) },
  )

  let copyCleanup: (() => void) | undefined
  let expandCleanup: (() => void) | undefined

  createEffect(() => {
    const container = root()
    const content = local.text ? (html.latest ?? html() ?? "") : ""
    if (!container) return
    if (isServer) return

    if (!content) {
      container.innerHTML = ""
      return
    }

    const labels = {
      copy: i18n.t("ui.message.copy"),
      copied: i18n.t("ui.message.copied"),
    }
    const previewLabel = i18n.t("ui.message.previewFile")
    const temp = document.createElement("div")
    temp.innerHTML = content
    decorate(temp, labels, previewLabel, local.onOpenLocalFile)

    morphdom(container, temp, {
      childrenOnly: true,
      onBeforeElUpdated: (fromEl, toEl) => {
        if (
          fromEl instanceof HTMLButtonElement &&
          toEl instanceof HTMLButtonElement &&
          fromEl.getAttribute("data-slot") === "markdown-copy-button" &&
          toEl.getAttribute("data-slot") === "markdown-copy-button" &&
          fromEl.getAttribute("data-copied") === "true"
        ) {
          setCopyState(toEl, labels, true)
        }
        if (
          fromEl.getAttribute("data-component") === "markdown-code" &&
          toEl.getAttribute("data-component") === "markdown-code" &&
          fromEl.getAttribute("data-expanded") === "true"
        ) {
          toEl.setAttribute("data-expanded", "true")
          const label = toEl.querySelector('[data-slot="markdown-code-expand-label"]')
          if (label) label.textContent = "收起"
        }
        if (fromEl.isEqualNode(toEl)) return false
        return true
      },
    })

    updateCodeExpandState(container)

    if (!copyCleanup)
      copyCleanup = setupCodeCopy(container, () => ({
        copy: i18n.t("ui.message.copy"),
        copied: i18n.t("ui.message.copied"),
      }))
    if (!expandCleanup)
      expandCleanup = setupCodeExpandHandlers(container)
  })

  onCleanup(() => {
    if (copyCleanup) copyCleanup()
    if (expandCleanup) expandCleanup()
  })

  return (
    <div
      data-component="markdown"
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
      ref={setRoot}
      {...others}
    />
  )
}
