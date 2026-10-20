import { Marked, Renderer } from "marked"
import type { SessionSharePreviewResponses } from "@opencode-ai/sdk/v2/client"
import { createArtifactParser } from "@/pages/make/utils/artifact-parser"

export type SharePreviewMessage = SessionSharePreviewResponses[200]["messages"][number]

export const SHARE_PREVIEW_LIMIT = 100

/** Reuse only the pure parser, never artifact auto-save or interactive previews. */
export function previewMessageContent(message: SharePreviewMessage) {
  if (message.role === "user") return { text: message.text, files: message.files }
  const artifacts = createArtifactParser()
  const text: string[] = []
  const files = [...message.files]
  const types: Record<string, { extension: string; mime: string }> = {
    html: { extension: ".html", mime: "text/html" },
    "text/html": { extension: ".html", mime: "text/html" },
    svg: { extension: ".svg", mime: "image/svg+xml" },
    markdown: { extension: ".md", mime: "text/markdown" },
    json: { extension: ".json", mime: "application/json" },
  }
  for (const event of [...artifacts.feed(message.text), ...artifacts.flush()]) {
    if (event.type === "text") text.push(event.delta)
    if (event.type !== "artifact:start") continue
    const type = types[event.artifactType.toLowerCase()]
    const name = (event.title || event.identifier || "产物").split(/[\\/]/).at(-1)?.slice(0, 240) || "产物"
    files.push({
      name: type && !name.toLowerCase().endsWith(type.extension) ? name + type.extension : name,
      mime: type?.mime ?? "application/octet-stream",
    })
  }
  return {
    text: text.join("").trim(),
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
