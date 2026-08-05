import { createEffect, createMemo, onCleanup, onMount, Show } from "solid-js"
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
  // renderSeq:竞态守卫。Vditor.preview 把渲染结果写进 el 是在 resolve 之前发生的,所以「非空 → 切空」
  // 时旧 preview 的写回会把已清空的 DOM 再污染一次 —— 仅在 .then 里比对 seq 是空操作。这里递增后,
  // 过期 resolve 在 .then 里把 DOM 纠正回当前(空)状态。
  let renderSeq = 0

  const isEmpty = createMemo(() => !(props.content ?? "").trim())

  onMount(() => {
    // 预览里的外链点击 → 系统浏览器(§6.5),与编辑器一致
    el?.addEventListener("click", interceptExternalLink, true)
  })

  // 内容 / 明暗变化时重渲染
  createEffect(() => {
    const md = props.content ?? ""
    const dark = isDark()
    if (!el) return
    const seq = ++renderSeq
    // 空内容短路:跳过 Vditor.preview 整条异步管线(加载 4MB lute + 15 个渲染适配器 + 每次新增
    // click 监听),对齐上游 <Markdown>(markdown.tsx if (!content) return)与 Vditor 内部 Preview.render。
    // 显示空态而非纯白页,让用户分清「文件本来就是空的」与「还在加载 / 渲染挂了」。
    if (!md.trim()) {
      el.innerHTML = ""
      return
    }
    void Vditor.preview(el, md, {
      mode: dark ? "dark" : "light",
      cdn: VDITOR_LOCAL_CDN,
      anchor: 0,
      hljs: { style: dark ? "native" : "github", lineNumber: false },
      theme: { current: dark ? "dark" : "light", path: `${VDITOR_LOCAL_CDN}/dist/css/content-theme` },
    }).then(() => {
      if (seq === renderSeq) return
      // 已过期:Vditor 已把旧内容写进 DOM,纠正回当前状态。
      // 过期到非空会被后一次 preview 覆盖,只有过期到空需要在这里补 —— **前提是后一次更晚 resolve**。
      // 当前 content 按保存 / 刷新粒度更新,两次 preview 并发的窗口极小,故不额外处理乱序;
      // 若以后把本组件复用到实时预览(编辑器边输边渲),乱序 resolve 会稳定复现(慢的 A 盖掉快的 B),
      // 届时这里要改成「过期一律按当前 content 重渲染」而非只补空。
      if (el && isEmpty()) el.innerHTML = ""
    })
  })

  onCleanup(() => el?.removeEventListener("click", interceptExternalLink, true))

  // el 恒定挂载(空时 display:none),不放进 <Show>:否则初始内容为空时 el 不存在,onMount 里
  // addEventListener 静默跳过,之后内容变非空也不会再补监听 → 外链拦截永久失效(§6.5)。
  // 滚动 + padding 收敛到同一元素,避免「内层 h-full + 外层 overflow-auto」的双层高度坑(底 padding 失效)。
  return (
    <div class="relative h-full">
      <div
        ref={el}
        class="vditor-reset p-4 h-full overflow-auto"
        style={{ display: isEmpty() ? "none" : undefined }}
      />
      <Show when={isEmpty()}>
        <div class="absolute inset-0 flex items-center justify-center text-sm text-[#9ca3af]">
          Markdown 内容为空
        </div>
      </Show>
    </div>
  )
}
