import { createResource, Show, Switch, Match, createSignal, createEffect, onCleanup } from "solid-js"
import type { JSX } from "solid-js"
import type { ArtifactFile } from "../../utils/artifact-file-api"
import { fetchArtifactContent, getArtifactServeUrl, pathToLocalUrl, isElectronDesktop, formatFileSize, formatTimeAgo } from "../../utils/artifact-file-api"
import { Icon } from "@opencode-ai/ui/icon"
import { Button } from "@opencode-ai/ui/button"

interface Props {
  file: ArtifactFile
  sdkUrl: string
  sdkDirectory: string
  onClose: () => void
  onOpen: () => void
  onDownload: () => void
}

export function PreviewPane(props: Props): JSX.Element {
  const [content] = createResource(
    () => props.file.path,
    async (path) => {
      try {
        const result = await fetchArtifactContent(props.sdkUrl, props.sdkDirectory, path)
        return result
      } catch {
        return { content: "", mimeType: "" }
      }
    },
  )

  const [previewHeight, setPreviewHeight] = createSignal(0)
  let containerRef: HTMLDivElement | undefined

  const updatePreviewHeight = () => {
    if (containerRef) {
      const width = containerRef.offsetWidth
      setPreviewHeight(Math.floor(width * 0.6))
    }
  }

  createEffect(() => {
    updatePreviewHeight()
    const resizeObserver = new ResizeObserver(updatePreviewHeight)
    if (containerRef) resizeObserver.observe(containerRef)
    onCleanup(() => resizeObserver.disconnect())
  })

  const isImage = () => ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"].includes(props.file.mime)
  const isVideo = () => props.file.mime.startsWith("video/")
  const isAudio = () => props.file.mime.startsWith("audio/")
  const isHtml = () => props.file.mime === "text/html" || props.file.kind === "html"
  const isMarkdown = () => props.file.mime === "text/markdown" || props.file.kind === "markdown"
  const isCode = () => props.file.kind === "code" || props.file.mime.startsWith("application/") || props.file.mime === "text/plain"

  const base64Content = () => {
    const c = content()
    if (!c) return ""
    if (c.encoding === "base64") return c.content
    const bytes = new TextEncoder().encode(c.content)
    return btoa(String.fromCharCode(...bytes))
  }

  return (
    <div
      ref={containerRef}
      class="shrink-0 w-[30%] flex flex-col overflow-hidden border-l"
      style={{ "border-color": "var(--octo-border-divider)", background: "var(--octo-surface-page)" }}
    >
      {/* 头部：关闭按钮 */}
      <div
        class="flex items-center justify-end px-3 py-2 shrink-0 border-b"
        style={{ "border-color": "var(--octo-border-divider)" }}
      >
        <button
          type="button"
          onClick={props.onClose}
          class="p-1 rounded hover:bg-surface-base-hover transition-colors"
          title="Close preview"
        >
          <Icon name="close" size="small" />
        </button>
      </div>

      {/* 文件预览（可点击，带蒙层阻止交互） */}
      <div
        class="overflow-hidden cursor-pointer flex items-center justify-center shrink-0 relative"
        style={{
          background: "var(--octo-surface-result)",
          height: previewHeight() ? `${previewHeight()}px` : "auto",
        }}
      >
        {/* 预览内容 */}
        <Show when={content.loading}>
          <div class="text-[12px]" style={{ color: "var(--octo-text-secondary)" }}>
            Loading...
          </div>
        </Show>

        <Show when={content.error}>
          <div class="text-[12px]" style={{ color: "var(--octo-text-error)" }}>
            Failed to load content
          </div>
        </Show>

        <Show when={!content.loading && !content.error}>
          <Switch>
            <Match when={isImage()}>
              <img
                src={`data:${props.file.mime};base64,${base64Content()}`}
                alt={props.file.name}
                class="max-w-full max-h-full object-contain"
              />
            </Match>

            <Match when={isVideo()}>
              <video
                src={`data:${props.file.mime};base64,${base64Content()}`}
                controls
                class="max-w-full max-h-full"
              />
            </Match>

            <Match when={isAudio()}>
              <audio
                src={`data:${props.file.mime};base64,${base64Content()}`}
                controls
                class="w-full"
              />
            </Match>

            <Match when={isHtml()}>
              <Show
                when={isElectronDesktop()}
                fallback={
                  <iframe
                    src={getArtifactServeUrl(props.sdkUrl, props.sdkDirectory, props.file.sessionId, props.file.relativePath)}
                    sandbox="allow-scripts"
                    class="w-full h-full border-0"
                  />
                }
              >
                <iframe
                  src={pathToLocalUrl(props.file.path)}
                  sandbox="allow-scripts"
                  class="w-full h-full border-0"
                />
              </Show>
            </Match>

            <Match when={isMarkdown()}>
              <div class="prose prose-sm max-w-none text-[13px] p-3">
                {content()?.content ?? ""}
              </div>
            </Match>

            <Match when={isCode()}>
              <pre
                class="text-[11px] font-mono whitespace-pre-wrap p-3 rounded overflow-auto max-h-full"
                style={{
                  background: "var(--octo-surface-base)",
                  color: "var(--octo-text-primary)",
                }}
              >
                {content()?.content ?? ""}
              </pre>
            </Match>
          </Switch>
        </Show>

        {/* 蒙层：阻止用户与预览内容交互 */}
        <div
          class="absolute inset-0 z-10"
          style={{ background: "transparent", cursor: "pointer" }}
          onClick={props.onOpen}
        />
      </div>

      {/* 按钮区域 */}
      <div class="flex gap-2 px-3 py-2 shrink-0">
        <Button size="small" onClick={props.onOpen}>打开</Button>
        <Button size="small" onClick={props.onDownload}>下载</Button>
      </div>

      {/* 文件名 */}
      <div class="px-3 py-1 shrink-0 text-[12px] font-medium truncate" style={{ color: "var(--octo-text-primary)" }}>
        {props.file.name}
      </div>

      {/* 信息行 */}
      <div class="px-3 py-1 shrink-0 text-[11px]" style={{ color: "var(--octo-text-secondary)" }}>
        {formatTimeAgo(props.file.mtime)} · {formatFileSize(props.file.size)}
      </div>
    </div>
  )
}