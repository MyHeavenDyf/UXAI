import { createSignal, For, Show } from "solid-js"
import { getDesktopApi } from "../lib/electron-api"
import "./knowledge-references.css"

// 内网知识库引用列表(SPEC-INS-030 §2 引用 UI 重建)。
//
// 与 chat 时代 pages/session/knowledge-references.tsx 的关系:那份挂在上游共享渲染器
// message-timeline 上、随 chat 一起下线;insight 走自己的 insight-turn,故在此重建一份
// (insight 页面自包含:样式/组件不外散)。数据仍来自 knowledge_search 工具的 metadata.sources,
// 检索层零改动。
//
// 行内 `[[n]](url)` 是模型直出的原生 markdown 链接,由上游 SessionTurn 渲染,不在本组件职责内。

/** 一条来源(对齐 knowledge_search 工具 metadata.sources 的元素结构)。 */
export type KnowledgeSource = {
  n: number
  id: string
  title: string
  url?: string
  classification?: string
  score?: number
}

/**
 * 从任意 part 数组里取出本轮的 knowledge_search sources。
 *
 * 防御式解析:part 结构来自 sync store(any 化的 SDK 类型),这里逐字段校验后才当 source 用
 * —— 脏数据宁可当"没有引用"(列表不显示),不能让对话流整个渲染崩掉。
 */
export function readKnowledgeSources(parts: Array<Record<string, unknown>>): KnowledgeSource[] {
  for (const part of parts) {
    if (part?.["type"] !== "tool" || part?.["tool"] !== "knowledge_search") continue
    const state = part["state"] as Record<string, unknown> | undefined
    const metadata = state?.["metadata"] as Record<string, unknown> | undefined
    const raw = metadata?.["sources"]
    if (!Array.isArray(raw)) continue
    const sources = raw.filter((s): s is KnowledgeSource => {
      if (!s || typeof s !== "object") return false
      const v = s as Record<string, unknown>
      return typeof v["n"] === "number" && typeof v["title"] === "string"
    })
    if (sources.length > 0) return sources
  }
  return []
}

function openExternal(url: string) {
  const api = getDesktopApi()
  if (typeof api?.openLink === "function") api.openLink(url)
  else window.open(url, "_blank", "noopener")
}

/** 回答下方的折叠「引用 N 篇资料」列表;编号与正文里的 [n] 对应。 */
export function KnowledgeReferences(props: { sources: KnowledgeSource[] }) {
  const [open, setOpen] = createSignal(false)
  return (
    <div class="octo-kb-refs">
      <button type="button" class="octo-kb-refs__toggle" onClick={() => setOpen((v) => !v)}>
        <span>引用 {props.sources.length} 篇资料作为参考</span>
        <span class="octo-kb-refs__caret" aria-hidden>
          {open() ? "▾" : "▸"}
        </span>
      </button>
      <Show when={open()}>
        <ol class="octo-kb-refs__list">
          <For each={props.sources}>
            {(s) => (
              <li class="octo-kb-refs__item">
                <span class="octo-kb-refs__index">{s.n}.</span>
                <Show when={s.url} fallback={<span class="octo-kb-refs__title" title={s.title}>{s.title}</span>}>
                  <button
                    type="button"
                    class="octo-kb-refs__link"
                    title={s.title}
                    onClick={() => openExternal(s.url!)}
                  >
                    {s.title}
                  </button>
                </Show>
                <Show when={s.classification}>
                  <span class="octo-kb-refs__meta">· {s.classification}</span>
                </Show>
              </li>
            )}
          </For>
        </ol>
      </Show>
    </div>
  )
}
