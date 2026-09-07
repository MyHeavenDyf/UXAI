import { createMemo, createSignal, createEffect, onCleanup, Show } from "solid-js"
import type { JSX } from "solid-js"
import { stripCodeFence } from "../../utils/detect"

// 沙箱 iframe 预览模型生成的 HTML(不可信内容),对齐业界客户端预览标准做法:
// 用 blob URL 作为 iframe.src,而不是 srcdoc。
// 原因:srcdoc 文档的 base URL 继承自宿主页面,页内锚点 <a href="#x"> 会被解析成
// "<app 地址>#x",在 sandbox(无 allow-same-origin)下跨源导航被拦 → iframe 内容被冲掉 → 白屏。
// blob URL 让文档拥有自己的真实地址(blob:...),#锚点 解析成 blob:...#x 属同文档跳转(只滚动、不导航),
// 锚点/相对路径/history 自然正常;相比 data: URL 无 base64 膨胀与长度上限,更适合大 HTML。
// sandbox 保持 allow-scripts(不加 allow-same-origin):脚本可跑,源为不透明源,碰不到主站 DOM/存储。
export function HtmlRenderer(props: { content: string }): JSX.Element {
  const html = createMemo(() => stripCodeFence(props.content).trim())
  const [blobUrl, setBlobUrl] = createSignal("")

  createEffect(() => {
    const src = html()
    if (!src) {
      setBlobUrl("")
      return
    }
    const url = URL.createObjectURL(new Blob([src], { type: "text/html" }))
    setBlobUrl(url)
    // 内容变化前 / 组件卸载时回收,避免 blob 泄漏
    onCleanup(() => URL.revokeObjectURL(url))
  })

  return (
    <Show
      when={html().length > 0}
      fallback={
        <div class="flex items-center justify-center h-32 text-sm text-[#9ca3af]">
          HTML 内容为空
        </div>
      }
    >
      <iframe
        src={blobUrl()}
        sandbox="allow-scripts"
        title="HTML preview"
        style={{
          width: "100%",
          height: "100%",
          border: "none",
          background: "white",
          display: "block",
        }}
      />
    </Show>
  )
}
