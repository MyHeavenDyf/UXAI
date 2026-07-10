// 文件预览面板:右侧 30% 宽面板预览(图片/视频/音频/html/markdown/code)。
// 内容读取走 fetchInsightContent(复用 artifact/content,按绝对 path);html/markdown/code 直接复用
// insight 自己的 renderer(HtmlRenderer srcdoc / MarkdownPreview Vditor / SourceCodeView shiki),
// 不再走 design 拷来的裸 iframe + <pre>,与标签页打开时的渲染保持一致。颜色走 --octo-* 变量。

import { createResource, Show, Switch, Match } from "solid-js"
import type { JSX } from "solid-js"
import type { InsightFile } from "../../utils/insight-file-api"
import { fetchInsightContent, formatFileSize, formatTimeAgo } from "../../utils/insight-file-api"
import { langFromPath } from "../../utils/write-output"
import { HtmlRenderer } from "../result-viewer/html-renderer"
import { SourceCodeView } from "../result-viewer/source-code-view"
import { MarkdownPreview } from "../markdown-editor/markdown-preview"
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

export function PreviewPanel(props: Props): JSX.Element {
  // 不吞异常:失败进 resource.error 态,由下方 <Show when={content.error}> 显示"加载失败"。
  // 所有 content() 读取都在 !content.error 分支内,不会冒泡到 ErrorBoundary。
  const [content] = createResource(
    () => props.file.path,
    (path) => fetchInsightContent(props.sdkUrl, props.sdkDirectory, path),
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
    // 分块 btoa:大文件不能 String.fromCharCode(...bytes) 整段展开(参数过多会爆栈)。
    const bytes = new TextEncoder().encode(c.content)
    let binary = ""
    const CHUNK = 0x8000
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
    }
    return btoa(binary)
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
              {/* 复用 insight 的 HtmlRenderer(srcdoc + allow-scripts),与标签页 HTML 渲染同源 */}
              <div class="w-full h-full">
                <HtmlRenderer content={content()?.content ?? ""} />
              </div>
            </Match>

            <Match when={isMarkdown()}>
              {/* 复用 insight 的 MarkdownPreview(Vditor),与标签页/编辑器渲染同源 */}
              <div class="w-full h-full overflow-auto">
                <MarkdownPreview content={content()?.content ?? ""} />
              </div>
            </Match>

            <Match when={isCode()}>
              {/* 复用 insight 的 SourceCodeView(shiki 高亮),与标签页代码视图同源 */}
              <div class="w-full h-full overflow-auto">
                <SourceCodeView content={content()?.content ?? ""} lang={langFromPath(props.file.name)} />
              </div>
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
