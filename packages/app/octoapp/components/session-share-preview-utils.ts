import { Marked, Renderer } from "marked"
import type { SessionSharePreviewResponses } from "@opencode-ai/sdk/v2/client"
import { createArtifactParser } from "@/pages/make/utils/artifact-parser"

export type SharePreviewMessage = SessionSharePreviewResponses[200]["messages"][number]

export const SHARE_PREVIEW_LIMIT = 100

function previewLinkName(value: string) {
  const content = value.trim()
  if (!content) return ""
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(content)) {
    try {
      const url = new URL(content)
      const name = url.pathname.split("/").filter(Boolean).at(-1)
      return name ? decodeURIComponent(name) : url.host
    } catch {
      return content.split(/[\\/]/).filter(Boolean).at(-1) ?? content
    }
  }
  return content.split(/[\\/]/).filter(Boolean).at(-1) ?? content
}

/** Reuse only the pure parser, never artifact auto-save or interactive previews. */
export function previewMessageContent(message: SharePreviewMessage) {
  if (message.role === "user") return { text: message.text, reasoning: "", files: message.files }
  const artifacts = createArtifactParser()
  const text: string[] = []
  const files = [...message.files]
  let artifact: { identifier: string; artifactType: string; title: string } | undefined
  const types: Record<string, { extension: string; mime: string }> = {
    html: { extension: ".html", mime: "text/html" },
    "text/html": { extension: ".html", mime: "text/html" },
    svg: { extension: ".svg", mime: "image/svg+xml" },
    markdown: { extension: ".md", mime: "text/markdown" },
    json: { extension: ".json", mime: "application/json" },
  }
  for (const event of [...artifacts.feed(message.text), ...artifacts.flush()]) {
    if (event.type === "text") text.push(event.delta)
    if (event.type === "artifact:start") artifact = event
    if (event.type !== "artifact:end" || !artifact) continue
    const type = types[artifact.artifactType.toLowerCase()]
    const linkTitle = artifact.artifactType.toLowerCase() === "text/link"
      ? previewLinkName(event.fullContent)
      : undefined
    const documentTitle = type?.mime === "text/html"
      ? event.fullContent.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim()
      : undefined
    const fallback = `未命名${type?.extension ?? ""}`
    const name = (linkTitle || artifact.title || artifact.identifier || documentTitle || fallback)
      .split(/[\\/]/)
      .at(-1)
      ?.slice(0, 240) || fallback
    files.push({
      name: type && !name.toLowerCase().endsWith(type.extension) ? name + type.extension : name,
      mime: type?.mime ?? "application/octet-stream",
    })
    artifact = undefined
  }
  return {
    text: text.join("").trim(),
    reasoning: message.reasoning?.trim() ?? "",
    files: [...new Map(files.map((file) => [file.name, file])).values()].slice(0, 16),
  }
}

export function previewLayout(
  messages: SharePreviewMessage[],
  heights: Record<string, number>,
  top: number,
  viewport: number,
) {
  const offsets: Record<string, number> = {}
  const height = messages.reduce((offset, message) => {
    offsets[message.id] = offset
    return offset + (heights[message.id] ?? 144)
  }, 0)
  return {
    height,
    offsets,
    visible: messages.filter(
      (message) =>
        offsets[message.id] + (heights[message.id] ?? 144) >= top - 200 && offsets[message.id] <= top + viewport + 200,
    ),
  }
}

const renderer = new Renderer()
renderer.html = () => ""
renderer.image = (token) => token.text.replace(/[&<>"']/g, (value) => `&#${value.charCodeAt(0)};`)
renderer.link = function (token) {
  return this.parser.parseInline(token.tokens)
}

// Do not use the global marked singleton: App registers asynchronous highlighting extensions on it.
const parser = new Marked({ renderer, async: false })

/** Read-only Markdown: no HTML, external images, navigable links or highlighting. */
export function previewMarkdown(text: string) {
  return parser.parse(text, { async: false })
}
