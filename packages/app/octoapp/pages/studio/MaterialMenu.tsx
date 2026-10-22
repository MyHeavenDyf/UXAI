import { createEffect, createMemo, createSignal, For, on, Show, type JSX, type Resource } from "solid-js"
import { tracker } from "@/utils/tracker"

export type MaterialTag = { en: string; zh: string }
export type MaterialWordBook = { name: string; model: string[]; groups: { name: string; tags: MaterialTag[] }[] }

export function MaterialMenu(props: { wordBook: Resource<MaterialWordBook[]>; onSelectTag: (tag: string) => void }): JSX.Element {
  const [categoryIndex, setCategoryIndex] = createSignal(0)
  const [subcategoryIndex, setSubcategoryIndex] = createSignal(0)
  const [selectedTag, setSelectedTag] = createSignal("")

  const currentWordBook = createMemo(() => {
    if (props.wordBook.error) return []
    return props.wordBook() ?? []
  })

  // Reset selection indices when wordbook data changes (e.g. server switch)
  createEffect(on(currentWordBook, () => {
    setCategoryIndex(0)
    setSubcategoryIndex(0)
  }, { defer: true }))

  const currentCategory = createMemo(() => currentWordBook()[categoryIndex()])
  const currentSubcategory = createMemo(() => currentCategory()?.groups?.[subcategoryIndex()])
  const uniqueTags = createMemo(() => {
    const tags = currentSubcategory()?.tags ?? []
    const seen = new Set<string>()
    return tags.filter((t) => {
      const key = t.zh
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  })

  function selectCategory(index: number) {
    tracker.interaction({ module: "studio", name: "material-category", extend: JSON.stringify({ name: currentWordBook()[index]?.name }) })
    setCategoryIndex(index)
    setSubcategoryIndex(0)
  }

  return (
    <div class="studio-menu studio-material-menu">
      <div class="studio-material-title">词书</div>
      <Show when={!props.wordBook.loading} fallback={<div class="studio-material-loading">加载中...</div>}>
        <Show
          when={!props.wordBook.error}
          fallback={<div class="studio-material-error">加载失败，请重试</div>}
        >
          <div class="studio-material-categories">
            <For each={currentWordBook()}>
              {(item, index) => (
                <button
                  type="button"
                  class="studio-material-cat-btn"
                  classList={{ active: index() === categoryIndex() }}
                  onClick={() => selectCategory(index())}
                >
                  {item.name}
                </button>
              )}
            </For>
          </div>
          <div class="studio-material-section-label">类型选择</div>
          <div class="studio-material-subcategories">
            <For each={currentCategory()?.groups ?? []}>
              {(sub, index) => (
                <button
                  type="button"
                  class="studio-material-sub-btn"
                  classList={{ active: index() === subcategoryIndex() }}
                  onClick={() => {
                    tracker.interaction({ module: "studio", name: "material-subcategory", extend: JSON.stringify({ name: sub.name }) })
                    setSubcategoryIndex(index())
                  }}
                >
                  {sub.name}
                </button>
              )}
            </For>
          </div>
          <div class="studio-material-tags">
            <For each={uniqueTags()}>
              {(tag) => (
                <button
                  type="button"
                  class="studio-material-tag-btn"
                  classList={{ active: selectedTag() === tag.zh }}
                  onClick={() => {
                    tracker.interaction({ module: "studio", name: "material-tag", extend: JSON.stringify({ tag: tag.zh }) })
                    setSelectedTag(tag.zh)
                    props.onSelectTag(tag.zh)
                  }}
                >
                  {tag.zh}
                </button>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  )
}
