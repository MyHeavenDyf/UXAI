import { createEffect, onCleanup, onMount } from "solid-js"
import type { JSX } from "solid-js"
import Vditor from "vditor"
import "vditor/dist/index.css"
import { useTheme } from "@opencode-ai/ui/theme/context"
import { interceptExternalLink } from "../../utils/external-link"

// Vditor 资源本地化路径(与编辑器同源,见 index.tsx / spec §6.2)
const VDITOR_LOCAL_CDN = "/vendor/vditor"

// markdown 卡的预览渲染:用 Vditor 自带渲染引擎(Lute),与全屏编辑器**同一套渲染**,
// 避免「卡片预览(上游 <Markdown>)」与「编辑器预览(Vditor)」效果不一致(加粗/表格/代码等)。
// 见 docs/specs/ui/insight-markdown-editor.md §6.3 + output-renderers.md §1。
export function MarkdownPreview(props: { content: string }): JSX.Element {
  const theme = useTheme()
  const isDark = () => theme.mode() === "dark"
  let el: HTMLDivElement | undefined

  onMount(() => {
    // 预览里的外链点击 → 系统浏览器(§6.5),与编辑器一致
    el?.addEventListener("click", interceptExternalLink, true)
  })

  // 内容 / 明暗变化时重渲染
  createEffect(() => {
    const md = props.content ?? ""
    const dark = isDark()
    if (!el) return
    void Vditor.preview(el, md, {
      mode: dark ? "dark" : "light",
      cdn: VDITOR_LOCAL_CDN,
      anchor: 0,
      hljs: { style: dark ? "native" : "github", lineNumber: false },
      theme: { current: dark ? "dark" : "light", path: `${VDITOR_LOCAL_CDN}/dist/css/content-theme` },
    })
  })

  onCleanup(() => el?.removeEventListener("click", interceptExternalLink, true))

  return <div ref={el} class="vditor-reset p-4 h-full overflow-auto" />
}
