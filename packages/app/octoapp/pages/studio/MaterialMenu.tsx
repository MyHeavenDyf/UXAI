import { createMemo, createSignal, For, type JSX } from "solid-js"

type MaterialTag = { en: string; zh: string }
type MaterialWordBook = { category: string; subcategories: { label: string; tags: MaterialTag[] }[] }

const WORD_BOOK: MaterialWordBook[] = [
  {
    category: "人物",
    subcategories: [
      {
        label: "身份",
        tags: [
          { en: "female", zh: "女人" },
          { en: "male", zh: "男人" },
          { en: "scientist", zh: "科学家" },
          { en: "athletes", zh: "运动员" },
          { en: "office lady", zh: "职场女性" },
          { en: "student", zh: "学生" },
          { en: "teacher", zh: "老师" },
          { en: "poet", zh: "诗人" },
          { en: "hacker", zh: "黑客" },
          { en: "magician", zh: "魔术师" },
          { en: "pilot", zh: "飞行员" },
          { en: "diver", zh: "潜水员" },
          { en: "firefighter", zh: "消防员" },
          { en: "astronaut", zh: "宇航员" },
          { en: "doctor", zh: "医生" },
        ],
      },
      {
        label: "身材",
        tags: [
          { en: "curvy", zh: "线条好" },
          { en: "fat", zh: "肥胖" },
          { en: "thin", zh: "瘦" },
          { en: "slender", zh: "苗条" },
          { en: "glamor", zh: "魅力" },
          { en: "tall", zh: "高大" },
          { en: "petite", zh: "娇小" },
          { en: "chibi", zh: "萌萌" },
          { en: "muscular", zh: "肌肉" },
        ],
      },
    ],
  },
]

export function MaterialMenu(props: { onSelectTag: (tag: string) => void }): JSX.Element {
  const [categoryIndex, setCategoryIndex] = createSignal(0)
  const [subcategoryIndex, setSubcategoryIndex] = createSignal(0)

  const currentCategory = createMemo(() => WORD_BOOK[categoryIndex()])
  const currentSubcategory = createMemo(() => currentCategory()?.subcategories[subcategoryIndex()])

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
        <For each={currentCategory()?.subcategories ?? []}>
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
        <For each={currentSubcategory()?.tags ?? []}>
          {(tag) => (
            <button
              type="button"
              class="studio-material-tag-btn"
              onClick={() => props.onSelectTag(tag.en)}
            >
              {tag.zh}
            </button>
          )}
        </For>
      </div>
    </div>
  )
}
