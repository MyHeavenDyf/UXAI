import { pathToLocalUrl } from "./insight-file-api"

// Blob 文档没有文件目录；只转换外链样式，避免改变页内锚点和编辑保存的源文档。
export function resolvePreviewStyles(html: string, filePath?: string): string {
  if (!filePath) return html
  const document = new DOMParser().parseFromString(html, "text/html")
  const fallback = pathToLocalUrl(filePath).replace(/#/g, "%23").replace(/\?/g, "%3F")
  const declared = document.querySelector("base[href]")?.getAttribute("href")
  const base = declared !== undefined && declared !== null && URL.canParse(declared, fallback)
    ? new URL(declared, fallback).href : fallback
  document.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"][href]').forEach((link) => {
    const href = link.getAttribute("href")!
    if (!href || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(href)) return
    link.setAttribute("href", new URL(href, base).href)
  })
  return `${document.doctype ? "<!DOCTYPE html>" : ""}\n${document.documentElement.outerHTML}`
}
