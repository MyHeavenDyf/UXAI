import { createResource, Show, Switch, Match, createSignal, createEffect, createMemo, onCleanup } from "solid-js"
import type { JSX } from "solid-js"
import type { ArtifactFile } from "../../utils/artifact-file-api"
import { fetchArtifactContent, getArtifactServeUrl, pathToLocalUrl, isElectronDesktop, formatFileSize, formatTimeAgo } from "../../utils/artifact-file-api"
import { Icon } from "@opencode-ai/ui/icon"
import { Button } from "@opencode-ai/ui/button"
import { highlightCode, getLanguageFromFilename } from "../../utils/code-highlight"

interface Props {
  file: ArtifactFile
  sdkUrl: string
  sdkDirectory: string
  width: number
  onClose: () => void
  onOpen: () => void
  onDownload: () => void
}

const MAX_CODE_PREVIEW_BYTES = 512 * 1024

export function PreviewPane(props: Props): JSX.Element {
  const isCodeKind = () => props.file.kind === "code" || props.file.mime.startsWith("application/") || props.file.mime === "text/plain"
  const isOversizedCode = () => isCodeKind() && props.file.size > MAX_CODE_PREVIEW_BYTES

  const [content] = createResource(
    () => props.file.path,
    async (path) => {
      if (isOversizedCode()) return { content: "", mimeType: "" }
      try {
        const result = await fetchArtifactContent(props.sdkUrl, props.sdkDirectory, path)
        return result
      } catch {
        return { content: "", mimeType: "" }
      }
    },
  )

  const [containerWidth, setContainerWidth] = createSignal(0)
  let containerRef: HTMLDivElement | undefined

  const updateContainerWidth = () => {
    if (containerRef) setContainerWidth(containerRef.offsetWidth)
  }

  createEffect(() => {
    updateContainerWidth()
    const resizeObserver = new ResizeObserver(updateContainerWidth)
    if (containerRef) resizeObserver.observe(containerRef)
    onCleanup(() => resizeObserver.disconnect())
  })

  const isImage = () => ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"].includes(props.file.mime)
  const isVideo = () => props.file.mime.startsWith("video/")
  const isAudio = () => props.file.mime.startsWith("audio/")
  const isHtml = () => props.file.mime === "text/html" || props.file.kind === "html"
  const isMarkdown = () => props.file.mime === "text/markdown" || props.file.kind === "markdown"
  const isCode = isCodeKind

  const previewHeight = createMemo(() => {
    const w = containerWidth()
    if (w <= 0) return 0
    if (isHtml()) return Math.floor((w * 1080) / 1920)
    return Math.floor(w * 0.6)
  })

  const htmlScale = createMemo(() => {
    const w = containerWidth()
    return w > 0 ? w / 1920 : 1
  })

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
      class="shrink-0 flex flex-col overflow-hidden"
      style={{ width: `${props.width}px`, background: "var(--octo-surface-page)" }}
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
                    style={{
                      position: "absolute",
                      top: "0",
                      left: "0",
                      width: "1920px",
                      height: "1080px",
                      border: "0",
                      transform: `scale(${htmlScale()})`,
                      "transform-origin": "top left",
                    }}
                  />
                }
              >
                <iframe
                  src={pathToLocalUrl(props.file.path)}
                  sandbox="allow-scripts"
                  style={{
                    position: "absolute",
                    top: "0",
                    left: "0",
                    width: "1920px",
                    height: "1080px",
                    border: "0",
                    transform: `scale(${htmlScale()})`,
                    "transform-origin": "top left",
                  }}
                />
              </Show>
            </Match>

            <Match when={isMarkdown()}>
              <div class="prose prose-sm max-w-none text-[13px] p-3">
                {content()?.content ?? ""}
              </div>
            </Match>

            <Match when={isCode()}>
              <Show
                when={!isOversizedCode()}
                fallback={
                  <div class="flex flex-col items-center justify-center gap-2 p-6 text-center">
                    <span class="text-[12px]" style={{ color: "var(--octo-text-secondary)" }}>
                      文件过大（{formatFileSize(props.file.size)}），无法预览
                    </span>
                    <span class="text-[12px]" style={{ color: "var(--octo-text-tertiary)" }}>
                      请点击下方"下载"查看完整内容
                    </span>
                  </div>
                }
              >
                <pre
                  class="text-[11px] font-mono whitespace-pre-wrap p-3 rounded overflow-auto max-h-full m-0"
                  style={{
                    background: "var(--octo-surface-base)",
                    color: "var(--octo-text-primary)",
                  }}
                >
                  <code innerHTML={highlightCode(content()?.content ?? "", getLanguageFromFilename(props.file.name))} />
                </pre>
              </Show>
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