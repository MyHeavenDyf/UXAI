// ── 源码渲染器 ──────────────────────────────────────────────────
// 复用上游 <Markdown> 的 shiki 高亮:把内容包成 ```lang fence 喂给它,
// 自动获得 syntax highlight + 复制按钮(跟对话区的代码段视觉完全一致)。
// 独立成文件:result-viewer 与 file-manager 预览面板共用,避免两处循环引用。
import { createMemo } from "solid-js"
import type { JSX } from "solid-js"
import { Markdown } from "@opencode-ai/ui/markdown"
import { stripCodeFence } from "../../utils/detect"

export function SourceCodeView(props: { content: string; lang: string }): JSX.Element {
  const fenced = createMemo(() => {
    // stripCodeFence 只对「内容本身可能被 ```lang 整段包裹」的来源(json/html,如 LLM 直出)有意义;
    // 对 markdown / code 源**不能** strip —— md 源里合法存在代码围栏,strip 会把整篇抠成第一个围栏的内容
    // (曾导致 md「代码」视图只剩一行,见 spec §8/output-renderers §1)。故仅 json/html 走 strip。
    const stripable = props.lang === "json" || props.lang === "html"
    const raw = stripable ? stripCodeFence(props.content) : props.content
    let body = raw
    if (props.lang === "json") {
      try { body = JSON.stringify(JSON.parse(raw), null, 2) } catch { /* 解析失败保持原样,shiki 容错 */ }
    }
    return "```" + props.lang + "\n" + body + "\n```"
  })
  return (
    <div class="octo-source-code-view p-4 h-full overflow-auto">
      <Markdown text={fenced()} />
    </div>
  )
}
