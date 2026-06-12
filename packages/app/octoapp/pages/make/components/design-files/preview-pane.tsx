import { createResource, Show, Switch, Match, createEffect, onCleanup } from "solid-js"
import type { JSX } from "solid-js"
import type { ArtifactFile } from "../../utils/artifact-file-api"
import { fetchArtifactContent } from "../../utils/artifact-file-api"
import { Icon } from "@opencode-ai/ui/icon"

interface Props {
  file: ArtifactFile
  sdkUrl: string
  sdkDirectory: string
  onClose: () => void
}

export function PreviewPane(props: Props): JSX.Element {
  const [content] = createResource(
    () => ({ file: props.file, url: props.sdkUrl, directory: props.sdkDirectory }),
    async ({ file, url, directory }) => {
      try {
        const result = await fetchArtifactContent(url, directory, file.path)
        return result
      } catch {
        return { content: "", mimeType: "" }
      }
    },
  )

  const isImage = () => ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"].includes(props.file.mime)
  const isVideo = () => props.file.mime.startsWith("video/")
  const isAudio = () => props.file.mime.startsWith("audio/")
  const isHtml = () => props.file.mime === "text/html" || props.file.kind === "html"
  const isMarkdown = () => props.file.mime === "text/markdown" || props.file.kind === "markdown"
  const isCode = () => props.file.kind === "code" || props.file.mime.startsWith("application/") || props.file.mime === "text/plain"

  const base64Content = () => content()?.encoding === "base64" ? content()?.content ?? "" : btoa(content()?.content ?? "")

  return (
    <div
      class="shrink-0 w-[300px] flex flex-col overflow-hidden border-l"
      style={{ "border-color": "var(--octo-border-divider)", background: "var(--octo-surface-page)" }}
    >
      <div
        class="flex items-center justify-between px-3 py-2 shrink-0 border-b"
        style={{ "border-color": "var(--octo-border-divider)" }}
      >
        <span class="text-[12px] font-medium truncate" style={{ color: "var(--octo-text-primary)" }}>
          {props.file.name}
        </span>
        <button
          type="button"
          onClick={props.onClose}
          class="p-1 rounded hover:bg-surface-base-hover transition-colors"
          title="Close preview"
        >
          <Icon name="close" size="small" />
        </button>
      </div>

      <div class="flex-1 min-h-0 overflow-auto p-3">
        <Show when={content.loading}>
          <div class="flex items-center justify-center h-full">
            <div class="text-[12px]" style={{ color: "var(--octo-text-secondary)" }}>
              Loading...
            </div>
          </div>
        </Show>

        <Show when={content.error}>
          <div class="flex items-center justify-center h-full">
            <div class="text-[12px]" style={{ color: "var(--octo-text-error)" }}>
              Failed to load content
            </div>
          </div>
        </Show>

        <Show when={!content.loading && !content.error}>
          <Switch>
            <Match when={isImage()}>
              <Show when={props.file.mime === "image/svg+xml"}>
                <div class="w-full h-full overflow-auto">
                  <pre class="text-[11px] font-mono whitespace-pre-wrap" style={{ color: "var(--octo-text-primary)" }}>
                    {content()?.content ?? ""}
                  </pre>
                </div>
              </Show>
              <Show when={props.file.mime !== "image/svg+xml"}>
                <div class="flex items-center justify-center h-full">
                  <img
                    src={`data:${props.file.mime};base64,${base64Content()}`}
                    alt={props.file.name}
                    class="max-w-full max-h-full object-contain"
                  />
                </div>
              </Show>
            </Match>

            <Match when={isVideo()}>
              <div class="flex items-center justify-center h-full">
                <video
                  src={`data:${props.file.mime};base64,${base64Content()}`}
                  controls
                  class="max-w-full max-h-full"
                />
              </div>
            </Match>

            <Match when={isAudio()}>
              <div class="flex items-center justify-center h-full">
                <audio
                  src={`data:${props.file.mime};base64,${base64Content()}`}
                  controls
                  class="w-full"
                />
              </div>
            </Match>

            <Match when={isHtml()}>
              <iframe
                srcdoc={content()?.content ?? ""}
                sandbox="allow-scripts"
                class="w-full h-full border-0"
              />
            </Match>

            <Match when={isMarkdown()}>
              <div class="prose prose-sm max-w-none text-[13px]">
                {content()?.content ?? ""}
              </div>
            </Match>

            <Match when={isCode()}>
              <pre
                class="text-[11px] font-mono whitespace-pre-wrap p-3 rounded"
                style={{
                  background: "var(--octo-surface-result)",
                  color: "var(--octo-text-primary)",
                }}
              >
                {content()?.content ?? ""}
              </pre>
            </Match>
          </Switch>
        </Show>
      </div>
    </div>
  )
}