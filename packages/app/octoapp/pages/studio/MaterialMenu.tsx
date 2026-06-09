import { createEffect, createMemo, createSignal, For, on, Show, type JSX, type Resource } from "solid-js"

export type MaterialTag = { en: string; zh: string }
export type MaterialWordBook = { name: string; model: string[]; groups: { name: string; tags: MaterialTag[] }[] }

export function MaterialMenu(props: { wordBook: Resource<MaterialWordBook[]>; onSelectTag: (tag: string) => void }): JSX.Element {
  const [categoryIndex, setCategoryIndex] = createSignal(0)
  const [subcategoryIndex, setSubcategoryIndex] = createSignal(0)

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

  function selectCategory(index: number) {
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
                  onClick={() => setSubcategoryIndex(index())}
                >
                  {sub.name}
                </button>
              )}
            </For>
          </div>
          <div class="studio-material-tags">
            <For each={currentSubcategory()?.tags ?? []}>
              {(tag) => (
                <button
                  type="button"
                  class="studio-material-tag-btn"
                  onClick={() => props.onSelectTag(tag.zh)}
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
