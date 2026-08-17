import { createSignal, For, Show } from "solid-js"
import { usePlatform } from "@/context/platform"

// 内网知识库检索的「来源」(对齐 knowledge_search 工具 metadata.sources)。
// [n] → 文档:n 与回答正文里的 [n] 标号对应,title=projectModuleName,url 跳原文。
export type KnowledgeSource = {
  n: number
  id: string
  title: string
  url?: string
  classification?: string
  score?: number
}

// 助手回答下方的折叠「引用 N 篇资料」列表(参考内网老 web 版)。
// 注:行内 [n] 上标暂不可点(消息正文由上游 SessionTurn 渲染,不改上游);
//     这里的编号与正文 [n] 对应,用户可对照查看 / 点开原文。
export function KnowledgeReferences(props: { sources: KnowledgeSource[] }) {
  const platform = usePlatform()
  const [open, setOpen] = createSignal(false)
  return (
    <div class="w-full px-4 md:px-5 pb-3">
      <div class="border-t border-border-weak-base pt-2">
        <button
          type="button"
          class="flex items-center gap-1 text-12-medium text-text-weak hover:text-text-strong"
          onClick={() => setOpen((v) => !v)}
        >
          <span>引用 {props.sources.length} 篇资料作为参考</span>
          <span aria-hidden>{open() ? "▾" : "▸"}</span>
        </button>
        <Show when={open()}>
          <ol class="mt-2 flex flex-col gap-1.5">
            <For each={props.sources}>
              {(s) => (
                <li class="flex items-baseline gap-2 text-12-regular min-w-0">
                  <span class="shrink-0 text-text-weak">{s.n}.</span>
                  <Show when={s.url} fallback={<span class="text-text-strong truncate">{s.title}</span>}>
                    <button
                      type="button"
                      class="text-left text-primary hover:underline truncate"
                      title={s.title}
                      onClick={() => platform.openLink(s.url!)}
                    >
                      {s.title}
                    </button>
                  </Show>
                  <Show when={s.classification}>
                    <span class="shrink-0 text-text-weak">· {s.classification}</span>
                  </Show>
                </li>
              )}
            </For>
          </ol>
        </Show>
      </div>
    </div>
  )
}
