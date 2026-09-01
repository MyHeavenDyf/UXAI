import { createMemo, createSignal, For, onMount, Show, type JSX } from "solid-js"
import type { StudioTemplatePublishInput } from "./studio-template-creator"

type StyleTemplateSection = "creative-square" | "mine"
const STYLE_TEMPLATE_PAGE_SIZE = 20

export type StudioStyleTemplateListInput = {
  only_public: 0 | 1
  page: number
  page_size: 20
}

export type StudioStyleTemplateListItem = StudioTemplatePublishInput & {
  idx: string
}

export type StudioStyleTemplateListResult = {
  data: StudioStyleTemplateListItem[]
  total: number
}

function templateTypeLabel(item: StudioStyleTemplateListItem) {
  return item.template_type === "extract_style" ? "风格" : "配方"
}

export function StudioStyleTemplateMenu(props: {
  onCreateTemplate: () => void
  onListTemplates?: (input: StudioStyleTemplateListInput) => Promise<StudioStyleTemplateListResult>
}): JSX.Element {
  const [section, setSection] = createSignal<StyleTemplateSection>("creative-square")
  const [items, setItems] = createSignal<StudioStyleTemplateListItem[]>([])
  const [page, setPage] = createSignal(1)
  const [total, setTotal] = createSignal<number>()
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal("")
  const hasMore = createMemo(() => items().length < (total() ?? Number.POSITIVE_INFINITY))
  let requestSeq = 0

  async function loadTemplates(input: { reset?: boolean; section?: StyleTemplateSection } = {}) {
    if (!props.onListTemplates) return
    if (!input.reset && (loading() || !hasMore())) return

    const seq = ++requestSeq
    const targetSection = input.section ?? section()
    const nextPage = input.reset ? 1 : page()

    setLoading(true)
    setError("")
    if (input.reset) {
      setItems([])
      setTotal(undefined)
      setPage(1)
    }

    try {
      const result = await props.onListTemplates({
        only_public: targetSection === "creative-square" ? 1 : 0,
        page: nextPage,
        page_size: STYLE_TEMPLATE_PAGE_SIZE,
      })
      if (seq !== requestSeq) return
      setItems((current) => input.reset ? result.data : [...current, ...result.data])
      setTotal(result.total)
      setPage(nextPage + 1)
    } catch (loadError) {
      if (seq !== requestSeq) return
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      if (seq === requestSeq) setLoading(false)
    }
  }

  function switchSection(next: StyleTemplateSection) {
    if (section() === next) return
    setSection(next)
    void loadTemplates({ reset: true, section: next })
  }

  function handleScroll(event: Event) {
    const target = event.currentTarget as HTMLDivElement
    if (target.scrollTop + target.clientHeight < target.scrollHeight - 8) return
    void loadTemplates()
  }

  onMount(() => {
    void loadTemplates({ reset: true })
  })

  return (
    <div class="studio-menu studio-style-template-menu">
      <div class="studio-style-template-header">
        <div class="studio-style-template-tabs" role="tablist" aria-label="风格模板分类">
          <button
            type="button"
            role="tab"
            aria-selected={section() === "creative-square"}
            class="studio-style-template-tab"
            classList={{ active: section() === "creative-square" }}
            onClick={() => switchSection("creative-square")}
          >
            创意广场
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={section() === "mine"}
            class="studio-style-template-tab"
            classList={{ active: section() === "mine" }}
            onClick={() => switchSection("mine")}
          >
            我的模板
          </button>
        </div>
        <button type="button" class="studio-style-template-create" onClick={props.onCreateTemplate}>
          <span class="studio-style-template-create-plus" aria-hidden="true" />
          <span>创建模板</span>
        </button>
      </div>
      <div class="studio-style-template-content" role="tabpanel" onScroll={handleScroll}>
        <Show
          when={items().length > 0}
          fallback={
            <div class="studio-style-template-state">
              <Show when={error()} fallback={loading() ? "加载中..." : "暂无模板"}>
                {(message) => message()}
              </Show>
            </div>
          }
        >
          <div class="studio-style-template-list">
            <For each={items()}>
              {(item) => (
                <div class="studio-style-template-card">
                  <div class="studio-style-template-card-cover">
                    <Show when={item.example_images[0]?.url}>
                      {(cover) => (
                        <img class="studio-style-template-card-cover-image" src={cover()} alt="" />
                      )}
                    </Show>
                    <div class="studio-style-template-card-type">
                      <img
                        class="studio-style-template-card-type-icon"
                        src="/studio/studio_template_photo_group.svg"
                        alt=""
                      />
                      <span>{templateTypeLabel(item)}</span>
                    </div>
                  </div>
                  <div class="studio-style-template-card-title" title={item.title}>{item.title}</div>
                </div>
              )}
            </For>
          </div>
          <Show when={loading()}>
            <div class="studio-style-template-loading-more">加载中...</div>
          </Show>
          <Show when={error()}>
            {(message) => <div class="studio-style-template-loading-more error">{message()}</div>}
          </Show>
        </Show>
      </div>
    </div>
  )
}
