import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js"
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
  // renderSeq:竞态守卫。内容从非空切到空时,旧 Vditor.preview 还在飞,新 effect 先 innerHTML=""
  // 随后旧 preview resolve 把老内容写回 DOM。每次渲染递增,resolve 时比对 seq,过期则丢弃。
  let renderSeq = 0

  onMount(() => {
    // 预览里的外链点击 → 系统浏览器(§6.5),与编辑器一致
    el?.addEventListener("click", interceptExternalLink, true)
  })

  // 内容 / 明暗变化时重渲染
  createEffect(() => {
    const md = props.content ?? ""
    const dark = isDark()
    if (!el) return
    // 空内容短路:跳过 Vditor.preview 整条异步管线(加载 4MB lute + 15 个渲染适配器 + 每次新增
    // click 监听),对齐上游 <Markdown>(markdown.tsx if (!content) return)与 Vditor 内部 Preview.render。
    // 显示空态而非纯白页,让用户分清「文件本来就是空的」与「还在加载 / 渲染挂了」。
    if (!md.trim()) {
      const seq = ++renderSeq
      el.innerHTML = ""
      void seq
      return
    }
    const seq = ++renderSeq
    void Vditor.preview(el, md, {
      mode: dark ? "dark" : "light",
      cdn: VDITOR_LOCAL_CDN,
      anchor: 0,
      hljs: { style: dark ? "native" : "github", lineNumber: false },
      theme: { current: dark ? "dark" : "light", path: `${VDITOR_LOCAL_CDN}/dist/css/content-theme` },
    }).then(() => {
      // 旧 preview resolve 时若 seq 已过期(期间又切了内容 / 主题),丢弃写回,不覆盖最新 DOM。
      if (seq !== renderSeq) return
    })
  })

  onCleanup(() => el?.removeEventListener("click", interceptExternalLink, true))

  return (
    <div class="h-full overflow-auto">
      <Show
        when={props.content.trim()}
        fallback={
          <div class="flex items-center justify-center h-32 text-sm text-[#9ca3af]">
            Markdown 内容为空
          </div>
        }
      >
        <div ref={el} class="vditor-reset p-4 h-full" />
      </Show>
    </div>
  )
}
