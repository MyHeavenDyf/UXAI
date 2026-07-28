// SPEC-INS-014 §10.1 右侧预览面板——参考 make/components/design-files/preview-pane.tsx 同款结构,
// 数据源从 ArtifactFile 切到 InsightFile,内容接口走 fetchInsightContent(复用 artifact/content 端点,
// 按绝对 path 读取)。HTML 在非 electron 下用 data URL iframe(Insight 无 artifact/serve 这种按 sessionId
// +relativePath 的服务端直链),electron 下沿用 pathToLocalUrl 由主进程拦截 local:// 协议直接读盘。
// 颜色 / 圆角 / 间距统一 --octo-* 主题变量,与 file-manager 其余面板一致。

import { createResource, Show, Switch, Match, createSignal, createEffect, onCleanup } from "solid-js"
import type { JSX } from "solid-js"
import type { InsightFile } from "../../utils/insight-file-api"
import {
  fetchInsightContent,
  pathToLocalUrl,
  isElectronDesktop,
  formatFileSize,
  formatTimeAgo,
} from "../../utils/insight-file-api"
import { Icon } from "@opencode-ai/ui/icon"
import { Button } from "@opencode-ai/ui/button"

interface Props {
  file: InsightFile
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
        return await fetchInsightContent(props.sdkUrl, props.sdkDirectory, path)
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
  const isCode = () => props.file.kind === "code" || props.file.kind === "json" || props.file.kind === "text" || props.file.mime === "text/plain"

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
      class="shrink-0 flex flex-col overflow-hidden border-l"
      style={{ "border-color": "var(--octo-border-divider)", background: "var(--octo-surface-page)" }}
    >
      {/* 头部:关闭按钮 */}
      <div
        class="flex items-center justify-end px-3 py-2 shrink-0 border-b"
        style={{ "border-color": "var(--octo-border-divider)" }}
      >
        <button
          type="button"
          onClick={props.onClose}
          class="p-1 rounded hover:bg-surface-base-hover transition-colors"
          title="关闭预览"
        >
          <Icon name="close" size="small" />
        </button>
      </div>

      {/* 文件预览(可点击打开,蒙层阻止与预览内容交互) */}
      <div
        class="overflow-hidden cursor-pointer flex items-center justify-center shrink-0 relative"
        style={{
          background: "var(--octo-surface-result)",
          height: previewHeight() ? `${previewHeight()}px` : "auto",
        }}
      >
        <Show when={content.loading}>
          <div class="text-[12px]" style={{ color: "var(--octo-text-secondary)" }}>
            加载中...
          </div>
        </Show>

        <Show when={content.error}>
          <div class="text-[12px]" style={{ color: "var(--octo-text-error)" }}>
            加载内容失败
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
                    src={`data:${props.file.mime};base64,${base64Content()}`}
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

        {/* 蒙层:阻止用户与预览内容交互,单击整面板触发打开 */}
        <div
          class="absolute inset-0 z-10"
          style={{ background: "transparent", cursor: "pointer" }}
          onClick={props.onOpen}
        />
      </div>

      {/* 按钮区 */}
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
