// 文件预览面板:对齐 Design(make/components/design-files/preview-pane.tsx)。
// 双击/单击文件 → 右侧 30% 宽面板预览(图片/视频/音频/html/markdown/code)。
// 内容读取走 fetchInsightContent(复用 artifact/content,按绝对 path);html 在 electron 走 local://,
// 非桌面端退回 data URL(无 insight serve 端点,不像 make 有 artifact/serve)。颜色走 --octo-* 变量。

import { createResource, Show, Switch, Match } from "solid-js"
import type { JSX } from "solid-js"
import type { InsightFile } from "../../utils/insight-file-api"
import { fetchInsightContent, pathToLocalUrl, isElectronDesktop, formatFileSize, formatTimeAgo } from "../../utils/insight-file-api"
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

  const isImage = () => ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"].includes(props.file.mime)
  const isVideo = () => props.file.mime.startsWith("video/")
  const isAudio = () => props.file.mime.startsWith("audio/")
  const isHtml = () => props.file.mime === "text/html" || props.file.kind === "html"
  const isMarkdown = () => props.file.mime === "text/markdown" || props.file.kind === "markdown"
  const isCode = () => props.file.kind === "code" || props.file.kind === "json" || props.file.mime === "text/plain" || props.file.mime === "text/csv"

  const base64Content = () => {
    const c = content()
    if (!c) return ""
    if (c.encoding === "base64") return c.content
    const bytes = new TextEncoder().encode(c.content)
    return btoa(String.fromCharCode(...bytes))
  }

  return (
    <div
      class="shrink-0 w-[30%] flex flex-col overflow-hidden border-l"
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
          class="p-1 rounded hover:bg-[var(--octo-surface-hover)] transition-colors"
          title="关闭预览"
          style={{ color: "var(--octo-text-secondary)" }}
        >
          <Icon name="close" size="small" />
        </button>
      </div>

      {/* 文件预览(可点击,带蒙层阻止交互) */}
      <div
        class="overflow-hidden cursor-pointer flex items-center justify-center shrink-0 relative"
        style={{ background: "var(--octo-surface-result)", height: "40%" }}
      >
        <Show when={content.loading}>
          <div class="text-[12px]" style={{ color: "var(--octo-text-secondary)" }}>加载中…</div>
        </Show>

        <Show when={content.error}>
          <div class="text-[12px]" style={{ color: "var(--octo-danger, #dc2626)" }}>加载失败</div>
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
              <video src={`data:${props.file.mime};base64,${base64Content()}`} controls class="max-w-full max-h-full" />
            </Match>

            <Match when={isAudio()}>
              <audio src={`data:${props.file.mime};base64,${base64Content()}`} controls class="w-full" />
            </Match>

            <Match when={isHtml()}>
              <Show
                when={isElectronDesktop()}
                fallback={
                  <iframe
                    src={`data:text/html;base64,${base64Content()}`}
                    sandbox="allow-scripts"
                    class="w-full h-full border-0"
                  />
                }
              >
                <iframe src={pathToLocalUrl(props.file.path)} sandbox="allow-scripts" class="w-full h-full border-0" />
              </Show>
            </Match>

            <Match when={isMarkdown()}>
              <pre class="text-[13px] whitespace-pre-wrap p-3 overflow-auto max-h-full" style={{ color: "var(--octo-text-primary)" }}>
                {content()?.content ?? ""}
              </pre>
            </Match>

            <Match when={isCode()}>
              <pre
                class="text-[11px] font-mono whitespace-pre-wrap p-3 rounded overflow-auto max-h-full"
                style={{ background: "var(--octo-surface-hover)", color: "var(--octo-text-primary)" }}
              >
                {content()?.content ?? ""}
              </pre>
            </Match>
          </Switch>
        </Show>

        {/* 蒙层:阻止用户与预览内容交互(点击则打开成 tab) */}
        <div class="absolute inset-0 z-10" style={{ background: "transparent", cursor: "pointer" }} onClick={props.onOpen} />
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
