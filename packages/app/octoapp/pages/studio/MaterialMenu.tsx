import { createMemo, createSignal, For, type JSX } from "solid-js"

const WORD_BOOK = [

]

export function MaterialMenu(props: { onSelectTag: (tag: string) => void }): JSX.Element {
  const [categoryIndex, setCategoryIndex] = createSignal(0)
  const [subcategoryIndex, setSubcategoryIndex] = createSignal(0)

  const currentCategory = createMemo(() => WORD_BOOK[categoryIndex()])
  const currentSubcategory = createMemo(() => currentCategory().subcategories[subcategoryIndex()])

  function selectCategory(index: number) {
    setCategoryIndex(index)
    setSubcategoryIndex(0)
  }

  return (
    <div class="studio-menu studio-material-menu">
      <div class="studio-material-title">词书</div>
      <div class="studio-material-categories">
        <For each={WORD_BOOK}>
          {(item, index) => (
            <button
              type="button"
              class="studio-material-cat-btn"
              classList={{ active: index() === categoryIndex() }}
              onClick={() => selectCategory(index())}
            >
              {item.category}
            </button>
          )}
        </For>
      </div>
      <div class="studio-material-section-label">类型选择</div>
      <div class="studio-material-subcategories">
        <For each={currentCategory().subcategories}>
          {(sub, index) => (
            <button
              type="button"
              class="studio-material-sub-btn"
              classList={{ active: index() === subcategoryIndex() }}
              onClick={() => setSubcategoryIndex(index())}
            >
              {sub.label}
            </button>
          )}
        </For>
      </div>
      <div class="studio-material-tags">
        <For each={currentSubcategory().tags}>
          {(tag) => (
            <button
              type="button"
              class="studio-material-tag-btn"
              onClick={() => props.onSelectTag(tag)}
            >
              {tag}
            </button>
          )}
        </For>
      </div>
    </div>
  )
}
